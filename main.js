// ==============================================
// CONFIGURATION OBJECT
// ==============================================
const CONFIG = {
  map: {
    defaultCenter: [58.16, 7.99],
    defaultZoom: 9,
    filteredZoom: 11
  },
  api: {
    url: 'https://artskart.artsdatabanken.no/publicapi/api/observations/list/',
    county: '10', // Agder
    pageSize: 200,
    timeout: 10000
  },
  filter: {
    defaultRadius: 5
  }
};

// ==============================================
// UI STATE
// ==============================================
const UI_STATE = {
  isLoading: false,
  currentFilter: null,
  userMarker: null,
  radiusCircle: null
};

// ==============================================
// INITIALISER KART
// Koordinatsystem: WGS84 / EPSG:4326
// ==============================================
const kart = L.map('kart').setView(CONFIG.map.defaultCenter, CONFIG.map.defaultZoom);

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
// HELPER FUNCTIONS
// ==============================================

/**
 * Calculate centroid of a polygon using the shoelace formula
 * @param {Array} coordinates - Array of [lon, lat] coordinate pairs
 * @returns {Array} - [lon, lat] of the centroid
 */
function calculatePolygonCentroid(coordinates) {
  let x = 0, y = 0, area = 0;
  const n = coordinates.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = coordinates[i][0];
    const yi = coordinates[i][1];
    const xj = coordinates[j][0];
    const yj = coordinates[j][1];
    
    const cross = xi * yj - xj * yi;
    area += cross;
    x += (xi + xj) * cross;
    y += (yi + yj) * cross;
  }
  
  area *= 0.5;
  
  // Avoid division by zero for degenerate polygons
  if (Math.abs(area) < 1e-10) {
    // Return the average of all coordinates as fallback
    const avgX = coordinates.reduce((sum, c) => sum + c[0], 0) / n;
    const avgY = coordinates.reduce((sum, c) => sum + c[1], 0) / n;
    return [avgX, avgY];
  }
  
  const factor = 1 / (6 * area);
  
  return [x * factor, y * factor];
}

/**
 * Check if a feature is within a given radius from user location
 * @param {Object} feature - GeoJSON feature
 * @param {number} userLat - User latitude
 * @param {number} userLon - User longitude
 * @param {number} radiusKm - Radius in kilometers
 * @returns {boolean} - True if feature is within radius
 */
function isFeatureWithinRadius(feature, userLat, userLon, radiusKm) {
  const geom = feature.geometry;
  let centroid;
  
  if (geom.type === 'Polygon') {
    centroid = calculatePolygonCentroid(geom.coordinates[0]);
  } else if (geom.type === 'MultiPolygon') {
    // For MultiPolygon, use the centroid of the first polygon
    centroid = calculatePolygonCentroid(geom.coordinates[0][0]);
  } else {
    // Fallback for other geometry types
    return false;
  }
  
  const distance = regnUtAvstandKm(userLat, userLon, centroid[1], centroid[0]);
  return distance <= radiusKm;
}

// Haversine-formel for calculating distance between two points
function regnUtAvstandKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 +
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
            Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Generate popup content for a forest feature
 * @param {Object} properties - Feature properties
 * @returns {string} - HTML string for popup
 */
function generateSkogPopup(properties) {
  const skogtype = properties.leaf_type === 'needleleaved' ? '🌲 Barskog' :
                   properties.leaf_type === 'broadleaved'  ? '🍂 Lauvskog' :
                   properties.leaf_type === 'mixed'        ? '🌳 Blandingsskog' :
                                                             '🌲 Skog (ukjent type)';

  const syklus = properties.leaf_cycle === 'evergreen' ? 'Eviggrønn' :
                 properties.leaf_cycle === 'deciduous' ? 'Løvfellende' :
                 'ukjent';

  return `
    <strong>${skogtype}</strong><br>
    <em>Bladfall:</em> ${syklus}<br>
    <em>OSM-id:</em> ${properties.osm_id}<br>
    <em>Kilde:</em> OpenStreetMap
  `;
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
        layer.bindPopup(generateSkogPopup(feature.properties));
      }
    }).addTo(kart);
  })
  .catch(err => console.error('Kunne ikke laste skog.geojson:', err));

// ==============================================
// 2. EKSTERNT API — Soppobservasjoner fra Artskart
// countys[]=10 = Agder (fylke-id)
// kingdom=Fungi filtrerer på sopp
// ==============================================
const apiParams = new URLSearchParams({
  'countys[]': CONFIG.api.county,
  'kingdom': 'Fungi',
  'PageSize': CONFIG.api.pageSize
});

fetch(`${CONFIG.api.url}?${apiParams}`)
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

  if (isNaN(radiusKm) || radiusKm <= 0) {
    alert('Vennligst angi en gyldig radius');
    return;
  }

  if (!navigator.geolocation) {
    alert('Nettleseren din støtter ikke geolokasjon');
    return;
  }

  UI_STATE.isLoading = true;

  navigator.geolocation.getCurrentPosition(
    function(pos) {
      brukerPosisjon = [pos.coords.latitude, pos.coords.longitude];
      
      // Remove old marker and circle if they exist
      if (UI_STATE.userMarker) {
        kart.removeLayer(UI_STATE.userMarker);
      }
      if (UI_STATE.radiusCircle) {
        kart.removeLayer(UI_STATE.radiusCircle);
      }

      // Add user position marker
      UI_STATE.userMarker = L.marker(brukerPosisjon)
        .bindPopup('📍 Din posisjon')
        .addTo(kart);

      // Add radius circle
      UI_STATE.radiusCircle = L.circle(brukerPosisjon, {
        radius: radiusKm * 1000,
        color: 'blue',
        fillColor: 'blue',
        fillOpacity: 0.05,
        weight: 2
      }).addTo(kart);

      // Remove existing forest layer
      if (skogLag) kart.removeLayer(skogLag);

      // Filter features using centroid calculation
      const filtrerteFeatures = alleSkogFeatures.filter(feature => 
        isFeatureWithinRadius(feature, brukerPosisjon[0], brukerPosisjon[1], radiusKm)
      );

      // Create new filtered layer
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
            layer.bindPopup(generateSkogPopup(feature.properties));
          }
        }
      ).addTo(kart);

      // Zoom to user position
      kart.setView(brukerPosisjon, CONFIG.map.filteredZoom);

      UI_STATE.currentFilter = { radius: radiusKm, position: brukerPosisjon };
      UI_STATE.isLoading = false;

      console.log(`Filtrert til ${filtrerteFeatures.length} skogsområder innenfor ${radiusKm} km`);
    },
    function(error) {
      UI_STATE.isLoading = false;
      let errorMsg = 'Kunne ikke hente din posisjon. ';
      
      switch(error.code) {
        case error.PERMISSION_DENIED:
          errorMsg += 'Du må gi tillatelse til å bruke posisjon.';
          break;
        case error.POSITION_UNAVAILABLE:
          errorMsg += 'Posisjonsinformasjon er ikke tilgjengelig.';
          break;
        case error.TIMEOUT:
          errorMsg += 'Forespørselen om posisjon tok for lang tid.';
          break;
        default:
          errorMsg += 'En ukjent feil oppstod.';
      }
      
      alert(errorMsg);
      console.error('Geolocation error:', error);
    },
    {
      enableHighAccuracy: true,
      timeout: CONFIG.api.timeout,
      maximumAge: 0
    }
  );
}

function nullstillFilter() {
  // Reset radius input to default
  document.getElementById('radius').value = CONFIG.filter.defaultRadius;

  // Remove user marker and radius circle if they exist
  if (UI_STATE.userMarker) {
    kart.removeLayer(UI_STATE.userMarker);
    UI_STATE.userMarker = null;
  }
  
  if (UI_STATE.radiusCircle) {
    kart.removeLayer(UI_STATE.radiusCircle);
    UI_STATE.radiusCircle = null;
  }

  // Remove existing forest layer
  if (skogLag) {
    kart.removeLayer(skogLag);
  }

  // Restore original forest layer from all features
  skogLag = L.geoJSON(
    { type: 'FeatureCollection', features: alleSkogFeatures },
    {
      style: feature => ({
        fillColor: hentSkogFarge(feature),
        color: '#1b4332',
        weight: 1,
        fillOpacity: 0.6
      }),
      onEachFeature: (feature, layer) => {
        layer.bindPopup(generateSkogPopup(feature.properties));
      }
    }
  ).addTo(kart);

  // Reset map view to default
  kart.setView(CONFIG.map.defaultCenter, CONFIG.map.defaultZoom);

  // Reset UI state
  UI_STATE.currentFilter = null;
  brukerPosisjon = null;

  console.log('Filter nullstilt - viser alle skogsområder');
}

// ==============================================
// EVENT LISTENERS
// ==============================================
document.addEventListener('DOMContentLoaded', function() {
  // Wire up filter button
  const btnFiltrer = document.getElementById('btnFiltrer');
  if (btnFiltrer) {
    btnFiltrer.addEventListener('click', filtrerPaRadius);
  }

  // Wire up reset button
  const btnNullstill = document.getElementById('btnNullstill');
  if (btnNullstill) {
    btnNullstill.addEventListener('click', nullstillFilter);
  }
});