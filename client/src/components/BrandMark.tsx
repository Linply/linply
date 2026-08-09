import { cn } from "@/lib/utils";

/**
 * The Linply logo, drawn to match `public/favicon.svg` exactly — same 32px
 * grid, same stroke weight, same accent square. The in-app mark and the browser
 * tab icon are the same drawing, so they cannot drift apart.
 *
 * The stroke follows `currentColor` (near-black on light, white on dark, which
 * is what the favicon's own media query does) and the accent comes from the
 * `--brand-accent` token.
 */
export function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="Linply"
    >
      <path
        d="M7.125 7.125V24.875H24.875"
        stroke="currentColor"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="12.4"
        y="12"
        width="8.5"
        height="8.5"
        rx="2.6"
        fill="var(--brand-accent)"
      />
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
        "flex size-8 shrink-0 items-center justify-center text-foreground",
        className
      )}
    >
      <BrandGlyph className={cn("size-full", glyphClassName)} />
    </span>
  );
}
