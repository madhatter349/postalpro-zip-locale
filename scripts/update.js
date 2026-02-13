import * as axiosPkg from "axios";
import * as cachePkg from "axios-cache-interceptor";
import * as cheerio from "cheerio";
import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";

/* ------------------------------------------------------------------ */
/* setup                                                              */
/* ------------------------------------------------------------------ */

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = "https://postalpro.usps.com";
const PAGE_URL = `${BASE_URL}/ZIP_Locale_Detail`;

const OUTPUT_ALL = path.resolve(__dirname, "../data/zip_locale_detail.json");
const OUTPUT_STATES_DIR = path.resolve(__dirname, "../data/states");
const LAST_UPDATED_FILE = path.resolve(__dirname, "../data/last_updated.txt");

/* ------------------------------------------------------------------ */
/* http client with cache                                              */
/* ------------------------------------------------------------------ */

const axios = axiosPkg.default ?? axiosPkg;
const setupCache = cachePkg.setupCache;

const http = setupCache(axios.create(), {
  ttl: 1000 * 60 * 60 * 6,
  interpretHeader: true,
  staleIfError: true
});

/* ------------------------------------------------------------------ */
/* main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("Fetching USPS ZIP Locale Detail page");

  const pageRes = await http.get(PAGE_URL);
  const $ = cheerio.load(pageRes.data);

  /* ------------------------------------------------------------------ */
  /* check last-updated date on the page                                */
  /* ------------------------------------------------------------------ */

  // The date sits in a .mb-2 div right above the download link.
  // Target it via the sibling relationship to avoid other .mb-2 elements.
  const pageDateText = $("a[href$='ZIP_Locale_Detail.xls']")
    .closest("div")
    .find(".mb-2")
    .first()
    .text()
    .trim();

  const pageDate = pageDateText ? new Date(pageDateText) : null;

  if (!pageDate || isNaN(pageDate.getTime())) {
    console.warn("Could not parse page date from:", pageDateText || "(empty)");
    console.log("Proceeding with update anyway");
  } else {
    console.log("Page last updated:", pageDateText);

    let lastKnownDate = null;
    if (fs.existsSync(LAST_UPDATED_FILE)) {
      const stored = fs.readFileSync(LAST_UPDATED_FILE, "utf8").trim();
      lastKnownDate = new Date(stored);
    }

    if (lastKnownDate && !isNaN(lastKnownDate.getTime()) && pageDate.getTime() <= lastKnownDate.getTime()) {
      console.log("No new data — page date matches stored date. Skipping.");
      return;
    }
  }

  /* ------------------------------------------------------------------ */
  /* download XLS                                                       */
  /* ------------------------------------------------------------------ */

  const relativeLink = $("a[href$='ZIP_Locale_Detail.xls']").attr("href");
  if (!relativeLink) {
    throw new Error("ZIP_Locale_Detail.xls link not found");
  }

  const fileUrl = relativeLink.startsWith("http")
    ? relativeLink
    : `${BASE_URL}${relativeLink}`;

  console.log("Found XLS link:", fileUrl);

  console.log("Downloading XLS");
  const xlsRes = await http.get(fileUrl, { responseType: "arraybuffer" });

  const workbook = XLSX.read(xlsRes.data, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: null,
    raw: false
  });

  console.log(`Parsed ${rows.length} rows`);

  /* ------------------------------------------------------------------ */
  /* normalize rows (unchanged schema)                                  */
  /* ------------------------------------------------------------------ */

  const normalized = rows.map(r => ({
    area_name: r["AREA NAME"],
    area_code: r["AREA CODE"],
    district_name: r["DISTRICT NAME"],
    district_no: r["DISTRICT NO"],
    delivery_zipcode: r["DELIVERY ZIPCODE"],
    locale_name: r["LOCALE NAME"],
    physical_delivery_address: r["PHYSICAL DELV ADDR"],
    physical_city: r["PHYSICAL CITY"],
    physical_state: r["PHYSICAL STATE"],
    physical_zip: r["PHYSICAL ZIP"],
    physical_zip4: r["PHYSICAL ZIP 4"]
  }));

  /* ------------------------------------------------------------------ */
  /* write full file (unchanged)                                        */
  /* ------------------------------------------------------------------ */

  fs.mkdirSync(path.dirname(OUTPUT_ALL), { recursive: true });
  fs.writeFileSync(OUTPUT_ALL, JSON.stringify(normalized, null, 2), "utf8");

  console.log("Wrote full ZIP dataset:", OUTPUT_ALL);

  /* ------------------------------------------------------------------ */
  /* split by state                                                     */
  /* ------------------------------------------------------------------ */

  fs.mkdirSync(OUTPUT_STATES_DIR, { recursive: true });

  const byState = {};

  for (const row of normalized) {
    const state = row.physical_state || "UNKNOWN";
    if (!byState[state]) byState[state] = [];
    byState[state].push(row);
  }

  for (const [state, entries] of Object.entries(byState)) {
    const filePath = path.join(OUTPUT_STATES_DIR, `${state}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2), "utf8");
  }

  console.log(`Wrote ${Object.keys(byState).length} state files`);

  /* ------------------------------------------------------------------ */
  /* save last-updated date                                             */
  /* ------------------------------------------------------------------ */

  if (pageDate && !isNaN(pageDate.getTime())) {
    fs.writeFileSync(LAST_UPDATED_FILE, pageDateText, "utf8");
    console.log("Saved last-updated date:", pageDateText);
  }
}

/* ------------------------------------------------------------------ */
/* run                                                                */
/* ------------------------------------------------------------------ */

main().catch(err => {
  console.error("Update failed");
  console.error(err);
  process.exit(1);
});
