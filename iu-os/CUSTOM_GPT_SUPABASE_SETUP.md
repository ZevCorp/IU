# Custom GPT + Supabase Setup

Esta integración deja intacto el control de la ventana de ChatGPT y el polling visual de voz. Las acciones reales salen del GPT personalizado hacia Supabase, y Supabase las enruta al desktop local con un modelo de bajo costo basado en sesiones efímeras y long-poll.

## Arquitectura

1. El GPT personalizado llama la Edge Function `custom-gpt-relay`.
2. La Edge Function autentica al usuario con Supabase Auth.
3. La request se guarda en `custom_gpt_action_requests`.
4. Mientras la voz está activa, IU mantiene una sesión efímera y hace `long-poll` a `wait-next`.
5. IU reclama el job, ejecuta la operación local usando los handlers existentes y responde con `complete`.
6. La Edge Function espera el resultado y se lo devuelve al GPT.

No usamos `Supabase Realtime` en esta versión para reducir costos fijos de conexiones y mensajes.

## Variables en IU (`iu-os/.env`)

```env
IU_CHATGPT_CUSTOM_GPT_URL=https://chatgpt.com/g/tu-gpt
IU_GPT_ACTION_TRANSPORT=supabase

IU_SUPABASE_URL=https://<project-ref>.supabase.co
IU_SUPABASE_PUBLISHABLE_KEY=<sb_publishable_... o anon>
IU_SUPABASE_ACTION_FUNCTION_URL=https://<project-ref>.supabase.co/functions/v1/custom-gpt-relay

IU_SUPABASE_DESKTOP_ID=<uuid devuelto por custom_gpt_create_desktop()>
IU_SUPABASE_DESKTOP_SECRET=<secret devuelto por custom_gpt_create_desktop()>
```

## Provisionar desktop en Supabase

1. Ejecuta la migración [`20260330_custom_gpt_relay.sql`](/Users/felipemaldonado/Documents/U/supabase/migrations/20260330_custom_gpt_relay.sql).
2. Autenticado como usuario final, llama:

```sql
select * from public.custom_gpt_create_desktop('Desktop principal');
```

3. Guarda `desktop_id` y `desktop_secret` en las variables de IU.

## Deploy Edge Function

La función vive en [`custom-gpt-relay/index.ts`](/Users/felipemaldonado/Documents/U/supabase/functions/custom-gpt-relay/index.ts).

Endpoints relevantes:

- `GET /functions/v1/custom-gpt-relay/openapi.json`
- `GET /functions/v1/custom-gpt-relay/system-prompt`
- `POST /functions/v1/custom-gpt-relay/desktop/session/open`
- `POST /functions/v1/custom-gpt-relay/desktop/wait-next`
- `POST /functions/v1/custom-gpt-relay/desktop/complete`
- `POST /functions/v1/custom-gpt-relay/action/<operation>`

## Configurar el GPT personalizado

Usa como OpenAPI URL:

```text
https://<project-ref>.supabase.co/functions/v1/custom-gpt-relay/openapi.json
```

Usa OAuth de Supabase para que el GPT obtenga un access token del usuario final.

El system prompt base está en:

- [`CustomGptConfig.js`](/Users/felipemaldonado/Documents/U/iu-os/CustomGptConfig.js)

Y la app también lo expone por IPC con `get-custom-gpt-setup`.

## Notas de producto

- Render ya no es necesario para esta ruta del GPT personalizado.
- El polling de voz sigue siendo solo visual; no ejecuta backend.
- El sistema central agéntico no cambia: IU reutiliza los mismos handlers locales para ejecutar las operaciones que llegan desde Supabase.
- El desktop solo abre sesión con Supabase mientras la conversación de voz está activa.
