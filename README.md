# USPS ZIP Locale Detail

Auto-updated JSON mirror of the [USPS PostalPro ZIP Locale Detail](https://postalpro.usps.com/ZIP_Locale_Detail) dataset. Updated daily via GitHub Actions and served as a free, open API through GitHub Pages.

**Live API:** https://madhatter349.github.io/postalpro-zip-locale/

## What This Does

A GitHub Actions workflow runs daily at 6 AM UTC. It scrapes the USPS PostalPro page, checks if the dataset has been updated since the last run, and if so, downloads the `.xls` file, converts it to JSON, splits it by state, and commits the results back to the repo. GitHub Pages serves the JSON files as static endpoints — no server, no auth, no rate limits.

## Endpoints

**Base URL:** `https://madhatter349.github.io/postalpro-zip-locale`

| Endpoint | Description |
|---|---|
| `/data/zip_locale_detail.json` | Full dataset (all states, all records) |
| `/data/states/{STATE}.json` | Single state, e.g. `/data/states/NY.json` |
| `/data/last_updated.txt` | Date USPS last published new data |

State codes are 2-letter abbreviations, uppercase.

## Example Usage

```javascript
// Fetch all California ZIP locale records
fetch('https://madhatter349.github.io/postalpro-zip-locale/data/states/CA.json')
  .then(r => r.json())
  .then(data => console.log(data.length, 'records'))
```

```python
import requests

data = requests.get(
    'https://madhatter349.github.io/postalpro-zip-locale/data/states/NY.json'
).json()

for record in data[:5]:
    print(record['delivery_zipcode'], record['locale_name'])
```

## Record Schema

Each record contains:

| Field | Description |
|---|---|
| `area_name` | USPS area name |
| `area_code` | USPS area code |
| `district_name` | USPS district name |
| `district_no` | USPS district number |
| `delivery_zipcode` | 5-digit delivery ZIP code |
| `locale_name` | Post office / locale name |
| `physical_delivery_address` | Street address of the post office |
| `physical_city` | City |
| `physical_state` | 2-letter state code |
| `physical_zip` | Physical location ZIP |
| `physical_zip4` | ZIP+4 extension (nullable) |

## How It Works

1. **Scrape** — Fetches the PostalPro page and extracts the last-updated date
2. **Compare** — Checks the date against `data/last_updated.txt`. If unchanged, exits early
3. **Download** — Grabs the `.xls` file linked on the page
4. **Parse** — Reads the spreadsheet with [SheetJS](https://sheetjs.com/) and normalizes column names
5. **Write** — Outputs `zip_locale_detail.json` (full) and individual `states/{STATE}.json` files
6. **Commit** — GitHub Actions commits any changes back to `main`, which triggers a Pages rebuild

## Project Structure

```
├── .github/workflows/update.yml   # Daily cron job
├── scripts/update.js              # Scraper + parser
├── data/
│   ├── zip_locale_detail.json     # Full dataset (generated)
│   ├── last_updated.txt           # USPS publish date (generated)
│   └── states/                    # Per-state JSON files (generated)
│       ├── AL.json
│       ├── AK.json
│       └── ...
├── index.html                     # API docs landing page
└── package.json
```

## Running Locally

```bash
git clone https://github.com/madhatter349/postalpro-zip-locale.git
cd postalpro-zip-locale
npm install
npm run update
```

Requires Node.js 20+.

## Data Source

All data comes from the USPS PostalPro [ZIP Locale Detail](https://postalpro.usps.com/ZIP_Locale_Detail) page. This project just mirrors and reformats it — USPS is the authoritative source.
