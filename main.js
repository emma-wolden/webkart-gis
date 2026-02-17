// ==============================================
// INITIALISER KART
// Koordinatsystem: WGS84 / EPSG:4326
// ==============================================
const kart = L.map('kart').setView([58.16, 7.99], 9);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(kart);

// Variabler for lag
let skogLag = null;
let naturtypeLag = null;
let soppObservasjonerLag = null;
let brukerPosisjon = null;
let alleSkogFeatures = [];

// ==============================================
// FARGESETTING — basert på OSM leaf_type
// ==============================================
function hentSkogFarge(feature) {
  const type = feature.properties.leaf_type;
  if (type === 'needleleaved') return '#2d6a4f'; // Barskog
  if (type === 'broadleaved')  return '#95d5b2'; // Lauvskog
  if (type === 'mixed')        return '#52b788'; // Blandingsskog
  return '#74c69d';                              // Ukjent
}

// ==============================================
// 1. STATISK GEOJSON — Skogsområder fra OSM via QGIS
// ==============================================
fetch('skog.geojson')
  .then(r => r.json())
  .then(data => {
    alleSkogFeatures = data.features;

    skogLag = L.geoJSON(data, {
      style: feature => ({
        fillColor: hentSkogFarge(feature),
        color: '#1b4332',
        weight: 1,
        fillOpacity: 0.6
      }),
      onEachFeature: (feature, layer) => {
        const p = feature.properties;

        const skogtype = p.leaf_type === 'needleleaved' ? '🌲 Barskog' :
                         p.leaf_type === 'broadleaved'  ? '🍂 Lauvskog' :
                         p.leaf_type === 'mixed'        ? '🌳 Blandingsskog' :
                                                          '🌲 Skog (ukjent type)';

        const syklus = p.leaf_cycle === 'evergreen' ? 'Eviggrønn' :
                       p.leaf_cycle === 'deciduous' ? 'Løvfellende' :
                       'ukjent';

        layer.bindPopup(`
          <strong>${skogtype}</strong><br>
          <em>Bladfall:</em> ${syklus}<br>
          <em>OSM-id:</em> ${p.osm_id}<br>
          <em>Kilde:</em> OpenStreetMap
        `);
      }
    }).addTo(kart);
  })
  .catch(err => console.error('Kunne ikke laste skog.geojson:', err));

// ==============================================
// 2. EKSTERNT API — Soppobservasjoner fra Artskart
// countys[]=10 = Agder (fylke-id)
// kingdom=Fungi filtrerer på sopp
// ==============================================
fetch('https://artskart.artsdatabanken.no/publicapi/api/observations/list/?countys[]=10&kingdom=Fungi&PageSize=200')
  .then(r => {
    if (!r.ok) throw new Error('API feilet: ' + r.status);
    return r.json();
  })
  .then(data => {
    const observasjoner = data.Observations || data.observations || data;

    const features = observasjoner
      .filter(obs => obs.Latitude && obs.Longitude)
      .map(obs => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [parseFloat(obs.Longitude.replace(',','.')),
                        parseFloat(obs.Latitude.replace(',','.'))]
        },
       properties: {
  art:       obs.ScientificName || 'ukjent',
  norskNavn: obs.Name           || 'ukjent',
  dato:      obs.CollectedDate  || 'ukjent',
  sted:      obs.Locality       || '',
  kommune:   obs.Municipality   || '',
  status:    obs.Status         || null,
  habitat:   obs.Habitat        || '',
  kilde:     obs.Institution    || ''
}
      }));

    soppObservasjonerLag = L.geoJSON(
      { type: 'FeatureCollection', features },
      {
        pointToLayer: (feature, latlng) =>
          L.circleMarker(latlng, {
            radius: 7,
            fillColor: '#c77dff',
            color: '#7b2d8b',
            weight: 1.5,
            fillOpacity: 0.8
          }),
        onEachFeature: (feature, layer) => {
          const p = feature.properties;
          layer.bindPopup(`
  <strong>${p.norskNavn}</strong><br>
  <em>Vitenskapelig navn:</em> ${p.art}<br>
  <em>Dato:</em> ${p.dato}<br>
  <em>Sted:</em> ${p.sted}, ${p.kommune}<br>
  <em>Habitat:</em> ${p.habitat}<br>
  ${p.status ? `<em>⚠️ Rødlistet:</em> ${p.status}<br>` : ''}
  <em>Kilde:</em> ${p.kilde}
`);
        }
      }
    ).addTo(kart);

    console.log(`Lastet ${features.length} soppobservasjoner`);
  })
  .catch(err => console.warn('Artskart API feilet:', err));
// ==============================================
// LAG AV/PÅ
// ==============================================
document.getElementById('toggleSkog').addEventListener('change', function() {
  if (skogLag) this.checked ? kart.addLayer(skogLag) : kart.removeLayer(skogLag);
});

document.getElementById('toggleSopp').addEventListener('change', function() {
  if (soppObservasjonerLag) this.checked ? kart.addLayer(soppObservasjonerLag) : kart.removeLayer(soppObservasjonerLag);
});

// ==============================================
// ROMLIG FILTRERING — vis skog innenfor X km
// ==============================================
function filtrerPaRadius() {
  const radiusKm = parseFloat(document.getElementById('radius').value);

  if (!navigator.geolocation) {
    alert('Nettleseren din støtter ikke geolokasjon');
    return;
  }

  navigator.geolocation.getCurrentPosition(function(pos) {
    brukerPosisjon = [pos.coords.latitude, pos.coords.longitude];

    L.marker(brukerPosisjon).bindPopup('📍 Din posisjon').addTo(kart);

    L.circle(brukerPosisjon, {
      radius: radiusKm * 1000,
      color: 'blue',
      fillOpacity: 0.05
    }).addTo(kart);

    if (skogLag) kart.removeLayer(skogLag);

    const filtrerteFeatures = alleSkogFeatures.filter(feature => {
      const coords = feature.geometry.coordinates[0][0][0]; // MultiPolygon
      const avstand = regnUtAvstandKm(
        brukerPosisjon[0], brukerPosisjon[1],
        coords[1], coords[0]
      );
      return avstand <= radiusKm;
    });

    skogLag = L.geoJSON(
      { type: 'FeatureCollection', features: filtrerteFeatures },
      {
        style: f => ({
          fillColor: hentSkogFarge(f),
          color: '#1b4332',
          weight: 1,
          fillOpacity: 0.6
        }),
        onEachFeature: (feature, layer) => {
          const skogtype = feature.properties.leaf_type || 'Skog';
          layer.bindPopup(`<strong>🌲 ${skogtype}</strong>`);
        }
      }
    ).addTo(kart);

    kart.setView(brukerPosisjon, 11);
  });
}

function nullstillFilter() {
  location.reload();
}

// Haversine-formel
function regnUtAvstandKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
            Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}