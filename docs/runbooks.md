# Runbooks

## Investigar un fallo
1. `firebase functions:log --only api,telegramWebhook,reminderSweep` — buscar `api.error`, `telegram.update.failed`, `ai.interpret.failed`.
2. Auditoría del espacio: `spaces/{sid}/audit` ordenado por `at` (actor, operación, origen).
3. Reproducir localmente con emuladores y una prueba en `tests/` antes de corregir.

## Recordatorios
- **No llegan:** revisar el documento: `status`, `attempts`, `lastError`.
  - `undeliverable`: el usuario no tiene Telegram vinculado.
  - `failed`: 5 intentos fallidos (token inválido, usuario bloqueó el bot). Para reintentar: poner `status: 'scheduled'`, `attempts: 0`, `dueAt: ahora` (consola o script con Admin SDK). El barrido lo tomará en el siguiente minuto.
  - `sending` atascado: se recupera solo cuando vence `lockedUntil` (2 min).
- **Barrido detenido:** Cloud Scheduler → trabajo `firebase-schedule-reminderSweep-*` → ver ejecuciones; «Forzar ejecución».

## Saldos que no cuadran
Ejecutar la conciliación `recomputeBalance(ctx, accountId)` (`functions/src/finance/service.ts`) desde un script con Admin SDK. Si `matches: false`, revisar movimientos de la cuenta en la auditoría (`tx.*`) y corregir con una anulación y un nuevo registro, nunca editando `balance` a mano sin dejar auditoría.

## Telegram
- `getWebhookInfo` (`scripts/telegram-setup.mjs` lo imprime) → `last_error_message`.
- Token comprometido: BotFather → `/revoke`, actualizar `TELEGRAM_BOT_TOKEN`, redesplegar functions, correr el script.
- Secreto del webhook comprometido: generar uno nuevo, actualizar el secreto, redesplegar, correr el script.

## Revocar accesos
- Miembro: PWA → Configuración → Miembros → Quitar (o `member.remove`). Efecto inmediato en reglas y backend.
- Telegram de un usuario: borrar `telegramLinks/{chatId}` y poner `users/{uid}.telegram = null` (equivale a desvincular).
- Cuenta: deshabilitar el usuario en Firebase Auth (consola) — el callable rechaza sus tokens nuevos.

## Restaurar información
- PITR: `gcloud firestore databases restore` a una base nueva en el instante deseado; copiar los documentos afectados.
- Export: `gcloud firestore import gs://<bucket>/<carpeta>` en un proyecto de staging; nunca importar sobre producción sin revisar.

## Incidentes
1. Contener: desactivar el webhook (`deleteWebhook`) o la función afectada; si hay fuga de datos, revocar sesiones (Auth → deshabilitar usuarios afectados).
2. Evaluar con auditoría y logs qué datos y espacios se afectaron.
3. Corregir con prueba que reproduzca el problema; desplegar siguiendo `docs/deployment.md`.
4. Comunicar a los usuarios afectados y documentar el incidente.

## Solicitudes de exportación/eliminación (manual hasta Fase 9)
- Exportar: espacios donde el usuario es propietario + su perfil, con un script Admin SDK.
- Eliminar: quitar membresías, borrar espacio personal y perfil, desvincular Telegram, borrar usuario de Auth. Las copias de seguridad expiran según su política de retención; informarlo al usuario.
