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
            self.assertEqual(
                len(poem["body"]),
                len(record["literalEnglish"]["lines"]),
            )
            self.assertTrue(record["childFriendlyEnglish"]["text"].strip())
            self.assertTrue(record["simpleHindiExplanation"]["text"].strip())
            self.assertTrue(record["context"]["text"].strip())
            self.assertTrue(record["context"]["evidence"])

    def test_reader_has_structured_editorial_tabs(self):
        for page_name in ("index.html", "collection.html"):
            markup = (ROOT / page_name).read_text(encoding="utf-8")
            for tab in ("roman", "english", "simple", "context", "archive"):
                self.assertIn(f'data-reader-tab="{tab}"', markup)
            self.assertIn('id="reader-interpretation"', markup)
            self.assertNotIn("मूल अभिलेख देखें", markup)


if __name__ == "__main__":
    unittest.main()
