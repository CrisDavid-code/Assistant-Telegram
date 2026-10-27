# Proveedores de IA

## Diseño
`AIProvider` (`functions/src/ai/types.ts`): `interpret`, `transcribe?`, `extractFromImage?`. Lo que un proveedor no implementa se informa al usuario como «no configurado»; nunca se simula.

| Proveedor | Archivo | Capacidades | Costo |
|---|---|---|---|
| Reglas en español | `ai/rules.ts`, `ai/dates.ts` | Interpretar recordatorios, tareas, gastos, ingresos, deudas, cobros, consultas; fechas relativas, horas, recurrencias | Gratis, siempre activo |
| Claude | `ai/claude.ts` | Interpretar lo que las reglas no entienden; extraer datos de imágenes (recibos, facturas, tarjetas) | Por uso (API de Anthropic) |
| Transcripción de voz | — | **Pendiente**: requiere un proveedor de voz a texto | — |

Orden: reglas primero; si devuelven `unknown` y hay IA configurada, se consulta a la IA (`ai/provider.ts`).

## Claude
- Modelo `claude-opus-5-5`, esfuerzo `low`, salidas estructuradas (`output_config.format` con Zod) — el *tool use* forzado no está disponible en este modelo.
- La salida se valida dos veces (esquema de salida y `zIntent`). Rechazos (`stop_reason: refusal`) o salidas truncadas → «no entendí».
- Se envía solo el mensaje actual, fecha/hora y zona del espacio. Las imágenes se envían en base64 y no se guardan.
- Activación: secreto `ANTHROPIC_API_KEY` con una clave real (`sk-ant-…`). Cualquier otro valor (p. ej. `disabled`) la desactiva.
  ```bash
  firebase functions:secrets:set ANTHROPIC_API_KEY
  ```

## Costos y límites
- Cuota mensual por espacio de mensajes al asistente (`packages/contracts/src/plans.ts`): Gratis 150, Premium 2,000, Empresa 10,000. Se aplica en el backend antes de interpretar.
- Imágenes: máximo 5 MB, JPG/PNG/WEBP. Voz: máximo 2 min / 2 MB.
- Pendiente: registrar tokens consumidos por espacio (hoy se cuentan mensajes) y alertas de costo.

## Agregar un proveedor de voz
Implementar `transcribe(audio, mime)` en un objeto `AIProvider` y combinarlo en `getLLM()`. El bot ya descarga la nota (`telegram.getFile`), valida tamaño y duración, muestra «Entendí: …» y procesa el texto con el mismo flujo (con confirmación para finanzas).
