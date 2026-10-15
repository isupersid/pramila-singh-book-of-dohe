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
  if (command === "reject") return reject(options);
  if (command === "archive-rejected") return archiveRejected(options);
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
  if (options.waitForLogin) {
    const waitSeconds = asPositiveInteger(options.waitForLogin, 600);
    console.log(`Waiting up to ${waitSeconds} seconds for Gemini to become ready...`);
    await waitForAuthenticatedGemini(page, waitSeconds * 1000);
  } else {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    await prompt.question("Press Enter here after Gemini is ready...");
    prompt.close();
  }

  const state = classifyGeminiText(await page.locator("body").innerText());
  if (state === "authentication") {
    throw new Error("Gemini still appears to require authentication.");
  }
  await context.close();
  console.log("Authentication profile saved.");
}

async function waitForAuthenticatedGemini(page, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const bodyText = await page.locator("body").innerText();
    const state = classifyGeminiText(bodyText);
    const hasTextbox = await page.getByRole("textbox").count() > 0 ||
      await page.locator('textarea, [contenteditable="true"]').count() > 0;
    if (state !== "authentication" && hasTextbox) return;
    await page.waitForTimeout(1500);
  }
  throw new Error("Timed out waiting for Gemini authentication.");
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
        await seedFreshChat(page, references);
        generatedInChat = 0;
      }

      const result = await generateOne({
        page,
        entry,
        basePrompt: data.basePrompt,
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

async function seedFreshChat(page, references) {
  await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded" });
  const pageState = classifyGeminiText(await page.locator("body").innerText());
  if (pageState === "authentication") {
    throw new Error("Authentication required. Run the `auth` command.");
  }

  if (references.length) await uploadReferences(page, references);
  await activateImageMode(page);
}

async function activateImageMode(page) {
  const toolsButton = page.getByRole("button", {
    name: /upload & tools/i,
  }).first();
  await toolsButton.waitFor({ state: "visible", timeout: 15_000 });
  await toolsButton.click();
  const createImage = page.getByRole("menuitemcheckbox", {
    name: /create image/i,
  }).last();
  await createImage.waitFor({ state: "visible", timeout: 10_000 });
  await createImage.click();
  await page.waitForTimeout(500);
}

async function uploadReferences(page, references) {
  for (const reference of references) await access(reference);
  let input = page.locator('input[type="file"]').first();
  if (await input.count()) {
    await input.setInputFiles(references);
    await page.waitForTimeout(1200);
    return;
  }

  const toolsButton = page.getByRole("button", {
    name: /upload & tools/i,
  }).first();
  await toolsButton.waitFor({ state: "visible", timeout: 15_000 });
  await toolsButton.click();
  const uploadFiles = page.getByRole("menuitem", {
    name: /upload files/i,
  }).last();
  await uploadFiles.waitFor({ state: "visible", timeout: 10_000 });
  const chooserPromise = page.waitForEvent("filechooser");
  await uploadFiles.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(references);
  await page.waitForTimeout(1200);
  return;

}

async function generateOne({
  page,
  entry,
  basePrompt,
  downloadsDir,
  maxAttempts,
  generationTimeout,
}) {
  const previousAttempts = entry.attempts || 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    entry.attempts = previousAttempts + attempt;
    const before = await generatedImageSources(page);
    const beforeText = await page.locator("body").innerText();
    await sendPrompt(page, `${basePrompt}\n\n${entry.prompt}`);
    const outcome = await waitForOutcome(
      page,
      before,
      beforeText,
      generationTimeout,
    );
    if (outcome.type !== "image") {
      if (outcome.type === "safety") {
        return {
          status: "safety",
          message: outcome.message,
          attempts: entry.attempts,
        };
      }
      if (outcome.type === "quota" || outcome.type === "authentication") {
        return {
          status: outcome.type,
          message: outcome.message,
          attempts: entry.attempts,
        };
      }
      if (attempt === maxAttempts) {
        return {
          status: "timeout",
          message: outcome.message,
          attempts: entry.attempts,
        };
      }
      await page.waitForTimeout(1500);
      continue;
    }

    const download = await downloadGeneratedImage(
      page,
      outcome.src,
      before,
    );
    const extension = extensionFromFilename(download.suggestedFilename());
    const relativeDownload = path.join("downloads", `${entry.id}${extension}`);
    const destination = path.join(downloadsDir, `${entry.id}${extension}`);
    await download.saveAs(destination);
    const dimensions = imageSize(await readFile(destination));
    const hash = await sha256(destination);
    return {
      status: "downloaded",
      attempts: entry.attempts,
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
    if (generated) return { type: "image", src: generated.src };
    await page.waitForTimeout(1200);
  }
  return { type: "timeout", message: "Gemini returned no image or explicit error." };
}

async function downloadGeneratedImage(page, initialSource, before) {
  const deadline = Date.now() + 45_000;
  let preferredSource = initialSource;

  while (Date.now() < deadline) {
    const generated = (await imageCandidates(page))
      .filter((candidate) => !before.has(candidate.src))
      .sort((left, right) => (
        left.src === preferredSource ? -1 :
          right.src === preferredSource ? 1 :
            right.index - left.index
      ));

    for (const candidate of generated) {
      const image = page.locator("img").nth(candidate.index);
      try {
        await image.scrollIntoViewIfNeeded({ timeout: 3000 });
        await image.hover({ timeout: 3000 });
        preferredSource = candidate.src;
        await page.waitForTimeout(400);
      } catch {
        continue;
      }

      const imageBox = await image.boundingBox().catch(() => null);
      if (!imageBox) continue;
      const buttons = page.locator("button");
      const controls = await buttons.evaluateAll((items) => items.map((button, index) => {
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

      const nearest = controls
        .map((button) => ({
          ...button,
          distance: Math.hypot(
            button.x - (imageBox.x + imageBox.width),
            button.y - imageBox.y,
          ),
        }))
        .sort((left, right) => left.distance - right.distance)[0];
      if (!nearest) continue;

      try {
        const downloadPromise = page.waitForEvent("download", {
          timeout: 15_000,
        });
        await buttons.nth(nearest.index).click();
        return await downloadPromise;
      } catch {
        await page.waitForTimeout(750);
      }
    }
    await page.waitForTimeout(1000);
  }

  throw new Error(
    "Generated image appeared, but Gemini's hover download button did not become ready.",
  );
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

async function reject(options) {
  const { sessionDir, session, sessionFile } = await loadSession(options);
  const ids = String(options.ids || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!ids.length) throw new Error("Provide --ids with one or more note IDs.");

  const rejectedDir = path.join(sessionDir, "rejected");
  await mkdir(rejectedDir, { recursive: true });
  let rejected = 0;

  for (const entry of session.entries) {
    if (!ids.includes(entry.id)) continue;
    if (entry.status !== "downloaded") {
      throw new Error(`${entry.id} is not a downloaded review candidate.`);
    }
    const source = path.join(sessionDir, entry.download);
    const extension = path.extname(source);
    const archivedName = `${entry.id}-attempt-${entry.attempts}${extension}`;
    const archived = path.join(rejectedDir, archivedName);
    await copyFile(source, archived);
    entry.reviewHistory ??= [];
    entry.reviewHistory.push({
      status: "rejected",
      rejectedAt: new Date().toISOString(),
      reason: options.reason || "Rejected during visual review.",
      archivedDownload: path
        .relative(sessionDir, archived)
        .replaceAll("\\", "/"),
      sha256: entry.sha256,
      dimensions: entry.dimensions,
    });
    entry.status = "pending";
    entry.download = null;
    entry.suggestedFilename = null;
    entry.dimensions = null;
    entry.sha256 = null;
    entry.downloadedAt = null;
    rejected += 1;
  }

  if (rejected !== ids.length) {
    const known = new Set(session.entries.map((entry) => entry.id));
    const missing = ids.filter((id) => !known.has(id));
    throw new Error(`Unknown note IDs: ${missing.join(", ")}`);
  }
  await writeJsonAtomic(sessionFile, session);
  await writeReview(sessionDir, session);
  console.log(`Rejected ${rejected} image(s); entries returned to pending.`);
}

async function archiveRejected(options) {
  const { sessionDir, session } = await loadSession(options);
  const reasonOverrides = options.reasonsFile
    ? await readJson(path.resolve(options.reasonsFile))
    : {};
  const archiveDir = path.join(ROOT, "art", "rejected", session.name);
  await mkdir(archiveDir, { recursive: true });
  const records = [];

  for (const entry of session.entries) {
    for (const [index, review] of (entry.reviewHistory || []).entries()) {
      if (review.status !== "rejected" || !review.archivedDownload) continue;
      const source = path.join(sessionDir, review.archivedDownload);
      const extension = path.extname(source);
      const targetName = `${entry.id}-rejected-${index + 1}${extension}`;
      const target = path.join(archiveDir, targetName);
      await copyFile(source, target);
      records.push({
        noteId: entry.id,
        page: entry.page,
        title: entry.title,
        file: targetName,
        reason:
          reasonOverrides[`${entry.id}#${index + 1}`] ||
          reasonOverrides[entry.id] ||
          review.reason,
        sha256: review.sha256,
        dimensions: review.dimensions,
        originalAttempt: index + 1,
      });
    }
  }

  if (!records.length) {
    throw new Error("This checkpoint has no rejected images to archive.");
  }
  await writeJsonAtomic(path.join(archiveDir, "manifest.json"), {
    schemaVersion: 1,
    session: session.name,
    generatedAt: new Date().toISOString(),
    notice: "Rejected review candidates only. These files are not mapped into the public book.",
    entries: records,
  });
  console.log(`Archived ${records.length} rejected image(s) in ${archiveDir}`);
}

async function appendPromptCheckpoint(session, entries) {
  const promptPath = path.join(ROOT, "art", "prompts.md");
  const heading = `\n\n## Gemini CLI checkpoint — ${session.name}\n`;
  const blocks = entries.map((entry) => {
    const quotedPrompt = entry.prompt
      .split("\n")
      .map((line) => line ? `> ${line}` : ">")
      .join("\n");
    return `
### ${entry.page}. ${entry.title}

- Note ID: \`${entry.id}\`
- Image: \`${path.basename(entry.artwork)}\`
- Status: Accepted through the Playwright CLI review workflow.
- Download SHA-256: \`${entry.sha256}\`
- Native dimensions: ${entry.dimensions?.width || "unknown"}×${entry.dimensions?.height || "unknown"}

${quotedPrompt}
`;
  }).join("\n");
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
  node scripts/gemini-artwork-cli.mjs auth --profile <dir> --wait-for-login 600

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
  node scripts/gemini-artwork-cli.mjs reject --session forward-135 \\
    --ids note_id_1,note_id_2 --reason "Generated lettering"
  node scripts/gemini-artwork-cli.mjs archive-rejected --session forward-135 \
    --reasons-file .artwork-cli/forward-135/rejection-reasons.json

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
