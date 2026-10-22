// Pinned against live responses captured 22 Oct 2026 11:18 MDT, trimmed by
// scripts/capture-fixtures.js. The expected values were checked against the
// status and maintenance apps' own code with scripts/equivalence.js on the
// same files (status e479aac, maintenance 6fa1689): both agree.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as R from '../src/mesonet-compliance.js';

const dir = new URL('./fixtures/2026-10-22/', import.meta.url);
const load = (f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const stations = load('stations.json');
const latest = load('latest.json');
const elementRows = load('elements_all.json');
const maintenance = load('maintenance.json');
const { captured_at: NOW } = load('meta.json');

test('fixture: per-station reporting and health', () => {
  const rows = R.assessHealth({ stations, latest, elements: R.groupElements(elementRows), now: NOW });
  const by = Object.fromEntries(rows.map((r) => [r.station, r]));
  assert.equal(rows.length, 11);
  assert.deepEqual(
    Object.fromEntries(rows.map((r) => [r.station, r.health])),
    {
      aceabsar: 'operational', acealbio: 'operational', acebaker: 'operational',
      acebento: 'partial', acedodso: 'partial',
      arskeogh: 'operational', arskeose: 'operational', arskeosw: 'operational',
      blmglsou: 'partial', mdahogel: 'outage', wsrabsaw: 'operational',
    },
  );
  assert.deepEqual(by.acebento.missing, ['Soil Temperature @ -50 cm', 'Soil VWC @ -50 cm', 'Bulk EC @ -50 cm']);
  assert.deepEqual(by.acedodso.missing, ['Wind Direction @ 10 m', 'Wind Speed @ 10 m', 'Gust Speed @ 10 m']);
  assert.equal(by.mdahogel.status, 'stale');        // last report ~20 h before capture
  assert.equal(by.arskeogh.status, 'fresh');        // 78 min: AgriMet reports hourly
});

test('fixture: headline counts', () => {
  const h = R.summarizeHealth(R.assessHealth({ stations, latest, elements: R.groupElements(elementRows), now: NOW }));
  assert.deepEqual(h, {
    total: 11, reporting: 10, stale: 1, no_record: 0,
    operational: 7, partial: 3, outage: 1, unknown_sensor_list: 0,
  });
});

test('fixture: the co-located site', () => {
  const shared = [...R.colocation(stations).values()].filter((m) => m.length > 1);
  assert.deepEqual(shared.map((m) => m.map((s) => s.station)), [['aceabsar', 'wsrabsaw']]);
});

test('fixture: maintenance states, app rules and feed tally side by side (D4)', () => {
  const m = R.assessMaintenance({ stations, maintenance, now: NOW });
  assert.equal(m.year, 2026);
  assert.deepEqual(Object.fromEntries(m.rows.map((r) => [r.station, r.state])), {
    aceabsar: 'visited', acebento: 'visited',
    acealbio: 'new', acebaker: 'new', acedodso: 'new',       // installed 2026, no feed row
    arskeogh: 'as_needed', arskeose: 'as_needed', arskeosw: 'as_needed',
    blmglsou: 'as_needed', mdahogel: 'as_needed', wsrabsaw: 'as_needed',
  });
  // The feed marks AgriMet stations and decommissioned slugs overdue.
  assert.deepEqual(R.feedComplianceCounts(maintenance), { visited: 3, overdue: 6 });
  const overdue = maintenance.filter((x) => x.compliance_state === 'overdue').map((x) => x.station).sort();
  assert.deepEqual(overdue, ['acerapel', 'arskeose', 'arskeosw', 'bentlake', 'blmglsou', 'wsrabsaw']);
});

test('fixture: maintenance rows carry no personal data', () => {
  for (const row of maintenance) {
    assert.equal('visits' in row, false);
    assert.deepEqual(Object.keys(row).sort(), [
      'compliance_state', 'days_since_qualifying', 'last_qualifying_visit_date', 'last_trip_type',
      'last_visit_date', 'qualifying_visits_this_year', 'station', 'visited_this_year',
    ]);
  }
});
