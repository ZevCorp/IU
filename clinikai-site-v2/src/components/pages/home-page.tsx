"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useState } from "react";

import { DemoSimulator } from "@/components/home/demo-simulator";
import { buttonStyles } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { FaqAccordion, type FaqItem } from "@/components/ui/faq-accordion";
import { Reveal } from "@/components/ui/reveal";
import { UseCaseTabs, type UseCaseTab } from "@/components/ui/tabs";
import { trackEvent } from "@/lib/analytics";
import { WHATSAPP_URL } from "@/lib/constants";

const problemCards = [
  "Tiempo perdido documentando",
  "Menos conexión con el paciente",
  "Errores por fatiga / prisa",
];

const benefits = [
  {
    title: "Ahorro de tiempo por consulta",
    metric: "hasta 30%",
    note: "En pilotos de scribes/ambient AI se reportan reducciones ~20–30% en tiempo de documentación (varía por flujo y sistema).",
  },
  {
    title: "Más pacientes al día",
    metric: "+3–5 pacientes/día",
    note: "Promedio estimado cuando se liberan minutos por encuentro; depende de agenda y especialidad.",
  },
  {
    title: "Notas más completas",
    metric: "Estructura consistente",
    note: "Resultados varían según flujo y sistema. Medimos impacto en piloto.",
  },
];

const cases: UseCaseTab[] = [
  {
    id: "general",
    label: "Consulta general",
    title: "Consulta general con foco en velocidad clínica",
    story:
      "Mientras el médico conversa, ClinikAI estructura la nota clínica y la escribe en el software existente sin interrumpir la atención.",
    fields: ["Motivo", "Antecedentes", "Examen", "Dx", "Plan", "Medicamentos"],
  },
  {
    id: "pediatria",
    label: "Pediatría",
    title: "Pediatría con documentación clara para seguimiento",
    story:
      "Permite mantener contacto visual con familia y paciente mientras los campos clave quedan registrados en tiempo real.",
    fields: ["Motivo", "Peso/Talla", "Antecedentes", "Examen", "Plan", "Indicaciones"],
  },
  {
    id: "rondas",
    label: "(Próximo) Rondas",
    title: "Rondas hospitalarias en evolución",
    story:
      "En roadmap: soporte a flujos de internistas y rondas, validando plantillas y atajos por servicio.",
    fields: ["Evolución", "Indicaciones", "Diagnóstico", "Conducta"],
    status: "Próximo",
  },
];

const faqs: FaqItem[] = [
  {
    question: "¿Se equivoca?",
    answer:
      "Puede cometer errores como cualquier sistema de transcripción. Por eso el flujo incluye revisión médica y clic final obligatorio antes de guardar o enviar.",
  },
  {
    question: "¿Qué pasa con la privacidad?",
    answer:
      "En la etapa actual el procesamiento se asume on-device/local. Además, se aplica minimización de datos y controles de acceso sobre el entorno clínico.",
  },
  {
    question: "¿Funciona con mi sistema?",
    answer:
      "Funciona sobre interfaces (UI). Validamos tu flujo real en un piloto para confirmar pantallas, plantillas, campos, atajos y validaciones.",
  },
  {
    question: "¿macOS/Windows?",
    answer:
      "Hoy corre en macOS. La versión para Windows está planificada para las próximas 2 a 3 semanas.",
  },
];

const checklist = ["pantallas/plantillas", "campos", "atajos", "validaciones"];

export function HomePage() {
  const [isDemoOpen, setIsDemoOpen] = useState(false);

  const openDemoModal = () => {
    trackEvent("demo_cta_click", { location: "hero_video" });
    setIsDemoOpen(true);
  };

  return (
    <div className="bg-white">
      <section className="relative overflow-hidden" id="hero">
        <div className="absolute inset-0 -z-10">
          <div
            className="absolute inset-0 opacity-70"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(77,163,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(77,163,255,0.08) 1px, transparent 1px)",
              backgroundSize: "48px 48px",
            }}
          />
          <div className="pointer-events-none absolute -left-28 -top-28 h-[360px] w-[360px] rounded-full bg-[radial-gradient(circle,rgba(77,163,255,0.24)_0%,rgba(77,163,255,0)_70%)] blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -right-16 h-[360px] w-[360px] rounded-full bg-[radial-gradient(circle,rgba(34,211,197,0.22)_0%,rgba(34,211,197,0)_72%)] blur-3xl" />
        </div>

        <div className="container-xl grid min-h-[calc(100vh-80px)] grid-cols-1 items-start gap-10 pt-10 pb-16 lg:grid-cols-2 lg:pt-12">
          <Reveal delay={0.04}>
            <Chip>Revisión antes de finalizar.</Chip>
            <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight text-[var(--color-text)] sm:text-5xl md:text-6xl">
              Tu nota clínica. Sin teclado.
            </h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-[color:rgb(59,70,84)]">
              ClinikAI documenta en tu sistema mientras hablas.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/contacto"
                onClick={() => trackEvent("demo_cta_click", { location: "hero_primary" })}
                className={buttonStyles({ variant: "primary", size: "lg" })}
              >
                Solicitar demo
              </Link>
              <button
                type="button"
                onClick={openDemoModal}
                className={buttonStyles({ variant: "secondary", size: "lg" })}
              >
                Ver 30 segundos
              </button>
            </div>
            <p className="mt-4 text-sm text-[color:rgb(94,107,123)]">
              Diseñado para consultas. Listo para escalar.
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <button
              type="button"
              onClick={openDemoModal}
              className="w-full text-left"
              aria-label="Abrir demo visual de 30 segundos"
            >
              <DemoSimulator />
            </button>
          </Reveal>
        </div>
      </section>

      <section className="section-pad bg-[var(--color-surface)]" id="problema">
        <div className="container-xl">
          <Reveal>
            <h2 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">
              El problema es simple
            </h2>
          </Reveal>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {problemCards.map((card, index) => (
              <Reveal key={card} delay={0.08 + index * 0.06}>
                <article className="rounded-[18px] border border-[var(--color-border)] bg-white p-5 shadow-[0_8px_22px_rgba(11,15,20,0.04)] transition-transform duration-[220ms] hover:-translate-y-[2px]">
                  <h3 className="font-display text-xl font-semibold text-[var(--color-text)]">{card}</h3>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="section-pad" id="como-funciona">
        <div className="container-xl">
          <Reveal>
            <h2 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">
              Cómo funciona
            </h2>
          </Reveal>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              "Hablas con el paciente",
              "ClinikAI documenta en tu sistema",
              "Revisas y confirmas",
            ].map((step, index) => (
              <Reveal key={step} delay={0.06 * index}>
                <article className="rounded-[18px] border border-[var(--color-border)] bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-brand)]">
                    Paso {index + 1}
                  </p>
                  <h3 className="mt-3 font-display text-xl font-semibold text-[var(--color-text)]">{step}</h3>
                </article>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.2}>
            <ProcessDiagram />
          </Reveal>
        </div>
      </section>

      <section className="section-pad bg-[var(--color-surface)]" id="beneficios">
        <div className="container-xl">
          <Reveal>
            <h2 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">
              Beneficios operativos
            </h2>
          </Reveal>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {benefits.map((item, index) => (
              <Reveal key={item.title} delay={0.06 * index}>
                <article className="rounded-[18px] border border-[var(--color-border)] bg-white p-5">
                  <p className="text-sm font-medium text-[color:rgb(59,70,84)]">{item.title}</p>
                  <p className="mt-2 font-display text-3xl font-bold text-[var(--color-text)]">{item.metric}</p>
                  <p className="mt-2 text-xs text-[color:rgb(94,107,123)]">{item.note}</p>
                </article>
              </Reveal>
            ))}
          </div>
          <p className="mt-4 text-xs text-[color:rgb(94,107,123)]">
            Resultados varían según flujo y sistema. Medimos impacto en piloto.
          </p>
        </div>
      </section>

      <section className="section-pad" id="casos-de-uso">
        <div className="container-xl">
          <Reveal>
            <h2 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">
              Casos de uso
            </h2>
          </Reveal>
          <div className="mt-8">
            <UseCaseTabs items={cases} />
          </div>
        </div>
      </section>

      <section className="section-pad bg-[var(--color-surface)]" id="compatibilidad">
        <div className="container-xl">
          <Reveal>
            <h2 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">
              Compatibilidad
            </h2>
            <p className="mt-3 max-w-3xl text-base leading-relaxed text-[color:rgb(59,70,84)]">
              Funciona sobre interfaces (UI). Validamos tu flujo en un piloto.
            </p>
          </Reveal>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {checklist.map((item, index) => (
              <Reveal key={item} delay={0.05 * index}>
                <li className="rounded-[14px] border border-[var(--color-border)] bg-white px-4 py-3 text-sm font-medium text-[var(--color-text)]">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[var(--color-accent)]" aria-hidden />
                  {item}
                </li>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      <section className="section-pad" id="seguridad-resumen">
        <div className="container-xl">
          <Reveal>
            <h2 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">
              Seguridad & Privacidad
            </h2>
          </Reveal>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {["On-device (etapa inicial)", "Control del médico", "Minimización de datos"].map(
              (item, index) => (
                <Reveal key={item} delay={0.05 * index}>
                  <article className="rounded-[18px] border border-[var(--color-border)] bg-white p-5">
                    <p className="font-display text-xl font-semibold text-[var(--color-text)]">{item}</p>
                  </article>
                </Reveal>
              ),
            )}
          </div>
          <Link
            href="/seguridad-privacidad"
            className={buttonStyles({ variant: "secondary", size: "md", className: "mt-6" })}
          >
            Ver página completa
          </Link>
        </div>
      </section>

      <section className="section-pad bg-[var(--color-surface)]" id="precios">
        <div className="container-xl">
          <Reveal>
            <h2 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">Precios</h2>
          </Reveal>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {[
              {
                name: "Individual",
                subtitle: "B2C",
                price: "Desde [PRECIO_DESDE]",
                detail: "Plan mensual por médico.",
              },
              {
                name: "Clínica",
                subtitle: "B2B piloto",
                price: "Desde [PRECIO_DESDE]",
                detail: "Incluye validación de flujo y puesta en marcha.",
              },
              {
                name: "Hospital",
                subtitle: "Enterprise",
                price: "Desde [PRECIO_DESDE]",
                detail: "Escalable por servicios y complejidad operativa.",
              },
            ].map((plan, index) => (
              <Reveal key={plan.name} delay={0.05 * index}>
                <article className="rounded-[18px] border border-[var(--color-border)] bg-white p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-brand)]">
                    {plan.subtitle}
                  </p>
                  <h3 className="mt-2 font-display text-2xl font-semibold text-[var(--color-text)]">
                    {plan.name}
                  </h3>
                  <p className="mt-4 text-lg font-semibold text-[var(--color-text)]">{plan.price}</p>
                  <p className="mt-2 text-sm text-[color:rgb(59,70,84)]">{plan.detail}</p>
                </article>
              </Reveal>
            ))}
          </div>
          <p className="mt-4 text-sm text-[color:rgb(94,107,123)]">Setup opcional según complejidad.</p>
          <Link
            href="/contacto"
            onClick={() => trackEvent("demo_cta_click", { location: "pricing_home" })}
            className={buttonStyles({ variant: "primary", size: "md", className: "mt-6" })}
          >
            Cotizar / Pilotar
          </Link>
        </div>
      </section>

      <section className="section-pad" id="faq">
        <div className="container-xl">
          <Reveal>
            <h2 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">FAQ</h2>
          </Reveal>
          <Reveal delay={0.08} className="mt-8">
            <FaqAccordion items={faqs} />
          </Reveal>
        </div>
      </section>

      <section className="section-pad" id="cta-final">
        <div className="container-xl">
          <Reveal>
            <div className="rounded-[24px] border border-[var(--color-border)] bg-[linear-gradient(125deg,#ffffff_0%,#f4f9ff_68%)] p-8 sm:p-10">
              <h2 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">
                Recupera tu tiempo clínico.
              </h2>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/contacto"
                  onClick={() => trackEvent("demo_cta_click", { location: "final_cta" })}
                  className={buttonStyles({ variant: "primary", size: "lg" })}
                >
                  Solicitar demo
                </Link>
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackEvent("whatsapp_click", { location: "final_cta" })}
                  className={buttonStyles({ variant: "secondary", size: "lg" })}
                >
                  Hablar por WhatsApp
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <DemoModal isOpen={isDemoOpen} onClose={() => setIsDemoOpen(false)} />
    </div>
  );
}

function DemoModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.22 }}
        >
          <button
            type="button"
            aria-label="Cerrar demo"
            className="absolute inset-0 bg-[rgba(11,15,20,0.55)] backdrop-blur-[2px]"
            onClick={onClose}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Demo visual ClinikAI"
            className="relative w-full max-w-3xl"
            initial={reducedMotion ? undefined : { opacity: 0, y: 24, scale: 0.98 }}
            animate={reducedMotion ? undefined : { opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: 16, scale: 0.99 }}
            transition={{ duration: reducedMotion ? 0 : 0.45, ease: [0.215, 0.61, 0.355, 1] }}
          >
            <div className="mb-3 flex items-center justify-between rounded-[14px] border border-[var(--color-border)] bg-white px-4 py-3">
              <p className="font-display text-lg font-semibold text-[var(--color-text)]">
                Demo de 30 segundos
              </p>
              <button
                type="button"
                onClick={onClose}
                className={buttonStyles({ variant: "secondary", size: "sm" })}
              >
                Cerrar
              </button>
            </div>

            <DemoSimulator />
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function ProcessDiagram() {
  const reducedMotion = useReducedMotion();

  return (
    <div className="mt-7 rounded-[18px] border border-[var(--color-border)] bg-white p-5 sm:p-6">
      <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="absolute left-[15%] right-[15%] top-6 hidden h-px bg-[var(--color-border)] md:block" />
        {["Hablas con el paciente", "ClinikAI documenta en tu sistema", "Revisas y confirmas"].map(
          (item) => (
            <div
              key={item}
              className="relative z-10 flex items-center gap-3 rounded-xl bg-white md:flex-col md:text-center"
            >
              <span className="grid h-12 w-12 place-items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-semibold text-[var(--color-text)]">
                {item.startsWith("Hablas") ? "1" : item.startsWith("ClinikAI") ? "2" : "3"}
              </span>
              <p className="max-w-[180px] text-sm font-medium text-[var(--color-text)]">{item}</p>
            </div>
          ),
        )}
        {!reducedMotion ? (
          <motion.span
            className="pointer-events-none absolute left-[16%] top-[18px] hidden h-4 w-4 rounded-full bg-[var(--color-accent)] shadow-[0_0_0_8px_rgba(34,211,197,0.15)] md:block"
            animate={{ x: [0, 320, 0] }}
            transition={{ duration: 4.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          />
        ) : null}
      </div>
    </div>
  );
}
