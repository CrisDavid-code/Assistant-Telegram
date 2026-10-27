import { DateTime } from 'luxon';
import { parseAmount, type Currency } from '@lifeos/contracts';
import { extractWhen } from './dates';
import type { AIProvider, Intent, InterpretContext } from './types';

// Intérprete determinista (sin costo ni red). Cubre las frases frecuentes; lo que no entiende devuelve
// "unknown" y, si hay un proveedor de IA configurado, se le pregunta a él.

const CATEGORY_WORDS: [RegExp, string][] = [
  [/gasolina|combustible|di[eé]sel|uber|taxi|bus|camioneta|parqueo|pasaje|transporte|peaje/, 'transporte'],
  [/almuerzo|desayuno|cena|comida|restaurante|caf[eé]|super(mercado)?|despensa|pollo|pizza|tortillas|mercado/, 'alimentacion'],
  [/internet|luz|energ[ií]a|agua|tel[eé]fono|celular|cable|gas\b|recarga/, 'servicios'],
  [/renta|alquiler|hipoteca|casa|condominio/, 'vivienda'],
  [/medicina|farmacia|doctor|m[eé]dico|consulta|hospital|dentista|laboratorio/, 'salud'],
  [/colegio|universidad|curso|libros?|matr[ií]cula|colegiatura|clases?/, 'educacion'],
  [/netflix|spotify|suscripci[oó]n|youtube|icloud|disney|hbo|chatgpt|claude/, 'suscripciones'],
  [/perros?|gatos?|mascotas?|veterinari[oa]|concentrado|alimento para/, 'mascotas'],
  [/ropa|zapatos|tienda|amazon|compra/, 'compras'],
  [/cine|fiesta|salida|juego|concierto|viaje/, 'entretenimiento'],
];
const INCOME_WORDS: [RegExp, string][] = [
  [/salario|sueldo|quincena|n[oó]mina|aguinaldo|bono\s*14/, 'salario'],
  [/venta|vend[ií]/, 'ventas'],
  [/comisi[oó]n/, 'comisiones'],
  [/servicio|proyecto|trabajo|cliente|honorarios/, 'servicios'],
];
// `\b` de JavaScript no reconoce letras acentuadas: «gasté\b» nunca coincide. Se usa este límite.
const B = '(?![\\wáéíóúñ])';
const pick = (text: string, table: [RegExp, string][], dflt: string) => table.find(([re]) => re.test(text))?.[1] ?? dflt;

// Monto con marcador de moneda o número suelto (no confunde "a las 8" porque se busca tras quitar fechas).
const AMOUNT_RE = /(?:\b(gtq|usd)\s?|\b(q)\.?\s?|(\$)\s?)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?:\s*(quetzales|d[oó]lares|usd|gtq|mil)\b)?/i;

function takeAmount(text: string, dflt: Currency) {
  const m = AMOUNT_RE.exec(text);
  if (!m) return { rest: text };
  const usd = /usd|\$|d[oó]lares/i.test(`${m[1] ?? ''}${m[3] ?? ''}${m[5] ?? ''}`);
  const currency: Currency = usd ? 'USD' : m[2] || /gtq|quetzales/i.test(`${m[1] ?? ''}${m[5] ?? ''}`) ? 'GTQ' : dflt;
  let amount = parseAmount(m[4]!, currency);
  if (amount && /mil/i.test(m[5] ?? '')) amount *= 1000;
  return { amount: amount ?? undefined, currency, rest: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim() };
}

const PAY_METHOD = /(?:\by\s+)?(?:\blo\s+)?(?:\bpagu[eé]\s+)?\b(?:en|con)\s+(efectivo|tarjeta(?:\s+de\s+(?:cr[eé]dito|d[eé]bito))?|transferencia|(?:mi\s+)?cuenta\s+(?:de\s+)?[\wáéíóúñ]+)\b/i;
const cleanTitle = (s: string) => s.replace(/^(?:que|de|a|para|por|en)\s+/i, '').replace(/[.!?¿¡]+$/g, '').trim();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function parseRules(input: string, ctx: InterpretContext): Intent {
  const text = input.trim().replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  const now = DateTime.fromISO(ctx.now, { setZone: true });
  const cur = ctx.currency as Currency;
  const isQuestion = new RegExp(`^[¿]|[?]$|^(qu[eé]|cu[aá]nto|cu[aá]les|cu[aá]ndo|d[oó]nde|muestra|mu[eé]strame|dime|ver|busca)${B}`).test(lower);

  if (/^(hola|buenas|ayuda|help|qu[eé] puedes hacer|c[oó]mo funciona)/.test(lower)) return { type: 'help' };

  if (isQuestion) {
    const contact = /\b(?:busca|buscar|encuentra|cu[aá]l es)\s+(?:el\s+)?(?:contacto|n[uú]mero|tel[eé]fono)\s+(?:de\s+)?(.+)/i.exec(text);
    if (contact) return { type: 'query', topic: 'contacts', term: cleanTitle(contact[1]!.replace(/^(la|el)\s+/i, '')) };
    if (/cu[aá]nto\s+(?:he\s+|hemos\s+)?gast|gastos?\s+del?\s+mes/.test(lower)) return { type: 'query', topic: 'spending' };
    if (/presupuesto/.test(lower)) return { type: 'query', topic: 'budget' };
    if (/(pagos?|facturas?|cobros?|vencen|vencimientos?|deudas?|debo|me\s+deben)/.test(lower)) return { type: 'query', topic: 'bills' };
    if (/(dinero|saldos?|disponible|cu[aá]nto\s+tengo|cuentas)/.test(lower)) return { type: 'query', topic: 'balance' };
    if (/\bhoy\b|qu[eé]\s+tengo|agenda|d[ií]a/.test(lower)) return { type: 'query', topic: 'today' };
    if (/pendientes|tareas/.test(lower)) return { type: 'query', topic: 'pending' };
  }

  // Cobro esperado: "tengo que cobrar Q2,500 cuando entregue el trabajo" (antes que "tengo que" → tarea).
  if (/\b(tengo\s+que\s+cobrar|por\s+cobrar|me\s+van\s+a\s+pagar|me\s+pagar[aá]n)\b/.test(lower)) {
    const a = takeAmount(text, cur);
    if (a.amount) {
      const { when, rest } = extractWhen(a.rest, now);
      return { type: 'debt', direction: 'receivable', kind: 'expected', amount: a.amount, currency: a.currency, dueDate: when.date, title: cap(cleanTitle(rest).slice(0, 120)) || 'Cobro pendiente' };
    }
  }

  // Deudas: "Juan me debe Q800 y me pagará el viernes" / "le debo Q500 a María"
  const owes = /^(.+?)\s+me\s+deben?\s+(.+)$/i.exec(text);
  if (owes) {
    const a = takeAmount(owes[2]!, cur);
    const { when } = extractWhen(a.rest, now);
    const who = cleanTitle(owes[1]!.replace(/^(el|la)\s+/i, ''));
    return { type: 'debt', direction: 'receivable', kind: 'debt', counterparty: cap(who), title: `${cap(who)} me debe`, amount: a.amount, currency: a.currency, dueDate: when.date };
  }
  const iOwe = /\b(?:le\s+)?debo\s+(.+?)\s+a\s+([\wáéíóúñ ]+?)(?:\s+(?:y|para|el|antes)\b.*)?$/i.exec(text);
  if (iOwe) {
    const a = takeAmount(iOwe[1]!, cur);
    const { when } = extractWhen(text.slice(iOwe.index + iOwe[0].indexOf(iOwe[2]!) + iOwe[2]!.length), now);
    if (a.amount) return { type: 'debt', direction: 'payable', kind: 'debt', counterparty: cap(iOwe[2]!.trim()), title: `Deuda con ${cap(iOwe[2]!.trim())}`, amount: a.amount, currency: a.currency, dueDate: when.date };
  }

  // Gastos e ingresos
  const exp = new RegExp(`\\b(gast[eé]|pagu[eé]|compr[eé]|me\\s+cost[oó]|registra(?:r)?\\s+(?:un\\s+)?gasto(?:\\s+de)?)${B}`, 'i').exec(text);
  const inc = new RegExp(`\\b(recib[ií]|me\\s+pagaron|cobr[eé]|gan[eé]|me\\s+depositaron|me\\s+cayeron|registra(?:r)?\\s+(?:un\\s+)?ingreso(?:\\s+de)?)${B}`, 'i').exec(text);
  if (exp || inc) {
    const kind = exp && (!inc || exp.index < inc.index) ? 'expense' : 'income';
    const verb = (kind === 'expense' ? exp : inc)!;
    let body = text.slice(verb.index + verb[0].length);
    const method = PAY_METHOD.exec(body);
    if (method) body = body.slice(0, method.index) + body.slice(method.index + method[0].length);
    const a = takeAmount(body, cur);
    const { when, rest } = extractWhen(a.rest, now);
    const description = cleanTitle(rest.replace(/^(?:en|de|por|para)\s+/i, '')).slice(0, 200);
    const category = kind === 'expense' ? pick(description.toLowerCase(), CATEGORY_WORDS, 'otros') : pick(description.toLowerCase(), INCOME_WORDS, 'otros');
    return {
      type: kind, amount: a.amount, currency: a.amount ? a.currency : undefined, category, description: cap(description),
      accountHint: method?.[1]?.replace(/^mi\s+/i, '').toLowerCase(),
      date: when.date ?? extractWhen(text.slice(0, verb.index), now).when.date, // "Hoy recibí…"

    };
  }

  // Recordatorios: "Recuérdame mañana a las 8 pagar el internet"
  const rem = /^(?:por\s+favor\s+)?(recu[eé]rdame|recordarme|av[ií]same|recordatorio(?:\s+para)?:?|agenda(?:r)?(?=\s+(?:una?\s+)?(?:llamada|reuni[oó]n|cita|visita)))\s*/i.exec(text);
  if (rem) {
    const { when, rest } = extractWhen(text.slice(rem[0].length), now);
    const title = cap(cleanTitle(rest.replace(/^(?:una?\s+)/i, '')));
    if (!title) return { type: 'unknown' };
    return { type: 'reminder', title, date: when.date, time: when.time, recurrence: when.recurrence };
  }

  // Tareas: "Tengo que llamar a María mañana para confirmar la reunión"
  const task = /^(tengo\s+que|debo|hay\s+que|necesito|tarea:?|pendiente:?|agrega(?:r)?\s+(?:una\s+)?tarea:?|anota:?)\s+/i.exec(text);
  if (task) {
    const { when, rest } = extractWhen(text.slice(task[0].length), now);
    const title = cap(cleanTitle(rest));
    if (title) return { type: 'task', title, date: when.date, time: when.time };
  }

  if (isQuestion && /pendiente|tarea/.test(lower)) return { type: 'query', topic: 'pending' };
  return { type: 'unknown' };
}

export const rulesProvider: AIProvider = {
  name: 'reglas',
  interpret: async (text, ctx) => parseRules(text, ctx),
};
