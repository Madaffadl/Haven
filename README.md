# Haven

Location sharing for couples and families, built on *contextual empathy*
rather than tracking. The map answers "why haven't they replied?" — battery,
weather, timezone, movement — so nobody has to ask.

- **Phase 1 — architecture & data model:** [`docs/01-architecture.md`](docs/01-architecture.md)
- **Phase 2 — realtime & Trust Mode:** [`docs/02-realtime-and-privacy.md`](docs/02-realtime-and-privacy.md)
- **Phase 3 — Live Context Map:** [`docs/03-live-context-map.md`](docs/03-live-context-map.md)
- **Schema:** [`infra/db/migrations/`](infra/db/migrations/)
- **Shared types:** [`packages/contracts/src/`](packages/contracts/src/)

```bash
pnpm install
pnpm db:up          # postgres+postgis, redis
pnpm db:migrate
pnpm server
pnpm mobile
```

## Status

| Pillar | Phase 1 (schema + structure) | Phase 2 (backend) | Phase 3 (frontend) |
|---|---|---|---|
| Live Context Map | ✅ | ✅ socket fan-out | ✅ map, avatars, ring, weather, sheet |
| Tap-to-Nudge | ✅ | ✅ | ⏳ burst animation |
| Trust Mode | ✅ | ✅ fuzzing + tests | ✅ discs + client privacy · ⏳ toggle UI |
| Home Screen Widget | ✅ | ⏳ REST endpoint | ⏳ |

Phase 3 is verified by typecheck, 78 unit tests and production Metro bundles
for both platforms, but has **not yet been run on a device** (needs a Mapbox
token and a development build).
