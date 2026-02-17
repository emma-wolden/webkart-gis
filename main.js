// ==============================================
// KONFIGURASJON
// ==============================================
const CONFIG = {
  // Kart-innstillinger
  map: {
    center: [58.16, 7.99],
    zoom: 9,
    filteredZoom: 11,
    tileLayer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors'
  },
  
  // API-innstillinger
  api: {
    url: 'https://artskart.artsdatabanken.no/publicapi/api/observations/list/',
    countyId: '10', // Agder
    kingdom: 'Fungi',
    pageSize: 200
  },
  
  // Filter-innstillinger
  filter: {
    defaultRadius: 5,
    minRadius: 1,
    maxRadius: 50
  },
  
  // UI-innstillinger
  ui: {
    circleColor: 'blue',
    circleFillOpacity: 0.05,
    markerPopupText: '📍 Din posisjon'
  }
};

// ==============================================
// APPLIKASJONSTILSTAND
// ==============================================
const UI_STATE = {
  userMarker: null,
  filterCircle: null,
  isFiltered: false
};

// ==============================================
// INITIALISER KART
// Koordinatsystem: WGS84 / EPSG:4326
// ==============================================
const kart = L.map('kart').setView(CONFIG.map.center, CONFIG.map.zoom);

L.tileLayer(CONFIG.map.tileLayer, {
  attribution: CONFIG.map.attribution
}).addTo(kart);

// Variabler for lag
let skogLag = null;
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
const apiUrl = `${CONFIG.api.url}?countys[]=${CONFIG.api.countyId}&kingdom=${CONFIG.api.kingdom}&PageSize=${CONFIG.api.pageSize}`;

fetch(apiUrl)
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
// EVENT LISTENERS
// ==============================================
document.addEventListener('DOMContentLoaded', function() {
  // LAG AV/PÅ
  document.getElementById('toggleSkog').addEventListener('change', function() {
    if (skogLag) this.checked ? kart.addLayer(skogLag) : kart.removeLayer(skogLag);
  });

  document.getElementById('toggleSopp').addEventListener('change', function() {
    if (soppObservasjonerLag) this.checked ? kart.addLayer(soppObservasjonerLag) : kart.removeLayer(soppObservasjonerLag);
  });

  // KNAPPER
  document.getElementById('btnFiltrer').addEventListener('click', filtrerPaRadius);
  document.getElementById('btnNullstill').addEventListener('click', nullstillFilter);
});

// ==============================================
// HJELPEFUNKSJONER FOR GEOMETRI
// ==============================================

/**
 * Beregner tyngdepunktet (centroid) til et polygon ved hjelp av shoelace-formelen
 * @param {Array} coordinates - Array av [lon, lat] koordinater
 * @returns {Array} - [lon, lat] for tyngdepunktet
 */
function calculatePolygonCentroid(coordinates) {
  let sumX = 0, sumY = 0, sumArea = 0;
  
  for (let i = 0; i < coordinates.length - 1; i++) {
    const [x1, y1] = coordinates[i];
    const [x2, y2] = coordinates[i + 1];
    
    const crossProduct = x1 * y2 - x2 * y1;
    sumArea += crossProduct;
    sumX += (x1 + x2) * crossProduct;
    sumY += (y1 + y2) * crossProduct;
  }
  
  const area = sumArea / 2;
  
  // Håndter tilfeller med null-areal (degenererte polygoner)
  if (Math.abs(area) < 1e-10) {
    // Returner første koordinat som fallback
    return coordinates[0];
  }
  
  // Bruk absoluttverdien av area for å håndtere både medurs og moturs koordinater
  const absArea = Math.abs(area);
  const centroidX = sumX / (6 * area);
  const centroidY = sumY / (6 * area);
  
  return [centroidX, centroidY];
}

/**
 * Sjekker om en feature er innenfor gitt radius
 * Støtter både Polygon og MultiPolygon geometrier
 * @param {Object} feature - GeoJSON feature
 * @param {Array} userPos - [lat, lon] for brukerposisjon
 * @param {number} radiusKm - Radius i kilometer
 * @returns {boolean} - true hvis innenfor radius
 */
function isFeatureWithinRadius(feature, userPos, radiusKm) {
  try {
    const geomType = feature.geometry.type;
    let centroid;
    
    if (geomType === 'Polygon') {
      // For Polygon: coordinates[0] er den ytre ringen
      centroid = calculatePolygonCentroid(feature.geometry.coordinates[0]);
    } else if (geomType === 'MultiPolygon') {
      // For MultiPolygon: coordinates[0][0] er den ytre ringen av første polygon
      centroid = calculatePolygonCentroid(feature.geometry.coordinates[0][0]);
    } else {
      console.warn('Ukjent geometritype:', geomType);
      return false;
    }
    
    // Centroid er [lon, lat], mens userPos er [lat, lon]
    const avstand = regnUtAvstandKm(
      userPos[0], userPos[1],
      centroid[1], centroid[0]
    );
    
    return avstand <= radiusKm;
  } catch (error) {
    console.error('Feil ved beregning av avstand:', error);
    return false;
  }
}

// ==============================================
// ROMLIG FILTRERING — vis skog innenfor X km
// ==============================================
function filtrerPaRadius() {
  const radiusKm = parseFloat(document.getElementById('radius').value);

  if (isNaN(radiusKm) || radiusKm < CONFIG.filter.minRadius || radiusKm > CONFIG.filter.maxRadius) {
    alert(`Vennligst oppgi en gyldig radius mellom ${CONFIG.filter.minRadius} og ${CONFIG.filter.maxRadius} km`);
    return;
  }

  if (!navigator.geolocation) {
    alert('Nettleseren din støtter ikke geolokasjon. Vennligst oppdater nettleseren eller bruk en annen nettleser.');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    function(pos) {
      brukerPosisjon = [pos.coords.latitude, pos.coords.longitude];

      // Marker brukerposisjon
      UI_STATE.userMarker = L.marker(brukerPosisjon)
        .bindPopup(CONFIG.ui.markerPopupText)
        .addTo(kart);

      // Vis radius-sirkel
      UI_STATE.filterCircle = L.circle(brukerPosisjon, {
        radius: radiusKm * 1000,
        color: CONFIG.ui.circleColor,
        fillOpacity: CONFIG.ui.circleFillOpacity
      }).addTo(kart);

      // Fjern eksisterende skoglag
      if (skogLag) kart.removeLayer(skogLag);

      // Filtrer skogsområder basert på radius
      const filtrerteFeatures = alleSkogFeatures.filter(feature => 
        isFeatureWithinRadius(feature, brukerPosisjon, radiusKm)
      );

      // Legg til filtrerte features
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

      // Oppdater kartet
      kart.setView(brukerPosisjon, CONFIG.map.filteredZoom);
      UI_STATE.isFiltered = true;
      
      console.log(`Filtrert til ${filtrerteFeatures.length} skogsområder innenfor ${radiusKm} km`);
    },
    function(error) {
      let errorMessage = 'Kunne ikke hente din posisjon. ';
      
      switch(error.code) {
        case error.PERMISSION_DENIED:
          errorMessage += 'Du må gi tillatelse til å bruke posisjon.';
          break;
        case error.POSITION_UNAVAILABLE:
          errorMessage += 'Posisjonsinformasjon er ikke tilgjengelig.';
          break;
        case error.TIMEOUT:
          errorMessage += 'Forespørselen om posisjon tok for lang tid.';
          break;
        default:
          errorMessage += 'En ukjent feil oppstod.';
      }
      
      alert(errorMessage);
      console.error('Geolocation error:', error);
    }
  );
}

function nullstillFilter() {
  // Fjern brukermarkør
  if (UI_STATE.userMarker) {
    kart.removeLayer(UI_STATE.userMarker);
    UI_STATE.userMarker = null;
  }
  
  // Fjern filtreringssirkel
  if (UI_STATE.filterCircle) {
    kart.removeLayer(UI_STATE.filterCircle);
    UI_STATE.filterCircle = null;
  }
  
  // Gjenopprett originalt skoglag hvis filtrert
  if (UI_STATE.isFiltered && skogLag) {
    kart.removeLayer(skogLag);
    
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
  
  // Tilbakestill kartvisning
  kart.setView(CONFIG.map.center, CONFIG.map.zoom);
  
  // Tilbakestill brukerposisjon
  brukerPosisjon = null;
  
  // Oppdater tilstand
  UI_STATE.isFiltered = false;
  
  // Tilbakestill radiusinput til standard
  document.getElementById('radius').value = CONFIG.filter.defaultRadius;
  
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