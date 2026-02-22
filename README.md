# webkart-gis
Oppgave 1 i GIS

Problemstilling:
Hvor i Norge er kritisk infrastruktur (kraftstasjoner, sykehus, vannverk) utsatt for naturfarer (flom, skred, ekstremvær)?

## Kartlag

### Agder (GeoJSON)
Kommunegrenser for Agder-regionen lastes fra en lokal GeoJSON-fil (`data/agder.geojson`).

### Skredfare (REST API)
Skredfaresoner hentes direkte fra **NVE sitt ArcGIS REST API** (GeoNorge) som GeoJSON-vektordata – ikke som WMS-bilder. Dette oppfyller kravet om *"Data hentet direkte via et API (f.eks. Tjenester fra GeoNorge eller Kartverket)"*.

**Endepunkt:**
```
https://nve.geodataonline.no/arcgis/rest/services/Skredfaresoner1/MapServer/{lagId}/query
```

| Lag-ID | Returperiode | Farge    |
|--------|--------------|----------|
| 0      | 100 år       | Rød      |
| 1      | 1 000 år     | Oransje  |
| 2      | 5 000 år     | Gul      |

**Eksempel-kall (100-år, Agder-bbox) – kopi-klar:**
```
https://nve.geodataonline.no/arcgis/rest/services/Skredfaresoner1/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson&geometry=6.8%2C57.9%2C9.3%2C59.1&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&resultRecordCount=500
```

Parametere forklart:
```
where=1%3D1               → velg alle objekter
outSR=4326                → WGS84 koordinater
f=geojson                 → GeoJSON-format
geometry=6.8,57.9,9.3,59.1 → Agder bounding box (vest,sør,øst,nord)
geometryType=esriGeometryEnvelope → filter-type: rektangel
spatialRel=esriSpatialRelIntersects → ta med alle som krysser bbox
resultRecordCount=500     → maks objekter (tilstrekkelig for Agder)
```

API-et returnerer GeoJSON som vises som interaktive polygoner. Klikk på et polygon for å se faresoneinformasjon. Brukeren kan slå av/på hvert faresonekart via lagkontrollen øverst til høyre.

### Romlig spørring
Klikk på kartet for å se om koordinatet befinner seg inne i Agder (krever Turf.js).
