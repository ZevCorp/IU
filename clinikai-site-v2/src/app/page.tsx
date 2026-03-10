import type { Metadata } from "next";

import { HomePage } from "@/components/pages/home-page";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Tu nota clínica. Sin teclado.",
  description: "ClinikAI documenta en tu sistema mientras hablas.",
  alternates: {
    canonical: `${SITE_URL}/`,
  },
};

const softwareSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "ClinikAI",
  applicationCategory: "HealthApplication",
  operatingSystem: "macOS, Windows (próximamente)",
  offers: {
    "@type": "Offer",
    price: "[PRECIO_DESDE]",
    priceCurrency: "USD",
  },
  description:
    "Sistema de documentación clínica que convierte voz a texto y lo escribe en software médico existente, con revisión médica previa a confirmación.",
  featureList: [
    "Escucha por micrófono ambiente",
    "Conversión de voz a texto plano",
    "Escritura automática en la interfaz del software médico",
    "Revisión médica antes de finalizar",
  ],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareSchema) }}
      />
      <HomePage />
    </>
  );
}

