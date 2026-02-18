# Integración con Plaud Pine

## Resumen
El **Plaud Pine** (y el Note) están diseñados para sincronizar grabaciones y transcripciones a su propia nube (Plaud Cloud). No ofrecen una forma nativa de enviar una petición HTTP POST personalizada (con tokens y deviceIds específicos) directamente desde el dispositivo hardware.

Por lo tanto, la integración **requiere un intermediario** que transforme la transcripción de Plaud en el formato que tu sistema IU OS espera.

## Flujo Recomendado
La forma más robusta y estándar es usar **Zapier** como puente.

1.  **Plaud Cloud**:
    *   El dispositivo sube el audio y Plaud lo transcribe.
2.  **Zapier (Trigger)**:
    *   App: **Plaud Note** (Beta/Oficial).
    *   Event: **New Recording** o **New Transcription**.
    *   *Nota: Plaud tiene integración oficial con Zapier.*
3.  **Zapier (Action)**:
    *   App: **Code by Zapier**.
    *   Script: El código JavaScript que conecta con tu backend (ver `zapier_test_script.js`).
    *   **Mapping**: Asignas la variable `transcription` (del Trigger de Plaud) al campo `context` o `instruction` de tu script.

## ¿Por qué no directa?
Para hacer una integración "directa" (Device -> Tu Servidor), Plaud tendría que permitirte configurar un Webhook personalizado dentro de su app donde pudieras especificar:
*   URL
*   Headers
*   Body JSON estructurado (`{ token: "...", deviceId: "..." }`)

Actualmente, la mayoría de estos dispositivos solo ofrecen integraciones "one-click" a servicios como Notion, Slack o Zapier, pero no un "Raw Webhook builder" flexible.

## Alternativa (Si Plaud habilita Webhooks puros)
Si encuentras una opción de "Webhook" genérico en la app de Plaud:
1.  Apunta a: `https://iu-rw9m.onrender.com/api/zapier-command`
2.  El problema será la autenticación. Tu servidor espera un JSON con `token` y `deviceId`. Si Plaud solo envía el texto plano o su propio formato JSON, tu servidor lo rechazará.
    *   *Solución:* Tendrías que modificar tu servidor para aceptar el formato específico de Plaud, o usar Zapier para traducir.

**Conclusión:** Zapier sigue siendo la mejor ruta ("Middleman") para conectar Plaud con tu sistema personalizado.
