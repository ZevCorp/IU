# Scope Brief: Capa de Turn-Taking No Verbal sobre PersonaPlex

## Objetivo

Construir una primera demo de conversación de voz sobre `PersonaPlex` en la que el sistema entienda mejor los momentos conversacionales del usuario y tome mejores decisiones sobre cuándo hablar y cuándo no hablar.

El foco no es crear un sistema general de lenguaje no verbal, sino una capa ligera que mejore significativamente la experiencia de conversación en un escenario 1:1.

## Hipótesis

La interacción humano-computador mejora cuando el sistema no depende solo del silencio o del texto para decidir su turno, sino que combina señales verbales y no verbales para inferir si debe:

- seguir escuchando
- responder
- hacer un backchannel breve
- guardar una duda para después
- no responder en absoluto

## Primer caso de uso

Conversación simple entre usuario e IA, con énfasis en momentos donde el usuario:

- está explicando algo en continuidad
- hace pausas que no significan cesión de turno
- dice algo al pasar pero no quiere una respuesta
- abre una ventana genuina para que la IA intervenga
- deja huecos importantes que ameritan una pregunta de profundización

## Resultado esperado

La demo debe hacer que la IA se sienta más atenta y menos invasiva que un asistente de voz tradicional.

En particular, debe mejorar en estas decisiones:

1. `Hold`: el usuario sigue con la palabra
2. `Yield`: el usuario cede la palabra
3. `Backchannel`: la IA puede reaccionar sin tomar el turno
4. `No response`: la IA entendió, pero socialmente debe quedarse callada
5. `Clarify now / later`: la IA detecta una duda relevante y decide si preguntar o guardarla

## Alcance funcional

### Incluye

- integración sobre la base actual de `PersonaPlex`
- captura de señales no verbales ligeras
- análisis temporal de señales verbales y no verbales
- política de decisión de turn-taking
- memoria corta de dudas/puntos de profundización
- demo 1:1 enfocada en conversación simple

### No incluye

- multiusuario o conversaciones grupales
- detección emocional general
- interpretación completa de gestos humanos
- entrenamiento de un modelo fundacional propio
- producto production-ready

## Restricciones de producto

- Debe ser una solución rápida de construir y fácil de iterar.
- Debe apoyarse lo más posible en `PersonaPlex`.
- La capa nueva debe ser lo más mínima posible, pero diseñada de forma mantenible.
- Se le deja libertad al desarrollador para elegir implementación y librerías, siempre que preserve esos principios.

## Dirección técnica sugerida

Sin cerrar decisiones de implementación, la arquitectura esperada debería contemplar algo de esta forma:

- `PersonaPlex` como motor conversacional base
- una capa de percepción ligera para extraer señales útiles
- una capa de política que combine esas señales y decida la acción conversacional
- un mecanismo para registrar dudas relevantes y preguntarlas en el momento adecuado

La preferencia es evitar una solución excesivamente compleja en esta primera fase.

## Señales que probablemente importan

Ejemplos de señales que podrían ser útiles:

- pausas
- ritmo y energía de voz
- fillers
- dirección de mirada
- orientación de cabeza/cuerpo
- continuidad o cierre de gesto
- cambio implícito de atención
- combinación entre silencio y reorientación corporal

No es necesario capturar todas; basta con priorizar las que den más valor en el MVP.

## Entregables esperados

1. Demo funcional sobre PersonaPlex
2. Política básica de decisión conversacional
3. Soporte para `hold`, `yield`, `no response` y al menos una forma inicial de `clarify later`
4. Instrumentación/logs suficientes para evaluar casos y mejorar iteraciones
5. Recomendación clara de siguiente fase

## Criterio de éxito

Consideraremos esta fase exitosa si, en una conversación simple, la IA:

- interrumpe menos
- responde cuando realmente corresponde
- evita respuestas innecesarias
- hace mejores preguntas de seguimiento
- se siente más natural que una lógica basada solo en silencios

## Lo que necesito del desarrollador

- Propuesta técnica concreta a partir de este scope
- Decisión de stack y componentes del MVP
- Plan de implementación por fases
- Identificación de riesgos y tradeoffs
- Primera versión funcional lo antes posible

## Nota de libertad técnica

Este documento define el problema, el comportamiento esperado y las restricciones del MVP.

La solución exacta queda abierta para que el desarrollador proponga la mejor implementación posible dentro de ese marco.
