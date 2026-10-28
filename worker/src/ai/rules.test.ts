import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { parseRules } from './rules';
import { extractWhen } from './dates';

// Martes 27 de octubre de 2026, 10:00 en Guatemala.
const now = DateTime.fromISO('2026-10-27T10:00', { zone: 'America/Guatemala' });
const ctx = { today: '2026-10-27', now: now.toISO()!, timezone: 'America/Guatemala', currency: 'GTQ' };
const p = (t: string) => parseRules(t, ctx);

describe('fechas', () => {
  const w = (t: string) => extractWhen(t, now).when;
  it('relativas', () => {
    expect(w('mañana a las 8 de la mañana')).toEqual({ date: '2026-10-28', time: '08:00' });
    expect(w('pasado mañana')).toEqual({ date: '2026-10-29' });
    expect(w('el próximo lunes')).toEqual({ date: '2026-11-02' });
    expect(w('el martes')).toEqual({ date: '2026-11-03' }); // hoy es martes → el siguiente
    expect(w('este martes a las 3')).toEqual({ date: '2026-10-27', time: '15:00' });
    expect(w('dentro de tres días')).toEqual({ date: '2026-10-30' });
    expect(w('en 30 minutos')).toEqual({ date: '2026-10-27', time: '10:30' });
    expect(w('a fin de mes')).toEqual({ date: '2026-10-31' });
    expect(w('el primer día hábil del mes')).toEqual({ date: '2026-11-02' });
    expect(w('ayer')).toEqual({ date: '2026-10-26' });
  });
  it('absolutas y horas', () => {
    expect(w('el 15 de noviembre a las 9:30 pm')).toEqual({ date: '2026-11-15', time: '21:30' });
    expect(w('el 5')).toEqual({ date: '2026-11-05' }); // ya pasó este mes
    expect(w('15/1')).toEqual({ date: '2027-01-15' });
    expect(w('a las 8')).toEqual({ date: '2026-10-28', time: '08:00' }); // ya pasaron las 8 de hoy
    expect(w('a las 20 hrs')).toEqual({ date: '2026-10-27', time: '20:00' });
    expect(w('mañana al mediodía')).toEqual({ date: '2026-10-28', time: '12:00' });
  });
  it('recurrencias', () => {
    expect(w('cada viernes a las 7')).toEqual({ date: '2026-10-30', time: '07:00', recurrence: { freq: 'weekly', interval: 1 } });
    expect(w('todos los días a las 6 am').recurrence).toEqual({ freq: 'daily', interval: 1 });
    expect(w('mensualmente el 1').recurrence).toEqual({ freq: 'monthly', interval: 1 });
  });
  it('quita la fecha del título', () => {
    expect(extractWhen('mañana a las 8 de la mañana pagar el internet', now).rest).toBe('pagar el internet');
  });
});

describe('intenciones', () => {
  it('recordatorio', () => {
    expect(p('Recuérdame mañana a las 8 de la mañana pagar el internet')).toEqual({ type: 'reminder', title: 'Pagar el internet', date: '2026-10-28', time: '08:00', recurrence: undefined });
    expect(p('Recuérdame pagar el internet')).toMatchObject({ type: 'reminder', title: 'Pagar el internet', date: undefined, time: undefined });
    expect(p('Agenda una llamada con Carlos mañana a las 10')).toMatchObject({ type: 'reminder', title: 'Llamada con Carlos', date: '2026-10-28', time: '10:00' });
  });
  it('gasto', () => {
    expect(p('Gasté Q125 en gasolina y pagué en efectivo')).toEqual({ type: 'expense', amount: 12500, currency: 'GTQ', category: 'transporte', description: 'Gasolina', accountHint: 'efectivo', date: undefined });
    expect(p('Gasté Q90 en almuerzo')).toMatchObject({ amount: 9000, category: 'alimentacion' });
    expect(p('gasté $20 en Netflix ayer')).toMatchObject({ amount: 2000, currency: 'USD', category: 'suscripciones', date: '2026-10-26' });
  });
  it('ingreso', () => {
    expect(p('Hoy recibí Q4,500 de salario')).toMatchObject({ type: 'income', amount: 450000, category: 'salario', date: '2026-10-27' });
    expect(p('Me pagaron Q3,800 de salario')).toMatchObject({ type: 'income', amount: 380000, category: 'salario' });
  });
  it('deudas y cobros', () => {
    expect(p('Juan me debe Q800 y me pagará el próximo viernes')).toMatchObject({ type: 'debt', direction: 'receivable', counterparty: 'Juan', amount: 80000, dueDate: '2026-10-30' });
    expect(p('María me debe Q500 y me los dará el viernes')).toMatchObject({ direction: 'receivable', counterparty: 'María', amount: 50000, dueDate: '2026-10-30' });
    expect(p('le debo Q300 a Pedro')).toMatchObject({ type: 'debt', direction: 'payable', counterparty: 'Pedro', amount: 30000 });
    expect(p('El cliente aprobó la propuesta; tengo que cobrar Q2,500 cuando entregue el trabajo')).toMatchObject({ type: 'debt', direction: 'receivable', kind: 'expected', amount: 250000 });
  });
  it('tareas', () => {
    expect(p('Tengo que llamar a María mañana para confirmar la reunión')).toEqual({ type: 'task', title: 'Llamar a María para confirmar la reunión', date: '2026-10-28', time: undefined });
  });
  it('consultas', () => {
    expect(p('¿Cuánto he gastado este mes?')).toEqual({ type: 'query', topic: 'spending' });
    expect(p('¿Cuánto dinero tengo disponible entre mis cuentas?')).toEqual({ type: 'query', topic: 'balance' });
    expect(p('¿Qué pendientes tengo hoy?')).toEqual({ type: 'query', topic: 'today' });
    expect(p('Muéstrame los pagos que vencen esta semana')).toEqual({ type: 'query', topic: 'bills' });
    expect(p('Busca el contacto de la empresa que me pidió una cotización')).toMatchObject({ type: 'query', topic: 'contacts' });
    expect(p('xyz abc')).toEqual({ type: 'unknown' });
  });
});
