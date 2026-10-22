#!/usr/bin/env node
// Run the apps' own rule code and this ruleset on one snapshot; compare.
//
//   node scripts/equivalence.js --snapshot <dir> [--now <ms>]
//        [--status ../mesonet-status] [--maintenance ../mesonet-maintenance]
//        [--ref HEAD]   (git ref to read app.js at; 'worktree' for the working tree)
//
// The app functions are not copied here. They are cut out of each app's
// app.js by name, at the given git ref, and evaluated in a vm sandbox with
// the DOM, map and kit stubbed. Counting runs over every mapped station (all
// sub-networks visible), as the legends do on first load.
//
// Not run in CI: it needs sibling checkouts of the two apps. Exit 1 on any
// difference.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import vm from 'node:vm';
import * as R from '../src/mesonet-compliance.js';

const { values: a } = parseArgs({
  options: {
    snapshot: { type: 'string' },
    now: { type: 'string' },
    status: { type: 'string', default: '../mesonet-status' },
    maintenance: { type: 'string', default: '../mesonet-maintenance' },
    ref: { type: 'string', default: 'HEAD' },
  },
});
if (!a.snapshot) { console.error('--snapshot <dir> is required'); process.exit(2); }

const load = (f) => JSON.parse(readFileSync(join(a.snapshot, f), 'utf8'));
const stations = load('stations.json');
const latest = load('latest.json');
const elementRows = load('elements_all.json');
let maintenance = null;
try { maintenance = load('maintenance.json'); } catch { /* optional */ }
const NOW = a.now ? Number(a.now) : Date.now();

function appSource(repo) {
  const dir = resolve(repo);
  if (a.ref === 'worktree') return readFileSync(join(dir, 'app.js'), 'utf8');
  return execFileSync('git', ['-C', dir, 'show', `${a.ref}:app.js`], { encoding: 'utf8' });
}

// Cut `function name(...) {...}` (sync or async) out of src by brace matching.
// Good enough for these files: no braces inside the extracted functions'
// strings or regexes are unbalanced.
function cut(src, name) {
  const m = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!m) throw new Error(`function ${name} not found`);
  let i = src.indexOf('{', m.index), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(m.index, j + 1);
  }
  throw new Error(`function ${name}: unbalanced`);
}
// The right-hand side of a top-level `const NAME = …;` line.
function constant(src, name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*([^;]+);`).exec(src);
  if (!m) throw new Error(`const ${name} not found`);
  return m[1];
}

// A Date whose "now" is the snapshot time, for the sandbox.
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
const noop = () => {};

// ── Status app ──────────────────────────────────────────────────────────────
async function statusCounts() {
  const src = appSource(a.status);
  const fns = ['minutesSince', 'statusBucket', 'missingElements', 'healthKey', 'ingestLatest',
    'setElements', 'normalizeElements', 'mapLimit', 'loadElements', 'loadElementsBulk',
    'readElementsCache', 'writeElementsCache', 'indexStations', 'countHealth'].map((n) => cut(src, n));
  const ctx = vm.createContext({
    Date: FixedDate, Math, Map, Set, Number, Array, Object, String, Promise, JSON, console: { warn: noop, error: noop, log: noop },
    MCO: {
      lsGet: () => null, lsSet: noop, showToast: noop, announce: noop,
      fetchJSON: async () => elementRows,          // the bulk response
    },
    renderLegendNote: noop, scheduleHealthRefresh: noop,
    stations, activeNetworks: new Set(),
    latestById: new Map(), latestRecordById: new Map(), stationById: new Map(), bucketById: new Map(),
    elementsById: new Map(), elementsFailed: new Set(), _elementsProgress: {}, _elementsInFlight: false,
    _wideKeyByLabel: new Map(), _warnedLabels: new Set(), bucketMembers: new Map(),
  });
  const consts = ['FRESH_MINUTES', 'BUCKET_PRECISION', 'ELEMENTS_CACHE_KEY', 'ELEMENTS_TTL_MS',
    'ELEMENTS_CONCURRENCY', 'ELEMENTS_TIMEOUT_MS', 'ELEMENTS_PERSIST_EVERY']
    .map((n) => `var ${n} = ${constant(src, n)};`).join('\n');
  vm.runInContext(`${consts}
    var ELEMENTS_ALL_URL = 'bulk'; var ELEMENTS_URL = (s) => s;
    var bucketKey = ${constant(src, 'bucketKey')};
    ${fns.join('\n')}`, ctx);
  vm.runInContext('ingestLatest(latestIn); indexStations();', Object.assign(ctx, { latestIn: latest }));
  await vm.runInContext('loadElements()', ctx);
  // countHealth() walks bucketMembers, which rebuildSource() fills from every
  // indexed station whose network is visible: all of them, on first load.
  return vm.runInContext(`
    for (const s of stations) if (stationById.has(s.station) && (!s.sub_network || activeNetworks.has(s.sub_network)))
      bucketMembers.set(s.station, [s]);
    const c = countHealth(); let fresh = 0, stale = 0, none = 0;
    for (const [id] of bucketMembers) { const b = statusBucket(minutesSince(latestById.get(id) ?? null));
      if (b === 'fresh') fresh++; else if (b === 'stale') stale++; else none++; }
    ({ total: c.total, reporting: fresh, stale, no_record: none, operational: c.operational,
       partial: c.partial, outage: c.outage, unknown_sensor_list: c.unknown })`, ctx);
}

// ── Maintenance app ─────────────────────────────────────────────────────────
function maintenanceCounts() {
  const src = appSource(a.maintenance);
  const feed = Array.isArray(maintenance) ? maintenance : [];
  const ctx = vm.createContext({
    Date: FixedDate, Intl, Number, String, Map, Set, isNaN,
    stations: structuredClone(stations), activeNetworks: new Set(),
    maintBySta: new Map(feed.map((m) => [m.station, m])), dataUnavailable: feed.length === 0,
    stationById: new Map(), bucketById: new Map(),
  });
  return vm.runInContext(`
    var BUCKET_PRECISION = ${constant(src, 'BUCKET_PRECISION')};
    var MT_TZ = ${constant(src, 'MT_TZ')};
    var bucketKey = ${constant(src, 'bucketKey')};
    ${['ymdToLocalMidnight', 'montanaToday', 'installedThisYear', 'complianceStateFor', 'indexStations'].map((n) => cut(src, n)).join('\n')}
    var CURRENT_YEAR = ${constant(src, 'CURRENT_YEAR')};
    indexStations();
    const out = { visited: 0, overdue: 0, new: 0, as_needed: 0, nodata: 0 };
    for (const s of stations) {
      if (!stationById.has(s.station)) continue;
      if (s.sub_network && !activeNetworks.has(s.sub_network)) continue;
      out[complianceStateFor(s)]++;
    }
    out;`, ctx);
}

// ── Compare ─────────────────────────────────────────────────────────────────
const ours = R.summarizeHealth(R.assessHealth({
  stations, latest, elements: R.groupElements(elementRows), now: NOW,
}));
const theirs = await statusCounts();
const oursM = R.summarizeMaintenance(R.assessMaintenance({ stations, maintenance, now: NOW }).rows);
const theirsM = maintenanceCounts();

let diff = 0;
const row = (label, x, y) => {
  const same = JSON.stringify(x) === JSON.stringify(y);
  if (!same) diff++;
  console.log(`${same ? 'same' : 'DIFF'}  ${label}\n      app:      ${JSON.stringify(y)}\n      ruleset:  ${JSON.stringify(x)}`);
};
console.log(`snapshot ${a.snapshot} at ${new Date(NOW).toISOString()} (ref ${a.ref}, TZ ${process.env.TZ || 'system'})`);
row('status: reporting + health', ours, theirs);
row('maintenance: compliance states', oursM, theirsM);
process.exit(diff ? 1 : 0);
