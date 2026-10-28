# Runbooks

## Investigar un fallo
1. `cd worker && npx wrangler tail` (en vivo) o el panel de Cloudflare → Workers → Logs — buscar `api.error`, `telegram.update.failed`, `ai.interpret.failed`.
2. Auditoría del espacio: `spaces/{sid}/audit` ordenado por `at` (actor, operación, origen).
3. Reproducir localmente con emuladores y una prueba en `tests/` antes de corregir.

## Recordatorios
- **No llegan:** revisar el documento: `status`, `attempts`, `lastError`.
  - `undeliverable`: el usuario no tiene Telegram vinculado.
  - `failed`: 5 intentos fallidos (token inválido, usuario bloqueó el bot). Para reintentar: poner `status: 'scheduled'`, `attempts: 0`, `dueAt: ahora` (consola de Firestore). El barrido lo tomará en el siguiente minuto.
  - `sending` atascado: se recupera solo cuando vence `lockedUntil` (2 min).
- **Barrido detenido:** panel de Cloudflare → Worker → *Triggers* → Cron (ver ejecuciones). Revisar si se agotó la cuota diaria de Firestore (consola → Uso).

## Saldos que no cuadran
Ejecutar la conciliación `recomputeBalance(ctx, accountId)` (`worker/src/finance/service.ts`) desde un script con la cuenta de servicio. Si `matches: false`, revisar movimientos de la cuenta en la auditoría (`tx.*`) y corregir con una anulación y un nuevo registro, nunca editando `balance` a mano sin dejar auditoría.

## Telegram
- `getWebhookInfo` (`scripts/telegram-setup.mjs` lo imprime) → `last_error_message`.
- Token comprometido: BotFather → `/revoke`, `npx wrangler secret put TELEGRAM_BOT_TOKEN` (aplica sin redesplegar), correr el script.
- Secreto del webhook comprometido: generar uno nuevo, `npx wrangler secret put TELEGRAM_WEBHOOK_SECRET`, correr el script.

## Revocar accesos
- Miembro: PWA → Configuración → Miembros → Quitar (o `member.remove`). Efecto inmediato en reglas y backend.
- Telegram de un usuario: borrar `telegramLinks/{chatId}` y poner `users/{uid}.telegram = null` (equivale a desvincular).
- Cuenta: deshabilitar el usuario en Firebase Auth (consola) — el Worker rechaza sus tokens al vencer (máx. 1 hora); para efecto inmediato, también quitar sus membresías.

## Restaurar información
- En plan Spark no hay PITR ni exportaciones administradas (requieren facturación). Restaurar desde los respaldos JSON (script pendiente, Fase 9) o reconstruir con la auditoría.
- Si se activa facturación en el futuro: PITR (`gcloud firestore databases restore`) y exportaciones a un bucket.

## Incidentes
1. Contener: desactivar el webhook (`deleteWebhook`) o el Worker (`npx wrangler rollback` o pausar la ruta en el panel); si hay fuga de datos, revocar sesiones (Auth → deshabilitar usuarios afectados).
2. Evaluar con auditoría y logs qué datos y espacios se afectaron.
3. Corregir con prueba que reproduzca el problema; desplegar siguiendo `docs/deployment.md`.
4. Comunicar a los usuarios afectados y documentar el incidente.

## Solicitudes de exportación/eliminación (manual hasta Fase 9)
- Exportar: espacios donde el usuario es propietario + su perfil, con un script que use la cuenta de servicio.
- Eliminar: quitar membresías, borrar espacio personal y perfil, desvincular Telegram, borrar usuario de Auth. Las copias de seguridad expiran según su política de retención; informarlo al usuario.
