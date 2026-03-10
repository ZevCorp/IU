"use client";

import Link from "next/link";

import { TrackedAnchor } from "@/components/analytics/tracked-anchor";
import { buttonStyles } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Reveal } from "@/components/ui/reveal";
import { trackEvent } from "@/lib/analytics";
import { WHATSAPP_URL } from "@/lib/constants";

const fields = ["Motivo", "Antecedentes", "Examen", "Dx", "Plan", "Medicamentos"];

export function ProductPage() {
  return (
    <div className="bg-white pb-28 lg:pb-0">
      <section className="section-pad border-b border-[var(--color-border)]">
        <div className="container-xl">
          <Chip>Producto</Chip>
          <h1 className="mt-4 font-display text-4xl font-extrabold tracking-tight text-[var(--color-text)] sm:text-5xl">
            Documentación clínica en tiempo real
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[color:rgb(59,70,84)]">
            ClinikAI escucha la consulta, convierte voz a texto plano y lo escribe en tu software
            médico existente controlando la interfaz. El médico mantiene siempre el control final.
          </p>
        </div>
      </section>

      <section className="section-pad">
        <div className="container-xl grid-12 gap-y-8">
          <article className="col-span-12 lg:col-span-8 space-y-10">
            <Reveal>
              <section className="rounded-[20px] border border-[var(--color-border)] p-6">
                <h2 className="font-display text-3xl font-bold text-[var(--color-text)]">
                  El flujo (ver, editar, confirmar)
                </h2>
                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  {[
                    { title: "Ver", desc: "ClinikAI captura la conversación clínica relevante." },
                    {
                      title: "Editar",
                      desc: "El profesional revisa y ajusta la nota según criterio clínico.",
                    },
                    {
                      title: "Confirmar",
                      desc: "Solo el médico realiza el clic final de guardado/envío.",
                    },
                  ].map((item) => (
                    <div key={item.title} className="rounded-[16px] bg-[var(--color-surface)] p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-brand)]">
                        {item.title}
                      </p>
                      <p className="mt-2 text-sm text-[var(--color-text)]">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </section>
            </Reveal>

            <Reveal delay={0.06}>
              <section className="rounded-[20px] border border-[var(--color-border)] p-6">
                <h2 className="font-display text-3xl font-bold text-[var(--color-text)]">
                  Qué llena ClinikAI
                </h2>
                <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                  {fields.map((field) => (
                    <li
                      key={field}
                      className="rounded-[14px] border border-[var(--color-border)] px-4 py-3 text-sm font-medium text-[var(--color-text)]"
                    >
                      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[var(--color-accent)]" aria-hidden />
                      {field}
                    </li>
                  ))}
                </ul>
              </section>
            </Reveal>

            <Reveal delay={0.1}>
              <section className="rounded-[20px] border border-[var(--color-border)] p-6">
                <h2 className="font-display text-3xl font-bold text-[var(--color-text)]">
                  macOS hoy, Windows pronto
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-[color:rgb(59,70,84)]">
                  ClinikAI opera hoy en macOS. El soporte para Windows está previsto en
                  aproximadamente 2 a 3 semanas, según validación final de compatibilidad.
                </p>
              </section>
            </Reveal>

            <Reveal delay={0.14}>
              <section className="rounded-[20px] border border-[var(--color-border)] p-6">
                <h2 className="font-display text-3xl font-bold text-[var(--color-text)]">Ideal para...</h2>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <article className="rounded-[16px] bg-[var(--color-surface)] p-4">
                    <h3 className="font-display text-xl font-semibold text-[var(--color-text)]">
                      Medicina general
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-[color:rgb(59,70,84)]">
                      Consultas de alto volumen donde la velocidad de registro impacta la capacidad
                      diaria.
                    </p>
                  </article>
                  <article className="rounded-[16px] bg-[var(--color-surface)] p-4">
                    <h3 className="font-display text-xl font-semibold text-[var(--color-text)]">
                      Pediatría
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-[color:rgb(59,70,84)]">
                      Entornos donde sostener la conversación con familia y paciente es crítico.
                    </p>
                  </article>
                </div>
              </section>
            </Reveal>
          </article>

          <aside className="col-span-12 lg:col-span-4">
            <div className="hidden rounded-[20px] border border-[var(--color-border)] p-5 lg:sticky lg:top-28 lg:block">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-brand)]">
                CTA
              </p>
              <h3 className="mt-2 font-display text-2xl font-semibold text-[var(--color-text)]">
                Valida tu flujo en un piloto
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[color:rgb(59,70,84)]">
                Revisamos pantallas, campos y validaciones para integrar ClinikAI en tu operación
                real.
              </p>
              <Link
                href="/contacto"
                onClick={() => trackEvent("demo_cta_click", { location: "producto_sticky" })}
                className={buttonStyles({ variant: "primary", size: "md", className: "mt-5 w-full" })}
              >
                Solicitar demo
              </Link>
              <TrackedAnchor
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                eventName="whatsapp_click"
                payload={{ location: "producto_sticky" }}
                className={buttonStyles({ variant: "secondary", size: "md", className: "mt-2 w-full" })}
              >
                Hablar por WhatsApp
              </TrackedAnchor>
            </div>
          </aside>
        </div>
      </section>

      <div className="fixed inset-x-4 bottom-4 z-40 rounded-[16px] border border-[var(--color-border)] bg-white/95 p-3 shadow-[0_14px_30px_rgba(11,15,20,0.15)] backdrop-blur-sm lg:hidden">
        <div className="flex gap-2">
          <Link
            href="/contacto"
            onClick={() => trackEvent("demo_cta_click", { location: "producto_bottom_bar" })}
            className={buttonStyles({ variant: "primary", size: "sm", className: "flex-1" })}
          >
            Solicitar demo
          </Link>
          <TrackedAnchor
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            eventName="whatsapp_click"
            payload={{ location: "producto_bottom_bar" }}
            className={buttonStyles({ variant: "secondary", size: "sm", className: "flex-1" })}
          >
            WhatsApp
          </TrackedAnchor>
        </div>
      </div>
    </div>
  );
}

