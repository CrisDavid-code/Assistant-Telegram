# Bot de Telegram: configuración

## 1. Crear el bot
1. En Telegram abre **@BotFather** → `/newbot`.
2. Nombre visible: `Aguiteks LifeOS`. Usuario: el disponible (p. ej. `AguiteksLifeOSBot`).
3. Guarda el token **sin pegarlo en chats ni en el repositorio**.
4. Opcional en BotFather: `/setdescription`, `/setuserpic`, `/setprivacy` → Enable.

## 2. Secretos y variables
```bash
firebase functions:secrets:set TELEGRAM_BOT_TOKEN        # pega el token
openssl rand -hex 32 | firebase functions:secrets:set TELEGRAM_WEBHOOK_SECRET --data-file=-
echo "TELEGRAM_BOT_USERNAME=AguiteksLifeOSBot" >> functions/.env
echo "APP_URL=https://tu-dominio" >> functions/.env
```
En la PWA: `VITE_TELEGRAM_BOT_USERNAME=AguiteksLifeOSBot` en `apps/web/.env.production`.

## 3. Desplegar y registrar el webhook
```bash
firebase deploy --only functions
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
WEBHOOK_URL=https://us-central1-<proyecto>.cloudfunctions.net/telegramWebhook \
node scripts/telegram-setup.mjs
```
El script ejecuta `setWebhook` (con `secret_token`), `setMyCommands` (español) y `getWebhookInfo`.
La URL exacta aparece en la salida de `firebase deploy`.

## 4. Vinculación (usuario)
1. PWA → Configuración → Telegram → **Generar código** (10 min, un solo uso).
2. Tocar «Abrir Telegram y vincular» (enlace `t.me/<bot>?start=CÓDIGO`) o enviar el código al bot.
3. El bot confirma y muestra ejemplos. Desvincular: botón en la PWA o `/desvincular`.

Un bot no puede escribir primero a quien nunca lo inició: el usuario debe abrirlo y tocar **Iniciar**.

## Comandos
`/start /ayuda /menu /hoy /recordar /tarea /pendientes /gasto /ingreso /pago /presupuesto /contacto /espacio /configuracion /desvincular`. El lenguaje natural es la interfaz principal.

## Pruebas
- Automáticas: `npm run test:emu` (`tests/telegram.test.ts`) con un cliente de Telegram simulado.
- Manual en producción: vincular, «Gasté Q10 en café» → Confirmar → verlo en PWA → Finanzas; `/hoy`; recordatorio «en 2 minutos»; `/desvincular`.

## Recuperación de errores
- `getWebhookInfo` muestra `last_error_message` y `pending_update_count`.
- 401 en logs: el secreto del webhook no coincide → volver a correr el script con el secreto actual.
- Mensajes duplicados: imposible por `telegramUpdates/{update_id}`; si se procesó con error, el usuario recibe el mensaje de error y debe reintentar.
- Ver `docs/runbooks.md`.
