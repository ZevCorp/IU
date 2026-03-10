"use client";

import Link from "next/link";

import { TrackedAnchor } from "@/components/analytics/tracked-anchor";
import { buttonStyles } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Reveal } from "@/components/ui/reveal";
import { trackEvent } from "@/lib/analytics";
import { WHATSAPP_URL } from "@/lib/constants";

const plans = [
  {
    name: "Individual",
    segment: "B2C",
    price: "Desde [PRECIO_DESDE]",
    detail: "Para profesionales que buscan velocidad en consulta diaria.",
  },
  {
    name: "Clínica",
    segment: "B2B piloto",
    price: "Desde [PRECIO_DESDE]",
    detail: "Modelo por médico con setup opcional según complejidad.",
  },
  {
    name: "Hospital",
    segment: "Enterprise",
    price: "Desde [PRECIO_DESDE]",
    detail: "Implementación por servicios con alcance técnico acordado.",
  },
];

export function PricingPage() {
  return (
    <div className="bg-white">
      <section className="section-pad border-b border-[var(--color-border)]">
        <div className="container-xl">
          <Chip>Precios</Chip>
          <h1 className="mt-4 font-display text-4xl font-extrabold tracking-tight text-[var(--color-text)] sm:text-5xl">
            Precios simples, orientados a valor clínico
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[color:rgb(59,70,84)]">
            El modelo combina tarifa mensual por médico y setup opcional según complejidad de flujo,
            sistema y validaciones.
          </p>
        </div>
      </section>

      <section className="section-pad">
        <div className="container-xl grid gap-4 lg:grid-cols-3">
          {plans.map((plan, index) => (
            <Reveal key={plan.name} delay={0.04 * index}>
              <article className="rounded-[20px] border border-[var(--color-border)] p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-brand)]">
                  {plan.segment}
                </p>
                <h2 className="mt-2 font-display text-2xl font-semibold text-[var(--color-text)]">
                  {plan.name}
                </h2>
                <p className="mt-4 text-xl font-semibold text-[var(--color-text)]">{plan.price}</p>
                <p className="mt-3 text-sm leading-relaxed text-[color:rgb(59,70,84)]">{plan.detail}</p>
                <p className="mt-2 text-xs text-[color:rgb(94,107,123)]">
                  Setup opcional según complejidad.
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section-pad bg-[var(--color-surface)]">
        <div className="container-xl rounded-[22px] border border-[var(--color-border)] bg-white p-8">
          <h2 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">
            Solicita una propuesta
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[color:rgb(59,70,84)]">
            En el diagnóstico inicial definimos alcance, sistemas objetivo, complejidad de interfaz y
            plan de piloto.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/contacto"
              onClick={() => trackEvent("demo_cta_click", { location: "pricing_page" })}
              className={buttonStyles({ variant: "primary", size: "lg" })}
            >
              Solicitar propuesta
            </Link>
            <TrackedAnchor
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              eventName="whatsapp_click"
              payload={{ location: "pricing_page" }}
              className={buttonStyles({ variant: "secondary", size: "lg" })}
            >
              Hablar por WhatsApp
            </TrackedAnchor>
          </div>
        </div>
      </section>
    </div>
  );
}

