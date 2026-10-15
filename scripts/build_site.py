#!/usr/bin/env python3
"""Build the deployable static site with web-optimized artwork copies."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
SITE_DIR = ROOT / "_site"
ROOT_FILES = (
    "index.html",
    "collection.html",
    "app.js",
    "styles.css",
    "favicon.svg",
)
MAX_ARTWORK_SIZE = (1400, 1900)
JPEG_QUALITY = 82


def copy_tree(name: str) -> None:
    source = ROOT / name
    if source.exists():
        shutil.copytree(source, SITE_DIR / name)


def optimize_artwork(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    suffix = source.suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png"}:
        shutil.copy2(source, destination)
        return

    with Image.open(source) as image:
        image = ImageOps.exif_transpose(image)
        image.thumbnail(MAX_ARTWORK_SIZE, Image.Resampling.LANCZOS)
        if suffix in {".jpg", ".jpeg"}:
            image.convert("RGB").save(
                destination,
                "JPEG",
                quality=JPEG_QUALITY,
                optimize=True,
                progressive=True,
            )
        else:
            image.save(destination, "PNG", optimize=True)


def main() -> None:
    if SITE_DIR.exists():
        shutil.rmtree(SITE_DIR)
    SITE_DIR.mkdir()

    for filename in ROOT_FILES:
        shutil.copy2(ROOT / filename, SITE_DIR / filename)
    copy_tree("data")
    copy_tree("images")

    artwork = json.loads(
        (ROOT / "data" / "artwork.json").read_text(encoding="utf-8")
    )
    paths = sorted(set(artwork.values()))
    for relative in paths:
        source = ROOT / relative
        if not source.is_file():
            raise FileNotFoundError(f"Mapped artwork does not exist: {relative}")
        optimize_artwork(source, SITE_DIR / relative)

    native_bytes = sum((ROOT / relative).stat().st_size for relative in paths)
    deployed_bytes = sum((SITE_DIR / relative).stat().st_size for relative in paths)
    print(
        f"Built _site with {len(paths)} artwork files: "
        f"{native_bytes / 1024 / 1024:.1f} MB native -> "
        f"{deployed_bytes / 1024 / 1024:.1f} MB deployed."
    )


if __name__ == "__main__":
    main()
