# Avance de Aguiteks LifeOS

Documento de seguimiento para continuar el trabajo entre sesiones. Actualizado: 2026-10-28.

## Diagnóstico inicial (Fase 0)
- Repositorio **vacío** (sin commits). No había app de Lovable ni código previo que conservar.
- Se tomó como base el método del skill *app-movil-aguiteks* (stack, plantillas de diseño, lecciones de Chambas GT), con dos desviaciones justificadas:
  1. **Costo cero sin tarjeta (decisión del 2026-10-28):** Firebase Spark (Hosting, Auth, Firestore) + **Cloudflare Workers Free** para la API, el webhook de Telegram y el Cron de recordatorios. Es el mismo patrón del Worker push gratuito del skill. Se descartó Blaze (exige tarjeta y puede cobrar).
  2. **Escrituras solo por backend** (el skill valida en reglas): una sola implementación de negocio para PWA, Telegram e IA.
- Firebase Web SDK 13 (compatible con `@firebase/rules-unit-testing` 6).

## Decisiones de arquitectura
| Decisión | Motivo |
|---|---|
| `POST /api` del Worker + `runOp` | Mismo contrato, autorización e idempotencia para todos los canales |
| `requestId` del cliente = id del documento | Idempotencia sin colección extra |
| Recordatorios por Cron Trigger cada minuto | Duradero, gratis; estado en Firestore |
| Cliente REST propio de Firestore (`worker/src/shared/firestore.ts`) | `firebase-admin` no corre en Workers; misma interfaz → los servicios no cambiaron |
| Reglas en español antes que IA | Sin costo ni latencia para frases comunes; IA opcional |
| Caché de Firestore en memoria en la PWA | No guardar finanzas en el dispositivo |
| Sin TanStack Query / React Hook Form | `onSnapshot` ya da tiempo real; formularios nativos + contratos Zod bastan. Agregar si los formularios crecen |
| Una entidad `obligations` para facturas, deudas, cobros y suscripciones | Misma lógica de pagos parciales y estados |

## Estado por fase
Leyenda: ✅ implementado y probado · 🔑 implementado, falta credencial · 🟡 parcial · ⏳ pendiente

| Fase | Estado | Detalle |
|---|---|---|
| 0. Auditoría y plan | ✅ | Este documento, `architecture.md`, `data-model.md` |
| 1. Fundamentos y seguridad | ✅ | Usuarios, espacios personal/empresa, membresías e invitaciones, 5 roles, reglas Firestore/Storage, auditoría, contratos Zod, pruebas de aislamiento |
| 2. PWA | ✅ | Navegación móvil/escritorio, selector de espacio, inicio con datos reales, configuración, estados de carga/vacío/error, manifest + SW + iconos, tema, aviso sin conexión. E2E Playwright |
| 3. Agenda y productividad | ✅ / 🟡 | Tareas (vistas, editar, completar, cancelar), recordatorios únicos y recurrentes con reintentos y recuperación, contactos, actividades con seguimiento. 🟡 Sin vista de calendario mensual; sin tareas recurrentes (solo recordatorios) |
| 4. Finanzas | ✅ / 🟡 | Cuentas, ingresos, gastos, transferencias (multimoneda), anulación, obligaciones con pagos parciales, presupuestos, resumen por moneda, conciliación. 🟡 Metas de ahorro pendientes |
| 5. Telegram | ✅ 🔑 | Webhook en el Worker con secreto e idempotencia, vinculación segura, 15 comandos, lenguaje natural, confirmaciones, selección de espacio, contactos compartidos. Falta crear el bot y registrar el webhook |
| 6. IA | 🟡 🔑 | Intérprete por reglas ✅; Claude para texto e imágenes implementado (falta `ANTHROPIC_API_KEY`); cuota mensual ✅. ⏳ Transcripción de voz (necesita proveedor); ⏳ registro de tokens |
| 7. Proyectos, CRM, documentos | ⏳ | Pendiente: proyectos, oportunidades/etapas, documentos con Storage y vencimientos. Base lista: contactos, actividades, obligaciones `expected` |
| 8. SaaS y observabilidad | 🟡 | Planes y cuotas en backend ✅ (espacios de empresa, mensajes al asistente). ⏳ Panel de administración, métricas de consumo, alertas operativas |
| 9. Producción | 🟡 | CI ✅, despliegue/reversión/runbooks documentados ✅. ⏳ Exportación y eliminación de cuenta automatizadas, verificación de correo, App Check, limpieza de códigos vencidos |

## Pruebas (resultados reales de la última ejecución)
| Suite | Comando | Resultado |
|---|---|---|
| Unitarias (dinero, permisos, fechas, intérprete, zonas horarias) | `npm test` | 19/19 ✅ |
| Integración contra emuladores (seguridad, finanzas, recordatorios, Telegram, IA simulada, reglas) | `npm run test:emu` | 52/52 ✅ (con el cliente REST) |
| E2E PWA → Worker en `wrangler dev` (runtime `workerd`) → emuladores | `node tests/e2e/pwa.cjs` | 9/9 pasos ✅, sin errores de consola |
| Worker en `workerd`: webhook (401 sin secreto, 200, repetido ignorado) y Cron (recordatorio vencido → `undeliverable`) | manual con `curl` | ✅ |
| Typecheck + build | `npm run typecheck && npm run build` | ✅ |

Errores encontrados y corregidos gracias a las pruebas: `\b` de JavaScript no reconoce letras acentuadas («gasté»); días terminados en «s»; campos `undefined` en Firestore; carrera entre registro y creación del perfil (nombre vacío); el SDK *callable* convierte `undefined` en `null`; la lectura transaccional `GET ?transaction=` se bloquea en el emulador (se usa `batchGet`, como los SDK oficiales).

## Bloqueos que requieren intervención humana
1. **Proyecto de Firebase (Spark, gratis)**, su configuración web y una clave de cuenta de servicio; **cuenta de Cloudflare** (gratis) → `docs/deployment.md`.
2. **Bot de Telegram** en @BotFather y secretos `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` → `docs/telegram-setup.md`.
3. **Clave de IA** (`ANTHROPIC_API_KEY`) si se quiere IA para frases complejas e imágenes.
4. **Proveedor de transcripción de voz** (decisión de producto: cuál usar).
5. **Proveedor de pagos** para cobrar planes (no se simula ningún cobro).

## Riesgos del plan gratuito (verificar en producción)
- Límite de 10 ms de CPU por solicitud en Workers Free: medir con `wrangler tail` (la firma RS256 se reutiliza por 1 h; las verificaciones de JWT usan claves en caché).
- Cuotas diarias de Firestore Spark: el barrido gasta ~3 mil lecturas/día de 50 mil.
- Sin respaldos administrados en Spark: falta script de respaldo JSON (Fase 9).
- Documentos (Fase 7): usar Cloudflare R2 gratis en vez de Cloud Storage (exige facturación).
6. Autorización explícita para desplegar a producción.

## Siguiente paso recomendado
Fase 7 (proyectos y documentos con Storage privado), luego metas de ahorro, exportación/eliminación de cuenta y panel de administración.
