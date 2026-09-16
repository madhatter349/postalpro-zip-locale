/**
 * Theme controller: respects the system preference, remembers a manual
 * choice, and keeps the toggle button in sync.
 */

const KEY = "zlp-theme";

function current() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function apply(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = document.getElementById("themeToggle");
  if (btn) {
    btn.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} theme`);
    btn.title = `Switch to ${theme === "dark" ? "light" : "dark"} theme`;
  }
}

export function initTheme() {
  apply(current());

  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    apply(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // storage may be unavailable
    }
  });

  // Follow the OS only while the user hasn't made an explicit choice.
  window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change", e => {
    let stored = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      /* ignore */
    }
    if (!stored) apply(e.matches ? "light" : "dark");
  });
}

export { current as currentTheme };
