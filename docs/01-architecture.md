# Haven — Phase 1: System Architecture & Data Model

Version 1.0 (MVP). Scope is the four pillars: Live Context Map, Tap-to-Nudge,
Trust Mode, Live Home Screen Widget.

---

## 1. Shape of the system

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  Expo / React Native        │         │  iOS WidgetKit               │
│  ├─ Mapbox GL (native)      │         │  Android Glance              │
│  ├─ Reanimated 3 / Lottie   │◀──────▶│  (separate process,          │
│  └─ expo-task-manager       │ App     │   short-TTL scoped token)    │
└──────────┬──────────────────┘ Group  └───────────────┬──────────────┘
           │                                           │
           │ Socket.IO (primary)                       │ HTTPS, ≤1 req / 15 min
           │ HTTPS (bootstrap, mutations)              │
           ▼                                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Node.js — Fastify + Socket.IO                                        │
│  ┌────────────┬──────────────┬──────────────┬────────────────────┐   │
│  │ realtime/  │ domain/      │ infra/       │ jobs/              │   │
│  │ gateway    │ pure logic   │ db,redis,…   │ weather, partitions│   │
│  └────────────┴──────────────┴──────────────┴────────────────────┘   │
└──────┬─────────────────────────────────┬──────────────────────┬──────┘
       │                                 │                      │
       ▼                                 ▼                      ▼
┌───────────────┐              ┌──────────────────┐   ┌──────────────────┐
│ PostgreSQL 16 │              │ Redis            │   │ Open-Meteo, APNs │
│ + PostGIS 3.4 │              │ presence,        │   │ FCM              │
│ durable truth │              │ socket adapter,  │   │                  │
│               │              │ rate limits      │   │                  │
└───────────────┘              └──────────────────┘   └──────────────────┘
```

Redis holds nothing durable. If it is wiped, every user reconnects and
presence rebuilds within one heartbeat. Postgres holds everything that
matters. This split is what lets the realtime tier scale horizontally without
a distributed-state problem.

---

## 2. Monorepo layout

```
haven/
├── apps/
│   ├── mobile/              @haven/mobile    — Expo app + native widgets
│   └── server/              @haven/server    — Fastify + Socket.IO
├── packages/
│   ├── contracts/           @haven/contracts — shared types + Zod schemas
│   └── config/              shared eslint / tsconfig presets
├── infra/
│   ├── db/migrations/       ordered, forward-only SQL
│   ├── db/seed/
│   └── docker-compose.yml   postgres+postgis, redis
├── docs/
└── tsconfig.base.json
```

**Why a monorepo.** `@haven/contracts` is the point. The socket event map, the
`MemberPresence` shape, the `TrustMode` enum and the nudge vocabulary are
defined once and imported by both sides. Adding a Trust Mode without updating
the server's projection becomes a *compile error* rather than a privacy
incident discovered in production. For an app whose core promise is "we will
not leak your location", that guarantee is worth the build-tooling cost.

The enums in `0001_extensions.sql` are mirrored by Zod enums in
`packages/contracts`. A drift test (Phase 2) asserts the two sets are equal.

---

## 3. Frontend — `apps/mobile/`

```
apps/mobile/
├── app/                              # expo-router: routing only, no logic
│   ├── _layout.tsx                   # providers, font loading, splash gate
│   ├── (auth)/                       # phone entry, OTP, invite-code join
│   └── (app)/
│       ├── index.tsx                 # the map — the app's only real screen
│       ├── circle/[circleId].tsx
│       └── settings/
│
├── src/
│   ├── features/                     # vertical slices; each owns its UI+state
│   │   ├── map/
│   │   │   ├── LiveContextMap.tsx       # Mapbox host  ─┐
│   │   │   ├── AvatarMarker.tsx         #               │ Phase 3
│   │   │   ├── BatteryRing.tsx          # SVG arc       │
│   │   │   ├── WeatherGlyph.tsx         # Lottie        │
│   │   │   ├── MemberSheet.tsx          # bouncy sheet ─┘
│   │   │   └── useCameraChoreography.ts
│   │   ├── nudge/                    # tray, send, receive burst, haptics
│   │   ├── trust-mode/               # the toggle + its confirmation copy
│   │   ├── circle/                   # invite, join, member list
│   │   ├── onboarding/               # permission priming (see note below)
│   │   └── widget-bridge/            # JS ↔ native widget reload + App Group
│   │
│   ├── core/                         # cross-cutting, no UI
│   │   ├── location/
│   │   │   ├── backgroundTask.ts     # expo-task-manager registration
│   │   │   ├── policy.ts             # ← the battery story, see §6.3
│   │   │   └── significantChange.ts
│   │   ├── realtime/                 # socket client, backoff, outbox
│   │   ├── context/                  # battery + timezone sampling
│   │   ├── api/                      # typed REST client over @haven/contracts
│   │   ├── storage/                  # MMKV; App Group container on iOS
│   │   ├── permissions/
│   │   └── telemetry/
│   │
│   ├── ui/                           # the design system — no feature imports
│   │   ├── theme/tokens.ts           # colour, spacing, radii, elevation
│   │   ├── primitives/               # GlassPanel, PillButton, Sheet, Avatar
│   │   ├── motion/springs.ts         # named spring configs, used everywhere
│   │   └── icons/
│   │
│   ├── state/                        # zustand stores (presence, session, ui)
│   └── lib/
│
├── modules/haven-widgets/            # local Expo module
│   ├── ios/                          # WidgetKit, Swift
│   ├── android/                      # Glance, Kotlin
│   └── src/                          # TS surface: reloadWidgets(), setPin()
│
└── assets/{lottie,fonts,images}
```

**`app/` holds routes, `src/` holds everything else.** expo-router makes every
file under `app/` a URL. Putting components there means a stray file becomes a
navigable screen. Routes stay as thin as a layout plus one feature import.

**`features/` are vertical, `core/` and `ui/` are horizontal.** `ui/` must
never import from `features/`; that one rule keeps the design system
extractable and stops the circular-import spiral that kills RN build times.

**Native widgets are a local Expo module, not a config plugin.** WidgetKit
needs a real app extension target, a shared App Group, and Swift that reads
the cached snapshot. A local module keeps that Swift/Kotlin in the repo and
versioned with the TS that calls it. This forces `expo prebuild` and the
[Development Build](https://docs.expo.dev/develop/development-builds/introduction/)
workflow — Expo Go cannot host Mapbox's native SDK or an app extension anyway,
so this is not a cost the widget introduces.

> UI design work — the token set, glass surfaces, spring choreography and the
> avatar/battery-ring composition — is Phase 3, and is where I'll pull in the
> `ui-ux-pro-max` skill you specified. Phase 1 only fixes *where those files
> live*.

---

## 4. Backend — `apps/server/`

```
apps/server/
├── src/
│   ├── main.ts                       # composition root: wire, then listen
│   ├── config/env.ts                 # Zod-parsed env; fails fast at boot
│   │
│   ├── http/                         # Fastify: auth, bootstrap, widget, health
│   │   └── routes/{auth,circles,me,widget}.ts
│   │
│   ├── realtime/
│   │   ├── gateway.ts                # io instance + Redis adapter
│   │   ├── middleware/authenticate.ts
│   │   ├── rooms.ts                  # room naming: circle:<id>, user:<id>
│   │   └── handlers/
│   │       ├── location.ts           # ingest → project → fan out   ─┐
│   │       ├── nudge.ts              # validate → rate-limit → emit  │ Phase 2
│   │       └── presence.ts           # connect/disconnect liveness  ─┘
│   │
│   ├── domain/                       # pure, dependency-free, unit-testable
│   │   ├── identity/
│   │   ├── circle/
│   │   ├── location/
│   │   │   ├── fuzz.ts               # snapping + hysteresis (mirrors SQL)
│   │   │   └── project.ts            # MemberPresence construction
│   │   ├── nudge/
│   │   ├── context/
│   │   └── place/
│   │
│   ├── infra/                        # everything that does I/O
│   │   ├── db/{pool,repositories}/
│   │   ├── redis/{presence,ratelimit,adapter}.ts
│   │   ├── weather/openMeteo.ts
│   │   ├── push/{apns,fcm}.ts
│   │   └── geo/
│   │
│   └── jobs/
│       ├── refreshWeather.ts         # staleness-driven, batched by cell
│       ├── provisionPartitions.ts
│       └── purgeRetention.ts         # nudges 30d, history per-user setting
└── test/
```

**`domain/` is pure.** `fuzz.ts` takes a coordinate and returns a coordinate —
no pool, no socket. The privacy logic is therefore testable as a plain
function, including the adversarial tests that matter: *collect 10 000
consecutive fuzzed outputs for a moving user and assert the mean does not
converge on the true position.* You cannot write that test against code that
needs a live database.

**Rate limits and presence live in Redis, not Postgres.** A nudge-rate check
on every tap must not touch the primary. Presence likewise: sockets connect
and drop constantly, and writing that to disk would make the busiest write in
the system also the least valuable.

---

## 5. The data model

```
users ──┬── devices ─── auth_sessions
        │
        ├── location_states          (1:1, hot, UPDATE-heavy, PRECISE truth)
        ├── location_history         (0:N, opt-in, partitioned by month)
        ├── widget_pins
        │
        └── circle_members ──┬── circles ── circle_invites
                             ├── circle_member_trust      (privacy, per pair)
                             ├── location_fuzz_anchors    (stable cells)
                             └── trust_mode_changes       (audit, append-only)

circles ──┬── nudges
          └── places ── place_events

weather_cache   (standalone, keyed by ~10 km cell, disposable)
```

| Table | Why it exists |
|---|---|
| `users` | Identity, global Trust Mode default, history opt-in + retention. |
| `devices` | Push tokens **and** the OS permission state, so the UI can say *why* someone's dot is frozen. |
| `auth_sessions` | Refresh tokens (hashed). Scopes the widget's separate short-TTL token. |
| `circles` | The intimacy boundary. Capped at 8 by default. |
| `circle_members` | Membership, per-circle nickname, nudge mute window. |
| `circle_member_trust` | **Trust Mode per (member, circle).** `NULL` mode inherits the user default. |
| `trust_mode_changes` | Append-only audit of every privacy change, incl. actor + device. |
| `circle_invites` | Short speakable codes from an unambiguous alphabet, unique among live rows. |
| `widget_pins` | Who each widget slot watches. Server-side so the backend can authorise a background refresh. |
| `location_states` | One row per user. Precise coordinate + battery + weather + timezone, denormalised for fan-out. |
| `location_fuzz_anchors` | The cached fuzz cell per (user, circle). See §6.1 — this table *is* Approximate mode. |
| `location_history` | Opt-in trail, range-partitioned monthly so expiry is `DROP TABLE`. |
| `weather_cache` | One upstream call per ~10 km cell, shared across everyone in it. |
| `nudges` | 30-day retention, idempotency key, ack timestamp. |
| `places` / `place_events` | Geofence foundation; tables only, no producer in v1.0. |

### Indexing choices worth calling out

- `location_states` has **no** per-user secondary index — the primary key is
  the user. It carries a GIST index on `geom` only because geofence
  evaluation needs `ST_DWithin`.
- `location_history` partitions get **BRIN** on `captured_at`, not B-tree.
  Rows arrive in timestamp order, so a few kilobytes of block-range summaries
  replace a multi-gigabyte index.
- Every primary key is **UUIDv7** (`haven_uuidv7()`). On append-only tables
  taking every write in the system, random v4 keys dirty a fresh page per
  insert. v7 keeps inserts sequential and makes "the last hour" a range scan.
  PostgreSQL 18 has this natively; the shim exists to run on 16/17.
- Partial indexes everywhere membership is filtered (`WHERE left_at IS NULL`,
  `WHERE deleted_at IS NULL`), because the hot query is always "live members".

---

## 6. The three decisions that carry the product

### 6.1 Fuzzing must be *stable*, not random

The obvious implementation of Approximate mode adds random jitter to each
broadcast. **It does not work.** An observer who records N samples averages
the noise away and recovers the true position to within `jitter / √N`.
Watching a "fuzzy" dot over one evening locates someone's home.

Haven snaps instead. The position is projected into a square grid of
~`2 × radius` cells and the **cell centroid** is broadcast. Repeated
observation of a stationary member yields the same point forever, so it
carries no additional information. Three details make it hold up:

1. **Salted grid phase.** The lattice origin is offset by a per-(user, circle)
   salt stored in `location_fuzz_anchors.phase_salt`. Without it the grid is
   public knowledge and a centroid bounds the true position to a known square.
2. **Hysteresis.** Standing near a cell boundary would flip the centroid back
   and forth — visually broken, and it leaks the boundary's location. The
   anchor is cached and only re-snapped once the member is >0.75 cells from
   it. This is why the anchor is a *table* and not a pure function call.
3. **Latitude correction.** EPSG:3857 metres compress by `cos(lat)`. A "1 km"
   cell is ~500 m on the ground in Helsinki without the correction.

`haven_snap_to_cell()` and `haven_cell_key()` in `0005_privacy_and_weather.sql`
implement this; `domain/location/fuzz.ts` mirrors it for the broadcast path.

**Precise coordinates are always stored.** Fuzzing is a projection at read
time, because (a) you must always see your own true position, (b) switching
back to Precise must be instant with no gap, and (c) a client trusted to fuzz
its own coordinates can be patched to lie about them.

### 6.2 Exactly one read path

`haven_circle_presence(viewer, circle)` is the only sanctioned way to read
location. It checks membership internally, resolves Trust Mode, and returns a
coordinate that is *already* projected — the precise value is never in the
caller's memory.

This is enforced by grants, not convention. `haven_app` has column-level
`SELECT` on `location_states` **excluding `geom`**, and the function is
`SECURITY DEFINER`. A developer who writes their own join gets a permission
error on their laptop instead of shipping a leak.

It also means Trust Mode cannot drift: the bootstrap query, the socket
fan-out, and the widget endpoint share one implementation. Three
implementations of a privacy rule is three chances to get it wrong.

Two deliberate consequences:

- **`ghost` fails closed.** Unknown user, missing anchor, or a member who
  turned on Approximate before any anchor was written → no coordinate at all.
  Never a fallback to the real point.
- **Staleness is a product state.** `is_stale` distinguishes "parked at home"
  from "lost signal an hour ago". Rendering those identically is exactly the
  anxiety this app exists to remove.

### 6.3 The battery budget is an architectural constraint

A location app that costs 15%/day gets deleted, so the write path is designed
around it rather than tuned afterwards:

- **Significant-change / geofence-based wake, not continuous GPS.** Continuous
  `kCLLocationAccuracyBest` is the single largest drain available on iOS.
- **Adaptive cadence** in `core/location/policy.ts`: still → 10 min, walking →
  2 min, driving → 30 s. Below 20% battery, or in Low Power Mode, everything
  halves. The product's own battery indicator would be absurd if Haven were
  what drained it.
- **One socket, one payload.** Location, battery, activity and timezone ship
  together. Separate channels mean separate radio wake-ups, and the radio —
  not the GPS chip — is usually the real cost.
- **Deferred uploads** while backgrounded: the OS batches fixes and we flush
  on wake rather than keeping the radio hot.
- **Widgets poll on a budget.** WidgetKit timelines are rate-limited by iOS
  regardless; the widget refreshes at most every 15 minutes and is otherwise
  pushed fresh data via a silent notification when a pinned member's state
  changes materially.

---

## 7. Deliberately not in v1.0

Place/geofence *producers* (tables exist, nothing writes `place_events`),
driving reports, SOS, chat, location history UI, web app, E2E encryption of
coordinates. E2E is the significant one: it is the right end state for this
product, but it is incompatible with server-side fuzzing and geofencing as
designed here, so it is a v2 architecture, not a v1 feature.

---

## 8. Running it

```bash
pnpm install
pnpm db:up                 # postgres+postgis and redis via docker compose
pnpm db:migrate            # applies infra/db/migrations in order
pnpm server                # :4000
pnpm mobile                # expo dev client
```

Migrations are forward-only and numbered. Each file is idempotent at the
extension/function level but not at the table level — the runner tracks
applied versions in a `schema_migrations` table (Phase 2).

---

## 9. Next — Phase 2

Socket event map and the ingest pipeline, the PostGIS fuzzing path end to end
(including the hysteresis logic that `location_fuzz_anchors` exists for), the
nudge fan-out with Redis rate limiting, and the push fallback for recipients
whose socket is closed.
