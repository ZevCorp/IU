import Image from "next/image";

import { cn } from "@/lib/cn";
import { BRAND_NAME } from "@/lib/constants";

const logoSizes = {
  header: {
    width: 356,
    height: 112,
    className: "h-8 w-auto sm:h-10",
  },
  footer: {
    width: 356,
    height: 112,
    className: "h-9 w-auto sm:h-10",
  },
} as const;

type BrandLogoProps = {
  size?: keyof typeof logoSizes;
  className?: string;
  priority?: boolean;
};

export function BrandLogo({
  size = "header",
  className,
  priority = false,
}: BrandLogoProps) {
  const logo = logoSizes[size];

  return (
    <Image
      src="/clinick-ai-logo.svg"
      alt={BRAND_NAME}
      width={logo.width}
      height={logo.height}
      priority={priority}
      className={cn(logo.className, className)}
    />
  );
}
