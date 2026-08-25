/**
 * Main site behaviour — nav/burger, hero manifest card,
 * endpoint accordions, copy buttons, coverage grid.
 * Explorer lives in explorer.js.
 */
import { ZLP_UTILS } from "./utils.js";
import { ZLP_EXPLORER } from "./explorer.js";

const ZLP_MAIN = (() => {
  const { fmt } = ZLP_UTILS;

  /* ------------------------------------------------------------------ */
  /* hero manifest card + coverage grid                                 */
  /* ------------------------------------------------------------------ */

  async function loadMeta() {
    try {
      const res = await fetch(`${BASE}/data/index.json`);
      const idx = await res.json();

      setStat("verdictRecords", fmt(idx.total_records));
      setStat("factUpdated", idx.last_updated || "—");
      setStat("factChecked", prettyTime(idx.last_checked));

      const b = idx.state_breakdown || {};
      const coverage = [
        b.states ? `${b.states} states` : "50 states",
        b.district ? `+ ${b.district} district` : "+ DC",
        b.territories ? `+ ${b.territories} territories` : "+ territories",
      ].join(" ");
      setStat("factCoverage", coverage);

      setStat("tickerRecords", fmt(idx.total_records));
      setStat("tickerRecordsDup", fmt(idx.total_records));

      renderCoverage(idx.states);
    } catch {
      setStat("verdictRecords", "—");
      setStat("factUpdated", "—");
      setStat("factChecked", "—");
    }
  }

  function setStat(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function prettyTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  const GROUP_LABELS = {
    state: "50 states",
    district: "Federal district",
    territory: "Territories",
    federated: "Freely associated states",
    other: "Other",
  };

  function renderCoverage(states) {
    const root = document.getElementById("statesGroups");
    if (!root) return;

    const groups = { state: [], district: [], territory: [], federated: [], other: [] };
    for (const s of states) {
      const k = s.kind || "other";
      if (!groups[k]) groups[k] = [];
      groups[k].push(s);
    }

    const html = Object.entries(groups)
      .filter(([, list]) => list.length)
      .map(
        ([kind, list]) =>
          `<div class="state-group">` +
          `<h3>${GROUP_LABELS[kind] || kind} <span class="grp-count">(${list.length})</span></h3>` +
          `<div class="states-grid">` +
          list
            .map(
              s =>
                `<a class="state-chip" href="${BASE}/data/states/${s.state}.json" target="_blank" rel="noopener">` +
                `${s.state}<span class="st-count">${fmt(s.count)}</span></a>`
            )
            .join("") +
          `</div></div>`
      )
      .join("");

    root.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* endpoint accordions                                                */
  /* ------------------------------------------------------------------ */

  function bindEndpoints() {
    document.querySelectorAll(".endpoint").forEach(el => {
      el.addEventListener("click", () => el.classList.toggle("open"));
    });
  }

  /* ------------------------------------------------------------------ */
  /* copy buttons                                                       */
  /* ------------------------------------------------------------------ */

  function bindCopy() {
    document.querySelectorAll("[data-copy]").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const text = btn.dataset.copy;
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = "Copied!";
          btn.classList.add("copied");
          setTimeout(() => {
            btn.textContent = btn.dataset.label || "Copy";
            btn.classList.remove("copied");
          }, 1500);
        } catch {
          btn.textContent = "Error";
        }
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* burger menu (mobile)                                               */
  /* ------------------------------------------------------------------ */

  function bindBurger() {
    const burger = document.getElementById("burger");
    const menu = document.getElementById("mobileMenu");
    if (!burger || !menu) return;
    burger.addEventListener("click", () => {
      const open = menu.classList.toggle("open");
      burger.setAttribute("aria-expanded", String(open));
    });
    menu.querySelectorAll("a").forEach(a => {
      a.addEventListener("click", () => {
        menu.classList.remove("open");
        burger.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* smooth scroll for anchor links                                     */
  /* ------------------------------------------------------------------ */

  function bindSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener("click", e => {
        const target = document.querySelector(a.getAttribute("href"));
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* footer year                                                        */
  /* ------------------------------------------------------------------ */

  function setYear() {
    document.querySelectorAll("[data-year]").forEach(el => {
      el.textContent = new Date().getFullYear();
    });
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                               */
  /* ------------------------------------------------------------------ */

  document.addEventListener("DOMContentLoaded", () => {
    loadMeta();
    bindEndpoints();
    bindCopy();
    bindBurger();
    bindSmoothScroll();
    setYear();
    if (typeof ZLP_EXPLORER !== "undefined") {
      ZLP_EXPLORER.init("explorer");
    }
  });
})();

export { ZLP_MAIN };
