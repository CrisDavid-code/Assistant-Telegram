// Dinero: siempre enteros en unidades menores (centavos) + moneda explícita. Nunca float para guardar.

export const CURRENCIES = {
  GTQ: { digits: 2, name: 'Quetzal' },
  USD: { digits: 2, name: 'Dólar estadounidense' },
  MXN: { digits: 2, name: 'Peso mexicano' },
  HNL: { digits: 2, name: 'Lempira' },
  NIO: { digits: 2, name: 'Córdoba' },
  CRC: { digits: 2, name: 'Colón costarricense' },
  EUR: { digits: 2, name: 'Euro' },
} as const;

export type Currency = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as [Currency, ...Currency[]];

/** Tope por operación: evita errores de dedo (Q1,000,000,000) y desbordes. */
export const MAX_AMOUNT_MINOR = 100_000_000_000; // 1,000 millones en unidades mayores

/**
 * "Q1,250.50" | "1250.5" | "4,500" → unidades menores (125050, 125050, 450000).
 * Convención de Guatemala: coma = miles, punto = decimales. Devuelve null si no es un monto válido.
 */
export function parseAmount(text: string, currency: Currency = 'GTQ'): number | null {
  const clean = text.trim().replace(/^(q|gtq|us\$|\$|usd)\s*/i, '').replace(/\s*(quetzales|quetzal|dólares|dolares|usd|gtq)$/i, '');
  if (!/^\d{1,3}(,\d{3})*(\.\d+)?$|^\d+(\.\d+)?$/.test(clean)) return null;
  const [int, dec = ''] = clean.replace(/,/g, '').split('.');
  const digits = CURRENCIES[currency].digits;
  if (dec.length > digits) return null;
  const minor = Number(int) * 10 ** digits + Number(dec.padEnd(digits, '0') || 0);
  return Number.isSafeInteger(minor) && minor > 0 && minor <= MAX_AMOUNT_MINOR ? minor : null;
}

export function formatMoney(minor: number, currency: Currency, locale = 'es-GT'): string {
  const digits = CURRENCIES[currency].digits;
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: digits }).format(minor / 10 ** digits);
}

export const EXPENSE_CATEGORIES = {
  alimentacion: 'Alimentación',
  transporte: 'Transporte',
  vivienda: 'Vivienda',
  servicios: 'Servicios',
  salud: 'Salud',
  educacion: 'Educación',
  compras: 'Compras',
  suscripciones: 'Suscripciones',
  entretenimiento: 'Entretenimiento',
  negocio: 'Negocio',
  mascotas: 'Mascotas',
  otros: 'Otros',
} as const;

export const INCOME_CATEGORIES = {
  salario: 'Salario',
  ventas: 'Ventas',
  servicios: 'Servicios',
  comisiones: 'Comisiones',
  cobros: 'Cobros',
  otros: 'Otros ingresos',
} as const;

export function categoryLabel(kind: 'income' | 'expense' | 'transfer', slug: string): string {
  const map: Record<string, string> = kind === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  return map[slug] ?? slug;
}
