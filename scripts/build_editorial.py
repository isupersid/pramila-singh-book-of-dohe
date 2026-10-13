#!/usr/bin/env python3
"""Build review-safe editorial drafts without modifying preserved writings."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
POEMS_FILE = ROOT / "data" / "poems.json"
OVERRIDES_FILE = ROOT / "data" / "editorial_overrides.json"
EDITORIAL_FILE = ROOT / "data" / "editorial.json"

PROMPT_RE = re.compile(
    r"प्रद(?:त्त|त)\s*(?:शब्द|विषय|पंक्ति|चित्र)\s*[_\-:–]*\s*"
    r"[\"“'‘]*(.*?)[\"”'’#।]*\s*$"
)
DEVANAGARI_RE = re.compile(r"[\u0900-\u097f]+")

VOWELS = {
    "अ": "a",
    "आ": "aa",
    "इ": "i",
    "ई": "ee",
    "उ": "u",
    "ऊ": "oo",
    "ऋ": "ri",
    "ए": "e",
    "ऐ": "ai",
    "ओ": "o",
    "औ": "au",
}
VOWEL_SIGNS = {
    "ा": "aa",
    "ि": "i",
    "ी": "ee",
    "ु": "u",
    "ू": "oo",
    "ृ": "ri",
    "े": "e",
    "ै": "ai",
    "ो": "o",
    "ौ": "au",
    "ॅ": "e",
    "ॉ": "o",
}
CONSONANTS = {
    "क": "k",
    "ख": "kh",
    "ग": "g",
    "घ": "gh",
    "ङ": "ng",
    "च": "ch",
    "छ": "chh",
    "ज": "j",
    "झ": "jh",
    "ञ": "ny",
    "ट": "t",
    "ठ": "th",
    "ड": "d",
    "ढ": "dh",
    "ण": "n",
    "त": "t",
    "थ": "th",
    "द": "d",
    "ध": "dh",
    "न": "n",
    "प": "p",
    "फ": "ph",
    "ब": "b",
    "भ": "bh",
    "म": "m",
    "य": "y",
    "र": "r",
    "ल": "l",
    "व": "v",
    "श": "sh",
    "ष": "sh",
    "स": "s",
    "ह": "h",
    "क़": "q",
    "ख़": "kh",
    "ग़": "gh",
    "ज़": "z",
    "ड़": "r",
    "ढ़": "rh",
    "फ़": "f",
}
MARKS = {
    "ं": "n",
    "ँ": "n",
    "ः": "h",
    "ऽ": "'",
    "़": "",
    "्": "",
    "।": ".",
    "॥": ".",
}

# Common whole-word forms avoid the most distracting inherent-schwa errors.
WORD_ROMAN = {
    "अपने": "apne",
    "अपना": "apna",
    "अपनी": "apni",
    "सभी": "sabhi",
    "को": "ko",
    "से": "se",
    "में": "mein",
    "पे": "pe",
    "पर": "par",
    "है": "hai",
    "हैं": "hain",
    "हो": "ho",
    "हुआ": "hua",
    "हुई": "hui",
    "हुए": "hue",
    "कर": "kar",
    "करो": "karo",
    "करके": "karke",
    "करता": "karta",
    "करती": "karti",
    "करते": "karte",
    "जो": "jo",
    "जब": "jab",
    "कभी": "kabhi",
    "नहीं": "nahin",
    "जीवन": "jeevan",
    "प्रभु": "prabhu",
    "याद": "yaad",
    "भाव": "bhaav",
    "सुन": "sun",
    "लेते": "lete",
    "फरियाद": "fariyaad",
    "चांद": "chaand",
    "चाँद": "chaand",
    "लूं": "loon",
    "ढूंढे": "dhoondhen",
    "शिव": "Shiv",
    "भक्ति": "bhakti",
    "रोहिणी": "Rohini",
    "प्रिय": "priya",
    "प्राण": "praan",
    "प्रान": "praan",
    "श्रद्धा": "Shraddha",
    "भूली": "bhooli",
    "प्रेम": "prem",
    "परिजन": "parijan",
    "सम्मान": "sammaan",
    "पैंतीस": "paintees",
    "टुकड़े": "tukde",
    "व्यर्थ": "vyarth",
    "गंवाए": "ganvaaye",
    "मस्तक": "mastak",
    "बैठके": "baithkar",
    "शशांक": "Shashank",
    "महान": "mahaan",
    "जग": "jag",
    "ब्रह्मा": "Brahma",
    "विष्णु": "Vishnu",
    "महेश": "Mahesh",
    "इनका": "inka",
    "पूजन": "poojan",
    "पावे": "paave",
    "क्लेश": "klesh",
    "पर्यावरण": "paryaavaran",
    "बिगाड़": "bigaad",
    "रुग्ण": "rugna",
    "रूग्ण": "rugna",
    "लोग": "log",
    "प्रकृति": "prakriti",
    "सही": "sahi",
    "उपभोग": "upbhog",
    "भारत": "Bharat",
    "मोदी": "Modi",
    "विश्व": "vishva",
    "योग": "yog",
    "दिवस": "divas",
    "पहचान": "pehchaan",
    "मोबाइल": "mobile",
    "रिश्ते": "rishte",
    "नाते": "naate",
    "महत्व": "mahatva",
    "महत्त्व": "mahatva",
    "संविधान": "samvidhaan",
    "जनता": "janata",
    "अधिकार": "adhikaar",
    "राष्ट्र": "raashtra",
    "सरकार": "sarkaar",
    "समान": "samaan",
    "जातियों": "jaatiyon",
    "विधान": "vidhaan",
    "चंद्रयान": "Chandrayaan",
    "सफलता": "safalta",
    "दक्षिण": "dakshin",
    "विश्व": "vishva",
    "कप": "cup",
    "मैच": "match",
    "भारत-पाकिस्तान": "Bharat-Pakistan",
}


def transliterate_word(word: str) -> str:
    if word in WORD_ROMAN:
        return WORD_ROMAN[word]
    output: list[str] = []
    index = 0
    while index < len(word):
        char = word[index]
        if char in VOWELS:
            output.append(VOWELS[char])
        elif char in CONSONANTS:
            consonant = CONSONANTS[char]
            next_char = word[index + 1] if index + 1 < len(word) else ""
            if next_char == "्":
                output.append(consonant)
                index += 1
            elif next_char in VOWEL_SIGNS:
                output.append(consonant + VOWEL_SIGNS[next_char])
                index += 1
            else:
                output.append(consonant + "a")
        elif char in VOWEL_SIGNS:
            output.append(VOWEL_SIGNS[char])
        elif char in MARKS:
            output.append(MARKS[char])
        else:
            output.append(char)
        index += 1
    return re.sub(r"a(?=\b)", "", "".join(output))


def transliterate(text: str) -> str:
    cleaned = text.replace("\u200c", "").replace("\u200d", "")
    return DEVANAGARI_RE.sub(lambda match: transliterate_word(match.group(0)), cleaned)


def extract_prompt(raw: str) -> str | None:
    for line in raw.splitlines():
        match = PROMPT_RE.search(line.strip())
        if match:
            prompt = match.group(1).strip().strip("#_*\"'“”‘’:-–। ")
            if prompt:
                return prompt
    return None


def evidence_for(poem: dict, prompt: str | None) -> list[dict]:
    evidence = [
        {
            "type": "source-date",
            "value": poem["date"],
            "source": poem["source"],
        }
    ]
    if prompt:
        evidence.append(
            {
                "type": "provided-prompt",
                "value": prompt,
                "source": poem["source"],
            }
        )
    return evidence


def default_context(poem: dict, prompt: str | None) -> dict:
    if prompt:
        text = (
            f'The preserved record is dated {poem["date"]} and identifies '
            f'“{prompt}” as the provided prompt. No more specific historical or '
            "authorial context is asserted without family review."
        )
    else:
        text = (
            f'The preserved record is dated {poem["date"]}. No मंच prompt or '
            "specific external event has been identified confidently enough to "
            "add further context."
        )
    return {
        "text": text,
        "theme": "unclassified",
        "confidence": "low",
        "evidence": evidence_for(poem, prompt),
        "editorialNote": (
            "This context is limited to evidence in the preserved record and is "
            "not presented as confirmed authorial intent."
        ),
    }


def text_layer(text: str, confidence: str, note: str) -> dict:
    return {
        "text": text,
        "confidence": confidence,
        "editorialNote": note,
    }


def build_record(poem: dict, override: dict | None) -> dict:
    prompt = extract_prompt(poem["raw"])
    flags = ["ai-generated-draft", "family-review-required"]
    if poem["type"] != "दोहा" or len(poem["body"]) > 4:
        flags.append("long-form-review-required")

    literal = None
    child = None
    simple = None
    context = default_context(poem, prompt)
    if override:
        literal = {
            "lines": override["literalEnglish"],
            "method": "curated-draft",
            "confidence": override["confidence"],
            "editorialNote": (
                "Readable editorial draft preserving the source line structure; "
                "family and bilingual review are still required."
            ),
        }
        child = text_layer(
            override["childFriendlyEnglish"],
            override["confidence"],
            "Poem-specific editorial draft; not confirmed authorial intent.",
        )
        simple = text_layer(
            override["simpleHindiExplanation"],
            override["confidence"],
            "यह रचना-विशिष्ट संपादकीय प्रारूप है; पारिवारिक समीक्षा अभी शेष है।",
        )
        context = {
            "text": override["context"],
            "theme": override["theme"],
            "confidence": override["contextConfidence"],
            "evidence": evidence_for(poem, prompt),
            "editorialNote": (
                "The contextual identification is a cautious editorial inference "
                "from the preserved date, prompt, and wording."
            ),
        }
    else:
        flags.extend(["needs-human-translation", "needs-specific-explanation"])

    return {
        "noteId": poem["id"],
        "status": "draft",
        "review": {
            "familyReviewed": False,
            "reviewedBy": None,
            "reviewedAt": None,
        },
        "source": {
            "path": poem["source"],
            "date": poem["date"],
            "prompt": prompt,
            "sha256": hashlib.sha256(poem["raw"].encode("utf-8")).hexdigest(),
        },
        "romanTransliteration": {
            "lines": [transliterate(line) for line in poem["body"]],
            "method": "deterministic-machine-transliteration",
            "confidence": "medium",
        },
        "literalEnglish": literal,
        "childFriendlyEnglish": child,
        "simpleHindiExplanation": simple,
        "context": context,
        "flags": flags,
    }


def validate_override(poem: dict, override: dict) -> None:
    if len(override["literalEnglish"]) != len(poem["body"]):
        raise ValueError(
            f"{poem['id']}: literal English lines must match source line count"
        )
    for key in ("childFriendlyEnglish", "simpleHindiExplanation", "context"):
        if not override[key].strip():
            raise ValueError(f"{poem['id']}: empty curated field {key}")


def main() -> None:
    poems = json.loads(POEMS_FILE.read_text(encoding="utf-8"))
    overrides = json.loads(OVERRIDES_FILE.read_text(encoding="utf-8"))
    poems_by_id = {poem["id"]: poem for poem in poems}
    unknown_ids = sorted(set(overrides) - set(poems_by_id))
    if unknown_ids:
        raise ValueError(f"Editorial overrides reference unknown notes: {unknown_ids}")

    for note_id, override in overrides.items():
        validate_override(poems_by_id[note_id], override)

    records = {
        poem["id"]: build_record(poem, overrides.get(poem["id"])) for poem in poems
    }
    payload = {
        "schemaVersion": 2,
        "status": "draft",
        "notice": (
            "Every record remains an unreviewed editorial draft. Translation and "
            "explanation layers are null and hidden unless a readable poem-specific "
            "draft has been curated; such records carry needs-human-translation."
        ),
        "records": records,
    }
    EDITORIAL_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Built {len(records)} editorial records "
        f"({len(overrides)} curated, {len(records) - len(overrides)} flagged)."
    )


if __name__ == "__main__":
    main()
