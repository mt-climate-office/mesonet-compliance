# Montana Mesonet network health (derived product)

| | |
|---|---|
| **Tier** | Derived product: headline counts of which stations are reporting and healthy |
| **Built from** | The Mesonet API: [`/api/v2/stations/`](https://mesonet2.climate.umt.edu/api/v2/stations/?type=json), [`/api/v2/latest/`](https://mesonet2.climate.umt.edu/api/v2/latest/?type=json) and [`/api/v2/elements/?all=true`](https://mesonet2.climate.umt.edu/api/v2/elements/?all=true&type=json) |
| **Built by** | [mesonet-compliance](https://github.com/mt-climate-office/mesonet-compliance) (`src/mesonet-compliance.js`, run by `lambda/handler.js`) |
| **Updated** | Every 15 minutes, at :07, :22, :37 and :52 past the hour |
| **Quality control** | None of its own. It counts stations by fixed rules (below); it does not clean, flag or correct any observation. |
| **For analysis, use** | [`data/`](https://data2.climate.umt.edu/mesonet/data/README.md), level 2, for observations. This file holds counts only. |

One file, about 600 bytes, for headline figures: how many stations there are,
how many are reporting, and how many have every sensor reporting. It holds
counts only, no station names and no observations.

`https://data2.climate.umt.edu/mesonet/compliance/v1/summary.json`

`v1/` is the shape of the file. A change that renames or removes a field gets
a new folder; the old one is not changed in place.

## The rules

- **Stations:** every station in `/stations/` with numeric coordinates.
- **Reporting:** the station's most recent record in `/latest/` is less than
  120 minutes old. At 120 minutes it is stale. A station with no record is
  counted separately.
- **Health**, one class per station:
  - *operational*: reporting, and every expected sensor has a value in the
    latest record;
  - *partial*: reporting, and at least one expected sensor has no value;
  - *outage*: not reporting (stale or no record).

  A station's expected sensors are its list in `/elements/?all=true`. A
  station with no list there has no expected sensors and counts as
  operational.
- **Co-located:** stations whose coordinates match to four decimal places
  (about 11 m) share a site.

## Fields

| Field | Meaning |
|---|---|
| `schema_version` | The shape of this file: `1`, as the folder `v1/` says |
| `ruleset_version` | The version of the rules that produced the counts |
| `generated_at` | When the API was read, in milliseconds since 1970-01-01 UTC |
| `latest_newest` | The newest record time in `/latest/`, in the same units |
| `stations.total` | Stations counted |
| `stations.by_network` | Stations per network (`HydroMet`, `AgriMet`) |
| `stations.colocated_sites` | Sites shared by more than one station |
| `stations.colocated_stations` | Stations at those shared sites |
| `reporting.threshold_minutes` | The reporting threshold, 120 |
| `reporting.reporting`, `.stale`, `.no_record` | Stations in each reporting state |
| `reporting.pct` | Percent of `stations.total` reporting |
| `health.operational`, `.partial`, `.outage` | Stations in each health class |
| `health.unknown_sensor_list` | Stations not in outage that have no sensor list, counted as operational |
| `health.pct` | Percent of `stations.total` in each health class |

Percentages are whole numbers, rounded down, so 100 means every station. The
three health percentages can add up to less than 100, and a class with
stations in it can read 0 (1 station of 253 is 0%). Show the count beside the percent.

If a run fails, the previous file stays. If `generated_at` is more than an
hour old, the summary has stopped updating.

The maintenance visit rules are in the same code, but no maintenance figure is
published here.

## Questions

Montana Climate Office, University of Montana: state.climatologist@umontana.edu
