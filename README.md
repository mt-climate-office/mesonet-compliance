# mesonet-compliance

The rules that decide whether a Montana Mesonet station is reporting, whether
its sensors are all reporting, and whether it has had its annual maintenance
visit. One ES module, no dependencies. A Lambda runs it every 15 minutes and
writes a summary of about 600 bytes for headline figures. The summary covers
stations, reporting and health only; maintenance compliance is not published
(D4, D15).

Decision D5 in `mco-website-next/docs/DECISIONS.md` set this up. Until now the
rules lived only inside the Status and Maintenance apps, and the website would
have been a third copy.

Status: **not yet deployed.** The infrastructure is in `terraform/`, planned
but not applied, and the data2 object does not exist yet. See
[Deploying](#deploying).

## The rules

Ported from the two apps, line for line, and checked against their own code
(see [Checking against the apps](#checking-against-the-apps)).

**Stations.** Every row of `/api/v2/stations/` with numeric coordinates.

**Reporting.** A station is reporting when its most recent `/latest/` record
is less than 120 minutes old. At 120 minutes it is stale. With no record it
is counted separately.

**Health.** One of three classes per station.

| Class | Rule |
|---|---|
| Operational | Reporting, and every expected sensor has a value in the latest record |
| Partial sensor outage | Reporting, and at least one expected sensor is null |
| Total outage | Not reporting (stale or no record) |

Expected sensors come from `/elements/?all=true`, one list per station. A
sensor counts as missing when its value is null or when `/latest/` has no
column for it. A station absent from the element list has no expected
sensors and reads as operational, as in the Status app.

**Co-location.** Stations whose coordinates match to four decimal places
(about 11 m) share a site. HydroMet is listed first.

**Maintenance.** Each station gets one state for the current calendar year in
Montana time. These rules are exported for the Maintenance app to import;
they are **not** in the published summary (see below).

| State | Rule |
|---|---|
| As-needed | Not HydroMet. AgriMet has no annual requirement |
| Visited | HydroMet, and the feed's `visited_this_year` is true. Only a "Maintenance" trip counts; a "Repair" does not |
| New (exempt) | HydroMet, not visited, installed this year |
| Overdue | HydroMet, not visited, installed before this year |

`visited_this_year` is computed by the API from AirTable
(`mesonet-db-rds/api/app/app/registry.py`). This module reads that flag and
nothing else from a visit.

## Using it

### In Node

```js
import { buildSummary, assessHealth, groupElements } from './src/mesonet-compliance.js';
```

Every function takes its inputs and `now` (epoch ms) as arguments. Nothing
fetches and nothing reads the clock, so the same inputs give the same answer.

### In a browser

Pin the file from jsDelivr at a release tag, with SRI, in the page's import
map. This is how the kit loads MapLibre (HOUSE-STYLE §7).

```html
<script type="importmap">
{
  "imports": {
    "mesonet-compliance": "https://cdn.jsdelivr.net/gh/mt-climate-office/mesonet-compliance@v0.1.0/src/mesonet-compliance.js"
  },
  "integrity": {
    "https://cdn.jsdelivr.net/gh/mt-climate-office/mesonet-compliance@v0.1.0/src/mesonet-compliance.js": "sha384-…"
  }
}
</script>
```

A classic script reaches it with `const R = await import('mesonet-compliance');`.
The ruleset is one file so that one hash covers it. Compute the hash from the
tagged file:

```sh
curl -s https://cdn.jsdelivr.net/gh/mt-climate-office/mesonet-compliance@v0.1.0/src/mesonet-compliance.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

The page's CSP needs `script-src https://cdn.jsdelivr.net`, which every kit
consumer already has.

### The summary file

For a headline number, read the summary instead of importing the rules. The
summary is about 600 bytes; the inputs behind it are 1.7 MB.

```
https://data2.climate.umt.edu/mesonet/compliance/v1/summary.json
```

Served with `Content-Type: application/json; charset=utf-8` and
`Cache-Control: public, max-age=60`, CORS as for the rest of data2. Not live
yet. Example, from live data at 11:51 MDT on 22 Oct 2026:

```json
{
  "schema_version": 1,
  "ruleset_version": "0.1.0",
  "generated_at": 1792691515427,
  "latest_newest": 1792691400000,
  "stations": {
    "total": 253,
    "by_network": { "HydroMet": 165, "AgriMet": 88 },
    "colocated_sites": 10,
    "colocated_stations": 20
  },
  "reporting": {
    "threshold_minutes": 120,
    "reporting": 252, "stale": 1, "no_record": 0,
    "pct": 99
  },
  "health": {
    "operational": 219, "partial": 33, "outage": 1,
    "unknown_sensor_list": 0,
    "pct": { "operational": 86, "partial": 13, "outage": 0 }
  }
}
```

| Field | Meaning |
|---|---|
| `schema_version` | Shape of this file. The path carries it too (`v1/`) |
| `ruleset_version` | Version of the rules that produced the numbers |
| `generated_at` | When the inputs were read, epoch ms, as the API writes times |
| `latest_newest` | Newest `datetime` in `/latest/`, epoch ms |
| `reporting.pct`, `health.pct` | Whole percent of `stations.total`, **floored** |

**No maintenance section.** Per D4 and D15 the maintenance-compliance figure
is not published until the API's `compliance_state` agrees with the
Maintenance app's rules. The file is at a public URL, so it leaves the
section out entirely rather than carrying it behind a flag. The job does not
read the maintenance feed at all.

**Percentages are floored** (D15), so 100 means every station and 0 means
none. With 252 of 253 reporting, `reporting.pct` reads 99. This departs from
the Status app, whose legend uses `Math.round` and would show 100. Only the
displayed percent differs: the counts are identical, and the equivalence
check below compares counts. A consequence worth knowing: the three
`health.pct` values can sum to less than 100, and a nonzero count can read 0
(one outage of 253 is `"outage": 0`). Show the count beside the percent.

**Staleness.** If a run fails, the previous file stays up. Check
`generated_at`; anything older than an hour means the job has stopped, and
the missed-run alarm will have paged.

**Privacy.** The file holds counts only. The maintenance feed carries staff
names, field comments and photo links (O2); the job does not fetch it, and a
test feeds `buildSummary` named visits and checks none come out.

## The job

```sh
node bin/summarize.js                     # live API → out/summary.json
node bin/summarize.js --snapshot <dir>    # saved responses instead
```

It reads three endpoints on `mesonet2.climate.umt.edu/api/v2`: `/stations/`,
`/latest/` and `/elements/?all=true`. Each request times out at 25 s (the
gateway stops at 30 s) and retries twice.

It exits 1 and writes nothing when any input fails, when stations or latest
is empty, when `datetime` is not epoch ms, or when the elements response is
not the bulk shape.

`lambda/handler.js` is the same job (`src/job.js`) writing to S3 instead of a
file. It throws on any failure before the write, so the previous summary
stays published.

## Tests

```sh
node --test
```

28 tests. Unit tests take each rule through its edges with hand-built inputs.
Fixture tests pin per-station results on 11 stations captured live on
22 Oct 2026 (`test/fixtures/2026-10-22/`), chosen to cover every class present
that day. The feed fixture keeps only the fields the rules read; `visits` is
dropped at capture.

To refresh fixtures from a new snapshot:

```sh
node scripts/capture-fixtures.js --snapshot <dir> --now <ms> --out test/fixtures/<date>
```

## Checking against the apps

`scripts/equivalence.js` cuts the rule functions out of the Status and
Maintenance apps' own `app.js`, by name and at a git ref, runs them in a
sandbox with the map and kit stubbed, and compares their counts with this
module's on one snapshot. It needs sibling checkouts, so it does not run in
CI.

```sh
npm run equivalence -- --snapshot <dir> --now <ms>             # app.js at HEAD
npm run equivalence -- --snapshot <dir> --now <ms> --ref worktree
```

Run on 22 Oct 2026 against `mesonet-status` e479aac and `mesonet-maintenance`
6fa1689: identical on the full network and on the fixtures, before and after
the change to floored percentages (it compares counts, which flooring does
not touch). The maintenance comparison still runs, from a `maintenance.json`
in the snapshot, because the maintenance rules stay in the module.

## Where the two apps differ

Both behaviours are kept; neither is fixed here.

- **Coordinates.** Status requires `typeof latitude === 'number'`.
  Maintenance coerces with `Number()`, so a null coordinate passes as 0 and
  the station would be placed at 0°, 0°. No station has a null coordinate
  today.
- **Year boundary.** The app reads the install year in the viewer's
  timezone; this module reads it in Montana time. The API computes
  `visited_this_year` from the container's date, UTC by default. From
  17:00 MST on 31 December the API has moved to the new year and the app has
  not, so every HydroMet station installed before that year reads overdue
  until midnight.

## Deploying

`terraform/` follows mesonet-aq and mesonet-power: in-repo Terraform consuming
pinned `mco-aws` modules, state in `mco-terraform-state`, applies manual and
local.

| Piece | What |
|---|---|
| Function | `mesonet-compliance`, container image, Node 24, 256 MB, 120 s timeout, reserved concurrency 1, no VPC (`modules/container-lambda@v0.1.1`) |
| Schedule | EventBridge Scheduler, `cron(7,22,37,52 * * * ? *)` America/Denver; async, one retry within 10 min |
| Function role | `s3:PutObject` on `mco-mesonet/compliance/*`, plus the basic Lambda logging policy. Nothing else |
| Logs | `/aws/lambda/mesonet-compliance`, 30 days |
| Alarm | `mesonet-compliance-run-stale`: Invocations minus Errors below 1 in four consecutive 15-minute buckets, missing data breaching → `mco-ops-alerts` |
| Image | `ECR mesonet-compliance`, keep 10. Base `public.ecr.aws/lambda/nodejs:24` pinned by digest, which also pins the bundled `@aws-sdk/client-s3` |
| CI role | `mesonet-compliance-github-actions`, `main` only, repo-ID pinned: ECR push, and `GetFunction`/`UpdateFunctionCode`/`InvokeFunction` on this one function |

The bucket and the data2 CDN need no change.

**First apply, in two stages.** A container Lambda cannot be created until its
image is in ECR, and the image cannot be pushed until the repository exists.

```sh
cd terraform
export AWS_PROFILE=mco
cp terraform.tfvars.example terraform.tfvars   # set github_repository_id
terraform init

# Stage 1: ECR repo and the CI role only.
terraform plan -out=stage1.tfplan \
  -target=aws_ecr_repository.this -target=aws_ecr_lifecycle_policy.this -target=module.github_oidc
terraform apply stage1.tfplan
gh variable set AWS_ROLE_ARN --repo mt-climate-office/mesonet-compliance \
  --body "$(terraform output -raw github_actions_role_arn)"
gh workflow run deploy.yml --repo mt-climate-office/mesonet-compliance   # pushes :latest

# Stage 2: everything else.
terraform plan -out=stage2.tfplan
terraform apply stage2.tfplan
gh workflow run deploy.yml --repo mt-climate-office/mesonet-compliance   # smoke run
```

Commit `.terraform.lock.hcl` if init changed it.

After that, a push to `main` that touches the image redeploys it
(`.github/workflows/deploy.yml`): tests, build, push `:<sha>`, point the
function at it, invoke once, fail if the run fails.

The bucket is versioned, so each run leaves the previous file as a
noncurrent version: about 2,900 a month at under 1 KB each. Either keep them
as a record of network health over time, or add a
`compliance-noncurrent-expire` lifecycle rule in mco-aws
`stacks/mco-mesonet-bucket`, as `air-quality/` and `power/` have.

## Releases

SemVer on `RULESET_VERSION` and the git tag together. A change that can move
any count is MAJOR. A new summary field is MINOR. A tag is never moved.

## Licence

MIT, as the office's other public repos. See `LICENSE`.
