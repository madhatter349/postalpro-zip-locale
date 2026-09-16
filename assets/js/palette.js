/**
 * Command palette (⌘K / Ctrl+K): jump to sections, copy endpoint URLs,
 * open any state, or switch the theme.
 */

import { copyText } from "./ui.js";

const REPO = "https://github.com/madhatter349/postalpro-zip-locale";
const USPS = "https://postalpro.usps.com/ZIP_Locale_Detail";

const ENDPOINTS = [
  "data/zip_locale_detail.json",
  "data/states/NY.json",
  "data/index.json",
  "data/health.json",
  "data/changes.json",
  "data/history.json",
  "data/zip_index.json",
  "data/source.json",
  "data/csv/zip_locale_detail.csv",
  "data/csv/NY.csv",
  "data/zip_locale_detail.sqlite",
  "data/schema.json",
  "openapi.json",
  "data/last_updated.txt",
  "data/last_checked.txt",
];

let els = null;
let items = [];
let active = 0;
let statesLoaded = false;

function go(hash) {
  location.hash = hash;
  close();
}

function staticCommands() {
  const section = [
    ["↓", "Explore the dataset", "#explorer"],
    ["▶", "Open the API playground", "#playground"],
    ["≡", "API reference", "#api"],
    ["◎", "Coverage by state", "#coverage"],
    ["{}", "Record schema", "#schema"],
  ].map(([icon, label, hint]) => ({ icon, label, hint, run: () => go(hint) }));

  const actions = [
    {
      icon: "◐",
      label: "Toggle light / dark theme",
      hint: "appearance",
      run: () => {
        document.getElementById("themeToggle")?.click();
        close();
      },
    },
    {
      icon: "↗",
      label: "GitHub repository",
      hint: "github.com",
      run: () => {
        window.open(REPO, "_blank", "noopener");
        close();
      },
    },
    {
      icon: "↗",
      label: "USPS source page",
      hint: "postalpro.usps.com",
      run: () => {
        window.open(USPS, "_blank", "noopener");
        close();
      },
    },
  ];

  const endpoints = ENDPOINTS.map(path => ({
    icon: "GET",
    label: path,
    hint: "copy URL",
    run: () => {
      copyText(`${BASE}/${path}`, "Endpoint URL copied");
      close();
    },
  }));

  return [...section, ...actions, ...endpoints];
}

async function stateCommands() {
  if (statesLoaded) return [];
  statesLoaded = true;
  try {
    const res = await fetch(`${BASE}/data/index.json`);
    const idx = await res.json();
    return idx.states.map(s => ({
      icon: s.state.slice(0, 1),
      label: `${s.state} — ${s.count.toLocaleString("en-US")} records`,
      hint: "open in explorer",
      run: () => {
        close();
        location.hash = "#explorer";
        document.dispatchEvent(new CustomEvent("zlp:open-state", { detail: s.state }));
      },
    }));
  } catch {
    return [];
  }
}

function render() {
  const query = els.input.value.trim().toLowerCase();
  const filtered = query
    ? items.filter(i => `${i.label} ${i.hint}`.toLowerCase().includes(query))
    : items;

  active = Math.min(active, Math.max(0, filtered.length - 1));
  els.list.innerHTML = filtered.length
    ? filtered
        .map(
          (item, i) =>
            `<li class="palette-item" role="option" aria-selected="${i === active}" data-i="${i}">` +
            `<span class="p-icon">${item.icon}</span>` +
            `<span class="p-label">${item.label}</span>` +
            `<span class="p-hint">${item.hint}</span>` +
            `</li>`
        )
        .join("")
    : `<li class="palette-empty">No matches for “${query.replace(/[<>&"]/g, "")}”</li>`;

  els.list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });

  els.list.onclick = e => {
    const li = e.target.closest(".palette-item");
    if (!li) return;
    filtered[Number(li.dataset.i)]?.run();
  };
}

function refresh() {
  items = [...staticCommands()];
  render();
  // States arrive asynchronously; merge them in when ready.
  stateCommands().then(extra => {
    if (!extra.length) return;
    items = [...items, ...extra];
    render();
  });
}

function open() {
  els.dialog.showModal();
  els.input.value = "";
  active = 0;
  refresh();
  requestAnimationFrame(() => els.input.focus());
}

function close() {
  if (els.dialog.open) els.dialog.close();
}

export function initPalette() {
  const dialog = document.getElementById("palette");
  const input = document.getElementById("paletteInput");
  const list = document.getElementById("paletteList");
  if (!dialog || !input || !list) return;

  els = { dialog, input, list };

  document.getElementById("paletteBtn")?.addEventListener("click", open);

  document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      dialog.open ? close() : open();
    }
  });

  input.addEventListener("input", () => {
    active = 0;
    render();
  });

  input.addEventListener("keydown", e => {
    const query = input.value.trim().toLowerCase();
    const count = query
      ? items.filter(i => `${i.label} ${i.hint}`.toLowerCase().includes(query)).length
      : items.length;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = Math.min(active + 1, count - 1);
      render();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(active - 1, 0);
      render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const query2 = input.value.trim().toLowerCase();
      const filtered = query2
        ? items.filter(i => `${i.label} ${i.hint}`.toLowerCase().includes(query2))
        : items;
      filtered[active]?.run();
    }
  });

  // Click on the backdrop closes the dialog.
  dialog.addEventListener("click", e => {
    if (e.target === dialog) close();
  });
}
