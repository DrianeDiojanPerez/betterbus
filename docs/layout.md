# Project layout

```
src/
  env.ts                 server env vars, checked with T3 Env
  routes/
    __root.tsx           page shell, theme boot script
    index.tsx            the map page: markers, stop card, bus panel
  server/
    live-map.ts          getLiveMap and getSavedRoutes
    road-match.ts        snaps route lines onto streets with OSRM
    route-fixes.ts       hand fixes where OSRM picks the wrong street
    road-geometry.json   saved matched lines
    route-snapshot.json  saved routes and stops
  lib/
    bus-tracker.ts       smooths buses, finds stops ahead, estimates arrivals
    geo.ts               distances and points along a line
    live-map.ts          React Query options for the feed
    settings.ts          theme and map style, kept in localStorage
  components/
    road-ahead.tsx       the dotted road to a stop
    map-settings.tsx     the settings drawer
    ui/                  shadcn components
public/
  map-styles/            the Slate and Night dark map styles, and the previews in settings
```

Tests sit next to the code they cover, as `*.test.ts`.
