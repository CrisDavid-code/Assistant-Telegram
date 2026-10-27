import { describe, expect, it } from 'vitest';
import { formatMoney, parseAmount } from './money';
import { can } from './permissions';

describe('parseAmount', () => {
  it('convierte a centavos enteros', () => {
    expect(parseAmount('Q125')).toBe(12500);
    expect(parseAmount('4,500')).toBe(450000);
    expect(parseAmount('Q1,250.50')).toBe(125050);
    expect(parseAmount('0.1')).toBe(10);
    expect(parseAmount('3800 quetzales')).toBe(380000);
  });
  it('rechaza montos inválidos', () => {
    for (const bad of ['', 'abc', '0', '-5', '1.234', '12,34', '1,2345', '99999999999']) expect(parseAmount(bad)).toBeNull();
  });
  it('formatea con la moneda', () => {
    expect(formatMoney(125050, 'GTQ')).toMatch(/Q\s?1,250\.50/);
  });
});

describe('permisos', () => {
  it('miembro no maneja finanzas; viewer no escribe', () => {
    expect(can('member', 'finance.write')).toBe(false);
    expect(can('member', 'finance.read')).toBe(false);
    expect(can('viewer', 'core.write')).toBe(false);
    expect(can('supervisor', 'finance.read')).toBe(true);
    expect(can('owner', 'members.manage')).toBe(true);
    expect(can(null, 'core.read')).toBe(false);
  });
});
