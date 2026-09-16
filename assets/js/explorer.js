/**
 * Interactive data explorer for the ZIP Locale dataset.
 *
 * Loading strategy: nothing is fetched until it is needed. Choosing a state
 * loads just that file; searching or choosing "All areas" streams the state
 * files in small batches. Everything loaded is cached per dataset generation,
 * so switching back and forth is instant.
 */
import { ZLP_UTILS } from "./utils.js";

const ZLP_EXPLORER = (() => {
  const { normalizeQuery, matchRecord, sortRecords, paginate, fmt, pageWindow, debounce, esc, toCsv } = ZLP_UTILS;

  const DEFAULT_PAGE_SIZE = 50;
  const STREAM_BATCH = 8;
  const CSV_FIELDS = [
    "area_name", "area_code", "district_name", "district_no", "delivery_zipcode",
    "locale_name", "physical_delivery_address", "physical_city", "physical_state",
    "physical_zip", "physical_zip4", "zip_class_code", "locale_key", "locale_type",
  ];
  const COLUMNS = [
    { key: "delivery_zipcode", label: "ZIP" },
    { key: "locale_name", label: "Locale" },
    { key: "physical_city", label: "City" },
    { key: "physical_state", label: "State" },
    { key: "district_name", label: "District" },
    { key: "area_name", label: "Area" },
  ];

  const state = {
    all: [],
    filtered: [],
    sortKey: "delivery_zipcode",
    sortDir: "asc",
    page: 1,
    perPage: DEFAULT_PAGE_SIZE,
    query: "",
    sourceState: "ALL",
    streaming: false,
    loaded: 0,
    codes: [],
    totalRecords: 0,
    generation: null,
  };

  const cache = new Map(); // area code -> records
  let abortController = null;
  let loadToken = 0;
  let els = null;

  /* ------------------------------------------------------------------ */
  /* init                                                               */
  /* ------------------------------------------------------------------ */

  function init(containerId) {
    const root = document.getElementById(containerId);
    if (!root) return;

    els = {
      root,
      search: root.querySelector("#zlpSearch"),
      stateFilter: root.querySelector("#zlpStateFilter"),
      loadAll: root.querySelector("#zlpLoadAll"),
      export: root.querySelector("#zlpExport"),
      perPage: root.querySelector("#zlpPerPage"),
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

    bindEvents();
    renderHeader();
    loadIndex();
  }

  function bindEvents() {
    els.search.addEventListener(
      "input",
      debounce(() => {
        state.query = normalizeQuery(els.search.value);
        state.page = 1;
        if (!state.all.length && !state.streaming && state.query) {
          streamAll(); // first search loads the dataset
        } else {
          applyFilter();
        }
        syncUrl();
      }, 220)
    );

    els.stateFilter.addEventListener("change", () => {
      const val = els.stateFilter.value;
      if (val === "ALL") {
        streamAll();
      } else {
        loadState(val);
      }
      syncUrl();
    });

    els.loadAll.addEventListener("click", () => {
      els.stateFilter.value = "ALL";
      streamAll();
      syncUrl();
    });

    els.export.addEventListener("click", exportCsv);

    els.perPage.addEventListener("change", () => {
      state.perPage = Number(els.perPage.value) || DEFAULT_PAGE_SIZE;
      state.page = 1;
      applySortAndPage();
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

    els.pageBtns.addEventListener("click", e => {
      const btn = e.target.closest(".page-btn");
      if (!btn) return;
      state.page = Number(btn.dataset.page);
      applySortAndPage();
      els.tableWrap.scrollTop = 0;
    });
  }

  /* ------------------------------------------------------------------ */
  /* data loading                                                       */
  /* ------------------------------------------------------------------ */

  async function loadIndex() {
    try {
      const res = await fetch(`${BASE}/data/index.json`, { cache: "no-cache" });
      const idx = await res.json();

      if (state.generation !== idx.generated_at) {
        cache.clear();
        state.generation = idx.generated_at;
      }
      state.codes = idx.states.map(s => s.state);
      state.totalRecords = idx.total_records;

      populateStateFilter(idx.states);
      restoreFromUrl();
    } catch {
      setEmpty("Could not load data/index.json — the mirror may be updating.");
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

    let html = `<option value="ALL">All areas — stream full dataset</option>`;
    for (const [kind, list] of Object.entries(groups)) {
      if (!list.length) continue;
      html += `<optgroup label="${GROUP_LABELS[kind] || kind}">`;
      html += list.map(s => `<option value="${s.state}">${s.state} — ${fmt(s.count)}</option>`).join("");
      html += `</optgroup>`;
    }
    els.stateFilter.innerHTML = html;
    els.stateFilter.value = current || "ALL";
  }

  function beginLoad() {
    abortController?.abort();
    abortController = new AbortController();
    return ++loadToken;
  }

  async function loadState(code) {
    const token = beginLoad();
    state.sourceState = code;
    state.streaming = false;

    if (cache.has(code)) {
      state.all = [...cache.get(code)];
      hideProgress();
      applyFilter();
      return;
    }

    showLoading();
    try {
      const res = await fetch(`${BASE}/data/states/${code}.json`, { signal: abortController.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (token !== loadToken) return;
      cache.set(code, data);
      state.all = [...data];
      hideProgress();
      applyFilter();
    } catch (err) {
      if (err.name !== "AbortError") setEmpty(`Could not load ${code}.json`);
    }
  }

  /** Stream all area files in batches, merging as they arrive. */
  async function streamAll() {
    const token = beginLoad();
    state.sourceState = "ALL";
    state.streaming = true;
    state.all = [];
    state.loaded = 0;

    const codes = state.codes;
    if (!codes.length) {
      setEmpty("Dataset index is not loaded yet.");
      return;
    }

    showLoading();
    showProgress(0);

    try {
      for (let i = 0; i < codes.length; i += STREAM_BATCH) {
        if (token !== loadToken) return;

        const batch = codes.slice(i, i + STREAM_BATCH);
        const results = await Promise.all(
          batch.map(async code => {
            if (cache.has(code)) return cache.get(code);
            try {
              const res = await fetch(`${BASE}/data/states/${code}.json`, {
                signal: abortController.signal,
              });
              if (!res.ok) return null;
              const data = await res.json();
              cache.set(code, data);
              return data;
            } catch {
              return null;
            }
          })
        );

        if (token !== loadToken) return;

        for (const rows of results) {
          if (rows) state.all = state.all.concat(rows);
        }
        state.loaded += batch.length;
        updateProgress(state.loaded / codes.length);
        applyFilter({ resetPage: false });
      }
    } finally {
      if (token === loadToken) {
        state.streaming = false;
        hideProgress();
        if (state.all.length) {
          applyFilter();
        } else {
          setEmpty("Could not stream the dataset.");
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* URL state                                                          */
  /* ------------------------------------------------------------------ */

  const syncUrl = debounce(() => {
    const params = new URLSearchParams();
    if (state.sourceState && state.sourceState !== "ALL") params.set("state", state.sourceState);
    if (state.query) params.set("q", state.query);
    const qs = params.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname + location.hash);
  }, 350);

  function restoreFromUrl() {
    const params = new URLSearchParams(location.search);
    const code = (params.get("state") || "").toUpperCase();
    const query = params.get("q") || params.get("zip") || "";

    if (query) {
      els.search.value = query;
      state.query = normalizeQuery(query);
    }

    if (code && state.codes.includes(code)) {
      els.stateFilter.value = code;
      loadState(code);
    } else if (query) {
      streamAll();
    } else {
      setEmpty(
        `Browse by area or start typing to search all ${fmt(state.totalRecords)} records.`
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* rendering                                                          */
  /* ------------------------------------------------------------------ */

  function renderHeader() {
    els.thead.innerHTML =
      `<tr>` +
      COLUMNS.map(c => {
        const sorted = state.sortKey === c.key;
        const arrow = sorted ? (state.sortDir === "asc" ? "▲" : "▼") : "";
        const ariaSort = sorted ? (state.sortDir === "asc" ? "ascending" : "descending") : "none";
        return `<th data-key="${c.key}" aria-sort="${ariaSort}" class="${sorted ? "sorted" : ""}">${c.label}<span class="arrow">${arrow}</span></th>`;
      }).join("") +
      `</tr>`;
  }

  function showLoading() {
    els.tbody.innerHTML = `<tr class="loading-row"><td colspan="${COLUMNS.length}"><div class="shimmer"></div><div class="shimmer" style="width:60%"></div><div class="shimmer" style="width:80%"></div></td></tr>`;
  }

  function setEmpty(msg) {
    els.tbody.innerHTML = `<tr><td colspan="${COLUMNS.length}"><div class="empty-state"><div class="icon">🗂️</div><div>${esc(msg)}</div></div></td></tr>`;
    els.pagination.style.display = "none";
    els.meta.style.display = "none";
  }

  function showProgress(pct) {
    els.progress.style.display = "flex";
    updateProgress(pct);
  }

  function updateProgress(pct) {
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

  function applySortAndPage() {
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
    els.tbody.innerHTML = items
      .map(rec => {
        const zip = rec.delivery_zipcode || "";
        const stateBadge = rec.physical_state
          ? `<span class="state-badge">${esc(rec.physical_state)}</span>`
          : `<span class="null">—</span>`;
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
      })
      .join("");
  }

  function renderMeta() {
    els.meta.style.display = "flex";
    const source = state.sourceState === "ALL" ? "All areas" : state.sourceState;
    els.meta.innerHTML =
      `<span><span class="count">${fmt(state.filtered.length)}</span> of ${fmt(state.all.length)} loaded records · ${esc(source)}</span>` +
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
      btns.push(`<button class="page-btn" data-page="${p.page - 1}" aria-label="Previous page">‹</button>`);
    }
    if (!pages.includes(1)) {
      btns.push(`<button class="page-btn" data-page="1">1</button>`);
      if (!pages.includes(2)) btns.push(`<span class="page-info" style="padding:0 4px">…</span>`);
    }
    pages.forEach(pg => {
      btns.push(
        `<button class="page-btn ${pg === p.page ? "active" : ""}" data-page="${pg}"${pg === p.page ? ' aria-current="page"' : ""}>${pg}</button>`
      );
    });
    if (!pages.includes(p.totalPages)) {
      if (!pages.includes(p.totalPages - 1)) btns.push(`<span class="page-info" style="padding:0 4px">…</span>`);
      btns.push(`<button class="page-btn" data-page="${p.totalPages}">${p.totalPages}</button>`);
    }
    if (p.page < p.totalPages) {
      btns.push(`<button class="page-btn" data-page="${p.page + 1}" aria-label="Next page">›</button>`);
    }

    els.pageBtns.innerHTML = btns.join("");
  }

  /* ------------------------------------------------------------------ */
  /* export                                                             */
  /* ------------------------------------------------------------------ */

  function exportCsv() {
    const rows = state.filtered.length ? state.filtered : state.all;
    if (!rows.length) return;

    const sorted = sortRecords(rows, state.sortKey, state.sortDir);
    const blob = new Blob([toCsv(sorted, CSV_FIELDS)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `zip_locale_${state.sourceState || "all"}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  return { init };
})();

export { ZLP_EXPLORER };
