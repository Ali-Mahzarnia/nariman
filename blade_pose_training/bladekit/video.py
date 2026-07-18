"""H.264 video output.

`cv2.VideoWriter` with the mp4v fourcc emits MPEG-4 Part 2, which QuickTime and browsers
refuse to play inline -- which is why every v1 result needed a manual transcode afterwards.
When ffmpeg is present we pipe raw frames to it and get H.264 directly.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

def find_ffmpeg() -> str | None:
    return shutil.which("ffmpeg")


class VideoSink:
    def __init__(self, path: Path, fps: float, size: tuple[int, int], crf: int = 20) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        w, h = size
        self.ffmpeg = find_ffmpeg()
        self.proc: subprocess.Popen | None = None
        self.writer: cv2.VideoWriter | None = None

        if self.ffmpeg:
            self.proc = subprocess.Popen(
                [self.ffmpeg, "-y", "-loglevel", "error",
                 "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", f"{fps:.4f}",
                 "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", str(crf),
                 "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(path)],
                stdin=subprocess.PIPE,
            )
        else:
            self.writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
            if not self.writer.isOpened():
                raise SystemExit(f"Could not open video writer: {path}")

    @property
    def codec(self) -> str:
        return "h264 (ffmpeg)" if self.proc else "mp4v (opencv fallback)"

    def write(self, frame: np.ndarray) -> None:
        if self.proc and self.proc.stdin:
            self.proc.stdin.write(frame.astype(np.uint8).tobytes())
        elif self.writer:
            self.writer.write(frame)

    def close(self) -> None:
        if self.proc and self.proc.stdin:
            self.proc.stdin.close()
            self.proc.wait()
        if self.writer:
            self.writer.release()
