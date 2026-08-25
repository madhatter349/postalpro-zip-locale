/**
 * Main site behaviour — nav, hero stats, endpoint accordions,
 * copy buttons, state grid. Explorer lives in explorer.js.
 */
import { ZLP_UTILS } from "./utils.js";
import { ZLP_EXPLORER } from "./explorer.js";

const ZLP_MAIN = (() => {
  const { fmt } = ZLP_UTILS;

  /* ------------------------------------------------------------------ */
  /* hero stats + state grid                                            */
  /* ------------------------------------------------------------------ */

  async function loadMeta() {
    try {
      const res = await fetch(`${BASE}/data/index.json`);
      const idx = await res.json();

      setStat("statRecords", fmt(idx.total_records));
      setStat("statStates", fmt(idx.state_count));
      setStat("statUpdated", idx.last_updated || "—");
      setStat("statChecked", prettyTime(idx.last_checked));

      renderStateGrid(idx.states);
    } catch {
      setStat("statRecords", "—");
      setStat("statStates", "—");
      setStat("statUpdated", "—");
      setStat("statChecked", "—");
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

  function renderStateGrid(states) {
    const grid = document.getElementById("statesGrid");
    if (!grid) return;
    grid.innerHTML = states
      .map(
        s =>
          `<a class="state-chip" href="${BASE}/data/states/${s.state}.json" target="_blank" rel="noopener">` +
          `${s.state}<span class="st-count">${fmt(s.count)}</span></a>`
      )
      .join("");
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
    bindSmoothScroll();
    setYear();
    if (typeof ZLP_EXPLORER !== "undefined") {
      ZLP_EXPLORER.init("explorer");
    }
  });
})();

export { ZLP_MAIN };
