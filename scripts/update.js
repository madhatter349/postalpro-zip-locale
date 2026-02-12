import axios from "axios";
import cheerio from "cheerio";
import fs from "fs";
import path from "path";
import XLSX from "xlsx";

const BASE_URL = "https://postalpro.usps.com";
const PAGE_URL = `${BASE_URL}/ZIP_Locale_Detail`;

async function main() {
  console.log("Fetching USPS page…");
  const html = await axios.get(PAGE_URL).then(r => r.data);

  const $ = cheerio.load(html);

  const link = $("a[href$='ZIP_Locale_Detail.xls']").attr("href");
  if (!link) {
    throw new Error("Download link not found");
  }

  const fileUrl = link.startsWith("http") ? link : `${BASE_URL}${link}`;
  console.log("Found XLS:", fileUrl);

  console.log("Downloading XLS…");
  const xlsBuffer = await axios.get(fileUrl, {
    responseType: "arraybuffer"
  }).then(r => r.data);

  const workbook = XLSX.read(xlsBuffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  const rows = XLSX.utils.sheet_to_json(sheet, {
    defval: null
  });

  console.log(`Parsed ${rows.length} rows`);

  const output = rows.map(r => ({
    area_name: r["AREA NAME"],
    area_code: r["AREA CODE"],
    district_name: r["DISTRICT NAME"],
    district_no: r["DISTRICT NO"],
    delivery_zipcode: r["DELIVERY ZIPCODE"],
    locale_name: r["LOCALE NAME"],
    physical_address: r["PHYSICAL DELV ADDR"],
    physical_city: r["PHYSICAL CITY"],
    physical_state: r["PHYSICAL STATE"],
    physical_zip: r["PHYSICAL ZIP"],
    physical_zip4: r["PHYSICAL ZIP 4"]
  }));

  const outPath = path.resolve("data/zip_locale_detail.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log("JSON written:", outPath);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
