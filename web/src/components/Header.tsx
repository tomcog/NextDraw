import { Tag } from "@tomcoggia/ui";
import { ThemeToggle } from "./ThemeToggle";
import styles from "./Header.module.css";

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
      <h1 className={styles.title}>NextDraw Plot</h1>
      <span className={styles.tools}>
        <Tag className={styles.status} data-found={plotterFound && !lostContact}>
          <span className={styles.dot} aria-hidden="true" />
          {text}
        </Tag>
        <ThemeToggle />
      </span>
    </header>
  );
}
