// ======================================================
// 1) INITIALISER KARTET
// ======================================================
const map = L.map('map', { zoomControl: true })
  .setView([58.5, 7.9], 7); // Sør-Norge – zoomer til Agder når GeoJSON er lastet

// Bakgrunnskart
const osm = L.tileLayer(
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  {
    attribution: '© Carto, © OpenStreetMap',
    maxZoom: 19
  }
).addTo(map);

// Målestokk
L.control.scale({ metric: true, imperial: false }).addTo(map);

console.log('✅ Kart initiert');


// ======================================================
// 2) STATUS & GLOBALE REFERANSER
// ======================================================
let agderLayer = null;      // Leaflet-lag for Agder
let agderGeoJSON = null;    // Rådata (for Turf-sjekk)
let layerControl = null;    // Lagkontroll
let skred100 = null;        // REST API-lag (100 år)
let skred1000 = null;       // REST API-lag (1000 år)
let skred5000 = null;       // REST API-lag (5000 år)

function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
  console.log(msg);
}


// ======================================================
// 3) LAGKONTROLL – base + overlays (Agder + WMS når klare)
// ======================================================
function ensureLayerControl() {
  if (layerControl) map.removeControl(layerControl);

  const baseMaps = { 'OpenStreetMap': osm };

  // Bygg overlays dynamisk – kun legg inn lag som finnes
  const overlays = {};
  overlays['Agder (GeoJSON)'] = agderLayer || L.featureGroup();

  if (skred100)  overlays['Skredfare 100 år 🔴']  = skred100;
  if (skred1000) overlays['Skredfare 1000 år 🟠'] = skred1000;
  if (skred5000) overlays['Skredfare 5000 år 🟡'] = skred5000;

  layerControl = L.control.layers(baseMaps, overlays, {
    collapsed: false,
    position: 'topright'
  }).addTo(map);

  console.log('✅ Layer Control oppdatert');
}

// Kall én gang nå (viser i hvert fall bakgrunn + tom overlay for Agder)
ensureLayerControl();


// ======================================================
// 4) LAST INN GEOJSON: Agder
//    - Tegner polygon
//    - Popup med `kommunenavn`
//    - Zoomer til extent
// ======================================================
fetch('data/agder.geojson')
  .then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} ved lasting av agder.geojson`);
    return r.json();
  })
  .then((geo) => {
    agderGeoJSON = geo;

    agderLayer = L.geoJSON(geo, {
      style: {
        color: '#0b61a4',
        weight: 2,
        fillColor: '#4aa3df',
        fillOpacity: 0.15
      },
      onEachFeature: (feature, layer) => {
        const p = feature.properties || {};
        const navn = p.kommunenavn || 'Område';
        layer.bindPopup(`<strong>${navn}</strong>`);
      }
    }).addTo(map);

    // Zoom til Agder-polygone(t/ene)
    try {
      map.fitBounds(agderLayer.getBounds(), { padding: [20, 20] });
    } catch (e) {
      console.warn('Kunne ikke beregne bounds for Agder-laget:', e);
    }

    setStatus('✅ Agder (GeoJSON) lastet');

    // Oppdater lagkontrollen når Agder er på plass
    ensureLayerControl();

    // 👉 Laster skredfare via REST API etter innzooming
    loadSkredareAPIData();
  })
  .catch((err) => {
    console.error('❌ agder.geojson feilet:', err);
    setStatus('⚠️ Klarte ikke å laste agder.geojson (se konsoll for detaljer)');
    ensureLayerControl();
  });


// ======================================================
// 5) LAST INN SKREDFARE via Kartverket/NVE REST API
//    - Henter GeoJSON fra NVE ArcGIS REST API
//    - Returnerer vektordata (ikke bilder) – interaktive polygoner
//    - Farger: rød (100 år), oransje (1000 år), gul (5000 år)
// ======================================================

// Agder bbox (EPSG:4326)
const AGDER_BBOX = { west: 6.8, south: 57.9, east: 9.3, north: 59.1 };

// NVE ArcGIS REST API – skredfaresoner
// Dokumentasjon: https://nve.geodataonline.no/arcgis/rest/services/Skredfaresoner1/MapServer
const NVE_BASE_URL =
  'https://nve.geodataonline.no/arcgis/rest/services/Skredfaresoner1/MapServer';

// ArcGIS-feltene som ikke er meningsfulle for sluttbrukeren
const EXCLUDED_PROPERTIES = ['objectid', 'shape_area', 'shape_length'];

// Maks antall faresoneobjekter vist i result-panelet (UI-begrensning)
const MAX_DISPLAYED_FEATURES = 20;

const SKRED_LAYERS = [
  {
    id: 0,
    label: '100-år',
    color: '#FF0000',
    ref: 'skred100'
  },
  {
    id: 1,
    label: '1000-år',
    color: '#FFA500',
    ref: 'skred1000'
  },
  {
    id: 2,
    label: '5000-år',
    color: '#FFFF00',
    ref: 'skred5000'
  }
];

async function loadSkredareAPIData() {
  setStatus('⏳ Henter skredfare-data fra NVE REST API...');
  console.log('🌐 Starter henting av skredfare via NVE REST API');

  const { west, south, east, north } = AGDER_BBOX;
  // ArcGIS geometry-parameter: kommaseparert bbox i angitt SRS
  const bboxParam = encodeURIComponent(`${west},${south},${east},${north}`);

  let anyLoaded = false;

  for (const def of SKRED_LAYERS) {
    const url =
      `${NVE_BASE_URL}/${def.id}/query` +
      `?where=${encodeURIComponent('1=1')}` + // velg alle objekter
      `&outFields=*` +
      `&returnGeometry=true` +
      `&outSR=4326` +
      `&f=geojson` +
      `&geometry=${bboxParam}` +
      `&geometryType=esriGeometryEnvelope` +
      `&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects` +
      `&resultRecordCount=500`; // 500 er tilstrekkelig for Agder-utsnitt

    console.log(`🌐 Henter skred ${def.label}: ${NVE_BASE_URL}/${def.id}/query`);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for lag ${def.label}`);
      }
      const geojson = await response.json();

      const featureCount = (geojson.features || []).length;
      console.log(`✅ Skred ${def.label}: ${featureCount} objekter hentet`);

      const layer = L.geoJSON(geojson, {
        style: {
          color: def.color,
          weight: 1.5,
          fillColor: def.color,
          fillOpacity: 0.40,
          opacity: 0.85
        },
        onEachFeature: (feature, lyr) => {
          const p = feature.properties || {};
          // API-et bruker 'navn' (lag 0/1) eller 'NAVN' (lag 2) avhengig av versjon
          const name = p.navn || p.NAVN || p.skredtype || 'Skredfare';
          lyr.bindPopup(
            `<strong>Skredfare ${def.label}</strong><br/>` +
            `${name}<br/>` +
            `<small>${Object.entries(p)
              .filter(([k]) => !EXCLUDED_PROPERTIES.includes(k.toLowerCase()))
              .map(([k, v]) => `${k}: ${v}`)
              .join('<br/>')}</small>`
          );
        }
      });

      // Legg 100-år til i kartet som standard; de andre er skjult til brukeren slår dem på
      if (def.ref === 'skred100') {
        layer.addTo(map);
        skred100 = layer;
      } else if (def.ref === 'skred1000') {
        skred1000 = layer;
      } else {
        skred5000 = layer;
      }

      anyLoaded = true;
    } catch (err) {
      console.error(`❌ Feil ved henting av skred ${def.label}:`, err);
    }
  }

  // Oppdater lagkontroll og result-panel
  ensureLayerControl();
  updateResultPanel();

  if (anyLoaded) {
    setStatus('✅ Skredfare-data lastet fra NVE REST API');
    console.log('✅ Alle tilgjengelige skredfare-lag er lastet');
  } else {
    setStatus('⚠️ Klarte ikke å hente skredfare-data (se konsoll for detaljer)');
  }
}

function updateResultPanel() {
  const countEl = document.getElementById('rp-count');
  const listEl  = document.getElementById('rp-list');
  if (!countEl || !listEl) return;

  const allFeatures = [];
  [skred100, skred1000, skred5000].forEach((layer) => {
    if (!layer) return;
    layer.eachLayer((lyr) => {
      const p = lyr.feature && lyr.feature.properties ? lyr.feature.properties : {};
      allFeatures.push(p.navn || p.NAVN || p.skredtype || 'Skredfare');
    });
  });

  countEl.textContent = allFeatures.length;
  listEl.innerHTML = allFeatures
    .slice(0, MAX_DISPLAYED_FEATURES)
    .map((n) => `<div class="rp-item">${n}</div>`)
    .join('');
}


// ======================================================
// 6) ROMLIG SPØRRING (valgfri)
//    Klikk → er punktet inne i Agder? (Turf.js hvis tilgjengelig)
// ======================================================
map.on('click', (e) => {
  const { lat, lng } = e.latlng;

  const hasTurf = typeof turf !== 'undefined'
    && turf
    && typeof turf.booleanPointInPolygon === 'function';

  let html = `<div><strong>Koordinat:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}<br/>`;

  if (agderGeoJSON && hasTurf) {
    const pt = turf.point([lng, lat]); // [lon, lat]
    const inside = turf.booleanPointInPolygon(pt, agderGeoJSON);
    html += inside
      ? '📍 Punktet ligger <b>INNE</b> i Agder.</div>'
      : '📍 Punktet ligger <b>UTENFOR</b> Agder.</div>';
  } else if (!hasTurf) {
    html += 'ℹ️ Turf.js ikke tilgjengelig – kan ikke teste inne/ute.</div>';
  } else {
    html += 'ℹ️ Agder-data ikke lastet – kan ikke teste inne/ute.</div>';
  }

  L.popup().setLatLng(e.latlng).setContent(html).openOn(map);
});

console.log('✅ Klikkspørring aktivert');