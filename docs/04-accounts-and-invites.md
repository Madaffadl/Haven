# Haven — Accounts & Invites

Sign-in, the signed-in user, circles and invites: the REST surface around the
realtime tier, and the onboarding screens that use it. This is the "invite
loop" the product depends on. Haven is useless alone, so every account exists
to bring in at least one more person.

---

## 1. The flow

```
sign-in ──▶ verify ──▶ name* ──▶ circle ──▶ map
 email      6-digit     first     create, or      invite button
            code        sign-in   join by code    in the sheet
                        only
```

The router derives the screen from one value, `stageOf(session)`
([`sessionReducer.ts`](../apps/mobile/src/state/sessionReducer.ts)). Each
route group sits behind a `Stack.Protected` guard that redirects to its
stage's home (`STAGE_HOME`), so no screen ever navigates "forward" on success.
It changes the session, and the guards move the person on.

An invite link (`haven://join/K7M2QX`) opened before sign-in parks the code.
After sign-in (and the name step), the circle screen picks it up and opens the
join preview. Joining always shows **who** is behind the invite and **what**
is shared before the tap, because joining shares a live location.

## 2. Endpoints

All paths come from `routes` in [`contracts/src/api.ts`](../packages/contracts/src/api.ts).
Errors share one envelope, `{ error: { code, message, retryAfterMs? } }`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/v1/auth/email/start` | — | Always 204; never reveals whether an account exists |
| POST | `/v1/auth/email/verify` | — | Creates the account on first sign-in; returns tokens, `me`, `isNewUser` |
| POST | `/v1/auth/refresh` | — | Rotates the refresh token |
| POST | `/v1/auth/sign-out` | ✓ | Revokes this device's session and drops its sockets |
| GET / PATCH | `/v1/me` | ✓ | PATCH re-bootstraps the user's circles so the new name shows up |
| GET / POST | `/v1/circles` | ✓ | Seats: couple 2, family/friends 8 |
| POST | `/v1/circles/:id/invites` | ✓ | Default uses = open seats; a couple's invite is single-use |
| GET | `/v1/invites/:code` | ✓ | Preview before joining |
| POST | `/v1/invites/:code/accept` | ✓ | Idempotent; locks invite and circle |

### Profile & settings

Opened from your avatar in the map's top-left corner
([`features/settings/`](../apps/mobile/src/features/settings/)).

| Method | Path | Notes |
|---|---|---|
| PATCH | `/v1/me` | Name and/or accent (one of `ACCENT_COLORS`); re-bootstraps your circles |
| GET | `/v1/me/devices` | Devices with a live session; yours is marked `current` |
| DELETE | `/v1/me/devices/:id` | Signs another device out now; its sockets drop |
| DELETE | `/v1/me` | Deletes the account (below) |
| POST | `/v1/circles/:id/leave` | Leave; an owner hands the circle on, the last one out closes it |

- **Leaving** revokes the leaver's invites, drops their fuzz anchors and any
  widget pins in either direction, and promotes the next owner (admins
  first, then earliest joined).
- **Deleting an account** leaves every circle, erases location outright
  (current position, anchors, history, place events), revokes every
  session, and turns the user row into an anonymous tombstone. The row stays
  because circles and nudges reference it. The email is rewritten to
  `deleted+<id>@deleted.invalid`, which frees the real address for a fresh
  sign-up. Apple requires in-app deletion for any app with sign-up.
- **Not yet in settings:** location permission status and notifications
  (both need native modules that arrive with location upload and push),
  per-circle Trust Mode, circle rename, privacy policy link, language.

## 3. Decisions worth knowing

- **Email, not SMS.** Email is free at MVP scale (Resend: 100 a day). The
  `phone_e164` column stays for later. Without `RESEND_API_KEY`, codes are
  logged rather than sent, and production refuses to boot that way.
- **Codes live in Redis**, HMAC'd and bound to the address, with 5 guesses per
  code and 3 codes per address per 15 minutes. Expired codes cannot be
  resurrected by a late guess (Lua `EXISTS` check before `HINCRBY`).
- **Refresh tokens rotate on every use** and only their SHA-256 is stored. The
  app serialises refreshes (single-flight in
  [`createClient.ts`](../apps/mobile/src/core/api/createClient.ts)), since two
  concurrent refreshes with one token would sign the loser out. Only a 401
  ends a session. Offline and 5xx keep it.
- **Tokens sit in one Keychain entry**, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`,
  so the background location task can authenticate on a locked phone and a
  restored backup does not carry the session to another device.
- **Membership changes resync sockets by disconnecting them.** A socket caches
  its circles at handshake; after a join the server drops the user's sockets
  (cluster-wide, via the Redis adapter), the client reconnects, and the
  circle gets fresh per-viewer bootstraps.
- **Invite errors are deliberately vague.** Unknown, expired, revoked and
  used-up all return `invite_invalid`, so codes cannot be enumerated.

## 4. Verification

**Done:** typecheck for all three packages. 22 new server tests: codes,
tokens (round-trip, tamper, `alg` swap, expiry), invite codes checked against
the SQL `CHECK` itself, and account defaults. 25 new mobile tests: the API
client's refresh and offline behaviour, session stages and transitions, and
onboarding copy. The sign-in screen and the demo map were checked on the iOS
simulator.

**Not done:**
- **No request has hit a real database yet.** The repositories
  ([`identity.ts`](../apps/server/src/infra/db/repositories/identity.ts),
  [`membership.ts`](../apps/server/src/infra/db/repositories/membership.ts))
  are typechecked only. The first run against Neon is the first real test of
  their SQL.
- The verify, name, circle, invite and join screens have not been seen on a
  device. They need a backend to reach.

**Known limits:**
- Anyone who knows an address can keep requesting codes for it and hold its
  owner at the 3-per-15-minutes limit. That is the usual cost of bounding
  code guessing per address. Revisit if it is ever abused, for example by
  counting guesses across codes so the request limit can be looser.
- The refresh endpoint is limited per IP, since its caller is not
  authenticated yet. Set `TRUST_PROXY=true` behind a hosting proxy, or every
  user shares the proxy's address and its limit.
