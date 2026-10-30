# Haven

Location sharing for couples and families, built on *contextual empathy*
rather than tracking. The map answers "why haven't they replied?" — battery,
weather, timezone, movement — so nobody has to ask.

- **Phase 1 — architecture & data model:** [`docs/01-architecture.md`](docs/01-architecture.md)
- **Phase 2 — realtime & Trust Mode:** [`docs/02-realtime-and-privacy.md`](docs/02-realtime-and-privacy.md)
- **Phase 3 — Live Context Map:** [`docs/03-live-context-map.md`](docs/03-live-context-map.md)
- **Accounts & invites:** [`docs/04-accounts-and-invites.md`](docs/04-accounts-and-invites.md)
- **Schema:** [`infra/db/migrations/`](infra/db/migrations/)
- **Shared types:** [`packages/contracts/src/`](packages/contracts/src/)

```bash
pnpm install
cp apps/server/.env.example apps/server/.env   # DATABASE_URL, REDIS_URL, JWT_SECRET
pnpm db:migrate
pnpm server         # curl localhost:4000/health → {"ok":true,"db":true,"redis":true}
pnpm mobile
```

Postgres and Redis can be free hosted services (Neon and Upstash, with
step-by-step instructions in [`apps/server/.env.example`](apps/server/.env.example))
or local containers via `pnpm db:up` (Docker). The map also runs with no
backend at all against a sample circle: see [docs/03 §10](docs/03-live-context-map.md).

## Status

| Pillar | Phase 1 (schema + structure) | Phase 2 (backend) | Phase 3 (frontend) |
|---|---|---|---|
| Live Context Map | ✅ | ✅ socket fan-out + HTTPS background reports | ✅ map, avatars, ring, weather, sheet, location upload (foreground + background) · ⏳ live weather |
| Tap-to-Nudge | ✅ | ✅ | ✅ nudge bar, burst + haptics, "seen" · ⏳ real push |
| Trust Mode | ✅ | ✅ fuzzing + tests | ✅ discs, client privacy, toggle (all circles at once) · ⏳ per-circle |
| Home Screen Widget | ✅ | ⏳ REST endpoint | ⏳ |
| Accounts & invites ([docs/04](docs/04-accounts-and-invites.md)) | ✅ | ✅ email sign-in, circles, invites, devices, leave, delete | ✅ onboarding, invite/join, profile & settings |

Verified by typecheck, ESLint, 61 server and 150 mobile unit tests, and the demo map
running on the iOS simulator. The backend has **not yet run against a real
database**: nothing is configured until Neon and Redis are set up.
