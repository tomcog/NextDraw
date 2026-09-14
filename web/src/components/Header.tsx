import { Tag } from "@tomcoggia/ui";
import styles from "./Header.module.css";

interface Props {
  plotterFound: boolean;
  lostContact: boolean;
}

export function Header({ plotterFound, lostContact }: Props) {
  const text = lostContact
    ? "Lost contact with NextDraw Studio. Is server.py still running?"
    : plotterFound ? "Plotter connected" : "No plotter found on USB";
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>NextDraw Studio</h1>
      <Tag className={styles.status} data-found={plotterFound && !lostContact}>
        <span className={styles.dot} aria-hidden="true" />
        {text}
      </Tag>
    </header>
  );
}
