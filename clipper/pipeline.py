from __future__ import annotations

import json
import re
import shutil
import uuid
from pathlib import Path

from clipper.analyze import AnalyzeOutput, clamp_clips, suggest_clips
from clipper.binaries import require_ffmpeg, require_yt_dlp
from clipper.config import Settings, load_settings
from clipper.cut import render_clip
from clipper.download import download_video
from clipper.events import emit
from clipper.media import ffprobe_duration_seconds
from clipper.phase3_ass import words_for_clip
from clipper.phase3_render import apply_longform_horizontal, apply_vertical_and_captions
from clipper.transcribe import segments_to_prompt_block, transcribe_audio
from clipper.viral_score import viral_score_for_clip

_JOB_ID_RE = re.compile(
    r"^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", re.I
)


def _job_dir_name(job_id: str | None) -> str:
    if job_id is None:
        return uuid.uuid4().hex[:12]
    jid = job_id.strip()
    if not _JOB_ID_RE.match(jid):
        raise ValueError("job_id must be a lowercase UUID string")
    return jid.lower()


def run_pipeline(
    *,
    url: str | None = None,
    input_file: Path | None = None,
    output_root: Path | None = None,
    settings: Settings | None = None,
    job_id: str | None = None,
) -> Path:
    """Full clipper flow. Returns the job directory with clips + metadata."""
    if (url is None) == (input_file is None):
        raise ValueError("Provide exactly one of url= or input_file=")
    if url is not None and not url.strip():
        raise ValueError("url must be non-empty")

    settings = settings or load_settings()
    require_ffmpeg()
    if url is not None:
        require_yt_dlp()

    root = output_root or Path("output")
    job_dir = root / _job_dir_name(job_id)
    job_dir.mkdir(parents=True, exist_ok=True)

    if url is not None:
        u = url.strip().lower()
        if "youtube.com" in u or "youtu.be" in u:
            emit(
                settings,
                phase="downloading",
                message="Menyiapkan unduhan YouTube (yt-dlp — bisa beberapa menit; progres diperbarui berkala)",
                progress=5,
            )
        else:
            emit(settings, phase="downloading", message="Mengambil sumber video dari URL", progress=5)
    else:
        emit(settings, phase="downloading", message="Mengambil sumber video (file upload)", progress=5)

    if url is not None:
        source = download_video(url.strip(), job_dir, settings)
        source_label = url.strip()
    else:
        assert input_file is not None
        src = input_file.expanduser().resolve()
        if not src.is_file():
            raise FileNotFoundError(f"Input file not found: {src}")
        job_resolved = job_dir.resolve()
        if src.parent == job_resolved and src.name.lower().startswith("source"):
            source = src
        else:
            suffix = src.suffix.lower() if src.suffix else ".mp4"
            dest = job_resolved / f"source{suffix}"
            shutil.copy2(src, dest)
            source = dest
        source_label = f"file:{src.name}"

    emit(settings, phase="probing", message="Membaca metadata video", progress=15)
    duration = ffprobe_duration_seconds(source)

    if duration > settings.max_source_duration_sec:
        hrs = settings.max_source_duration_sec / 3600
        raise RuntimeError(
            f"Durasi video {duration / 60:.1f} menit melebihi batas tier "
            f"{settings.user_tier} ({hrs:.1f} jam). Upgrade atau potong dulu sumbernya."
        )

    emit(
        settings,
        phase="transcribing",
        message="Transkrip audio (word-by-word)",
        progress=25,
    )
    segments, words, _seg_path, _words_path, transcribe_provider = transcribe_audio(
        source,
        settings.whisper_model_size,
        job_dir,
        prefer_groq=settings.prefer_groq_whisper,
        groq_model=settings.groq_whisper_model,
    )

    emit(
        settings,
        phase="analyzing",
        message=f"AI memilih klip (tier={settings.user_tier})",
        progress=55,
    )
    block = segments_to_prompt_block(segments)
    analyze: AnalyzeOutput = suggest_clips(settings, block, duration)

    clips = clamp_clips(
        analyze.clips,
        duration,
        settings.clip_min_duration,
        settings.clip_max_duration,
    )
    if not clips:
        raise RuntimeError("Analyze returned no usable clip windows after clamp/dedupe.")

    clips_dir = job_dir / "clips"
    clip_metas: list[dict] = []
    total = len(clips)
    wm_text = bool((settings.watermark_text or "").strip())
    # Watermark drawtext hanya jika ada teks: Free = Fai-Clipper wajib; berbayar = teks kustom bila diaktifkan.
    wm_burned_in_video = wm_text

    for i, clip in enumerate(clips):
        frac = (i / max(1, total)) * 40.0
        emit(
            settings,
            phase="rendering",
            message=f"Render klip {i + 1}/{total}",
            progress=60 + frac,
        )
        render_clip(source, clip, i, clips_dir)
        clip_path = clips_dir / f"clip_{i:02d}.mp4"
        if settings.output_layout == "short_vertical" and settings.phase3_vertical:
            apply_vertical_and_captions(
                clip_path,
                clip.start_sec,
                clip.end_sec,
                words,
                settings.vertical_width,
                settings.vertical_height,
                watermark_text=settings.watermark_text,
                watermark_position=settings.watermark_position,
                burn_captions=False,
            )
        elif settings.output_layout == "long_horizontal":
            apply_longform_horizontal(
                clip_path,
                watermark_text=settings.watermark_text,
                watermark_position=settings.watermark_position,
            )
        # Kepadatan bicara di jendela klip (bukan subtitle terbakar) — dipakai skor viral.
        wc = len(words_for_clip(words, clip.start_sec, clip.end_sec))
        vscore = viral_score_for_clip(
            clip.start_sec,
            clip.end_sec,
            clip.label or "",
            wc,
            post_caption=clip.post_caption,
            hashtags=clip.hashtags,
        )
        clip_metas.append(
            {
                "start_sec": clip.start_sec,
                "end_sec": clip.end_sec,
                "label": clip.label,
                "post_caption": clip.post_caption or "",
                "hashtags": clip.hashtags or "",
                "vertical_9_16": bool(
                    settings.output_layout == "short_vertical" and settings.phase3_vertical
                ),
                "output_layout": settings.output_layout,
                "output_px": (
                    [settings.vertical_width, settings.vertical_height]
                    if settings.output_layout == "short_vertical" and settings.phase3_vertical
                    else ([1920, 1080] if settings.output_layout == "long_horizontal" else None)
                ),
                "caption_word_count": wc,
                "viral_score": vscore,
                "watermarked": wm_burned_in_video,
            }
        )

    meta = {
        "clips_requested": settings.max_clips,
        "clips_delivered": len(clip_metas),
        "viral_score_target_min": 85,
        "source_url": source_label,
        "source_file": source.name,
        "duration_sec": duration,
        "user_tier": settings.user_tier,
        "llm_provider_used": analyze.provider,
        "llm_model_used": analyze.model,
        "transcribe_provider_used": transcribe_provider,
        "phase4": {
            "viral_model": "heuristic_v1_social",
            "viral_score_range": [0, 100],
        },
        "phase3": {
            "output_layout": settings.output_layout,
            "vertical_enabled": bool(
                settings.output_layout == "short_vertical" and settings.phase3_vertical
            ),
            "vertical_px": (
                [settings.vertical_width, settings.vertical_height]
                if settings.output_layout == "short_vertical" and settings.phase3_vertical
                else None
            ),
            "horizontal_px": [1920, 1080]
            if settings.output_layout == "long_horizontal"
            else None,
            "burn_captions": False,
            "word_timestamps": False,
            "watermark_text": settings.watermark_text if wm_burned_in_video else "",
        },
        "clips": clip_metas,
    }
    (job_dir / "clips.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    emit(settings, phase="uploading", message="Siap diupload", progress=100)
    return job_dir
