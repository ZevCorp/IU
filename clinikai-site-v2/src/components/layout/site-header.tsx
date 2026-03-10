"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { buttonStyles } from "@/components/ui/button";
import { trackEvent } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { mainNav, WHATSAPP_URL } from "@/lib/constants";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-[var(--color-border)] bg-white/90 backdrop-blur-sm">
      <div className="container-xl flex h-[var(--header-height)] items-center justify-between gap-4">
        <Link href="/" className="inline-flex items-center gap-3" aria-label="ClinikAI inicio">
          <Image
            src="/Logo-clinkiAi.png"
            alt="Logo ClinikAI"
            width={38}
            height={38}
            priority
            className="h-9 w-9 rounded-[10px] object-contain"
          />
          <span className="font-display text-lg font-bold tracking-tight text-[var(--color-text)]">
            ClinikAI
          </span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex" aria-label="Principal">
          {mainNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "text-sm font-medium transition-colors hover:text-[var(--color-brand)]",
                pathname === item.href ? "text-[var(--color-brand)]" : "text-[var(--color-text)]",
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent("whatsapp_click", { location: "header" })}
            className={cn(buttonStyles({ variant: "secondary", size: "sm" }), "hidden sm:inline-flex")}
          >
            <WhatsAppIcon /> Hablar por WhatsApp
          </a>

          <Link
            href="/contacto"
            onClick={() => trackEvent("demo_cta_click", { location: "header" })}
            className={buttonStyles({ variant: "primary", size: "sm" })}
          >
            Solicitar demo
          </Link>

          <button
            type="button"
            aria-label="Abrir menu"
            className="grid h-10 w-10 place-items-center rounded-full border border-[var(--color-border)] md:hidden"
            onClick={() => setOpen((current) => !current)}
          >
            <span className="sr-only">Menu</span>
            <div className="space-y-1">
              <span className="block h-0.5 w-4 bg-[var(--color-text)]" />
              <span className="block h-0.5 w-4 bg-[var(--color-text)]" />
              <span className="block h-0.5 w-4 bg-[var(--color-text)]" />
            </div>
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-[var(--color-border)] bg-white px-6 py-4 md:hidden">
          <div className="space-y-3">
            {mainNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block text-sm font-medium text-[var(--color-text)]"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent("whatsapp_click", { location: "mobile_menu" })}
              className={buttonStyles({ variant: "secondary", size: "sm", className: "w-full" })}
            >
              <WhatsAppIcon /> Hablar por WhatsApp
            </a>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function WhatsAppIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M20.5 11.79C20.5 16.47 16.67 20.25 12 20.25C10.52 20.25 9.12 19.87 7.9 19.2L4.5 20.25L5.58 16.96C4.88 15.72 4.5 14.3 4.5 12.79C4.5 8.11 8.33 4.33 13 4.33C17.67 4.33 20.5 8.11 20.5 11.79Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.1 10.4C9.32 9.89 9.56 9.85 9.9 9.83C10.18 9.81 10.5 9.82 10.74 9.82C10.98 9.82 11.36 9.74 11.7 10.49C12.04 11.24 12.86 13 12.95 13.15C13.04 13.29 13.1 13.48 12.99 13.69C12.88 13.9 12.83 14.03 12.62 14.27C12.41 14.5 12.18 14.79 12.02 14.97C11.84 15.17 11.64 15.39 11.86 15.77C12.08 16.15 12.84 17.39 14.01 18.25C15.49 19.34 16.72 19.67 17.13 19.84C17.54 20.01 17.78 19.97 17.96 19.76C18.14 19.55 18.71 18.88 18.92 18.58C19.13 18.28 19.34 18.32 19.61 18.43C19.88 18.54 21.33 19.25 21.62 19.39C21.91 19.53 22.1 19.6 22.17 19.72C22.24 19.84 22.24 20.42 21.95 20.99C21.66 21.56 20.3 22.21 19.71 22.27C19.12 22.33 18.57 22.54 15.2 21.14C11.18 19.47 8.56 14.9 8.35 14.61C8.14 14.31 6.74 12.41 6.74 10.45C6.74 8.49 7.8 7.54 8.2 7.12C8.6 6.7 9.07 6.6 9.35 6.6C9.56 6.6 9.8 6.61 10 6.62"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
