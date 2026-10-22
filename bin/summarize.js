#!/usr/bin/env node
// Fetch the three inputs, run the ruleset, write summary.json locally.
//
//   node bin/summarize.js [--out out/summary.json] [--api <base>]
//   node bin/summarize.js --snapshot <dir> [--now <epoch ms>]
//
// A snapshot directory holds stations.json, latest.json and elements_all.json
// as the API returns them.
//
// Exit 1, writing nothing, when an input cannot be read or fails the
// plausibility checks. The scheduled job is lambda/handler.js, which does the
// same and writes to S3 instead.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_API, describe, fetchInputs, readSnapshot, render } from '../src/job.js';

const { values: args } = parseArgs({
  options: {
    api: { type: 'string', default: DEFAULT_API },
    out: { type: 'string', default: 'out/summary.json' },
    snapshot: { type: 'string' },
    now: { type: 'string' },
  },
});

try {
  const inputs = args.snapshot ? await readSnapshot(args.snapshot) : await fetchInputs(args.api);
  if (args.now) inputs.now = Number(args.now);
  const { summary, body, bytes } = render(inputs);
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, body);
  console.log(`${args.out}: ${describe(summary, bytes)}`);
} catch (err) {
  console.error(`summarize: ${err.message}`);
  process.exit(1);
}
