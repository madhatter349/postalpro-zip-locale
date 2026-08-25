/**
 * Shared utilities for the ZIP Locale explorer.
 * Pure functions — no DOM. Importable as an ES module.
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
  ].filter(v => v != null && v !== "");

  const text = " " + fields.join(" ").toUpperCase() + " ";

  if (RE_ZIP.test(query)) {
    // Leading 3-5 digit match on delivery ZIP (e.g. "100" matches 10001)
    if (query.length >= 3) {
      const zip = String(record.delivery_zipcode || "");
      if (zip.startsWith(query)) return true;
    }
    // Exact ZIP+4 or zip4 match
    if (String(record.delivery_zipcode || "") === query) return true;
    if (String(record.physical_zip || "") === query) return true;
    if (String(record.physical_zip4 || "") === query) return true;
  }

  if (RE_STATE.test(query)) {
    if (record.physical_state === query) return true;
  }

  // Substring across all fields
  return text.includes(query);
}

/** Sort records by a key. Handles numeric strings like ZIPs correctly. */
function sortRecords(records, key, dir) {
  const factor = dir === "desc" ? -1 : 1;
  const getVal = r => (r[key] == null ? "" : String(r[key]));

  return [...records].sort((a, b) => {
    const av = getVal(a);
    const bv = getVal(b);

    // Numeric comparison when both look numeric
    if (av !== "" && bv !== "" && !isNaN(Number(av)) && !isNaN(Number(bv))) {
      return (Number(av) - Number(bv)) * factor;
    }
    return av.localeCompare(bv, "en", { numeric: true }) * factor;
  });
}

/** Paginate a sorted array. Returns { page, totalPages, items }. */
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

export const ZLP_UTILS = {
  normalizeQuery,
  matchRecord,
  sortRecords,
  paginate,
  fmt,
  pageWindow,
  debounce,
  esc,
};
