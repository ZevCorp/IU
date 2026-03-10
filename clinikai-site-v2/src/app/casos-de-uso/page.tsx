import type { Metadata } from "next";

import { UseCasesPage } from "@/components/pages/use-cases-page";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Casos de uso",
  description: "Escenarios clínicos iniciales: consulta general, pediatría y rondas hospitalarias en roadmap.",
  alternates: {
    canonical: `${SITE_URL}/casos-de-uso`,
  },
};

export default function CasosRoute() {
  return <UseCasesPage />;
}

