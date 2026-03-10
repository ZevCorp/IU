"use client";

import { useState, type FormEvent } from "react";

import { TrackedAnchor } from "@/components/analytics/tracked-anchor";
import { Button, buttonStyles } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { trackEvent } from "@/lib/analytics";
import { WHATSAPP_URL } from "@/lib/constants";

type FormState = {
  nombre: string;
  rol: string;
  institucion: string;
  ciudad: string;
  contacto: string;
  sistema: string;
  plataforma: "macOS" | "Windows" | "Ambos";
};

const initialState: FormState = {
  nombre: "",
  rol: "",
  institucion: "",
  ciudad: "",
  contacto: "",
  sistema: "",
  plataforma: "macOS",
};

export function ContactPage() {
  const [formData, setFormData] = useState<FormState>(initialState);
  const [submitted, setSubmitted] = useState(false);

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setFormData((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    trackEvent("form_submit", {
      form: "contacto_demo",
      rol: formData.rol || "no_definido",
      plataforma: formData.plataforma,
    });

    setSubmitted(true);
  };

  return (
    <div className="bg-white">
      <section className="section-pad border-b border-[var(--color-border)]">
        <div className="container-xl">
          <Chip>Contacto / Demo</Chip>
          <h1 className="mt-4 font-display text-4xl font-extrabold tracking-tight text-[var(--color-text)] sm:text-5xl">
            Agenda tu demo o piloto
          </h1>
          <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[color:rgb(59,70,84)]">
            Cuéntanos tu contexto clínico y técnico. Te contactamos con próximos pasos claros.
          </p>
        </div>
      </section>

      <section className="section-pad">
        <div className="container-xl grid gap-6 lg:grid-cols-[1.25fr_0.9fr]">
          <article className="rounded-[22px] border border-[var(--color-border)] p-6 sm:p-8">
            {!submitted ? (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <Field
                  label="Nombre"
                  value={formData.nombre}
                  onChange={(value) => updateField("nombre", value)}
                  required
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Rol"
                    value={formData.rol}
                    onChange={(value) => updateField("rol", value)}
                    required
                  />
                  <Field
                    label="Institución"
                    value={formData.institucion}
                    onChange={(value) => updateField("institucion", value)}
                    required
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Ciudad"
                    value={formData.ciudad}
                    onChange={(value) => updateField("ciudad", value)}
                    required
                  />
                  <Field
                    label="Contacto (email o teléfono)"
                    value={formData.contacto}
                    onChange={(value) => updateField("contacto", value)}
                    required
                  />
                </div>

                <Field
                  label="Sistema actual"
                  value={formData.sistema}
                  onChange={(value) => updateField("sistema", value)}
                  placeholder="Ej: HIS/EMR, versión, módulos"
                  required
                />

                <fieldset>
                  <legend className="mb-2 text-sm font-semibold text-[var(--color-text)]">
                    Plataforma
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {(["macOS", "Windows", "Ambos"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => updateField("plataforma", option)}
                        className={buttonStyles({
                          variant: formData.plataforma === option ? "primary" : "secondary",
                          size: "sm",
                        })}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <div className="pt-2">
                  <Button type="submit" size="lg">
                    Enviar solicitud
                  </Button>
                </div>
              </form>
            ) : (
              <div className="rounded-[18px] bg-[linear-gradient(125deg,#ffffff_0%,#f4f9ff_68%)] p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-brand)]">
                  Solicitud recibida
                </p>
                <h2 className="mt-2 font-display text-3xl font-bold text-[var(--color-text)]">
                  Gracias, te contactaremos pronto.
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-[color:rgb(59,70,84)]">
                  Próximos pasos:
                </p>
                <ol className="mt-3 space-y-2 text-sm text-[var(--color-text)]">
                  <li>1. Revisión de tu flujo clínico y sistema actual.</li>
                  <li>2. Confirmación de alcance para demo o piloto.</li>
                  <li>3. Agenda de sesión con equipo clínico/técnico.</li>
                </ol>
              </div>
            )}
          </article>

          <aside className="space-y-4">
            <article className="rounded-[20px] border border-[var(--color-border)] p-5">
              <h2 className="font-display text-2xl font-semibold text-[var(--color-text)]">
                WhatsApp rápido
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-[color:rgb(59,70,84)]">
                Si prefieres coordinación inmediata, escríbenos por WhatsApp.
              </p>
              <TrackedAnchor
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                eventName="whatsapp_click"
                payload={{ location: "contact_page" }}
                className={buttonStyles({ variant: "secondary", size: "md", className: "mt-4" })}
              >
                Hablar por WhatsApp
              </TrackedAnchor>
            </article>

            <article className="rounded-[20px] border border-[var(--color-border)] p-5">
              <h2 className="font-display text-2xl font-semibold text-[var(--color-text)]">
                Qué preparar
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-[color:rgb(59,70,84)]">
                <li>Nombre del sistema actual.</li>
                <li>Plantillas y pantallas clave.</li>
                <li>Preferencia macOS/Windows.</li>
              </ul>
            </article>
          </aside>
        </div>
      </section>
    </div>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
};

function Field({ label, value, onChange, placeholder, required }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-[var(--color-text)]">{label}</span>
      <input
        className="h-11 w-full rounded-xl border border-[var(--color-border)] px-3 text-sm text-[var(--color-text)] outline-none transition focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}


