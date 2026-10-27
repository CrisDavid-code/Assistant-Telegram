// Registra el webhook y los comandos del bot. Uso (los valores NO se guardan en el repo):
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... WEBHOOK_URL=https://<region>-<proyecto>.cloudfunctions.net/telegramWebhook node scripts/telegram-setup.mjs
const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret, WEBHOOK_URL: url } = process.env;
if (!token || !secret || !url) {
  console.error('Faltan TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET o WEBHOOK_URL.');
  process.exit(1);
}
const call = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  console.log(method, json.ok ? 'OK' : `ERROR: ${json.description}`);
  if (!json.ok) process.exit(1);
};
await call('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
await call('setMyCommands', {
  language_code: 'es',
  commands: [
    ['start', 'Bienvenida y vinculación'], ['ayuda', 'Ayuda y ejemplos'], ['menu', 'Accesos rápidos'], ['hoy', 'Resumen del día'],
    ['recordar', 'Crear recordatorio'], ['tarea', 'Crear tarea'], ['pendientes', 'Ver pendientes'], ['gasto', 'Registrar gasto'],
    ['ingreso', 'Registrar ingreso'], ['pago', 'Pagos y cobros pendientes'], ['presupuesto', 'Ver presupuestos'], ['contacto', 'Guardar o buscar contacto'],
    ['espacio', 'Cambiar de espacio'], ['configuracion', 'Preferencias'], ['desvincular', 'Desvincular este chat'],
  ].map(([command, description]) => ({ command, description })),
});
await call('getWebhookInfo', {});
