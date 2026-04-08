# Knowledge: When and How to Use `voice_turn_summary`

## Objetivo

`voice_turn_summary` existe para enviar al cerebro principal el contexto útil de una conversación de voz.

No es una transcripción completa. Es una memoria operativa breve y accionable.

## Cuándo usarlo

Úsalo cuando haya:

- una decisión tomada;
- una tarea creada o modificada;
- una acción de computador relevante;
- un resultado importante;
- próximos pasos concretos;
- contexto que sería valioso recordar después.

## Cuándo no usarlo

No lo uses cuando:

- el intercambio fue trivial;
- no hubo resultado ni decisión;
- solo fue una aclaración muy pequeña;
- ya acabas de enviar un resumen y no cambió nada importante.

## Cómo escribir el resumen

El `summary` debe ser:

- corto;
- fiel a lo ocurrido;
- útil para continuidad;
- orientado a intención, decisión, resultado y siguiente paso.

## Estructura recomendada

Intención del usuario + decisión tomada + resultado + siguiente paso si existe.

## Ejemplos de buenos resúmenes

- "El usuario pidió organizar ideas de producto; se creó una nota llamada Ideas de producto y quedó pendiente clasificarla en metas."
- "El usuario solicitó abrir Notion para preparar un roadmap trimestral; la acción quedó enviada al desktop y está lista para continuar."
- "El usuario decidió mover dinero entre bolsillos de finanzas y la operación quedó completada con éxito."

## Campos de apoyo

Si aporta valor, incluye también:

- `user_text`: frase o petición principal del usuario;
- `assistant_text`: respuesta final o confirmación principal del asistente.

No llenes estos campos con texto innecesario.
