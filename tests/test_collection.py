import json
import subprocess
import sys
import unittest
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

    def test_every_source_note_is_present_once(self):
        sources = list((ROOT / "content" / "notes").glob("*.txt"))
        self.assertEqual(len(sources), len(self.poems))
        self.assertEqual(len(self.poems), len({poem["id"] for poem in self.poems}))

    def test_original_text_is_preserved(self):
        for poem in self.poems:
            source = ROOT / poem["source"]
            expected = source.read_text(encoding="utf-8-sig").strip()
            self.assertEqual(expected, poem["raw"], poem["id"])

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


if __name__ == "__main__":
    unittest.main()
