// ==============================================
// CONFIGURATION OBJECT
// ==============================================
const CONFIG = {
  // Map default settings
  map: {
    defaultCenter: [58.16, 7.99],
    defaultZoom: 9,
    filterZoom: 11,
    maxZoom: 18,
    minZoom: 8
  },
  
  // API settings
  api: {
    baseUrl: 'https://artskart.artsdatabanken.no/publicapi/api/observations/list/',
    countyId: 10, // Agder
    pageSize: 200,
    kingdom: 'Fungi'
  },
  
  // Filter settings
  filter: {
    defaultRadius: 5, // km
    minRadius: 1,
    maxRadius: 50
  },
  
  // Geolocation settings
  geolocation: {
    enableHighAccuracy: true,
    timeout: 10000, // ms
    maximumAge: 0
  },
  
  // Spatial calculation settings
  spatial: {
    polygonAreaThreshold: 1e-10 // Threshold for detecting degenerate polygons
  },
  
  // UI/UX settings
  ui: {
    markerColor: '#c77dff',
    markerBorderColor: '#7b2d8b',
    circleColor: 'blue',
    circleFillOpacity: 0.05
  }
};

// ==============================================
// UI STATE TRACKING
// ==============================================
const UI_STATE = {
  temporaryLayers: [], // Store temporary layers (markers, circles)
  isFiltered: false,
  originalMapView: {
    center: CONFIG.map.defaultCenter,
    zoom: CONFIG.map.defaultZoom
  }
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
let soppObservasjonerLag = null;
let brukerPosisjon = null;
let alleSkogFeatures = [];

// ==============================================
// HELPER FUNCTIONS FOR SPATIAL FILTERING
// ==============================================

/**
 * Calculate the centroid of a polygon using the shoelace formula
 * @param {Array} coordinates - Array of [lon, lat] coordinate pairs
 * @returns {Array} - [lon, lat] of the centroid
 */
function calculatePolygonCentroid(coordinates) {
  if (!coordinates || coordinates.length === 0) {
    throw new Error('Invalid coordinates for centroid calculation');
  }
  
  let area = 0;
  let cx = 0;
  let cy = 0;
  const n = coordinates.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const xi = coordinates[i][0];
    const yi = coordinates[i][1];
    const xj = coordinates[j][0];
    const yj = coordinates[j][1];
    
    const cross = xi * yj - xj * yi;
    area += cross;
    cx += (xi + xj) * cross;
    cy += (yi + yj) * cross;
  }
  
  area *= 0.5;
  
  if (Math.abs(area) < CONFIG.spatial.polygonAreaThreshold) {
    // Fallback to simple average if area is too small
    const avgLon = coordinates.reduce((sum, c) => sum + c[0], 0) / n;
    const avgLat = coordinates.reduce((sum, c) => sum + c[1], 0) / n;
    return [avgLon, avgLat];
  }
  
  cx /= (6 * area);
  cy /= (6 * area);
  
  return [cx, cy];
}

/**
 * Check if a feature is within radius of a point
 * Supports both Polygon and MultiPolygon geometry types
 * @param {Object} feature - GeoJSON feature
 * @param {Array} centerPoint - [lat, lon] of center point
 * @param {number} radiusKm - Radius in kilometers
 * @returns {boolean} - True if feature is within radius
 */
function isFeatureWithinRadius(feature, centerPoint, radiusKm) {
  try {
    const geom = feature.geometry;
    if (!geom || !geom.type || !geom.coordinates) {
      console.warn('Invalid geometry in feature:', feature);
      return false;
    }
    
    let centroid;
    
    if (geom.type === 'Polygon') {
      // For Polygon: coordinates[0] is the outer ring
      centroid = calculatePolygonCentroid(geom.coordinates[0]);
    } else if (geom.type === 'MultiPolygon') {
      // For MultiPolygon: use the first polygon's outer ring
      centroid = calculatePolygonCentroid(geom.coordinates[0][0]);
    } else {
      console.warn('Unsupported geometry type:', geom.type);
      return false;
    }
    
    // Calculate distance using Haversine formula
    const avstand = regnUtAvstandKm(
      centerPoint[0], centerPoint[1],
      centroid[1], centroid[0]
    );
    
    return avstand <= radiusKm;
  } catch (error) {
    console.error('Error checking feature distance:', error, feature);
    return false;
  }
}


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
// Uses CONFIG for API parameters
// ==============================================
const apiParams = new URLSearchParams({
  'countys[]': CONFIG.api.countyId,
  'kingdom': CONFIG.api.kingdom,
  'PageSize': CONFIG.api.pageSize
});

fetch(`${CONFIG.api.baseUrl}?${apiParams.toString()}`)
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
            fillColor: CONFIG.ui.markerColor,
            color: CONFIG.ui.markerBorderColor,
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
    alert('⚠️ Geolokasjon er ikke støttet i din nettleser.\n\nVennligst bruk en moderne nettleser som Chrome, Firefox, Safari eller Edge.');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    function(pos) {
      // Success callback
      brukerPosisjon = [pos.coords.latitude, pos.coords.longitude];

      // Add marker for user position
      const marker = L.marker(brukerPosisjon).bindPopup('📍 Din posisjon').addTo(kart);
      UI_STATE.temporaryLayers.push(marker);

      // Add circle showing radius
      const circle = L.circle(brukerPosisjon, {
        radius: radiusKm * 1000,
        color: CONFIG.ui.circleColor,
        fillOpacity: CONFIG.ui.circleFillOpacity
      }).addTo(kart);
      UI_STATE.temporaryLayers.push(circle);

      // Remove existing forest layer
      if (skogLag) kart.removeLayer(skogLag);

      // Filter features using the new helper function
      const filtrerteFeatures = alleSkogFeatures.filter(feature => 
        isFeatureWithinRadius(feature, brukerPosisjon, radiusKm)
      );

      // Create new layer with filtered features
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
        }
      ).addTo(kart);

      // Update map view
      kart.setView(brukerPosisjon, CONFIG.map.filterZoom);
      UI_STATE.isFiltered = true;

      console.log(`Filtrerte ${filtrerteFeatures.length} av ${alleSkogFeatures.length} skogsområder innenfor ${radiusKm} km`);
    },
    function(error) {
      // Error callback
      let errorMessage = '⚠️ Kunne ikke hente din posisjon.\n\n';
      
      switch(error.code) {
        case error.PERMISSION_DENIED:
          errorMessage += 'Du har nektet tilgang til posisjon. Vennligst aktiver posisjonstillatelse i nettleserinnstillingene.';
          break;
        case error.POSITION_UNAVAILABLE:
          errorMessage += 'Posisjonsinformasjon er ikke tilgjengelig. Sjekk at GPS/stedstjenester er aktivert.';
          break;
        case error.TIMEOUT:
          errorMessage += 'Forespørselen om posisjon tok for lang tid. Prøv igjen.';
          break;
        default:
          errorMessage += 'En ukjent feil oppstod: ' + error.message;
      }
      
      alert(errorMessage);
      console.error('Geolocation error:', error);
    },
    {
      enableHighAccuracy: CONFIG.geolocation.enableHighAccuracy,
      timeout: CONFIG.geolocation.timeout,
      maximumAge: CONFIG.geolocation.maximumAge
    }
  );
}

function nullstillFilter() {
  // Remove all temporary layers (markers, circles)
  UI_STATE.temporaryLayers.forEach(layer => {
    if (kart.hasLayer(layer)) {
      kart.removeLayer(layer);
    }
  });
  UI_STATE.temporaryLayers = [];

  // Restore original forest layer if it was filtered
  if (UI_STATE.isFiltered && alleSkogFeatures.length > 0) {
    // Remove current layer
    if (skogLag) kart.removeLayer(skogLag);

    // Recreate layer with all original features
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
      }
    ).addTo(kart);
  }

  // Restore original map view
  kart.setView(UI_STATE.originalMapView.center, UI_STATE.originalMapView.zoom);

  // Reset state
  UI_STATE.isFiltered = false;
  brukerPosisjon = null;

  console.log('Filter nullstilt');
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