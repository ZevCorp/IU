import type { Metadata } from "next";

import { ProductPage } from "@/components/pages/product-page";
import { SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Producto",
  description: "Documentación clínica en tiempo real con flujo ver, editar y confirmar.",
  alternates: {
    canonical: `${SITE_URL}/producto`,
  },
};

export default function ProductoRoute() {
  return <ProductPage />;
}

