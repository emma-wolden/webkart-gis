# webkart-gis
Oppgave 1 i GIS

Problemstilling:
Hvor i Norge er kritisk infrastruktur (kraftstasjoner, sykehus, vannverk) utsatt for naturfarer (flom, skred, ekstremvær)?

## Eksternt API: Kartverket REST API (WFS)

Skredfare-data hentes direkte fra **Kartverket WFS (Web Feature Service)**:

- **Endepunkt:** `https://wfs.geonorge.no/skwms1/wfs.py`
- **Format:** GeoJSON (`application/json`)
- **Standard:** OGC WFS 2.0.0

### Eksempel-kall (100-år faresonekart for Agder)
```
https://wfs.geonorge.no/skwms1/wfs.py?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAME=skred%3ASkredsone_100&OUTPUTFORMAT=application%2Fjson&BBOX=6.5%2C57.5%2C9.5%2C59.5%2Curn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A4326
```

### Lag og farger
| Faresonekart | Lag-navn          | Farge    |
|--------------|-------------------|----------|
| 100 år       | `Skredsone_100`   | Rød      |
| 1000 år      | `Skredsone_1000`  | Oransje  |
| 5000 år      | `Skredsone_5000`  | Gul      |

### Hvorfor Kartverket fremfor NVE ArcGIS WMS?
- ✅ Korrekte CORS-headere – ingen "access control checks"-feil i nettleser
- ✅ Offisiell norsk geodatatjeneste (OGC-kompatibel)
- ✅ Returnerer GeoJSON – enkel å behandle i JavaScript/Leaflet
- ✅ Oppfyller oppgavekravet: *"Data hentet direkte via et API (f.eks. … Kartverket)"*
