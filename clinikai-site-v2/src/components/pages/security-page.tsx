"use client";

import Link from "next/link";

import { buttonStyles } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Reveal } from "@/components/ui/reveal";
import { trackEvent } from "@/lib/analytics";

const goodPractices = [
  "Principio de mínimo privilegio",
  "Control de accesos",
  "Minimización de datos",
  "Cifrado en tránsito (si aplica)",
  "Cifrado en reposo (si aplica)",
  "Auditoría y logs (si aplica)",
  "Gestión de permisos del micrófono",
  "Actualizaciones seguras",
];

export function SecurityPage() {
  return (
    <div className="bg-white">
      <section className="section-pad border-b border-[var(--color-border)]">
        <div className="container-xl">
          <Chip>Seguridad & Privacidad</Chip>
          <h1 className="mt-4 font-display text-4xl font-extrabold tracking-tight text-[var(--color-text)] sm:text-5xl">
            Diseñado para operar con control clínico
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[color:rgb(59,70,84)]">
            Esta página describe la etapa actual del producto y buenas prácticas operativas. No
            sustituye políticas institucionales ni asesoría legal.
          </p>
        </div>
      </section>

      <section className="section-pad">
        <div className="container-xl grid gap-4 md:grid-cols-2">
          <Reveal>
            <article className="rounded-[18px] border border-[var(--color-border)] p-5">
              <h2 className="font-display text-2xl font-semibold text-[var(--color-text)]">
                Qué capta
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[color:rgb(59,70,84)]">
                Audio ambiente de la consulta para convertirlo en texto clínico y escribirlo en los
                campos del sistema médico.
              </p>
            </article>
          </Reveal>

          <Reveal delay={0.04}>
            <article className="rounded-[18px] border border-[var(--color-border)] p-5">
              <h2 className="font-display text-2xl font-semibold text-[var(--color-text)]">
                Dónde se procesa
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[color:rgb(59,70,84)]">
                En etapa inicial se asume procesamiento on-device/local.
              </p>
            </article>
          </Reveal>

          <Reveal delay={0.08}>
            <article className="rounded-[18px] border border-[var(--color-border)] p-5">
              <h2 className="font-display text-2xl font-semibold text-[var(--color-text)]">
                Qué NO hace
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[color:rgb(59,70,84)]">
                No diagnostica, no prescribe, no decide tratamientos y no reemplaza el criterio
                médico.
              </p>
            </article>
          </Reveal>

          <Reveal delay={0.12}>
            <article className="rounded-[18px] border border-[var(--color-border)] p-5">
              <h2 className="font-display text-2xl font-semibold text-[var(--color-text)]">
                Control del usuario
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[color:rgb(59,70,84)]">
                El profesional revisa la nota y realiza el clic final antes de confirmar en el
                sistema.
              </p>
            </article>
          </Reveal>

          <Reveal delay={0.16}>
            <article className="rounded-[18px] border border-[var(--color-border)] p-5">
              <h2 className="font-display text-2xl font-semibold text-[var(--color-text)]">
                Retención
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[color:rgb(59,70,84)]">
                Política de retención configurable según flujo, instalación y lineamientos del
                cliente.
              </p>
            </article>
          </Reveal>

          <Reveal delay={0.2}>
            <article className="rounded-[18px] border border-[var(--color-border)] p-5">
              <h2 className="font-display text-2xl font-semibold text-[var(--color-text)]">
                Roadmap cloud
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-[color:rgb(59,70,84)]">
                Existe intención de explorar opciones cloud en el futuro. No representa promesa de
                fecha ni alcance.
              </p>
            </article>
          </Reveal>
        </div>
      </section>

      <section className="section-pad bg-[var(--color-surface)]">
        <div className="container-xl">
          <Reveal>
            <h2 className="font-display text-3xl font-bold text-[var(--color-text)] sm:text-4xl">
              Buenas prácticas
            </h2>
          </Reveal>

          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {goodPractices.map((practice, index) => (
              <Reveal key={practice} delay={0.04 * index}>
                <li className="rounded-[14px] border border-[var(--color-border)] bg-white px-4 py-3 text-sm text-[var(--color-text)]">
                  <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[var(--color-accent)]" aria-hidden />
                  {practice}
                </li>
              </Reveal>
            ))}
          </ul>

          <Link
            href="/contacto"
            onClick={() => trackEvent("demo_cta_click", { location: "security_page" })}
            className={buttonStyles({ variant: "primary", size: "lg", className: "mt-8" })}
          >
            Solicitar demo técnica
          </Link>
        </div>
      </section>
    </div>
  );
}

