import { DateTime } from 'luxon';
import type { Recurrence } from '@lifeos/contracts';
import { fail } from './errors';

/**
 * Hora local (zona del espacio) → instante absoluto. Luxon resuelve horario de verano:
 * una hora inexistente se corre hacia adelante y una ambigua toma la primera ocurrencia.
 */
export function zoned(date: string, time: string, tz: string): Date {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: tz });
  if (!dt.isValid) fail('invalid-argument', 'Fecha u hora inválida.');
  return dt.toJSDate();
}

export const nowIn = (tz: string, now = new Date()) => DateTime.fromJSDate(now, { zone: tz });
export const todayIn = (tz: string, now = new Date()) => nowIn(tz, now).toISODate()!;

/** Mes local "AAAA-MM" → [inicio, fin) absolutos. */
export function monthRange(month: string, tz: string): [Date, Date] {
  const start = DateTime.fromISO(`${month}-01T00:00`, { zone: tz });
  if (!start.isValid) fail('invalid-argument', 'Mes inválido.');
  return [start.toJSDate(), start.plus({ months: 1 }).toJSDate()];
}

/** Siguiente ocurrencia de una regla, conservando la hora local (no el desfase UTC) y el día ancla del mes. */
export function nextOccurrence(prev: Date, tz: string, rule: Recurrence, anchorDay?: number): Date | null {
  const cur = DateTime.fromJSDate(prev, { zone: tz });
  const n = rule.interval ?? 1;
  let next =
    rule.freq === 'daily' ? cur.plus({ days: n })
    : rule.freq === 'weekly' ? cur.plus({ weeks: n })
    : rule.freq === 'monthly' ? cur.plus({ months: n })
    : cur.plus({ years: n });
  if ((rule.freq === 'monthly' || rule.freq === 'yearly') && anchorDay) {
    next = next.set({ day: Math.min(anchorDay, next.daysInMonth!) });
  }
  if (rule.until && next.toISODate()! > rule.until) return null;
  return next.toJSDate();
}
