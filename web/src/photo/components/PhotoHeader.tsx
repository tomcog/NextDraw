import { Logo, Tag } from "@tomcoggia/ui";
import { Aperture } from "lucide-react";
import { AppSwitch } from "../../shared/components/AppSwitch";
import styles from "../../shared/components/Header.module.css";

interface Props {
  /** Whether the server sees a plotter on USB; null until it has been asked. */
  plotterFound: boolean | null;
}

// Plot's header, with Photo's name, as Studio's is. The status says only what Plot's does - whether
// the plotter is there - so the same place means the same thing in all three apps.
export function PhotoHeader({ plotterFound }: Props) {
  const text = plotterFound === null ? "Looking for the plotter…" : plotterFound ? "Plotter connected" : "No plotter";
  return (
    <header className={styles.header}>
      {/* The mark replaces the space, so the name needs saying in full for anything reading it. */}
      <h1 className={styles.title} aria-label="NextDraw Photo">
        {/* Tom's mark, ahead of the name. Decorative: the heading names the app. */}
        <Logo size="1.5em" className={styles.logo} />
        NextDraw
        {/* A lens stands in for the space: what the picture comes through. Decorative - the heading
            still reads "NextDraw Photo" to anything listening. */}
        <Aperture className={styles.titleMark} aria-hidden="true" />
        <span className={styles.titleApp}>Photo</span>
      </h1>
      <span className={styles.tools}>
        <AppSwitch current="photo" />
        <Tag className={styles.status} data-found={Boolean(plotterFound)}>
          <span className={styles.dot} aria-hidden="true" />
          {text}
        </Tag>
      </span>
    </header>
  );
}
