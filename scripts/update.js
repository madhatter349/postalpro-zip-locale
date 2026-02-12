import axios from "axios";
import { setupCache } from "axios-cache-interceptor";
import cheerio from "cheerio";
import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/* ------------------------------------------------------------------ */
/* setup                                                              */
/* ------------------------------------------------------------------ */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = "https://postalpro.usps.com";
const PAGE_URL = `${BASE_URL}/ZIP_Locale_Detail`;

const OUTPUT_PATH = path.resolve(__dirname, "../data/zip_locale_detail.json");

/* ------------------------------------------------------------------ */
/* http client with cache                                              */
/* ------------------------------------------------------------------ */

const http = setupCache(axios.create(), {
  ttl: 1000 * 60 * 60 * 6,        // 6 hours
  interpretHeader: true,          // respect ETag / Last-Modified
  staleIfError: true
});

/* ------------------------------------------------------------------ */
/* main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("Fetching USPS ZIP Locale Detail page");

  const pageRes = await http.get(PAGE_URL);
  const $ = cheerio.load(pageRes.data);

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
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: null,
    raw: false
  });

  console.log(`Parsed ${rows.length} rows`);

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

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(normalized, null, 2),
    "utf8"
  );

  console.log("Wrote JSON:", OUTPUT_PATH);
}

/* ------------------------------------------------------------------ */
/* run                                                                */
/* ------------------------------------------------------------------ */

main().catch(err => {
  console.error("Update failed");
  console.error(err);
  process.exit(1);
});
