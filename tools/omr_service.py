#!/usr/bin/env python3
"""Local PDF/image to MusicXML bridge, powered by the bundled Audiveris app."""

from __future__ import annotations

import cgi
import json
import os
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "tools" / "Audiveris.app" / "Contents"
JAVA = APP / "runtime" / "Contents" / "Home" / "bin" / "java"
WORK = ROOT / "tools" / "omr-work"
MAX_BYTES = 25 * 1024 * 1024
ALLOWED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg"}


def prepare_runtime() -> None:
    """Remove macOS download quarantine from the bundled app before Java starts."""
    if os.uname().sysname != "Darwin":
        return
    subprocess.run(["xattr", "-dr", "com.apple.quarantine", str(ROOT / "tools" / "Audiveris.app")], check=False, capture_output=True)
    subprocess.run(["xattr", "-dr", "com.apple.FinderInfo", str(ROOT / "tools" / "Audiveris.app")], check=False, capture_output=True)


def command(source: Path, output: Path) -> list[str]:
    return [str(JAVA), "-Xms128m", "-Xmx2G", "--add-exports=java.desktop/sun.awt.image=ALL-UNNAMED", "--enable-native-access=ALL-UNNAMED", "-Dfile.encoding=UTF-8", "-cp", str(APP / "app" / "*"), "Audiveris", "-batch", "-transcribe", "-export", "-output", str(output), "--", str(source)]


class Handler(BaseHTTPRequestHandler):
    def end_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        hostname = urlparse(origin).hostname
        configured_origins = {item.strip() for item in os.getenv("WEB_ORIGINS", "").split(",") if item.strip()}
        if hostname in {"localhost", "127.0.0.1", "::1"} or origin in configured_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def send_json(self, status: int, data: dict[str, str]) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self.send_json(200 if JAVA.exists() else 503, {"status": "ready" if JAVA.exists() else "Audiveris is missing"})
        else:
            self.send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in {"/omr", "/convert"}:
            self.send_json(404, {"error": "Not found"})
            return
        if not JAVA.exists():
            self.send_json(503, {"error": "未找到 tools/Audiveris.app。请恢复本地识谱引擎。"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "无效的上传请求。"})
            return
        if content_length > MAX_BYTES:
            self.send_json(413, {"error": "乐谱文件不能超过 25 MB。"})
            return
        try:
            form = cgi.FieldStorage(fp=self.rfile, headers=self.headers, environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": self.headers.get("Content-Type", "")})
            upload = form["file"] if "file" in form else None
            if isinstance(upload, list):
                upload = upload[0] if upload else None
            if upload is None or getattr(upload, "file", None) is None or not getattr(upload, "filename", None):
                self.send_json(400, {"error": "请选择一个乐谱文件。"})
                return
            suffix = Path(upload.filename).suffix.lower()
            if suffix not in ALLOWED_SUFFIXES:
                self.send_json(415, {"error": "支持 PDF、PNG、JPG 和 JPEG。"})
                return
            WORK.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix="score-", dir=WORK) as temp:
                directory = Path(temp)
                source = directory / f"source{suffix}"
                with source.open("wb") as destination:
                    shutil.copyfileobj(upload.file, destination)
                output = directory / "output"
                output.mkdir()
                result = subprocess.run(command(source, output), cwd=ROOT, capture_output=True, text=True, timeout=240)
                musicxml = next(iter(output.rglob("*.musicxml")), None)
                if result.returncode == 0 and musicxml:
                    self.send_json(200, {
                        "musicXml": musicxml.read_text(encoding="utf-8"),
                        "provider": "Audiveris (source layout)",
                        "mode": "real",
                        "warnings": [],
                    })
                    return
                detail = (result.stderr or result.stdout or "没有生成 MusicXML。")[-1200:]
                self.send_json(422, {"error": "无法从这份乐谱中识别出可用的五线谱。建议使用清晰、正向、至少 300 DPI 的扫描件。", "detail": detail})
        except subprocess.TimeoutExpired:
            self.send_json(504, {"error": "识谱超时，请尝试页数更少或更清晰的文件。"})
        except Exception as error:  # Keep HTTP errors readable instead of dropping the connection.
            self.send_json(500, {"error": "本地识谱服务发生错误。", "detail": str(error)})

    def log_message(self, format: str, *args: object) -> None:
        print(f"[BandProject OMR] {format % args}")


if __name__ == "__main__":
    prepare_runtime()
    print("BandProject OMR service ready at http://127.0.0.1:4318")
    ThreadingHTTPServer(("127.0.0.1", 4318), Handler).serve_forever()
