import { beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { deliverReminder, MAX_ATTEMPTS, sweepReminders } from '../worker/src/reminders/service';
import { Timestamp } from '../worker/src/shared/firebase';
import { clearAll, db, expectDenied, makeUser, rid, sent, tg } from './helpers';

const TZ = 'America/Guatemala';
const local = (minutesFromNow: number) => DateTime.now().setZone(TZ).plus({ minutes: minutesFromNow }).toFormat("yyyy-MM-dd'T'HH:mm");
const after = (minutes: number) => new Date(Date.now() + minutes * 60_000);

beforeEach(async () => {
  await clearAll();
  sent.length = 0;
  tg.fail = false;
});

async function linkedUser(chatId = 1001) {
  const a = await makeUser('ana');
  await db.doc(`users/${a.uid}`).update({ telegram: { chatId, username: 'ana', linkedAt: Timestamp.now() } });
  return a;
}
const rem = (s: string, id: string) => db.doc(`spaces/${s}/reminders/${id}`);

describe('recordatorios duraderos', () => {
  it('se entrega por Telegram al vencer y no antes', async () => {
    const a = await linkedUser();
    const { reminderId } = await a.op('reminder.create', a.personalSpaceId, { requestId: rid(), title: 'Pagar internet', at: local(5) });
    expect(await sweepReminders(new Date())).toEqual({});
    expect(await sweepReminders(after(6))).toEqual({ delivered: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('Pagar internet');
    expect((await rem(a.personalSpaceId, reminderId).get()).get('status')).toBe('delivered');
  });

  it('procesar dos veces el mismo recordatorio no lo envía dos veces', async () => {
    const a = await linkedUser();
    const { reminderId } = await a.op('reminder.create', a.personalSpaceId, { requestId: rid(), title: 'Una vez', at: local(1) });
    const ref = rem(a.personalSpaceId, reminderId);
    const results = await Promise.all([deliverReminder(ref, after(2)), deliverReminder(ref, after(2))]);
    expect(results.sort()).toEqual(['delivered', 'skipped']);
    expect(sent).toHaveLength(1);
  });

  it('reprogramar invalida la programación anterior; cancelar impide el envío', async () => {
    const a = await linkedUser();
    const s = a.personalSpaceId;
    const { reminderId } = await a.op('reminder.create', s, { requestId: rid(), title: 'Mover', at: local(2) });
    await a.op('reminder.reschedule', s, { reminderId, at: local(60) });
    expect(await sweepReminders(after(5))).toEqual({}); // la hora vieja ya no dispara
    const { reminderId: other } = await a.op('reminder.create', s, { requestId: rid(), title: 'Cancelar', at: local(2) });
    await a.op('reminder.cancel', s, { reminderId: other });
    expect(await sweepReminders(after(5))).toEqual({});
    expect(await sweepReminders(after(61))).toEqual({ delivered: 1 });
    expect(sent.map((m) => m.text).join()).not.toContain('Cancelar');
  });

  it('un envío en curso que fue reprogramado no sobrescribe la nueva programación', async () => {
    const a = await linkedUser();
    const s = a.personalSpaceId;
    const { reminderId } = await a.op('reminder.create', s, { requestId: rid(), title: 'Carrera', at: local(1) });
    const ref = rem(s, reminderId);
    // Simula: el proceso tomó el recordatorio (sending, versión 1) y, mientras enviaba, el usuario lo movió.
    await ref.update({ status: 'sending', lockedUntil: Timestamp.fromDate(after(5)), dueAt: Timestamp.fromDate(after(-1)) });
    await a.op('reminder.reschedule', s, { reminderId, at: local(120) });
    const r = (await ref.get()).data()!;
    expect([r.status, r.version]).toEqual(['scheduled', 2]);
    expect(await sweepReminders(after(10))).toEqual({});
  });

  it('si Telegram falla, reintenta con espera creciente y termina en "failed" sin decir que se entregó', async () => {
    const a = await linkedUser();
    const { reminderId } = await a.op('reminder.create', a.personalSpaceId, { requestId: rid(), title: 'Caído', at: local(1) });
    const ref = rem(a.personalSpaceId, reminderId);
    tg.fail = true;
    let t = after(2).getTime();
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const res = await deliverReminder(ref, new Date(t));
      expect(res).toBe(i < MAX_ATTEMPTS ? 'retry' : 'failed');
      t = (await ref.get()).get('dueAt').toMillis() + 1000;
    }
    const r = (await ref.get()).data()!;
    expect([r.status, r.attempts, r.deliveredAt]).toEqual(['failed', MAX_ATTEMPTS, null]);
    expect(r.lastError).toContain('502');
  });

  it('recupera un envío interrumpido (proceso caído con el recordatorio tomado)', async () => {
    const a = await linkedUser();
    const { reminderId } = await a.op('reminder.create', a.personalSpaceId, { requestId: rid(), title: 'Recuperar', at: local(1) });
    const ref = rem(a.personalSpaceId, reminderId);
    await ref.update({ status: 'sending', lockedUntil: Timestamp.fromDate(after(3)), attempts: 1 });
    expect(await sweepReminders(after(2))).toEqual({}); // aún dentro del plazo de bloqueo
    expect(await sweepReminders(after(4))).toEqual({ delivered: 1 });
  });

  it('sin Telegram vinculado queda "undeliverable", no "delivered"', async () => {
    const a = await makeUser('sin_tg');
    const { reminderId } = await a.op('reminder.create', a.personalSpaceId, { requestId: rid(), title: 'Nadie', at: local(1) });
    expect(await sweepReminders(after(2))).toEqual({ undeliverable: 1 });
    expect((await rem(a.personalSpaceId, reminderId).get()).get('status')).toBe('undeliverable');
  });

  it('un recordatorio recurrente se reprograma a la siguiente ocurrencia', async () => {
    const a = await linkedUser();
    const at = local(1);
    const { reminderId } = await a.op('reminder.create', a.personalSpaceId, { requestId: rid(), title: 'Diario', at, recurrence: { freq: 'daily' } });
    expect(await sweepReminders(after(2))).toEqual({ delivered: 1 });
    const r = (await rem(a.personalSpaceId, reminderId).get()).data()!;
    expect(r.status).toBe('scheduled');
    expect(DateTime.fromJSDate(r.scheduledFor.toDate(), { zone: TZ }).toFormat("yyyy-MM-dd'T'HH:mm")).toBe(DateTime.fromISO(at, { zone: TZ }).plus({ days: 1 }).toFormat("yyyy-MM-dd'T'HH:mm"));
  });

  it('rechaza fechas pasadas', async () => {
    const a = await makeUser('ana');
    await expectDenied(a.op('reminder.create', a.personalSpaceId, { requestId: rid(), title: 'x', at: local(-30) }), 'invalid-argument');
  });

  it('la obligación crea su recordatorio y al liquidarse lo cancela', async () => {
    const a = await linkedUser();
    const s = a.personalSpaceId;
    const due = DateTime.now().setZone(TZ).plus({ days: 10 }).toISODate()!;
    const o = await a.op('obligation.create', s, { requestId: rid(), direction: 'payable', kind: 'bill', title: 'Licencia', amount: 10000, currency: 'GTQ', dueDate: due, remindDaysBefore: 3 });
    expect(o.reminderId).toBeTruthy();
    await a.op('obligation.pay', s, { requestId: rid(), obligationId: o.obligationId, amount: 10000, date: DateTime.now().setZone(TZ).toISODate() });
    expect((await rem(s, o.reminderId).get()).get('status')).toBe('cancelled');
  });
});
