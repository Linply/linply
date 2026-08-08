import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES, useLocale, useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { Check, Languages } from "lucide-react";

export default function LanguageToggle({
  className,
  variant = "icon",
}: {
  className?: string;
  /** `icon` for dense chrome, `full` when there is room for the label. */
  variant?: "icon" | "full";
}) {
  const { locale, setLocale } = useLocale();
  const t = useT();
  const active = LOCALES.find(item => item.value === locale);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t.common.language}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-full border border-border bg-card text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
            variant === "icon" ? "w-8 justify-center" : "px-3",
            className
          )}
        >
          <Languages className="size-3.5" />
          {variant === "full" ? <span>{active?.label}</span> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {LOCALES.map(item => (
          <DropdownMenuItem
            key={item.value}
            onSelect={() => setLocale(item.value)}
            className="justify-between"
          >
            {item.label}
            {item.value === locale ? <Check className="size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
