# How it works

E-Bus shows where the electric buses in Belize City are right now, the road each one has left to drive, and when one will reach your stop.

```
Bus company feed → getLiveMap (server) → browser, every 5 s → map
```

## The server

The bus company's feed sends no CORS headers, so the browser can't call it directly. Two TanStack Start server functions in `src/server/live-map.ts` sit in between:

- **`getLiveMap`** fetches the feed from `LIVE_MAP_FEED_URL`. Riders who poll at the same moment share one upstream request.
- **`getSavedRoutes`** returns the routes and stops from `route-snapshot.json`, so the map draws them right away instead of waiting on the feed.

The feed's route lines are coarse and cut across blocks. The server snaps each one onto the streets with the public OSRM router (`road-match.ts`), then `route-fixes.ts` swaps out the few stretches where OSRM picks a street the buses don't take. Matched lines are saved in `road-geometry.json`, so a fresh server starts with them. A route the feed changes is matched again, once per process. If a match fails, the feed's own line is used for 10 minutes before trying again.

## The browser

The browser polls `getLiveMap` every 5 seconds with React Query. `src/lib/bus-tracker.ts` smooths each bus along its route between polls, works out which stops are ahead of it, and estimates arrivals.

The map is MapLibre with OpenFreeMap tiles. Each map style comes as a pair, a light map and a dark one, and follows the light or dark setting.

- **Stop card:** tap a stop to see the next bus coming. Dots show the road that bus has left before it reaches the stop.
- **Bus panel:** tap a bus to see its speed and the stops ahead. Pick a stop in the list and dots show the road from the bus to that stop.
- **Panels:** dark Liquid Glass on the light map, dark frosted glass on the dark map.

Settings (theme and map style) are kept in `localStorage`.
