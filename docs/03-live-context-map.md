# Haven — Phase 3: Live Context Map

The map, the avatars on it, the Battery Ring, the weather micro-animations,
and the bottom sheet.

Code: [`apps/mobile/src/`](../apps/mobile/src/) ·
Tests: [`apps/mobile/test/`](../apps/mobile/test/) (78 passing) ·
Design tokens: [`src/ui/theme/tokens.ts`](../apps/mobile/src/ui/theme/tokens.ts)

---

## 1. What's here

```
apps/mobile/
├── app/
│   ├── _layout.tsx                  providers, Inter (4 weights), splash gate
│   └── (app)/index.tsx              → MapScreen
└── src/
    ├── features/map/
    │   ├── MapScreen.tsx            selection + sheet state; demo or live data
    │   ├── LiveContextMap.tsx       Mapbox, discs, markers, camera
    │   ├── mapStyle.ts              Standard style recoloured into Haven tokens
    │   ├── AvatarMarker.tsx         one person: ring, avatar, badges, lift
    │   ├── BatteryRing.tsx          ┐
    │   ├── batteryModel.ts          ┘ arc maths, tone, spoken description
    │   ├── WeatherGlyph.tsx         ┐
    │   ├── weatherModel.ts          ┘ WMO → glyph, motion policy
    │   ├── MemberSheet.tsx          circle list ↔ member detail
    │   ├── geometry.ts              ground circles, fan-out, camera bounds
    │   └── presenceCopy.ts          every word the map says about a person
    ├── ui/
    │   ├── theme/{tokens,contrast}.ts
    │   ├── motion/{springs,thread}.ts
    │   └── primitives/{GlassPanel,HText,PressableScale,BottomSheet,sheetPhysics}
    ├── state/{presence,presenceReducer,session}.ts
    ├── core/realtime/socket.ts      typed Socket.IO client → store
    ├── lib/useNow.ts
    └── dev/demoCircle.ts            EXPO_PUBLIC_DEMO=1 fixture
```

Each component's behaviour lives in a pure `*Model.ts`, `*Copy.ts`,
`geometry.ts` or `sheetPhysics.ts` module, and the component only renders it.
That split is what let 78 tests run in plain Node with no device.

---

## 2. Design system: how ui-ux-pro-max was used

I ran the skill's `--design-system` search, retried it once with a narrower
query as its workflow allows, then pulled its React Native stack rules, its
UX rules (motion, reduced motion, colour), its glassmorphism style entry, and
its native-app pre-delivery checklist.

**What I didn't use.** Both design-system results were built for a *landing
page*: a hero, feature grid and CTA layout, a rose and blue palette, and
crypto or editorial type pairings. Your brief had already fixed the palette
(midnight navy with Electric Peach, Neon Mint and Soft Lavender) and the type
(Inter or SF Pro). So I didn't persist the output to
`design-system/MASTER.md`. The skill says not to persist results that weren't
verified, and these didn't fit. The source of truth is `tokens.ts`.

**What I used.** The structure of the dark retry (a midnight base with a
light muted foreground), and the rules. The rules shaped the code more than
any palette did:

| Rule (skill) | Where it landed |
|---|---|
| `excessive-motion`, continuous-animation | Weather loops **only for the selected member**, plays once on change, otherwise still |
| `color-not-only` | Battery = arc **length** + colour + charging **bolt**; approximate disc has a **dashed** edge; stale = **clock** badge |
| `color-dark-mode`, `color-accessible-pairs` | Contrast measured on *composited* glass, in tests (§3) |
| `touch-target-size` | Markers 56pt; `PressableScale` enforces a 44pt minimum |
| `scale-feedback`, `press-feedback` | 0.95 press scale on the `snappy` spring |
| `spring-physics`, `motion-consistency` | Three springs, used everywhere (§6) |
| `exit-faster-than-enter` | Sheet and selection: bouncy going up, snappy going down; exit 180ms vs enter 280ms |
| `interruptible`, `gesture-feedback`, `drag-threshold` | Bottom sheet (§5) |
| `gesture-alternative`, `dragging-alternative` | Sheet handle is a button, `adjustable` for screen readers, Android back collapses it |
| gesture conflicts (one gesture per region) | Only the sheet header drags; content scrolls |
| `reduced-motion` | `ReduceMotion.System` on every spring; explicit `useReducedMotion` for loops and the camera |
| `dynamic-type` | `HText` caps map chrome at 1.4× text scale; sheet content scales to 2× |
| `number-tabular` | Battery %, temperature, times, counts |
| No emoji as icons, consistent strokes | Lucide throughout, stroke 2 |
| `opacity-threshold` | Dimmed members 0.55; moon "breathes" between 0.75 and 1 |

---

## 3. Colour and contrast

**Glass has no contrast ratio of its own**, so every ratio is measured on the
fill composited over the map. The worst case is the brightest road, which
`mapStyle.ts` sets to exactly `mapBackdrop.brightest`. That way the shipped
map and the contrast proof can't drift apart.

| Foreground | On glass (worst case) | On bare map |
|---|---|---|
| text.primary `#F4F6FF` | 14.93 | 11.13 |
| text.secondary `#B8C0E0` | 8.93 | 6.66 |
| text.tertiary `#8A93B8` | 5.33 | **3.97** ✗ |
| Electric Peach `#FFAD8F` | 8.91 | 6.65 |
| Neon Mint `#7CF5C8` | 12.08 | 9.00 |
| Soft Lavender `#B9A7FF` | 7.69 | 5.74 |

On pastel fills, text is dark **ink** `#0A0F24`: 9.1–14.2:1 across all five
fills. White on mint would be about 1.3:1.

**The test corrected me.** I first labelled tertiary text "large text only".
`tokens.test.ts` measured 5.33:1 on glass, which is fine at any size, and
3.97:1 on the bare map, which fails. So the real rule is **glass-backed
only**, and the test now pins it.

The glass fill is 0.72 alpha, much heavier than the 0.10–0.30 typical of
glassmorphism. That's deliberate: those designs sit over a controlled
gradient, while ours sits over an arbitrary map.

**Android doesn't blur.** Mapbox renders into a SurfaceView, which view-based
blur can't sample. Android gets a 0.94 fill instead, which the tests check
too.

---

## 4. The map

[`LiveContextMap.tsx`](../apps/mobile/src/features/map/LiveContextMap.tsx) ·
[`mapStyle.ts`](../apps/mobile/src/features/map/mapStyle.ts)

**Style.** This is Mapbox Standard, recoloured through `StyleImport` config
rather than built in Studio. The settings are:

- **Night lighting and the faded theme.** Land, water and roads all take
  token colours.
- **Labels.** POI, transit, road and pedestrian labels are off. Place names
  stay on, because "somewhere in Kemang" is what gives an Approximate disc
  its meaning.
- **3D off.** All 3D layers are disabled. They're Standard's most expensive
  layers on the GPU, and they would hide avatars at street zoom.
- **Studio override.** `EXPO_PUBLIC_MAPBOX_STYLE_URL` swaps in a Studio style
  instead.

**Avatars** are `MarkerView`s with the following behaviour:

- **Selection.** `allowZElevate` lifts the selected avatar above the others.
- **Tap handling.** `stopGesturePropagation` means tapping an avatar doesn't
  also fire "tap the map to deselect".
- **Fan-out.** Members within 25 m of each other are spread on a 20 px
  circle. A couple at home in Precise mode would otherwise stack, and the map
  would quietly show only one of them. Positions are ordered by user id, so
  nobody swaps places as GPS jitters.

**Radius discs** are drawn natively (`ShapeSource` + `FillLayer`/`LineLayer`)
as **true ground polygons** in metres. A `CircleLayer` is sized in screen
pixels, so a fuzz disc drawn that way would shrink as you zoom in and suggest
more precision than the server gave. Approximate discs are lavender with a
dashed edge. Precise rings are mint, and drawn only when accuracy is worse
than 30 m. Anything tighter would sit hidden under the avatar.

**Camera.** It frames everyone once on the first data, then follows the
selection. Padding includes the sheet's visible height, so the selected
person is centred in the part of the map you can actually see. North-up,
with no pitch or rotation. Under Reduce Motion, camera moves are instant.

**Mapbox's terms require the logo and attribution.** Both stay, and are
lifted above the sheet.

**Privacy on the client.** The map draws only `selectMappable()`, meaning
members who have a coordinate. Ghost members never have one. When someone's
Trust Mode changes, their position is dropped *on receipt* of
`trust:changed`, and updates for them are ignored until the fresh bootstrap
arrives (§7).

---

## 5. Bottom sheet

[`BottomSheet.tsx`](../apps/mobile/src/ui/primitives/BottomSheet.tsx) ·
[`sheetPhysics.ts`](../apps/mobile/src/ui/primitives/sheetPhysics.ts)

Three snaps: peek (132pt), half (46% of screen height) and full (88%). Safe
area is added on top of each.

| Behaviour | How |
|---|---|
| No layout reflow | Rendered at full height, moved by `translateY` only |
| Follows the finger | `usePanGesture` updates run on the UI thread |
| Soft edges | iOS rubber-band curve (0.55 coefficient) past either end |
| Catch it mid-flight | `onBegin` cancels the running spring |
| …without freezing on a tap | `onFinalize` re-settles if the pan never activated |
| Flicks read as intent | Snap chosen from the *projected* resting point (UIKit deceleration 0.998) |
| No hitch on release | Settling spring starts at the release velocity |
| Playful up, quick down | `bouncy` (one ~16% overshoot) expanding, `snappy` collapsing |
| Map stays usable | Scrim fades in only between half and full |

**Bugs found in review and fixed before they shipped:**

- **Stale "settled" marker.** A gesture that settled back on the *same* snap
  left a marker that was never cleared, because no state change meant no
  re-render. That marker would later swallow a legitimate parent-driven move
  to that snap.
- **NaN scrim.** A sheet with two snaps fed a zero-width range to
  `interpolate`.
- **Gesture conflict.** The pan originally covered the whole sheet and would
  have fought a scrolling list. Now only the header drags.

---

## 6. Motion

[`springs.ts`](../apps/mobile/src/ui/motion/springs.ts)

| Spring | damping / stiffness / mass | ζ | Use |
|---|---|---|---|
| `snappy` | 20 / 420 / 0.6 | 0.63 | press feedback, collapsing |
| `bouncy` | 14 / 220 / 0.9 | 0.50 | selection lift, sheet expanding |
| `gentle` | 24 / 110 / 1.0 | 1.14 | battery arc (overdamped: a gauge must not overshoot) |

**Every spring carries `ReduceMotion.System`.** It's applied in one place, so
no code path can produce a spring that ignores the setting.

**The weather glyph** is driven by a single shared value cycling 0→1. Every
pose is chosen so that t=0 and t=1 look identical. That means "play once"
ends exactly on the resting frame, and "still" is that same frame with no
animation at all. Rotation is linear, since it's constant-rate motion.
Everything else is transform and opacity on the UI thread.

**Why not Lottie for weather.** The badge is built from vector icons and
Reanimated rather than Lottie:

- **Cost.** Up to 16 glyphs can sit inside map markers at once, and a Lottie
  player per 22pt badge is a lot of decoding.
- **Theming.** Vector icons take token colours, while a Lottie file bakes its
  colours in.
- **Lottie's role.** It remains the right tool for the large, one-off nudge
  bursts in the next phase.

---

## 7. Client privacy contract

[`presenceReducer.ts`](../apps/mobile/src/state/presenceReducer.ts), tested in
[`presence.test.ts`](../apps/mobile/test/presence.test.ts):

- **Updates replace and never merge.** Merging would keep an old coordinate
  when the new payload omits it, because a spread operator copies whatever is
  already there.
- **`trust:changed` drops the position immediately.** The coordinate and
  radius keys are *deleted*, not set to undefined.
- **Quarantine until the new bootstrap.** A precise update that was in flight
  when someone went ghost is ignored until the fresh bootstrap arrives. This
  closes the race between the two events.
- **Older fixes are ignored.** A fix that arrives after a newer one is
  dropped.

---

## 8. Version notes

Current stable as of this phase is **Expo SDK 58 / React Native 0.88**.

- **Reanimated 4.7.1, not 3.** SDK 58 pins Reanimated 4, and Reanimated 3's
  last release (3.19.5) predates RN 0.88. The motion code sticks to APIs that
  are the same in both majors, with one exception: the UI→JS hop. Reanimated 4
  deprecates `runOnJS` in favour of `scheduleOnRN`, so that lives alone in
  [`motion/thread.ts`](../apps/mobile/src/ui/motion/thread.ts), with the
  Reanimated 3 replacement written in its comment.
- **Gesture Handler 3** deprecates the `Gesture.Pan()` builder. The sheet
  uses the new `usePanGesture` hook.
- **SDK 58 config.** `newArchEnabled` and `android.edgeToEdgeEnabled` are
  removed, because both are now mandatory. RN 0.88 removed
  `StyleSheet.absoluteFillObject`.
- **Contracts imports are extensionless now.** Metro doesn't map `./x.js` to
  `x.ts`. `tsc` passed but the first real bundle failed, and only the bundle
  caught it.
- **Fonts imported per weight.** The `@expo-google-fonts/inter` index bundles
  all 18 weights. Importing the four by subpath cut shipped assets from
  **6.1 MB to 1.4 MB**, measured from the export.

---

## 9. Verification

**Done and passing:**
- typecheck across all three packages
- **78 mobile tests**, covering contrast, battery and weather models, the
  presence reducer and its privacy races, sheet physics, ground-circle
  geometry, fan-out, accessibility copy, local time across the date line, and
  the demo fixture validated against the wire schema
- **37 server tests**
- **Metro production bundles for iOS and Android**, which exercise
  resolution, the worklets transform and route discovery

**Not done:**
- **Not run on a device or simulator.** That needs a Mapbox token, which
  isn't set, plus a native development build. Nothing about how it *looks*
  or *feels* has been checked by eye yet: spring feel, glass rendering, marker
  layout, the Mapbox style config's actual appearance, or VoiceOver order.
- **Pre-delivery checklist items that need a device:** testing on a 375pt
  screen and in landscape, largest Dynamic Type, Reduce Motion on, and
  screen-reader focus order.
- **`pnpm audit` reports two highs, both inside `@expo/cli`** (Expo's dev
  tooling, which doesn't ship in the app):
  - **zod 3.25.76.** Expo pins `^3.25.76` in the latest CLI release
    (58.1.15).
  - **node-forge 1.4.0.** This advisory has **no patched version**.

  Overriding either would run Expo's CLI against versions it doesn't support.
  Revisit when Expo ships a new CLI release, and before enabling Expo Updates
  code signing, which is the `node-forge` path.

---

## 10. Running it

```bash
cd apps/mobile
echo "EXPO_PUBLIC_MAPBOX_TOKEN=pk.your-token" > .env
echo "EXPO_PUBLIC_DEMO=1" >> .env          # sample circle, no backend needed
pnpm ios                                     # prebuild + dev build + simulator
```

Haven can't run in Expo Go: Mapbox's native SDK needs a development build.
