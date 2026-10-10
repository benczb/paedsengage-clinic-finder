const SG_TZ = "Asia/Singapore";

const RESULTS_PER_PAGE = 5;

const state = {
  clinics: [],
  filtered: [],
  currentPage: 1,
  map: null,
  geocoder: null,
  infoWindow: null,
  markers: [],
  geocodeCache: {},
};

const els = {
  searchInput: document.getElementById("searchInput"),
  locationFilter: document.getElementById("locationFilter"),
  dayFilter: document.getElementById("dayFilter"),
  openByFilter: document.getElementById("openByFilter"),
  closeAfterFilter: document.getElementById("closeAfterFilter"),
  openNowFilter: document.getElementById("openNowFilter"),
  resetFilters: document.getElementById("resetFilters"),
  results: document.getElementById("results"),
  resultsSummary: document.getElementById("resultsSummary"),
  resultsPagination: document.getElementById("resultsPagination"),
  mapStatus: document.getElementById("mapStatus"),
};

window.initPaedsEngageMap = async function initPaedsEngageMap() {
  try {
    hydrateGeocodeCache();
    state.map = new google.maps.Map(document.getElementById("map"), {
      center: { lat: 1.3521, lng: 103.8198 },
      zoom: 11,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });
    state.geocoder = new google.maps.Geocoder();
    state.infoWindow = new google.maps.InfoWindow();
    renderMap();
  } catch (error) {
    console.error(error);
    els.mapStatus.textContent = "Unable to enable the map. Clinic search is still available below.";
  }
};

(async function bootstrap() {
  try {
    await loadClinics();
    wireEvents();
    populateLocationFilter();
    applyFilters();
  } catch (error) {
    console.error(error);
    els.mapStatus.textContent = "Unable to load clinic data.";
    els.results.innerHTML = `<div class="empty-state">Failed to load clinic data. Check the browser console for details.</div>`;
    return;
  }

  const apiKey = window.PAEDSENGAGE_CONFIG?.googleMapsApiKey;
  if (!apiKey || apiKey.startsWith("REPLACE_")) {
    els.mapStatus.textContent = "Map is disabled because the Google Maps API key is not configured. Clinic search and results are available below.";
    return;
  }

  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=window.initPaedsEngageMap`;
  script.async = true;
  script.defer = true;
  script.onerror = () => {
    els.mapStatus.textContent = "Unable to load Google Maps. Clinic search and results are available below.";
  };
  document.head.appendChild(script);
})();

async function loadClinics() {
  const response = await fetch(window.PAEDSENGAGE_CONFIG.dataUrl);
  state.clinics = await response.json();
}

function wireEvents() {
  [
    els.searchInput,
    els.locationFilter,
    els.dayFilter,
    els.openByFilter,
    els.closeAfterFilter,
    els.openNowFilter,
  ].forEach((el) => el.addEventListener("input", applyFilters));

  els.resetFilters.addEventListener("click", () => {
    els.searchInput.value = "";
    els.locationFilter.value = "";
    els.dayFilter.value = "";
    els.openByFilter.value = "";
    els.closeAfterFilter.value = "";
    els.openNowFilter.checked = false;
    applyFilters();
  });
}

function populateLocationFilter() {
  const locations = [...new Set(state.clinics.map((clinic) => clinic.location))].sort();
  for (const location of locations) {
    const option = document.createElement("option");
    option.value = location;
    option.textContent = location;
    els.locationFilter.appendChild(option);
  }
}

function applyFilters() {
  const search = els.searchInput.value.trim().toLowerCase();
  const location = els.locationFilter.value;
  const day = els.dayFilter.value;
  const openBy = toMinutes(els.openByFilter.value);
  const closeAfter = toMinutes(els.closeAfterFilter.value);
  const openNow = els.openNowFilter.checked;
  const nowInfo = getSingaporeNow();

  state.filtered = state.clinics.filter((clinic) => {
    const haystack = [clinic.location, clinic.clinic_name, clinic.address, ...(clinic.doctors || [])].join(" ").toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (location && clinic.location !== location) return false;
    if (openNow && !isOpenNow(clinic, nowInfo.day, nowInfo.minutes)) return false;
    if (day || openBy !== null || closeAfter !== null) {
      const targetDay = day || nowInfo.day;
      if (!matchesDayAndTime(clinic, targetDay, openBy, closeAfter)) return false;
    }
    return true;
  });

  state.currentPage = 1;
  renderResults(nowInfo);
  renderMap();
}

function getVisibleResults() {
  const startIndex = (state.currentPage - 1) * RESULTS_PER_PAGE;
  return state.filtered.slice(startIndex, startIndex + RESULTS_PER_PAGE);
}

function renderResults(nowInfo) {
  const count = state.filtered.length;
  const totalPages = Math.max(1, Math.ceil(count / RESULTS_PER_PAGE));
  state.currentPage = Math.min(state.currentPage, totalPages);
  const startIndex = (state.currentPage - 1) * RESULTS_PER_PAGE;
  const endIndex = startIndex + RESULTS_PER_PAGE;
  const visibleResults = getVisibleResults();

  els.resultsSummary.textContent = count
    ? `${count} clinic${count === 1 ? "" : "s"} found · showing ${startIndex + 1}-${Math.min(endIndex, count)} of ${count}`
    : "0 clinics found";

  if (!count) {
    els.results.innerHTML = `<div class="empty-state">No clinics matched the current filters.</div>`;
    els.resultsPagination.innerHTML = "";
    return;
  }

  els.results.innerHTML = visibleResults
    .map((clinic) => {
      const open = isOpenNow(clinic, nowInfo.day, nowInfo.minutes);
      const doctorText = (clinic.doctors || []).join(", ");
      const phoneText = (clinic.contacts || []).join(" / ") || "Not listed";
      const hoursHtml = clinic.schedule.days
        .map((dayEntry) => {
          const times = dayEntry.time_blocks.map((block) => block.display).join(", ") || "Closed";
          const notes = dayEntry.notes.length ? `<div class="hours-note">${escapeHtml(dayEntry.notes.join(" · "))}</div>` : "";
          return `<div class="hours-row"><strong>${escapeHtml(dayEntry.day)}</strong><div><div>${escapeHtml(times)}</div>${notes}</div></div>`;
        })
        .join("");

      return `
        <article class="card">
          <h3>${escapeHtml(clinic.clinic_name)}</h3>
          <p class="clinic-meta"><strong>${escapeHtml(clinic.location)}</strong><br />${escapeHtml(clinic.address)}</p>
          <div class="tag-row">
            <span class="tag ${open ? "open" : "closed"}">${open ? "Open now" : "Closed now"}</span>
            <span class="tag">${escapeHtml(phoneText)}</span>
          </div>
          <details class="clinic-details">
            <summary>View doctors, map link, and operating hours</summary>
            <p class="clinic-meta"><strong>Doctors:</strong> ${escapeHtml(doctorText || "Not listed")}</p>
            <p class="clinic-meta">
              <a href="${clinic.google_maps_url}" target="_blank" rel="noreferrer">Open in Google Maps</a>
            </p>
            <div class="hours-list">${hoursHtml}</div>
          </details>
        </article>`;
    })
    .join("");

  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  if (totalPages <= 1) {
    els.resultsPagination.innerHTML = "";
    return;
  }

  const pageWindowStart = Math.floor((state.currentPage - 1) / 5) * 5 + 1;
  const pageWindowEnd = Math.min(pageWindowStart + 4, totalPages);
  const pageButtons = Array.from({ length: pageWindowEnd - pageWindowStart + 1 }, (_, index) => {
    const page = pageWindowStart + index;
    const resultStart = (page - 1) * RESULTS_PER_PAGE + 1;
    const resultEnd = Math.min(page * RESULTS_PER_PAGE, state.filtered.length);
    return `<button type="button" class="page-button ${page === state.currentPage ? "active" : ""}" data-page="${page}" aria-label="Show results ${resultStart} to ${resultEnd}">${page}</button>`;
  }).join("");

  els.resultsPagination.innerHTML = `
    <button type="button" class="page-button nav-button" data-page="prev" ${state.currentPage === 1 ? "disabled" : ""}>Previous 5</button>
    <div class="page-numbers">${pageButtons}</div>
    <button type="button" class="page-button nav-button" data-page="next" ${state.currentPage === totalPages ? "disabled" : ""}>Next 5</button>
  `;

  els.resultsPagination.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.page;
      if (target === "prev") state.currentPage -= 1;
      else if (target === "next") state.currentPage += 1;
      else state.currentPage = Number(target);
      renderResults(getSingaporeNow());
      renderMap();
      window.scrollTo({ top: els.results.offsetTop - 90, behavior: "smooth" });
    });
  });
}

async function renderMap() {
  clearMarkers();
  if (!state.map) return;

  const clinicsForMap = getVisibleResults();
  if (!clinicsForMap.length) {
    els.mapStatus.textContent = "No map results for the current filters.";
    return;
  }

  const bounds = new google.maps.LatLngBounds();
  let placed = 0;
  els.mapStatus.textContent = `Showing the ${clinicsForMap.length} clinic${clinicsForMap.length === 1 ? "" : "s"} on this results page…`;

  for (const clinic of clinicsForMap) {
    const coords = await getCoordinates(clinic);
    if (!coords) continue;

    const marker = new google.maps.Marker({
      map: state.map,
      position: coords,
      title: clinic.clinic_name,
    });
    marker.addListener("click", () => {
      state.infoWindow.setContent(`
        <div style="max-width:260px">
          <strong>${escapeHtml(clinic.clinic_name)}</strong><br/>
          ${escapeHtml(clinic.location)}<br/>
          ${escapeHtml(clinic.address)}<br/>
          <a href="${clinic.google_maps_url}" target="_blank" rel="noreferrer">Open in Google Maps</a>
        </div>`);
      state.infoWindow.open({ anchor: marker, map: state.map });
    });
    state.markers.push(marker);
    bounds.extend(coords);
    placed += 1;
  }

  if (placed) {
    state.map.fitBounds(bounds, 60);
    els.mapStatus.textContent = `Showing ${placed} clinic${placed === 1 ? "" : "s"} from the current results page on the map.`;
  } else {
    els.mapStatus.textContent = "No clinics could be geocoded yet. Check your Google Maps API setup.";
  }
}

async function getCoordinates(clinic) {
  if (clinic.latitude && clinic.longitude) {
    return { lat: Number(clinic.latitude), lng: Number(clinic.longitude) };
  }

  const cacheKey = clinic.address;
  if (state.geocodeCache[cacheKey]) {
    return state.geocodeCache[cacheKey];
  }

  return new Promise((resolve) => {
    state.geocoder.geocode({ address: `${clinic.address}, Singapore` }, (results, status) => {
      if (status === "OK" && results[0]) {
        const location = results[0].geometry.location;
        const coords = { lat: location.lat(), lng: location.lng() };
        state.geocodeCache[cacheKey] = coords;
        persistGeocodeCache();
        resolve(coords);
      } else {
        resolve(null);
      }
    });
  });
}

function clearMarkers() {
  for (const marker of state.markers) marker.setMap(null);
  state.markers = [];
}

function matchesDayAndTime(clinic, day, openByMinutes, closeAfterMinutes) {
  const entry = clinic.schedule.days.find((item) => item.day === day);
  if (!entry || !entry.time_blocks.length) return false;
  return entry.time_blocks.some((block) => {
    const opensOk = openByMinutes === null || block.start_minutes <= openByMinutes;
    const closesOk = closeAfterMinutes === null || normalizeEnd(block) >= closeAfterMinutes;
    return opensOk && closesOk;
  });
}

function isOpenNow(clinic, day, minutes) {
  const entry = clinic.schedule.days.find((item) => item.day === day);
  if (!entry) return false;
  return entry.time_blocks.some((block) => {
    const end = normalizeEnd(block);
    return minutes >= block.start_minutes && minutes <= end;
  });
}

function normalizeEnd(block) {
  return block.overnight ? block.end_minutes + 1440 : block.end_minutes;
}

function getSingaporeNow() {
  const now = new Date();
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: SG_TZ,
  }).format(now);
  const dayMap = { Mon: "Mon", Tue: "Tues", Wed: "Wed", Thu: "Thurs", Fri: "Fri", Sat: "Sat", Sun: "Sun" };
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: SG_TZ,
  })
    .format(now)
    .split(":")
    .map(Number);
  return { day: dayMap[weekday] || "Mon", minutes: parts[0] * 60 + parts[1] };
}

function toMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function hydrateGeocodeCache() {
  try {
    state.geocodeCache = JSON.parse(localStorage.getItem("paedsengageGeocodeCache") || "{}");
  } catch {
    state.geocodeCache = {};
  }
}

function persistGeocodeCache() {
  localStorage.setItem("paedsengageGeocodeCache", JSON.stringify(state.geocodeCache));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
