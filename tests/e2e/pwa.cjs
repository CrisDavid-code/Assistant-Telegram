const { chromium } = require('playwright');
// Recorrido E2E de la PWA contra emuladores. Ver README → Pruebas.
const out = process.argv[2] ?? '.';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const step = async (name, fn) => { try { await fn(); console.log('✓', name); } catch (e) { console.log('✗', name, e.message.split('\n')[0]); await p.screenshot({ path: `${out}/fail-${name.replace(/\W+/g, '_')}.png` }); throw e; } };
  await p.goto(process.env.APP_URL ?? 'http://127.0.0.1:5173/');
  await step('redirige a login', () => p.getByRole('heading', { name: 'Aguiteks LifeOS' }).waitFor());
  await step('registro', async () => {
    await p.getByRole('button', { name: 'Crear una cuenta' }).click();
    await p.getByLabel('Nombre').fill('Cristián Prueba');
    await p.getByLabel('Correo').fill(`e2e${Date.now()}@test.dev`);
    await p.getByLabel('Contraseña').fill('secreto123');
    await p.getByRole('button', { name: 'Crear cuenta' }).click();
    await p.getByText(/Buen(os|as) (días|tardes|noches), Cristián/).waitFor({ timeout: 30000 });
  });
  await p.screenshot({ path: `${out}/1-dashboard.png` });
  await step('crear tarea', async () => {
    await p.getByRole('link', { name: 'Tarea' }).click();
    await p.getByLabel('Título').fill('Pagar el internet');
    const today = await p.evaluate(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' }));
    await p.getByLabel('Fecha').fill(today);
    await p.getByRole('button', { name: 'Guardar' }).click();
    await p.getByText('Pagar el internet').waitFor();
  });
  await p.screenshot({ path: `${out}/2-agenda.png` });
  await step('completar tarea', async () => {
    await p.getByRole('button', { name: 'Completar tarea' }).click();
    await p.getByText('Nada pendiente para hoy.').waitFor();
  });
  await step('crear cuenta financiera', async () => {
    await p.getByRole('link', { name: 'Finanzas' }).click();
    await p.getByRole('tab', { name: 'Cuentas' }).click();
    await p.getByRole('button', { name: 'Nueva cuenta' }).click();
    await p.getByLabel('Nombre').fill('Efectivo');
    await p.getByLabel('Tipo').selectOption('cash');
    await p.getByLabel('Saldo inicial').fill('500');
    await p.getByRole('button', { name: 'Guardar' }).click();
    await p.getByText(/Q\s?500\.00/).first().waitFor();
  });
  await step('gasto por el asistente con confirmación', async () => {
    await p.getByRole('link', { name: 'Asistente' }).click();
    await p.getByLabel('Mensaje').fill('Gasté Q125 en gasolina y pagué en efectivo');
    await p.getByRole('button', { name: 'Enviar' }).click();
    await p.getByText(/Voy a registrar un gasto de Q\s?125.00/).waitFor({ timeout: 20000 });
    await p.screenshot({ path: `${out}/3-asistente.png` });
    await p.getByRole('button', { name: '✅ Confirmar' }).click();
    await p.getByText(/Gasto registrado/).waitFor({ timeout: 20000 });
  });
  await step('saldo y movimiento reflejados', async () => {
    await p.getByRole('link', { name: 'Finanzas' }).click();
    await p.getByRole('tab', { name: 'Cuentas' }).click();
    await p.getByText(/Q\s?375\.00/).first().waitFor();
    await p.getByRole('tab', { name: 'Resumen' }).click();
    await p.getByText('Transporte').waitFor();
  });
  await p.screenshot({ path: `${out}/4-finanzas.png` });
  await step('código de Telegram', async () => {
    await p.getByRole('button', { name: 'Configuración' }).click();
    await p.getByRole('button', { name: 'Generar código' }).click();
    await p.locator('.font-mono').waitFor();
  });
  await p.screenshot({ path: `${out}/5-config.png`, fullPage: true });
  await step('cerrar sesión', async () => {
    await p.getByRole('button', { name: 'Cerrar sesión' }).click();
    await p.getByRole('button', { name: 'Entrar' }).waitFor();
  });
  console.log('errores de consola:', errors.filter((e) => !/favicon|DevTools/.test(e)));
  await b.close();
})().catch(() => process.exit(1));
