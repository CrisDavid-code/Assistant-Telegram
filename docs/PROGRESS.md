# Avance de Aguiteks LifeOS

Documento de seguimiento para continuar el trabajo entre sesiones. Actualizado: 2026-10-29.
Repositorio: `CrisDavid-code/Assistant-Telegram` (rama `main`).

## Diagnóstico inicial (Fase 0)
- Repositorio vacío al empezar. Se tomó como base el método del skill *app-movil-aguiteks* (stack, diseño, lecciones de Chambas GT).
- **Costo cero sin tarjeta (decisión del 2026-10-28):** Firebase Spark (Hosting, Auth, Firestore) + **Cloudflare Workers Free** (API, webhook de Telegram, Cron, Workers AI). Se descartó Blaze (exige tarjeta y puede cobrar).
- Escrituras solo por backend: una sola implementación de negocio para PWA, Telegram e IA.

## Decisiones de arquitectura
| Decisión | Motivo |
|---|---|
| `POST /api` del Worker + `runOp` | Mismo contrato, autorización e idempotencia para todos los canales |
| `requestId` del cliente = id del documento | Idempotencia sin colección extra |
| Recordatorios por Cron Trigger cada minuto | Duradero, gratis; estado en Firestore |
| Cliente REST propio de Firestore | `firebase-admin` no corre en Workers; misma interfaz → los servicios no cambiaron |
| Documentos en Firestore (≤ 700 KB, base64) | Cloud Storage exige facturación y Cloudflare R2 exige registrar un medio de pago |
| Voz con Workers AI (Whisper) | Incluido en el plan gratuito de Cloudflare; sin otra cuenta |
| Reglas en español antes que IA | Sin costo ni latencia para frases comunes; Claude opcional |
| Caché de Firestore en memoria en la PWA | No guardar finanzas en el dispositivo |
| Una entidad `obligations` para facturas, deudas, cobros y suscripciones | Misma lógica de pagos parciales y estados |
| Metas de ahorro como apartados (sin mover saldos) | Evita descuadrar o duplicar movimientos |
| Administradores por `ADMIN_UIDS` | Sin custom claims ni Admin SDK |

## Estado por fase
Leyenda: ✅ implementado y probado · 🔑 implementado, falta credencial o cuenta · 🟡 parcial

| Fase | Estado | Detalle |
|---|---|---|
| 0. Auditoría y plan | ✅ | Este documento, `architecture.md`, `data-model.md` |
| 1. Fundamentos y seguridad | ✅ | Usuarios, espacios personal/empresa, membresías e invitaciones, 5 roles, reglas, auditoría, contratos Zod, pruebas de aislamiento |
| 2. PWA | ✅ | Navegación móvil (barra + «Más») y escritorio, selector de espacio, inicio con datos reales, estados de carga/vacío/error, PWA instalable, tema, aviso sin conexión |
| 3. Agenda y productividad | ✅ | Tareas con vistas y **calendario mensual**, **tareas recurrentes**, recordatorios únicos y recurrentes con reintentos y recuperación, contactos, actividades con seguimiento |
| 4. Finanzas | ✅ | Cuentas, ingresos, gastos, transferencias multimoneda, anulación, obligaciones con pagos parciales, presupuestos, resumen por moneda, conciliación, **metas de ahorro** |
| 5. Telegram | ✅ 🔑 | Webhook con secreto e idempotencia, vinculación segura, 15 comandos, lenguaje natural, confirmaciones, selección de espacio, contactos compartidos. Falta crear el bot |
| 6. IA | ✅ 🔑 | Intérprete por reglas; Claude para texto e imágenes (falta `ANTHROPIC_API_KEY`); **voz con Workers AI** (activa al desplegar); cuota mensual y **registro de tokens** por espacio |
| 7. Proyectos, CRM, documentos | ✅ | **Proyectos** con avance real; **oportunidades** por etapas con cobro esperado al ganar; **documentos** con archivo validado, descarga autorizada y aviso de vencimiento |
| 8. SaaS y observabilidad | ✅ | Planes y cuotas en backend; **uso del plan** en Configuración; **panel de administración** (métricas y cambio de plan); **alertas** al administrador por Telegram |
| 9. Producción | ✅ / 🟡 | CI; **exportar y eliminar cuenta**; **verificación de correo** (exigida para invitar); **limpieza** de códigos vencidos; **respaldo/restauración** (`scripts/backup.mjs`); despliegue, reversión y runbooks. 🟡 App Check no incluido (requiere reCAPTCHA; opcional) |

## Pruebas (resultados reales de la última ejecución)
| Suite | Comando | Resultado |
|---|---|---|
| Unitarias (dinero, permisos, fechas, intérprete, zonas horarias) | `npm test` | 19/19 ✅ |
| Integración contra emuladores (seguridad, finanzas, recordatorios, Telegram, IA simulada, reglas, módulos nuevos) | `npm run test:emu` | 67/67 ✅ |
| E2E: PWA → Worker en `workerd` → emuladores (registro, tareas, finanzas, asistente, proyectos, documentos, oportunidades, metas, calendario, Telegram, exportar, eliminar cuenta) | `node tests/e2e/pwa.cjs` | 16/16 pasos ✅, sin errores de consola |
| Respaldo y restauración (incluye documentos sin padre) | `scripts/backup.mjs` contra emulador | ✅ |
| Typecheck + build (PWA y Worker de 395 KB comprimido) | `npm run typecheck && npm run build` | ✅ |

Errores encontrados y corregidos gracias a las pruebas: `\b` no reconoce acentos; días terminados en «s»; campos `undefined`; carrera de registro; `undefined→null` del SDK callable; `GET ?transaction=` bloqueado en el emulador (se usa `batchGet`); archivo excluido por un `.gitignore` demasiado amplio; agregaciones combinadas que excluyen documentos sin uno de los campos (se separan); borrado redundante del usuario en el navegador.

## Bloqueos que requieren intervención humana
1. **Proyecto de Firebase (Spark)**, su configuración web y una clave de cuenta de servicio; **cuenta de Cloudflare** → `docs/deployment.md`.
2. **Bot de Telegram** en @BotFather → `docs/telegram-setup.md`.
3. Opcional: **clave de Anthropic** para frases complejas e imágenes (pago por uso).
4. **Proveedor de pagos** para cobrar planes (no se simula ningún cobro).
5. Autorización explícita para desplegar a producción.

## Riesgos del plan gratuito (verificar en producción)
- Límite de 10 ms de CPU por solicitud en Workers Free: medir con `wrangler tail`.
- Cuotas diarias de Firestore Spark (~3 mil lecturas/día del barrido de recordatorios, de 50 mil).
- Asignación diaria gratuita de Workers AI para notas de voz.
- Archivos de hasta 700 KB por documento.

## Mejoras posibles (fuera del plan)
App Check; comandos de Telegram para proyectos y documentos; archivos grandes fragmentados; cobro de planes con un proveedor de pagos.
