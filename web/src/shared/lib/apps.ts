/**
 * Where the apps live, and how to go from one to another. The same addresses on every server: Flask
 * serves Plot at the root, Studio at /studio and Image at /image, and the dev server copies it
 * (vite.config.ts), so a link between them can't land in the wrong one.
 *
 * All three work on one drawing at a time - the current drawing, kept by the server - so going from
 * one to another is just loading the other in this tab: it picks the drawing up where this one left it.
 */
export type AppName = "plot" | "studio" | "photo";

export const APP_URL: Record<AppName, string> = { plot: "/", studio: "/studio", photo: "/image" };

// What has to happen before this page is left for another app: an editor's changes sent to the
// current drawing. Answers why not, when it can't go yet.
let beforeLeaving: (() => Promise<string | null>) | null = null;

/** Said by the page that holds the drawing: run this before going. Returns the way to stop. */
export function whenLeaving(check: () => Promise<string | null>) {
  beforeLeaving = check;
  return () => {
    if (beforeLeaving === check) beforeLeaving = null;
  };
}

/** Another app, in this tab, on the current drawing. Returns why not if this page can't go yet. */
export async function goToApp(app: AppName): Promise<string | null> {
  const refused = beforeLeaving ? await beforeLeaving() : null;
  if (refused) return refused;
  window.location.href = APP_URL[app];
  return null;
}
