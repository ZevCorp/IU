import type { Metadata } from "next";

import { SecurityPage } from "@/components/pages/security-page";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Seguridad y Privacidad",
  description: "Transparencia sobre captura, procesamiento on-device, control médico y buenas prácticas.",
  alternates: {
    canonical: `${SITE_URL}/seguridad-privacidad`,
  },
};

export default function SeguridadRoute() {
  return <SecurityPage />;
}

