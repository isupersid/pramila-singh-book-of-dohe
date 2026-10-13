const PAGE_SIZE = 24;
const FAVORITES_KEY = "pramila-poetry-favorites";

const elements = {
  totalCount: document.querySelector("#total-count"),
  yearCount: document.querySelector("#year-count"),
  featuredCard: document.querySelector("#featured-card"),
  featuredTitle: document.querySelector(".featured-title"),
  featuredLines: document.querySelector(".featured-lines"),
  startReading: document.querySelector("#start-reading"),
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
  readerRaw: document.querySelector("#reader-raw"),
  originalNote: document.querySelector(".original-note"),
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
  visible: [],
  selectedYear: "all",
  favoritesOnly: false,
  renderedCount: PAGE_SIZE,
  currentPoem: null,
  isTurning: false,
  favorites: new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]")),
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

function renderReader(poem, updateHash = true) {
  state.currentPoem = poem;
  elements.readerNumber.textContent = `पृष्ठ ${formatNumber(poem.number)} · ${
    poem.date ? new Intl.DateTimeFormat("hi-IN", { dateStyle: "long" }).format(new Date(`${poem.date}T00:00:00`)) : "दिनांक उपलब्ध नहीं"
  }`;
  elements.readerTitle.textContent = poem.title;
  elements.readerRaw.textContent = poem.raw;
  elements.originalNote.open = false;
  elements.readerBody.replaceChildren(
    ...poem.body.map((line) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = line || "\u00a0";
      return paragraph;
    }),
  );

  elements.artworkImage.onload = null;
  elements.artworkImage.onerror = null;
  elements.artworkImage.hidden = true;
  elements.artPlaceholder.hidden = true;

  if (poem.artwork) {
    const expectedArtwork = poem.artwork;
    const revealArtwork = () => {
      if (state.currentPoem?.artwork === expectedArtwork) {
        elements.artworkImage.hidden = false;
      }
    };
    const showArtworkFallback = () => {
      if (state.currentPoem?.artwork === expectedArtwork) {
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

  const index = state.poems.findIndex((entry) => entry.id === poem.id);
  elements.previousPoem.disabled = index <= 0;
  elements.nextPoem.disabled = index >= state.poems.length - 1;
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
  elements.reader.classList.remove("is-turning");
  elements.turningSheet.classList.remove("turn-next", "turn-previous");
  elements.turningSheet.hidden = true;
  elements.reader.close();
  if (location.hash.startsWith("#poem=")) {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
}

function cloneCurrentPageForTurn() {
  const clone = elements.poemPage.cloneNode(true);
  clone.classList.add("turning-page-clone");
  clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  clone.querySelectorAll("button, summary").forEach((element) => {
    element.setAttribute("tabindex", "-1");
  });
  elements.turningFront.replaceChildren(clone);
  clone.scrollTop = elements.poemPage.scrollTop;
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

function moveReader(direction) {
  if (state.isTurning) return;
  const index = state.poems.findIndex((poem) => poem.id === state.currentPoem?.id);
  const next = state.poems[index + direction];
  if (!next) return;

  const useSimpleTransition =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (useSimpleTransition) {
    renderReader(next);
    return;
  }

  state.isTurning = true;
  elements.reader.classList.add("is-turning");

  if (direction > 0) {
    cloneCurrentPageForTurn();
  } else {
    const current = state.currentPoem;
    cloneArtworkPageForTurn(current);
    renderReader(next, false);
    cloneCurrentPageForTurn();
    renderReader(current, false);
  }

  elements.turningSheet.hidden = false;
  elements.turningSheet.classList.remove("turn-next", "turn-previous");

  if (direction > 0) {
    renderReader(next);
    cloneArtworkPageForTurn(next);
  }

  void elements.turningSheet.offsetWidth;
  elements.turningSheet.classList.add(direction > 0 ? "turn-next" : "turn-previous");

  if (direction < 0) {
    window.setTimeout(() => renderReader(next), 350);
  }
  elements.turningSheet.addEventListener(
    "animationend",
    () => {
      elements.turningSheet.classList.remove("turn-next", "turn-previous");
      elements.turningSheet.hidden = true;
      elements.turningBack.replaceChildren();
      elements.reader.classList.remove("is-turning");
      state.isTurning = false;
    },
    { once: true },
  );
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
  elements.startReading?.addEventListener("click", () => {
    if (state.poems.length) openReader(state.poems[0]);
  });
  elements.randomButton?.addEventListener("click", openRandomPoem);
  elements.readerClose.addEventListener("click", closeReader);
  elements.reader.addEventListener("click", (event) => {
    if (event.target === elements.reader) closeReader();
  });
  elements.reader.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeReader();
  });
  elements.favoriteButton.addEventListener("click", () => {
    if (state.currentPoem) toggleFavorite(state.currentPoem.id);
  });
  elements.previousPoem.addEventListener("click", () => moveReader(-1));
  elements.nextPoem.addEventListener("click", () => moveReader(1));
  elements.copyLink.addEventListener("click", copyCurrentLink);
  elements.printPoem.addEventListener("click", () => window.print());
  window.addEventListener("keydown", (event) => {
    if (!elements.reader.open) return;
    if (event.key === "ArrowLeft") moveReader(-1);
    if (event.key === "ArrowRight") moveReader(1);
  });
  window.addEventListener("hashchange", openHashPoem);
}

async function start() {
  try {
    const [poemsResponse, statsResponse] = await Promise.all([
      fetch("data/poems.json"),
      fetch("data/stats.json"),
    ]);
    if (!poemsResponse.ok || !statsResponse.ok) {
      throw new Error("Collection files could not be loaded.");
    }
    const [poems, stats] = await Promise.all([
      poemsResponse.json(),
      statsResponse.json(),
    ]);
    state.poems = poems;
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
