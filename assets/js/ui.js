/**
 * Tiny DOM feedback helpers: toasts and clipboard copy.
 */

const toastHost = () => document.getElementById("toasts");

/** Show a transient toast message. */
export function toast(message, kind = "ok", ms = 2200) {
  const host = toastHost();
  if (!host) return;

  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.appendChild(el);

  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .2s";
    setTimeout(() => el.remove(), 220);
  }, ms);
}

/** Copy text to the clipboard, with toast feedback. */
export async function copyText(text, label = "Copied to clipboard") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, "ok");
  } catch {
    // Fallback for insecure contexts / older browsers
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast(label, "ok");
    } catch {
      toast("Copy failed", "error");
    }
    ta.remove();
  }
}
