// The job wrapper: snapshot in, checked and serialized summary out.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { check, MAX_BYTES, readSnapshot, render } from '../src/job.js';

const dir = fileURLToPath(new URL('./fixtures/2026-10-22/', import.meta.url));

test('job: a snapshot renders to a newline-terminated body under budget', async () => {
  const { summary, body, bytes } = render(await readSnapshot(dir));
  assert.ok(body.endsWith('\n'));
  assert.equal(bytes, Buffer.byteLength(body));
  assert.ok(bytes < MAX_BYTES);
  assert.deepEqual(JSON.parse(body), summary);
  assert.equal('maintenance' in summary, false);
});

test('job: refuses empty or non-epoch inputs rather than publishing them', async () => {
  const good = await readSnapshot(dir);
  assert.throws(() => check({ ...good, stations: [] }), /stations/);
  assert.throws(() => check({ ...good, latest: [] }), /latest/);
  assert.throws(() => check({ ...good, latest: [{ station: 'a', datetime: '2026-10-22 11:00' }] }), /epoch/);
});
