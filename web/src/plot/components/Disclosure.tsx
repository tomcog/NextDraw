import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import styles from "./Disclosure.module.css";

interface Props {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}

// A collapsible section under the preview. The component library has no disclosure component,
// so this is a native <details> styled with the library's tokens.
export function Disclosure({ title, children, defaultOpen = false }: Props) {
  return (
    <details className={styles.disclosure} open={defaultOpen || undefined}>
      <summary className={styles.summary}>
        <ChevronRight className={styles.chevron} aria-hidden="true" />
        {title}
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}
