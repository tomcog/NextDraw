import { Segment, SegmentedControl, Toolbar } from "@tomcoggia/ui";
import { Aperture, PenTool, Waypoints } from "lucide-react";
import { showApp, type AppName } from "../lib/apps";

/**
 * Shared: the way between the apps, in the same place in every header. The app you are in is the one
 * pressed; another brings its tab forward, or opens one. The marks are the ones each app's name
 * carries in its title. Figma: `AppSwitcher` (64:660) - a small white bar of icons, the names left to
 * their tooltips and to screen readers. Photo, Studio, Plot: the order a photo goes through them.
 * Photo stands it up, at the top of its column of toolbars on the left.
 */
export function AppSwitch({ current, orientation }: { current: AppName; orientation?: "horizontal" | "vertical" }) {
  return (
    <Toolbar tone="white" orientation={orientation} aria-label="Apps">
      <SegmentedControl size="sm" aria-label="App">
        <Segment
          selected={current === "photo"}
          icon={<Aperture />}
          hideLabel
          title={current === "photo" ? "You're in Photo" : "Go to Photo, in its own tab"}
          onClick={() => current !== "photo" && showApp("photo")}
        >
          Photo
        </Segment>
        <Segment
          selected={current === "studio"}
          icon={<PenTool />}
          hideLabel
          title={current === "studio" ? "You're in Studio" : "Go to Studio, in its own tab"}
          onClick={() => current !== "studio" && showApp("studio")}
        >
          Studio
        </Segment>
        <Segment
          selected={current === "plot"}
          icon={<Waypoints />}
          hideLabel
          title={current === "plot" ? "You're in Plot" : "Go to Plot, in its own tab"}
          onClick={() => current !== "plot" && showApp("plot")}
        >
          Plot
        </Segment>
      </SegmentedControl>
    </Toolbar>
  );
}
