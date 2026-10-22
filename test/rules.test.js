// Unit tests: one rule at a time, hand-built inputs, each edge the apps define.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as R from '../src/mesonet-compliance.js';

const NOW = Date.UTC(2026, 9, 22, 17, 0);   // 22 Oct 2026, 11:00 MDT
const MIN = 60000;

test('pct floors to a whole percent, so 100 means all of them (D15)', () => {
  assert.equal(R.pct(252, 253), 99);    // one station stale reads 99, not 100
  assert.equal(R.pct(253, 253), 100);
  assert.equal(R.pct(218, 253), 86);
  assert.equal(R.pct(2, 253), 0);       // a nonzero count can read 0
  assert.equal(R.pct(2, 3), 66);
  assert.equal(R.pct(0, 0), 0);
});

test('minutesSince: null without a record, floored at 0 for a future stamp', () => {
  assert.equal(R.minutesSince(null, NOW), null);
  assert.equal(R.minutesSince(undefined, NOW), null);
  assert.equal(R.minutesSince(NOW - 90 * MIN, NOW), 90);
  assert.equal(R.minutesSince(NOW + 5 * MIN, NOW), 0);
});

test('reportingStatus: fresh below 120 min, stale at 120 and above', () => {
  assert.equal(R.FRESH_MINUTES, 120);
  assert.equal(R.reportingStatus(null), 'null');
  assert.equal(R.reportingStatus(0), 'fresh');
  assert.equal(R.reportingStatus(119.99), 'fresh');
  assert.equal(R.reportingStatus(120), 'stale');
  assert.equal(R.reportingStatus(5000), 'stale');
});

test('wideKeyByLabel: label before the last " [", first column wins, unitless keys skipped', () => {
  const m = R.wideKeyByLabel([{
    station: 'x', datetime: 1, provisional: true,
    'Air Temperature @ 2 m [°F]': 1,
    'Soil VWC @ -91 cm [%]': 2,
    'Odd [a] label [b]': 3,
  }]);
  assert.equal(m.get('Air Temperature @ 2 m'), 'Air Temperature @ 2 m [°F]');
  assert.equal(m.get('Soil VWC @ -91 cm'), 'Soil VWC @ -91 cm [%]');
  assert.equal(m.get('Odd [a] label'), 'Odd [a] label [b]');
  assert.equal(m.has('station'), false);
  assert.equal(m.has('provisional'), false);
  assert.equal(R.wideKeyByLabel([]).size, 0);
});

test('normalizeElements: dedupes by code, drops malformed rows, sorts by sort_order then code', () => {
  const els = R.normalizeElements([
    { element: 'b', description_short: 'B', sort_order: 2 },
    { element: 'a', description_short: 'A', sort_order: 2 },
    { element: 'a', description_short: 'A again', sort_order: 1 },
    { element: 'z', description_short: 'Z' },                 // no sort_order → 0
    { element: 7, description_short: 'bad code' },
    { element: 'c' },
    null,
  ]);
  assert.deepEqual(els, [
    { code: 'z', label: 'Z' },
    { code: 'a', label: 'A' },
    { code: 'b', label: 'B' },
  ]);
});

test('groupElements: null unless the payload is the bulk shape', () => {
  assert.equal(R.groupElements(null), null);
  assert.equal(R.groupElements([]), null);
  assert.equal(R.groupElements([{ element: 'a', description_short: 'A' }]), null);  // catalog shape
  const g = R.groupElements([
    { station: 's1', element: 'a', description_short: 'A', sort_order: 1 },
    { station: 's2', element: 'a', description_short: 'A', sort_order: 1 },
    { station: 's1', element: 'b', description_short: 'B', sort_order: 0 },
  ]);
  assert.deepEqual(g.get('s1').map((e) => e.code), ['b', 'a']);
  assert.equal(g.get('s2').length, 1);
});

const KEYS = new Map([['A', 'A [u]'], ['B', 'B [u]']]);
const EL = [{ code: 'a', label: 'A' }, { code: 'b', label: 'B' }];

test('missingElements: null and absent values count; a label with no column counts', () => {
  assert.deepEqual(R.missingElements({ 'A [u]': 1, 'B [u]': 2 }, EL, KEYS), []);
  assert.deepEqual(R.missingElements({ 'A [u]': 0, 'B [u]': null }, EL, KEYS).map((e) => e.code), ['b']);
  assert.deepEqual(R.missingElements({ 'A [u]': 1 }, EL, KEYS).map((e) => e.code), ['b']);
  assert.deepEqual(R.missingElements({ 'A [u]': 1, 'B [u]': 1 }, [...EL, { code: 'c', label: 'C' }], KEYS)
    .map((e) => e.code), ['c']);
  assert.deepEqual(R.missingElements(undefined, EL, KEYS), []);
  assert.deepEqual(R.missingElements({}, undefined, KEYS), []);
});

test('healthKey: outage beats everything; unknown list reads operational', () => {
  const full = { 'A [u]': 1, 'B [u]': 1 };
  const gap = { 'A [u]': 1, 'B [u]': null };
  assert.equal(R.healthKey(null, EL, full, KEYS), 'outage');
  assert.equal(R.healthKey(120, EL, full, KEYS), 'outage');
  assert.equal(R.healthKey(5, EL, full, KEYS), 'operational');
  assert.equal(R.healthKey(5, EL, gap, KEYS), 'partial');
  assert.equal(R.healthKey(5, undefined, gap, KEYS), 'operational');  // list not loaded
  assert.equal(R.healthKey(5, [], gap, KEYS), 'operational');         // no open deployments
});

test('assessHealth: coordinates must be numbers; absent from bulk = empty list; last /latest/ row wins', () => {
  const stations = [
    { station: 'ok', sub_network: 'HydroMet', latitude: 46, longitude: -110 },
    { station: 'nolist', sub_network: 'AgriMet', latitude: 46.1, longitude: -110 },
    { station: 'silent', sub_network: 'HydroMet', latitude: 46.2, longitude: -110 },
    { station: 'strlat', sub_network: 'HydroMet', latitude: '46.3', longitude: -110 },
    { station: 'nullat', sub_network: 'HydroMet', latitude: null, longitude: -110 },
  ];
  const latest = [
    { station: 'ok', datetime: NOW - 10 * MIN, 'A [u]': 1, 'B [u]': 1 },
    { station: 'ok', datetime: NOW - 5 * MIN, 'A [u]': 1, 'B [u]': null },
    { station: 'nolist', datetime: NOW - 10 * MIN, 'A [u]': null, 'B [u]': null },
  ];
  const elements = new Map([['ok', EL]]);
  const rows = R.assessHealth({ stations, latest, elements, now: NOW });
  assert.deepEqual(rows.map((r) => r.station), ['ok', 'nolist', 'silent']);
  assert.deepEqual(rows.map((r) => r.health), ['partial', 'operational', 'outage']);
  assert.deepEqual(rows.map((r) => r.status), ['fresh', 'fresh', 'null']);
  assert.deepEqual(rows[0].missing, ['B']);

  const unknown = R.assessHealth({ stations, latest, elements: null, now: NOW });
  const s = R.summarizeHealth(unknown);
  assert.equal(s.unknown_sensor_list, 2);   // 'ok' and 'nolist'; outage is not counted
  assert.equal(s.operational, 2);
});

test('summarizeHealth: every station lands in exactly one status and one health class', () => {
  const rows = [
    { status: 'fresh', health: 'operational', sensor_list_known: true },
    { status: 'fresh', health: 'partial', sensor_list_known: true },
    { status: 'stale', health: 'outage', sensor_list_known: true },
    { status: 'null', health: 'outage', sensor_list_known: false },
  ];
  assert.deepEqual(R.summarizeHealth(rows), {
    total: 4, reporting: 2, stale: 1, no_record: 1,
    operational: 1, partial: 1, outage: 2, unknown_sensor_list: 0,
  });
});

test('colocation: 4-decimal buckets, HydroMet anchors, then id', () => {
  const b = R.colocation([
    { station: 'z-agri', sub_network: 'AgriMet', latitude: 45.56001, longitude: -109.61 },
    { station: 'y-hydro', sub_network: 'HydroMet', latitude: 45.56004, longitude: -109.61 },
    { station: 'far', sub_network: 'HydroMet', latitude: 45.5601, longitude: -109.61 },
  ]);
  assert.equal(b.size, 2);
  assert.deepEqual(b.get('45.5600,-109.6100').map((s) => s.station), ['y-hydro', 'z-agri']);
});

test('montanaYear turns over at midnight Mountain, not UTC', () => {
  assert.equal(R.montanaYear(Date.UTC(2027, 0, 1, 6, 30)), 2026);   // 23:30 MST 31 Dec
  assert.equal(R.montanaYear(Date.UTC(2027, 0, 1, 7, 0)), 2027);    // 00:00 MST 1 Jan
  assert.equal(R.montanaDate(Date.UTC(2026, 9, 22, 3)), '2026-10-21');
});

test('installedInYear: date_installed is a Montana calendar date stored at 00:00 UTC', () => {
  assert.equal(R.installedInYear({ date_installed: null }, 2026), false);
  assert.equal(R.installedInYear({ date_installed: Date.UTC(2026, 4, 1) }, 2026), true);
  // 1 Jan 2026 in Montana, encoded as 00:00 UTC that day: installed in 2026.
  assert.equal(R.installedInYear({ date_installed: Date.UTC(2026, 0, 1) }, 2026), true);
  assert.equal(R.installedInYear({ date_installed: Date.UTC(2026, 0, 1) }, 2025), false);
  // 31 Dec 2025 in Montana: still 2025.
  assert.equal(R.installedInYear({ date_installed: Date.UTC(2025, 11, 31) }, 2025), true);
  assert.equal(R.installedInYear({ date_installed: '2026-01-01' }, 2026), true);
  assert.equal(R.installedInYear({ date_installed: 'not a date' }, 2026), false);
});

test('complianceState: order of the rules', () => {
  const ctx = { year: 2026, feedAvailable: true };
  const hydro = { sub_network: 'HydroMet', date_installed: Date.UTC(2020, 5, 1) };
  const hydroNew = { sub_network: 'HydroMet', date_installed: Date.UTC(2026, 5, 1) };
  assert.equal(R.complianceState(hydro, undefined, { ...ctx, feedAvailable: false }), 'nodata');
  assert.equal(R.complianceState({ sub_network: 'AgriMet' }, { visited_this_year: false }, ctx), 'as_needed');
  assert.equal(R.complianceState({ sub_network: null }, undefined, ctx), 'as_needed');
  assert.equal(R.complianceState(hydro, { visited_this_year: true }, ctx), 'visited');
  assert.equal(R.complianceState(hydroNew, { visited_this_year: true }, ctx), 'visited');
  assert.equal(R.complianceState(hydroNew, undefined, ctx), 'new');
  assert.equal(R.complianceState(hydroNew, { visited_this_year: false }, ctx), 'new');
  assert.equal(R.complianceState(hydro, { visited_this_year: false }, ctx), 'overdue');
  assert.equal(R.complianceState(hydro, undefined, ctx), 'overdue');
});

test('assessMaintenance: an empty feed is unavailable; coordinates coerce (null passes as 0)', () => {
  const stations = [
    { station: 'a', sub_network: 'HydroMet', latitude: 46, longitude: -110, date_installed: null },
    { station: 'b', sub_network: 'HydroMet', latitude: null, longitude: -110, date_installed: null },
    { station: 'c', sub_network: 'HydroMet', latitude: 'x', longitude: -110, date_installed: null },
  ];
  const empty = R.assessMaintenance({ stations, maintenance: [], now: NOW });
  assert.equal(empty.feedAvailable, false);
  assert.deepEqual(empty.rows.map((r) => r.state), ['nodata', 'nodata']);
  const failed = R.assessMaintenance({ stations, maintenance: null, now: NOW });
  assert.equal(failed.feedAvailable, false);
  const ok = R.assessMaintenance({ stations, maintenance: [{ station: 'a', visited_this_year: true }], now: NOW });
  assert.deepEqual(ok.rows.map((r) => [r.station, r.state]), [['a', 'visited'], ['b', 'overdue']]);
  assert.equal(ok.year, 2026);
});
