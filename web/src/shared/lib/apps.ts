import { PLOT_CHANNEL } from "./constants";

/**
 * Where the two apps live, and how to go from one to the other. The same addresses on every server:
 * Flask serves Plot at the root and Studio at /studio, and the dev server copies it (vite.config.ts),
 * so a link between them can't land in the wrong one.
 */
export type AppName = "plot" | "studio";

export const APP_URL: Record<AppName, string> = { plot: "/", studio: "/studio" };

// The name each app gives its own tab, so the other can find it: Plot's is the channel Studio's
// "Open in Plot" already opens it under.
export const APP_WINDOW: Record<AppName, string> = { plot: PLOT_CHANNEL, studio: "nextdraw-studio" };

/** Called once by each app as it starts, so the other app's switch can find this tab again. */
export function nameThisTab(app: AppName) {
  window.name = APP_WINDOW[app];
}

/**
 * Bring the other app forward: its tab if one is open, a new tab if not. A tab that is already open
 * is never loaded again - it could be Studio in the middle of a drawing not yet saved - only shown.
 * Browsers are free to leave a background tab where it is; the tab is there to switch to either way.
 */
export function showApp(app: AppName) {
  const tab = window.open("", APP_WINDOW[app]);
  if (!tab) {
    window.location.href = APP_URL[app]; // pop-ups blocked: go there in this tab
    return;
  }
  try {
    if (tab.location.href === "about:blank") tab.location.replace(APP_URL[app]);
  } catch {
    // Another origin's tab by that name: leave it be.
  }
  tab.focus();
}

/**
 * Studio, on a drawing: always a new tab, since one already open could hold work not yet saved.
 */
export function openInStudio(path: string) {
  const url = `${APP_URL.studio}?open=${encodeURIComponent(path)}`;
  if (!window.open(url, "_blank")) window.location.href = url;
}
