/**
 * Live interactions against the mirror: instant ZIP lookup and an inline
 * API playground. Both hit the real GitHub Pages endpoints.
 */

import { ZLP_UTILS } from "./utils.js";

const { fmt, fmtBytes, esc } = ZLP_UTILS;

const stateCache = new Map();
let zipIndex = null;

/* ------------------------------------------------------------------ */
/* ZIP lookup                                                         */
/* ------------------------------------------------------------------ */

async function loadZipIndex() {
  if (zipIndex) return zipIndex;
  const res = await fetch(`${BASE}/data/zip_index.json`, { cache: "force-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  zipIndex = await res.json();
  return zipIndex;
}

async function loadState(code) {
  if (stateCache.has(code)) return stateCache.get(code);
  const res = await fetch(`${BASE}/data/states/${code}.json`, { cache: "force-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${code}.json`);
  const rows = await res.json();
  stateCache.set(code, rows);
  return rows;
}

function renderHits(out, zip, records) {
  if (!records.length) {
    out.innerHTML = `<p class="zip-note">No locale record found for ${esc(zip)}.</p>`;
    return;
  }

  out.innerHTML = records
    .map(record => {
      const facts = [
        record.physical_city && ["City", record.physical_city],
        record.physical_delivery_address && ["Address", record.physical_delivery_address],
        record.district_name && ["District", record.district_name],
        record.area_name && ["Area", `${record.area_name}${record.area_code ? ` (${record.area_code})` : ""}`],
        record.locale_key && ["Locale key", record.locale_key],
      ].filter(Boolean);

      return (
        `<div class="zip-hit">` +
        `<div class="zip-hit-top">` +
        `<strong>${esc(record.locale_name || "Unknown locale")}</strong>` +
        `<span class="state-badge">${esc(record.physical_state || "—")}</span>` +
        `<span class="mono" style="color:var(--text-dim)">${esc(zip)}</span>` +
        `</div>` +
        `<dl>` +
        facts
          .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
          .join("") +
        `</dl>` +
        `</div>`
      );
    })
    .join("");
}

export function initZipLookup() {
  const form = document.getElementById("zipLookup");
  const input = document.getElementById("zipInput");
  const out = document.getElementById("zipResult");
  if (!form || !input || !out) return;

  input.addEventListener("input", () => {
    input.value = input.value.replace(/\D/g, "").slice(0, 5);
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const zip = input.value.trim();

    if (!/^\d{5}$/.test(zip)) {
      out.innerHTML = `<p class="zip-error">Enter a valid 5-digit ZIP code.</p>`;
      input.focus();
      return;
    }

    out.innerHTML = `<span class="zip-loading">Looking up ${esc(zip)}…</span>`;

    try {
      const index = await loadZipIndex();
      const value = index[zip];
      const states = !value ? [] : Array.isArray(value) ? value : [value];

      if (!states.length) {
        out.innerHTML = `<p class="zip-error">ZIP ${esc(zip)} is not present in the USPS ZIP Locale dataset.</p>`;
        return;
      }

      const records = [];
      for (const state of states) {
        const rows = await loadState(state);
        records.push(...rows.filter(r => r.delivery_zipcode === zip));
      }

      renderHits(out, zip, records);
    } catch (err) {
      out.innerHTML = `<p class="zip-error">Lookup failed: ${esc(err.message)}</p>`;
    }
  });
}

/* ------------------------------------------------------------------ */
/* API playground                                                     */
/* ------------------------------------------------------------------ */

const ENDPOINTS = [
  { path: "data/index.json", label: "index.json — coverage & freshness" },
  { path: "data/states/NY.json", label: "states/NY.json — one state slice" },
  { path: "data/zip_index.json", label: "zip_index.json — ZIP → state map" },
  { path: "data/health.json", label: "health.json — mirror status" },
  { path: "data/changes.json", label: "changes.json — latest change set" },
  { path: "data/source.json", label: "source.json — provenance" },
  { path: "data/last_updated.txt", label: "last_updated.txt — plain text" },
];

const PREVIEW_LIMIT = 6000;

async function runRequest(path, metaEl, preEl) {
  const url = `${BASE}/${path}`;
  metaEl.innerHTML = `<span class="mono">GET</span><span class="mono">${esc(url)}</span>`;
  preEl.textContent = "// loading…";

  const started = performance.now();
  try {
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();
    const ms = Math.round(performance.now() - started);
    const bytes = new Blob([text]).size;

    metaEl.innerHTML =
      `<span class="${res.ok ? "ok" : "bad"} mono">HTTP ${res.status}</span>` +
      `<span class="mono">${ms} ms</span>` +
      `<span class="mono">${fmtBytes(bytes)}</span>` +
      `<span class="mono">${esc((res.headers.get("content-type") || "unknown").split(";")[0])}</span>`;

    if (path.endsWith(".json")) {
      try {
        const pretty = JSON.stringify(JSON.parse(text), null, 2);
        preEl.textContent =
          pretty.length > PREVIEW_LIMIT
            ? `${pretty.slice(0, PREVIEW_LIMIT)}\n\n// … truncated — ${fmt(bytes)} total`
            : pretty;
      } catch {
        preEl.textContent = text.slice(0, PREVIEW_LIMIT);
      }
    } else {
      preEl.textContent = text.slice(0, PREVIEW_LIMIT);
    }
  } catch (err) {
    metaEl.innerHTML = `<span class="bad mono">Request failed: ${esc(err.message)}</span>`;
    preEl.textContent = "// request failed";
  }
}

export function initPlayground() {
  const select = document.getElementById("pgEndpoint");
  const run = document.getElementById("pgRun");
  const meta = document.getElementById("pgMeta");
  const pre = document.getElementById("pgPreview");
  if (!select || !run || !meta || !pre) return;

  select.innerHTML = ENDPOINTS.map(e => `<option value="${esc(e.path)}">${esc(e.label)}</option>`).join("");
  select.value = "data/index.json";

  const execute = () => runRequest(select.value, meta, pre);

  run.addEventListener("click", execute);
  select.addEventListener("change", execute);

  execute(); // show a real response immediately
}
