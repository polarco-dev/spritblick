const API_ENDPOINT = "api/prices.php";
const FAVORITES_STORAGE_KEY = "spritblick-favorites-v1";
const FAVORITES_STORAGE_BACKUP_KEY = "spritblick-favorites-v1-backup";
const THEME_STORAGE_KEY = "spritblick-theme";
const THEME_SWITCH_CLASS = "theme-switching";
const THEME_SWITCH_DURATION_MS = 140;
const THEME_ICON_SUN = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="12" r="3.5"></circle>
    <path d="M12 2.5V5"></path>
    <path d="M12 19V21.5"></path>
    <path d="M4.9 4.9L6.7 6.7"></path>
    <path d="M17.3 17.3L19.1 19.1"></path>
    <path d="M2.5 12H5"></path>
    <path d="M19 12H21.5"></path>
    <path d="M4.9 19.1L6.7 17.3"></path>
    <path d="M17.3 6.7L19.1 4.9"></path>
  </svg>
`;
const THEME_ICON_MOON = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M20 14.2A8.3 8.3 0 1 1 9.8 4 6.8 6.8 0 0 0 20 14.2z"></path>
  </svg>
`;

const FUEL_LABELS = {
  e5: "Super E5",
  e10: "Super E10",
  diesel: "Diesel"
};

const PRICE_FORMATTER = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3
});

const DISTANCE_FORMATTER = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

const TIME_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const searchForm = document.querySelector("#searchForm");
const searchQueryInput = document.querySelector("#searchQuery");
const radiusSelect = document.querySelector("#radiusSelect");
const fuelSelect = document.querySelector("#fuelSelect");
const searchButton = document.querySelector("#searchButton");
const nearbyButton = document.querySelector("#nearbyButton");
const searchResults = document.querySelector("#searchResults");
const favoritesGrid = document.querySelector("#favoritesGrid");
const searchMeta = document.querySelector("#searchMeta");
const favoritesMeta = document.querySelector("#favoritesMeta");
const searchCount = document.querySelector("#searchCount");
const searchSortSelect = document.querySelector("#searchSort");
const favoritesCount = document.querySelector("#favoritesCount");
const favoritesToggle = document.querySelector("#favoritesToggle");
const favoritesToggleCount = document.querySelector("#favoritesToggleCount");
const favoritesDrawer = document.querySelector("#favoritesDrawer");
const favoritesOverlay = document.querySelector("#favoritesOverlay");
const favoritesClose = document.querySelector("#favoritesClose");
const themeToggle = document.querySelector("#themeToggle");
const themeToggleIcon = document.querySelector("#themeToggleIcon");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');
let favoritesStorageAvailable = true;

const appState = {
  fuel: "e5",
  searching: false,
  loadingFavorites: false,
  searchResults: [],
  favorites: loadFavorites(),
  favoritePriceMap: {},
  lastSearch: null,
  searchSort: "price",
  searchFetchedAt: null,
  favoritesFetchedAt: null,
  favoritesDrawerOpen: false
};

function getStoredTheme() {
  try {
    const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    return savedTheme === "dark" || savedTheme === "light" ? savedTheme : null;
  } catch (error) {
    return null;
  }
}

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  const resolvedTheme = theme === "dark" ? "dark" : "light";
  const isDark = resolvedTheme === "dark";

  document.documentElement.setAttribute("data-theme", resolvedTheme);

  if (themeToggle) {
    themeToggle.setAttribute("aria-pressed", String(isDark));
    themeToggle.setAttribute("aria-label", isDark ? "Zum Light-Modus wechseln" : "Zum Dark-Modus wechseln");
  }

  if (themeToggleIcon) {
    themeToggleIcon.innerHTML = isDark ? THEME_ICON_MOON : THEME_ICON_SUN;
  }

  if (themeColorMeta) {
    themeColorMeta.setAttribute("content", isDark ? "#151f31" : "#cb2534");
  }
}

function initThemeToggle() {
  applyTheme(getStoredTheme() || getSystemTheme());

  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const nextTheme = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.classList.add(THEME_SWITCH_CLASS);
      applyTheme(nextTheme);
      window.setTimeout(() => {
        document.documentElement.classList.remove(THEME_SWITCH_CLASS);
      }, THEME_SWITCH_DURATION_MS);

      try {
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
      } catch (error) {}
    });
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function readStorageItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    favoritesStorageAvailable = false;
    return null;
  }
}

function writeStorageItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    favoritesStorageAvailable = false;
    return false;
  }
}

function parseFavoritesPayload(raw) {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return null;
    }

    const normalized = parsed.map(normalizeFavoriteStation).filter((entry) => entry !== null);
    return deduplicateFavorites(normalized);
  } catch (error) {
    return null;
  }
}

function loadFavorites() {
  const primary = parseFavoritesPayload(readStorageItem(FAVORITES_STORAGE_KEY));
  if (Array.isArray(primary)) {
    return primary;
  }

  const backup = parseFavoritesPayload(readStorageItem(FAVORITES_STORAGE_BACKUP_KEY));
  if (Array.isArray(backup)) {
    return backup;
  }

  return [];
}

function saveFavorites() {
  const normalized = appState.favorites.map(normalizeFavoriteStation).filter((entry) => entry !== null);
  appState.favorites = deduplicateFavorites(normalized);

  const serialized = JSON.stringify(appState.favorites);
  const savedPrimary = writeStorageItem(FAVORITES_STORAGE_KEY, serialized);
  const savedBackup = writeStorageItem(FAVORITES_STORAGE_BACKUP_KEY, serialized);

  return savedPrimary || savedBackup;
}

function normalizeFavoriteStation(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = typeof entry.id === "string" ? entry.id.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return null;
  }

  return {
    id,
    name: String(entry.name || "Tankstelle"),
    brand: String(entry.brand || ""),
    street: String(entry.street || ""),
    houseNumber: String(entry.houseNumber || ""),
    postCode: entry.postCode != null ? String(entry.postCode) : "",
    place: String(entry.place || ""),
    lat: Number.isFinite(Number(entry.lat)) ? Number(entry.lat) : null,
    lng: Number.isFinite(Number(entry.lng)) ? Number(entry.lng) : null
  };
}

function pickFavoriteFields(station) {
  return normalizeFavoriteStation({
    id: station.id,
    name: station.name,
    brand: station.brand,
    street: station.street,
    houseNumber: station.houseNumber,
    postCode: station.postCode,
    place: station.place,
    lat: station.lat,
    lng: station.lng
  });
}

function deduplicateFavorites(stations) {
  const seenIds = new Set();
  const unique = [];

  for (const station of stations) {
    if (!station || seenIds.has(station.id)) {
      continue;
    }

    seenIds.add(station.id);
    unique.push(station);
  }

  return unique;
}

function formatPrice(value) {
  if (!Number.isFinite(value)) {
    return "n. v.";
  }

  return PRICE_FORMATTER.format(value);
}

function renderPriceMarkup(value) {
  if (!Number.isFinite(value)) {
    return `<span class="price-value price-value-missing">${formatPrice(value)}</span>`;
  }

  return `<span class="price-value">${formatPrice(value)}</span><span class="price-unit">EUR/l</span>`;
}

function formatDistance(value) {
  if (!Number.isFinite(value)) {
    return "Distanz n. v.";
  }

  return `${DISTANCE_FORMATTER.format(value)} km`;
}

function formatTimestamp(isoText) {
  if (!isoText) {
    return "";
  }

  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return TIME_FORMATTER.format(date);
}

function getAddressLine(station) {
  const streetPart = [station.street, station.houseNumber].filter(Boolean).join(" ");
  const placePart = [station.postCode, station.place].filter(Boolean).join(" ");

  if (streetPart && placePart) {
    return `${streetPart}, ${placePart}`;
  }

  if (streetPart || placePart) {
    return streetPart || placePart;
  }

  return "Keine Adressdaten";
}

function buildGoogleMapsUrl(station) {
  const lat = Number(station?.lat);
  const lng = Number(station?.lng);

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  }

  const fallbackQuery = [station?.name, getAddressLine(station)].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackQuery || "Tankstelle")}`;
}

function isFavorite(stationId) {
  return appState.favorites.some((station) => station.id === stationId);
}

function getSearchStatus(station) {
  if (station.isOpen === false) {
    return { label: "Geschlossen", className: "inactive" };
  }

  if (!Number.isFinite(Number(station.selectedPrice))) {
    return { label: "Kein Preis", className: "error" };
  }

  return { label: "Live", className: "live" };
}

function getFavoriteStatus(priceEntry) {
  if (!priceEntry) {
    return { label: "Lädt", className: "inactive" };
  }

  if (!priceEntry.ok) {
    return { label: "Fehler", className: "error" };
  }

  if (priceEntry.stale) {
    return { label: "Cache", className: "stale" };
  }

  if (priceEntry.isOpen === false) {
    return { label: "Geschlossen", className: "inactive" };
  }

  if (!Number.isFinite(Number(priceEntry.selectedPrice))) {
    return { label: "Kein Preis", className: "error" };
  }

  return { label: "Live", className: "live" };
}

function setUiLoadingState() {
  const hasBusyState = appState.searching || appState.loadingFavorites;
  searchButton.disabled = hasBusyState;
  nearbyButton.disabled = hasBusyState;
  radiusSelect.disabled = hasBusyState;
  fuelSelect.disabled = hasBusyState;
  if (searchSortSelect) {
    searchSortSelect.disabled = appState.searching;
  }

  searchButton.textContent = appState.searching ? "Suche läuft ..." : "Suchen";
}

function setSearchMeta(text) {
  searchMeta.textContent = text;
}

function setFavoritesMeta(text) {
  if (!favoritesMeta) {
    return;
  }

  favoritesMeta.textContent = text;
}

function setFavoritesDrawerOpen(nextState) {
  const isOpen = Boolean(nextState);
  appState.favoritesDrawerOpen = isOpen;

  if (favoritesDrawer) {
    favoritesDrawer.classList.toggle("open", isOpen);
    favoritesDrawer.setAttribute("aria-hidden", String(!isOpen));
    favoritesDrawer.inert = !isOpen;
  }

  if (favoritesOverlay) {
    favoritesOverlay.hidden = !isOpen;
    favoritesOverlay.classList.toggle("is-visible", isOpen);
  }

  if (favoritesToggle) {
    favoritesToggle.setAttribute("aria-expanded", String(isOpen));
  }

  document.body.classList.toggle("favorites-open", isOpen);

  if (isOpen && favoritesClose) {
    try {
      favoritesClose.focus({ preventScroll: true });
    } catch (error) {
      favoritesClose.focus();
    }
  }
}

function toggleFavoritesDrawer() {
  setFavoritesDrawerOpen(!appState.favoritesDrawerOpen);
}

function syncFavoritesToggleUi() {
  if (favoritesCount) {
    favoritesCount.textContent = `${appState.favorites.length} Favoriten`;
  }

  if (favoritesToggleCount) {
    favoritesToggleCount.textContent = String(appState.favorites.length);
  }

  if (favoritesToggle) {
    favoritesToggle.setAttribute("aria-label", `${appState.favorites.length} Favoriten öffnen`);
  }
}

function createEmptyCardMarkup({ icon, title, text }) {
  return `
    <article class="empty-card">
      <span class="empty-icon" aria-hidden="true">${escapeHtml(icon)}</span>
      <h3 class="empty-title">${escapeHtml(title)}</h3>
      <p class="empty-text">${escapeHtml(text)}</p>
    </article>
  `;
}

function createSkeletonCardsMarkup(count = 4) {
  const items = Array.from({ length: count }, () => `
    <article class="skeleton-card" aria-hidden="true">
      <div class="skeleton-line w55"></div>
      <div class="skeleton-line w70"></div>
      <div class="skeleton-line lg"></div>
      <div class="skeleton-line w40"></div>
      <div class="skeleton-line"></div>
    </article>
  `);

  return items.join("");
}

function getStationComparablePrice(station) {
  const price = Number(station?.selectedPrice);
  return Number.isFinite(price) ? price : Number.POSITIVE_INFINITY;
}

function getStationComparableDistance(station) {
  const distance = Number(station?.dist);
  return Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
}

function compareStationNames(left, right) {
  return String(left?.name || "").localeCompare(String(right?.name || ""), "de-DE", {
    sensitivity: "base",
    numeric: true
  });
}

function getSortedSearchResults() {
  const sortedResults = [...appState.searchResults];

  sortedResults.sort((left, right) => {
    if (appState.searchSort === "distance") {
      const distanceDiff = getStationComparableDistance(left) - getStationComparableDistance(right);
      if (distanceDiff !== 0) {
        return distanceDiff;
      }

      const priceDiff = getStationComparablePrice(left) - getStationComparablePrice(right);
      if (priceDiff !== 0) {
        return priceDiff;
      }

      return compareStationNames(left, right);
    }

    if (appState.searchSort === "name") {
      const nameDiff = compareStationNames(left, right);
      if (nameDiff !== 0) {
        return nameDiff;
      }

      const priceDiff = getStationComparablePrice(left) - getStationComparablePrice(right);
      if (priceDiff !== 0) {
        return priceDiff;
      }

      return getStationComparableDistance(left) - getStationComparableDistance(right);
    }

    const priceDiff = getStationComparablePrice(left) - getStationComparablePrice(right);
    if (priceDiff !== 0) {
      return priceDiff;
    }

    const distanceDiff = getStationComparableDistance(left) - getStationComparableDistance(right);
    if (distanceDiff !== 0) {
      return distanceDiff;
    }

    return compareStationNames(left, right);
  });

  return sortedResults;
}

function getCheapestSearchStationId() {
  let cheapestStationId = null;
  let cheapestPrice = Number.POSITIVE_INFINITY;

  for (const station of appState.searchResults) {
    const price = getStationComparablePrice(station);
    if (price < cheapestPrice) {
      cheapestPrice = price;
      cheapestStationId = station?.id ?? null;
    }
  }

  return cheapestStationId;
}

function renderSearchResults() {
  if (appState.searching) {
    searchResults.innerHTML = createSkeletonCardsMarkup(6);
    searchCount.textContent = "Lädt ...";
    return;
  }

  if (!appState.searchResults.length) {
    searchResults.innerHTML = createEmptyCardMarkup({
      icon: "⛽",
      title: "Keine Suchergebnisse",
      text: "Passe Ort, Radius oder Kraftstoff an und starte eine neue Suche."
    });
    searchCount.textContent = "0 Treffer";
    return;
  }

  const sortedResults = getSortedSearchResults();
  const cheapestStationId = getCheapestSearchStationId();
  searchCount.textContent = `${sortedResults.length} Treffer`;
  const showDistance = appState.lastSearch?.mode === "nearby";

  searchResults.innerHTML = sortedResults.map((station, index) => {
    const status = getSearchStatus(station);
    const favorite = isFavorite(station.id);
    const brand = station.brand ? station.brand : "Marke n. v.";
    const mapsUrl = buildGoogleMapsUrl(station);
    const isBest = cheapestStationId !== null && station.id === cheapestStationId;
    const updatedLabel = appState.searchFetchedAt ? `Stand: ${formatTimestamp(appState.searchFetchedAt)}` : "Stand: aktuell";
    const distanceMarkup = showDistance
      ? `<p class="meta-item">${escapeHtml(formatDistance(Number(station.dist)))}</p>`
      : "";

    return `
      <article class="station-card result-card ${isBest ? "is-best" : ""}" style="--card-index:${index};">
        <div class="card-head">
          <div class="card-title-wrap">
            <div class="station-label">
              <span class="station-icon" aria-hidden="true">⛽</span>
              <h3 class="station-name">${escapeHtml(station.name || "Tankstelle")}</h3>
            </div>
            <p class="station-brand">${escapeHtml(brand)}</p>
            <p class="station-address">${escapeHtml(getAddressLine(station))}</p>
          </div>
          ${isBest ? '<span class="chip best">Günstigster Preis</span>' : `<span class="rank-badge">#${index + 1}</span>`}
        </div>

        <div class="price-block">
          <p class="price-label">${escapeHtml(FUEL_LABELS[appState.fuel])}</p>
          <p class="station-price">${renderPriceMarkup(Number(station.selectedPrice))}</p>
          <p class="price-subline">${escapeHtml(updatedLabel)}</p>
        </div>

        <div class="card-meta ${showDistance ? "" : "only-status"}">
          ${distanceMarkup}
          <span class="status-chip ${status.className}">${status.label}</span>
        </div>

        <div class="card-actions">
          <a
            class="map-link button-ghost"
            href="${escapeHtml(mapsUrl)}"
            target="_blank"
            rel="noopener noreferrer"
          >
            Auf der Karte anzeigen
          </a>
          <button
            class="fav-button ${favorite ? "active" : ""}"
            type="button"
            data-action="toggle-favorite"
            data-station-id="${escapeHtml(station.id)}"
          >
            ${favorite ? "★ In Favoriten" : "☆ Zu Favoriten"}
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function sortFavoriteStationsByPrice(stations) {
  return [...stations].sort((left, right) => {
    const leftPrice = Number(appState.favoritePriceMap[left.id]?.selectedPrice);
    const rightPrice = Number(appState.favoritePriceMap[right.id]?.selectedPrice);
    const leftComparable = Number.isFinite(leftPrice) ? leftPrice : Number.POSITIVE_INFINITY;
    const rightComparable = Number.isFinite(rightPrice) ? rightPrice : Number.POSITIVE_INFINITY;

    if (leftComparable !== rightComparable) {
      return leftComparable - rightComparable;
    }

    return (left.name || "").localeCompare(right.name || "", "de-DE");
  });
}

function renderFavorites() {
  syncFavoritesToggleUi();

  if (appState.loadingFavorites && appState.favorites.length > 0 && Object.keys(appState.favoritePriceMap).length === 0) {
    favoritesGrid.innerHTML = createSkeletonCardsMarkup(Math.min(4, Math.max(2, appState.favorites.length)));
    return;
  }

  if (appState.favorites.length === 0) {
    favoritesGrid.innerHTML = createEmptyCardMarkup({
      icon: "☆",
      title: "Noch keine Favoriten",
      text: "Speichere Tankstellen aus den Suchergebnissen, um sie hier schnell wiederzufinden."
    });
    return;
  }

  const sortedFavorites = sortFavoriteStationsByPrice(appState.favorites);

  favoritesGrid.innerHTML = sortedFavorites.map((station, index) => {
    const priceEntry = appState.favoritePriceMap[station.id];
    const status = getFavoriteStatus(priceEntry);
    const selectedPrice = Number(priceEntry?.selectedPrice);
    const updateTime = priceEntry?.cachedAt || appState.favoritesFetchedAt;
    const updateLabel = updateTime ? `Stand: ${formatTimestamp(updateTime)}` : "Stand: n. v.";
    const placeLabel = [station.postCode, station.place].filter(Boolean).join(" ");

    return `
      <article class="station-card favorite-card" style="--card-index:${index};">
        <div class="card-head">
          <div class="card-title-wrap">
            <div class="station-label">
              <span class="station-icon" aria-hidden="true">⛽</span>
              <h3 class="station-name">${escapeHtml(station.name || "Tankstelle")}</h3>
            </div>
            <p class="station-brand">${escapeHtml(station.brand || "Favorit")}</p>
            <p class="station-address">${escapeHtml(getAddressLine(station))}</p>
          </div>
          <span class="status-chip ${status.className}">${status.label}</span>
        </div>

        <div class="price-block">
          <p class="price-label">${escapeHtml(FUEL_LABELS[appState.fuel])}</p>
          <p class="station-price">${renderPriceMarkup(selectedPrice)}</p>
          <p class="price-subline">${escapeHtml(updateLabel)}</p>
        </div>

        <div class="card-meta">
          <p class="meta-item">${escapeHtml(placeLabel || "Ort n. v.")}</p>
          <p class="meta-item">${escapeHtml(priceEntry?.source === "cache" ? "Quelle: Cache" : "Quelle: Live")}</p>
        </div>

        <button
          class="fav-button active"
          type="button"
          data-action="remove-favorite"
          data-station-id="${escapeHtml(station.id)}"
        >
          Entfernen
        </button>
      </article>
    `;
  }).join("");
}

function addFavorite(station) {
  const favorite = pickFavoriteFields(station);
  if (!favorite || isFavorite(favorite.id)) {
    return;
  }

  appState.favorites.push(favorite);
  const saved = saveFavorites();
  renderSearchResults();
  renderFavorites();

  if (!saved) {
    setFavoritesMeta("Favoriten konnten nicht dauerhaft gespeichert werden (Browser-Speicher blockiert).");
  } else {
    setFavoritesMeta("Favorit gespeichert. Preise werden aktualisiert ...");
  }
  refreshFavorites().catch(() => {});
}

function removeFavorite(stationId) {
  appState.favorites = appState.favorites.filter((station) => station.id !== stationId);
  delete appState.favoritePriceMap[stationId];

  if (appState.favorites.length === 0) {
    appState.favoritePriceMap = {};
    appState.favoritesFetchedAt = null;
  }

  const saved = saveFavorites();
  renderSearchResults();
  renderFavorites();

  if (!saved) {
    setFavoritesMeta("Favoriten konnten nicht dauerhaft gespeichert werden (Browser-Speicher blockiert).");
  } else if (appState.favorites.length === 0) {
    setFavoritesMeta("Keine Favoriten gespeichert.");
  } else if (appState.favoritesFetchedAt) {
    setFavoritesMeta(`Zuletzt aktualisiert: ${formatTimestamp(appState.favoritesFetchedAt)}`);
  }
}

async function fetchApi(params) {
  const query = new URLSearchParams(params);
  query.set("_", String(Date.now()));

  const response = await fetch(`${API_ENDPOINT}?${query.toString()}`, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`Serverfehler ${response.status}`);
  }

  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `Serverfehler ${response.status}`);
  }

  return payload;
}

async function executeSearch(params, labelPrefix) {
  appState.searching = true;
  setUiLoadingState();
  renderSearchResults();
  setSearchMeta("Suche läuft. Preise werden geladen ...");

  try {
    const payload = await fetchApi(params);
    appState.searchResults = Array.isArray(payload.stations) ? payload.stations : [];
    appState.searchFetchedAt = payload?.fetchedAt || new Date().toISOString();

    const locationLabel = payload?.location?.label ? String(payload.location.label) : "";
    const timeLabel = formatTimestamp(appState.searchFetchedAt);
    const resultCount = payload?.count || appState.searchResults.length;

    if (resultCount === 0) {
      setSearchMeta(`${labelPrefix}${locationLabel ? ` · ${locationLabel}` : ""} · Keine Treffer im gewählten Radius.`);
    } else {
      setSearchMeta(`${resultCount} Treffer${locationLabel ? ` · ${locationLabel}` : ""} · Aktualisiert: ${timeLabel}`);
    }
  } catch (error) {
    appState.searchResults = [];
    appState.searchFetchedAt = null;
    setSearchMeta(`Suche fehlgeschlagen: ${error.message}`);
  } finally {
    appState.searching = false;
    setUiLoadingState();
    renderSearchResults();
  }
}

async function searchByQuery() {
  const query = searchQueryInput.value.trim();
  if (!query) {
    setSearchMeta("Bitte gib einen Ort, eine Adresse oder eine PLZ ein.");
    return;
  }

  const radius = radiusSelect.value;
  const fuel = fuelSelect.value;
  appState.fuel = fuel;
  appState.lastSearch = { mode: "search", query, radius };

  await executeSearch({
    action: "search",
    q: query,
    radius,
    fuel,
    limit: 40
  }, "Suche");
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation wird vom Browser nicht unterstützt"));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      () => reject(new Error("Standortfreigabe verweigert")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

async function searchNearby() {
  const radius = radiusSelect.value;
  const fuel = fuelSelect.value;
  appState.fuel = fuel;

  try {
    const coords = await getCurrentPosition();
    appState.lastSearch = {
      mode: "nearby",
      lat: coords.latitude,
      lng: coords.longitude,
      radius
    };

    await executeSearch({
      action: "nearby",
      lat: coords.latitude.toFixed(6),
      lng: coords.longitude.toFixed(6),
      radius,
      fuel,
      limit: 40
    }, "Standortsuche");
  } catch (error) {
    setSearchMeta(error.message);
  }
}

function mapPriceArrayToObject(stations) {
  const mapped = {};

  for (const entry of stations) {
    if (!entry || typeof entry !== "object" || !entry.id) {
      continue;
    }

    mapped[String(entry.id).toLowerCase()] = entry;
  }

  return mapped;
}

async function refreshFavorites() {
  if (appState.favorites.length === 0) {
    appState.favoritePriceMap = {};
    setFavoritesMeta("Keine Favoriten gespeichert.");
    renderFavorites();
    return;
  }

  appState.loadingFavorites = true;
  setUiLoadingState();
  renderFavorites();
  setFavoritesMeta("Favoriten werden aktualisiert ...");

  try {
    const ids = appState.favorites.map((station) => station.id).join(",");
    const payload = await fetchApi({
      action: "prices",
      ids,
      fuel: appState.fuel
    });

    appState.favoritePriceMap = mapPriceArrayToObject(Array.isArray(payload.stations) ? payload.stations : []);
    appState.favoritesFetchedAt = payload?.fetchedAt || new Date().toISOString();
    setFavoritesMeta(`Zuletzt aktualisiert: ${formatTimestamp(appState.favoritesFetchedAt)}`);
    renderFavorites();
  } catch (error) {
    setFavoritesMeta(`Aktualisierung fehlgeschlagen: ${error.message}`);
    renderFavorites();
  } finally {
    appState.loadingFavorites = false;
    setUiLoadingState();
  }
}

async function rerunLastSearch() {
  if (!appState.lastSearch) {
    return;
  }

  if (appState.lastSearch.mode === "search") {
    await executeSearch({
      action: "search",
      q: appState.lastSearch.query,
      radius: appState.lastSearch.radius,
      fuel: appState.fuel,
      limit: 40
    }, "Suche");
    return;
  }

  if (appState.lastSearch.mode === "nearby") {
    await executeSearch({
      action: "nearby",
      lat: Number(appState.lastSearch.lat).toFixed(6),
      lng: Number(appState.lastSearch.lng).toFixed(6),
      radius: appState.lastSearch.radius,
      fuel: appState.fuel,
      limit: 40
    }, "Standortsuche");
  }
}

function handleResultActions(event) {
  const button = event.target.closest("button[data-action='toggle-favorite']");
  if (!button) {
    return;
  }

  const stationId = String(button.getAttribute("data-station-id") || "").toLowerCase();
  if (!stationId) {
    return;
  }

  if (isFavorite(stationId)) {
    removeFavorite(stationId);
    return;
  }

  const station = appState.searchResults.find((entry) => String(entry.id).toLowerCase() === stationId);
  if (station) {
    addFavorite(station);
  }
}

function handleFavoriteActions(event) {
  const button = event.target.closest("button[data-action='remove-favorite']");
  if (!button) {
    return;
  }

  const stationId = String(button.getAttribute("data-station-id") || "").toLowerCase();
  if (!stationId) {
    return;
  }

  removeFavorite(stationId);
}

function initEvents() {
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    searchByQuery().catch(() => {});
  });

  if (searchSortSelect) {
    searchSortSelect.value = appState.searchSort;
    searchSortSelect.addEventListener("change", () => {
      const nextSort = searchSortSelect.value;
      if (!["price", "distance", "name"].includes(nextSort)) {
        searchSortSelect.value = appState.searchSort;
        return;
      }

      appState.searchSort = nextSort;
      renderSearchResults();
    });
  }

  nearbyButton.addEventListener("click", () => {
    searchNearby().catch(() => {});
  });

  fuelSelect.addEventListener("change", () => {
    appState.fuel = fuelSelect.value;
    Promise.all([refreshFavorites(), rerunLastSearch()]).catch(() => {});
  });

  if (favoritesToggle) {
    favoritesToggle.addEventListener("click", toggleFavoritesDrawer);
  }

  if (favoritesClose) {
    favoritesClose.addEventListener("click", () => {
      setFavoritesDrawerOpen(false);
    });
  }

  if (favoritesOverlay) {
    favoritesOverlay.addEventListener("click", () => {
      setFavoritesDrawerOpen(false);
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (appState.favoritesDrawerOpen) {
        setFavoritesDrawerOpen(false);
      }
    }
  });

  searchResults.addEventListener("click", handleResultActions);
  favoritesGrid.addEventListener("click", handleFavoriteActions);
}

function init() {
  const persisted = saveFavorites();

  initThemeToggle();
  initEvents();
  setFavoritesDrawerOpen(false);
  renderSearchResults();
  renderFavorites();
  setSearchMeta("");

  if (!favoritesStorageAvailable || !persisted) {
    setFavoritesMeta("Favoriten sind nur temporär verfügbar (Browser-Speicher blockiert).");
  } else if (appState.favorites.length) {
    setFavoritesMeta("Favoriten geladen. Preise werden aktualisiert.");
  } else {
    setFavoritesMeta("Keine Favoriten gespeichert.");
  }

  setUiLoadingState();
  refreshFavorites().catch(() => {});
}

init();
