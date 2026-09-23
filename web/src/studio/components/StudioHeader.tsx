import { Tag } from "@tomcoggia/ui";
import { PenTool } from "lucide-react";
import { ThemeToggle } from "../../shared/components/ThemeToggle";
import { AppSwitch } from "../../shared/components/AppSwitch";
import styles from "../../shared/components/Header.module.css";

interface Props {
  message: string;
  ok: boolean;
}

// Plot's header, with Studio's name and its own status line. The styles are Plot's own file rather
// than a copy, so the two apps can't drift apart at the top of the window.
export function StudioHeader({ message, ok }: Props) {
  return (
    <header className={styles.header}>
      {/* The mark replaces the space, so the name needs saying in full for anything reading it. */}
      <h1 className={styles.title} aria-label="NextDraw Studio">
        NextDraw
        {/* The nib stands in for the space, so the name carries the tool it is about. It's decorative:
            the heading still reads "NextDraw Studio" to anything listening. */}
        <PenTool className={styles.titleMark} aria-hidden="true" />
        <span className={styles.titleApp}>Studio</span>
      </h1>
      <span className={styles.tools}>
        <AppSwitch current="studio" />
        <Tag className={styles.status} data-found={ok}>
          <span className={styles.dot} aria-hidden="true" />
          {message}
        </Tag>
        <ThemeToggle />
      </span>
    </header>
  );
}
