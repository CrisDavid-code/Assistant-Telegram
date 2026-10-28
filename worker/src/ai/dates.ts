import { DateTime } from 'luxon';
import type { Recurrence } from '@lifeos/contracts';

// Expresiones de fecha/hora en español → fecha y hora LOCALES (la zona la aplica quien llama).
// Devuelve también el texto sin esas expresiones para usarlo como título.

export interface When {
  date?: string; // AAAA-MM-DD
  time?: string; // HH:MM
  recurrence?: Recurrence;
}

const WEEKDAYS: Record<string, number> = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 7 };
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const NUMBERS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, quince: 15, veinte: 20, treinta: 30 };
const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const num = (s: string) => NUMBERS[s] ?? Number(s);

const WD = '(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)';
const N = '(\\d+|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta)';

function nextWeekday(today: DateTime, wd: number, allowToday: boolean) {
  let diff = (wd - today.weekday + 7) % 7;
  if (diff === 0 && !allowToday) diff = 7;
  return today.plus({ days: diff });
}

/** Ajusta hora sin "am/pm": 1–6 se asume tarde (15:00 es más común que 3:00 para recordatorios). */
function hour24(h: number, marker?: string) {
  const m = marker ? strip(marker) : '';
  if (/^(pm|p\.m\.|tarde|noche)$/.test(m)) return h < 12 ? h + 12 : h;
  if (/^(am|a\.m\.|manana|madrugada)$/.test(m)) return h === 12 ? 0 : h;
  // ponytail: heurística sin marcador; si molesta, preguntar AM/PM.
  return h >= 1 && h <= 6 ? h + 12 : h;
}

export function extractWhen(text: string, now: DateTime): { when: When; rest: string } {
  let s = text.toLowerCase(); // misma longitud que el original: los índices sirven para recortar
  const when: When = {};
  const today = now.startOf('day');
  const take = (re: RegExp, fn: (m: RegExpExecArray) => boolean | void) => {
    const m = re.exec(s);
    if (m && fn(m) !== false) s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length);
  };
  const setDate = (d: DateTime) => {
    when.date = d.toISODate()!;
  };

  // Recurrencia: "cada viernes", "todos los días", "mensualmente"
  take(new RegExp(`\\b(?:cada|todos los|todas las)\\s+(?:(\\d+|dos|tres|cuatro)\\s+)?(d[ií]as?|semanas?|mes(?:es)?|a[nñ]os?|${WD.slice(1, -1)})\\b`), (m) => {
    const unit = strip(m[2]!).replace(/s$/, '');
    const interval = m[1] ? num(m[1]) : 1;
    const wd = WEEKDAYS[unit] ?? WEEKDAYS[unit + 's'];
    if (wd) {
      when.recurrence = { freq: 'weekly', interval };
      setDate(nextWeekday(today, wd, true));
    } else {
      const freq = unit.startsWith('dia') ? 'daily' : unit.startsWith('semana') ? 'weekly' : unit.startsWith('me') ? 'monthly' : 'yearly';
      when.recurrence = { freq, interval };
    }
  });
  take(/\b(diario|diariamente|semanal(?:mente)?|mensual(?:mente)?|anual(?:mente)?)\b/, (m) => {
    const w = m[1]!;
    when.recurrence = { freq: w.startsWith('diari') ? 'daily' : w.startsWith('semanal') ? 'weekly' : w.startsWith('mensual') ? 'monthly' : 'yearly', interval: 1 };
  });

  // Fechas relativas
  take(/\bpasado\s+ma[nñ]ana\b/, () => setDate(today.plus({ days: 2 })));
  take(/\b(?<!la\s)ma[nñ]ana\b/, () => setDate(today.plus({ days: 1 })));
  take(/\b(?:el\s+)?d[ií]a\s+de\s+hoy\b|\bhoy\b/, () => setDate(today));
  take(/\b(?:antier|anteayer)\b/, () => setDate(today.minus({ days: 2 })));
  take(/\bayer\b/, () => setDate(today.minus({ days: 1 })));
  take(new RegExp(`\\b(?:dentro\\s+de|en)\\s+${N}\\s+(minutos?|horas?|d[ií]as?|semanas?|mes(?:es)?)\\b`), (m) => {
    const n = num(m[1]!);
    const unit = strip(m[2]!);
    if (unit.startsWith('minuto') || unit.startsWith('hora')) {
      const t = now.plus(unit.startsWith('minuto') ? { minutes: n } : { hours: n });
      setDate(t);
      when.time = t.toFormat('HH:mm');
    } else setDate(today.plus(unit.startsWith('dia') ? { days: n } : unit.startsWith('semana') ? { weeks: n } : { months: n }));
  });
  take(/\b(?:a\s+)?(?:fin|final|finales)\s+de(?:l)?\s+mes\b/, () => setDate(today.endOf('month')));
  take(/\b(?:el\s+)?primer\s+d[ií]a\s+h[aá]bil\s+del?\s+(?:pr[oó]ximo\s+)?mes\b/, () => {
    let d = today.startOf('month');
    while (d.weekday > 5) d = d.plus({ days: 1 });
    if (d < today) {
      d = today.plus({ months: 1 }).startOf('month');
      while (d.weekday > 5) d = d.plus({ days: 1 });
    }
    setDate(d);
  });
  take(new RegExp(`\\b(?:(el|este|esta)\\s+)?(?:(?:pr[oó]ximo|siguiente)\\s+)?${WD}(?:\\s+(?:pr[oó]ximo|que\\s+viene))?\\b`), (m) => {
    if (when.date) return false;
    const name = strip(m[2]!);
    const wd = WEEKDAYS[name] ?? WEEKDAYS[name.replace(/s$/, '')]!;
    setDate(nextWeekday(today, wd, m[1] === 'este' || m[1] === 'esta'));
  });
  take(new RegExp(`\\b(?:el\\s+)?(\\d{1,2})\\s+de\\s+(${MONTHS.join('|')})(?:\\s+(?:de|del)\\s+(\\d{4}))?\\b`), (m) => {
    let d = DateTime.fromObject({ year: m[3] ? Number(m[3]) : today.year, month: MONTHS.indexOf(m[2]!) + 1, day: Number(m[1]) }, { zone: now.zone });
    if (!d.isValid) return false;
    if (!m[3] && d < today) d = d.plus({ years: 1 });
    setDate(d);
  });
  take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : today.year;
    let d = DateTime.fromObject({ year: y, month: Number(m[2]), day: Number(m[1]) }, { zone: now.zone });
    if (!d.isValid) return false;
    if (!m[3] && d < today) d = d.plus({ years: 1 });
    setDate(d);
  });
  take(/\bel\s+(?:d[ií]a\s+)?(\d{1,2})\b(?!\s*(?::|am|pm|de\s+la|hrs?|horas))/, (m) => {
    if (when.date) return false;
    let d = today.set({ day: Number(m[1]) });
    if (!d.isValid || Number(m[1]) > today.daysInMonth!) return false;
    if (d < today) d = today.plus({ months: 1 }).set({ day: Number(m[1]) });
    setDate(d);
  });

  // Horas
  take(/\b(?:a\s+las?|alas)\s+(\d{1,2})(?::(\d{2}))?\s*(?:(am|a\.m\.|pm|p\.m\.)|(?:de|en|por)\s+la\s+(ma[nñ]ana|tarde|noche|madrugada)|hrs?\b|horas\b)?/, (m) => {
    const h = Number(m[1]);
    if (h > 23 || Number(m[2] ?? 0) > 59) return false;
    when.time = `${String(hour24(h, m[3] ?? m[4])).padStart(2, '0')}:${m[2] ?? '00'}`;
  });
  take(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/, (m) => {
    if (when.time || Number(m[1]) > 12) return false;
    when.time = `${String(hour24(Number(m[1]), m[3])).padStart(2, '0')}:${m[2] ?? '00'}`;
  });
  take(/\b(?:al\s+)?mediod[ií]a\b/, () => {
    when.time ??= '12:00';
  });
  take(/\b(?:en|por)\s+la\s+(ma[nñ]ana|tarde|noche)\b/, (m) => {
    when.time ??= { manana: '08:00', tarde: '15:00', noche: '20:00' }[strip(m[1]!)];
  });

  if (when.time && !when.date) {
    // Solo hora: hoy si aún no pasó, si no mañana.
    const t = DateTime.fromISO(`${today.toISODate()}T${when.time}`, { zone: now.zone });
    setDate(t > now ? today : today.plus({ days: 1 }));
  }

  const rest = [...s].map((ch, i) => (ch === ' ' && text[i] !== ' ' ? '\u0000' : text[i])).join('').replace(/\u0000+/g, ' ')
    .replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '').trim();
  return { when, rest };
}
