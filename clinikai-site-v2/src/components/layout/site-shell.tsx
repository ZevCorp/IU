import type { ReactNode } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

type SiteShellProps = {
  children: ReactNode;
};

export function SiteShell({ children }: SiteShellProps) {
  return (
    <>
      <SiteHeader />
      <main id="main-content" className="pt-[calc(var(--header-height)+8px)]">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}


