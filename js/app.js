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

let tilesMap = {}; // period id -> pmtiles path, or null if not yet converted

let state = {
  periods: [],
  activePeriodId: null,
  activeTab: "info",
  periodContent: {}, // cache
  layersOn: { "archaeological-sites": true, "eveline-places": true, "coastline": true, "borders": true },
};

let map;
let protocol;

async function init() {
  const periodsRes = await fetch("data/periods.json");
  const periodsData = await periodsRes.json();
  state.periods = periodsData.periods;
  state.activePeriodId = state.periods[0].id;

  const tilesRes = await fetch("data/tiles-map.json");
  tilesMap = await tilesRes.json();

  renderTimeline();
  renderToggles();
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
    { id: "coastline", label: "Coastline" },
    { id: "borders", label: "Countries" },
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

// Renders one flora/fauna card. Uses f.image (a URL) if set, otherwise shows
// a placeholder square with a fallback emoji icon.
function renderSpeciesCard(f, fallbackIcon) {
  const imgBox = f.image
    ? `<div class="fauna-card-img"><img src="${f.image}" alt="${f.name}"></div>`
    : `<div class="fauna-card-img"><span class="placeholder-icon">${fallbackIcon}</span></div>`;
  return `<div class="fauna-card">${imgBox}<div class="fauna-card-text"><p>${f.name}</p><span>${f.latin || ""} ${f.note ? "— " + f.note : ""}</span></div></div>`;
}

function renderTabContent(tab, content) {
  if (!content) return `<span class="empty">Loading…</span>`;
  switch (tab) {
    case "info":
      return `<div>${content.info}</div>`;
    case "background":
      return `<div>${content.background}</div>`;
    case "flora": {
      const intro = content.floraDescription ? `<div class="content-block">${content.floraDescription}</div>` : "";
      const cards = content.flora.length
        ? content.flora.map(f => renderSpeciesCard(f, "🌿")).join("")
        : `<span class="empty">No flora entries yet for this period.</span>`;
      return intro + cards;
    }
    case "fauna": {
      const intro = content.faunaDescription ? `<div class="content-block">${content.faunaDescription}</div>` : "";
      const cards = content.fauna.length
        ? content.fauna.map(f => renderSpeciesCard(f, "🐾")).join("")
        : `<span class="empty">No fauna entries yet for this period.</span>`;
      return intro + cards;
    }
    case "video":
      return content.video && content.video.url
        ? `<div>${content.video.caption || ""}</div>`
        : `<span class="empty">Video placeholder — nothing linked yet.</span>`;
    default:
      return "";
  }
}

function initMap() {
  protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);

  map = new maplibregl.Map({
    container: "map",
    style: { version: 8, sources: {}, layers: [] },
    center: [5, 50],
    zoom: 3.2
  });

  map.on("load", async () => {
    setBasemapForPeriod(state.activePeriodId);

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
}

init();
