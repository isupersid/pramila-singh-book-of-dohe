import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPoemPrompt,
  classifyGeminiDelta,
  classifyGeminiText,
  extractBasePrompt,
  mergeArtworkMappings,
  parseArgs,
  safeSessionName,
  selectMissingPoems,
} from "../scripts/gemini-artwork-lib.mjs";

test("parseArgs supports repeated references and inline values", () => {
  const parsed = parseArgs([
    "run",
    "--start-page=135",
    "--count",
    "25",
    "--reference",
    "one.jpg",
    "--reference",
    "two.jpg",
    "--wait-for-login",
    "600",
  ]);
  assert.equal(parsed.command, "run");
  assert.equal(parsed.options.startPage, "135");
  assert.equal(parsed.options.count, "25");
  assert.deepEqual(parsed.options.reference, ["one.jpg", "two.jpg"]);
  assert.equal(parsed.options.waitForLogin, "600");
});

test("selectMissingPoems respects direction and existing mappings", () => {
  const poems = Array.from({ length: 6 }, (_, index) => ({
    id: `note-${index + 1}`,
    number: index + 1,
  }));
  const artwork = { "note-2": "art/note-2.jpg" };
  assert.deepEqual(
    selectMissingPoems(poems, artwork, {
      startPage: 1,
      count: 3,
      direction: "forward",
    }).map((poem) => poem.number),
    [1, 3, 4],
  );
  assert.deepEqual(
    selectMissingPoems(poems, artwork, {
      startPage: 6,
      count: 3,
      direction: "reverse",
    }).map((poem) => poem.number),
    [6, 5, 4],
  );
});

test("extractBasePrompt strips markdown blockquotes", () => {
  const markdown = `# Prompts\n\n## Base prompt\n\n> First line\n>\n> Second line\n\n## Poem\n`;
  assert.equal(extractBasePrompt(markdown), "First line\n\nSecond line");
});

test("buildPoemPrompt includes poem-specific editorial context", () => {
  const prompt = buildPoemPrompt(
    {
      number: 109,
      id: "notes_example",
      title: "टांग",
      body: ["पहली पंक्ति।", "दूसरी पंक्ति।"],
    },
    {
      literalEnglish: { lines: ["First line.", "Second line."] },
      simpleHindiExplanation: { text: "सरल अर्थ।" },
      context: { text: "Context." },
    },
  );
  assert.match(prompt, /notes_example/);
  assert.match(prompt, /First line\. Second line\./);
  assert.match(prompt, /full-bleed/);
  assert.match(prompt, /no white or cream blank border/);
});

test("classifyGeminiText identifies hard stops", () => {
  assert.equal(classifyGeminiText("Image generation limit reached"), "quota");
  assert.equal(classifyGeminiText("Sorry, I can't generate unsafe images."), "safety");
  assert.equal(classifyGeminiText("Sign in to continue"), "authentication");
  assert.equal(classifyGeminiText("Your image is ready"), null);
});

test("classifyGeminiDelta ignores old sidebar errors", () => {
  const before = "Previous chat: Image Generation Limit Reached\nGemini";
  assert.equal(
    classifyGeminiDelta(before, `${before}\nYour new image is ready`),
    null,
  );
  assert.equal(
    classifyGeminiDelta(before, `${before}\nImage generation limit reached`),
    "quota",
  );
});

test("mergeArtworkMappings is sorted and rejects collisions", () => {
  assert.deepEqual(
    mergeArtworkMappings(
      { note_b: "art/b.jpg" },
      [{ id: "note_a", artwork: "art/a.jpg" }],
    ),
    {
      note_a: "art/a.jpg",
      note_b: "art/b.jpg",
    },
  );
  assert.throws(
    () => mergeArtworkMappings(
      { note_a: "art/old.jpg" },
      [{ id: "note_a", artwork: "art/new.jpg" }],
    ),
    /collision/,
  );
});

test("safeSessionName rejects empty names", () => {
  assert.equal(safeSessionName("Forward 135"), "forward-135");
  assert.throws(() => safeSessionName("___"), /cannot be empty/);
});
