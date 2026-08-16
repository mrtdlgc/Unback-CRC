/**
 * Theme selection: system (default), light, or dark.
 *
 * The stylesheet defines all three states, so this only has to stamp
 * `data-theme` on the root element — or remove it to hand control back to
 * `prefers-color-scheme`.
 */

const STORAGE_KEY = "circles-ledger-theme";
const ORDER = ["system", "light", "dark"];
const LABELS = { system: "Theme: auto", light: "Theme: light", dark: "Theme: dark" };

function read() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return ORDER.includes(stored) ? stored : "system";
  } catch {
    return "system"; // private mode / storage disabled
  }
}

function apply(theme, button) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);

  if (button) {
    button.textContent = LABELS[theme];
    button.setAttribute("aria-label", `${LABELS[theme]}. Activate to change.`);
  }
}

export function initTheme(button) {
  let current = read();
  apply(current, button);

  button.addEventListener("click", () => {
    current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
    try {
      if (current === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, current);
    } catch {
      /* preference simply will not persist */
    }
    apply(current, button);
  });
}
