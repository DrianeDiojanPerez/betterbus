# Troubleshooting

- **"Feed offline" or no buses:** the feed in `LIVE_MAP_FEED_URL` isn't answering. If it points at the replay, check the replay is running on its port. If the real buses are off, use the [replay](replay.md).
- **The app still uses the old feed after editing `.env`:** restart `npm run dev`.
- **`Invalid environment variables` on start:** `LIVE_MAP_FEED_URL` is missing from `.env` or isn't a full URL. It needs the `http://` or `https://`.
- **`dispatcher is null` or another hooks error in the browser:** the page loaded React from two dependency builds. This happens when a second dev server runs in the same checkout. Stop the dev server, run `rm -rf node_modules/.vite`, start it again, and hard-reload the tab.
- **`Error: aborted` / `ECONNRESET` in the dev server log:** the browser hung up on a request, usually a feed poll cut off by a restart or reload. It's harmless.
- **`Image "wood-pattern" could not be loaded`:** the Liberty map style asks for a pattern its sprite doesn't have. MapLibre skips that fill. Ignore it.
- **`Road match failed for route …`:** OSRM didn't answer. The route draws with the feed's own line and is tried again after 10 minutes.
