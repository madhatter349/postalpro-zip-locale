/**
 * Interactive data explorer for the ZIP Locale dataset.
 * Loads a state (or streams all states), then provides
 * client-side search, sort, and pagination.
 */
import { ZLP_UTILS } from "./utils.js";

const ZLP_EXPLORER = (() => {
  const { normalizeQuery, matchRecord, sortRecords, paginate, fmt, pageWindow, debounce, esc } = ZLP_UTILS;

  const DEFAULT_PAGE_SIZE = 50;

  const state = {
    all: [],        // full loaded dataset (after streaming merge)
    filtered: [],   // after search
    sortKey: "delivery_zipcode",
    sortDir: "asc",
    page: 1,
    perPage: DEFAULT_PAGE_SIZE,
    query: "",
    sourceState: "ALL", // "ALL" or a 2-letter state
    streaming: false,
    aborted: false,
    loaded: 0,
  };

  let els = null;
  let tableRowsEl = null;
  let tbodyEl = null;

  /* ------------------------------------------------------------------ */
  /* init                                                               */
  /* ------------------------------------------------------------------ */

  function init(containerId) {
    const root = document.getElementById(containerId);
    if (!root) return;
    els = {
      root,
      toolbar: root.querySelector(".explorer-toolbar"),
      search: root.querySelector("#zlpSearch"),
      stateFilter: root.querySelector("#zlpStateFilter"),
      meta: root.querySelector("#zlpMeta"),
      progress: root.querySelector("#zlpProgress"),
      progressFill: root.querySelector("#zlpProgressFill"),
      progressText: root.querySelector("#zlpProgressText"),
      tableWrap: root.querySelector(".table-wrap"),
      thead: root.querySelector("#zlpThead"),
      tbody: root.querySelector("#zlpTbody"),
      pagination: root.querySelector("#zlpPagination"),
      pageInfo: root.querySelector("#zlpPageInfo"),
      pageBtns: root.querySelector("#zlpPageBtns"),
    };

    tbodyEl = els.tbody;
    bindEvents();
    renderHeader();
    loadStatesList();
    streamAll(); // auto-load full dataset so the explorer is instantly usable
  }

  function bindEvents() {
    els.search.addEventListener(
      "input",
      debounce(() => {
        state.query = normalizeQuery(els.search.value);
        state.page = 1;
        applyFilter();
      }, 220)
    );

    els.stateFilter.addEventListener("change", () => {
      const val = els.stateFilter.value;
      if (val === "ALL") {
        streamAll();
      } else {
        loadState(val);
      }
    });

    els.thead.addEventListener("click", e => {
      const th = e.target.closest("th[data-key]");
      if (!th) return;
      const key = th.dataset.key;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDir = "asc";
      }
      renderHeader();
      applySortAndPage();
    });
  }

  /* ------------------------------------------------------------------ */
  /* data loading                                                       */
  /* ------------------------------------------------------------------ */

  async function loadStatesList() {
    try {
      const res = await fetch(`${BASE}/data/index.json`);
      const idx = await res.json();
      populateStateFilter(idx.states);
    } catch {
      // non-fatal
    }
  }

  function populateStateFilter(states) {
    const current = els.stateFilter.value;
    const groups = { state: [], district: [], territory: [], federated: [], other: [] };
    for (const s of states) {
      const k = s.kind || "other";
      if (!groups[k]) groups[k] = [];
      groups[k].push(s);
    }

    const GROUP_LABELS = {
      state: "States",
      district: "Federal district",
      territory: "Territories",
      federated: "Freely associated",
      other: "Other",
    };

    let html = `<option value="ALL">All areas</option>`;
    for (const [kind, list] of Object.entries(groups)) {
      if (!list.length) continue;
      html += `<optgroup label="${GROUP_LABELS[kind] || kind}">`;
      html += list.map(s => `<option value="${s.state}">${s.state} — ${fmt(s.count)}</option>`).join("");
      html += `</optgroup>`;
    }
    els.stateFilter.innerHTML = html;
    els.stateFilter.value = current || "ALL";
  }

  async function loadState(code) {
    abortStream();
    state.sourceState = code;
    state.all = [];
    showLoading();
    try {
      const res = await fetch(`${BASE}/data/states/${code}.json`);
      if (!res.ok) throw new Error("state not found");
      state.all = await res.json();
      hideProgress();
      applyFilter();
    } catch (err) {
      setEmpty(`Could not load ${code}.json`);
    }
  }

  /** Stream all 59 state files, merging as they arrive. */
  async function streamAll() {
    abortStream();
    state.sourceState = "ALL";
    state.all = [];
    state.streaming = true;
    state.aborted = false;
    state.loaded = 0;

    showProgress(0);
    showLoading();

    try {
      const res = await fetch(`${BASE}/data/index.json`);
      const idx = await res.json();
      const codes = idx.states.map(s => s.state);

      const CHUNK = 6;
      for (let i = 0; i < codes.length; i += CHUNK) {
        if (state.aborted) return;
        const batch = codes.slice(i, i + CHUNK);
        await Promise.all(
          batch.map(async code => {
            if (state.aborted) return;
            try {
              const r = await fetch(`${BASE}/data/states/${code}.json`);
              if (!r.ok) return;
              const data = await r.json();
              if (state.aborted) return;
              state.all = state.all.concat(data);
            } catch {
              // skip failed state
            }
          })
        );
        state.loaded += batch.length;
        updateProgress(state.loaded / codes.length);
        applyFilter({ resetPage: false });
      }
    } catch (err) {
      setEmpty("Could not stream dataset.");
    } finally {
      state.streaming = false;
      hideProgress();
      showLoaded();
    }
  }

  function abortStream() {
    state.aborted = true;
    state.streaming = false;
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                          */
  /* ------------------------------------------------------------------ */

  const COLUMNS = [
    { key: "delivery_zipcode", label: "ZIP" },
    { key: "locale_name", label: "Locale" },
    { key: "physical_city", label: "City" },
    { key: "physical_state", label: "State" },
    { key: "district_name", label: "District" },
    { key: "area_name", label: "Area" },
  ];

  function renderHeader() {
    els.thead.innerHTML =
      `<tr>` +
      COLUMNS.map(c => {
        const sorted = state.sortKey === c.key;
        const arrow = sorted ? (state.sortDir === "asc" ? "▲" : "▼") : "";
        return `<th data-key="${c.key}" class="${sorted ? "sorted" : ""}">${c.label}<span class="arrow">${arrow}</span></th>`;
      }).join("") +
      `</tr>`;
  }

  function showLoading() {
    tbodyEl.innerHTML = `<tr class="loading-row"><td colspan="${COLUMNS.length}"><div class="shimmer"></div><div class="shimmer" style="width:60%"></div><div class="shimmer" style="width:80%"></div></td></tr>`;
  }

  function showLoaded() {
    if (state.all.length) {
      applyFilter();
    } else {
      setEmpty("No data loaded.");
    }
  }

  function setEmpty(msg) {
    tbodyEl.innerHTML = `<tr><td colspan="${COLUMNS.length}"><div class="empty-state"><div class="icon">🗂️</div><div>${esc(msg)}</div></div></td></tr>`;
    els.pagination.style.display = "none";
    els.meta.style.display = "none";
  }

  function showProgress(pct) {
    els.progress.style.display = "flex";
    els.progressFill.style.width = `${Math.round(pct * 100)}%`;
    els.progressText.textContent = `${Math.round(pct * 100)}%`;
  }

  function updateProgress(pct) {
    if (els.progress.style.display !== "flex") els.progress.style.display = "flex";
    els.progressFill.style.width = `${Math.round(pct * 100)}%`;
    els.progressText.textContent = `${Math.round(pct * 100)}%`;
  }

  function hideProgress() {
    els.progress.style.display = "none";
  }

  /* ------------------------------------------------------------------ */
  /* filtering / sorting / pagination                                   */
  /* ------------------------------------------------------------------ */

  function applyFilter(opts = {}) {
    state.filtered = state.all.filter(r => matchRecord(r, state.query));
    applySortAndPage(opts);
  }

  function applySortAndPage(opts = {}) {
    const sorted = sortRecords(state.filtered, state.sortKey, state.sortDir);
    const p = paginate(sorted, state.page, state.perPage);

    state.page = p.page;
    renderTable(p.items);
    renderMeta();
    renderPagination(p);
  }

  function renderTable(items) {
    if (!items.length) {
      setEmpty("No records match your search.");
      return;
    }
    tbodyEl.innerHTML = items.map(rec => {
      const zip = rec.delivery_zipcode || "";
      const stateBadge = rec.physical_state ? `<span class="state-badge">${esc(rec.physical_state)}</span>` : `<span class="null">—</span>`;
      return (
        `<tr>` +
        `<td class="zip">${esc(zip)}</td>` +
        `<td class="locale">${esc(rec.locale_name)}</td>` +
        `<td>${esc(rec.physical_city)}</td>` +
        `<td>${stateBadge}</td>` +
        `<td>${esc(rec.district_name)}</td>` +
        `<td>${esc(rec.area_name)}</td>` +
        `</tr>`
      );
    }).join("");
  }

  function renderMeta() {
    els.meta.style.display = "flex";
    const source = state.sourceState === "ALL" ? "All states" : state.sourceState;
    els.meta.innerHTML =
      `<span><span class="count">${fmt(state.filtered.length)}</span> of ${fmt(state.all.length)} records · ${esc(source)}</span>` +
      `<span class="hint">Search ZIP, city, locale — click column to sort</span>`;
  }

  function renderPagination(p) {
    els.pagination.style.display = "flex";
    const per = state.perPage;
    const start = (p.page - 1) * per + 1;
    const end = Math.min(p.page * per, p.total);
    els.pageInfo.textContent = `${fmt(start)}–${fmt(end)} of ${fmt(p.total)}`;

    const pages = pageWindow(p.page, p.totalPages);
    const btns = [];

    if (p.page > 1) {
      btns.push(`<button class="page-btn" data-page="${p.page - 1}">‹</button>`);
    }
    if (!pages.includes(1)) {
      btns.push(`<button class="page-btn" data-page="1">1</button>`);
      if (!pages.includes(2)) btns.push(`<span class="page-info" style="padding:0 4px">…</span>`);
    }
    pages.forEach(pg => {
      btns.push(`<button class="page-btn ${pg === p.page ? "active" : ""}" data-page="${pg}">${pg}</button>`);
    });
    if (!pages.includes(p.totalPages)) {
      if (!pages.includes(p.totalPages - 1)) btns.push(`<span class="page-info" style="padding:0 4px">…</span>`);
      btns.push(`<button class="page-btn" data-page="${p.totalPages}">${p.totalPages}</button>`);
    }
    if (p.page < p.totalPages) {
      btns.push(`<button class="page-btn" data-page="${p.page + 1}">›</button>`);
    }

    els.pageBtns.innerHTML = btns.join("");

    els.pageBtns.querySelectorAll(".page-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        state.page = Number(btn.dataset.page);
        applySortAndPage();
        els.tableWrap.scrollTop = 0;
      });
    });
  }

  return { init };
})();

export { ZLP_EXPLORER };
