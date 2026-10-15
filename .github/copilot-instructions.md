# मन के मोती — repository guidance

## Project purpose

This repository preserves and presents the Hindi dohe and other writings of Pramila Singh as a family memory book. Treat the writing, portrait, attribution, and editorial context with care. Do not invent quotations or imply that agent-written text was written by Pramila Singh.

The public site is:

`https://isupersid.github.io/pramila-singh-book-of-dohe/`

## Architecture

- `index.html` is the focused memorial landing page and animated book reader.
- `collection.html` contains search, year filters, favorites, and poem cards.
- `app.js` supports both pages. Keep all page-specific elements optional.
- `styles.css` contains the landing, catalog, responsive reader, paper textures, and page-turn animations.
- `content/notes/` contains 750 preserved, unique UTF-8 source notes. Twenty-four byte-for-byte duplicate export files were removed with user approval in October 2026.
- `scripts/build_collection.py` parses the notes and generates `data/poems.json` and `data/stats.json`.
- `scripts/build_editorial.py` generates `data/editorial.json`, keyed by note ID, with draft transliteration, optional curated translation/explanation layers, context, evidence, confidence, flags, and review metadata. Its contract is documented by `data/editorial.schema.json`.
- `data/editorial_overrides.json` contains the readable poem-specific translation and explanation drafts that survive regeneration. Records without an override stay explicitly untranslated.
- `data/artwork.json` maps a note ID to its artwork path.
- `art/prompts.md` is the visual style guide and prompt history for generated illustrations.
- `images/pramila-singh.jpg` is the optimized memorial portrait.

## Source preservation

- Never rewrite or normalize files in `content/notes/` unless the user explicitly corrects a source transcription.
- Preserve the raw note text in generated data for provenance.
- Public-facing copy should refer to the writings as preserved works, records, or a collection—not emphasize that they originated as phone notes.
- Regenerate the catalog after changing notes, artwork mappings, or parser behavior:

  ```powershell
  python scripts/build_collection.py
  ```

  This also regenerates the editorial draft dataset.

## Artwork workflow

- Name artwork by the source note ID, for example:

  `art/notes_20240423114030.jpg`

- Add the corresponding entry to `data/artwork.json`.
- Store the base prompt and poem-specific prompt in `art/prompts.md`.
- Maintain the established watercolor-and-gouache visual identity described in that file.
- Do not add lettering or generated Hindi text inside illustrations.
- In Gemini, hover the completed image and use the visible download button in the image's top-right controls. Prefer this direct download over opening the image viewer and waiting for a second download surface.
- For bulk work, prefer `scripts/gemini-artwork-cli.mjs`. Use separate `--session` queue names, non-overlapping page ranges, and separate persistent `--profile` directories for parallel agents. Generated files remain in ignored `.artwork-cli/` checkpoints until explicitly reviewed and accepted.
- Persistent browser profiles contain authenticated Google sessions. Keep them outside the repository and never commit, upload, inspect, or share their contents.
- Desktop/tablet readers show artwork on the facing left page.
- Phone readers use artwork as a softly faded page background.
- If a poem has no artwork, desktop uses the standard flower placeholder; phones should not waste vertical space on a placeholder.

## Reader interaction invariants

The reader is intentionally modeled as a physical two-sided book:

- Desktop/tablet: artwork on the left, poem on the right.
- Phone: one full-width poem page with the same page-turn animation.
- A forward turn carries the current poem on the front and the destination artwork/placeholder on the reverse.
- A backward turn carries the current artwork page and reveals the previous poem.
- The turning sheet must be an exact visual clone so text, controls, dates, and colors do not jump.
- Do not show decorative glyphs on a page reverse unless that content is part of the destination page.
- Hide artwork and placeholders until the selected state is known. Reveal artwork only after it loads to avoid flashes.
- Keep the reader viewport overflow locked during 3D transforms so temporary scrollbars do not shift the book.
- Long poems must remain scrollable inside the poem page.
- Respect `prefers-reduced-motion`.

Test reader changes in both desktop and phone-sized viewports.

## Editorial and translation policy

Many dohe respond to current affairs, technology, public life, sports, social behavior, or a मंच-provided word. Dates and prompt metadata can be important evidence.

Future translations should preserve distinct layers:

1. Original Hindi doha
2. Roman transliteration
3. Literal English translation
4. Child-friendly English meaning
5. Simple Hindi explanation
6. Cultural or current-affairs context
7. Editorial confidence and review status

Do not present inferred context as confirmed authorial intent. Use language such as “appears to refer to” when evidence is incomplete. AI-generated translations should remain drafts until family-reviewed. Visually distinguish Pramila Singh's words from editorial notes.

The editorial generator must never display token-substitution or mixed Romanized-Hindi
output as English. Readable poem-specific drafts live in `data/editorial_overrides.json`.
When no responsible draft exists, translation and explanation layers remain `null`, the
record carries `needs-human-translation`, and the UI hides those tabs. All generated
records retain `status: "draft"` and `familyReviewed: false`. Before storing family-approved
edits, introduce a separate reviewed-data workflow rather than changing draft status in
the generated dataset.

The reader keeps the original work visible above a tabbed internal reading area. Roman,
English, सरल अर्थ, संदर्भ, and अभिलेख tabs must reset their internal scroll position when
the poem or tab changes. On phones the tab row scrolls horizontally while the interpretation
panel scrolls vertically; the dialog and browser viewport remain overflow-locked.

## About-section voice

The collection demonstrates:

- accessible Hindi and clear ethical observations
- devotional, family, nature, social, and public-life themes
- gentle satire and direct advice
- connections between mythology and contemporary life
- responses to subjects such as elections, Chandrayaan, cricket, mobile phones, online commerce, and technology
- the character of a dated poetic journal spanning 2022–2024

Keep About copy evidence-based and do not add fabricated poetry.

## Validation

Run:

```powershell
python -m unittest discover -s tests
node --check app.js
git diff --check
```

The tests verify that every source note appears exactly once, raw text is preserved, entries remain readable, and artwork paths resolve.

## Deployment

GitHub Pages deploys automatically from `main` using `.github/workflows/pages.yml`.

After merging, verify:

- the Pages workflow succeeds
- the landing page returns HTTP 200
- `collection.html` returns HTTP 200
- newly added artwork files return HTTP 200
