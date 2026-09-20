"""Slakh-trained full-band four-stem evidence model."""
from __future__ import annotations

from math import gcd
import os
from pathlib import Path
from threading import Lock

STEM_NAMES = ("bass", "drums", "vocals", "other")
_ONNX_SESSIONS = {}
_ONNX_SESSION_LOCK = Lock()


def _shared_onnx_session(model_path: Path):
    key = str(model_path.resolve())
    if key in _ONNX_SESSIONS:
        return _ONNX_SESSIONS[key]
    with _ONNX_SESSION_LOCK:
        if key not in _ONNX_SESSIONS:
            try:
                import onnxruntime
            except ImportError as error:
                raise RuntimeError("The Slakh ONNX refiner requires onnxruntime.") from error
            if hasattr(onnxruntime, "disable_telemetry_events"):
                onnxruntime.disable_telemetry_events()
            options = onnxruntime.SessionOptions()
            options.intra_op_num_threads = max(1, int(os.getenv("ONNX_INTRA_OP_THREADS", "2")))
            options.inter_op_num_threads = 1
            options.execution_mode = onnxruntime.ExecutionMode.ORT_SEQUENTIAL
            options.graph_optimization_level = onnxruntime.GraphOptimizationLevel.ORT_ENABLE_ALL
            _ONNX_SESSIONS[key] = onnxruntime.InferenceSession(
                key,
                sess_options=options,
                providers=["CPUExecutionProvider"],
            )
    return _ONNX_SESSIONS[key]


def build_multistem_mask_model(torch):
    """Keep the training architecture beside inference for checkpoint parity."""
    nn = torch.nn

    class MultibandStemMask(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.encoder = nn.Sequential(
                nn.Conv2d(1, 8, 5, padding=2), nn.GELU(),
                nn.Conv2d(8, 8, 3, padding=1, groups=8), nn.GELU(),
                nn.Conv2d(8, 12, 1), nn.GELU(),
                nn.Conv2d(12, 12, 3, padding=1, groups=12), nn.GELU(),
                nn.Conv2d(12, len(STEM_NAMES), 1),
            )

        def forward(self, magnitude):
            masks = torch.softmax(self.encoder(torch.log1p(magnitude)), dim=1)
            return magnitude * masks

    return MultibandStemMask()


class SlakhMultistemRefiner:
    def __init__(self, model_path: Path) -> None:
        self.model_path = model_path
        self.checkpoint = model_path  # Backward-compatible inspection attribute.

    @classmethod
    def from_environment(cls) -> "SlakhMultistemRefiner | None":
        explicit = os.getenv("MULTISTEM_REFINER_MODEL", "").strip() or os.getenv("MULTISTEM_REFINER_CHECKPOINT", "").strip()
        models = Path(__file__).parents[1] / "models"
        candidate = Path(explicit) if explicit else models / "multistem-mask.onnx"
        if not explicit and not candidate.is_file():
            candidate = models / "multistem-mask.pt"
        return cls(candidate) if candidate.is_file() else None

    @staticmethod
    def _stft(numpy, signal, n_fft: int, hop_length: int):
        padding = n_fft // 2
        mode = "reflect" if signal.shape[0] > padding else "constant"
        padded = numpy.pad(signal, (padding, padding), mode=mode)
        frames = numpy.lib.stride_tricks.sliding_window_view(padded, n_fft)[::hop_length]
        window = numpy.hanning(n_fft + 1)[:-1].astype("float32")
        return numpy.fft.rfft(frames * window, axis=1).T.astype("complex64"), window

    @staticmethod
    def _istft(numpy, spectrum, window, hop_length: int, length: int):
        n_fft = window.shape[0]
        frames = numpy.fft.irfft(spectrum.T, n=n_fft, axis=1).astype("float32") * window
        output = numpy.zeros(n_fft + hop_length * (frames.shape[0] - 1), dtype="float32")
        weights = numpy.zeros_like(output)
        for index, frame in enumerate(frames):
            start = index * hop_length
            output[start:start + n_fft] += frame
            weights[start:start + n_fft] += window * window
        output /= numpy.maximum(weights, 1e-8)
        padding = n_fft // 2
        return numpy.pad(output[padding:padding + length], (0, max(0, length - (output.shape[0] - padding))))[:length]

    def _separate_onnx(self, waveform, sample_rate: int, n_fft: int, hop_length: int):
        try:
            import numpy
        except ImportError as error:
            raise RuntimeError("The Slakh ONNX refiner requires numpy.") from error
        session = _shared_onnx_session(self.model_path)
        chunk_samples = max(5 * sample_rate, int(float(os.getenv("MULTISTEM_CHUNK_SECONDS", "8")) * sample_rate))
        overlap = min(sample_rate, chunk_samples // 4)
        step = chunk_samples - overlap
        separated = numpy.zeros((len(STEM_NAMES), waveform.shape[0]), dtype="float32")
        weights = numpy.zeros(waveform.shape[0], dtype="float32")
        for start in range(0, waveform.shape[0], step):
            end = min(waveform.shape[0], start + chunk_samples)
            spectrum, window = self._stft(numpy, waveform[start:end], n_fft, hop_length)
            magnitude = numpy.abs(spectrum).astype("float32")
            estimates = session.run(["stems"], {"magnitude": magnitude[None, None]})[0][0]
            phase = spectrum / numpy.maximum(magnitude, 1e-8)
            chunk_audio = numpy.stack([
                self._istft(numpy, estimate * phase, window, hop_length, end - start)
                for estimate in estimates
            ])
            envelope = numpy.ones(end - start, dtype="float32")
            fade = min(overlap, end - start)
            if start:
                envelope[:fade] = numpy.linspace(0, 1, fade, dtype="float32")
            if end < waveform.shape[0]:
                envelope[-fade:] = numpy.linspace(1, 0, fade, dtype="float32")
            separated[:, start:end] += chunk_audio * envelope
            weights[start:end] += envelope
        return numpy.clip(separated / numpy.maximum(weights, 1e-6), -1, 1)

    def warm(self) -> None:
        if self.model_path.suffix == ".onnx":
            import numpy
            session = _shared_onnx_session(self.model_path)
            chunk_seconds = max(5, int(float(os.getenv("MULTISTEM_CHUNK_SECONDS", "8"))))
            frame_count = 1 + (chunk_seconds * 16000) // 256
            session.run(["stems"], {"magnitude": numpy.zeros((1, 1, 513, frame_count), dtype="float32")})

    def _separate_torch(self, waveform, sample_rate: int, n_fft: int, hop_length: int):
        try:
            import torch
        except ImportError as error:
            raise RuntimeError("The Slakh checkpoint refiner requires torch.") from error
        state = torch.load(self.model_path, map_location="cpu", weights_only=True)
        model = build_multistem_mask_model(torch)
        model.load_state_dict(state["model"])
        model.eval()
        signal = torch.from_numpy(waveform.copy())
        window = torch.hann_window(n_fft)
        with torch.inference_mode():
            spectrum = torch.stft(signal, n_fft, hop_length, window=window, return_complex=True)
            estimates = model(spectrum.abs()[None, None])[0]
            phase = torch.exp(1j * torch.angle(spectrum))
            return torch.stack([
                torch.istft(estimate * phase, n_fft, hop_length, window=window, length=signal.shape[-1])
                for estimate in estimates
            ]).clamp(-1, 1).numpy()

    def separate(self, mixture_path: Path, output_directory: Path) -> dict[str, Path]:
        try:
            import numpy
            import soundfile
            from scipy.signal import resample_poly
        except ImportError as error:
            raise RuntimeError("The Slakh multistem refiner requires numpy, scipy, and soundfile.") from error
        samples, source_rate = soundfile.read(mixture_path, dtype="float32", always_2d=True)
        waveform = samples.mean(axis=1)
        sample_rate = 16000
        if source_rate != sample_rate:
            divisor = gcd(source_rate, sample_rate)
            waveform = resample_poly(waveform, sample_rate // divisor, source_rate // divisor).astype("float32")
        audio = self._separate_onnx(waveform, sample_rate, 1024, 256) if self.model_path.suffix == ".onnx" else self._separate_torch(waveform, sample_rate, 1024, 256)
        output_directory.mkdir(parents=True, exist_ok=True)
        paths = {}
        for stem, estimate in zip(STEM_NAMES, audio):
            path = output_directory / f"{stem}-slakh-analysis.wav"
            soundfile.write(path, numpy.asarray(estimate), sample_rate, subtype="FLOAT")
            paths[stem] = path
        return paths
