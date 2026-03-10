import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type ChipProps = {
  children: ReactNode;
  className?: string;
};

export function Chip({ children, className }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-[var(--color-border)] bg-white px-3 py-1 text-xs font-semibold text-[var(--color-text)]",
        className,
      )}
    >
      {children}
    </span>
  );
}


