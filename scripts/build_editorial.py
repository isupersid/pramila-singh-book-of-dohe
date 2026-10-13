#!/usr/bin/env python3
"""Build conservative draft editorial records without changing source writings."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
POEMS_FILE = ROOT / "data" / "poems.json"
EDITORIAL_FILE = ROOT / "data" / "editorial.json"

PROMPT_RE = re.compile(
    r"प्रदत्त\s+(?:शब्द|विषय|पंक्ति|चित्र)\s*[_\-:–]*\s*[\"“'‘]*(.*?)[\"”'’#।]*\s*$"
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

GLOSSARY = {
    "अच्छा": "good",
    "अच्छे": "good",
    "अंधकार": "darkness",
    "अंबर": "sky",
    "अमृत": "nectar",
    "अपने": "one's own",
    "अपना": "one's own",
    "अपनी": "one's own",
    "आज": "today",
    "आशा": "hope",
    "आशीष": "blessing",
    "आंख": "eye",
    "आँख": "eye",
    "आँखें": "eyes",
    "आए": "comes",
    "आया": "came",
    "आयी": "came",
    "आये": "came",
    "इंसान": "person",
    "ईश्वर": "God",
    "उजाला": "light",
    "उसका": "their",
    "उसकी": "their",
    "उसके": "their",
    "एक": "one",
    "और": "and",
    "औरों": "others",
    "कभी": "ever",
    "कम": "less",
    "कर": "do",
    "करके": "by doing",
    "करता": "does",
    "करती": "does",
    "करते": "do",
    "करना": "to do",
    "करनी": "to do",
    "करो": "do",
    "कर्म": "deeds",
    "कल": "tomorrow",
    "कष्ट": "hardship",
    "कहते": "say",
    "कहे": "says",
    "कौन": "who",
    "क्या": "what",
    "क्रोध": "anger",
    "खुश": "happy",
    "खुशी": "happiness",
    "गंगा": "the Ganga",
    "गुरु": "teacher",
    "घर": "home",
    "चरण": "feet",
    "चांद": "moon",
    "चाँद": "moon",
    "जब": "when",
    "जग": "world",
    "जल": "water",
    "जीत": "victory",
    "जीवन": "life",
    "ज्ञान": "knowledge",
    "तन": "body",
    "तब": "then",
    "तक": "until",
    "तुम": "you",
    "तेरा": "your",
    "तेरी": "your",
    "तेरे": "your",
    "त्याग": "sacrifice",
    "दया": "compassion",
    "दिल": "heart",
    "दिन": "day",
    "दुख": "sorrow",
    "दुःख": "sorrow",
    "दुनिया": "world",
    "देश": "country",
    "देव": "deity",
    "देवी": "goddess",
    "दो": "two",
    "दोनों": "both",
    "धन": "wealth",
    "धर्म": "duty and faith",
    "धरती": "earth",
    "धूप": "sunlight",
    "न": "not",
    "नदी": "river",
    "नमन": "salutation",
    "नाम": "name",
    "नारी": "woman",
    "नहीं": "not",
    "नया": "new",
    "नई": "new",
    "ने": "did",
    "पथ": "path",
    "पर": "on",
    "परिवार": "family",
    "पानी": "water",
    "पाप": "wrongdoing",
    "पास": "near",
    "पिता": "father",
    "पुण्य": "virtue",
    "पुत्र": "son",
    "पृथ्वी": "earth",
    "पे": "on",
    "प्यार": "love",
    "प्रभु": "the Divine",
    "प्रकृति": "nature",
    "प्रेम": "love",
    "फल": "fruit",
    "बच्चे": "children",
    "बड़ा": "great",
    "बड़ी": "great",
    "बन": "become",
    "बना": "made",
    "बनता": "becomes",
    "बनती": "becomes",
    "बनो": "become",
    "बिन": "without",
    "बिना": "without",
    "बुरा": "bad",
    "बुरे": "bad",
    "बेटा": "son",
    "बेटी": "daughter",
    "बोल": "words",
    "भक्ति": "devotion",
    "भगवान": "God",
    "भला": "good",
    "भारत": "India",
    "भाव": "feeling",
    "भूल": "mistake",
    "मन": "mind",
    "माता": "mother",
    "माँ": "mother",
    "मां": "mother",
    "मान": "honour",
    "मानव": "human",
    "मित्र": "friend",
    "मिल": "meet",
    "मिले": "receives",
    "मिलता": "is received",
    "मिलती": "is received",
    "मीठे": "sweet",
    "मृत्यु": "death",
    "मोबाइल": "mobile phone",
    "मोक्ष": "liberation",
    "यही": "this alone",
    "यदि": "if",
    "यश": "honour",
    "रख": "keep",
    "रखा": "kept",
    "रखना": "to keep",
    "रखो": "keep",
    "राम": "Rama",
    "रावण": "Ravana",
    "रिश्ते": "relationships",
    "रूप": "form",
    "रहे": "remain",
    "रहें": "remain",
    "रहता": "remains",
    "रहती": "remains",
    "लोग": "people",
    "वचन": "promise",
    "वाणी": "speech",
    "विष्णु": "Vishnu",
    "वृक्ष": "tree",
    "व्योम": "sky",
    "शक्ति": "strength",
    "शब्द": "word",
    "शिक्षा": "education",
    "शिव": "Shiva",
    "श्री": "revered",
    "संसार": "world",
    "सदा": "always",
    "सभी": "everyone",
    "सब": "all",
    "सबको": "everyone",
    "समय": "time",
    "सम्मान": "respect",
    "सत्य": "truth",
    "साथ": "together",
    "सुख": "happiness",
    "सुंदर": "beautiful",
    "सूरज": "sun",
    "सूर्य": "sun",
    "से": "from",
    "सेवा": "service",
    "सोच": "thought",
    "है": "is",
    "हैं": "are",
    "हम": "we",
    "हमारा": "our",
    "हमारी": "our",
    "हमें": "us",
    "हर": "every",
    "हाथ": "hand",
    "हुआ": "became",
    "हुई": "became",
    "हुए": "became",
    "होगा": "will be",
    "होती": "is",
    "होते": "are",
    "हो": "be",
}

THEMES = [
    {
        "id": "technology",
        "keywords": ("मोबाइल", "इंटरनेट", "ऑनलाइन", "कंप्यूटर", "तकनीक", "ए आई", "एआई"),
        "english": "technology and its effect on everyday choices",
        "child": "Technology can help us, but we should use it thoughtfully and not let it control our habits.",
        "hindi": "रचना तकनीक के लाभ और उसके समझदारी भरे उपयोग की ओर ध्यान दिलाती है।",
        "context": "The wording appears to respond to changing digital habits or technology in public life.",
    },
    {
        "id": "environment",
        "keywords": ("पर्यावरण", "प्रकृति", "प्रदूषण", "वृक्ष", "पेड़", "जल", "धरती", "नदी"),
        "english": "care for nature, water, and the environment",
        "child": "We should care for the earth, use its gifts wisely, and avoid causing harm.",
        "hindi": "रचना प्रकृति, जल और पर्यावरण की रक्षा तथा संतुलित उपयोग का संदेश देती है।",
        "context": "The imagery appears to connect an ethical lesson with environmental responsibility.",
    },
    {
        "id": "devotion",
        "keywords": ("प्रभु", "ईश्वर", "भगवान", "भक्ति", "पूजन", "शिव", "राम", "कृष्ण", "मां दुर्गा", "माँ दुर्गा"),
        "english": "faith, devotion, and trust in the Divine",
        "child": "Faith can give courage and calm when life feels difficult.",
        "hindi": "रचना भक्ति, आस्था और कठिन समय में ईश्वर-स्मरण से मिलने वाले सहारे को व्यक्त करती है।",
        "context": "The verse uses devotional language and may draw on familiar Hindu religious imagery.",
    },
    {
        "id": "mythology",
        "keywords": ("रावण", "महाभारत", "गीता", "हनुमान", "सीता", "लक्ष्मण", "द्रौपदी", "अर्जुन", "कंस"),
        "english": "a moral lesson expressed through an episode or figure from Indian epic tradition",
        "child": "The old story is used to help us think about right conduct today.",
        "hindi": "रचना पौराणिक पात्र या प्रसंग के माध्यम से आज के जीवन के लिए नैतिक संकेत देती है।",
        "context": "The reference appears to draw on Indian epic or mythological tradition; the exact intended parallel remains a draft editorial inference.",
    },
    {
        "id": "family",
        "keywords": ("माँ", "मां", "पिता", "बेटी", "बेटा", "परिवार", "बहन", "भाई", "पति", "पत्नी"),
        "english": "family bonds, care, and mutual respect",
        "child": "Families grow stronger when people care for one another and show respect.",
        "hindi": "रचना परिवार में स्नेह, जिम्मेदारी और पारस्परिक सम्मान का महत्व बताती है।",
        "context": "The imagery is rooted in family relationships and everyday domestic experience.",
    },
    {
        "id": "public-life",
        "keywords": ("चुनाव", "नेता", "सरकार", "राजनीति", "मतदान", "जनता", "संसद", "भ्रष्टाचार"),
        "english": "public life, leadership, and civic responsibility",
        "child": "Good public life depends on honest leaders and responsible citizens.",
        "hindi": "रचना सार्वजनिक जीवन में ईमानदारी, नेतृत्व और नागरिक जिम्मेदारी पर टिप्पणी करती है।",
        "context": "The dated wording appears to refer to elections, governance, or public conduct; it should not be treated as a confirmed reference to a specific event without family review.",
    },
    {
        "id": "sports",
        "keywords": ("क्रिकेट", "खिलाड़ी", "विश्व कप", "मैच", "खेल", "बल्ला", "गेंद"),
        "english": "sport, effort, teamwork, and public enthusiasm",
        "child": "Practice, teamwork, and courage matter more than giving up after one result.",
        "hindi": "रचना खेल के माध्यम से प्रयास, साहस, टीम-भावना या जन-उत्साह को व्यक्त करती है।",
        "context": "The dated record appears to respond to a sporting event or the public mood around sport.",
    },
    {
        "id": "education",
        "keywords": ("शिक्षा", "विद्यालय", "गुरु", "शिक्षक", "विद्यार्थी", "ज्ञान", "पुस्तक"),
        "english": "learning, teachers, and the value of knowledge",
        "child": "Learning and good guidance help us make wiser choices.",
        "hindi": "रचना शिक्षा, गुरु और ज्ञान से जीवन में आने वाले विवेक को महत्व देती है।",
        "context": "The verse uses the language of learning or teaching to frame its ethical point.",
    },
    {
        "id": "health",
        "keywords": ("स्वास्थ्य", "रोग", "रुग्ण", "बीमारी", "डॉक्टर", "तनाव", "योग"),
        "english": "health, balance, and care for body and mind",
        "child": "Healthy habits and a calm mind help us face difficulties.",
        "hindi": "रचना शरीर और मन की देखभाल, संतुलन तथा स्वस्थ आदतों की ओर संकेत करती है।",
        "context": "The wording appears to connect personal conduct with physical or emotional well-being.",
    },
    {
        "id": "work",
        "keywords": ("कर्म", "मेहनत", "श्रम", "परिश्रम", "काम", "सफलता", "हार", "जीत"),
        "english": "effort, perseverance, and the consequences of one's actions",
        "child": "Keep trying and do your work honestly; results often grow from steady effort.",
        "hindi": "रचना ईमानदार कर्म, परिश्रम और धैर्य को सफलता का आधार मानती है।",
        "context": "The verse presents a practical moral observation about work and consequences.",
    },
    {
        "id": "relationships",
        "keywords": ("प्रेम", "प्यार", "मित्र", "रिश्ते", "संबंध", "सम्मान", "वाणी", "बोल"),
        "english": "relationships, kindness, and the effect of words",
        "child": "Kind words and respect help relationships stay strong.",
        "hindi": "रचना मधुर वाणी, प्रेम और सम्मान से संबंधों को सँभालने की सीख देती है।",
        "context": "The lesson is expressed through familiar social relationships and everyday speech.",
    },
    {
        "id": "patriotism",
        "keywords": ("भारत", "देश", "राष्ट्र", "तिरंगा", "सीमा", "सैनिक", "आजादी", "स्वतंत्र"),
        "english": "country, public service, and shared responsibility",
        "child": "Love for the country is shown through responsibility, courage, and service.",
        "hindi": "रचना देश-प्रेम को जिम्मेदारी, साहस और सेवा से जोड़ती है।",
        "context": "The dated record appears to use patriotic or national imagery; any link to a particular occasion remains provisional.",
    },
    {
        "id": "time",
        "keywords": ("समय", "आज", "कल", "क्षण", "उम्र", "जीवन", "मृत्यु"),
        "english": "time, change, and the choices that shape life",
        "child": "Time passes, so we should use it well and choose what is right.",
        "hindi": "रचना समय की गति और जीवन में सही चुनाव करने की आवश्यकता पर विचार करती है।",
        "context": "The verse frames its observation through the passage of time or stages of life.",
    },
]

DEFAULT_THEME = {
    "id": "ethical-observation",
    "english": "an ethical observation about conduct and its consequences",
    "child": "Our choices and the way we treat others shape what happens next.",
    "hindi": "रचना व्यवहार, विवेक और कर्म के परिणाम पर एक सहज नैतिक विचार रखती है।",
    "context": "The record reads as a concise ethical or social observation. A more specific context has not been inferred without stronger evidence.",
}


def transliterate_word(word: str) -> str:
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
    value = "".join(output)
    value = re.sub(r"a(?=\b)", "", value)
    return value


def transliterate(text: str) -> str:
    return DEVANAGARI_RE.sub(lambda match: transliterate_word(match.group(0)), text)


def normalize_token(token: str) -> str:
    return token.strip(".,!?;:।॥“”\"'‘’()[]{}_-—–").lower()


def literal_gloss(line: str) -> tuple[str, float]:
    parts = re.findall(r"[\u0900-\u097f]+|[^\u0900-\u097f]+", line)
    rendered: list[str] = []
    known = 0
    total = 0
    for part in parts:
        if not DEVANAGARI_RE.fullmatch(part):
            rendered.append(part.replace("।", "."))
            continue
        token = normalize_token(part)
        total += 1
        if token in GLOSSARY:
            rendered.append(GLOSSARY[token])
            known += 1
        else:
            rendered.append(transliterate_word(part))
    return "".join(rendered), known / total if total else 0.0


def detect_theme(poem: dict) -> dict:
    text = f"{poem['title']} {' '.join(poem['body'])}".lower()
    return next(
        (
            theme
            for theme in THEMES
            if any(keyword.lower() in text for keyword in theme["keywords"])
        ),
        DEFAULT_THEME,
    )


def extract_prompt(raw: str) -> str | None:
    for line in raw.splitlines():
        match = PROMPT_RE.search(line.strip())
        if match:
            prompt = match.group(1).strip().strip("#_*\"'“”‘’:-–। ")
            if prompt:
                return prompt
    return None


def build_record(poem: dict) -> dict:
    theme = detect_theme(poem)
    prompt = extract_prompt(poem["raw"])
    literal_lines = []
    coverage = []
    for line in poem["body"]:
        gloss, line_coverage = literal_gloss(line)
        literal_lines.append(gloss)
        coverage.append(line_coverage)
    average_coverage = sum(coverage) / len(coverage) if coverage else 0.0
    flags = ["ai-generated-draft", "family-review-required"]
    if average_coverage < 0.55:
        flags.append("literal-gloss-low-coverage")
    if poem["type"] != "दोहा" or len(poem["body"]) > 4:
        flags.append("long-form-review-required")

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

    context = theme["context"]
    if prompt:
        context = (
            f'The preserved record identifies “{prompt}” as the provided prompt. '
            f"{context}"
        )

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
        "literalEnglish": {
            "lines": literal_lines,
            "method": "word-level-machine-gloss",
            "confidence": "low" if average_coverage < 0.75 else "medium",
            "coverage": round(average_coverage, 3),
            "editorialNote": (
                "This is a conservative word-level draft, not a polished literary "
                "translation. Unresolved words are Romanized and require bilingual review."
            ),
        },
        "childFriendlyEnglish": {
            "text": theme["child"],
            "confidence": "low",
            "editorialNote": (
                f"Draft thematic meaning based on {theme['english']}; it is not "
                "confirmed authorial intent."
            ),
        },
        "simpleHindiExplanation": {
            "text": theme["hindi"],
            "confidence": "low",
            "editorialNote": "यह एआई-निर्मित प्रारूप है; परिवार की समीक्षा अभी शेष है।",
        },
        "context": {
            "text": context,
            "theme": theme["id"],
            "confidence": "medium" if prompt else "low",
            "evidence": evidence,
            "editorialNote": (
                "Context is inferred only from the preserved date, prompt, and wording. "
                "It is not presented as confirmed authorial intent."
            ),
        },
        "flags": flags,
    }


def main() -> None:
    poems = json.loads(POEMS_FILE.read_text(encoding="utf-8"))
    records = {poem["id"]: build_record(poem) for poem in poems}
    payload = {
        "schemaVersion": 1,
        "status": "draft",
        "notice": (
            "All transliterations, translations, explanations, and contextual notes are "
            "machine-produced editorial drafts awaiting family review."
        ),
        "records": records,
    }
    EDITORIAL_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Built {len(records)} draft editorial records.")


if __name__ == "__main__":
    main()
