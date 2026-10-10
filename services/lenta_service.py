"""Клипы для видеоленты на главной из static/videos/lenta."""

from __future__ import annotations

from pathlib import Path

from core.config import settings

LENTA_DIRNAME = "lenta"
VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v"}

# Фиксированный порядок ленты (перемешан один раз).
CLIP_ORDER = (
    "otr_uchen5",
    "otr_uchen2",
    "otr_uchen6",
    "otr_uchen1",
    "otr_uchen4",
    "otr_uchen3",
)


def _lenta_dir() -> Path:
    return Path(settings.BASE_DIR) / "static" / "videos" / LENTA_DIRNAME


def _clip_item(directory: Path, stem: str, video_name: str) -> dict[str, str] | None:
    video = directory / video_name
    if not video.is_file():
        return None
    item = {"src": f"/static/videos/{LENTA_DIRNAME}/{video_name}"}
    poster = directory / f"{stem}_poster.jpg"
    if poster.is_file():
        item["poster"] = f"/static/videos/{LENTA_DIRNAME}/{poster.name}"
    return item


def list_lenta_clips() -> list[dict[str, str]]:
    """
    Возвращает клипы для hero-ленты в фиксированном порядке.
    Предпочитает лёгкие *_tape.mp4 + *_poster.jpg;
    если tape нет — берёт исходный файл из папки.
    """
    directory = _lenta_dir()
    if not directory.is_dir():
        return []

    clips: list[dict[str, str]] = []
    used_stems: set[str] = set()

    for stem in CLIP_ORDER:
        item = _clip_item(directory, stem, f"{stem}_tape.mp4")
        if item is None:
            # Fallback на исходник, если tape ещё не сгенерирован
            for ext in VIDEO_EXTS:
                item = _clip_item(directory, stem, f"{stem}{ext}")
                if item is not None:
                    break
        if item is not None:
            clips.append(item)
            used_stems.add(stem)

    # Новые файлы, которых нет в CLIP_ORDER — в конец
    for tape in sorted(directory.glob("*_tape.mp4")):
        stem = tape.name[: -len("_tape.mp4")]
        if stem in used_stems:
            continue
        item = _clip_item(directory, stem, tape.name)
        if item is not None:
            clips.append(item)
            used_stems.add(stem)

    for path in sorted(directory.iterdir()):
        if not path.is_file():
            continue
        if path.suffix.lower() not in VIDEO_EXTS:
            continue
        if path.name.endswith("_tape.mp4"):
            continue
        stem = path.stem
        if stem in used_stems:
            continue
        item = _clip_item(directory, stem, f"{stem}_tape.mp4") or _clip_item(
            directory, stem, path.name
        )
        if item is not None:
            clips.append(item)
            used_stems.add(stem)

    return clips
