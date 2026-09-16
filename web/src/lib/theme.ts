// Light or dark, chosen rather than followed. Both apps share the choice: they're one origin and you
// move between them constantly, so the theme changing at the handoff would be jarring.
//
// The matching script in index.html and studio.html applies this before the page paints, so there's
// no flash of the wrong theme on the way in. Keep the two in step.

export type Theme = "light" | "dark";

export const THEME_KEY = "nextdraw-theme";

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light"; // storage blocked: light, the same default the inline script uses
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable; the theme still applies for this page */
  }
}
