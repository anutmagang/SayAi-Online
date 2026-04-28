from __future__ import annotations

import logging
import tempfile
import urllib.request
from pathlib import Path

import cv2

log = logging.getLogger(__name__)

_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"
_model_path: str | None = None


def _ensure_model() -> str:
    """Download the BlazeFace model once to a temp file and cache the path."""
    global _model_path
    if _model_path and Path(_model_path).exists():
        return _model_path
    dst = Path(tempfile.gettempdir()) / "blaze_face_short_range.tflite"
    if not dst.exists():
        log.info("downloading face detection model …")
        urllib.request.urlretrieve(_MODEL_URL, str(dst))
    _model_path = str(dst)
    return _model_path


def _even(n: int) -> int:
    return max(2, n - (n % 2))


def detect_face_center_normalized(video_path: Path) -> tuple[float, float]:
    """
    Sample a few frames, run MediaPipe Face Detection, return average face center
    in normalized coordinates (0–1). Falls back to (0.5, 0.5) if no face.
    """
    try:
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions
        from mediapipe.tasks.python.vision import (
            FaceDetector,
            FaceDetectorOptions,
            RunningMode,
        )
    except (ImportError, AttributeError) as exc:
        log.warning("mediapipe face detection unavailable (%s), defaulting to center crop", exc)
        return 0.5, 0.5

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return 0.5, 0.5

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
    n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = n_frames / fps if fps > 0 else 0.0

    times = [0.0]
    if duration > 0.4:
        times.append(duration * 0.5)
    if duration > 0.8:
        times.append(max(0.0, duration - 0.25))

    centers: list[tuple[float, float]] = []

    try:
        model_path = _ensure_model()
        options = FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            running_mode=RunningMode.IMAGE,
            min_detection_confidence=0.4,
        )
        with FaceDetector.create_from_options(options) as detector:
            for t in times:
                cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000.0)
                ok, frame = cap.read()
                if not ok or frame is None:
                    continue
                h, w = frame.shape[:2]
                if w < 2 or h < 2:
                    continue
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = detector.detect(mp_image)
                if not result.detections:
                    continue
                best = max(
                    result.detections,
                    key=lambda d: d.categories[0].score if d.categories else 0.0,
                )
                bbox = best.bounding_box
                cx = (bbox.origin_x + bbox.width / 2.0) / w
                cy = (bbox.origin_y + bbox.height / 2.0) / h
                centers.append((cx, cy))
    except Exception as exc:
        log.warning("face detection failed (%s), defaulting to center crop", exc)
    finally:
        cap.release()

    if not centers:
        return 0.5, 0.5

    nx = sum(c[0] for c in centers) / len(centers)
    ny = sum(c[1] for c in centers) / len(centers)
    return max(0.0, min(1.0, nx)), max(0.0, min(1.0, ny))


def compute_vertical_crop(
    width: int,
    height: int,
    nx: float,
    ny: float,
) -> tuple[int, int, int, int]:
    """
    Return (crop_w, crop_h, crop_x, crop_y) for a 9:16 window aligned with (nx, ny).
    """
    target_ar = 9.0 / 16.0
    ar = width / max(1, height)
    fx = nx * width
    fy = ny * height

    if ar > target_ar:
        crop_h = height
        crop_w = int(round(height * target_ar))
        crop_w = _even(min(max(crop_w, 2), width))
        crop_h = _even(crop_h)
        crop_x = int(round(fx - crop_w / 2.0))
        crop_x = max(0, min(crop_x, width - crop_w))
        crop_y = 0
    else:
        crop_w = width
        crop_h = int(round(width / target_ar))
        crop_h = _even(min(max(crop_h, 2), height))
        crop_w = _even(crop_w)
        crop_x = 0
        crop_y = int(round(fy - crop_h / 2.0))
        crop_y = max(0, min(crop_y, height - crop_h))

    crop_w = _even(min(crop_w, width - crop_x))
    crop_h = _even(min(crop_h, height - crop_y))
    crop_x = max(0, min(crop_x, width - crop_w))
    crop_y = max(0, min(crop_y, height - crop_h))
    return crop_w, crop_h, crop_x, crop_y
