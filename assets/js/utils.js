/**
 * Shared pure utilities for the ZIP Locale explorer and site.
 * No DOM access — safe to unit test and reuse anywhere.
 */

const RE_ZIP = /^\d{5}$/;
const RE_STATE = /^[A-Z]{2}$/;

/** Normalize search input: trim, uppercase, collapse spaces. */
function normalizeQuery(q) {
  return (q || "").trim().replace(/\s+/g, " ").toUpperCase();
}

/** Match a record against a normalized query. */
function matchRecord(record, query) {
  if (!query) return true;

  const fields = [
    record.area_name,
    record.area_code,
    record.district_name,
    record.district_no,
    record.delivery_zipcode,
    record.locale_name,
    record.physical_city,
    record.physical_state,
    record.physical_zip,
    record.physical_zip4,
    record.locale_key,
  ].filter(v => v != null && v !== "");

  const text = " " + fields.join(" ").toUpperCase() + " ";

  if (RE_ZIP.test(query)) {
    const zip = String(record.delivery_zipcode || "");
    if (zip.startsWith(query)) return true;
    if (String(record.physical_zip || "") === query) return true;
    if (String(record.physical_zip4 || "") === query) return true;
  }

  if (RE_STATE.test(query) && record.physical_state === query) return true;

  return text.includes(query);
}

/** Sort records by a key. Handles numeric strings like ZIPs correctly. */
function sortRecords(records, key, dir) {
  const factor = dir === "desc" ? -1 : 1;
  const getVal = r => (r[key] == null ? "" : String(r[key]));

  return [...records].sort((a, b) => {
    const av = getVal(a);
    const bv = getVal(b);

    if (av !== "" && bv !== "" && !isNaN(Number(av)) && !isNaN(Number(bv))) {
      return (Number(av) - Number(bv)) * factor;
    }
    return av.localeCompare(bv, "en", { numeric: true }) * factor;
  });
}

/** Paginate a sorted array. Returns { page, totalPages, total, items }. */
function paginate(records, page, perPage) {
  const total = records.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * perPage;
  return {
    page: safePage,
    totalPages,
    total,
    items: records.slice(start, start + perPage),
  };
}

/** Format a number with thousands separators. */
function fmt(n) {
  return Number(n).toLocaleString("en-US");
}

/** Format a byte count. */
function fmtBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human-friendly relative time from an ISO string. */
function timeAgo(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Build a page-number window around the current page. */
function pageWindow(page, totalPages, span = 2) {
  const pages = [];
  for (let p = page - span; p <= page + span; p++) {
    if (p >= 1 && p <= totalPages) pages.push(p);
  }
  return pages;
}

/** Debounce a function. */
function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Escape HTML in a string (for safe rendering of data). */
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Serialize records as RFC 4180 CSV. */
function toCsv(records, fields) {
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

export const ZLP_UTILS = {
  normalizeQuery,
  matchRecord,
  sortRecords,
  paginate,
  fmt,
  fmtBytes,
  timeAgo,
  pageWindow,
  debounce,
  esc,
  toCsv,
};
