import { Segment, SegmentedControl, Toolbar } from "@tomcoggia/ui";
import { PenTool, Waypoints } from "lucide-react";
import { showApp, type AppName } from "../lib/apps";

/**
 * Shared: the way between the two apps, in the same place in both headers. The app you are in is the
 * one pressed; the other brings its tab forward, or opens one. The marks are the ones each app's name
 * carries in its title. Figma: `AppSwitcher` (64:660) - a small white bar of two icons, Studio then
 * Plot, the names left to their tooltips and to screen readers.
 */
export function AppSwitch({ current }: { current: AppName }) {
  return (
    <Toolbar tone="white" aria-label="Apps">
      <SegmentedControl size="sm" aria-label="App">
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
