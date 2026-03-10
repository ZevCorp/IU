import type { Metadata } from "next";

import { PricingPage } from "@/components/pages/pricing-page";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Precios",
  description: "Modelo mensual por médico con setup opcional según complejidad.",
  alternates: {
    canonical: `${SITE_URL}/precios`,
  },
};

export default function PreciosRoute() {
  return <PricingPage />;
}

