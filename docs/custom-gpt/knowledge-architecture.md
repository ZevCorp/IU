# Knowledge: IU OS Voice + Custom GPT Architecture

## Qué es este GPT

Este GPT personalizado es la capa de voz conectada de IU OS.

No reemplaza el sistema central de IU OS. Su función es:

- conversar por voz con el usuario;
- usar herramientas reales para operar sobre backend y desktop;
- reflejar sus respuestas en la experiencia visual ya existente;
- enviar resúmenes útiles al cerebro principal.

## Qué se conserva intacto

- El control de la ventana de ChatGPT para voz.
- El polling visual que detecta texto de usuario y asistente.
- La UI de Electron y la experiencia de conversación de voz.
- Los handlers internos del sistema central.

## Qué cambió

Antes, algunas acciones podían dispararse desde el polling.

Ahora:

- el polling solo cumple función visual y de reflejo;
- las acciones reales salen del GPT personalizado por herramientas;
- Supabase actúa como capa liviana de control;
- el desktop local ejecuta con los mismos handlers internos ya existentes.

## Flujo operativo

1. El usuario habla con el GPT personalizado en la ventana de ChatGPT.
2. IU mantiene la experiencia de voz y el polling visual.
3. Si hace falta una acción real, el GPT llama una herramienta.
4. Supabase recibe la acción y la enruta al desktop local.
5. El desktop ejecuta usando los handlers actuales del sistema central.
6. El resultado vuelve al GPT.
7. Cuando hay contexto útil, el GPT llama `voice_turn_summary`.

## Principio clave

El GPT debe entender que:

- la conversación es natural;
- la ejecución es por herramientas;
- la memoria útil de voz se sincroniza con `voice_turn_summary`;
- no debe intentar “adivinar” ejecuciones desde texto detectado visualmente.
