import { useState } from "react";
import { ButtonRound, Spinner } from "@tomcoggia/ui";
import { X } from "lucide-react";
import styles from "./StatusBanner.module.css";

export interface BannerMessage {
  text: string;
  error?: boolean;
  /** Something under way: shown with a spinner. */
  working?: boolean;
}

/**
 * Shared: what the app has to say, in a band across the very top of the page that pushes everything
 * down - not on the preview's rulers, where it used to sit. Closing it hides this message; the next
 * one shows again.
 */
export function StatusBanner({ message }: { message: BannerMessage | null }) {
  // The message closed, by identity: a new message object is a new message, even with the same words.
  const [closed, setClosed] = useState<BannerMessage | null>(null);
  if (!message?.text || message === closed) return null;
  return (
    <div className={styles.banner} role={message.error ? "alert" : "status"} data-tone={message.error ? "error" : undefined}>
      {message.working && <Spinner size={14} label={message.text} />}
      <span className={styles.text}>{message.text}</span>
      <ButtonRound size="sm" variant="outline-light" icon={<X />} aria-label="Close" title="Close" onClick={() => setClosed(message)} />
    </div>
  );
}
