import type { Metadata } from "next";

import { ContactPage } from "@/components/pages/contact-page";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Contacto",
  description: "Formulario corto para solicitar demo o piloto de ClinikAI.",
  alternates: {
    canonical: `${SITE_URL}/contacto`,
  },
};

export default function ContactoRoute() {
  return <ContactPage />;
}

