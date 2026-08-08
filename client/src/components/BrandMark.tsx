import { cn } from "@/lib/utils";

/**
 * Linply's mark: a source dot with signal arcs radiating from it — the same
 * motif as the sign-in backdrop, meaning one knowledge base reaching many
 * channels. Drawn on a 24px grid with 2px strokes so it stays legible at 16px.
 */
export function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="7" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <path d="M12.5 8.2a5.6 5.6 0 0 1 0 7.6" />
      <path d="M16.6 5.2a10 10 0 0 1 0 13.6" opacity="0.55" />
    </svg>
  );
}

export default function BrandMark({
  className,
  glyphClassName,
}: {
  className?: string;
  glyphClassName?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground",
        className
      )}
    >
      <BrandGlyph className={cn("size-4", glyphClassName)} />
    </span>
  );
}
