const PAGE_SIZE = 24;
const FAVORITES_KEY = "pramila-poetry-favorites";

const elements = {
  totalCount: document.querySelector("#total-count"),
  yearCount: document.querySelector("#year-count"),
  featuredCard: document.querySelector("#featured-card"),
  featuredTitle: document.querySelector(".featured-title"),
  featuredLines: document.querySelector(".featured-lines"),
  startReading: document.querySelector("#start-reading"),
  coverOpen: document.querySelector("#cover-open"),
  randomButton: document.querySelector("#random-button"),
  searchInput: document.querySelector("#search-input"),
  yearFilters: document.querySelector("#year-filters"),
  favoritesFilter: document.querySelector("#favorites-filter"),
  resultCount: document.querySelector("#result-count"),
  poemGrid: document.querySelector("#poem-grid"),
  emptyState: document.querySelector("#empty-state"),
  loadMore: document.querySelector("#load-more"),
  cardTemplate: document.querySelector("#poem-card-template"),
  reader: document.querySelector("#reader"),
  readerClose: document.querySelector("#reader-close"),
  readerNumber: document.querySelector("#reader-number"),
  readerTitle: document.querySelector("#reader-title"),
  readerBody: document.querySelector("#reader-body"),
  readerTabs: [...document.querySelectorAll("[data-reader-tab]")],
  readerInterpretation: document.querySelector("#reader-interpretation"),
  editorialConfidence: document.querySelector("#editorial-confidence"),
  scrollAffordance: document.querySelector("#scroll-affordance"),
  editorialOpen: document.querySelector("#editorial-open"),
  editorialOverlay: document.querySelector("#editorial-overlay"),
  editorialClose: document.querySelector("#editorial-close"),
  favoriteButton: document.querySelector("#favorite-button"),
  copyLink: document.querySelector("#copy-link"),
  printPoem: document.querySelector("#print-poem"),
  previousPoem: document.querySelector("#previous-poem"),
  nextPoem: document.querySelector("#next-poem"),
  artworkImage: document.querySelector("#artwork-image"),
  artPlaceholder: document.querySelector("#art-placeholder"),
  pageArt: document.querySelector(".page-art"),
  turningSheet: document.querySelector("#turning-sheet"),
  turningFront: document.querySelector(".turning-front"),
  turningBack: document.querySelector(".turning-back"),
  poemPage: document.querySelector(".page-poem"),
};

const state = {
  poems: [],
  editorial: {},
  visible: [],
  selectedYear: "all",
  favoritesOnly: false,
  renderedCount: PAGE_SIZE,
  currentPoem: null,
  displayedArtworkId: null,
  activeReaderTab: "roman",
  isEditorialOpen: false,
  isTurning: false,
  favorites: new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]")),
};

const artworkPreloads = new Map();
const MAX_PRELOADED_ARTWORK = 6;

function preloadArtwork(path) {
  if (!path) return Promise.resolve(true);
  if (artworkPreloads.has(path)) {
    const cached = artworkPreloads.get(path);
    artworkPreloads.delete(path);
    artworkPreloads.set(path, cached);
    return cached.promise;
  }

  const image = new Image();
  image.decoding = "async";
  const promise = new Promise((resolve) => {
    let settled = false;
    const finish = (loaded) => {
      if (settled) return;
      settled = true;
      resolve(loaded);
    };
    image.onload = async () => {
      try {
        await image.decode();
      } catch {
        // A loaded image is still usable when decode() is unavailable or rejects.
      }
      finish(true);
    };
    image.onerror = () => finish(false);
    window.setTimeout(() => finish(false), 8000);
  });

  artworkPreloads.set(path, { image, promise });
  image.src = path;

  while (artworkPreloads.size > MAX_PRELOADED_ARTWORK) {
    const oldest = artworkPreloads.keys().next().value;
    if (oldest === path) break;
    artworkPreloads.delete(oldest);
  }
  return promise;
}

function queueArtworkPreloads(index) {
  [index, index + 1, index - 1].forEach((candidate) => {
    preloadArtwork(state.poems[candidate]?.artwork);
  });

  const preloadFurther = () => {
    [index + 2, index - 2].forEach((candidate) => {
      preloadArtwork(state.poems[candidate]?.artwork);
    });
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(preloadFurther, { timeout: 1500 });
  } else {
    window.setTimeout(preloadFurther, 250);
  }
}

const readerTabLabels = {
  roman: "Roman transliteration",
  english: "English draft",
  simple: "सरल अर्थ",
  context: "संदर्भ",
  archive: "मूल अभिलेख",
};

function searchableText(poem) {
  return `${poem.title} ${poem.body.join(" ")} ${poem.raw}`.toLocaleLowerCase("hi-IN");
}

function cleanExcerpt(lines, limit = 4) {
  return lines
    .filter((line) => line && !/^\d+[.)]?$/.test(line))
    .slice(0, limit)
    .join("\n");
}

function formatNumber(value) {
  return new Intl.NumberFormat("hi-IN").format(value);
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites]));
}

function toggleFavorite(id) {
  if (state.favorites.has(id)) {
    state.favorites.delete(id);
  } else {
    state.favorites.add(id);
  }
  saveFavorites();
  if (elements.poemGrid) {
    renderCollection(false);
  }
  if (state.currentPoem?.id === id) {
    updateReaderFavorite();
  }
}

function updateReaderFavorite() {
  if (!elements.favoriteButton) return;
  const isFavorite = state.currentPoem && state.favorites.has(state.currentPoem.id);
  elements.favoriteButton.setAttribute("aria-pressed", String(Boolean(isFavorite)));
  elements.favoriteButton.querySelector("span:first-child").textContent = isFavorite ? "♥" : "♡";
}

function makeYearFilters(years) {
  if (!elements.yearFilters) return;
  const options = [{ label: "सभी", value: "all" }, ...years.map((year) => ({
    label: formatNumber(year),
    value: String(year),
  }))];

  elements.yearFilters.replaceChildren(
    ...options.map(({ label, value }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.year = value;
      button.setAttribute("aria-pressed", String(value === state.selectedYear));
      button.addEventListener("click", () => {
        state.selectedYear = value;
        state.renderedCount = PAGE_SIZE;
        makeYearFilters(years);
        renderCollection();
      });
      return button;
    }),
  );
}

function applyFilters() {
  const query = elements.searchInput.value.trim().toLocaleLowerCase("hi-IN");
  state.visible = state.poems.filter((poem) => {
    const matchesYear =
      state.selectedYear === "all" || String(poem.year) === state.selectedYear;
    const matchesSearch = !query || searchableText(poem).includes(query);
    const matchesFavorite = !state.favoritesOnly || state.favorites.has(poem.id);
    return matchesYear && matchesSearch && matchesFavorite;
  });
}

function createCard(poem) {
  const fragment = elements.cardTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".poem-card");
  const openButton = fragment.querySelector(".card-open");
  const favoriteButton = fragment.querySelector(".card-favorite");

  card.dataset.id = poem.id;
  if (poem.artwork) {
    card.classList.add("has-artwork");
    card.style.setProperty(
      "--card-artwork",
      `url(${JSON.stringify(poem.artwork)})`,
    );
  }
  fragment.querySelector(".card-number").textContent =
    `पृष्ठ ${formatNumber(poem.number).padStart(3, "०")}`;
  fragment.querySelector(".card-year").textContent = poem.year
    ? formatNumber(poem.year)
    : "दिनांक अज्ञात";
  fragment.querySelector("h3").textContent = poem.title;
  fragment.querySelector(".card-excerpt").textContent =
    cleanExcerpt(poem.body) || "मूल रचना पढ़ने के लिए पन्ना खोलें।";

  openButton.addEventListener("click", () => openReader(poem));
  const isFavorite = state.favorites.has(poem.id);
  favoriteButton.textContent = isFavorite ? "♥" : "♡";
  favoriteButton.classList.toggle("is-favorite", isFavorite);
  favoriteButton.setAttribute(
    "aria-label",
    isFavorite ? "प्रिय पन्नों से हटाएँ" : "प्रिय पन्नों में जोड़ें",
  );
  favoriteButton.addEventListener("click", () => toggleFavorite(poem.id));
  return fragment;
}

function renderCollection(resetGrid = true) {
  if (!elements.poemGrid) return;
  applyFilters();
  const displayed = state.visible.slice(0, state.renderedCount);

  if (resetGrid) {
    elements.poemGrid.replaceChildren(...displayed.map(createCard));
  } else {
    elements.poemGrid.querySelectorAll(".poem-card").forEach((card) => {
      const favorite = card.querySelector(".card-favorite");
      const isFavorite = state.favorites.has(card.dataset.id);
      favorite.textContent = isFavorite ? "♥" : "♡";
      favorite.classList.toggle("is-favorite", isFavorite);
    });
    if (state.favoritesOnly) {
      elements.poemGrid.replaceChildren(...displayed.map(createCard));
    }
  }

  elements.resultCount.textContent = `${formatNumber(state.visible.length)} रचनाएँ मिलीं`;
  elements.emptyState.hidden = state.visible.length > 0;
  elements.loadMore.hidden = displayed.length >= state.visible.length;
}

function renderArtworkPage(poem) {
  state.displayedArtworkId = poem.id;
  elements.artworkImage.onload = null;
  elements.artworkImage.onerror = null;
  elements.artworkImage.hidden = true;
  elements.artPlaceholder.hidden = true;

  if (poem.artwork) {
    const expectedArtwork = poem.artwork;
    const revealArtwork = () => {
      if (state.displayedArtworkId === poem.id) {
        elements.artworkImage.hidden = false;
      }
    };
    const showArtworkFallback = () => {
      if (state.displayedArtworkId === poem.id) {
        elements.artPlaceholder.hidden = false;
      }
    };

    elements.artworkImage.onload = revealArtwork;
    elements.artworkImage.onerror = showArtworkFallback;
    elements.artworkImage.src = poem.artwork;
    elements.artworkImage.alt = `${poem.title} के लिए कलाकृति`;
    if (elements.artworkImage.complete && elements.artworkImage.naturalWidth) {
      revealArtwork();
    }
    elements.poemPage.classList.add("has-mobile-artwork");
    elements.poemPage.style.setProperty(
      "--mobile-artwork",
      `url(${JSON.stringify(poem.artwork)})`,
    );
  } else {
    elements.artworkImage.removeAttribute("alt");
    elements.artworkImage.removeAttribute("src");
    elements.artPlaceholder.hidden = false;
    elements.poemPage.classList.remove("has-mobile-artwork");
    elements.poemPage.style.removeProperty("--mobile-artwork");
  }
}

function appendHeading(container, text) {
  const heading = document.createElement("h3");
  heading.textContent = text;
  container.append(heading);
}

function appendLines(container, lines, className = "") {
  const group = document.createElement("div");
  if (className) group.className = className;
  lines.forEach((line) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = line || "\u00a0";
    group.append(paragraph);
  });
  container.append(group);
}

function appendEditorialNote(container, text) {
  if (!text) return;
  const note = document.createElement("p");
  note.className = "editorial-note";
  note.textContent = text;
  container.append(note);
}

function readerTabHasContent(tab, editorial) {
  if (tab === "archive") return Boolean(state.currentPoem?.raw);
  if (!editorial) return false;
  if (tab === "roman") return Boolean(editorial.romanTransliteration?.lines?.length);
  if (tab === "english") {
    return Boolean(
      editorial.literalEnglish?.lines?.length ||
      editorial.childFriendlyEnglish?.text,
    );
  }
  if (tab === "simple") return Boolean(editorial.simpleHindiExplanation?.text);
  if (tab === "context") return Boolean(editorial.context?.text);
  return false;
}

function updateScrollAffordance() {
  if (!elements.readerInterpretation || !elements.scrollAffordance) return;
  const panel = elements.readerInterpretation;
  const hasOverflow = panel.scrollHeight > panel.clientHeight + 2;
  const atEnd = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4;
  elements.scrollAffordance.hidden = !hasOverflow || atEnd;
}

function openEditorialOverlay() {
  if (!elements.editorialOverlay || state.isEditorialOpen) return;
  state.isEditorialOpen = true;
  renderEditorialTab();
  elements.editorialOverlay.hidden = false;
  elements.editorialOverlay.setAttribute("aria-hidden", "false");
  elements.reader.classList.add("is-editorial-open");
  elements.editorialClose.focus();
}

function closeEditorialOverlay(restoreFocus = true) {
  if (!elements.editorialOverlay || !state.isEditorialOpen) return;
  state.isEditorialOpen = false;
  elements.editorialOverlay.hidden = true;
  elements.editorialOverlay.setAttribute("aria-hidden", "true");
  elements.reader.classList.remove("is-editorial-open");
  if (restoreFocus) elements.editorialOpen.focus();
}

function renderEditorialTab(tab = state.activeReaderTab) {
  if (!state.currentPoem || !elements.readerInterpretation) return;
  const editorial = state.editorial[state.currentPoem.id];
  const availableTabs = elements.readerTabs.filter((button) =>
    readerTabHasContent(button.dataset.readerTab, editorial),
  );
  if (!readerTabHasContent(tab, editorial)) {
    tab = availableTabs[0]?.dataset.readerTab || "archive";
  }
  state.activeReaderTab = tab;

  elements.readerTabs.forEach((button) => {
    const isAvailable = readerTabHasContent(button.dataset.readerTab, editorial);
    const isSelected = button.dataset.readerTab === tab;
    button.disabled = !isAvailable;
    button.setAttribute("aria-selected", String(isSelected));
    button.tabIndex = isSelected ? 0 : -1;
  });

  const panel = elements.readerInterpretation;
  panel.replaceChildren();
  panel.setAttribute("aria-label", readerTabLabels[tab]);

  if (tab === "roman") {
    appendLines(panel, editorial.romanTransliteration.lines, "roman-lines");
    appendEditorialNote(
      panel,
      "Machine transliteration draft; pronunciation and word boundaries need family review.",
    );
  } else if (tab === "english") {
    if (editorial.literalEnglish?.lines?.length) {
      appendHeading(panel, "Literal English draft");
      appendLines(panel, editorial.literalEnglish.lines, "english-lines");
      appendEditorialNote(panel, editorial.literalEnglish.editorialNote);
    }
    if (editorial.childFriendlyEnglish?.text) {
      appendHeading(panel, "For younger readers");
      const meaning = document.createElement("p");
      meaning.textContent = editorial.childFriendlyEnglish.text;
      panel.append(meaning);
      appendEditorialNote(panel, editorial.childFriendlyEnglish.editorialNote);
    }
  } else if (tab === "simple") {
    const meaning = document.createElement("p");
    meaning.lang = "hi";
    meaning.textContent = editorial.simpleHindiExplanation.text;
    panel.append(meaning);
    appendEditorialNote(panel, editorial.simpleHindiExplanation.editorialNote);
  } else if (tab === "context") {
    const context = document.createElement("p");
    context.textContent = editorial.context.text;
    panel.append(context);
    appendHeading(panel, "साक्ष्य");
    const evidence = document.createElement("ul");
    editorial.context.evidence.forEach((item) => {
      const entry = document.createElement("li");
      entry.textContent =
        item.type === "provided-prompt"
          ? `मंच/अभिलेख में दिया शब्द: ${item.value}`
          : `सुरक्षित तारीख: ${item.value}`;
      evidence.append(entry);
    });
    panel.append(evidence);
    appendEditorialNote(panel, editorial.context.editorialNote);
  } else {
    const pre = document.createElement("pre");
    pre.textContent = state.currentPoem.raw;
    panel.append(pre);
  }

  const confidence = tab === "archive"
    ? ""
    : tab === "english"
      ? editorial.literalEnglish?.confidence ||
        editorial.childFriendlyEnglish?.confidence
      : editorial?.[
          tab === "roman"
            ? "romanTransliteration"
            : tab === "simple"
              ? "simpleHindiExplanation"
              : "context"
        ]?.confidence;
  elements.editorialConfidence.textContent = confidence
    ? `विश्वास: ${confidence === "medium" ? "मध्यम" : "कम"}`
    : "";
  panel.scrollTop = 0;
  requestAnimationFrame(updateScrollAffordance);
}

function renderReader(poem, updateHash = true) {
  closeEditorialOverlay(false);
  state.currentPoem = poem;
  elements.readerNumber.textContent = `पृष्ठ ${formatNumber(poem.number)} · ${
    poem.date ? new Intl.DateTimeFormat("hi-IN", { dateStyle: "long" }).format(new Date(`${poem.date}T00:00:00`)) : "दिनांक उपलब्ध नहीं"
  }`;
  elements.readerTitle.textContent = poem.title;
  elements.readerBody.replaceChildren(
    ...poem.body.map((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line || "\u00a0";
      return paragraph;
    }),
  );
  elements.readerBody.closest(".reader-original").scrollTop = 0;
  renderEditorialTab();
  renderArtworkPage(poem);

  const index = state.poems.findIndex((entry) => entry.id === poem.id);
  elements.previousPoem.disabled = index <= 0;
  elements.nextPoem.disabled = index >= state.poems.length - 1;
  queueArtworkPreloads(index);
  updateReaderFavorite();

  if (updateHash) {
    history.replaceState(null, "", `#poem=${poem.id}`);
  }
}

function openReader(poem, updateHash = true) {
  renderReader(poem, updateHash);
  if (!elements.reader.open) {
    elements.reader.showModal();
  }
}

function closeReader() {
  state.isTurning = false;
  closeEditorialOverlay(false);
  elements.reader.classList.remove("is-preparing-turn");
  elements.reader.classList.remove("is-turning");
  elements.turningSheet.classList.remove("turn-next", "turn-previous");
  elements.turningSheet.hidden = true;
  elements.reader.close();
  if (location.hash.startsWith("#poem=")) {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
}

function clonePoemPageForTurn(container) {
  const clone = elements.poemPage.cloneNode(true);
  clone.classList.add("turning-page-clone");
  clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  clone.querySelectorAll("button, summary").forEach((element) => {
    element.setAttribute("tabindex", "-1");
  });
  container.replaceChildren(clone);
  const sourceScrollers = elements.poemPage.querySelectorAll(
    ".reader-original, .reader-interpretation, .reader-tabs",
  );
  const cloneScrollers = clone.querySelectorAll(
    ".reader-original, .reader-interpretation, .reader-tabs",
  );
  sourceScrollers.forEach((source, index) => {
    cloneScrollers[index].scrollTop = source.scrollTop;
    cloneScrollers[index].scrollLeft = source.scrollLeft;
  });
}

function cloneCurrentPageForTurn() {
  clonePoemPageForTurn(elements.turningFront);
}

function cloneArtworkPageForTurn(poem) {
  const clone = elements.pageArt.cloneNode(true);
  const image = clone.querySelector("img");
  const placeholder = clone.querySelector(".art-placeholder");

  clone.classList.add("turning-art-clone");
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));

  if (poem.artwork) {
    image.src = poem.artwork;
    image.alt = `${poem.title} के लिए कलाकृति`;
    image.hidden = false;
    placeholder.hidden = true;
  } else {
    image.removeAttribute("src");
    image.removeAttribute("alt");
    image.hidden = true;
    placeholder.hidden = false;
  }

  elements.turningBack.replaceChildren(clone);
}

function startPageTurnAnimation(direction) {
  elements.turningSheet.style.transform =
    direction > 0 ? "rotateY(0deg)" : "rotateY(-180deg)";
  elements.turningSheet.hidden = false;
  elements.turningSheet.classList.remove("turn-next", "turn-previous");
  void elements.turningSheet.offsetWidth;
  elements.turningSheet.classList.add(direction > 0 ? "turn-next" : "turn-previous");
  elements.turningSheet.addEventListener(
    "animationend",
    () => {
      elements.turningSheet.classList.remove("turn-next", "turn-previous");
      elements.turningSheet.hidden = true;
      elements.turningSheet.style.removeProperty("transform");
      elements.turningBack.replaceChildren();
      elements.reader.classList.remove("is-turning");
      state.isTurning = false;
    },
    { once: true },
  );
}

async function moveReader(direction) {
  if (state.isTurning) return;
  if (state.isEditorialOpen) {
    closeEditorialOverlay();
    return;
  }
  const index = state.poems.findIndex((poem) => poem.id === state.currentPoem?.id);
  const current = state.currentPoem;
  const next = state.poems[index + direction];
  if (!next) return;

  state.isTurning = true;
  elements.reader.classList.add("is-preparing-turn");
  await preloadArtwork(next.artwork);
  elements.reader.classList.remove("is-preparing-turn");
  if (!elements.reader.open || state.currentPoem?.id !== current.id) {
    state.isTurning = false;
    return;
  }

  const useSimpleTransition =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (useSimpleTransition) {
    renderReader(next);
    state.isTurning = false;
    return;
  }

  elements.reader.classList.add("is-turning");

  if (window.matchMedia("(max-width: 900px)").matches) {
    if (direction > 0) {
      clonePoemPageForTurn(elements.turningFront);
      renderReader(next);
      clonePoemPageForTurn(elements.turningBack);
    } else {
      clonePoemPageForTurn(elements.turningBack);
      renderReader(next, false);
      clonePoemPageForTurn(elements.turningFront);
      renderReader(current, false);
      window.setTimeout(() => renderReader(next), 350);
    }
    startPageTurnAnimation(direction);
    return;
  }

  if (direction > 0) {
    cloneCurrentPageForTurn();
  } else {
    cloneArtworkPageForTurn(current);
    renderReader(next, false);
    cloneCurrentPageForTurn();
    renderReader(current, false);
    renderArtworkPage(next);
  }

  if (direction > 0) {
    renderReader(next);
    cloneArtworkPageForTurn(next);
    renderArtworkPage(current);
    window.setTimeout(() => renderArtworkPage(next), 350);
  }

  if (direction < 0) {
    window.setTimeout(() => renderReader(next), 350);
  }
  startPageTurnAnimation(direction);
}

function chooseFeatured() {
  if (!state.poems.length || !elements.featuredCard) return;
  const dayNumber = Math.floor(Date.now() / 86_400_000);
  const featured = state.poems[dayNumber % state.poems.length];
  elements.featuredTitle.textContent = featured.title;
  elements.featuredLines.textContent =
    cleanExcerpt(featured.body, 3) || "इस स्मृति-पन्ने को खोलकर पढ़ें।";
  elements.featuredCard.addEventListener("click", () => openReader(featured));
}

function openRandomPoem() {
  if (!state.poems.length) return;
  const poem = state.poems[Math.floor(Math.random() * state.poems.length)];
  openReader(poem);
}

function openHashPoem() {
  const match = location.hash.match(/^#poem=(.+)$/);
  if (!match) return;
  const poem = state.poems.find((entry) => entry.id === decodeURIComponent(match[1]));
  if (poem) openReader(poem, false);
}

async function copyCurrentLink() {
  const url = new URL(location.href);
  url.hash = `poem=${state.currentPoem.id}`;
  await navigator.clipboard.writeText(url.toString());
  const label = elements.copyLink.querySelector("span:last-child");
  label.textContent = "कॉपी हुआ";
  window.setTimeout(() => {
    label.textContent = "लिंक";
  }, 1600);
}

function bindEvents() {
  if (elements.searchInput) {
    let searchTimer;
    elements.searchInput.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        state.renderedCount = PAGE_SIZE;
        renderCollection();
      }, 120);
    });
    elements.favoritesFilter.addEventListener("click", () => {
      state.favoritesOnly = !state.favoritesOnly;
      state.renderedCount = PAGE_SIZE;
      elements.favoritesFilter.setAttribute("aria-pressed", String(state.favoritesOnly));
      renderCollection();
    });
    elements.loadMore.addEventListener("click", () => {
      state.renderedCount += PAGE_SIZE;
      renderCollection();
    });
  }
  const startReading = () => {
    if (state.poems.length) openReader(state.poems[0]);
  };
  elements.startReading?.addEventListener("click", startReading);
  elements.coverOpen?.addEventListener("click", startReading);
  elements.randomButton?.addEventListener("click", openRandomPoem);
  elements.readerClose.addEventListener("click", closeReader);
  elements.editorialOpen.addEventListener("click", openEditorialOverlay);
  elements.editorialClose.addEventListener("click", () => closeEditorialOverlay());
  elements.editorialOverlay.addEventListener("click", (event) => {
    if (event.target === elements.editorialOverlay) closeEditorialOverlay();
  });
  elements.reader.addEventListener("click", (event) => {
    if (event.target === elements.reader) closeReader();
  });
  elements.reader.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (state.isEditorialOpen) {
      closeEditorialOverlay();
    } else {
      closeReader();
    }
  });
  elements.favoriteButton.addEventListener("click", () => {
    if (state.currentPoem) toggleFavorite(state.currentPoem.id);
  });
  elements.previousPoem.addEventListener("click", () => moveReader(-1));
  elements.nextPoem.addEventListener("click", () => moveReader(1));
  elements.copyLink.addEventListener("click", copyCurrentLink);
  elements.printPoem.addEventListener("click", () => window.print());
  elements.readerTabs.forEach((button) => {
    button.addEventListener("click", () => renderEditorialTab(button.dataset.readerTab));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const available = elements.readerTabs.filter((tab) => !tab.disabled);
      const currentIndex = available.indexOf(button);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = available[(currentIndex + direction + available.length) % available.length];
      next.focus();
      renderEditorialTab(next.dataset.readerTab);
    });
  });
  elements.readerInterpretation.addEventListener("scroll", updateScrollAffordance);
  window.addEventListener("keydown", (event) => {
    if (!elements.reader.open) return;
    if (state.isEditorialOpen) return;
    if (event.target.closest?.(".reader-tabs, .reader-interpretation")) return;
    if (event.key === "ArrowLeft") moveReader(-1);
    if (event.key === "ArrowRight") moveReader(1);
  });
  window.addEventListener("hashchange", openHashPoem);
}

async function start() {
  try {
    const [poemsResponse, statsResponse, editorialResponse] = await Promise.all([
      fetch("data/poems.json"),
      fetch("data/stats.json"),
      fetch("data/editorial.json"),
    ]);
    if (!poemsResponse.ok || !statsResponse.ok || !editorialResponse.ok) {
      throw new Error("Collection files could not be loaded.");
    }
    const [poems, stats, editorial] = await Promise.all([
      poemsResponse.json(),
      statsResponse.json(),
      editorialResponse.json(),
    ]);
    state.poems = poems;
    state.editorial = editorial.records;
    queueArtworkPreloads(0);
    if (elements.totalCount) elements.totalCount.textContent = formatNumber(stats.total);
    if (elements.yearCount) elements.yearCount.textContent = formatNumber(stats.years.length);
    makeYearFilters(stats.years);
    renderCollection();
    chooseFeatured();
    bindEvents();
    openHashPoem();
  } catch (error) {
    console.error(error);
    if (elements.poemGrid) {
      elements.poemGrid.innerHTML =
        '<p class="empty-state">संग्रह लोड नहीं हो सका। कृपया स्थानीय वेब सर्वर से यह पुस्तक खोलें।</p>';
    }
  }
}

start();
