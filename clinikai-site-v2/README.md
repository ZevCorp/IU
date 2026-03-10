# ClinikAI Website (Next.js)

Sitio web premium de conversión para ClinikAI, construido con:
- Next.js (App Router)
- TypeScript
- Tailwind CSS
- Framer Motion

## Ubicación de proyectos
- Proyecto nuevo (esta entrega): `C:\Users\Jose David Jaramillo\clinikai-site-v2`
- Proyecto anterior (se mantuvo intacto): `C:\Users\Jose David Jaramillo\clinikai-site`

Para volver a abrir cualquiera:
1. Abre terminal en la carpeta deseada.
2. Ejecuta `npm run dev`.
3. Entra a `http://localhost:3000`.

## Comandos
```bash
npm install
npm run dev
npm run lint
npm run build
npm run start
```

## Estructura principal
- `src/app/` rutas y metadata
- `src/components/` layout, UI, páginas y analítica
- `src/lib/` constantes, analítica, motion y utilidades
- `brand-tokens.ts` tokens de marca
- `CONTENT.md` copy editable

## Rutas
- `/` Home
- `/producto`
- `/seguridad-privacidad`
- `/precios`
- `/contacto`
- `/casos-de-uso`

## Placeholders a reemplazar
- `[WHATSAPP_NUMERO]` en `src/lib/constants.ts`
- `[PRECIO_DESDE]` en páginas de Home y Precios
- `[DOMINIO_CLINIKAI]` en `src/lib/constants.ts`
- `[VIDEO_DEMO]` y `[LOGO]` en copy/activos

## SEO incluido
- Metadata por página
- Open Graph/Twitter cards
- JSON-LD `SoftwareApplication` en Home
- `sitemap.ts` y `robots.ts`

## Analítica (placeholders)
Eventos emitidos por `trackEvent`:
- `demo_cta_click`
- `whatsapp_click`
- `form_submit`
- `scroll_depth`

Puedes conectar GA4/GTM usando `window.dataLayer` y/o `window.gtag`.

## Deploy recomendado
### Vercel
1. Subir repo a GitHub/GitLab/Bitbucket.
2. Importar proyecto en Vercel.
3. Build command: `npm run build`.
4. Output: automático de Next.js.
5. Definir dominio real y actualizar `SITE_URL`.

## Notas
- El sitio está en español.
- Se respeta el tono HealthTech sin promesas clínicas indebidas.
- Se implementó soporte de accesibilidad y reduced motion.

