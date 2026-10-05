import { useState } from "react";
import { Button, ButtonRound, Spinner } from "@tomcoggia/ui";
import { X } from "lucide-react";
import styles from "./StatusBanner.module.css";

export interface BannerMessage {
  text: string;
  /** Several things to say at once, listed under the text. */
  items?: string[];
  error?: boolean;
  /** Advice rather than a failure: Plot's notes about a drawing. */
  caution?: boolean;
  /** What closing it is remembered by. Without one, each new message object shows again, even with
   *  the same words; with one, a message with the same id stays closed. */
  id?: string;
  /** Something under way: shown with a spinner. */
  working?: boolean;
  /** One thing to do about it, as a button beside the text. */
  action?: { label: string; onClick: () => void };
}

/**
 * Shared: what the app has to say, in a band across the very top of the page that pushes everything
 * down - not on the preview's rulers, where it used to sit. Closing it hides this message; the next
 * one shows again.
 */
export function StatusBanner({ message }: { message: BannerMessage | null }) {
  const [closed, setClosed] = useState<BannerMessage | string | null>(null);
  if (!message?.text || (message.id ?? message) === closed) return null;
  const tone = message.error ? "error" : message.caution ? "caution" : undefined;
  return (
    <div className={styles.banner} role={message.error ? "alert" : "status"} data-tone={tone}>
      {message.working && <Spinner size={14} label={message.text} />}
      <div className={styles.text}>
        {message.text}
        {message.items && message.items.length > 0 && (
          <ul className={styles.items}>{message.items.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
      </div>
      {message.action && (
        <Button size="sm" variant="primary" onClick={message.action.onClick}>{message.action.label}</Button>
      )}
      <ButtonRound
        size="sm"
        variant={tone === "caution" ? "ghost" : "outline-light"}
        icon={<X />}
        aria-label="Close"
        title="Close"
        onClick={() => setClosed(message.id ?? message)}
      />
    </div>
  );
}
