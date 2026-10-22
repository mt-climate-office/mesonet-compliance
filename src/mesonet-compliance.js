/* ============================================================================
   mesonet-compliance — the Montana Mesonet network-health and maintenance
   ruleset, as one dependency-free ES module.

   One file on purpose: a browser consumer pins it from jsDelivr with one SRI
   hash in its import map (the kit's MapLibre pattern, HOUSE-STYLE §7), and a
   classic script reaches it with dynamic import(). Node imports the same
   bytes. No fetching, no DOM, no clock: every function takes its inputs and
   `now` explicitly, so the rules are pure and testable.

   Ported from, and pinned by tests against:
     - mesonet-status/app.js @ e479aac (reporting, health, co-location)
     - mesonet-maintenance/app.js @ 6fa1689 (maintenance compliance)
   Each port notes its source lines. Where the two apps disagree, both
   behaviours are kept and the difference is named.
   ========================================================================== */

/** Bump on any change to a rule's output (SemVer: a changed count is MAJOR). */
export const RULESET_VERSION = '0.1.1';
/** Bump when the summary JSON changes shape. */
export const SCHEMA_VERSION = 1;

/** A station is reporting when its latest record is younger than this. status app.js:32 */
export const FRESH_MINUTES = 120;
/** Co-location bucket precision, decimal degrees (~11 m). status app.js:55 */
export const BUCKET_PRECISION = 4;
/** The network's timezone. Maintenance years turn over at midnight here. */
export const TZ = 'America/Denver';

/**
 * @typedef {object} Station  One row of GET /api/v2/stations/?type=json.
 * @property {string} station
 * @property {string} name
 * @property {string|null} sub_network  'HydroMet' | 'AgriMet'
 * @property {number|null} latitude
 * @property {number|null} longitude
 * @property {number|string|null} date_installed  epoch ms from the API
 *
 * @typedef {Record<string, unknown> & {station: string, datetime: number|null}} LatestRecord
 *   One row of GET /api/v2/latest/?type=json (wide; keys are "Label [unit]").
 *
 * @typedef {object} ElementRow  One row of GET /api/v2/elements/?all=true&type=json.
 * @property {string} station
 * @property {string} element
 * @property {string} description_short
 * @property {number} [sort_order]
 *
 * @typedef {{code: string, label: string}} Element
 *
 * @typedef {object} MaintenanceRecord  One row of the hidden
 *   GET /api/v2/stations/maintenance/live feed. Only these fields are read;
 *   the feed also carries `visits` (staff names, comments, photo URLs), which
 *   this module never reads and never emits.
 * @property {string} station
 * @property {boolean} visited_this_year
 */

// ── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Whole percent, floored, so 100 means every station and 0 means none (D15).
 * The Status app's legend uses Math.round, which shows 252 of 253 as 100; the
 * counts are the same either way, only the displayed percent differs.
 */
export function pct(n, total) {
  return total ? Math.floor((n / total) * 100) : 0;
}

/** Minutes since `ts`, floored at 0; null when there is no record. status app.js:153-156 */
export function minutesSince(ts, now) {
  if (ts == null) return null;
  return Math.max(0, (now - ts) / 60000);
}

/** Calendar date in Montana for an epoch-ms instant, as 'YYYY-MM-DD'. */
export function montanaDate(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

/** Calendar year in Montana for an epoch-ms instant. maintenance app.js:249 */
export function montanaYear(ms) {
  return Number(montanaDate(ms).slice(0, 4));
}

// ── Co-location ─────────────────────────────────────────────────────────────

/** status app.js:101 */
export function bucketKey(lat, lon) {
  return `${lat.toFixed(BUCKET_PRECISION)},${lon.toFixed(BUCKET_PRECISION)}`;
}

/** Anchor priority inside a co-located bucket. status app.js:992 */
export function netRank(subNetwork) {
  return subNetwork === 'HydroMet' ? 0 : subNetwork === 'AgriMet' ? 1 : 99;
}

/**
 * Stations the status app places on its map: numeric latitude and longitude,
 * strictly (`typeof === 'number'`). status app.js:998-1005
 * @param {Station[]} stations
 * @returns {Station[]}
 */
export function statusStations(stations) {
  return stations.filter((s) => typeof s.latitude === 'number' && typeof s.longitude === 'number');
}

/**
 * Group stations sharing a site (same coordinates to BUCKET_PRECISION).
 * Members are ordered as the status app orders them: HydroMet first, then id.
 * status app.js:1016-1043, all networks visible.
 * @param {Station[]} stations
 * @returns {Map<string, Station[]>} bucket key → members, every bucket
 */
export function colocation(stations) {
  const buckets = new Map();
  for (const s of statusStations(stations)) {
    const k = bucketKey(s.latitude, s.longitude);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(s);
  }
  for (const members of buckets.values()) {
    members.sort((a, b) => netRank(a.sub_network) - netRank(b.sub_network) || a.station.localeCompare(b.station));
  }
  return buckets;
}

// ── Reporting and health ────────────────────────────────────────────────────

/**
 * 'fresh' (reporting), 'stale', or 'null' (no record). The app's names.
 * status app.js:169-172
 * @param {number|null} minSince
 * @returns {'fresh'|'stale'|'null'}
 */
export function reportingStatus(minSince) {
  if (minSince == null) return 'null';
  return minSince < FRESH_MINUTES ? 'fresh' : 'stale';
}

/**
 * Map each element label to its wide /latest/ column ("Soil VWC @ -91 cm" →
 * "Soil VWC @ -91 cm [%]"). The columns are the union across stations, so
 * the first record's keys stand for all. First match wins.
 * status app.js:812-821
 * @param {LatestRecord[]} latest
 * @returns {Map<string, string>}
 */
export function wideKeyByLabel(latest) {
  const byLabel = new Map();
  if (!latest.length) return byLabel;
  for (const k of Object.keys(latest[0])) {
    const i = k.lastIndexOf(' [');
    if (i > 0 && !byLabel.has(k.slice(0, i))) byLabel.set(k.slice(0, i), k);
  }
  return byLabel;
}

/**
 * Dedupe by element code (first row wins; the endpoint repeats rows) and
 * sort by the API's display order, then code. status app.js:844-853
 * @param {ElementRow[]} rows
 * @returns {Element[]}
 */
export function normalizeElements(rows) {
  const byCode = new Map();
  for (const r of rows) {
    if (!r || typeof r.element !== 'string' || typeof r.description_short !== 'string') continue;
    if (!byCode.has(r.element)) byCode.set(r.element, { code: r.element, label: r.description_short, order: r.sort_order ?? 0 });
  }
  return [...byCode.values()]
    .sort((a, b) => a.order - b.order || a.code.localeCompare(b.code))
    .map(({ code, label }) => ({ code, label }));
}

/**
 * Expected elements per station from the bulk /elements/?all=true response.
 * Returns null when the payload is not the bulk shape (an older API ignores
 * the flag and returns the catalog, which has no `station` column).
 * status app.js:943-958
 * @param {unknown} rows
 * @returns {Map<string, Element[]>|null}
 */
export function groupElements(rows) {
  if (!Array.isArray(rows) || !rows.length || typeof rows[0].station !== 'string') return null;
  const byStation = new Map();
  for (const r of rows) {
    if (!byStation.has(r.station)) byStation.set(r.station, []);
    byStation.get(r.station).push(r);
  }
  for (const [id, arr] of byStation) byStation.set(id, normalizeElements(arr));
  return byStation;
}

/**
 * Expected elements whose value is null in the station's latest record. An
 * element with no /latest/ column counts as missing. [] when either the
 * record or the element list is unknown. status app.js:177-193
 * @param {LatestRecord|undefined} record
 * @param {Element[]|undefined} elements
 * @param {Map<string, string>} keyByLabel
 * @returns {Element[]}
 */
export function missingElements(record, elements, keyByLabel) {
  if (!record || !elements) return [];
  return elements.filter((el) => {
    const k = keyByLabel.get(el.label);
    if (k == null) return true;
    return record[k] == null;
  });
}

/**
 * 'outage' when there is no record younger than FRESH_MINUTES; otherwise
 * 'partial' if any expected sensor is null; otherwise 'operational'. A
 * station whose element list is unknown reads as operational.
 * status app.js:197-201
 * @param {number|null} minSince
 * @param {Element[]|undefined} elements  undefined = list unknown
 * @param {LatestRecord|undefined} record
 * @param {Map<string, string>} keyByLabel
 * @returns {'operational'|'partial'|'outage'}
 */
export function healthKey(minSince, elements, record, keyByLabel) {
  if (minSince == null || minSince >= FRESH_MINUTES) return 'outage';
  return elements !== undefined && missingElements(record, elements, keyByLabel).length ? 'partial' : 'operational';
}

/**
 * Per-station reporting and health, over the stations the status app maps.
 *
 * Element lists follow the status app's bulk path (app.js:893-906): when a
 * bulk map is given, a station absent from it has an empty list (no open
 * deployments), not an unknown one. Pass `elements: null` to model "lists not
 * loaded", which the app counts as operational and flags as unknown.
 *
 * @param {object} p
 * @param {Station[]} p.stations
 * @param {LatestRecord[]} p.latest
 * @param {Map<string, Element[]>|null} p.elements  from groupElements()
 * @param {number} p.now  epoch ms
 */
export function assessHealth({ stations, latest, elements, now }) {
  const keyByLabel = wideKeyByLabel(latest);
  const recordById = new Map();
  for (const r of latest) recordById.set(r.station, r);   // app.js:806-809
  return statusStations(stations).map((s) => {
    const rec = recordById.get(s.station);
    const ts = rec ? rec.datetime : null;
    const mins = minutesSince(ts ?? null, now);
    const els = elements ? (elements.get(s.station) || []) : undefined;
    return {
      station: s.station,
      sub_network: s.sub_network,
      datetime: ts ?? null,
      status: reportingStatus(mins),
      health: healthKey(mins, els, rec, keyByLabel),
      missing: missingElements(rec, els, keyByLabel).map((e) => e.label),
      sensor_list_known: els !== undefined,
    };
  });
}

/**
 * Headline counts from assessHealth() rows. `unknown` matches the app's
 * countHealth(): non-outage stations without an element list.
 * status app.js:1127-1139
 */
export function summarizeHealth(rows) {
  const out = {
    total: rows.length,
    reporting: 0, stale: 0, no_record: 0,
    operational: 0, partial: 0, outage: 0, unknown_sensor_list: 0,
  };
  for (const r of rows) {
    if (r.status === 'fresh') out.reporting++;
    else if (r.status === 'stale') out.stale++;
    else out.no_record++;
    out[r.health]++;
    if (r.health !== 'outage' && !r.sensor_list_known) out.unknown_sensor_list++;
  }
  return out;
}

// ── Maintenance compliance ──────────────────────────────────────────────────

/**
 * Stations the maintenance app places on its map: coordinates that coerce to
 * finite numbers. Note Number(null) is 0, so a null coordinate passes here
 * and fails the status app's check. maintenance app.js:762-770
 * @param {Station[]} stations
 */
export function maintenanceStations(stations) {
  return stations.filter((s) => Number.isFinite(Number(s.latitude)) && Number.isFinite(Number(s.longitude)));
}

/**
 * True when the station was installed in `year`. `date_installed` is a
 * Montana calendar date; the API encodes it as that date at 00:00 UTC, so
 * epoch ms are read by their UTC date parts, never converted to Montana time
 * (which would move a 1 January install into the year before). A date-only
 * string is read as the same calendar date. This departs from the
 * maintenance app, which reads the instant in the viewer's timezone
 * (app.js:250-257, 189-193) and so shifts every date back a day in Montana.
 * @param {Station} s
 * @param {number} year
 */
export function installedInYear(s, year) {
  if (s.date_installed == null) return false;
  const [y, m, d] = String(s.date_installed).slice(0, 10).split('-').map(Number);
  if (y && m && d) return new Date(Date.UTC(y, m - 1, d)).getUTCFullYear() === year;
  const t = new Date(s.date_installed).getTime();
  return !Number.isNaN(t) && new Date(t).getUTCFullYear() === year;
}

/**
 * The maintenance app's compliance state for one station.
 * maintenance app.js:258-264
 * @param {Station} s
 * @param {MaintenanceRecord|undefined} record
 * @param {{year: number, feedAvailable: boolean}} ctx
 * @returns {'visited'|'overdue'|'new'|'as_needed'|'nodata'}
 */
export function complianceState(s, record, { year, feedAvailable }) {
  if (!feedAvailable) return 'nodata';
  if (s.sub_network !== 'HydroMet') return 'as_needed';
  if (record && record.visited_this_year) return 'visited';
  if (installedInYear(s, year)) return 'new';
  return 'overdue';
}

/**
 * Per-station compliance over the stations the maintenance app maps. The feed
 * counts as unavailable when it failed or is empty, as in the app (the API
 * answers [] when AirTable fails). maintenance app.js:683-692
 * @param {object} p
 * @param {Station[]} p.stations
 * @param {MaintenanceRecord[]|null} p.maintenance
 * @param {number} p.now
 */
export function assessMaintenance({ stations, maintenance, now }) {
  const feed = Array.isArray(maintenance) ? maintenance : [];
  const feedAvailable = feed.length > 0;
  const byId = new Map(feed.map((m) => [m.station, m]));
  const year = montanaYear(now);
  return {
    year,
    feedAvailable,
    rows: maintenanceStations(stations).map((s) => ({
      station: s.station,
      sub_network: s.sub_network,
      state: complianceState(s, byId.get(s.station), { year, feedAvailable }),
    })),
  };
}

/** Counts per compliance state. maintenance app.js:1739-1749, all networks. */
export function summarizeMaintenance(rows) {
  const out = { visited: 0, overdue: 0, new: 0, as_needed: 0, nodata: 0 };
  for (const r of rows) out[r.state]++;
  return out;
}

// ── Summary ─────────────────────────────────────────────────────────────────

/**
 * The published summary: station counts, reporting and health. Numbers only.
 *
 * Maintenance compliance is deliberately absent (D4, D15). The summary sits
 * at a public URL, so a "do not display" flag would not hide a figure; until
 * the owner settles which count is right, it is not computed here at all. The
 * maintenance rules above stay exported for the Maintenance app.
 *
 * @param {object} p
 * @param {Station[]} p.stations
 * @param {LatestRecord[]} p.latest
 * @param {unknown} p.elementRows  raw /elements/?all=true payload
 * @param {number} p.now  epoch ms the inputs were read at
 */
export function buildSummary({ stations, latest, elementRows, now }) {
  const elements = groupElements(elementRows);
  if (!elements) throw new Error('elements: not the bulk /elements/?all=true shape');

  const h = summarizeHealth(assessHealth({ stations, latest, elements, now }));
  const byNetwork = {};
  for (const s of statusStations(stations)) {
    const n = s.sub_network || 'none';
    byNetwork[n] = (byNetwork[n] || 0) + 1;
  }
  const shared = [...colocation(stations).values()].filter((m) => m.length > 1);

  return {
    schema_version: SCHEMA_VERSION,
    ruleset_version: RULESET_VERSION,
    generated_at: now,
    latest_newest: latest.reduce((mx, r) => (r.datetime > mx ? r.datetime : mx), 0) || null,
    stations: {
      total: h.total,
      by_network: byNetwork,
      colocated_sites: shared.length,
      colocated_stations: shared.reduce((n, mem) => n + mem.length, 0),
    },
    reporting: {
      threshold_minutes: FRESH_MINUTES,
      reporting: h.reporting,
      stale: h.stale,
      no_record: h.no_record,
      pct: pct(h.reporting, h.total),
    },
    health: {
      operational: h.operational,
      partial: h.partial,
      outage: h.outage,
      unknown_sensor_list: h.unknown_sensor_list,
      pct: { operational: pct(h.operational, h.total), partial: pct(h.partial, h.total), outage: pct(h.outage, h.total) },
    },
  };
}
