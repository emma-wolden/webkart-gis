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
let skred100 = null;        // WMS-lag (100 år)
let skred1000 = null;       // WMS-lag (1000 år)
let skred5000 = null;       // WMS-lag (5000 år)
let wmsLoaded = false;      // Flag: har vi allerede lastet WMS?

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

  if (skred100)  overlays['Skredfare 100 år (NVE)']  = skred100;
  if (skred1000) overlays['Skredfare 1000 år (NVE)'] = skred1000;
  if (skred5000) overlays['Skredfare 5000 år (NVE)'] = skred5000;

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

    // 👉 Laster WMS-lag ETTER at vi har zoomet inn (bedre ytelse)
    loadWMSLayersOnce();
  })
  .catch((err) => {
    console.error('❌ agder.geojson feilet:', err);
    setStatus('⚠️ Klarte ikke å laste agder.geojson (se konsoll for detaljer)');
    ensureLayerControl();
  });


// ======================================================
// 5) LAZY-LOAD WMS etter innzooming (ytelse!)
//    - Bruker ArcGIS WMS 1.1.1 + png8 + tileSize 512 + updateWhenIdle
//    - Slår PÅ kun 100-år ved oppstart (bruk toggles for de andre)
// ======================================================
function loadWMSLayersOnce() {
  if (wmsLoaded) return;
  wmsLoaded = true;

  const NVE_WMS_URL =
    'https://nve.geodataonline.no/arcgis/services/Skredfaresoner1/MapServer/WMSServer';

  // "Sikre" parametre for raskere/roligere lasting
  const wmsCommon = {
    version: '1.1.1',         // trygg akserekkefølge
    format: 'image/png',      // bred kompatibilitet
    transparent: true,
    opacity: 1.0,             // full synlighet
    tileSize: 512,            // større tile => færre requests
    updateWhenIdle: true,     // vent til pan/zoom stopper
    updateWhenZooming: false, // ikke hent under zoom-animasjon
    maxZoom: 15,              // begrens detaljdybde
    attribution: 'Skredfaresoner © NVE'
  };

  // Du kan bruke lag-navnene (mest robust) eller ID '1'/'2'/'3'
  skred100  = L.tileLayer.wms(NVE_WMS_URL, { ...wmsCommon, layers: 'Skredsoner_100'  });
  skred1000 = L.tileLayer.wms(NVE_WMS_URL, { ...wmsCommon, layers: 'Skredsoner_1000' });
  skred5000 = L.tileLayer.wms(NVE_WMS_URL, { ...wmsCommon, layers: 'Skredsoner_5000' });

  // Logg når tiles faktisk er hentet og rendret
  skred100.on('load',  () => console.log('✅ WMS skred100 lastet'));
  skred1000.on('load', () => console.log('✅ WMS skred1000 lastet'));
  skred5000.on('load', () => console.log('✅ WMS skred5000 lastet'));
  skred100.on('tileerror',  (e) => console.warn('⚠️ WMS skred100 tile feil:', e));
  skred1000.on('tileerror', (e) => console.warn('⚠️ WMS skred1000 tile feil:', e));
  skred5000.on('tileerror', (e) => console.warn('⚠️ WMS skred5000 tile feil:', e));

  // Slå PÅ kun 100-år som standard (raskere + noe å se med én gang)
  skred100.addTo(map);
  skred100.bringToFront();

  // Oppdater lagkontrollen nå som WMS finnes
  ensureLayerControl();
  console.log('✅ WMS-lag lastet (100/1000/5000), 100-år aktivt');

  // Sørg for at WMS-lag alltid er øverst etter lag-skift
  map.on('overlayadd', () => {
    if (map.hasLayer(skred5000)) skred5000.bringToFront();
    if (map.hasLayer(skred1000)) skred1000.bringToFront();
    if (map.hasLayer(skred100))  skred100.bringToFront();
    console.log('✅ WMS-lag brakt til front');
  });
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


// ======================================================
// 7) LEGEND TOGGLE
// ======================================================
(function () {
  const toggleBtn = document.getElementById('legend-toggle');
  const legendBody = document.getElementById('legend-body');
  if (toggleBtn && legendBody) {
    toggleBtn.addEventListener('click', () => {
      const hidden = legendBody.style.display === 'none';
      legendBody.style.display = hidden ? 'block' : 'none';
      toggleBtn.textContent = hidden ? '▲' : '▼';
    });
  }
}());