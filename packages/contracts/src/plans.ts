// Planes comerciales: determinan disponibilidad y cuotas, NO permisos de datos (eso es permissions.ts).
// No hay cobro integrado: el plan se asigna manualmente hasta elegir proveedor de pagos.

export const PLANS = {
  free: { label: 'Gratis', assistantPerMonth: 150, businessSpaces: 3 },
  premium: { label: 'Personal Premium', assistantPerMonth: 2000, businessSpaces: 5 },
  business: { label: 'Empresa', assistantPerMonth: 10000, businessSpaces: 20 },
} as const;

export type PlanId = keyof typeof PLANS;

/** Operaciones con costo variable (IA) que cuentan contra la cuota mensual del espacio. */
export const METERED_OPS: Record<string, 'assistantPerMonth'> = {
  'assistant.message': 'assistantPerMonth',
};
