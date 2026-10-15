#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { imageSize } from "image-size";
import {
  asPositiveInteger,
  buildPoemPrompt,
  classifyGeminiDelta,
  classifyGeminiText,
  extensionFromFilename,
  extractBasePrompt,
  mergeArtworkMappings,
  parseArgs,
  renderReviewHtml,
  safeSessionName,
  selectMissingPoems,
  sha256,
  writeJsonAtomic,
} from "./gemini-artwork-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECKPOINT_ROOT = path.join(ROOT, ".artwork-cli");
const DEFAULT_PROFILE = path.join(os.homedir(), ".pramila-singh-gemini-profile");
const GEMINI_URL = "https://gemini.google.com/app";
const GENERATED_IMAGE_MIN_SIZE = 700;

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "help" || options.help) return printHelp();

  if (command === "auth") return authenticate(options);
  if (command === "plan") return plan(options);
  if (command === "run") return run(options);
  if (command === "review") return review(options);
  if (command === "accept") return accept(options);
  if (command === "status") return status(options);

  throw new Error(`Unknown command: ${command}`);
}

async function loadRepositoryData() {
  const [poems, artwork, editorial, promptMarkdown] = await Promise.all([
    readJson(path.join(ROOT, "data", "poems.json")),
    readJson(path.join(ROOT, "data", "artwork.json")),
    readJson(path.join(ROOT, "data", "editorial.json")),
    readFile(path.join(ROOT, "art", "prompts.md"), "utf8"),
  ]);
  return {
    poems,
    artwork,
    editorial: editorial.records,
    basePrompt: extractBasePrompt(promptMarkdown),
  };
}

function profilePath(options) {
  return path.resolve(options.profile || process.env.GEMINI_PROFILE_DIR || DEFAULT_PROFILE);
}

async function authenticate(options) {
  const { chromium } = await import("playwright");
  const profile = profilePath(options);
  await mkdir(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    channel: options.channel || "chrome",
    headless: false,
    acceptDownloads: true,
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded" });

  console.log(`Gemini opened with persistent profile:\n${profile}`);
  console.log("Complete Google sign-in and any 2FA/CAPTCHA in the browser.");
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  await prompt.question("Press Enter here after Gemini is ready...");
  prompt.close();

  const state = classifyGeminiText(await page.locator("body").innerText());
  if (state === "authentication") {
    throw new Error("Gemini still appears to require authentication.");
  }
  await context.close();
  console.log("Authentication profile saved.");
}

async function plan(options) {
  const data = await loadRepositoryData();
  const selection = buildSelection(data, options);
  printSelection(selection);
}

function buildSelection(data, options) {
  const direction = options.direction === "reverse" ? "reverse" : "forward";
  const defaultStart = direction === "reverse" ? data.poems.length : 1;
  const startPage = asPositiveInteger(options.startPage, defaultStart);
  const count = asPositiveInteger(options.count, 25);
  const endPage = options.endPage === undefined
    ? undefined
    : asPositiveInteger(options.endPage);
  return selectMissingPoems(data.poems, data.artwork, {
    startPage,
    count,
    direction,
    endPage,
  });
}

function printSelection(selection) {
  if (!selection.length) {
    console.log("No missing artwork matched the requested range.");
    return;
  }
  for (const poem of selection) {
    console.log(`${poem.number}\t${poem.id}\t${poem.title}`);
  }
}

async function run(options) {
  const { chromium } = await import("playwright");
  const data = await loadRepositoryData();
  const selection = buildSelection(data, options);
  if (!selection.length) return printSelection(selection);

  const name = safeSessionName(
    options.session ||
    `${options.direction === "reverse" ? "reverse" : "forward"}-${selection[0].number}`,
  );
  const sessionDir = path.join(CHECKPOINT_ROOT, name);
  const downloadsDir = path.join(sessionDir, "downloads");
  const sessionFile = path.join(sessionDir, "session.json");
  await mkdir(downloadsDir, { recursive: true });

  const existing = await readJsonIfExists(sessionFile);
  const session = existing || {
    version: 1,
    name,
    createdAt: new Date().toISOString(),
    profile: profilePath(options),
    entries: selection.map((poem) => ({
      id: poem.id,
      page: poem.number,
      title: poem.title,
      poem: poem.body,
      prompt: buildPoemPrompt(poem, data.editorial[poem.id]),
      status: "pending",
      attempts: 0,
      download: null,
    })),
  };
  await writeJsonAtomic(sessionFile, session);

  if (options.dryRun) {
    console.log(`Dry run created ${sessionFile}`);
    printSelection(selection);
    return;
  }

  const profile = profilePath(options);
  await mkdir(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    channel: options.channel || "chrome",
    headless: options.headless === true || options.headless === "true",
    acceptDownloads: true,
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(asPositiveInteger(options.timeout, 180_000));

  const maxAttempts = asPositiveInteger(options.maxAttempts, 2);
  const freshEvery = asPositiveInteger(options.freshChatEvery, 25);
  const generationTimeout = asPositiveInteger(options.timeout, 180_000);
  const references = (options.reference || []).map((value) => path.resolve(value));
  let generatedInChat = 0;

  try {
    for (const entry of session.entries) {
      if (entry.status === "downloaded" || entry.status === "accepted") continue;
      if (generatedInChat === 0 || generatedInChat >= freshEvery) {
        await seedFreshChat(page, data.basePrompt, references);
        generatedInChat = 0;
      }

      const result = await generateOne({
        page,
        entry,
        downloadsDir,
        maxAttempts,
        generationTimeout,
      });
      Object.assign(entry, result);
      await writeJsonAtomic(sessionFile, session);

      if (result.status === "downloaded") {
        generatedInChat += 1;
        console.log(`Downloaded page ${entry.page}: ${entry.title}`);
      } else {
        console.warn(`Stopped at page ${entry.page}: ${result.status}`);
      }

      if (["quota", "authentication", "timeout"].includes(result.status)) break;
    }
  } finally {
    await context.close();
    await writeJsonAtomic(sessionFile, session);
  }

  await writeReview(sessionDir, session);
  console.log(`Checkpoint: ${sessionFile}`);
  console.log(`Review: ${path.join(sessionDir, "review.html")}`);
}

async function seedFreshChat(page, basePrompt, references) {
  await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded" });
  const pageState = classifyGeminiText(await page.locator("body").innerText());
  if (pageState === "authentication") {
    throw new Error("Authentication required. Run the `auth` command.");
  }

  if (references.length) await uploadReferences(page, references);
  await sendPrompt(
    page,
    `${basePrompt}\n\nConfirm that you will use this visual identity for the following poem illustrations. Do not generate an image yet.`,
  );
  await page.waitForTimeout(1500);
}

async function uploadReferences(page, references) {
  for (const reference of references) await access(reference);
  let input = page.locator('input[type="file"]').first();
  if (!await input.count()) {
    const uploadButton = page.getByRole("button", {
      name: /upload|add files|attach/i,
    }).first();
    if (await uploadButton.count()) await uploadButton.click();
    input = page.locator('input[type="file"]').first();
  }
  if (!await input.count()) {
    throw new Error("Could not find Gemini's file-upload input.");
  }
  await input.setInputFiles(references);
  await page.waitForTimeout(1200);
}

async function generateOne({
  page,
  entry,
  downloadsDir,
  maxAttempts,
  generationTimeout,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    entry.attempts = attempt;
    const before = await generatedImageSources(page);
    const beforeText = await page.locator("body").innerText();
    await sendPrompt(page, entry.prompt);
    const outcome = await waitForOutcome(
      page,
      before,
      beforeText,
      generationTimeout,
    );
    if (outcome.type !== "image") {
      if (outcome.type === "safety") {
        return { status: "safety", message: outcome.message, attempts: attempt };
      }
      if (outcome.type === "quota" || outcome.type === "authentication") {
        return { status: outcome.type, message: outcome.message, attempts: attempt };
      }
      if (attempt === maxAttempts) {
        return { status: "timeout", message: outcome.message, attempts: attempt };
      }
      await page.waitForTimeout(1500);
      continue;
    }

    const download = await downloadGeneratedImage(page, outcome.index);
    const extension = extensionFromFilename(download.suggestedFilename());
    const relativeDownload = path.join("downloads", `${entry.id}${extension}`);
    const destination = path.join(downloadsDir, `${entry.id}${extension}`);
    await download.saveAs(destination);
    const dimensions = imageSize(await readFile(destination));
    const hash = await sha256(destination);
    return {
      status: "downloaded",
      attempts: attempt,
      download: relativeDownload.replaceAll("\\", "/"),
      suggestedFilename: download.suggestedFilename(),
      dimensions: {
        width: dimensions.width,
        height: dimensions.height,
      },
      sha256: hash,
      downloadedAt: new Date().toISOString(),
    };
  }
  return { status: "timeout", message: "No image generated." };
}

async function sendPrompt(page, prompt) {
  const textbox = await findPromptTextbox(page);
  await textbox.fill(prompt);
  await textbox.press("Enter");
}

async function findPromptTextbox(page) {
  const candidates = [
    page.getByRole("textbox").last(),
    page.locator('textarea[placeholder*="Ask"]').last(),
    page.locator('[contenteditable="true"]').last(),
  ];
  for (const candidate of candidates) {
    if (await candidate.count() && await candidate.isVisible()) return candidate;
  }
  throw new Error("Could not find Gemini's prompt textbox.");
}

async function generatedImageSources(page) {
  return new Set(
    (await imageCandidates(page)).map((candidate) => candidate.src),
  );
}

async function imageCandidates(page) {
  return page.locator("img").evaluateAll(
    (images, minimum) => images.map((image, index) => {
      const box = image.getBoundingClientRect();
      return {
        index,
        src: image.currentSrc || image.src,
        width: image.naturalWidth,
        height: image.naturalHeight,
        visible: box.width > 100 && box.height > 100,
      };
    }).filter((image) => (
      image.visible &&
      image.width >= minimum &&
      image.height >= minimum &&
      image.src
    )),
    GENERATED_IMAGE_MIN_SIZE,
  );
}

async function waitForOutcome(page, before, beforeText, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const bodyText = await page.locator("body").innerText();
    const state = classifyGeminiDelta(beforeText, bodyText);
    if (state) return { type: state, message: lastLines(bodyText) };

    const candidates = await imageCandidates(page);
    const generated = candidates.find((candidate) => !before.has(candidate.src));
    if (generated) return { type: "image", index: generated.index };
    await page.waitForTimeout(1200);
  }
  return { type: "timeout", message: "Gemini returned no image or explicit error." };
}

async function downloadGeneratedImage(page, imageIndex) {
  const image = page.locator("img").nth(imageIndex);
  await image.scrollIntoViewIfNeeded();
  await image.hover();

  const imageBox = await image.boundingBox();
  const buttons = page.locator("button");
  const candidates = await buttons.evaluateAll((items) => items.map((button, index) => {
    const label = [
      button.getAttribute("aria-label"),
      button.getAttribute("title"),
      button.textContent,
    ].filter(Boolean).join(" ");
    const box = button.getBoundingClientRect();
    return {
      index,
      label,
      visible: box.width > 0 && box.height > 0,
      x: box.x,
      y: box.y,
    };
  }).filter((button) => (
    button.visible &&
    /download/i.test(button.label)
  )));

  const nearest = candidates
    .map((button) => ({
      ...button,
      distance: imageBox
        ? Math.hypot(
            button.x - (imageBox.x + imageBox.width),
            button.y - imageBox.y,
          )
        : 0,
    }))
    .sort((left, right) => left.distance - right.distance)[0];

  if (!nearest) {
    throw new Error(
      "Generated image appeared, but Gemini's hover download button was not found.",
    );
  }

  const downloadPromise = page.waitForEvent("download");
  await buttons.nth(nearest.index).click();
  return downloadPromise;
}

async function review(options) {
  const { sessionDir, session } = await loadSession(options);
  await writeReview(sessionDir, session);
  const reviewPath = path.join(sessionDir, "review.html");
  console.log(reviewPath);
  if (options.open) {
    await spawnAndWait(
      process.platform === "win32" ? "powershell" : "open",
      process.platform === "win32"
        ? ["-NoProfile", "-Command", `Start-Process '${reviewPath.replaceAll("'", "''")}'`]
        : [reviewPath],
    );
  }
}

async function writeReview(sessionDir, session) {
  const review = renderReviewHtml(session);
  await writeFile(path.join(sessionDir, "review.html"), review, "utf8");
}

async function status(options) {
  const { session } = await loadSession(options);
  for (const entry of session.entries) {
    console.log(`${entry.page}\t${entry.status}\t${entry.id}\t${entry.title}`);
  }
}

async function accept(options) {
  const { sessionDir, session, sessionFile } = await loadSession(options);
  const requested = options.all
    ? session.entries.filter((entry) => entry.status === "downloaded")
    : session.entries.filter((entry) => (
        String(options.ids || "")
          .split(",")
          .map((value) => value.trim())
          .includes(entry.id)
      ));

  if (!requested.length) {
    throw new Error("No downloaded entries selected. Use --all or --ids.");
  }

  const artworkPath = path.join(ROOT, "data", "artwork.json");
  const currentArtwork = await readJson(artworkPath);
  const accepted = [];

  for (const entry of requested) {
    if (entry.status !== "downloaded") {
      throw new Error(`${entry.id} is not ready for acceptance.`);
    }
    if (currentArtwork[entry.id]) {
      throw new Error(
        `${entry.id} already has canonical artwork: ${currentArtwork[entry.id]}`,
      );
    }
    const source = path.join(sessionDir, entry.download);
    const extension = path.extname(source).toLocaleLowerCase("en-US");
    const targetName = `${entry.id}${extension}`;
    const target = path.join(ROOT, "art", targetName);
    await copyFile(source, target);
    entry.status = "accepted";
    entry.acceptedAt = new Date().toISOString();
    entry.artwork = `art/${targetName}`;
    accepted.push({ id: entry.id, artwork: entry.artwork });
  }

  await writeJsonAtomic(
    artworkPath,
    mergeArtworkMappings(currentArtwork, accepted),
  );
  await appendPromptCheckpoint(session, requested);
  await writeJsonAtomic(sessionFile, session);

  if (!options.noValidate) {
    await spawnAndWait("python", ["scripts/build_collection.py"], ROOT);
    await spawnAndWait("python", ["-m", "unittest", "discover", "-s", "tests"], ROOT);
    await spawnAndWait("node", ["--check", "app.js"], ROOT);
    await spawnAndWait("git", ["diff", "--check"], ROOT);
  }

  console.log(`Accepted ${accepted.length} artwork file(s).`);
}

async function appendPromptCheckpoint(session, entries) {
  const promptPath = path.join(ROOT, "art", "prompts.md");
  const heading = `\n\n## Gemini CLI checkpoint — ${session.name}\n`;
  const blocks = entries.map((entry) => `
### ${entry.page}. ${entry.title}

- Note ID: \`${entry.id}\`
- Image: \`${path.basename(entry.artwork)}\`
- Status: Accepted through the Playwright CLI review workflow.
- Download SHA-256: \`${entry.sha256}\`
- Native dimensions: ${entry.dimensions?.width || "unknown"}×${entry.dimensions?.height || "unknown"}

> ${entry.prompt.replaceAll("\n", "\n> ")}
`).join("\n");
  await writeFile(
    promptPath,
    `${await readFile(promptPath, "utf8")}${heading}${blocks}`,
    "utf8",
  );
}

async function loadSession(options) {
  if (!options.session) throw new Error("Provide --session <name>.");
  const name = safeSessionName(options.session);
  const sessionDir = path.join(CHECKPOINT_ROOT, name);
  const sessionFile = path.join(sessionDir, "session.json");
  const session = await readJson(sessionFile);
  return { sessionDir, sessionFile, session };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonIfExists(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function lastLines(text) {
  return text.split(/\r?\n/).filter(Boolean).slice(-8).join(" | ");
}

async function spawnAndWait(command, args, cwd = ROOT) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code) => (
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with code ${code}`))
    ));
  });
}

function printHelp() {
  console.log(`
Gemini artwork CLI

Authentication:
  node scripts/gemini-artwork-cli.mjs auth --profile <outside-repo-directory>

Plan missing artwork:
  node scripts/gemini-artwork-cli.mjs plan --start-page 135 --count 25
  node scripts/gemini-artwork-cli.mjs plan --direction reverse --start-page 750 --count 25

Generate into a review checkpoint:
  node scripts/gemini-artwork-cli.mjs run --profile <dir> --session forward-135 \\
    --start-page 135 --count 25 --fresh-chat-every 25 \\
    --reference art/reference-1.jpg --reference art/reference-2.jpg

Review:
  node scripts/gemini-artwork-cli.mjs review --session forward-135 --open
  node scripts/gemini-artwork-cli.mjs status --session forward-135

Publish approved checkpoint images:
  node scripts/gemini-artwork-cli.mjs accept --session forward-135 --all
  node scripts/gemini-artwork-cli.mjs accept --session forward-135 --ids note_id_1,note_id_2

Important:
  - The persistent profile contains Google session credentials. Keep it outside Git.
  - Generated downloads remain in .artwork-cli/ until explicitly accepted.
  - The CLI never bypasses login, CAPTCHA, quota, or safety refusals.
`);
}

main().catch((error) => {
  console.error(`\nArtwork CLI failed: ${error.message}`);
  process.exitCode = 1;
});
