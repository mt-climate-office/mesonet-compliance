// The job around the ruleset: read the three inputs, check them, build the
// summary and serialize it. Shared by the CLI (bin/summarize.js) and the
// Lambda handler (lambda/handler.js). Node only; browsers import
// mesonet-compliance.js directly and never load this file.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSummary } from './mesonet-compliance.js';

export const DEFAULT_API = 'https://mesonet2.climate.umt.edu/api/v2';
export const TIMEOUT_MS = 25_000;      // the API gateway gives up at 30 s
export const MAX_BYTES = 2048;

/** GET a JSON body, retrying twice with a short backoff. */
export async function getJSON(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      last = err;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error(`${url}: ${last.message}`);
}

/**
 * The three inputs, live. The maintenance feed is not read: the summary
 * carries no maintenance section (D15), and the feed holds staff names.
 */
export async function fetchInputs(base = DEFAULT_API) {
  const now = Date.now();
  const [stations, latest, elementRows] = await Promise.all([
    getJSON(`${base}/stations/?type=json`),
    getJSON(`${base}/latest/?type=json`),
    getJSON(`${base}/elements/?all=true&type=json`),
  ]);
  return { stations, latest, elementRows, now };
}

/** The same inputs from saved responses (stations.json, latest.json, elements_all.json). */
export async function readSnapshot(dir) {
  const read = async (f) => JSON.parse(await readFile(join(dir, f), 'utf8'));
  return {
    stations: await read('stations.json'),
    latest: await read('latest.json'),
    elementRows: await read('elements_all.json'),
    now: Date.now(),
  };
}

/** Throw unless the inputs look like the API's answers. */
export function check({ stations, latest }) {
  if (!Array.isArray(stations) || !stations.length) throw new Error('stations: empty or not a list');
  if (!Array.isArray(latest) || !latest.length) throw new Error('latest: empty or not a list');
  if (typeof latest[0].datetime !== 'number') throw new Error('latest: datetime is not epoch ms (was type=json dropped?)');
}

/**
 * Check, build and serialize. Throws on bad inputs or an over-budget body, so
 * a caller that only writes on success leaves the last good file in place.
 */
export function render(inputs) {
  check(inputs);
  const summary = buildSummary(inputs);
  const body = JSON.stringify(summary, null, 2) + '\n';
  const bytes = Buffer.byteLength(body);
  if (bytes > MAX_BYTES) throw new Error(`summary is ${bytes} bytes, over the ${MAX_BYTES}-byte budget`);
  return { summary, body, bytes };
}

/** One log line. */
export function describe(summary, bytes) {
  const r = summary.reporting, h = summary.health;
  return `${bytes} bytes · ${summary.stations.total} stations · ` +
    `${r.reporting} reporting (${r.pct}%) · health ${h.operational}/${h.partial}/${h.outage}`;
}
