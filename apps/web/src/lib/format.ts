import { formatMoney, type Currency } from '@lifeos/contracts';

export const money = (minor: number, currency: string) => formatMoney(minor, currency as Currency);

const fmt = (tz: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-GT', { timeZone: tz, ...opts });

/** Fecha local AAAA-MM-DD del espacio. */
export const todayIn = (tz: string, d = new Date()) => fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('/').reverse().join('-');
export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const dayLabel = (iso: string, tz: string) => {
  const t = todayIn(tz);
  if (iso === t) return 'Hoy';
  if (iso === addDays(t, 1)) return 'Mañana';
  if (iso === addDays(t, -1)) return 'Ayer';
  return new Intl.DateTimeFormat('es-GT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
};
export const dateTimeLabel = (d: Date, tz: string) => fmt(tz, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
/** Instante → "AAAA-MM-DDTHH:MM" local, para <input type="datetime-local">. */
export const localInput = (d: Date, tz: string) => {
  const p = Object.fromEntries(fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
};
