#!/usr/bin/env python3
"""Build the browser-friendly poetry catalog from the preserved phone notes."""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

from build_editorial import main as build_editorial


ROOT = Path(__file__).resolve().parents[1]
NOTES_DIR = ROOT / "content" / "notes"
DATA_DIR = ROOT / "data"
ARTWORK_FILE = DATA_DIR / "artwork.json"

FULL_DATE_RE = re.compile(
    r"^\s*(?P<year>20\d{2})[./-](?P<month>\d{1,2})[./-](?P<day>\d{1,2})"
)
SHORT_DATE_RE = re.compile(r"^\s*(?P<month>\d{1,2})[./-](?P<day>\d{1,2})(?:\s|$)")
INLINE_YEAR_RE = re.compile(
    r"(?P<day>\d{1,2})\s*/\s*(?P<month>\d{1,2})\s*/\s*(?P<year>20\d{2})"
)
DATE_ONLY_RE = re.compile(
    r"^\s*(?:20\d{2}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]20\d{2})"
    r"(?:\s+\d{1,2}:\d{2})?\s*$"
)
PROMPT_RE = re.compile(
    r"प्रदत्त\s+(?:शब्द|विषय|पंक्ति|चित्र)\s*[_\-:–]*\s*[\"“'‘]*(.*?)[\"”'’#।]*\s*$"
)

METADATA_PREFIXES = (
    "जय मां",
    "जय माँ",
    "नमन ",
    "दिनांक",
    "तिथि",
    "विधा",
    "प्रदत्त",
    "समीक्षार्थ",
    "स्वरचित",
    "मौलिक",
)


# Split a working copy of the source into trimmed lines for parsing.
def normalize_lines(text: str) -> list[str]:
    return [line.strip() for line in text.replace("\r\n", "\n").splitlines()]


# Remove surrounding markup, collapse whitespace, and limit titles to 80 characters.
def clean_title(value: str) -> str:
    value = value.strip().strip("#_*\"'“”‘’:-–। ")
    value = re.sub(r"\s+", " ", value)
    return value[:80]


# Identify dates, attribution, prompt labels, and other non-poem metadata.
def is_metadata(line: str) -> bool:
    compact = line.strip()
    if not compact:
        return False
    if compact.startswith("#"):
        return True
    if DATE_ONLY_RE.match(compact):
        return True
    if compact.startswith(METADATA_PREFIXES):
        return True
    if "साहित्य संगम संस्थान" in compact or "दोहाशाला" in compact:
        return True
    if re.match(r"^\(?(?:स्वरचित|मौलिक)", compact):
        return True
    if "प्रमिला सिंह" in compact and ("*" in compact or len(compact) < 40):
        return True
    return False


# Find a valid date near the start of the record, assuming 2024 for month/day headers.
# Return an ISO date, or None when no supported date can be parsed.
def extract_date(lines: list[str]) -> str | None:
    for line in lines[:12]:
        match = FULL_DATE_RE.match(line)
        if match:
            try:
                return date(
                    int(match["year"]), int(match["month"]), int(match["day"])
                ).isoformat()
            except ValueError:
                pass

        match = INLINE_YEAR_RE.search(line)
        if match:
            try:
                return date(
                    int(match["year"]), int(match["month"]), int(match["day"])
                ).isoformat()
            except ValueError:
                pass

    if lines:
        match = SHORT_DATE_RE.match(lines[0])
        if match:
            try:
                return date(2024, int(match["month"]), int(match["day"])).isoformat()
            except ValueError:
                pass
    return None


# Prefer the provided prompt, then a plausible heading, then a numbered fallback.
# Also return the heading's line index, if found, so it can be omitted from the body.
def extract_title(lines: list[str], fallback_number: int) -> tuple[str, int | None]:
    for line in lines[:14]:
        match = PROMPT_RE.search(line)
        if match and clean_title(match.group(1)):
            title = clean_title(match.group(1))
            for index, candidate in enumerate(lines[:10]):
                if candidate != line and clean_title(candidate) == title:
                    return title, index
            return title, None

    start = 1 if lines and (FULL_DATE_RE.match(lines[0]) or SHORT_DATE_RE.match(lines[0])) else 0
    for index, line in enumerate(lines[start : start + 10], start=start):
        candidate = clean_title(line)
        if not candidate or is_metadata(line):
            continue
        if len(candidate) > 44 or candidate[0].isdigit():
            continue
        if any(mark in candidate for mark in (",", "।", "?", "!", ":", "/")):
            continue
        return candidate, index

    return f"रचना {fallback_number}", None


# Keep poem lines and internal stanza breaks while removing the title, metadata,
# decorative separators, and trailing blank lines.
def extract_body(lines: list[str], title_index: int | None) -> list[str]:
    body: list[str] = []
    for index, line in enumerate(lines):
        compact = line.strip()
        if not compact:
            if body and body[-1]:
                body.append("")
            continue
        if index == title_index:
            continue
        if index == 0 and (FULL_DATE_RE.match(compact) or SHORT_DATE_RE.match(compact)):
            continue
        if is_metadata(compact):
            continue
        if re.fullmatch(r"[*=_\-–—#\s]+", compact):
            continue
        body.append(compact)

    while body and not body[-1]:
        body.pop()
    return body


# Heuristically classify the writing using length, narrative keywords, and punctuation.
def classify(body: list[str]) -> str:
    joined = " ".join(body)
    if len(joined) > 1200 or any(
        word in joined for word in ("संस्मरण", "कहानी", "यात्रा")
    ):
        return "संस्मरण"
    if sum("।" in line for line in body) >= 2:
        return "दोहा"
    return "रचना"


# Parse preserved sources, attach artwork, sort and number entries, and write catalog
# data and statistics before regenerating the editorial drafts.
def main() -> None:
    if not NOTES_DIR.exists():
        raise SystemExit(f"Missing source notes directory: {NOTES_DIR}")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    artwork = {}
    if ARTWORK_FILE.exists():
        artwork = json.loads(ARTWORK_FILE.read_text(encoding="utf-8"))

    poems = []
    for number, path in enumerate(sorted(NOTES_DIR.glob("*.txt")), start=1):
        raw = path.read_text(encoding="utf-8-sig").strip()
        lines = normalize_lines(raw)
        title, title_index = extract_title(lines, number)
        body = extract_body(lines, title_index)
        written_on = extract_date(lines)
        poems.append(
            {
                "id": path.stem,
                "title": title,
                "date": written_on,
                "year": int(written_on[:4]) if written_on else None,
                "type": classify(body),
                "body": body,
                "raw": raw,
                "source": f"content/notes/{path.name}",
                "artwork": artwork.get(path.stem),
            }
        )

    poems.sort(key=lambda poem: (poem["date"] or "9999-12-31", poem["id"]))
    for index, poem in enumerate(poems, start=1):
        poem["number"] = index

    years = sorted({poem["year"] for poem in poems if poem["year"]}, reverse=True)
    stats = {
        "total": len(poems),
        "years": years,
        "withArtwork": sum(bool(poem["artwork"]) for poem in poems),
        "types": {
            kind: sum(poem["type"] == kind for poem in poems)
            for kind in sorted({poem["type"] for poem in poems})
        },
    }

    (DATA_DIR / "poems.json").write_text(
        json.dumps(poems, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (DATA_DIR / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Built {len(poems)} entries across {len(years)} years.")
    build_editorial()


if __name__ == "__main__":
    main()
