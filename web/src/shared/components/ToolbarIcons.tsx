import type { ReactNode } from "react";
import { LucideProvider } from "lucide-react";

/** Every lucide icon inside drawn with a 1px line on screen, whatever size it shows at - wrapped
 *  round each toolbar, so they all match the 1px of the icons drawn from the Figma file. */
export function ToolbarIcons({ children }: { children: ReactNode }) {
  return (
    <LucideProvider strokeWidth={1} nonScalingStroke>
      {children}
    </LucideProvider>
  );
}
