<p align="center"><img src="public/logo512.png" alt="E-Bus" width="128"></p>

<h3 align="center">E-Bus: a live map of the electric buses in Belize City</h3>

- [Run it](#run-it)
- [Check your work](#check-your-work)
- [Docs](#docs)

## Run it

```
npm install
cp .env.example .env
npm run dev
```

Then open http://localhost:3000.

## Check your work

```
npm run typecheck
npm run lint
npm run check
npm test
```

## Docs

- [How it works](docs/how-it-works.md): the feed, the server functions, and how the map draws buses and roads
- [Commands](docs/commands.md): every `npm run` script
- [Replaying a recorded day](docs/replay.md)
- [Project layout](docs/layout.md): where things live
- [Troubleshooting](docs/troubleshooting.md)
