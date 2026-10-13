import { Segment, SegmentedControl, Toolbar } from "@tomcoggia/ui";
import { Aperture, PenTool, Waypoints } from "lucide-react";
import { goToApp, type AppName } from "../lib/apps";

/**
 * Shared: the way between the apps, in the same place in every app. The app you are in is the one
 * pressed; another opens in this tab, on the same drawing - changes not saved included. An app that
 * can't go yet (its latest changes still to reach the server) says why through onRefused. The marks are the ones each app's name
 * carries in its title. Figma: `AppSwitcher` (64:660) - a small white bar of icons, the names left to
 * their tooltips and to screen readers. Studio, Image, Plot.
 * Every app stands it up, at the top of its column of toolbars at the very left.
 */
export function AppSwitch({ current, orientation, onRefused }: { current: AppName; orientation?: "horizontal" | "vertical"; onRefused?: (why: string) => void }) {
  const go = async (app: AppName) => {
    if (app === current) return;
    const refused = await goToApp(app);
    if (refused) onRefused?.(refused);
  };
  return (
    <Toolbar tone="white" orientation={orientation} aria-label="Apps">
      <SegmentedControl size="sm" variant="dark" aria-label="App">
        <Segment
          selected={current === "studio"}
          icon={<PenTool />}
          hideLabel
          title={current === "studio" ? "You're in Studio" : "Go to Studio, on this drawing"}
          onClick={() => void go("studio")}
        >
          Studio
        </Segment>
        <Segment
          selected={current === "photo"}
          icon={<Aperture />}
          hideLabel
          title={current === "photo" ? "You're in Image" : "Go to Image, on this drawing"}
          onClick={() => void go("photo")}
        >
          Image
        </Segment>
        <Segment
          selected={current === "plot"}
          icon={<Waypoints />}
          hideLabel
          title={current === "plot" ? "You're in Plot" : "Go to Plot, on this drawing"}
          onClick={() => void go("plot")}
        >
          Plot
        </Segment>
      </SegmentedControl>
    </Toolbar>
  );
}
