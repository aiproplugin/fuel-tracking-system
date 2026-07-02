import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * SINGLE SOURCE OF TRUTH for the brand mark.
 *
 * Every appearance of the logo (login, /home, admin sidebar, QR print
 * sheets, future screens) renders through this component, which reads
 * public/logo.png. Swapping that file for any near-square image updates the
 * whole UI with no code changes — see "Swapping the logo" in README.md.
 *
 * `object-contain` inside a fixed square tile guarantees no distortion for
 * any aspect ratio; next/image serves DPR-appropriate sizes so the mark
 * stays crisp on high-DPI displays.
 */

const LOGO_SRC = "/logo.png";
const LOGO_ALT = "Macksons";

const TILE_SIZES = {
  /** Admin sidebar tile (matches the prototype's 40px sidebar mark). */
  sm: { tile: "h-10 w-10 rounded-xl p-1.5", px: 40 },
  /** Compact headers (e.g. /home). */
  md: { tile: "h-11 w-11 rounded-2xl p-1.5", px: 44 },
  /** Login hero tile (prototype M1: 56px rounded-2xl). */
  lg: { tile: "h-14 w-14 rounded-2xl p-2", px: 56 },
  /** QR print sheet header. */
  print: { tile: "h-24 w-24 rounded-2xl p-2.5", px: 96 },
} as const;

export type LogoSize = keyof typeof TILE_SIZES;

export interface LogoProps {
  size?: LogoSize;
  /** Extra classes for the tile (e.g. border tweaks on dark surfaces). */
  className?: string;
}

export function Logo({ size = "md", className }: LogoProps) {
  const { tile, px } = TILE_SIZES[size];
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-border bg-white",
        tile,
        className,
      )}
    >
      <Image
        src={LOGO_SRC}
        alt={LOGO_ALT}
        width={px * 2}
        height={px * 2}
        sizes={`${px}px`}
        className="h-full w-full object-contain"
        priority={size === "lg"}
      />
    </span>
  );
}
