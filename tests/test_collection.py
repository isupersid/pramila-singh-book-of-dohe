import json
import hashlib
import subprocess
import sys
import unittest
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class CollectionBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "build_collection.py")],
            cwd=ROOT,
            check=True,
        )
        cls.poems = json.loads(
            (ROOT / "data" / "poems.json").read_text(encoding="utf-8")
        )
        cls.editorial = json.loads(
            (ROOT / "data" / "editorial.json").read_text(encoding="utf-8")
        )

    def test_every_source_note_is_present_once(self):
        sources = list((ROOT / "content" / "notes").glob("*.txt"))
        self.assertEqual(len(sources), len(self.poems))
        self.assertEqual(len(self.poems), len({poem["id"] for poem in self.poems}))

    def test_original_text_is_preserved(self):
        for poem in self.poems:
            source = ROOT / poem["source"]
            expected = source.read_text(encoding="utf-8-sig").strip()
            self.assertEqual(expected, poem["raw"], poem["id"])

    def test_source_notes_are_unique(self):
        contents = [
            source.read_text(encoding="utf-8-sig").strip()
            for source in (ROOT / "content" / "notes").glob("*.txt")
        ]
        duplicates = [text for text, count in Counter(contents).items() if count > 1]
        self.assertEqual([], duplicates)

    def test_entries_have_readable_content(self):
        for poem in self.poems:
            self.assertTrue(poem["title"].strip(), poem["id"])
            self.assertTrue(poem["body"], poem["id"])
            self.assertGreater(len(" ".join(poem["body"])), 5, poem["id"])

    def test_artwork_paths_are_relative(self):
        for poem in self.poems:
            artwork = poem["artwork"]
            if artwork:
                self.assertFalse(Path(artwork).is_absolute(), poem["id"])
                self.assertTrue((ROOT / artwork).is_file(), poem["id"])

    def test_editorial_records_cover_every_note_once(self):
        records = self.editorial["records"]
        poem_ids = {poem["id"] for poem in self.poems}
        self.assertEqual(poem_ids, set(records))
        self.assertEqual(750, len(records))

    def test_editorial_records_are_unreviewed_drafts(self):
        for note_id, record in self.editorial["records"].items():
            self.assertEqual(note_id, record["noteId"])
            self.assertEqual("draft", record["status"])
            self.assertFalse(record["review"]["familyReviewed"])
            self.assertIsNone(record["review"]["reviewedBy"])
            self.assertIsNone(record["review"]["reviewedAt"])
            self.assertIn("family-review-required", record["flags"])

    def test_editorial_source_linkage_and_layers(self):
        poems_by_id = {poem["id"]: poem for poem in self.poems}
        for note_id, record in self.editorial["records"].items():
            poem = poems_by_id[note_id]
            digest = hashlib.sha256(poem["raw"].encode("utf-8")).hexdigest()
            self.assertEqual(poem["source"], record["source"]["path"])
            self.assertEqual(poem["date"], record["source"]["date"])
            self.assertEqual(digest, record["source"]["sha256"])
            self.assertEqual(
                len(poem["body"]),
                len(record["romanTransliteration"]["lines"]),
            )
            if record["literalEnglish"] is None:
                self.assertIsNone(record["childFriendlyEnglish"])
                self.assertIsNone(record["simpleHindiExplanation"])
                self.assertIn("needs-human-translation", record["flags"])
                self.assertIn("needs-specific-explanation", record["flags"])
            else:
                self.assertEqual(
                    len(poem["body"]),
                    len(record["literalEnglish"]["lines"]),
                )
                self.assertTrue(record["childFriendlyEnglish"]["text"].strip())
                self.assertTrue(record["simpleHindiExplanation"]["text"].strip())
                self.assertNotIn("needs-human-translation", record["flags"])
            self.assertTrue(record["context"]["text"].strip())
            self.assertTrue(record["context"]["evidence"])

    def test_curated_english_is_readable_not_mixed_glossing(self):
        common_english = {
            "a",
            "and",
            "are",
            "as",
            "be",
            "by",
            "for",
            "from",
            "has",
            "have",
            "in",
            "is",
            "it",
            "of",
            "on",
            "that",
            "the",
            "their",
            "them",
            "they",
            "this",
            "to",
            "when",
            "who",
            "with",
        }
        allowed_shared_terms = {
            "bharat",
            "brahma",
            "chandrayaan",
            "cup",
            "mahesh",
            "mobile",
            "modi",
            "pakistan",
            "rohini",
            "shashank",
            "shiva",
            "shiv",
            "vishnu",
            "yoga",
        }
        banned_gloss_tokens = {"hai", "hain", "kar", "ko", "mein", "men", "se"}
        devanagari = set(chr(code) for code in range(0x0900, 0x0980))
        curated_count = 0
        for record in self.editorial["records"].values():
            literal = record["literalEnglish"]
            if literal is None:
                continue
            curated_count += 1
            for index, line in enumerate(literal["lines"]):
                self.assertFalse(any(char in devanagari for char in line), line)
                words = [
                    word.strip(".,;:!?—–()\"'").lower()
                    for word in line.split()
                    if word.strip(".,;:!?—–()\"'").isalpha()
                ]
                self.assertFalse(banned_gloss_tokens.intersection(words), line)
                roman_words = {
                    word.strip(".,;:!?—–()\"'").lower()
                    for word in record["romanTransliteration"]["lines"][index].split()
                }
                unresolved = (
                    set(words)
                    .intersection(roman_words)
                    .difference(common_english)
                    .difference(allowed_shared_terms)
                )
                if words:
                    self.assertLessEqual(len(unresolved) / len(words), 0.2, line)
        self.assertGreaterEqual(curated_count, 10)

    def test_curated_meanings_are_poem_specific(self):
        children = []
        simple_hindi = []
        for record in self.editorial["records"].values():
            if record["childFriendlyEnglish"] is not None:
                children.append(record["childFriendlyEnglish"]["text"])
                simple_hindi.append(record["simpleHindiExplanation"]["text"])
        self.assertEqual(len(children), len(set(children)))
        self.assertEqual(len(simple_hindi), len(set(simple_hindi)))

    def test_required_spot_checks_have_curated_drafts(self):
        required_ids = {
            "notes_20240423113656",
            "notes_20240423113758",
            "notes_20240423113808",
            "notes_20240423113814",
            "notes_20240423113821",
            "notes_20240423125044",
            "notes_20240423123457",
            "notes_20240423125321",
            "notes_20240423130256",
            "notes_20240423123137",
            "notes_20240423131041",
        }
        for note_id in required_ids:
            record = self.editorial["records"][note_id]
            self.assertIsNotNone(record["literalEnglish"], note_id)
            self.assertIsNotNone(record["childFriendlyEnglish"], note_id)
            self.assertIsNotNone(record["simpleHindiExplanation"], note_id)

    def test_reader_has_structured_editorial_tabs(self):
        for page_name in ("index.html", "collection.html"):
            markup = (ROOT / page_name).read_text(encoding="utf-8")
            for tab in ("roman", "english", "simple", "context", "archive"):
                self.assertIn(f'data-reader-tab="{tab}"', markup)
            self.assertIn('id="reader-interpretation"', markup)
            self.assertNotIn("मूल अभिलेख देखें", markup)


if __name__ == "__main__":
    unittest.main()
