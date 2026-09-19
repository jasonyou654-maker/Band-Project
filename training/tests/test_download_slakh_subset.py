from __future__ import annotations

import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))

import download_slakh_subset  # noqa: E402


class SlakhSubsetDownloadTests(unittest.TestCase):
    def test_metadata_selects_every_bass_stem(self):
        metadata = """stems:\n  S00:\n    inst_class: Guitar\n  S03:\n    inst_class: Bass\n  S08:\n    inst_class: Bass\n"""
        self.assertEqual(download_slakh_subset.bass_stem_ids(metadata), {"S03", "S08"})

    def test_budget_is_checked_before_any_file_download(self):
        files = [{"type": "file", "path": "data/Slakh2100_redux/train/Track00018/mix.flac", "size": 90}]
        with tempfile.TemporaryDirectory() as directory, patch.object(download_slakh_subset, "tree", return_value=files), patch.object(download_slakh_subset, "request_bytes") as request:
            with self.assertRaisesRegex(RuntimeError, "budget"):
                download_slakh_subset.download_tracks(Path(directory), ("Track00018",), 80, mode="all")
        request.assert_not_called()

    def test_complete_subset_writes_a_reproducible_manifest(self):
        files = [{"type": "file", "path": "data/Slakh2100_redux/train/Track00018/metadata.yaml", "size": 4}]
        with tempfile.TemporaryDirectory() as directory, patch.object(download_slakh_subset, "tree", return_value=files), patch.object(download_slakh_subset, "request_bytes", return_value=b"data"):
            root = Path(directory)
            with patch.object(download_slakh_subset, "download_file", side_effect=lambda url, output, expected: (output.write_bytes(b"data") or 4)):
                manifest = download_slakh_subset.download_tracks(root, ("Track00018",), 100, mode="all")
            self.assertEqual(manifest["bytes"], 4)
            self.assertEqual((root / "Track00018" / "metadata.yaml").read_bytes(), b"data")
            self.assertTrue((root / "subset-manifest.json").is_file())

    def test_audio_mode_keeps_all_audio_stems_but_skips_midi(self):
        prefix = "data/Slakh2100_redux/train/Track00018/"
        files = [
            {"path": prefix + "metadata.yaml"},
            {"path": prefix + "mix.flac"},
            {"path": prefix + "stems/S00.flac"},
            {"path": prefix + "stems/S01.flac"},
            {"path": prefix + "MIDI/S00.mid"},
        ]
        selected = download_slakh_subset.select_files(files, "audio", "https://example.test")
        self.assertEqual([item["path"] for item in selected], [item["path"] for item in files[:4]])


if __name__ == "__main__":
    unittest.main()
