# Custom GPT Render OAuth Setup

## Arquitectura final

- ChatGPT GPT Actions habla con Render.
- Render expone OAuth y endpoints públicos de actions.
- Render valida al usuario con Supabase normal.
- Supabase guarda sesiones efímeras del desktop y la cola de acciones.
- IU OS instalado en el PC ejecuta localmente notas, metas, recordatorios, finanzas y acciones de pantalla.

## URLs públicas

- OAuth authorize: `https://iu-rw9m.onrender.com/gpt/oauth/authorize`
- OAuth token: `https://iu-rw9m.onrender.com/gpt/oauth/token`
- OpenAPI: `https://iu-rw9m.onrender.com/gpt/openapi.json`
- System prompt helper: `https://iu-rw9m.onrender.com/gpt/system-prompt`
- Login / consentimiento: `https://iu-1.onrender.com/oauth.html`
- Privacy policy: `https://iu-1.onrender.com/privacy-policy/`

## Render env vars

En el backend de Render (`server/server.js`):

```env
IU_SUPABASE_URL=https://vbpzzixgzlynexpogyzl.supabase.co
IU_SUPABASE_SERVICE_ROLE_KEY=<service_role>
IU_SUPABASE_PUBLISHABLE_KEY=<sb_publishable>

IU_GPT_PUBLIC_API_BASE_URL=https://iu-rw9m.onrender.com
IU_GPT_LOGIN_PAGE_URL=https://iu-1.onrender.com/oauth.html

IU_GPT_OAUTH_CLIENT_ID=<client_id_de_tu_oauth_app>
IU_GPT_OAUTH_CLIENT_SECRET=<client_secret_de_tu_oauth_app>
```

## ChatGPT Actions

- Authentication Type: `OAuth`
- Authorization URL: `https://iu-rw9m.onrender.com/gpt/oauth/authorize`
- Token URL: `https://iu-rw9m.onrender.com/gpt/oauth/token`
- Scope: `openid email profile`
- Token Exchange Method: `Basic authorization header`
- Schema URL: `https://iu-rw9m.onrender.com/gpt/openapi.json`
- Privacy policy URL: `https://iu-1.onrender.com/privacy-policy/`

## Client ID y Client Secret

Con esta arquitectura, el proveedor OAuth real es tu backend de Render.

Por eso:

- ya no dependes de Supabase OAuth Server para el login del GPT;
- ya no dependes de los `Redirect URIs` de una OAuth App de Supabase para que el flujo funcione.

Puedes reutilizar el `client_id` y `client_secret` que ya habías creado en Supabase si quieres, pero ahora solo funcionan como credenciales compartidas entre ChatGPT y tu backend de Render.

## IU OS desktop

IU sigue necesitando:

```env
IU_CHATGPT_CUSTOM_GPT_URL=https://chatgpt.com/g/<tu-gpt>
IU_GPT_ACTION_TRANSPORT=supabase

IU_SUPABASE_URL=https://vbpzzixgzlynexpogyzl.supabase.co
IU_SUPABASE_PUBLISHABLE_KEY=<sb_publishable>
IU_SUPABASE_ACTION_FUNCTION_URL=https://vbpzzixgzlynexpogyzl.supabase.co/functions/v1/custom-gpt-relay
IU_SUPABASE_DESKTOP_ID=<desktop_id>
IU_SUPABASE_DESKTOP_SECRET=<desktop_secret>
```

Las notas, metas, recordatorios, finanzas y acciones no se guardan ni ejecutan en Render. Render solo enruta la solicitud. La ejecución real sigue ocurriendo en el PC del usuario.
