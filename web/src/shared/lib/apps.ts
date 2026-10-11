import { PLOT_CHANNEL } from "./constants";

/**
 * Where the apps live, and how to go from one to another. The same addresses on every server: Flask
 * serves Plot at the root, Studio at /studio and Image at /image, and the dev server copies it
 * (vite.config.ts), so a link between them can't land in the wrong one.
 */
export type AppName = "plot" | "studio" | "photo";

export const APP_URL: Record<AppName, string> = { plot: "/", studio: "/studio", photo: "/image" };

// The name each app gives its own tab, so the others can find it: Plot's is the channel Studio's
// "Open in Plot" already opens it under.
export const APP_WINDOW: Record<AppName, string> = { plot: PLOT_CHANNEL, studio: "nextdraw-studio", photo: "nextdraw-photo" };

/** Called once by each app as it starts, so the others' switches can find this tab again. */
export function nameThisTab(app: AppName) {
  window.name = APP_WINDOW[app];
}

/**
 * Bring another app forward: its tab if one is open, a new tab if not. A tab that is already open
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

// The channel a Studio page listens on for drawings handed to it by the other apps.
export const STUDIO_CHANNEL = "nextdraw-studio-open";

/**
 * Studio, on a drawing, in Studio's own tab - never this one. A Studio page already open is asked to
 * take it, and brought forward; it opens the drawing unless its own has changes not saved, when it
 * says so and keeps them. With no Studio page open, one opens in a tab of its own. False when the
 * browser wouldn't open one: the page that asked stays as it is and can say so.
 */
export async function openInStudio(path: string): Promise<boolean> {
  const answered = "BroadcastChannel" in window && await new Promise<boolean>((resolve) => {
    const channel = new BroadcastChannel(STUDIO_CHANNEL);
    const done = (yes: boolean) => {
      window.clearTimeout(timer);
      channel.close();
      resolve(yes);
    };
    const timer = window.setTimeout(() => done(false), 600);
    channel.onmessage = (e) => {
      if (e.data?.type === "studio-here") done(true);
    };
    channel.postMessage({ type: "open-in-studio", path });
  });
  if (answered) {
    // Found by its name and only brought forward: the page in it isn't loaded again. A browser that
    // doesn't link the two tabs hands back a new, blank one instead: closed again, the drawing is
    // already open in Studio's.
    const tab = window.open("", APP_WINDOW.studio);
    try {
      if (tab?.location.href === "about:blank") tab.close();
      else tab?.focus();
    } catch {
      tab?.focus();
    }
    return true;
  }
  const tab = window.open(`${APP_URL.studio}?open=${encodeURIComponent(path)}`, APP_WINDOW.studio);
  tab?.focus();
  return Boolean(tab);
}

/**
 * Photo, on a drawing: a new tab, as for Studio - the one open could be in the middle of a photo.
 */
export function openInPhoto(path: string) {
  const url = `${APP_URL.photo}?open=${encodeURIComponent(path)}`;
  if (!window.open(url, "_blank")) window.location.href = url;
}
