// Forma de los documentos en Firestore (ver docs/data-model.md). Los escribe solo el backend.
import type { Currency } from './money';
import type { Role } from './permissions';
import type { Recurrence } from './schemas';

/** Timestamp de Firestore (cliente o admin): ambos exponen toDate(). */
export interface Ts {
  toDate(): Date;
  toMillis(): number;
}

export type SpaceType = 'personal' | 'business';
export type Source = 'pwa' | 'telegram' | 'system';

export interface UserDoc {
  displayName: string;
  email: string | null;
  personalSpaceId: string;
  defaultSpaceId: string;
  telegram: { chatId: number; username: string | null; linkedAt: Ts } | null;
  createdAt: Ts;
}

export interface SpaceDoc {
  name: string;
  type: SpaceType;
  ownerId: string;
  timezone: string;
  currency: Currency;
  status: 'active' | 'archived';
  plan: 'free' | 'premium' | 'business';
  createdAt: Ts;
  updatedAt: Ts;
}

/** spaces/{spaceId}/members/{uid} */
export interface MemberDoc {
  uid: string;
  spaceId: string;
  spaceName: string;
  spaceType: SpaceType;
  role: Role;
  status: 'active' | 'invited' | 'removed';
  displayName: string;
  email: string | null;
  invitedBy: string | null;
  createdAt: Ts;
  updatedAt: Ts;
}

export interface TaskDoc {
  title: string;
  notes: string | null;
  status: 'open' | 'done' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  dueDate: string | null; // AAAA-MM-DD en la zona del espacio
  dueTime: string | null; // HH:MM
  dueAt: Ts | null; // instante absoluto para ordenar/consultar
  tags: string[];
  assigneeId: string | null;
  contactId: string | null;
  projectId: string | null;
  recurrence: Recurrence | null;
  createdBy: string;
  source: Source;
  completedAt: Ts | null;
  createdAt: Ts;
  updatedAt: Ts;
}

export type ReminderStatus = 'scheduled' | 'sending' | 'delivered' | 'undeliverable' | 'failed' | 'cancelled';

export interface ReminderDoc {
  spaceId: string;
  title: string;
  userId: string; // destinatario
  dueAt: Ts; // próximo intento (incluye reintentos)
  scheduledFor: Ts; // hora pedida por el usuario
  timezone: string;
  recurrence: Recurrence | null;
  anchorDay: number; // día del mes original (31 → último día en meses cortos)
  status: ReminderStatus;
  version: number; // sube en cada reprogramación: invalida envíos en curso
  attempts: number;
  lockedUntil: Ts | null;
  lastError: string | null;
  deliveredAt: Ts | null;
  taskId: string | null;
  obligationId: string | null;
  createdBy: string;
  source: Source;
  createdAt: Ts;
  updatedAt: Ts;
}

export interface ContactDoc {
  name: string;
  nameLower: string;
  phones: string[];
  emails: string[];
  company: string | null;
  jobTitle: string | null;
  notes: string | null;
  tags: string[];
  relation: string;
  archived: boolean;
  lastContactAt: Ts | null;
  createdBy: string;
  source: Source;
  createdAt: Ts;
  updatedAt: Ts;
}

export interface ActivityDoc {
  type: 'call' | 'message' | 'meeting' | 'email' | 'note';
  summary: string;
  contactId: string | null;
  followUpReminderId: string | null;
  createdBy: string;
  source: Source;
  createdAt: Ts;
}

export interface AccountDoc {
  name: string;
  type: 'cash' | 'bank' | 'wallet' | 'credit' | 'other';
  currency: Currency;
  openingBalance: number;
  /** Saldo calculado con los movimientos registrados en la app (no es un saldo bancario). */
  balance: number;
  archived: boolean;
  createdBy: string;
  createdAt: Ts;
  updatedAt: Ts;
}

export interface TransactionDoc {
  kind: 'income' | 'expense' | 'transfer';
  status: 'posted' | 'voided';
  amount: number;
  currency: Currency;
  accountId: string | null;
  toAccountId: string | null;
  toAmount: number | null;
  toCurrency: Currency | null;
  category: string;
  description: string | null;
  date: string; // AAAA-MM-DD local
  occurredAt: Ts; // mediodía local de `date`, para rangos
  obligationId: string | null;
  voidReason: string | null;
  voidedAt: Ts | null;
  createdBy: string;
  source: Source;
  createdAt: Ts;
}

export interface ObligationDoc {
  direction: 'payable' | 'receivable';
  kind: 'bill' | 'debt' | 'expected' | 'subscription';
  title: string;
  counterparty: string | null;
  contactId: string | null;
  amount: number;
  paid: number;
  currency: Currency;
  dueDate: string | null;
  dueAt: Ts | null;
  status: 'open' | 'partial' | 'settled' | 'cancelled';
  reminderId: string | null;
  createdBy: string;
  source: Source;
  createdAt: Ts;
  updatedAt: Ts;
}

export interface BudgetDoc {
  category: string;
  limit: number;
  currency: Currency;
  updatedAt: Ts;
}

export interface FinanceSummary {
  month: string;
  /** Totales por moneda: nunca se suman monedas distintas. */
  totals: Record<string, { income: number; expense: number }>;
  byCategory: Record<string, Record<string, number>>; // moneda → categoría → gasto
  budgets: { category: string; currency: Currency; limit: number; spent: number }[];
  truncated: boolean;
}

export interface GoalDoc {
  name: string;
  target: number;
  saved: number;
  currency: Currency;
  targetDate: string | null;
  status: 'active' | 'reached' | 'archived';
  createdBy: string;
  createdAt: Ts;
  updatedAt: Ts;
}

export interface ProjectDoc {
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'done' | 'cancelled';
  dueDate: string | null;
  budget: number | null;
  currency: Currency | null;
  contactId: string | null;
  createdBy: string;
  createdAt: Ts;
  updatedAt: Ts;
}

export type OpportunityStage = 'lead' | 'contacted' | 'proposal' | 'negotiation' | 'won' | 'lost';

export interface OpportunityDoc {
  title: string;
  contactId: string | null;
  stage: OpportunityStage;
  amount: number | null;
  currency: Currency | null;
  expectedClose: string | null;
  nextAction: string | null;
  notes: string | null;
  obligationId: string | null; // cobro esperado creado al ganarla
  closedAt: Ts | null;
  createdBy: string;
  createdAt: Ts;
  updatedAt: Ts;
}

export interface DocumentDoc {
  title: string;
  type: string;
  issuer: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  tags: string[];
  contactId: string | null;
  file: { name: string; mime: string; size: number } | null; // contenido en documentFiles/{id}
  reminderId: string | null;
  createdBy: string;
  source: Source;
  createdAt: Ts;
  updatedAt: Ts;
}
