# Haven — Phase 2: Realtime & Trust Mode

How location, context and nudges move through the system, and how a precise
GPS fix becomes something a circle is allowed to see.

Code: [`apps/server/src/`](../apps/server/src/) ·
Wire protocol: [`packages/contracts/src/socket.ts`](../packages/contracts/src/socket.ts) ·
Tests: [`apps/server/test/`](../apps/server/test/) (35 passing)

---

## 1. Event architecture

One Socket.IO connection per device, WebSocket transport only. Every event is
typed once in `@haven/contracts` and shared by both ends.

### Rooms

| Room | Members | Used for |
|---|---|---|
| `circle:<id>` | every live socket of every member | presence fan-out, circle nudges, liveness |
| `user:<id>` | every live socket of one user | direct nudges, own-device sync, "seen" receipts |

A socket joins its rooms once, at connect, from the memberships resolved
during authentication.

### Client → server (all acknowledged)

| Event | Payload | Ack returns |
|---|---|---|
| `location:report` | precise fix + battery + activity + timezone | `UploadPolicy` (next cadence) |
| `presence:heartbeat` | battery only, no GPS | `UploadPolicy` |
| `nudge:send` | circle, optional recipient, kind, client id | nudge id + timestamp |
| `nudge:ack` | nudge id | — |
| `trust:set` | circle (or `null` = global), mode, radius | — |

**Every event is acked, including failures.** The ack is the only signal a
client gets to tell "delivered" apart from "queued on a dead socket". A
handler that throws would otherwise leave the client retrying forever, so
`gateway.ts` wraps each handler in `guard()`, which turns any exception into
`{ ok: false, error: { code: 'internal' } }`.

### Server → client

| Event | When | Cost |
|---|---|---|
| `presence:bootstrap` | once per circle on connect; after a trust change | 1 projection query |
| `presence:update` | a member's *projected* state materially changed | 0 queries, already in hand |
| `presence:liveness` | a user's first socket opened / last socket closed | ~60 bytes, 0 queries |
| `nudge:received` | a nudge arrived | — |
| `nudge:delivered` | the recipient's client *rendered* it | — |
| `trust:changed` | a member changed privacy; **drop your cached position for them** | — |

`presence:liveness` is separate from `presence:update` on purpose. Connects
and disconnects are the most frequent events in the system: phones sleep,
wake, and switch from wifi to LTE all day. They must not cost a projection
or a database read.

---

## 2. The location pipeline

[`handlers/location.ts`](../apps/server/src/realtime/handlers/location.ts)

```
location:report
  │
  ├─ 1. validate            zod; reject malformed with invalid_payload
  ├─ 2. rate limit          Redis Lua, 60/min. An abuse ceiling, not cadence control
  ├─ 3. persist PRECISE     upsert guarded by captured_at (out-of-order safe)
  │                         └─ no row returned → older report → ack, broadcast nothing
  ├─ 4. history             fire-and-forget; opt-in enforced in SQL
  │
  ├─ 5. for each circle ─┬─ resolve Trust Mode      (cached on socket)
  │                      ├─ approximate? resolveAnchor → persist only if moved
  │                      ├─ projectPresence         (precise point never enters the value)
  │                      └─ hasMaterialChange?  ──no──▶ skip; the circle's radios stay asleep
  │                                             ──yes─▶ io.to(circle).except(user:self).emit
  │
  ├─ 6. own other devices   socket.to(user:self) — precise; the sender already knows its fix
  └─ 7. ack                 UploadPolicy — the server sets the next interval
```

### Projection is per circle, not per viewer

This is the most important optimisation in the realtime tier, and the privacy
model gives it to us for free. What a viewer may see depends only on the
`(subject, circle)` pair, never on who the viewer is. A circle of eight costs
one fuzzing computation and one room broadcast, not eight of each.

The one exception is the subject, who always sees their own precise position.
They are excluded with `.except(user:<id>)` and handled in step 6.

### Out-of-order reports

A phone that regains signal flushes a queue of deferred fixes, and the newest
one doesn't necessarily arrive last. The upsert carries
`WHERE location_states.captured_at < EXCLUDED.captured_at`, so a stale fix
can't overwrite a fresh one and the avatar never jumps backwards in time.

### Change suppression

`hasMaterialChange` compares **projections**, not raw inputs. That's why it
works so well: a member in Approximate mode sitting at home produces the same
cell centroid on every report, and battery is compared after quantising to 5%
buckets. A stationary household in Approximate mode generates almost no
realtime traffic.

---

## 3. Trust Mode: from precise fix to fuzzy dot

[`domain/location/fuzz.ts`](../apps/server/src/domain/location/fuzz.ts) ·
[`domain/location/project.ts`](../apps/server/src/domain/location/project.ts)

### Worked example

Member in Jakarta, Approximate at 1 km, sitting at home:

```ts
resolveAnchor({
  precise: [106.8272, -6.1751],     // real GPS fix, stays on the server
  radiusM: 1000,
  phaseKey: `${userId}:${circleId}`,
  previous: membership.anchor,      // cached from location_fuzz_anchors
});
```

1. **Hysteresis check.** If the fix is within `0.75 × cellSize` of the
   previously published centroid, return the old anchor with
   `changed: false`. No database write and no broadcast.
2. **Latitude band.** `floor(-6.1751) = -7` gives a band centre of -6.5°.
   The cell size is `2000 / cos(-6.5°) ≈ 2013 m` in projected metres.
3. **Salted phase.** `md5(phaseKey + ':' + salt + ':x')` gives an offset in
   `[0, cell)`, so this pair's lattice origin is unknown to anyone else.
4. **Snap.** Project to EPSG:3857, take
   `floor((x + phaseX) / cell)`, then return the centre of that cell.
5. **Key.** `1000:-7:<gridX>:<gridY>`. SQL `haven_cell()` produces the same
   format.

`projectPresence` then builds the payload from the **anchor centroid**. The
precise coordinate is never written into the object, so no serialiser,
logger or push payload downstream can leak it.

### Per mode

| Mode | `coordinate` | `radiusM` | `timezone` | battery / weather |
|---|---|---|---|---|
| `precise` | real fix | GPS accuracy (≥5 m) | ✅ | ✅ |
| `approximate` | cell centroid | fuzz radius | ✅ | ✅ |
| `approximate`, no anchor yet | **absent** (fails closed) | absent | ✅ | ✅ |
| `ghost` | **absent** | absent | **withheld** | ✅ |

`ghost` withholds the timezone too. "It's 3am there" is a coarse longitude
signal, and someone who hid their position didn't agree to leak it another
way. Battery and weather still flow, which is the product's core idea: a
fully hidden member still tells you *why* they aren't replying.

### Changing mode

[`handlers/trust.ts`](../apps/server/src/realtime/handlers/trust.ts). The
order of steps is chosen so every step fails safe:

1. Persist the change and its audit row in **one transaction**.
2. Switching to Approximate seeds an anchor **inside SQL**
   (`haven_cell(s.geom, …)`), so the precise `geom` never enters Node.
   Switching away clears the anchors.
3. Invalidate the socket's membership and broadcast caches.
4. Emit `trust:changed`, and clients **drop** their cached coordinate.
5. Send fresh bootstraps **per viewer**.

Step 4 comes before step 5 on purpose. A client that misses the new state
still forgets the old one. The bootstraps have to be per viewer, because a
room-wide bootstrap built from one member's view would include that member's
own precise position and send it to everyone.

Changes are rate-limited (10 a minute) **except changes to ghost**. Hiding
is the escape hatch, and no limit may stand in its way.

### The toggle in the app

A chip on the map always shows what you share now (Precise / Approximate /
Hidden) and opens the Trust Mode screen
([`features/trust-mode/`](../apps/mobile/src/features/trust-mode/)).

- **It sets the global default** (`circleId: null`), so one tap covers every
  circle. Per-circle overrides exist in the schema but have no UI yet.
  Approximate therefore always uses the neighbourhood radius (1 km disc,
  ~2 km cell). The global default has no radius column, so any other radius
  would only last until the next location report re-derived the anchor at
  1 km.
- **Your own mode comes from `me.trustMode`, never from presence.** The
  projection shows every viewer themselves as precise, so presence cannot
  say what you share. A lavender badge on your own marker is the one sign on
  your map that your circle sees less.
- **Not optimistic.** The checkmark moves only once the server acks.
  Offline, the request fails immediately instead of being buffered, so a
  change can never land later than the screen said. A user must never
  believe they are hidden while still being broadcast.
- **Follow-up for location upload** (not built yet): while a Trust Mode
  change is pending or has failed, hold back location reports. Otherwise the
  server would keep fanning out a mode the user just tried to leave.

---

## 4. Battery budget

[`domain/location/policy.ts`](../apps/server/src/domain/location/policy.ts)

The server sets the upload cadence and returns it in every ack. The client
can't make this call well, because only the server knows whether anyone is
looking.

| Activity | Interval (viewers live) | Distance filter |
|---|---|---|
| driving | 30 s | 400 m |
| running / cycling | 1 min | 100–150 m |
| walking | 2 min | 75 m |
| unknown | 5 min | 150 m |
| still | 10 min | 150 m |

Modifiers stack: **nobody watching** sets a 15 min floor. **Low Power Mode**
doubles the interval, **≤20%** doubles it again, and **≤10%** doubles it
once more. **Ghost in every circle** drops to 30 min, since nobody can see
the position anyway. All values are clamped to 15 s – 30 min.

`presence:heartbeat` keeps battery context fresh without a GPS fix. For a
phone on a desk, "92%, charging" is most of what a worried partner wants to
know.

### In the app

[`core/location/`](../apps/mobile/src/core/location/)

- **Permission is asked for in context.** A banner on the map asks, rather
  than a cold prompt at launch. It asks in two steps (while-in-use, then
  Always), because that is the only order iOS honours. Settings shows the
  current access and links to the system settings.
- **One path for every fix.** With Always, a background task
  (`expo-task-manager`) delivers fixes whether the app is open or not. With
  while-in-use, a foreground watch does the same while Haven is on screen.
  Both feed `handleFix`.
- **The policy is enforced twice.** The OS filters by distance, plus time on
  Android, using the last `UploadPolicy`. `shouldUpload` then sends only once
  the interval has passed or the phone has moved past the distance filter,
  because iOS cannot schedule by time. Balanced accuracy lets iOS use Wi-Fi
  and cell rather than GPS, and `idle` drops it to Low. A changed policy
  restarts OS updates with the new filters.
- **Socket when open, HTTPS otherwise.** A backgrounded phone's socket is
  usually gone, and reconnecting a WebSocket for one report costs more radio
  time than the report itself. `POST /v1/location` runs the same pipeline
  (`ingestLocationReport`) and returns the next policy. It does no change
  suppression, and it is used only while there is no socket, so a socket's
  suppression cache can never be stale against a position HTTP already sent.
- **You move on your own map at once.** The server never echoes a report to
  the socket that sent it, so the app applies its own fix locally, keeping
  the weather the server last sent.
- **Held during Trust Mode changes.** While `trust:set` is in flight, fixes
  move your own avatar but are not uploaded.
- **Stops on sign-out.** A signed-out phone must not keep waking up to
  report.
- **Not yet:** `presence:heartbeat` from the app (battery freshness for a
  still phone), motion-activity detection (activity is inferred from speed),
  and reporting the permission level to the server (`devices.location_auth`).

---

## 5. Nudges

[`handlers/nudge.ts`](../apps/server/src/realtime/handlers/nudge.ts)

```
validate → re-check membership → rate limit → persist (idempotent) → deliver
```

- **Membership is re-checked against the database**, not read from the socket
  cache. Removing someone from a circle should stop their nudges right away,
  not at their next reconnect.
- **Rate limiting happens before the insert**, so a flood costs a Redis INCR
  rather than a row. The limits are 12 per minute per sender and 4 per minute
  per sender→recipient pair. A per-recipient rejection returns the same error
  as the sender limit, so the sender can't tell they've hit one particular
  person's cap.
- **Idempotency.** `client_nudge_id` is unique per sender. A retry returns
  the *original* id and is delivered to nobody, so the same heart never
  bursts twice on screen.
- **Two delivery paths in parallel.** Recipients with an open socket get
  `nudge:received`. Recipients without one get a push. Most phones are
  asleep most of the time, so push is the main path in practice. Muted
  recipients get neither.
- **"Seen" means rendered.** `nudge:delivered` fires only when the
  recipient's client acks the animation. Push delivery doesn't count:
  telling someone their partner saw a heart while the phone was face-down in
  a bag would be a false signal.
- **Muted means muted on live sockets too.** `nudge:received` goes to each
  unmuted recipient's `user:` room rather than the circle room. An open app
  is no reason to buzz someone who asked for quiet. (It used to be emitted
  to the room, so mute only silenced push.)

### In the app

[`features/nudge/`](../apps/mobile/src/features/nudge/)

- **Sending:** six emoji buttons at the top of a member's detail in the
  sheet, reachable with the sheet at half. The sender's burst plays once the
  server has acked, so it means "sent" and not just "tapped". The client id
  is a UUIDv7 ([`lib/uuidv7.ts`](../apps/mobile/src/lib/uuidv7.ts)), since
  the server's `z.uuid()` rejects anything else.
- **Receiving:** a full-screen overlay that never takes touches. The emoji
  pops in the middle on the bouncy spring, copies fan out and drift up, a
  glass caption says who sent it, and the haptic comes from the shared
  `NUDGE_HAPTICS` table. With Reduce Motion on there's no fan-out, only the
  emoji appearing.
- **One at a time, once.** Moments queue
  ([`state/nudgeReducer.ts`](../apps/mobile/src/state/nudgeReducer.ts)),
  are deduplicated by id across reconnect replays, and are capped at six.
- **The ack waits for the screen.** Nothing plays, and so nothing is acked
  as seen, while the app is in the background.
- **Lottie is not used yet.** The burst is Reanimated, so it needs no
  bundled assets and no native rebuild. Swapping in Lottie files later only
  changes `Burst` in `NudgeOverlay.tsx`.
- **Demo mode** plays the burst locally, and online members of the sample
  circle reply after a moment, so receiving can be seen without a backend.

---

## 6. Defence in depth for coordinates

Five layers. Each one alone would stop most leaks:

1. **Grants.** `haven_app` has no `SELECT` on `location_states.geom`.
2. **One read path.** `haven_circle_presence()` is `SECURITY DEFINER` and is
   the only reader.
3. **Structural projection.** `projectPresence` never puts the precise point
   into a non-precise payload.
4. **Test.** `projection.test.ts` serialises every non-precise payload and
   searches it for the real coordinates.
5. **Logger.** pino redacts `coordinate`, `precise` and `geom` before
   anything reaches disk.

---

## 7. What the tests caught

`fuzz.test.ts` includes the **averaging attack**: 10,000 samples from a
stationary member, checking that naive jitter converges on the true position
(it does, to under 50 m) and that snapping doesn't.

The first version **failed**. It derived cell size from the exact latitude,
so every metre of GPS wobble resized the cell, shifted the grid, and moved
the centroid. A member sitting still produced **10,000 different
coordinates**, which is exactly the attack the module exists to stop. The
grid looked stable in code review and wasn't. The fix quantises the latitude
correction into 1° bands, in both TypeScript and SQL.

---

## 8. Known limits & next steps

- **Migrations executed only on PGlite.** All eight apply cleanly through
  the runner on PGlite (PostgreSQL 18, PostGIS 3.6), but not yet on a server
  Postgres 16/17, and the repository queries have not run against any
  database. The TS ↔ SQL agreement on `cell_key` is asserted by format only.
  A Postgres integration test that runs both implementations on the same
  points is the first thing to add once a database is available.
- **`anyLiveViewers` uses `fetchSockets()`** across the cluster on each
  report. That's fine for circles capped at 16, but it should move to a
  Redis counter before multi-region.
- **Push transport** is an interface with a logging implementation.
  APNs/FCM need credentials.
- **REST routes:** auth, circles and invites are written
  ([docs/04](04-accounts-and-invites.md)). The widget endpoint isn't yet; it
  will reuse `haven_circle_presence()`.
- **zod is on 4.6.7**, upgraded from 3.25.76 to fix GHSA-mrhx-c7xc-m3w5
  (memory exhaustion via unbounded arrays). `pnpm audit` is clean. The
  bounded array schemas and the 16 KB `maxHttpBufferSize` cap were kept as
  defence in depth. One behaviour change to be aware of: `z.uuid()` now
  enforces RFC 9562 version and variant bits, so client-generated ids must be
  real UUIDv7s. `test/contracts.test.ts` pins this and the other runtime
  behaviours the upgrade could have changed.
