import { z } from 'zod';
import { zCurrency, zLocalDate, zLocalTime, zRecurrence } from '@lifeos/contracts';

// Lo que la IA (o el analizador de reglas) PROPONE. Nunca se ejecuta directo: pasa por validación,
// autorización y, si corresponde, confirmación del usuario (ver ai/assistant.ts).

const title = z.string().trim().min(1).max(200);
const amount = z.number().int().positive().max(100_000_000_000);

export const zIntent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reminder'), title, date: zLocalDate.optional(), time: zLocalTime.optional(), recurrence: zRecurrence.optional() }),
  z.object({ type: z.literal('task'), title, date: zLocalDate.optional(), time: zLocalTime.optional() }),
  z.object({
    type: z.enum(['expense', 'income']),
    amount: amount.optional(),
    currency: zCurrency.optional(),
    category: z.string().max(40).default('otros'),
    description: z.string().max(200).default(''),
    accountHint: z.string().max(60).optional(),
    date: zLocalDate.optional(),
  }),
  z.object({
    type: z.literal('debt'),
    direction: z.enum(['payable', 'receivable']),
    kind: z.enum(['debt', 'expected', 'bill']).default('debt'),
    counterparty: z.string().max(80).optional(),
    title: z.string().max(120).optional(),
    amount: amount.optional(),
    currency: zCurrency.optional(),
    dueDate: zLocalDate.optional(),
  }),
  z.object({
    type: z.literal('contact'),
    name: z.string().trim().min(1).max(80),
    phone: z.string().max(20).optional(),
    email: z.string().max(120).optional(),
    company: z.string().max(80).optional(),
  }),
  z.object({
    type: z.literal('query'),
    topic: z.enum(['today', 'pending', 'spending', 'balance', 'bills', 'budget', 'contacts']),
    term: z.string().max(80).optional(),
  }),
  z.object({ type: z.literal('help') }),
  z.object({ type: z.literal('unknown') }),
]);

export type Intent = z.infer<typeof zIntent>;

export interface InterpretContext {
  today: string; // AAAA-MM-DD local
  now: string; // ISO con zona
  timezone: string;
  currency: string;
  /** Para registrar el consumo de IA del espacio (tokens). */
  spaceId?: string;
}

/** Proveedor intercambiable. Lo que no implementa se reporta como "no configurado" al usuario. */
export interface AIProvider {
  readonly name: string;
  interpret(text: string, ctx: InterpretContext): Promise<Intent>;
  transcribe?(audio: Uint8Array, mime: string): Promise<string>;
  extractFromImage?(image: Uint8Array, mime: string, ctx: InterpretContext): Promise<Intent>;
}
