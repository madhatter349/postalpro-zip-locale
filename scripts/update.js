/**
 * Update the USPS ZIP Locale Detail mirror.
 *
 * Pipeline:
 *   1. Scrape the PostalPro page for the download link and published date.
 *   2. Use a conditional HTTP request + SHA-256 hash to detect real changes
 *      (USPS sometimes replaces the file without bumping the date).
 *   3. Parse the spreadsheet (xls or xlsx), normalize, and validate it.
 *   4. Write JSON (full + per state), CSV, and SQLite outputs, plus
 *      index/health/changes/history metadata files.
 *
 * Pure helpers are exported so they can be unit tested (see test/).
 */

import * as cheerio from "cheerio";
import * as XLSX from "xlsx";
import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";
import * as crypto from "crypto";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

/* ------------------------------------------------------------------ */
/* configuration                                                      */
/* ------------------------------------------------------------------ */

export const BASE_URL = "https://postalpro.usps.com";
export const PAGE_URL = `${BASE_URL}/ZIP_Locale_Detail`;
const DOWNLOAD_RE = /ZIP_Locale_Detail\.xlsx?$/i;
const USER_AGENT =
  "postalpro-zip-locale (+https://github.com/madhatter349/postalpro-zip-locale)";

const OUTPUT_ALL = path.join(DATA_DIR, "zip_locale_detail.json");
const OUTPUT_STATES_DIR = path.join(DATA_DIR, "states");
const OUTPUT_CSV_DIR = path.join(DATA_DIR, "csv");
const OUTPUT_SQLITE = path.join(DATA_DIR, "zip_locale_detail.sqlite");
const OUTPUT_INDEX = path.join(DATA_DIR, "index.json");
const OUTPUT_HEALTH = path.join(DATA_DIR, "health.json");
const OUTPUT_CHANGES = path.join(DATA_DIR, "changes.json");
const OUTPUT_HISTORY = path.join(DATA_DIR, "history.json");
const OUTPUT_SOURCE = path.join(DATA_DIR, "source.json");
const LAST_UPDATED_FILE = path.join(DATA_DIR, "last_updated.txt");
const LAST_CHECKED_FILE = path.join(DATA_DIR, "last_checked.txt");

/** Minimum plausible row count. Guards against partial/empty parses. */
const MIN_ROWS = 35000;
/** Maximum number of full record details written to changes.json. */
const MAX_DIFF_DETAILS = 5000;
/** Maximum number of runs retained in history.json. */
const MAX_HISTORY = 400;

const FETCH_TIMEOUT_MS = 60_000;
const FETCH_RETRIES = 3;

/** Legacy area code map — the source dropped AREA CODE in Sep 2026. */
export const AREA_CODES = {
  ATLANTIC: "4B",
  CENTRAL: "4J",
  SOUTHERN: "4G",
  WESTPAC: "4E",
};

const KIND = {
  AK: "state", AL: "state", AR: "state", AZ: "state", CA: "state", CO: "state",
  CT: "state", DE: "state", FL: "state", GA: "state", HI: "state", IA: "state",
  ID: "state", IL: "state", IN: "state", KS: "state", KY: "state", LA: "state",
  MA: "state", MD: "state", ME: "state", MI: "state", MN: "state", MO: "state",
  MS: "state", MT: "state", NC: "state", ND: "state", NE: "state", NH: "state",
  NJ: "state", NM: "state", NV: "state", NY: "state", OH: "state", OK: "state",
  OR: "state", PA: "state", RI: "state", SC: "state", SD: "state", TN: "state",
  TX: "state", UT: "state", VA: "state", VT: "state", WA: "state", WI: "state",
  WV: "state", WY: "state",
  DC: "district",
  AS: "territory", GU: "territory", PR: "territory", VI: "territory", MP: "territory",
  FM: "federated", MH: "federated", PW: "federated",
};

export const CSV_FIELDS = [
  "area_name",
  "area_code",
  "district_name",
  "district_no",
  "delivery_zipcode",
  "locale_name",
  "physical_delivery_address",
  "physical_city",
  "physical_state",
  "physical_zip",
  "physical_zip4",
  "zip_class_code",
  "locale_key",
  "locale_type",
];

/** Source header aliases, newest first. */
const FIELD_ALIASES = {
  area_name: ["AREA NAME"],
  area_code: ["AREA CODE"],
  district_name: ["DISTRICT NAME"],
  district_no: ["DISTRICT NO"],
  delivery_zipcode: ["DELIVERY ZIPCODE", "ZIP CODE"],
  locale_name: ["LOCALE NAME"],
  physical_delivery_address: ["PHYSICAL DELV ADDR", "PHYSICAL DELIVERY ADDRESS"],
  physical_city: ["PHYSICAL CITY"],
  physical_state: ["PHYSICAL STATE"],
  physical_zip: ["PHYSICAL ZIP"],
  physical_zip4: ["PHYSICAL ZIP 4", "PHYSICAL ZIP4"],
  zip_class_code: ["ZIP CLASS CODE"],
  locale_key: ["LOCALE KEY"],
  locale_type: ["LOCALE TYPE"],
};

/* ------------------------------------------------------------------ */
/* small helpers                                                      */
/* ------------------------------------------------------------------ */

const nowIso = () => new Date().toISOString();

function log(...args) {
  console.log("[update]", ...args);
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value, pretty = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeFileAtomic(file, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value));
}

function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function sha256Of(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/** Clean a spreadsheet cell: trim, collapse blanks to null. */
export function cleanCell(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/** Normalize a ZIP-ish string to digits, left-padded where needed. */
function cleanZip(value, width = 5) {
  const s = cleanCell(value);
  if (s == null) return null;
  const digits = s.replace(/\D/g, "");
  if (digits === "") return null;
  return digits.padStart(width, "0");
}

/* ------------------------------------------------------------------ */
/* page parsing                                                       */
/* ------------------------------------------------------------------ */

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/**
 * Parse USPS's "September 08, 2026" style date.
 * Returns { display, iso, date } or null.
 */
export function parsePageDate(text) {
  const raw = (text || "").trim();
  if (!raw) return null;

  const m = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!m) return null;

  const month = MONTHS[m[1].toLowerCase()];
  if (month == null) return null;

  const day = Number(m[2]);
  const year = Number(m[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { display: raw, iso: date.toISOString().slice(0, 10), date };
}

/** Find the spreadsheet download anchor, tolerating .xls and .xlsx. */
export function findDownloadLink($) {
  const candidates = $("a[href]").filter((_, el) => {
    const href = $(el).attr("href") || "";
    return DOWNLOAD_RE.test(href);
  });

  if (!candidates.length) {
    const hrefs = $("a[href]")
      .map((_, el) => $(el).attr("href"))
      .get()
      .filter(Boolean)
      .slice(0, 25);
    throw new Error(
      `ZIP_Locale_Detail download link not found. Candidate hrefs: ${hrefs.join(", ") || "(none)"}`
    );
  }

  const href = candidates.first().attr("href");
  const absolute = href.startsWith("http") ? href : `${BASE_URL}${href}`;
  return { href, url: absolute };
}

/** Pull the published date near the download link, with fallbacks. */
export function findDateText($, link) {
  if (link) {
    const near = $(`a[href="${link.href}"]`)
      .closest("div")
      .find(".mb-2")
      .first()
      .text()
      .trim();
    if (parsePageDate(near)) return near;
  }

  for (const el of $(".mb-2").toArray()) {
    const text = $(el).text().trim();
    if (parsePageDate(text)) return text;
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* HTTP                                                               */
/* ------------------------------------------------------------------ */

async function fetchWithRetry(url, options = {}, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      redirect: "follow",
      ...options,
      headers: { "user-agent": USER_AGENT, ...(options.headers || {}) },
      signal: controller.signal,
    });

    const allowed = options.allowStatuses || [];
    if (!res.ok && !allowed.includes(res.status)) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return res;
  } catch (err) {
    if (attempt < FETCH_RETRIES) {
      const delay = 1500 * attempt;
      log(`fetch failed (${err.message}) — retrying in ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* normalization + validation                                         */
/* ------------------------------------------------------------------ */

function pickField(row, aliases) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias];
  }
  return null;
}

/** Convert raw sheet rows into the public record schema. */
export function normalizeRows(rows) {
  return rows
    .map(raw => {
      const areaName = cleanCell(pickField(raw, FIELD_ALIASES.area_name));
      const areaCode =
        cleanCell(pickField(raw, FIELD_ALIASES.area_code)) ||
        (areaName ? AREA_CODES[areaName.toUpperCase()] || null : null);

      return {
        area_name: areaName,
        area_code: areaCode,
        district_name: cleanCell(pickField(raw, FIELD_ALIASES.district_name)),
        district_no: cleanCell(pickField(raw, FIELD_ALIASES.district_no)),
        delivery_zipcode: cleanZip(pickField(raw, FIELD_ALIASES.delivery_zipcode), 5),
        locale_name: cleanCell(pickField(raw, FIELD_ALIASES.locale_name)),
        physical_delivery_address: cleanCell(pickField(raw, FIELD_ALIASES.physical_delivery_address)),
        physical_city: cleanCell(pickField(raw, FIELD_ALIASES.physical_city)),
        physical_state: (cleanCell(pickField(raw, FIELD_ALIASES.physical_state)) || "").toUpperCase() || null,
        physical_zip: cleanZip(pickField(raw, FIELD_ALIASES.physical_zip), 5),
        physical_zip4: cleanZip(pickField(raw, FIELD_ALIASES.physical_zip4), 4),
        zip_class_code: cleanCell(pickField(raw, FIELD_ALIASES.zip_class_code)),
        locale_key: cleanCell(pickField(raw, FIELD_ALIASES.locale_key)),
        locale_type: cleanCell(pickField(raw, FIELD_ALIASES.locale_type)),
      };
    })
    .filter(record => record.delivery_zipcode);
}

/**
 * Validate a normalized dataset. Returns a list of problems; empty means OK.
 */
export function validateRecords(records, expectedStates = 50) {
  const problems = [];

  if (records.length < MIN_ROWS) {
    problems.push(`only ${records.length} rows parsed (minimum ${MIN_ROWS})`);
  }

  const badZip = records.filter(r => !/^\d{5}$/.test(r.delivery_zipcode || ""));
  if (badZip.length) {
    problems.push(`${badZip.length} records with an invalid delivery_zipcode`);
  }

  const blankLocale = records.filter(r => !r.locale_name);
  if (blankLocale.length) {
    problems.push(`${blankLocale.length} records with a blank locale_name`);
  }

  const badState = records.filter(
    r => r.physical_state != null && !/^[A-Z]{2}$/.test(r.physical_state)
  );
  if (badState.length) {
    problems.push(`${badState.length} records with an invalid physical_state`);
  }

  const states = new Set(records.map(r => r.physical_state).filter(Boolean));
  if (states.size < expectedStates) {
    problems.push(`only ${states.size} distinct states parsed (minimum ${expectedStates})`);
  }

  return problems;
}

/* ------------------------------------------------------------------ */
/* diffing                                                            */
/* ------------------------------------------------------------------ */

export function recordKey(record) {
  return [
    record.delivery_zipcode,
    record.locale_name,
    record.physical_zip4 ?? "",
    record.physical_state ?? "",
  ].join("|");
}

/** Diff two datasets by record key. Detail arrays are capped. */
export function diffDatasets(before, after) {
  const beforeMap = new Map((before || []).map(r => [recordKey(r), r]));
  const afterMap = new Map(after.map(r => [recordKey(r), r]));

  const added = [];
  const removed = [];
  const changed = [];

  // Compare only fields that existed in the previous schema so that
  // additive schema changes aren't reported as data changes.
  const isChanged = (prev, next) =>
    Object.keys(prev).some(
      field => JSON.stringify(prev[field] ?? null) !== JSON.stringify(next[field] ?? null)
    );

  for (const [key, record] of afterMap) {
    const prev = beforeMap.get(key);
    if (!prev) {
      added.push(record);
    } else if (isChanged(prev, record)) {
      changed.push({ key, before: prev, after: record });
    }
  }

  for (const [key, record] of beforeMap) {
    if (!afterMap.has(key)) removed.push(record);
  }

  const total = added.length + removed.length + changed.length;
  const truncated = total > MAX_DIFF_DETAILS;

  return {
    added: added.length,
    removed: removed.length,
    changed: changed.length,
    truncated,
    added_records: truncated ? added.slice(0, MAX_DIFF_DETAILS) : added,
    removed_records: truncated ? removed.slice(0, MAX_DIFF_DETAILS) : removed,
    changed_records: truncated ? changed.slice(0, MAX_DIFF_DETAILS) : changed,
  };
}

/* ------------------------------------------------------------------ */
/* writers                                                            */
/* ------------------------------------------------------------------ */

/** Serialize records as RFC 4180 CSV. */
export function toCsv(records, fields = CSV_FIELDS) {
  const escape = value => {
    const s = value == null ? "" : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [fields.join(",")];
  for (const record of records) {
    lines.push(fields.map(field => escape(record[field])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** Build a single-file SQLite database for analysts. */
function buildSqlite(records, meta, file) {
  fs.rmSync(file, { force: true });
  const db = new Database(file);
  db.pragma("journal_mode = MEMORY");

  db.exec(`
    CREATE TABLE records (
      area_name TEXT,
      area_code TEXT,
      district_name TEXT,
      district_no TEXT,
      delivery_zipcode TEXT NOT NULL,
      locale_name TEXT,
      physical_delivery_address TEXT,
      physical_city TEXT,
      physical_state TEXT,
      physical_zip TEXT,
      physical_zip4 TEXT,
      zip_class_code TEXT,
      locale_key TEXT,
      locale_type TEXT
    );
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `);

  const insert = db.prepare(`
    INSERT INTO records VALUES
    (@area_name, @area_code, @district_name, @district_no, @delivery_zipcode,
     @locale_name, @physical_delivery_address, @physical_city, @physical_state,
     @physical_zip, @physical_zip4, @zip_class_code, @locale_key, @locale_type)
  `);

  db.transaction(rows => {
    for (const row of rows) insert.run(row);
  })(records);

  db.exec(`
    CREATE INDEX idx_records_zip ON records(delivery_zipcode);
    CREATE INDEX idx_records_state ON records(physical_state);
    CREATE INDEX idx_records_locale ON records(locale_name);
  `);

  const insertMeta = db.prepare("INSERT INTO meta VALUES (?, ?)");
  for (const [key, value] of Object.entries(meta)) {
    if (value == null) continue;
    insertMeta.run(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  db.close();
}

function groupByState(records) {
  const byState = {};
  for (const record of records) {
    const state = record.physical_state || "UNKNOWN";
    (byState[state] ||= []).push(record);
  }
  return byState;
}

function pruneStale(dir, keep) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    const base = path.basename(file, path.extname(file));
    if (!keep.has(base)) {
      fs.rmSync(path.join(dir, file));
      log(`pruned stale file: ${path.relative(ROOT, path.join(dir, file))}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const startedAt = new Date();
  log(`starting ${startedAt.toISOString()}`);

  const previous = readJson(OUTPUT_ALL, null);
  const storedSource = readJson(OUTPUT_SOURCE, null);
  const storedPublished = readText(LAST_UPDATED_FILE);

  const pageRes = await fetchWithRetry(PAGE_URL);
  const pageHtml = await pageRes.text();
  const $ = cheerio.load(pageHtml);
  const link = findDownloadLink($);
  const pageDate = parsePageDate(findDateText($, link));

  log(`published: ${pageDate ? pageDate.display : "unknown"}`);
  log(`download:  ${link.url}`);

  let buffer = null;
  let downloadRes = null;
  let reason = "download URL changed";

  if (!storedSource || storedSource.url !== link.url) {
    if (storedSource) log("stored download URL differs from current page link");
    log("downloading source unconditionally");
    downloadRes = await fetchWithRetry(link.url);
    buffer = Buffer.from(await downloadRes.arrayBuffer());
  } else {
    const headers = storedSource.last_modified
      ? { "If-Modified-Since": storedSource.last_modified }
      : {};

    const probe = await fetchWithRetry(link.url, {
      headers,
      allowStatuses: [304],
    });

    if (probe.status === 304) {
      log("source returned 304 Not Modified");
    } else {
      downloadRes = probe;
      buffer = Buffer.from(await probe.arrayBuffer());
      const sha = sha256Of(buffer);
      const dateMatches = Boolean(
        pageDate && storedPublished && pageDate.iso === storedPublished
      );

      if (storedSource.sha256 === sha && dateMatches) {
        log(`source bytes unchanged (sha256 ${sha.slice(0, 12)}…)`);
        buffer = null;
      } else {
        reason = dateMatches ? "file content changed" : "published date changed";
      }
    }
  }

  const checkedAt = nowIso();

  if (!buffer) {
    writeFileAtomic(LAST_CHECKED_FILE, checkedAt);
    touchIndexHeartbeat(checkedAt);
    writeHealth({
      status: "ok",
      result: "unchanged",
      startedAt,
      checkedAt,
      previous,
      source: storedSource,
      published: pageDate,
    });
    log("no update needed — heartbeat written");
    return;
  }

  log(`update required (${reason}) — parsing workbook`);
  const sha = sha256Of(buffer);

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName =
    workbook.SheetNames.find(name => /detail/i.test(name) && !/unique/i.test(name)) ||
    workbook.SheetNames[0];
  log(`sheet: ${sheetName} (of ${workbook.SheetNames.join(", ")})`);

  const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    defval: null,
    raw: false,
  });

  const records = normalizeRows(rawRows);
  log(`parsed ${rawRows.length} rows → ${records.length} records`);

  const problems = validateRecords(records);
  for (const problem of problems) console.error(`[update] VALIDATION: ${problem}`);
  if (problems.length) {
    throw new Error(`dataset failed validation (${problems.length} problem(s)) — refusing to write`);
  }

  /* ---------------- write the data files ---------------- */

  const generatedAt = nowIso();
  const byState = groupByState(records);
  const stateCodes = Object.keys(byState).sort();
  const uniqueZipcodes = new Set(records.map(r => r.delivery_zipcode)).size;

  writeJson(OUTPUT_ALL, records);
  log(`wrote ${path.relative(ROOT, OUTPUT_ALL)} (${records.length} records)`);

  fs.mkdirSync(OUTPUT_STATES_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_CSV_DIR, { recursive: true });

  for (const [state, entries] of Object.entries(byState)) {
    writeJson(path.join(OUTPUT_STATES_DIR, `${state}.json`), entries);
    writeFileAtomic(path.join(OUTPUT_CSV_DIR, `${state}.csv`), toCsv(entries));
  }
  pruneStale(OUTPUT_STATES_DIR, new Set(stateCodes));
  pruneStale(OUTPUT_CSV_DIR, new Set([...stateCodes, "zip_locale_detail"]));
  log(`wrote ${stateCodes.length} state JSON + CSV files`);

  writeFileAtomic(path.join(OUTPUT_CSV_DIR, "zip_locale_detail.csv"), toCsv(records));
  log("wrote full CSV");

  const source = {
    url: link.url,
    published: pageDate ? pageDate.display : storedPublished,
    published_iso: pageDate ? pageDate.iso : null,
    sha256: sha,
    bytes: buffer.length,
    last_modified: downloadRes?.headers.get("last-modified") || storedSource?.last_modified || null,
    etag: downloadRes?.headers.get("etag") || null,
    fetched_at: generatedAt,
  };

  buildSqlite(
    records,
    {
      generated_at: generatedAt,
      published: source.published,
      published_iso: source.published_iso,
      source_url: source.url,
      source_sha256: source.sha256,
      total_records: records.length,
      unique_zipcodes: uniqueZipcodes,
    },
    OUTPUT_SQLITE
  );
  log("wrote SQLite database");

  /* ---------------- index ---------------- */

  const stateBreakdown = {
    states: 0,
    district: 0,
    territories: 0,
    federated: 0,
    other: 0,
  };
  const BREAKDOWN_KEY = {
    state: "states",
    district: "district",
    territory: "territories",
    federated: "federated",
    other: "other",
  };
  const states = stateCodes.map(code => {
    const kind = KIND[code] || "other";
    stateBreakdown[BREAKDOWN_KEY[kind]] += 1;
    return { state: code, count: byState[code].length, kind };
  });

  const index = {
    schema_version: 2,
    total_records: records.length,
    unique_zipcodes: uniqueZipcodes,
    state_count: states.length,
    last_updated: source.published,
    last_updated_iso: source.published_iso,
    last_checked: checkedAt,
    generated_at: generatedAt,
    source: {
      url: source.url,
      sha256: source.sha256,
      bytes: source.bytes,
      last_modified: source.last_modified,
      published: source.published,
    },
    state_breakdown: stateBreakdown,
    files: {
      full: "data/zip_locale_detail.json",
      csv: "data/csv/zip_locale_detail.csv",
      sqlite: "data/zip_locale_detail.sqlite",
      index: "data/index.json",
      schema: "data/schema.json",
      health: "data/health.json",
      changes: "data/changes.json",
      history: "data/history.json",
      openapi: "openapi.json",
    },
    states,
  };

  writeJson(OUTPUT_INDEX, index);
  log(`wrote index (${states.length} codes, ${uniqueZipcodes} unique ZIPs)`);

  /* ---------------- change log + history ---------------- */

  const diff = diffDatasets(previous, records);
  writeJson(OUTPUT_CHANGES, {
    generated_at: generatedAt,
    from_published: previous ? storedPublished : null,
    to_published: source.published,
    from_total: previous ? previous.length : 0,
    to_total: records.length,
    ...diff,
  });
  log(`changes: +${diff.added} -${diff.removed} ~${diff.changed}${diff.truncated ? " (details truncated)" : ""}`);

  const history = readJson(OUTPUT_HISTORY, []);
  history.push({
    checked_at: generatedAt,
    published: source.published,
    total_records: records.length,
    added: diff.added,
    removed: diff.removed,
    changed: diff.changed,
    sha256: source.sha256,
  });
  writeJson(OUTPUT_HISTORY, history.slice(-MAX_HISTORY));

  /* ---------------- bookkeeping ---------------- */

  writeJson(OUTPUT_SOURCE, source);
  if (source.published) writeFileAtomic(LAST_UPDATED_FILE, source.published);
  writeFileAtomic(LAST_CHECKED_FILE, checkedAt);

  writeHealth({
    status: "ok",
    result: "updated",
    startedAt,
    checkedAt,
    previous,
    source,
    published: pageDate,
    totals: { records: records.length, states: states.length, uniqueZipcodes },
    diff,
  });

  log(`done in ${Date.now() - startedAt.getTime()}ms`);
}

function touchIndexHeartbeat(checkedAt) {
  const index = readJson(OUTPUT_INDEX, null);
  if (!index) return;
  index.last_checked = checkedAt;
  writeJson(OUTPUT_INDEX, index);
}

function writeHealth({
  status,
  result,
  startedAt,
  checkedAt,
  previous,
  source,
  published,
  totals,
  diff,
}) {
  const existing = readJson(OUTPUT_HEALTH, {});
  const total = totals?.records ?? existing.total_records ?? previous?.length ?? null;
  const uniqueZips = totals?.uniqueZipcodes ?? existing.unique_zipcodes ?? null;
  const stateCount = totals?.states ?? existing.state_count ?? null;

  writeJson(OUTPUT_HEALTH, {
    status,
    result,
    started_at: startedAt.toISOString(),
    finished_at: nowIso(),
    duration_ms: Date.now() - startedAt.getTime(),
    last_updated: published?.display || source?.published || existing.last_updated || null,
    last_checked: checkedAt,
    total_records: total,
    state_count: stateCount,
    unique_zipcodes: uniqueZips,
    source: source
      ? {
          url: source.url,
          sha256: source.sha256,
          bytes: source.bytes,
          last_modified: source.last_modified,
          published: source.published,
        }
      : null,
    last_change: diff
      ? { added: diff.added, removed: diff.removed, changed: diff.changed }
      : existing.last_change || null,
    last_error: null,
  });
}

/* run only when invoked directly (not when imported by tests) */
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch(err => {
    console.error("[update] FAILED");
    console.error(err);
    process.exit(1);
  });
}

export { main, fetchWithRetry, writeHealth };
