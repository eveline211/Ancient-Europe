const TAB_DEFS = [
  { key: "info", label: "Info" },
  { key: "flora", label: "Flora" },
  { key: "fauna", label: "Fauna" },
  { key: "video", label: "Video" },
];

const LAYER_TOGGLES = [
  { id: "archaeological-sites", label: "Archaeological sites", file: "data/layers/archaeological-sites.geojson", color: "#b5651d" },
  { id: "eveline-places", label: "Eveline's places", file: "data/layers/eveline-places.geojson", color: "#7a3e9d" },
];

// Present-day coastline and country borders, exported from QGIS as GeoJSON (EPSG:4326).
// Static outlines — same for every period, just toggled on/off for a "then vs now" reference.
const LINE_LAYERS = [
  { id: "coastline", label: "Coastline", file: "data/coastline.geojson", color: "#e63946", width: 1 },
  { id: "borders", label: "Countries", file: "data/borders.geojson", color: "#999999", width: 1 },
];

// Geographic place-name labels (e.g. "Doggerland", "the Alps"), styled by category.
// period_txt holds a single period id per point (labels spanning multiple periods
// are duplicated as separate points, one per period) — different from the
// "periods" array used on archaeological-sites/eveline-places.
const SYMBOL_LAYERS = [
  { id: "labels", label: "Labels", file: "data/labels.geojson" },
];
// The intended bottom-to-top stacking order of every overlay layer.
// setBasemapForPeriod() uses this to always re-insert the basemap
// below whichever overlay currently sits lowest, regardless of load order.
const OVERLAY_LAYER_ORDER = [
  ...LINE_LAYERS.map(l => l.id),
  ...LAYER_TOGGLES.map(l => l.id),
  ...SYMBOL_LAYERS.map(l => l.id),
];
const CATEGORY_TEXT_COLOR = [
  "match", ["get", "category"],
  "sea", "#2a6f97",
  "land", "#4a4a4a",
  "lake", "#1c7ed6",
  "icelake", "#4a90c2",
  "icesheet", "#3d6d8c",
  "mountains", "#6b4423",
  "coming soon", "#999999",
  "#333333"
];

const CATEGORY_TEXT_SIZE = [
  "match", ["get", "category"],
  "sea", 13,
  "land", 12,
  "lake", 12,
  "icelake", 11,
  "icesheet", 12,
  "mountains", 11,
  "coming soon", 11,
  12
];

const CATEGORY_TEXT_FONT = [
  "match", ["get", "category"],
  "coming soon", ["literal", ["Open Sans Italic"]],
  ["literal", ["Open Sans Regular"]]
];



let state = {
  periods: [],
  activePeriodId: null,
  activeTab: "info",
  periodContent: {}, // cache

  // Research essays ("deep dives"): one list file + one content file per essay,
  // same pattern as periods.json / periods/{id}.json.
  essays: [],
  activeEssayId: null,
  essayContent: {}, // cache

  // "map" | "essay" — controls which view is visible. Shares the same topbar.
  view: "map",

  layersOn: { "archaeological-sites": true, "eveline-places": true, "coastline": true, "borders": true, "labels": true },
};

let map;
let protocol;
let tilesMap;

async function init() {
  const periodsRes = await fetch("data/periods.json");
  const periodsData = await periodsRes.json();
  state.periods = periodsData.periods;
  state.activePeriodId = state.periods[0].id;

  const tilesRes = await fetch("data/tiles-map.json");
  tilesMap = await tilesRes.json();

  // Essay list — safe to skip silently if the file doesn't exist yet.
  try {
    const essaysRes = await fetch("data/essays.json");
    if (essaysRes.ok) {
      const essaysData = await essaysRes.json();
      state.essays = essaysData.essays;
    }
  } catch (e) {
    state.essays = [];
  }

  renderTimeline();
  renderToggles();
  renderTopics();
  document.getElementById("essay-back").addEventListener("click", closeEssay);

  await loadPeriodContent(state.activePeriodId);
  renderPanel();
  initMap();
}

async function loadPeriodContent(periodId) {
  if (state.periodContent[periodId]) return state.periodContent[periodId];
  const res = await fetch(`data/periods/${periodId}.json`);
  const data = await res.json();
  state.periodContent[periodId] = data;
  return data;
}

async function loadEssayContent(essayId) {
  if (state.essayContent[essayId]) return state.essayContent[essayId];
  const res = await fetch(`data/essays/${essayId}.json`);
  const data = await res.json();
  state.essayContent[essayId] = data;
  return data;
}

function renderTimeline() {
  const el = document.getElementById("timeline-periods");
  el.innerHTML = "";
  state.periods.forEach(p => {
    const btn = document.createElement("div");
    btn.className = "period-btn" + (p.id === state.activePeriodId ? " active" : "");
    btn.innerHTML = `<div class="p-name">${p.shortName}</div><div class="p-age">${p.yearsAgo}</div>`;
    btn.addEventListener("click", async () => {
      state.activePeriodId = p.id;
      renderTimeline();
      await loadPeriodContent(p.id);
      renderPanel();
      if (map && map.isStyleLoaded()) setBasemapForPeriod(p.id);
      updateMapLayersForPeriod();
    });
    el.appendChild(btn);
  });
}

function renderToggles() {
  const el = document.getElementById("overlay-toggles");
  el.innerHTML = "";
  const allToggles = [
    ...LINE_LAYERS.map(l => ({ id: l.id, label: l.label })),
    ...SYMBOL_LAYERS.map(l => ({ id: l.id, label: l.label })),
    ...LAYER_TOGGLES.map(l => ({ id: l.id, label: l.label })),
  ];
  allToggles.forEach(t => {
    const btn = document.createElement("button");
    btn.className = "toggle-btn" + (state.layersOn[t.id] ? " on" : "");
    btn.textContent = t.label;
    btn.addEventListener("click", () => {
      state.layersOn[t.id] = !state.layersOn[t.id];
      renderToggles();
      applyLayerVisibility(t.id);
    });
    el.appendChild(btn);
  });
}

function renderPanel() {
  const period = state.periods.find(p => p.id === state.activePeriodId);
  const content = state.periodContent[state.activePeriodId];

  document.getElementById("period-title").textContent = period.name;
  document.getElementById("period-subtitle").textContent = period.yearsAgo;

  const tabsEl = document.getElementById("panel-tabs");
  tabsEl.innerHTML = "";
  TAB_DEFS.forEach(t => {
    const tabEl = document.createElement("div");
    tabEl.className = "tab" + (t.key === state.activeTab ? " active" : "");
    tabEl.textContent = t.label;
    tabEl.addEventListener("click", () => {
      state.activeTab = t.key;
      renderPanel();
    });
    tabsEl.appendChild(tabEl);
  });

  const contentEl = document.getElementById("panel-content");
  contentEl.innerHTML = renderTabContent(state.activeTab, content);
}

// Renders one flora/fauna card. If the entry has an "image" field (path to a
// circular badge illustration, e.g. "assets/species/red-deer.png"), it's shown
// bare at 64px — no extra frame, since the artwork already has its own border
// baked in. Entries without an image just render as text, same as before.
function renderSpeciesCard(f, fallbackImage) {
  const imgSrc = f.image || fallbackImage;
  const img = imgSrc ? `<img class="fauna-icon-img" src="${imgSrc}" alt="${f.name}">` : "";
  return `<div class="fauna-card">${img}<div class="fauna-card-text"><p>${f.name}</p><span>${f.latin || ""} ${f.note ? "— " + f.note : ""}</span></div></div>`;
}

function renderTabContent(tab, content) {
  if (!content) return `<span class="empty">Loading…</span>`;
  switch (tab) {
    case "info":
      return `<div>${content.info}</div>`;
    case "background":
      return `<div>${content.background}</div>`;
    case "flora":
      return content.flora.length
        ? content.flora.map(f => renderSpeciesCard(f, "assets/icon_grassland.PNG")).join("")
        : `<span class="empty">No flora entries yet for this period.</span>`;
    case "fauna":
      return content.fauna.length
        ? content.fauna.map(f => renderSpeciesCard(f, "assets/icon_reddeer.PNG")).join("")
        : `<span class="empty">No fauna entries yet for this period.</span>`;
    case "video":
      return content.video && content.video.url
        ? `<div>${content.video.caption || ""}</div>`
        : `<span class="empty">Video placeholder — nothing linked yet.</span>`;
    default:
      return "";
  }
}

// ============ RESEARCH ESSAYS ============

function renderTopics() {
  const el = document.getElementById("topics-row");
  el.innerHTML = "";
  state.essays.forEach(essay => {
    const chip = document.createElement("div");
    chip.className = "topic-chip" + (essay.locked ? " locked" : "");
    chip.textContent = (essay.locked ? "🔒 " : "") + essay.title;
    if (!essay.locked) {
      chip.addEventListener("click", () => openEssay(essay.id));
    }
    el.appendChild(chip);
  });
}

async function openEssay(essayId) {
  const data = await loadEssayContent(essayId);
  state.activeEssayId = essayId;
  state.view = "essay";
  document.getElementById("app-frame").classList.add("essay-mode");
  renderEssay(data);
}

function closeEssay() {
  state.view = "map";
  document.getElementById("app-frame").classList.remove("essay-mode");
}

// Essay body content is a list of blocks so essays can mix paragraphs and
// tables freely: { type: "paragraph", html: "..." } or
// { type: "table", caption, columns: [...], rows: [[...], ...], note }
function renderEssayBlock(block) {
  if (block.type === "paragraph") {
    return `<p>${block.html}</p>`;
  }
  if (block.type === "table") {
    const head = `<tr>${block.columns.map(c => `<th>${c}</th>`).join("")}</tr>`;
    const rows = block.rows.map(r => `<tr>${r.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("");
    const note = block.note ? `<div class="dd-table-note">${block.note}</div>` : "";
    return `<div class="dd-table-wrap"><table class="dd-table">
      <caption>${block.caption || ""}</caption>
      <thead>${head}</thead>
      <tbody>${rows}</tbody>
    </table></div>${note}`;
  }
  return "";
}

function renderEssay(data) {
  document.getElementById("essay-eyebrow").textContent = data.eyebrow || "Research essay";
  document.getElementById("essay-headline").textContent = data.title;
  document.getElementById("essay-meta").innerHTML = (data.meta || []).map(m => `<span>${m}</span>`).join("<span>·</span>");
  document.getElementById("essay-body").innerHTML = (data.body || []).map(renderEssayBlock).join("");
  document.getElementById("essay-source").innerHTML = data.sourceNote || "";
}

function initMap() {
  protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);

  map = new maplibregl.Map({
    container: "map",
    style: { version: 8, sources: {}, layers: [], glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf" },
    center: [5, 50],
    zoom: 3.2
  });

  map.on("load", async () => {
    setBasemapForPeriod(state.activePeriodId);

    for (const layerDef of LINE_LAYERS) {
      const res = await fetch(layerDef.file);
      const geojson = await res.json();
      map.addSource(layerDef.id, { type: "geojson", data: geojson });
      map.addLayer({
        id: layerDef.id,
        type: "line",
        source: layerDef.id,
        paint: {
          "line-color": layerDef.color,
          "line-width": layerDef.width
        }
      });
    }

    for (const layerDef of LAYER_TOGGLES) {
      const res = await fetch(layerDef.file);
      const geojson = await res.json();
      map.addSource(layerDef.id, { type: "geojson", data: geojson });
      map.addLayer({
        id: layerDef.id,
        type: "circle",
        source: layerDef.id,
        paint: {
          "circle-radius": 6,
          "circle-color": layerDef.color,
          "circle-stroke-width": 1,
          "circle-stroke-color": "#fff"
        }
      });
      map.on("click", layerDef.id, (e) => {
        const props = e.features[0].properties;
        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(`<strong>${props.name}</strong><br>${props.description || props.note || ""}`)
          .addTo(map);
      });
    }
    for (const layerDef of SYMBOL_LAYERS) {
      const res = await fetch(layerDef.file);
      const geojson = await res.json();
      map.addSource(layerDef.id, { type: "geojson", data: geojson });
      map.addLayer({
        id: layerDef.id,
        type: "symbol",
        source: layerDef.id,
        layout: {
          "text-field": ["get", "name"],
          "text-font": CATEGORY_TEXT_FONT,
          "text-size": CATEGORY_TEXT_SIZE,
          "text-rotate": ["coalesce", ["get", "rotation"], 0],
          "text-allow-overlap": false
        },
        paint: {
          "text-color": CATEGORY_TEXT_COLOR,
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.2
        }
      });
    }

    updateMapLayersForPeriod();
  });
}

// Swaps the basemap source/layer: real PMTiles for this period if converted yet,
// otherwise falls back to the OpenTopoMap placeholder.
function setBasemapForPeriod(periodId) {
  if (!map.isStyleLoaded() && map.getSource("period-basemap") === undefined) {
    // still fine to proceed; addSource works once map has loaded once
  }
  if (map.getLayer("period-basemap")) map.removeLayer("period-basemap");
  if (map.getSource("period-basemap")) map.removeSource("period-basemap");

  const pmtilesPath = tilesMap[periodId];

  if (pmtilesPath) {
    map.addSource("period-basemap", {
      type: "raster",
      url: `pmtiles://${pmtilesPath}`,
      tileSize: 256,
      attribution: "Period basemap — derived from QGIS DEM/classification render"
    });
  } else {
    map.addSource("period-basemap", {
      type: "raster",
      tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png", "https://c.tile.opentopomap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA) — placeholder, not yet replaced for this period"
    });
  }

  // Insert basemap below the point-layer overlays if they already exist, otherwise just add it
  const beforeId = map.getLayer("archaeological-sites") ? "archaeological-sites" : undefined;
  map.addLayer({ id: "period-basemap", type: "raster", source: "period-basemap" }, beforeId);
}

function applyLayerVisibility(layerId) {
  if (!map || !map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", state.layersOn[layerId] ? "visible" : "none");
}

// Filters archaeological-sites / eveline-places features to those tagged with the active period
function updateMapLayersForPeriod() {
  if (!map) return;
  LAYER_TOGGLES.forEach(layerDef => {
    if (!map.getLayer(layerDef.id)) return;
    map.setFilter(layerDef.id, ["in", state.activePeriodId, ["get", "periods"]]);
    applyLayerVisibility(layerDef.id);
  });
  SYMBOL_LAYERS.forEach(layerDef => {
    if (!map.getLayer(layerDef.id)) return;
    map.setFilter(layerDef.id, ["==", ["get", "period_txt"], state.activePeriodId]);
    applyLayerVisibility(layerDef.id);
  });
}

init();
