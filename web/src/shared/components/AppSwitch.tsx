import { Segment, SegmentedControl } from "@tomcoggia/ui";
import { PenTool, Waypoints } from "lucide-react";
import { showApp, type AppName } from "../lib/apps";

/**
 * Shared: the way between the two apps, in the same place in both headers. The app you are in is the
 * one pressed; the other brings its tab forward, or opens one. The marks are the ones each app's name
 * carries in its title.
 */
export function AppSwitch({ current }: { current: AppName }) {
  return (
    <SegmentedControl size="sm" aria-label="App">
      <Segment
        selected={current === "plot"}
        icon={<Waypoints />}
        title={current === "plot" ? "You're in Plot" : "Go to Plot, in its own tab"}
        onClick={() => current !== "plot" && showApp("plot")}
      >
        Plot
      </Segment>
      <Segment
        selected={current === "studio"}
        icon={<PenTool />}
        title={current === "studio" ? "You're in Studio" : "Go to Studio, in its own tab"}
        onClick={() => current !== "studio" && showApp("studio")}
      >
        Studio
      </Segment>
    </SegmentedControl>
  );
}
