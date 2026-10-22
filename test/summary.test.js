// The published summary: shape, size, no maintenance section, no personal data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as R from '../src/mesonet-compliance.js';

const dir = new URL('./fixtures/2026-10-22/', import.meta.url);
const load = (f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const inputs = {
  stations: load('stations.json'),
  latest: load('latest.json'),
  elementRows: load('elements_all.json'),
  now: load('meta.json').captured_at,
};

test('summary: versioned, epoch-ms stamped, threshold stated', () => {
  const s = R.buildSummary(inputs);
  assert.equal(s.schema_version, 1);
  assert.equal(s.ruleset_version, R.RULESET_VERSION);
  assert.equal(s.generated_at, inputs.now);
  assert.equal(s.latest_newest, 1792689300000);
  assert.equal(s.reporting.threshold_minutes, 120);
  assert.deepEqual(s.stations, { total: 11, by_network: { HydroMet: 5, AgriMet: 6 }, colocated_sites: 1, colocated_stations: 2 });
  assert.deepEqual(s.reporting, { threshold_minutes: 120, reporting: 10, stale: 1, no_record: 0, pct: 90 });
  assert.deepEqual(s.health, {
    operational: 7, partial: 3, outage: 1, unknown_sensor_list: 0,
    pct: { operational: 63, partial: 27, outage: 9 },
  });
});

test('summary: carries no maintenance section at all (D4, D15)', () => {
  const s = R.buildSummary(inputs);
  assert.deepEqual(Object.keys(s), ['schema_version', 'ruleset_version', 'generated_at', 'latest_newest', 'stations', 'reporting', 'health']);
  // Passing the feed anyway changes nothing: buildSummary does not read it.
  const withFeed = R.buildSummary({ ...inputs, maintenance: load('maintenance.json') });
  assert.deepEqual(withFeed, s);
  assert.equal(/maint|visit|overdue|complian/i.test(JSON.stringify(s)), false);
});

test('summary: refuses a non-bulk elements payload rather than guessing', () => {
  assert.throws(() => R.buildSummary({ ...inputs, elementRows: [{ element: 'a' }] }), /bulk/);
});

test('summary: nothing from visits reaches it', () => {
  // A feed row as the API serves it, with personal fields filled in.
  const raw = load('maintenance.json').map((m) => ({
    ...m,
    visits: [{
      date: '2026-06-01', trip_type: ['Maintenance'], inspected_by: 'Jane Example, Sam Placeholder',
      description: 'Swapped the anemometer', comments: 'Gate code 1234',
      tasks: [], photos: [{ thumb: 'https://v5.airtableusercontent.com/x', full: 'https://v5.airtableusercontent.com/y', filename: 'IMG_1.jpg' }],
      sensors_added: [], sensors_removed: [],
    }],
  }));
  const text = JSON.stringify(R.buildSummary({ ...inputs, maintenance: raw }));
  for (const needle of ['Jane', 'Placeholder', 'anemometer', 'Gate code', 'airtable', 'IMG_1']) {
    assert.equal(text.includes(needle), false, needle);
  }
});

test('summary: under the 2 KB budget, even with every count at five digits', () => {
  const s = R.buildSummary(inputs);
  const swell = JSON.parse(JSON.stringify(s), (k, v) => (typeof v === 'number' && k !== 'generated_at' && k !== 'latest_newest' ? 99999 : v));
  assert.ok(Buffer.byteLength(JSON.stringify(swell, null, 2)) < 2048);
});
