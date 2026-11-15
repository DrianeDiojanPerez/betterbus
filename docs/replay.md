# Replaying a recorded day

When the buses aren't running, you can play back a day of recorded positions and use the app as if they were.

The recordings and the replay script live outside the repo, in `~/bus-recordings/`:

```
~/bus-recordings/
  replay-feed.mjs
  2026-11-09/
    routes.json
    bus-7.jsonl
    bus-8.jsonl
```

## Start it

```
node ~/bus-recordings/replay-feed.mjs [day] [port]
```

- `day` is a folder next to the script. Defaults to `2026-11-09`.
- `port` defaults to `4545`.

The script has no dependencies. It serves `/live-map/data` in the same shape as the real feed, plays the day in real time, and loops at the end. Timestamps are shifted to now, so the buses look live.

## Point the app at it

In `.env`:

```
LIVE_MAP_FEED_URL=http://localhost:4545/live-map/data
```

Restart `npm run dev`. To go back to the real buses, set it back to the real feed URL.

## Adding a day

Make a new folder named after the day, with a `routes.json` (the feed's `routes` array) and one `bus-<id>.jsonl` per bus, holding one feed bus row per line. Then pass the folder name as `day`.
