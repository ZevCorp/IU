import * as React from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "tertiary";
type Size = "sm" | "md" | "lg";

export function buttonStyles({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-[220ms] ease-[cubic-bezier(0.215,0.61,0.355,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-white";

  const sizeMap: Record<Size, string> = {
    sm: "h-10 px-4 text-sm",
    md: "h-11 px-5 text-sm sm:text-base",
    lg: "h-12 px-6 text-base",
  };

  const variantMap: Record<Variant, string> = {
    primary:
      "bg-[var(--color-brand)] text-white shadow-[0_10px_24px_rgba(77,163,255,0.26)] hover:-translate-y-[1px] hover:shadow-[0_14px_30px_rgba(77,163,255,0.3)]",
    secondary:
      "border border-[var(--color-border-strong)] bg-white text-[var(--color-text)] hover:bg-[var(--color-surface)]",
    tertiary: "text-[var(--color-text)] hover:bg-[var(--color-surface)]",
  };

  return cn(base, sizeMap[size], variantMap[variant], className);
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={buttonStyles({ variant, size, className })}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";

