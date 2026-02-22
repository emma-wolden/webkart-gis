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
let skred100 = null;        // Kartverket GeoJSON-lag (100 år)
let skred1000 = null;       // Kartverket GeoJSON-lag (1000 år)
let skred5000 = null;       // Kartverket GeoJSON-lag (5000 år)
let skredLoaded = false;    // Flag: har vi allerede lastet skredfare?

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

  if (skred100)  overlays['Skredfare 100 år (Kartverket)']  = skred100;
  if (skred1000) overlays['Skredfare 1000 år (Kartverket)'] = skred1000;
  if (skred5000) overlays['Skredfare 5000 år (Kartverket)'] = skred5000;

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

    // 👉 Laster skredfare-lag ETTER at vi har zoomet inn (bedre ytelse)
    loadSkredareFromKartverket().catch((err) => {
      console.error('❌ loadSkredareFromKartverket feilet:', err);
    });
  })
  .catch((err) => {
    console.error('❌ agder.geojson feilet:', err);
    setStatus('⚠️ Klarte ikke å laste agder.geojson (se konsoll for detaljer)');
    ensureLayerControl();
  });


// ======================================================
// 5) LAST SKREDFARE FRA KARTVERKET WFS (GeoJSON)
//    - Bruker Kartverket REST API (WFS) – ingen CORS-problemer
//    - Tre faresonekart: 100 / 1000 / 5000 år
//    - Farger: rød (100 år), oransje (1000 år), gul (5000 år)
// ======================================================
async function loadSkredareFromKartverket() {
  if (skredLoaded) return;
  skredLoaded = true;

  const WFS_BASE = 'https://wfs.geonorge.no/skwms1/wfs.py';

  // Agder omtrentlig bounding box (lon_min,lat_min,lon_max,lat_max)
  const BBOX = '6.5,57.5,9.5,59.5,urn:ogc:def:crs:EPSG::4326';

  // Hjelpefunksjon: unngå XSS ved HTML-innbygging av GeoJSON-verdier
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const hazards = [
    {
      typeName: 'skred:Skredsone_100',
      color: '#FF0000',
      label: 'Skredfare 100 år',
      setLayer: (l) => { skred100  = l; l.addTo(map); }
    },
    {
      typeName: 'skred:Skredsone_1000',
      color: '#FFA500',
      label: 'Skredfare 1000 år',
      setLayer: (l) => { skred1000 = l; }
    },
    {
      typeName: 'skred:Skredsone_5000',
      color: '#FFFF00',
      label: 'Skredfare 5000 år',
      setLayer: (l) => { skred5000 = l; }
    }
  ];

  let anyLoaded = false;

  for (const { typeName, color, label, setLayer } of hazards) {
    const url =
      `${WFS_BASE}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
      `&TYPENAME=${encodeURIComponent(typeName)}` +
      `&OUTPUTFORMAT=${encodeURIComponent('application/json')}` +
      `&BBOX=${encodeURIComponent(BBOX)}`;

    console.log(`📡 Henter ${label} fra Kartverket: ${url}`);

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const geojson = await res.json();

      const layer = L.geoJSON(geojson, {
        style: {
          color: color,
          weight: 1,
          fillColor: color,
          fillOpacity: 0.4
        },
        onEachFeature: (feature, lyr) => {
          const p = feature.properties || {};
          const info = Object.entries(p)
            .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`)
            .join('');
          lyr.bindPopup(
            `<strong>${escapeHtml(label)}</strong>` +
            (info ? `<table style="font-size:0.85em">${info}</table>` : '')
          );
        }
      });

      setLayer(layer);
      anyLoaded = true;
      console.log(`✅ ${label} lastet fra Kartverket REST API`);
    } catch (err) {
      console.error(`❌ Feil ved lasting av ${label}:`, err);
    }
  }

  ensureLayerControl();

  if (anyLoaded) {
    console.log('✅ Skredfare-data lastet fra Kartverket REST API');
    setStatus('✅ Agder + skredfare-data lastet (Kartverket)');
  } else {
    console.warn('⚠️ Ingen skredfare-data ble lastet fra Kartverket');
    setStatus('⚠️ Agder lastet – skredfare-data utilgjengelig (se konsoll)');
  }
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