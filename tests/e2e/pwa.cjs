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
    await p.getByLabel('Fecha', { exact: true }).fill(today);
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
  await step('proyecto con tarea y avance', async () => {
    await p.getByRole('link', { name: 'Más' }).click();
    await p.getByRole('link', { name: 'Proyectos' }).click();
    await p.getByRole('button', { name: 'Nuevo' }).click();
    await p.getByLabel('Nombre').fill('Sitio web');
    await p.getByRole('button', { name: 'Guardar' }).click();
    await p.getByRole('button', { name: /Sitio web/ }).click();
    await p.getByRole('button', { name: 'Tarea' }).click();
    await p.getByLabel('Título').fill('Diseñar portada');
    await p.getByRole('button', { name: 'Guardar' }).click();
    await p.getByText('Diseñar portada').waitFor();
    await p.getByRole('button', { name: 'Completar tarea' }).click();
    await p.getByText(/Avance: 100%/).waitFor();
    await p.keyboard.press('Escape');
  });
  await step('documento con archivo', async () => {
    await p.getByRole('link', { name: 'Más' }).click();
    await p.getByRole('link', { name: 'Documentos' }).click();
    await p.getByRole('button', { name: 'Nuevo' }).click();
    await p.getByLabel('Título').fill('Licencia de conducir');
    await p.getByLabel('Tipo').selectOption('license');
    await p.getByLabel('Vencimiento', { exact: true }).fill('2030-01-15');
    await p.locator('input[type=file]').setInputFiles({ name: 'licencia.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
    await p.getByRole('button', { name: 'Guardar' }).click();
    await p.getByText('Licencia de conducir').waitFor();
    const dl = p.waitForEvent('download');
    await p.getByRole('button', { name: 'Descargar Licencia de conducir' }).click();
    if ((await dl).suggestedFilename() !== 'licencia.pdf') throw new Error('descarga incorrecta');
  });
  await step('oportunidad ganada con cobro esperado', async () => {
    await p.getByRole('link', { name: 'Más' }).click();
    await p.getByRole('link', { name: 'Oportunidades' }).click();
    await p.getByRole('button', { name: 'Nueva' }).click();
    await p.getByLabel('Oportunidad', { exact: true }).fill('Página para Ferretería');
    await p.getByLabel(/Monto/).fill('2500');
    await p.getByRole('button', { name: 'Guardar' }).click();
    p.once('dialog', (d) => d.accept());
    await p.getByLabel('Etapa').selectOption('won');
    await p.getByText('Cobro registrado').waitFor();
  });
  await step('meta de ahorro con aporte', async () => {
    await p.getByRole('link', { name: 'Finanzas' }).click();
    await p.getByRole('tab', { name: 'Metas' }).click();
    await p.getByRole('button', { name: 'Meta' }).click();
    await p.getByLabel('Nombre').fill('Viaje');
    await p.getByLabel('Objetivo', { exact: true }).fill('1000');
    await p.getByRole('button', { name: 'Guardar' }).click();
    await p.getByRole('button', { name: 'Aportar' }).click();
    await p.getByLabel(/Monto/).fill('250');
    await p.getByRole('button', { name: 'Registrar' }).click();
    await p.getByText(/\(25%\)/).waitFor();
  });
  await step('calendario mensual', async () => {
    await p.getByRole('link', { name: 'Agenda' }).click();
    await p.getByRole('tab', { name: 'Calendario' }).click();
    await p.getByRole('button', { name: 'Mes siguiente' }).waitFor();
  });
  await step('código de Telegram', async () => {
    await p.getByRole('button', { name: 'Configuración' }).click();
    await p.getByRole('button', { name: 'Generar código' }).click();
    await p.locator('.font-mono').waitFor();
  });
  await p.screenshot({ path: `${out}/5-config.png`, fullPage: true });
  await step('exportar datos', async () => {
    const dl = p.waitForEvent('download');
    await p.getByRole('button', { name: 'Exportar mis datos' }).click();
    const data = JSON.parse(require('fs').readFileSync(await (await dl).path(), 'utf8'));
    if (!Object.keys(data.spaces).length) throw new Error('exportación vacía');
  });
  await step('eliminar cuenta', async () => {
    await p.getByText('Eliminar mi cuenta', { exact: true }).click();
    await p.getByLabel('Escribe ELIMINAR para confirmar').fill('ELIMINAR');
    await p.getByRole('button', { name: 'Eliminar mi cuenta definitivamente' }).click();
    await p.getByRole('button', { name: 'Entrar' }).waitFor({ timeout: 30000 });
  });
  console.log('errores de consola:', errors.filter((e) => !/favicon|DevTools/.test(e)));
  await b.close();
})().catch(() => process.exit(1));
