'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { enableImmutableReleases } = require('../scripts/enable-immutable-releases.cjs');

function harness(responses, overrides = {}) {
  const calls = [], waits = [], progress = [];
  const options = {
    token: 'synthetic-token', repository: 'example/repository',
    fetch: async (url, init) => {
      calls.push([url, init.method]);
      const response = responses.shift();
      assert.ok(response, 'unexpected API attempt');
      return response;
    },
    sleepSeconds: async seconds => waits.push(seconds),
    onProgress: event => progress.push(event), jitterSeconds: 0,
    nowSeconds: () => 1000, maxAttempts: 3, totalWaitBudgetSeconds: 30,
    ...overrides,
  };
  return { calls, waits, progress, options };
}

for (const status of [403, 429]) {
  test(`retries throttled PUT and GET with HTTP ${status}`, async () => {
    const throttle = () => Response.json({ message: 'secondary rate limit' }, { status, headers: { 'retry-after': '2' } });
    const h = harness([throttle(), new Response(null, { status: 204 }), throttle(), Response.json({ enabled: true })]);
    await enableImmutableReleases(h.options);
    assert.deepEqual(h.waits, [2, 2]);
    assert.deepEqual(h.calls.map(call => call[1]), ['PUT', 'PUT', 'GET', 'GET']);
    assert.equal(h.progress.length, 2);
    assert.ok(!JSON.stringify(h.progress).includes(h.options.token));
  });
}
test('honors primary reset and rejects an excessive cooldown', async () => {
  const primary = () => Response.json({ message: 'API rate limit exceeded' }, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1010' } });
  const h = harness([primary(), new Response(null, { status: 204 }), Response.json({ enabled: true })]);
  await enableImmutableReleases(h.options);
  assert.deepEqual(h.waits, [15]);
  const blocked = harness([primary()], { totalWaitBudgetSeconds: 5 });
  await assert.rejects(enableImmutableReleases(blocked.options), /deferred/);
  assert.deepEqual(blocked.waits, []);
});
test('fails closed on permission errors, exhausted retries and a disabled readback', async () => {
  const forbidden = harness([Response.json({ message: 'permission denied' }, { status: 403 })]);
  await assert.rejects(enableImmutableReleases(forbidden.options), /permission denied/);
  assert.equal(forbidden.calls.length, 1);
  const exhausted = harness(Array.from({ length: 3 }, () => Response.json({ message: 'secondary rate limit' }, { status: 429, headers: { 'retry-after': '1' } })));
  await assert.rejects(enableImmutableReleases(exhausted.options), /deferred after 3\/3/);
  assert.equal(exhausted.calls.length, 3);
  const disabled = harness([new Response(null, { status: 204 }), Response.json({ enabled: false })]);
  await assert.rejects(enableImmutableReleases(disabled.options), /must be enabled/);
});
