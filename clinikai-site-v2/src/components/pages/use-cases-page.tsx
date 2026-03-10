import Link from "next/link";

import { buttonStyles } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";

const useCases = [
  {
    title: "Consulta general",
    text: "Documentación continua de motivo, antecedentes, examen, diagnóstico y plan durante consulta ambulatoria.",
  },
  {
    title: "Pediatría",
    text: "Permite sostener una interacción más cercana con familia y paciente sin sacrificar completitud de nota.",
  },
  {
    title: "(Próximo) Rondas hospitalarias",
    text: "Evolución para internistas y equipos de sala en etapas de validación.",
  },
];

export function UseCasesPage() {
  return (
    <div className="bg-white">
      <section className="section-pad border-b border-[var(--color-border)]">
        <div className="container-xl">
          <Chip>Casos de uso</Chip>
          <h1 className="mt-4 font-display text-4xl font-extrabold tracking-tight text-[var(--color-text)] sm:text-5xl">
            Flujos clínicos donde ClinikAI aporta más valor
          </h1>
        </div>
      </section>

      <section className="section-pad">
        <div className="container-xl grid gap-4 md:grid-cols-3">
          {useCases.map((item) => (
            <article key={item.title} className="rounded-[18px] border border-[var(--color-border)] p-5">
              <h2 className="font-display text-2xl font-semibold text-[var(--color-text)]">{item.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-[color:rgb(59,70,84)]">{item.text}</p>
            </article>
          ))}
        </div>

        <Link href="/contacto" className={buttonStyles({ variant: "primary", size: "lg", className: "mt-8" })}>
          Solicitar demo
        </Link>
      </section>
    </div>
  );
}

