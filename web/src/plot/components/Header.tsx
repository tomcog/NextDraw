import { Logo, Tag } from "@tomcoggia/ui";
import { Waypoints } from "lucide-react";
import { AppSwitch } from "../../shared/components/AppSwitch";
import styles from "../../shared/components/Header.module.css";

interface Props {
  plotterFound: boolean;
  plotterName?: string; // said when it isn't the usual plotter
  severalPlotters?: boolean; // more than one plugged in: neither is used
  lostContact: boolean;
}

export function Header({ plotterFound, plotterName, severalPlotters, lostContact }: Props) {
  const text = lostContact
    ? "Lost contact with NextDraw Plot. Is server.py still running?"
    : severalPlotters ? "Two plotters plugged in: unplug one"
    : plotterFound ? `${plotterName ?? "Plotter"} connected` : "No plotter found";
  return (
    <header className={styles.header}>
      {/* The mark replaces the space, so the name needs saying in full for anything reading it. */}
      <h1 className={styles.title} aria-label="NextDraw Plot">
        {/* Tom's mark, ahead of the name. Decorative: the heading names the app. */}
        <Logo size="1.5em" className={styles.logo} />
        NextDraw
        {/* Waypoints stands in for the space: the path the pen is sent along. Decorative - the
            heading still reads "NextDraw Plot" to anything listening. */}
        <Waypoints className={styles.titleMark} aria-hidden="true" />
        <span className={styles.titleApp}>Plot</span>
      </h1>
      <span className={styles.tools}>
        <AppSwitch current="plot" />
        <Tag className={styles.status} data-found={plotterFound && !severalPlotters && !lostContact}>
          <span className={styles.dot} aria-hidden="true" />
          {text}
        </Tag>
      </span>
    </header>
  );
}
