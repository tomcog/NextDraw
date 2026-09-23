import { Tag } from "@tomcoggia/ui";
import { Waypoints } from "lucide-react";
import { ThemeToggle } from "../../shared/components/ThemeToggle";
import { AppSwitch } from "../../shared/components/AppSwitch";
import styles from "../../shared/components/Header.module.css";

interface Props {
  plotterFound: boolean;
  lostContact: boolean;
}

export function Header({ plotterFound, lostContact }: Props) {
  const text = lostContact
    ? "Lost contact with NextDraw Plot. Is server.py still running?"
    : plotterFound ? "Plotter connected" : "No plotter found on USB";
  return (
    <header className={styles.header}>
      {/* The mark replaces the space, so the name needs saying in full for anything reading it. */}
      <h1 className={styles.title} aria-label="NextDraw Plot">
        NextDraw
        {/* Waypoints stands in for the space: the path the pen is sent along. Decorative - the
            heading still reads "NextDraw Plot" to anything listening. */}
        <Waypoints className={styles.titleMark} aria-hidden="true" />
        <span className={styles.titleApp}>Plot</span>
      </h1>
      <span className={styles.tools}>
        <AppSwitch current="plot" />
        <Tag className={styles.status} data-found={plotterFound && !lostContact}>
          <span className={styles.dot} aria-hidden="true" />
          {text}
        </Tag>
        <ThemeToggle />
      </span>
    </header>
  );
}
