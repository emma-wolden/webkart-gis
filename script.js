// ======================================================
// 1) INITIALISER KARTET (uten API)
// ======================================================
const map = L.map('map', { zoomControl: true })
  .setView([58.5, 7.9], 7); // Sør-Norge – vi zoomer til Agder når GeoJSON er lastet

// Bakgrunnskart
const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap-bidragsytere',
  maxZoom: 19
}).addTo(map);

L.control.scale({ metric: true, imperial: false }).addTo(map);
console.log('✅ Kart initiert');


// ======================================================
// 2) STATUS & GLOBALE REFERANSER
// ======================================================
let agderLayer = null;   // Leaflet-lag for Agder
let agderGeoJSON = null; // Rådata (for Turf-sjekk)
let layerControl = null; // Lagkontroll

function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
  console.log(msg);
}


// ======================================================
// 3) LAGKONTROLL – bare bakgrunn + Agder (når klart)
// ======================================================
function ensureLayerControl() {
  if (layerControl) {
    map.removeControl(layerControl);
  }

  const baseMaps = {
    'OpenStreetMap': osm
  };

  const overlays = {
    'Agder (GeoJSON)': agderLayer || L.featureGroup()
  };

  layerControl = L.control.layers(baseMaps, overlays, {
    collapsed: false,
    position: 'topright'
  }).addTo(map);

  console.log('✅ Layer Control oppdatert');
}

// kall én gang nå (viser i hvert fall bakgrunnskart)
ensureLayerControl();


// ======================================================
// 4) LAST INN GEOJSON: Agder
//    - tegner polygon
//    - popup med kommunenavn
//    - zoomer til extent
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

    // Zoom til Agder
    try {
      map.fitBounds(agderLayer.getBounds(), { padding: [20, 20] });
    } catch (e) {
      console.warn('Kunne ikke beregne bounds for Agder-laget:', e);
    }

    setStatus('✅ Agder (GeoJSON) lastet');
    ensureLayerControl(); // Oppdater kontrollen slik at Agder dukker opp i listen
  })
  .catch((err) => {
    console.error('❌ agder.geojson feilet:', err);
    setStatus('⚠️ Klarte ikke å laste agder.geojson (se konsoll for detaljer)');
    ensureLayerControl();
  });


// ======================================================
// 5) ROMLIG SPØRRING (valgfri): Klikk → inne/utenfor Agder?
//    - Fungerer hvis Turf.js er lastet i index.html
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