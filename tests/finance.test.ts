import { beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { loadCtx } from '../functions/src/auth/context';
import { recomputeBalance } from '../functions/src/finance/service';
import { clearAll, db, expectDenied, makeUser, rid, type TestUser } from './helpers';

beforeEach(clearAll);
const today = () => DateTime.now().setZone('America/Guatemala').toISODate()!;

async function setup() {
  const a = await makeUser('ana');
  const s = a.personalSpaceId;
  const cash = (await a.op('account.create', s, { requestId: rid(), name: 'Efectivo', type: 'cash', currency: 'GTQ', openingBalance: 50000 })).accountId;
  const bank = (await a.op('account.create', s, { requestId: rid(), name: 'Banco', type: 'bank', currency: 'GTQ', openingBalance: 100000 })).accountId;
  const usd = (await a.op('account.create', s, { requestId: rid(), name: 'Dólares', type: 'bank', currency: 'USD', openingBalance: 0 })).accountId;
  return { a, s, cash, bank, usd };
}
const balance = async (s: string, id: string) => (await db.doc(`spaces/${s}/accounts/${id}`).get()).get('balance') as number;
const reconciled = async (a: TestUser, s: string, id: string) => (await recomputeBalance(await loadCtx(a.uid, s, 'pwa'), id)).matches;

describe('finanzas', () => {
  it('ingreso y gasto ajustan el saldo calculado', async () => {
    const { a, s, cash } = await setup();
    await a.op('tx.record', s, { requestId: rid(), kind: 'income', amount: 450000, currency: 'GTQ', category: 'salario', date: today(), accountId: cash });
    await a.op('tx.record', s, { requestId: rid(), kind: 'expense', amount: 12500, currency: 'GTQ', category: 'transporte', date: today(), accountId: cash });
    expect(await balance(s, cash)).toBe(50000 + 450000 - 12500);
    expect(await reconciled(a, s, cash)).toBe(true);
  });

  it('transferencia mueve saldos sin contar como ingreso ni gasto', async () => {
    const { a, s, cash, bank } = await setup();
    await a.op('tx.transfer', s, { requestId: rid(), fromAccountId: bank, toAccountId: cash, amount: 30000, date: today() });
    expect([await balance(s, bank), await balance(s, cash)]).toEqual([70000, 80000]);
    const sum = await a.op('finance.summary', s, {});
    expect(sum.totals).toEqual({});
    expect(await reconciled(a, s, cash)).toBe(true);
    expect(await reconciled(a, s, bank)).toBe(true);
  });

  it('transferencia entre monedas exige el monto recibido explícito', async () => {
    const { a, s, bank, usd } = await setup();
    await expectDenied(a.op('tx.transfer', s, { requestId: rid(), fromAccountId: bank, toAccountId: usd, amount: 7800, date: today() }), 'invalid-argument');
    await a.op('tx.transfer', s, { requestId: rid(), fromAccountId: bank, toAccountId: usd, amount: 7800, toAmount: 1000, date: today() });
    expect([await balance(s, bank), await balance(s, usd)]).toEqual([92200, 1000]);
  });

  it('no mezcla monedas: cuenta en GTQ no acepta gasto en USD y el resumen separa por moneda', async () => {
    const { a, s, cash, usd } = await setup();
    await expectDenied(a.op('tx.record', s, { requestId: rid(), kind: 'expense', amount: 100, currency: 'USD', category: 'otros', date: today(), accountId: cash }), 'invalid-argument');
    await a.op('tx.record', s, { requestId: rid(), kind: 'expense', amount: 9000, currency: 'GTQ', category: 'alimentacion', date: today() });
    await a.op('tx.record', s, { requestId: rid(), kind: 'income', amount: 500, currency: 'USD', category: 'ventas', date: today(), accountId: usd });
    const sum = await a.op('finance.summary', s, {});
    expect(sum.totals).toEqual({ GTQ: { income: 0, expense: 9000 }, USD: { income: 500, expense: 0 } });
  });

  it('pagos parciales, liquidación y rechazo de sobrepago, sin duplicar gastos', async () => {
    const { a, s, bank } = await setup();
    const { obligationId } = await a.op('obligation.create', s, { requestId: rid(), direction: 'payable', kind: 'bill', title: 'Internet', amount: 30000, currency: 'GTQ' });
    const p1 = await a.op('obligation.pay', s, { requestId: rid(), obligationId, amount: 10000, date: today(), accountId: bank });
    expect(p1.status).toBe('partial');
    await expectDenied(a.op('obligation.pay', s, { requestId: rid(), obligationId, amount: 25000, date: today() }), 'invalid-argument');
    const p2 = await a.op('obligation.pay', s, { requestId: rid(), obligationId, amount: 20000, date: today(), accountId: bank });
    expect(p2.status).toBe('settled');
    await expectDenied(a.op('obligation.pay', s, { requestId: rid(), obligationId, amount: 1, date: today() }), 'failed-precondition');
    const sum = await a.op('finance.summary', s, {});
    expect(sum.totals.GTQ.expense).toBe(30000); // exactamente lo pagado, una vez
    expect(await balance(s, bank)).toBe(70000);
  });

  it('anular revierte saldo y lo pagado de la obligación; no se anula dos veces', async () => {
    const { a, s, bank } = await setup();
    const { obligationId } = await a.op('obligation.create', s, { requestId: rid(), direction: 'receivable', kind: 'debt', title: 'Juan me debe', amount: 80000, currency: 'GTQ' });
    const { txId } = await a.op('obligation.pay', s, { requestId: rid(), obligationId, amount: 80000, date: today(), accountId: bank });
    expect(await balance(s, bank)).toBe(180000);
    await a.op('tx.void', s, { txId, reason: 'Registrado por error' });
    expect(await balance(s, bank)).toBe(100000);
    const o = (await db.doc(`spaces/${s}/obligations/${obligationId}`).get()).data()!;
    expect([o.paid, o.status]).toEqual([0, 'open']);
    await expectDenied(a.op('tx.void', s, { txId, reason: 'otra vez' }), 'failed-precondition');
    expect(await reconciled(a, s, bank)).toBe(true);
    const audit = await db.collection(`spaces/${s}/audit`).where('op', '==', 'tx.void').get();
    expect(audit.size).toBe(1);
  });

  it('operación repetida (mismo requestId) no duplica el movimiento ni el saldo', async () => {
    const { a, s, cash } = await setup();
    const req = { requestId: rid(), kind: 'expense', amount: 5000, currency: 'GTQ', category: 'otros', date: today(), accountId: cash };
    await Promise.all([a.op('tx.record', s, req), a.op('tx.record', s, req)]);
    expect(await balance(s, cash)).toBe(45000);
    expect((await db.collection(`spaces/${s}/transactions`).get()).size).toBe(1);
  });

  it('presupuestos muestran lo gastado de la categoría', async () => {
    const { a, s } = await setup();
    await a.op('budget.set', s, { category: 'transporte', limit: 50000, currency: 'GTQ' });
    await a.op('tx.record', s, { requestId: rid(), kind: 'expense', amount: 42000, currency: 'GTQ', category: 'transporte', date: today() });
    const sum = await a.op('finance.summary', s, {});
    expect(sum.budgets).toEqual([{ category: 'transporte', currency: 'GTQ', limit: 50000, spent: 42000 }]);
  });

  it('rechaza fechas futuras lejanas y cuentas inexistentes', async () => {
    const { a, s } = await setup();
    await expectDenied(a.op('tx.record', s, { requestId: rid(), kind: 'expense', amount: 1, currency: 'GTQ', category: 'otros', date: '2099-01-01' }), 'invalid-argument');
    await expectDenied(a.op('tx.record', s, { requestId: rid(), kind: 'expense', amount: 1, currency: 'GTQ', category: 'otros', date: today(), accountId: 'nada' }), 'not-found');
  });
});
