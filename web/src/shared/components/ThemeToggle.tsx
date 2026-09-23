import { useState } from "react";
import { ButtonRound } from "@tomcoggia/ui";
import { Moon, Sun } from "lucide-react";
import { applyTheme, readTheme, type Theme } from "../lib/theme";

// In Studio's Setup area; both apps follow what it sets. It shows the theme you'd switch to, not the one you're in,
// which is what makes a single button legible without a label.
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <ButtonRound
      size="sm"
      variant="ghost"
      className={className}
      icon={next === "dark" ? <Moon /> : <Sun />}
      aria-label={`Switch to the ${next} theme`}
      title={`Switch to the ${next} theme`}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
    />
  );
}
