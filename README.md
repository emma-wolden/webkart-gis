# webkart-gis

Interaktivt kart som viser skredfaresoner i Agder basert på NVE-data. Kartet lar brukere utforske faresonene for 100-, 1000- og 5000-årsintervaller oppå kommunegrensene for Agder. Klikk i kartet for å se om et punkt befinner seg inne i Agder-regionen.

## Demo

Åpne `index.html` direkte i nettleseren (ingen server kreves):

```bash
# Alternativ 1 – åpne direkte
open index.html

# Alternativ 2 – enkel lokal server med Python
python3 -m http.server 8080
# Besøk http://localhost:8080
```

## Teknisk Stack

| Teknologi | Versjon | Rolle |
|---|---|---|
| [Leaflet](https://leafletjs.com/) | 1.9.4 | Kartrammeverk |
| Leaflet WMS (`L.tileLayer.wms`) | – | WMS-lagintegrasjon |
| [Turf.js](https://turfjs.org/) | 6.x | Romlig analyse (punkt-i-polygon) |
| OpenStreetMap / Carto | – | Basiskart (lys tema) |
| NVE WMS API | – | Skredfaresoner (lag 0/1/2) |

## Datakatalog

| Datasett | Kilde | Format | Bearbeiding |
|---|---|---|---|
| Agder kommunegrenser | Kartverket | GeoJSON | Importert og stilisert med farge og popup |
| Skredfaresoner 100/1000/5000 år | NVE | WMS | Dynamisk overlay via `L.tileLayer.wms`, lag-ID `0`/`1`/`2` |
| Basiskart | OpenStreetMap / Carto | Tile XYZ | Lys tema (`light_all`) |

## Arkitekturskisse

```
┌─────────────────────────────────────────────────┐
│                   Nettleser                      │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │            Leaflet-kart                  │   │
│  │                                          │   │
│  │  ┌──────────┐  ┌──────────────────────┐ │   │
│  │  │ GeoJSON  │  │  WMS-lag (NVE)       │ │   │
│  │  │ Agder    │  │  Lag 0 – 100 år      │ │   │
│  │  │ kommuner │  │  Lag 1 – 1000 år     │ │   │
│  │  └────┬─────┘  │  Lag 2 – 5000 år     │ │   │
│  │       │        └──────────┬───────────┘ │   │
│  └───────┼───────────────────┼─────────────┘   │
└──────────┼───────────────────┼─────────────────┘
           │                   │
    ┌──────▼──────┐   ┌────────▼────────────────┐
    │ agder.geojson│  │ NVE WMS MapServer        │
    │ (lokal fil)  │  │ Skredfaresoner1/MapServer│
    └─────────────┘  └─────────────────────────┘
```

**Dataflyt:**
1. `fetch('data/agder.geojson')` laster kommunegrenser lokalt → Leaflet tegner polygoner
2. Etter innzooming kalles `loadWMSLayersOnce()` → Leaflet henter WMS-tiles fra NVE
3. Klikk-hendelse → Turf.js sjekker om koordinat er inne i Agder

## Refleksjon

- **WMS-pålitelighet**: NVE sitt WMS-endepunkt kan av og til ha driftsavbrudd eller trege responstider. Et fallback-varsel eller caching av tiles lokalt ville gjort kartet mer robust.
- **Søkefunksjonalitet**: Det mangler mulighet til å søke etter kommunenavn eller adresse. Integrasjon med Nominatim (OpenStreetMap) eller Kartverkets adresse-API ville økt brukervennligheten betydelig.
- **Mobiltilpasning**: Kartpanelene og lagkontrollen er ikke fullt ut optimalisert for små skjermer. Responsiv design med media queries og touch-vennlige kontroller bør prioriteres.
- **Datahyppighet**: Skredfaresoner oppdateres sjelden, men kommunegrenser kan endres ved kommunesammenslåinger. Automatisk henting fra Kartverkets API i stedet for lokal GeoJSON-fil ville holdt dataene oppdaterte.
- **Supabase-integrasjon**: For å lagre brukernotater, markerte fareområder eller historiske klikkdata kunne Supabase brukes som backend-database. Dette ville muliggjort deling og persistent lagring av brukergenerert innhold.
