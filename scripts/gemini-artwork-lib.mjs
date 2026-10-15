import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function parseArgs(argv) {
  const [command = "help", ...tokens] = argv;
  const options = { _: [] };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = tokens[index + 1];
    const value = inlineValue ?? (
      next && !next.startsWith("--")
        ? tokens[++index]
        : true
    );

    if (key === "reference") {
      options.reference ??= [];
      options.reference.push(value);
    } else {
      options[key] = value;
    }
  }

  return { command, options };
}

export function asPositiveInteger(value, fallback) {
  if (value === undefined || value === true) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

export function selectMissingPoems(poems, artwork, {
  startPage = 1,
  count = 25,
  direction = "forward",
  endPage,
} = {}) {
  const step = direction === "reverse" ? -1 : 1;
  const lower = endPage === undefined
    ? direction === "reverse" ? 1 : startPage
    : Math.min(startPage, endPage);
  const upper = endPage === undefined
    ? direction === "reverse" ? startPage : poems.length
    : Math.max(startPage, endPage);

  return poems
    .filter((poem) => (
      poem.number >= lower &&
      poem.number <= upper &&
      !artwork[poem.id]
    ))
    .sort((left, right) => step * (left.number - right.number))
    .slice(0, count);
}

export function extractBasePrompt(markdown) {
  const start = markdown.indexOf("## Base prompt");
  if (start < 0) {
    throw new Error("Could not locate `## Base prompt` in art/prompts.md");
  }
  const contentStart = markdown.indexOf("\n", start);
  const nextHeading = markdown.indexOf("\n## ", contentStart + 1);
  const content = markdown.slice(
    contentStart + 1,
    nextHeading < 0 ? markdown.length : nextHeading,
  );
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^>\s?/, ""))
    .join("\n")
    .trim();
}

export function buildPoemPrompt(poem, editorial) {
  const literal = editorial?.literalEnglish?.lines?.join(" ");
  const simpleHindi = editorial?.simpleHindiExplanation?.text;
  const context = editorial?.context?.text;

  return [
    `Create exactly one finished illustration for page ${poem.number}.`,
    "",
    `Poem title: ${poem.title}`,
    `Note ID: ${poem.id}`,
    "",
    ...poem.body,
    "",
    literal ? `Editorial English draft: ${literal}` : null,
    simpleHindi ? `सरल अर्थ: ${simpleHindi}` : null,
    context ? `Editorial context: ${context}` : null,
    "",
    "Interpret the poem as one dignified, coherent visual scene. Preserve cultural and devotional references respectfully. Do not add facts that are not supported by the poem or editorial context.",
    "",
    "OUTPUT REQUIREMENTS:",
    "- Gemini native 3:4 portrait, highest available resolution",
    "- true full-bleed painting reaching all four canvas edges",
    "- no white or cream blank border, paper mat, decorative frame or page margin",
    "- no text, Devanagari, captions, labels, signatures, numbers or logos",
    "- keep essential figures and objects inside an 8% safe area",
    "- background watercolor and gouache washes must continue naturally to every edge",
    "",
    "Generate exactly one image.",
  ].filter((line) => line !== null).join("\n");
}

const GEMINI_STATE_PATTERNS = {
  quota: /image generation limit|limit reached|try again later|usage limit/i,
  safety: /can't generate|cannot generate|unsafe images|unable to help with that/i,
  authentication: /sign in|choose an account/i,
};

export function classifyGeminiText(text) {
  for (const [state, pattern] of Object.entries(GEMINI_STATE_PATTERNS)) {
    if (pattern.test(text)) return state;
  }
  return null;
}

export function classifyGeminiDelta(before, current) {
  for (const [state, pattern] of Object.entries(GEMINI_STATE_PATTERNS)) {
    if (countMatches(current, pattern) > countMatches(before, pattern)) {
      return state;
    }
  }
  return null;
}

function countMatches(text, pattern) {
  return (text.match(new RegExp(pattern.source, "gi")) || []).length;
}

export function safeSessionName(value) {
  const normalized = value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized || !/[a-z0-9]/.test(normalized)) {
    throw new Error("Session name cannot be empty.");
  }
  return normalized;
}

export function extensionFromFilename(filename) {
  const extension = path.extname(filename).toLocaleLowerCase("en-US");
  return [".jpg", ".jpeg", ".png", ".webp"].includes(extension)
    ? extension
    : ".jpg";
}

export async function sha256(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

export async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

export function mergeArtworkMappings(current, accepted) {
  const merged = { ...current };
  for (const entry of accepted) {
    if (merged[entry.id] && merged[entry.id] !== entry.artwork) {
      throw new Error(
        `Artwork mapping collision for ${entry.id}: ${merged[entry.id]}`,
      );
    }
    merged[entry.id] = entry.artwork;
  }
  return Object.fromEntries(
    Object.entries(merged).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function renderReviewHtml(session) {
  const cards = session.entries.map((entry) => {
    const image = entry.download
      ? `<img src="${encodeURI(entry.download)}" alt="${escapeHtml(entry.title)}">`
      : '<div class="missing">No downloaded image</div>';
    return `
      <article>
        ${image}
        <div class="details">
          <strong>Page ${entry.page}: ${escapeHtml(entry.title)}</strong>
          <code>${entry.id}</code>
          <span class="status">${escapeHtml(entry.status)}</span>
          <pre>${escapeHtml(entry.poem.join("\n"))}</pre>
        </div>
      </article>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gemini artwork review — ${escapeHtml(session.name)}</title>
<style>
  body{margin:0;padding:24px;background:#f4ead4;color:#33261f;font-family:system-ui,sans-serif}
  h1{color:#6f1d2c}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
  article{overflow:hidden;background:#fffaf0;border:1px solid #d8c4a2;box-shadow:0 8px 24px #49301f18}
  img,.missing{display:block;width:100%;aspect-ratio:3/4;object-fit:contain;background:#eee1c8}
  .missing{display:grid;place-items:center;color:#79675d}.details{padding:16px;display:grid;gap:8px}
  code{overflow-wrap:anywhere;color:#79675d}.status{color:#8d3142;font-weight:700}
  pre{white-space:pre-wrap;font-family:serif;line-height:1.5}
</style>
<h1>Gemini artwork review</h1>
<p>Session: <code>${escapeHtml(session.name)}</code></p>
<div class="grid">${cards}</div>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
