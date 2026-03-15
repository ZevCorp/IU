import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, Manrope } from "next/font/google";

import { ScrollDepthTracker } from "@/components/analytics/scroll-depth-tracker";
import { SiteShell } from "@/components/layout/site-shell";
import { BRAND_NAME, SITE_URL } from "@/lib/constants";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://example.com"),
  title: {
    default: `${BRAND_NAME} | Documentación clínica en tiempo real`,
    template: `%s | ${BRAND_NAME}`,
  },
  description:
    `${BRAND_NAME} documenta en tu sistema mientras hablas. Flujo con revisión médica y clic final de confirmación.`,
  applicationName: BRAND_NAME,
  keywords: [BRAND_NAME, "ClinikAI", "documentación clínica", "HealthTech", "HIS", "EMR", "voz a texto médico"],
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    type: "website",
    locale: "es_ES",
    title: `${BRAND_NAME} | Tu nota clínica. Sin teclado.`,
    description: `${BRAND_NAME} documenta en tu sistema mientras hablas.`,
    url: SITE_URL,
    siteName: BRAND_NAME,
    images: [
      {
        url: "/og-clinikai.svg",
        width: 1200,
        height: 630,
        alt: BRAND_NAME,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND_NAME} | Tu nota clínica. Sin teclado.`,
    description: `${BRAND_NAME} documenta en tu sistema mientras hablas.`,
    images: ["/og-clinikai.svg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="es" className="scroll-smooth">
      <body
        className={`${inter.variable} ${manrope.variable} bg-[var(--color-bg)] text-[var(--color-text)] antialiased`}
      >
        <a href="#main-content" className="skip-link">
          Saltar al contenido
        </a>
        <ScrollDepthTracker />
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
