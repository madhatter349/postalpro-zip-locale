# USPS ZIP Locale Detail — open mirror

[![Update workflow](https://github.com/madhatter349/postalpro-zip-locale/actions/workflows/update.yml/badge.svg)](https://github.com/madhatter349/postalpro-zip-locale/actions/workflows/update.yml)
[![CI](https://github.com/madhatter349/postalpro-zip-locale/actions/workflows/ci.yml/badge.svg)](https://github.com/madhatter349/postalpro-zip-locale/actions/workflows/ci.yml)

Auto-updated **JSON / CSV / SQLite** mirror of the [USPS PostalPro ZIP Locale Detail](https://postalpro.usps.com/ZIP_Locale_Detail) dataset. Updated daily via GitHub Actions and served as a free, open API through GitHub Pages — no server, no auth, no rate limits.

**Live API:** https://madhatter349.github.io/postalpro-zip-locale/
**Human docs + explorer:** https://madhatter349.github.io/postalpro-zip-locale/

## What this gives you

- **4 output formats** — JSON, per-state JSON, RFC 4180 CSV, and a single-file SQLite database.
- **Change sets** — `changes.json` tells you exactly which records were added, removed, or changed between USPS publishes, so you can sync incrementally instead of re-downloading 15 MB.
- **Provenance** — every publish records the source URL, byte size, Last-Modified, USPS publish date, and a SHA-256 of the exact upstream file (`source.json`, `index.json`).
- **Health** — `health.json` reports the last run result and flips to `error` if an update fails, so staleness is detectable programmatically.
- **Validation** — the updater refuses to write a dataset that fails sanity checks (row count, ZIP format, required fields, state coverage), and the test suite verifies every committed artifact in CI.
- **Machine-readable specs** — `data/schema.json` (JSON Schema 2020-12) and `openapi.json` (OpenAPI 3.1).
- **Resilient scraping** — retries with backoff, tolerant `.xls`/`.xlsx` link discovery, conditional HTTP requests, and SHA-256 change detection even when USPS replaces a file without bumping its published date.

## Endpoints

**Base URL:** `https://madhatter349.github.io/postalpro-zip-locale`

| Endpoint | Description |
|---|---|
| `/data/zip_locale_detail.json` | Full dataset (all records, ~18 MB) |
| `/data/states/{CODE}.json` | Single state/territory, e.g. `/data/states/NY.json` |
| `/data/index.json` | Lightweight index: area codes, kinds, counts, freshness, provenance |
| `/data/health.json` | Last update run result and mirror health |
| `/data/changes.json` | Added / removed / changed records since the previous publish |
| `/data/history.json` | One entry per data-updating run (up to 400) |
| `/data/source.json` | Upstream URL, SHA-256, size, `Last-Modified`, publish date |
| `/data/zip_index.json` | 37k-entry ZIP → state lookup map (values are a code, or an array when a ZIP spans states) |
| `/data/schema.json` | JSON Schema for every artifact |
| `/openapi.json` | OpenAPI 3.1 description of this API |
| `/data/csv/zip_locale_detail.csv` | Full dataset as CSV |
| `/data/csv/{CODE}.csv` | Per-state CSV, e.g. `/data/csv/NY.csv` |
| `/data/zip_locale_detail.sqlite` | SQLite database (`records` + `meta` tables, indexed) |
| `/data/last_updated.txt` | Date USPS last published new data |
| `/data/last_checked.txt` | ISO timestamp of the last successful verification |

All responses include `Access-Control-Allow-Origin: *`, so browser clients work out of the box.

Codes are 2-letter USPS abbreviations, uppercase. The dataset covers **50 states, Washington DC, 5 territories, and 3 freely associated states**, plus an `UNKNOWN` bucket for the rare upstream row with no state. `index.json` classifies each code via a `kind` field (`state` / `district` / `territory` / `federated` / `other`).

## Example usage

```javascript
// Fetch all California ZIP locale records
fetch('https://madhatter349.github.io/postalpro-zip-locale/data/states/CA.json')
  .then(r => r.json())
  .then(data => console.log(data.length, 'records'));
```

```python
import requests

data = requests.get(
    'https://madhatter349.github.io/postalpro-zip-locale/data/states/NY.json'
).json()

for record in data[:5]:
    print(record['delivery_zipcode'], record['locale_name'])
```

```python
# Incremental sync: pull only what changed since your last snapshot
changes = requests.get(
    'https://madhatter349.github.io/postalpro-zip-locale/data/changes.json'
).json()
print(changes['added'], 'added,', changes['removed'], 'removed,', changes['changed'], 'changed')
```

```sql
-- SQLite: download data/zip_locale_detail.sqlite, then query offline
SELECT physical_city, COUNT(*) AS n
FROM records
WHERE delivery_zipcode LIKE '100%'
GROUP BY physical_city
ORDER BY n DESC
LIMIT 10;
```

## Record schema

Each record contains:

| Field | Type | Description |
|---|---|---|
| `area_name` | string \| null | USPS area name |
| `area_code` | string \| null | USPS area code (`4B`/`4E`/`4G`/`4J`). Derived from `area_name` since the Sep 2026 source dropped the column |
| `district_name` | string \| null | USPS district name |
| `district_no` | string \| null | USPS district number |
| `delivery_zipcode` | string | 5-digit delivery ZIP code |
| `locale_name` | string \| null | Post office / locale name |
| `physical_delivery_address` | string \| null | Street address of the delivery unit |
| `physical_city` | string \| null | City |
| `physical_state` | string \| null | 2-letter state code |
| `physical_zip` | string \| null | Physical location ZIP |
| `physical_zip4` | string \| null | ZIP+4 extension |
| `zip_class_code` | string \| null | USPS ZIP class code (added Sep 2026) |
| `locale_key` | string \| null | USPS locale key (added Sep 2026) |
| `locale_type` | string \| null | USPS locale type (added Sep 2026) |

Schema changes are additive: fields may be added, but existing fields are never removed or retyped. The canonical definition lives in [`data/schema.json`](data/schema.json).

## How it works

1. **Scrape** — fetches the PostalPro page and extracts the download link (`.xls` or `.xlsx`) and published date.
2. **Detect changes** — sends a conditional request (`If-Modified-Since`) and compares the SHA-256 of the file against the stored hash. A change triggers an update if *either* the published date or the file bytes changed, so silent upstream replacements are caught.
3. **Parse** — reads the first sheet with SheetJS, maps column aliases across schema versions, trims whitespace, normalizes ZIPs, and derives `area_code` when USPS omits it.
4. **Validate** — refuses to write if the parse looks wrong (too few rows, invalid ZIPs, blank locales, implausible state coverage).
5. **Write** — outputs full + per-state JSON, full + per-state CSV, a SQLite database, `index.json`, `source.json`, `changes.json`, `history.json`, `health.json`, and the freshness files.
6. **Commit** — GitHub Actions commits any changes back to `main`, which triggers a Pages rebuild. If the run fails, a follow-up step records the failure in `health.json`.

The heartbeat (`last_checked.txt`) keeps the scheduled workflow enabled, and `changes.json`/`history.json` give consumers a stable way to track dataset evolution.

## Project structure

```
├── .github/
│   ├── workflows/update.yml       # Daily cron + failure reporting
│   ├── workflows/ci.yml           # Syntax, tests, dependency audit
│   └── dependabot.yml             # Weekly dependency + actions updates
├── scripts/update.js              # Scraper, parser, validator, writers
├── scripts/record-failure.js      # Writes health.json on failed runs
├── test/update.test.js            # Unit tests for the pure helpers
├── test/data.test.js              # Artifact consistency tests
├── assets/                        # Static site
│   ├── css/theme.css              # Design system (dark/light)
│   └── js/                        # main / explorer / live / palette / theme / ui / utils
├── data/
│   ├── zip_locale_detail.json     # Full dataset (generated)
│   ├── zip_locale_detail.sqlite   # SQLite database (generated)
│   ├── index.json                 # Codes + counts + freshness (generated)
│   ├── zip_index.json             # ZIP → state lookup, ~470 KB (generated)
│   ├── health.json                # Last run status (generated)
│   ├── changes.json               # Latest diff (generated)
│   ├── history.json               # Run history (generated)
│   ├── source.json                # Upstream provenance (generated)
│   ├── schema.json                # JSON Schema (hand-written)
│   ├── last_updated.txt           # USPS publish date (generated)
│   ├── last_checked.txt           # Last verification time (generated)
│   ├── csv/                       # Full + per-state CSV (generated)
│   └── states/                    # Per-state JSON (generated)
├── openapi.json                   # OpenAPI 3.1 description
├── index.html                     # API docs + interactive explorer
├── robots.txt                     # Crawler policy
├── sitemap.xml                    # Sitemap
└── package.json
```

The explorer loads nothing until you pick a state or start typing — searching streams the state files in small batches, then caches them per dataset generation. `?state=NY&q=brooklyn` deep links work. The page also ships a command palette (`⌘K` / `Ctrl+K`), an instant ZIP lookup, a live response playground, and a light/dark theme that follows your OS.

## Running locally

```bash
git clone https://github.com/madhatter349/postalpro-zip-locale.git
cd postalpro-zip-locale
npm install
npm run update   # regenerate every artifact
npm test         # validate the generated artifacts
```

Then open `index.html` in a browser, or serve with any static server:

```bash
python3 -m http.server 8000
```

Requires Node.js 22+.

## Testing

```bash
npm test    # unit + data consistency tests
npm run check  # syntax-check every JS module
```

CI runs the same checks on every push and pull request, plus `npm audit --audit-level=high`.

## Data source, license, and citation

All data comes from the USPS PostalPro [ZIP Locale Detail](https://postalpro.usps.com/ZIP_Locale_Detail) page. This project mirrors and reformats it — USPS is the authoritative source. Not affiliated with USPS.

Code and mirrored data in this repository are licensed under the [Apache License 2.0](LICENSE). See [`CITATION.cff`](CITATION.cff) for citation metadata.
