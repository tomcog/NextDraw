import { Logo, Tag } from "@tomcoggia/ui";
import { PenTool } from "lucide-react";
import { AppSwitch } from "../../shared/components/AppSwitch";
import styles from "../../shared/components/Header.module.css";

interface Props {
  /** Whether the server sees a plotter on USB; null until it has been asked. */
  plotterFound: boolean | null;
}

// Plot's header, with Studio's name. The status says only what Plot's does - whether the plotter is
// there - so the same place means the same thing in both apps; Studio's own news goes by the
// preview's toolbar. The styles are Plot's own file rather than a copy, so the two can't drift apart.
export function StudioHeader({ plotterFound }: Props) {
  const text = plotterFound === null ? "Looking for the plotter…" : plotterFound ? "Plotter connected" : "No plotter found";
  return (
    <header className={styles.header}>
      {/* The mark replaces the space, so the name needs saying in full for anything reading it. */}
      <h1 className={styles.title} aria-label="NextDraw Studio">
        {/* Tom's mark, ahead of the name. Decorative: the heading names the app. */}
        <Logo size="1.5em" className={styles.logo} />
        NextDraw
        {/* The nib stands in for the space, so the name carries the tool it is about. It's decorative:
            the heading still reads "NextDraw Studio" to anything listening. */}
        <PenTool className={styles.titleMark} aria-hidden="true" />
        <span className={styles.titleApp}>Studio</span>
      </h1>
      <span className={styles.tools}>
        <AppSwitch current="studio" />
        <Tag className={styles.status} data-found={Boolean(plotterFound)}>
          <span className={styles.dot} aria-hidden="true" />
          {text}
        </Tag>
      </span>
    </header>
  );
}
