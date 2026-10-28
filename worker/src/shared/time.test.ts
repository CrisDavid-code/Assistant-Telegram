import { describe, expect, it } from 'vitest';
import { nextOccurrence, zoned } from './time';

describe('zonas horarias', () => {
  it('Guatemala es UTC-6', () => {
    expect(zoned('2026-10-28', '08:00', 'America/Guatemala').toISOString()).toBe('2026-10-28T14:00:00.000Z');
  });
  it('recurrencia diaria conserva la hora local a través del cambio de horario', () => {
    // Nueva York cambia de horario el 1 de noviembre de 2026.
    const prev = zoned('2026-10-31', '08:00', 'America/New_York');
    const next = nextOccurrence(prev, 'America/New_York', { freq: 'daily', interval: 1 })!;
    expect(next.toISOString()).toBe('2026-11-01T13:00:00.000Z'); // 08:00 EST
  });
  it('hora inexistente (salto de horario) se corre hacia adelante', () => {
    expect(zoned('2026-03-08', '02:30', 'America/New_York').toISOString()).toBe('2026-03-08T07:30:00.000Z');
  });
  it('mensual del 31 respeta meses cortos sin desplazarse', () => {
    const jan = zoned('2026-01-31', '09:00', 'America/Guatemala');
    const feb = nextOccurrence(jan, 'America/Guatemala', { freq: 'monthly', interval: 1 }, 31)!;
    const mar = nextOccurrence(feb, 'America/Guatemala', { freq: 'monthly', interval: 1 }, 31)!;
    expect(feb.toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(mar.toISOString().slice(0, 10)).toBe('2026-03-31');
  });
  it('respeta la fecha final', () => {
    const d = zoned('2026-10-30', '09:00', 'America/Guatemala');
    expect(nextOccurrence(d, 'America/Guatemala', { freq: 'weekly', interval: 1, until: '2026-11-05' })).toBeNull();
  });
});
