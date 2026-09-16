/**
 * Site boot: theme, header, live stats, coverage grid, copy buttons,
 * playground, palette, and the explorer.
 */
import { ZLP_UTILS } from "./utils.js";
import { copyText } from "./ui.js";
import { initTheme } from "./theme.js";
import { initZipLookup, initPlayground } from "./live.js";
import { initPalette } from "./palette.js";
import { ZLP_EXPLORER } from "./explorer.js";

const { fmt, timeAgo, esc } = ZLP_UTILS;

let lastCheckedIso = null;

/* ------------------------------------------------------------------ */
/* stats + status                                                     */
/* ------------------------------------------------------------------ */

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

async function loadMeta() {
  try {
    const [idxRes, healthRes] = await Promise.all([
      fetch(`${BASE}/data/index.json`),
      fetch(`${BASE}/data/health.json`).catch(() => null),
    ]);
    const idx = await idxRes.json();
    const health = healthRes && healthRes.ok ? await healthRes.json() : null;

    setText("statRecords", fmt(idx.total_records));
    setText("statZips", fmt(idx.unique_zipcodes));
    setText("statPublished", idx.last_updated || "—");
    setText(
      "statSource",
      idx.source?.sha256 ? `sha256 ${idx.source.sha256.slice(0, 12)}…` : "source —"
    );

    lastCheckedIso = idx.last_checked || health?.last_checked || null;
    setText("statChecked", timeAgo(lastCheckedIso));

    renderStatus(health);
    renderCoverage(idx.states);
  } catch {
    setText("statRecords", "—");
    renderStatus(null);
  }
}

function renderStatus(health) {
  const footer = document.getElementById("apiStatus");
  const manifest = document.getElementById("manifestState");
  const ok = health ? health.status === "ok" : false;

  if (footer) {
    footer.classList.toggle("status-error", Boolean(health) && !ok);
    footer.innerHTML =
      `<span class="pulse-dot" aria-hidden="true"></span> ` +
      (ok
        ? "API operational"
        : health
          ? "Update failed — serving last good data"
          : "Status unavailable");
  }

  if (manifest) {
    manifest.classList.toggle("bad", Boolean(health) && !ok);
    manifest.innerHTML = `<span class="pulse-dot" aria-hidden="true"></span> ` + (ok ? "live" : "stale");
  }
}

/* ------------------------------------------------------------------ */
/* coverage                                                           */
/* ------------------------------------------------------------------ */

const GROUP_LABELS = {
  state: "50 states",
  district: "Federal district",
  territory: "Territories",
  federated: "Freely associated states",
  other: "Other",
};

function renderCoverage(states) {
  const root = document.getElementById("statesGroups");
  if (!root || !states) return;

  const groups = { state: [], district: [], territory: [], federated: [], other: [] };
  for (const s of states) {
    const k = s.kind || "other";
    if (!groups[k]) groups[k] = [];
    groups[k].push(s);
  }

  root.innerHTML = Object.entries(groups)
    .filter(([, list]) => list.length)
    .map(
      ([kind, list]) =>
        `<div class="state-group">` +
        `<h3>${GROUP_LABELS[kind] || kind} <span>(${list.length})</span></h3>` +
        `<div class="states-grid">` +
        list
          .map(
            s =>
              `<a class="state-chip" href="${BASE}/data/states/${s.state}.json" target="_blank" rel="noopener" title="Open ${s.state}.json">` +
              `<strong>${esc(s.state)}</strong><span class="st-count">${fmt(s.count)}</span>` +
              `</a>`
          )
          .join("") +
        `</div></div>`
    )
    .join("");
}

/* ------------------------------------------------------------------ */
/* chrome                                                             */
/* ------------------------------------------------------------------ */

function bindCopyButtons() {
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-copy]");
    if (!btn) return;
    copyText(btn.dataset.copy, "URL copied to clipboard");
  });
}

function bindMenu() {
  const btn = document.getElementById("menuBtn");
  const menu = document.getElementById("mobileNav");
  if (!btn || !menu) return;

  btn.addEventListener("click", () => {
    const open = menu.classList.toggle("open");
    btn.setAttribute("aria-expanded", String(open));
  });

  menu.querySelectorAll("a").forEach(a =>
    a.addEventListener("click", () => {
      menu.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    })
  );
}

/* ------------------------------------------------------------------ */
/* boot                                                               */
/* ------------------------------------------------------------------ */

function boot() {
  initTheme();
  bindCopyButtons();
  bindMenu();
  loadMeta();

  initZipLookup();
  initPlayground();
  initPalette();
  ZLP_EXPLORER.init("zlpExplorer");

  document.querySelectorAll("[data-year]").forEach(el => {
    el.textContent = new Date().getFullYear();
  });

  // Keep "last verified" relative time fresh without re-fetching.
  setInterval(() => {
    if (lastCheckedIso) setText("statChecked", timeAgo(lastCheckedIso));
  }, 60_000);

  document.body.dataset.app = "ready";
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
