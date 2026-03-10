import Link from "next/link";

import { DEMO_EMAIL, WHATSAPP_URL } from "@/lib/constants";

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-border)] bg-white">
      <div className="container-xl py-10">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="md:col-span-2">
            <p className="font-display text-lg font-semibold text-[var(--color-text)]">ClinikAI</p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-[color:rgb(59,70,84)]">
              Documentacion clinica asistida por voz para consultas y flujos hospitalarios,
              con control final del medico.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">Navegacion</p>
            <ul className="mt-3 space-y-2 text-sm text-[color:rgb(59,70,84)]">
              <li>
                <Link href="/producto" className="hover:text-[var(--color-text)]">
                  Producto
                </Link>
              </li>
              <li>
                <Link href="/seguridad-privacidad" className="hover:text-[var(--color-text)]">
                  Seguridad & Privacidad
                </Link>
              </li>
              <li>
                <Link href="/precios" className="hover:text-[var(--color-text)]">
                  Precios
                </Link>
              </li>
              <li>
                <Link href="/contacto" className="hover:text-[var(--color-text)]">
                  Contacto
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold text-[var(--color-text)]">Contacto</p>
            <ul className="mt-3 space-y-2 text-sm text-[color:rgb(59,70,84)]">
              <li>
                <a href={`mailto:${DEMO_EMAIL}`} className="hover:text-[var(--color-text)]">
                  {DEMO_EMAIL}
                </a>
              </li>
              <li>
                <a
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[var(--color-text)]"
                >
                  WhatsApp
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-[var(--color-text)]">
                  Terminos
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-[var(--color-text)]">
                  Privacidad
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-9 border-t border-[var(--color-border)] pt-4 text-xs text-[color:rgb(94,107,123)]">
          © {new Date().getFullYear()} ClinikAI. [LOGO]
        </div>
      </div>
    </footer>
  );
}

