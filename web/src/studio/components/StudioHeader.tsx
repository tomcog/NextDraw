import { Tag } from "@tomcoggia/ui";
import { ThemeToggle } from "../../components/ThemeToggle";
import styles from "../../components/Header.module.css";

interface Props {
  message: string;
  ok: boolean;
}

// Plot's header, with Studio's name and its own status line. The styles are Plot's own file rather
// than a copy, so the two apps can't drift apart at the top of the window.
export function StudioHeader({ message, ok }: Props) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>NextDraw Studio</h1>
      <span className={styles.tools}>
        <Tag className={styles.status} data-found={ok}>
          <span className={styles.dot} aria-hidden="true" />
          {message}
        </Tag>
        <ThemeToggle />
      </span>
    </header>
  );
}
