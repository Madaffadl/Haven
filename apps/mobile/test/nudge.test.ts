import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { NUDGE_HAPTICS, nudgeId, nudgeKindSchema, type NudgeEvent } from '@haven/contracts';

import { RealtimeRequestError } from '../src/core/realtime/socket.js';
import {
  DEMO_REPLY,
  NUDGES,
  nudgeErrorCopy,
  receivedCopy,
  seenCopy,
  sendLabel,
} from '../src/features/nudge/nudgeCopy.js';
import { uuidv7 } from '../src/lib/uuidv7.js';
import {
  MAX_QUEUE,
  applyDelivered,
  applyReceived,
  applySent,
  applyShown,
  emptyNudges,
} from '../src/state/nudgeReducer.js';

const CIRCLE = '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f00';
const MAYA = '0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7f03';

const event = (n: number, kind: NudgeEvent['kind'] = 'heart'): NudgeEvent => ({
  id: `0192d4e0-7b3a-7c1e-9f2a-3b4c5d6e7a${n.toString().padStart(2, '0')}`,
  circleId: CIRCLE,
  fromUserId: MAYA,
  kind,
  sentAt: '2026-10-30T12:00:00.000Z',
});

describe('uuidv7', () => {
  it('passes the server’s strict UUID check', () => {
    // A v4 or a malformed id would be rejected as invalid_payload.
    for (let i = 0; i < 500; i += 1) assert.ok(nudgeId.safeParse(uuidv7()).success);
  });

  it('carries version 7, the RFC variant, and the timestamp', () => {
    const now = Date.UTC(2026, 9, 30, 12, 0, 0);
    const id = uuidv7(now);
    assert.equal(id[14], '7');
    assert.match(id[19]!, /[89ab]/);
    assert.equal(parseInt(id.replace(/-/g, '').slice(0, 12), 16), now);
  });

  it('sorts by creation time', () => {
    const earlier = uuidv7(1_000);
    const later = uuidv7(2_000);
    assert.ok(earlier < later);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 1_000 }, () => uuidv7(5_000)));
    assert.equal(ids.size, 1_000);
  });
});

describe('nudge queue', () => {
  it('plays moments in arrival order, one at a time', () => {
    let state = applyReceived(emptyNudges, event(1, 'heart'));
    state = applyReceived(state, event(2, 'wave'));
    assert.deepEqual(
      state.queue.map((m) => m.kind),
      ['heart', 'wave'],
    );
    state = applyShown(state);
    assert.deepEqual(
      state.queue.map((m) => m.kind),
      ['wave'],
    );
  });

  it('ignores a nudge it has already played, even after it left the queue', () => {
    // A reconnect can replay events; the same heart twice looks broken.
    let state = applyReceived(emptyNudges, event(1));
    state = applyShown(state);
    state = applyReceived(state, event(1));
    assert.equal(state.queue.length, 0);
  });

  it('drops a backlog beyond the cap instead of playing it for a minute', () => {
    let state = emptyNudges;
    for (let i = 0; i < MAX_QUEUE + 4; i += 1) state = applyReceived(state, event(i));
    assert.equal(state.queue.length, MAX_QUEUE);
  });

  it('keeps the id to acknowledge once the received nudge is shown', () => {
    const [moment] = applyReceived(emptyNudges, event(7)).queue;
    assert.equal(moment?.type, 'received');
    assert.equal(moment?.type === 'received' ? moment.nudgeId : null, event(7).id);
  });

  it('turns a delivery receipt for a direct nudge into one "seen"', () => {
    let state = applySent(emptyNudges, {
      nudgeId: 'n1',
      kind: 'heart',
      circleId: CIRCLE,
      toUserId: MAYA,
    });
    state = applyShown(state);

    state = applyDelivered(state, { nudgeId: 'n1' });
    assert.equal(state.queue[0]?.type, 'seen');
    assert.equal(state.queue[0]?.type === 'seen' ? state.queue[0].byUserId : null, MAYA);

    // A duplicate receipt must not say it again.
    state = applyDelivered(applyShown(state), { nudgeId: 'n1' });
    assert.equal(state.queue.length, 0);
  });

  it('does not report "seen" for circle-wide nudges or unknown ids', () => {
    let state = applySent(emptyNudges, { nudgeId: 'n2', kind: 'wave', circleId: CIRCLE });
    state = applyShown(state);
    assert.equal(applyDelivered(state, { nudgeId: 'n2' }).queue.length, 0);
    assert.equal(applyDelivered(emptyNudges, { nudgeId: 'nope' }).queue.length, 0);
  });
});

describe('nudge copy', () => {
  it('covers every kind the contract defines, in its order', () => {
    assert.deepEqual(
      NUDGES.map((n) => n.kind),
      nudgeKindSchema.options,
    );
    for (const kind of nudgeKindSchema.options) {
      assert.ok(NUDGE_HAPTICS[kind]);
      assert.ok(nudgeKindSchema.options.includes(DEMO_REPLY[kind]));
    }
  });

  it('reads naturally in each direction', () => {
    assert.equal(sendLabel('heart', 'Maya'), 'Send a heart to Maya');
    assert.equal(receivedCopy('wave', 'Rizal'), 'Rizal sent you a wave');
    assert.equal(seenCopy('heart', 'Maya'), 'Maya saw your heart');
    assert.equal(seenCopy('home_safe', 'Oma'), 'Oma saw your “home safe”');
  });

  it('keeps the rate limit gentle and never says whose limit it was', () => {
    const copy = nudgeErrorCopy(new RealtimeRequestError('rate_limited', 'slow down'));
    assert.match(copy, /Give it a minute/);
    assert.doesNotMatch(copy, /Maya|their|recipient/i);
    assert.match(nudgeErrorCopy(new RealtimeRequestError('offline', 'x')), /connection/);
  });
});
