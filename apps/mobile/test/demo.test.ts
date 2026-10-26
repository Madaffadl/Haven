import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { presenceBootstrapSchema } from '@haven/contracts';
import { DEMO_CIRCLE_ID, demoBootstrap } from '../src/dev/demoCircle.js';
import {
  applyBootstrap,
  emptyPresence,
  selectAll,
  selectMappable,
} from '../src/state/presenceReducer.js';

/**
 * The demo circle must be something the server could actually send. If it
 * drifts from the wire schema, demo mode quietly stops exercising the states
 * production produces.
 */
describe('demo circle', () => {
  it('is a valid server bootstrap', () => {
    const result = presenceBootstrapSchema.safeParse(demoBootstrap());
    assert.ok(result.success, result.success ? '' : JSON.stringify(result.error.issues, null, 2));
  });

  it('keeps the ghost member off the map but in the list', () => {
    const state = applyBootstrap(emptyPresence, demoBootstrap());
    assert.equal(selectAll(state, DEMO_CIRCLE_ID).length, 5);
    assert.equal(selectMappable(state, DEMO_CIRCLE_ID).length, 4);
  });

  it('respects the ghost contract: no coordinate and no timezone', () => {
    const oma = demoBootstrap().members.find((m) => m.trustMode === 'ghost');
    assert.ok(oma);
    assert.equal(oma.coordinate, undefined);
    assert.equal(oma.timezone, undefined);
  });
});
