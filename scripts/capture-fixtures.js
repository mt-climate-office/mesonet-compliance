#!/usr/bin/env node
// Trim a live snapshot to a small, representative fixture set.
//
//   node scripts/capture-fixtures.js --snapshot <dir> --now <ms> --out test/fixtures/<date>
//
// Picks stations that exercise every rule branch present in the snapshot, then
// keeps only their rows. The maintenance feed is reduced to the fields the
// rules read: `visits` (staff names, free-text comments, signed AirTable photo
// URLs) is dropped, never copied. Writes meta.json with the snapshot time.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import * as R from '../src/mesonet-compliance.js';

const { values: a } = parseArgs({
  options: { snapshot: { type: 'string' }, now: { type: 'string' }, out: { type: 'string' } },
});
if (!a.snapshot || !a.now || !a.out) { console.error('--snapshot, --now and --out are required'); process.exit(2); }
const now = Number(a.now);
const load = (f) => JSON.parse(readFileSync(join(a.snapshot, f), 'utf8'));
const stations = load('stations.json');
const latest = load('latest.json');
const elementRows = load('elements_all.json');
const maintenance = load('maintenance.json');

const health = R.assessHealth({ stations, latest, elements: R.groupElements(elementRows), now });
const maint = R.assessMaintenance({ stations, maintenance, now }).rows;
const feedById = new Map(maintenance.map((m) => [m.station, m]));
const stationIds = new Set(stations.map((s) => s.station));

const pick = new Set();
const take = (rows, pred, n) => rows.filter(pred).slice(0, n).forEach((r) => pick.add(r.station));
take(health, (r) => r.health === 'operational' && r.sub_network === 'HydroMet', 2);
take(health, (r) => r.health === 'operational' && r.sub_network === 'AgriMet', 1);
take(health, (r) => r.health === 'partial' && r.sub_network === 'HydroMet', 2);
take(health, (r) => r.health === 'partial' && r.sub_network === 'AgriMet', 1);
take(health, (r) => r.health === 'outage', 2);
take(maint, (r) => r.state === 'new', 2);
take(maint, (r) => r.state === 'visited', 1);
take(maint, (r) => r.state === 'overdue', 1);
take(maint, (r) => r.state === 'as_needed' && !feedById.get(r.station)?.visited_this_year, 2);
take(maint, (r) => r.state === 'as_needed' && feedById.get(r.station)?.visited_this_year, 1);
// One co-located site, both members.
const site = [...R.colocation(stations).values()].find((m) => m.length > 1);
site.forEach((s) => pick.add(s.station));
// Feed rows for slugs /stations does not list (decommissioned).
const orphans = maintenance.filter((m) => !stationIds.has(m.station)).slice(0, 2).map((m) => m.station);

const RULE_FIELDS = ['station', 'visited_this_year', 'qualifying_visits_this_year',
  'last_qualifying_visit_date', 'days_since_qualifying', 'last_visit_date', 'last_trip_type'];
const scrub = (m) => Object.fromEntries(RULE_FIELDS.map((k) => [k, m[k]]));

const out = {
  'stations.json': stations.filter((s) => pick.has(s.station)),
  'latest.json': latest.filter((r) => pick.has(r.station)),
  'elements_all.json': elementRows.filter((r) => pick.has(r.station)),
  'maintenance.json': maintenance.filter((m) => pick.has(m.station) || orphans.includes(m.station)).map(scrub),
  'meta.json': { captured_at: now, api: 'https://mesonet2.climate.umt.edu/api/v2', stations: [...pick].sort(), orphans },
};
// latest[0] defines the wide-key map; keep the first row's full column set first.
out['latest.json'].sort((x, y) => Object.keys(y).length - Object.keys(x).length);

mkdirSync(a.out, { recursive: true });
for (const [f, v] of Object.entries(out)) writeFileSync(join(a.out, f), JSON.stringify(v, null, 1) + '\n');
console.log(`${a.out}: ${pick.size} stations, ${out['elements_all.json'].length} element rows, ${out['maintenance.json'].length} feed rows`);
