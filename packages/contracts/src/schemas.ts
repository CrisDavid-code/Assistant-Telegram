// Contratos de la API (POST /api del Worker). PWA y Telegram llaman a los mismos servicios con estas entradas.
import { z } from 'zod';
import { CURRENCY_CODES, MAX_AMOUNT_MINOR } from './money';
import { ASSIGNABLE_ROLES } from './permissions';

export const zId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Identificador inválido');
/** Clave de idempotencia generada por el cliente; se usa como id del documento creado. */
export const zRequestId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, 'requestId inválido');
const txt = (max: number) => z.string().trim().min(1, 'Campo obligatorio').max(max, `Máximo ${max} caracteres`);
const optTxt = (max: number) => z.string().trim().max(max).optional();
export const zLocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (AAAA-MM-DD)');
export const zLocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (HH:MM)');
export const zLocalDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Fecha y hora inválidas');
export const zMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const zAmount = z.number().int('El monto debe estar en centavos').positive('El monto debe ser mayor que cero').max(MAX_AMOUNT_MINOR);
export const zCurrency = z.enum(CURRENCY_CODES);
export const zTimezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Zona horaria inválida');
const zCategory = z.string().trim().toLowerCase().regex(/^[a-z0-9áéíóúñ_ -]{1,40}$/, 'Categoría inválida');
const zTags = z.array(z.string().trim().min(1).max(30)).max(10).default([]);

export const zRecurrence = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(365).default(1),
  until: zLocalDate.optional(),
});
export type Recurrence = z.infer<typeof zRecurrence>;

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export const CONTACT_RELATIONS = ['personal', 'family', 'client', 'prospect', 'supplier', 'work', 'other'] as const;
export const ACTIVITY_TYPES = ['call', 'message', 'meeting', 'email', 'note'] as const;
export const ACCOUNT_TYPES = ['cash', 'bank', 'wallet', 'credit', 'other'] as const;
export const OBLIGATION_KINDS = ['bill', 'debt', 'expected', 'subscription'] as const;
export const PROJECT_STATUSES = ['active', 'paused', 'done', 'cancelled'] as const;
export const OPPORTUNITY_STAGES = ['lead', 'contacted', 'proposal', 'negotiation', 'won', 'lost'] as const;
export const DOCUMENT_TYPES = ['invoice', 'receipt', 'contract', 'id', 'license', 'warranty', 'vehicle', 'work', 'business', 'certificate', 'other'] as const;
/** Archivos en Firestore (plan gratuito): ≤ 700 KB → ≤ ~934 mil caracteres en base64 (documento ≤ 1 MiB). */
export const MAX_FILE_BYTES = 700 * 1024;
export const MAX_FILE_BASE64 = Math.ceil(MAX_FILE_BYTES / 3) * 4;

const spaceFields = { name: txt(60), timezone: zTimezone, currency: zCurrency };
const contactFields = {
  name: txt(80),
  phones: z.array(z.string().trim().regex(/^\+?[\d\s()-]{6,20}$/, 'Teléfono inválido')).max(5).default([]),
  emails: z.array(z.string().trim().toLowerCase().email('Correo inválido')).max(5).default([]),
  company: optTxt(80),
  jobTitle: optTxt(60),
  notes: optTxt(2000),
  tags: zTags,
  relation: z.enum(CONTACT_RELATIONS).default('other'),
};

/** Operaciones disponibles. La autorización de cada una vive en worker/src/api/registry.ts. */
export const OPS = {
  'user.bootstrap': z.object({ displayName: optTxt(60), timezone: zTimezone.optional(), currency: zCurrency.optional() }),
  'user.setDefaultSpace': z.object({ spaceId: zId }),

  'space.create': z.object({ requestId: zRequestId, ...spaceFields }),
  'space.update': z.object(spaceFields).partial(),
  'member.invite': z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(ASSIGNABLE_ROLES) }),
  'member.respond': z.object({ accept: z.boolean() }),
  'member.update': z.object({ uid: zId, role: z.enum(ASSIGNABLE_ROLES) }),
  'member.remove': z.object({ uid: zId }),

  'task.create': z.object({
    requestId: zRequestId,
    title: txt(200),
    notes: optTxt(4000),
    dueDate: zLocalDate.optional(),
    dueTime: zLocalTime.optional(),
    priority: z.enum(TASK_PRIORITIES).default('normal'),
    tags: zTags,
    assigneeId: zId.optional(),
    contactId: zId.optional(),
    projectId: zId.optional(),
    /** Al completarla se crea la siguiente ocurrencia (requiere fecha). */
    recurrence: zRecurrence.optional(),
  }),
  'task.update': z.object({
    taskId: zId,
    title: txt(200).optional(),
    notes: optTxt(4000),
    dueDate: zLocalDate.nullable().optional(),
    dueTime: zLocalTime.nullable().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    tags: zTags.optional(),
    assigneeId: zId.nullable().optional(),
    projectId: zId.nullable().optional(),
  }),
  'task.setStatus': z.object({ taskId: zId, status: z.enum(TASK_STATUSES) }),

  'reminder.create': z.object({
    requestId: zRequestId,
    title: txt(200),
    at: zLocalDateTime,
    recurrence: zRecurrence.optional(),
    taskId: zId.optional(),
    obligationId: zId.optional(),
  }),
  'reminder.reschedule': z.object({ reminderId: zId, at: zLocalDateTime }),
  'reminder.cancel': z.object({ reminderId: zId }),

  'contact.create': z.object({ requestId: zRequestId, ...contactFields }),
  'contact.update': z.object({ contactId: zId, ...contactFields }).partial({
    name: true, phones: true, emails: true, tags: true, relation: true,
  }),
  'contact.archive': z.object({ contactId: zId }),
  'activity.create': z.object({
    requestId: zRequestId,
    contactId: zId.optional(),
    type: z.enum(ACTIVITY_TYPES),
    summary: txt(2000),
    followUpAt: zLocalDateTime.optional(),
  }),

  'account.create': z.object({
    requestId: zRequestId,
    name: txt(60),
    type: z.enum(ACCOUNT_TYPES),
    currency: zCurrency,
    // Puede ser negativo (tarjeta de crédito con deuda). Es lo que el usuario declara, no un saldo bancario.
    openingBalance: z.number().int().min(-MAX_AMOUNT_MINOR).max(MAX_AMOUNT_MINOR).default(0),
  }),
  'account.update': z.object({ accountId: zId, name: txt(60).optional(), archived: z.boolean().optional() }),
  'tx.record': z.object({
    requestId: zRequestId,
    kind: z.enum(['income', 'expense']),
    amount: zAmount,
    currency: zCurrency,
    accountId: zId.optional(),
    category: zCategory,
    description: optTxt(200),
    date: zLocalDate,
  }),
  'tx.transfer': z.object({
    requestId: zRequestId,
    fromAccountId: zId,
    toAccountId: zId,
    amount: zAmount,
    /** Obligatorio si las cuentas tienen monedas distintas: importe recibido en la moneda destino. */
    toAmount: zAmount.optional(),
    date: zLocalDate,
    description: optTxt(200),
  }),
  'tx.void': z.object({ txId: zId, reason: txt(200) }),

  'obligation.create': z.object({
    requestId: zRequestId,
    direction: z.enum(['payable', 'receivable']),
    kind: z.enum(OBLIGATION_KINDS),
    title: txt(120),
    counterparty: optTxt(80),
    contactId: zId.optional(),
    amount: zAmount,
    currency: zCurrency,
    dueDate: zLocalDate.optional(),
    /** Crea un recordatorio N días antes del vencimiento (a las 8:00 locales). */
    remindDaysBefore: z.number().int().min(0).max(60).optional(),
  }),
  'obligation.pay': z.object({
    requestId: zRequestId,
    obligationId: zId,
    amount: zAmount,
    accountId: zId.optional(),
    date: zLocalDate,
  }),
  'obligation.cancel': z.object({ obligationId: zId }),
  'budget.set': z.object({ category: zCategory, limit: zAmount, currency: zCurrency }),
  'budget.remove': z.object({ category: zCategory }),
  'finance.summary': z.object({ month: zMonth.optional() }),
  'goal.create': z.object({ requestId: zRequestId, name: txt(80), target: zAmount, currency: zCurrency, targetDate: zLocalDate.optional() }),
  /** Aporte (positivo) o retiro (negativo) a una meta. No mueve saldos de cuentas: es un apartado. */
  'goal.contribute': z.object({ requestId: zRequestId, goalId: zId, amount: z.number().int().refine((n) => n !== 0, 'El monto no puede ser cero').refine((n) => Math.abs(n) <= MAX_AMOUNT_MINOR), note: optTxt(120) }),
  'goal.archive': z.object({ goalId: zId }),

  'project.create': z.object({
    requestId: zRequestId, name: txt(120), description: optTxt(4000), dueDate: zLocalDate.optional(),
    budget: zAmount.optional(), currency: zCurrency.optional(), contactId: zId.optional(),
  }),
  'project.update': z.object({
    projectId: zId, name: txt(120).optional(), description: optTxt(4000), dueDate: zLocalDate.nullable().optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
  }),
  'opportunity.create': z.object({
    requestId: zRequestId, title: txt(120), contactId: zId.optional(), amount: zAmount.optional(), currency: zCurrency.optional(),
    expectedClose: zLocalDate.optional(), nextAction: optTxt(200), notes: optTxt(2000),
  }),
  'opportunity.update': z.object({
    opportunityId: zId, title: txt(120).optional(), amount: zAmount.nullable().optional(), expectedClose: zLocalDate.nullable().optional(),
    nextAction: optTxt(200), notes: optTxt(2000),
  }),
  /** Ganada con `createReceivable` registra un cobro esperado (no dinero recibido). */
  'opportunity.setStage': z.object({ opportunityId: zId, stage: z.enum(OPPORTUNITY_STAGES), createReceivable: z.boolean().optional() }),

  'document.create': z.object({
    requestId: zRequestId, title: txt(120), type: z.enum(DOCUMENT_TYPES), issuer: optTxt(80),
    issuedAt: zLocalDate.optional(), expiresAt: zLocalDate.optional(), tags: zTags, contactId: zId.optional(),
    remindDaysBefore: z.number().int().min(0).max(120).optional(),
    file: z.object({ name: txt(120), base64: z.string().max(MAX_FILE_BASE64, 'El archivo supera el tamaño máximo (700 KB)') }).optional(),
  }),
  'document.update': z.object({
    documentId: zId, title: txt(120).optional(), issuer: optTxt(80), expiresAt: zLocalDate.nullable().optional(), tags: zTags.optional(),
  }),
  'document.download': z.object({ documentId: zId }),
  'document.delete': z.object({ documentId: zId }),

  'account.export': z.object({}),
  'account.delete': z.object({ confirm: z.literal('ELIMINAR', { message: 'Escribe ELIMINAR para confirmar' }) }),
  'usage.get': z.object({}),
  'admin.stats': z.object({}),
  'admin.setPlan': z.object({ spaceId: zId, plan: z.enum(['free', 'premium', 'business']) }),

  'telegram.createLinkCode': z.object({}),
  'telegram.unlink': z.object({}),
  'assistant.message': z.object({ text: txt(1000) }),
  'assistant.confirm': z.object({ actionId: zId, accept: z.boolean(), choice: z.number().int().min(0).max(10).optional() }),
} as const;

export type OpName = keyof typeof OPS;
export type OpInput<K extends OpName> = z.input<(typeof OPS)[K]>;
export type OpData<K extends OpName> = z.output<(typeof OPS)[K]>;

/** Operaciones que no se ejecutan dentro de un espacio. */
export const SPACELESS_OPS = new Set<OpName>(['user.bootstrap', 'user.setDefaultSpace', 'space.create', 'telegram.createLinkCode', 'telegram.unlink', 'account.export', 'account.delete', 'admin.stats', 'admin.setPlan']);
