import { OPS, SPACELESS_OPS, type OpData, type OpName, type Source } from '@lifeos/contracts';
import { fail } from '../shared/errors';
import { loadCtx, type Ctx } from '../auth/context';
import * as spaces from '../spaces/service';
import * as tasks from '../tasks/service';
import * as reminders from '../reminders/service';
import * as contacts from '../contacts/service';
import * as finance from '../finance/service';
import * as link from '../telegram/link';
import { checkQuota } from '../subscriptions/quota';

export interface Caller {
  uid: string;
  email: string | null;
  name: string | null;
  source: Source;
  /** Conversación del asistente: `tg_<chatId>` o `pwa_<uid>`. */
  convKey?: string;
}

type SpaceHandlers = { [K in OpName]?: (ctx: Ctx, data: OpData<K>, caller: Caller) => Promise<unknown> };

// Cada servicio exige su permiso (requirePerm) además de la membresía que valida loadCtx.
const inSpace: SpaceHandlers = {
  'space.update': spaces.updateSpace,
  'member.invite': spaces.inviteMember,
  'member.update': spaces.updateMember,
  'member.remove': spaces.removeMember,
  'task.create': tasks.createTask,
  'task.update': tasks.updateTask,
  'task.setStatus': tasks.setTaskStatus,
  'reminder.create': reminders.createReminder,
  'reminder.reschedule': reminders.rescheduleReminder,
  'reminder.cancel': reminders.cancelReminder,
  'contact.create': contacts.createContact,
  'contact.update': contacts.updateContact,
  'contact.archive': contacts.archiveContact,
  'activity.create': contacts.recordActivity,
  'account.create': finance.createAccount,
  'account.update': finance.updateAccount,
  'tx.record': finance.recordTransaction,
  'tx.transfer': finance.recordTransfer,
  'tx.void': finance.voidTransaction,
  'obligation.create': finance.createObligation,
  'obligation.pay': finance.payObligation,
  'obligation.cancel': finance.cancelObligation,
  'budget.set': finance.setBudget,
  'budget.remove': finance.removeBudget,
  'finance.summary': finance.getFinancialSummary,
};

/** Registrado por el módulo del asistente (evita dependencia circular). */
export const assistantHandlers: SpaceHandlers = {};

/**
 * Punto único de ejecución. Valida la entrada con el contrato, resuelve identidad y espacio desde
 * Firestore (el spaceId del cliente solo SELECCIONA, nunca autoriza) y delega al servicio de dominio.
 */
export async function runOp(caller: Caller, op: string, spaceId: unknown, raw: unknown): Promise<unknown> {
  if (!(op in OPS)) fail('invalid-argument', 'Operación desconocida.');
  const name = op as OpName;
  const parsed = OPS[name].safeParse(raw ?? {});
  if (!parsed.success) fail('invalid-argument', parsed.error!.issues.map((i) => i.message).join('; '));
  const data = parsed.data as never;

  if (SPACELESS_OPS.has(name)) {
    switch (name) {
      case 'user.bootstrap': return spaces.bootstrapUser(caller.uid, caller, data, caller.source);
      case 'user.setDefaultSpace': return spaces.setDefaultSpace(caller.uid, data);
      case 'space.create': return spaces.createBusinessSpace(caller.uid, data, caller.source);
      case 'telegram.createLinkCode': return link.createLinkCode(caller.uid);
      case 'telegram.unlink': return link.unlinkTelegram(caller.uid, caller.source);
    }
  }
  if (typeof spaceId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(spaceId)) fail('invalid-argument', 'Falta el espacio.');
  if (name === 'member.respond') return spaces.respondInvite(caller.uid, spaceId as string, data, caller.source);

  const ctx = await loadCtx(caller.uid, spaceId as string, caller.source);
  const handler = (inSpace[name] ?? assistantHandlers[name]) as ((c: Ctx, d: never, k: Caller) => Promise<unknown>) | undefined;
  if (!handler) fail('invalid-argument', 'Operación no disponible.');
  await checkQuota(ctx, name);
  return handler!(ctx, data, caller);
}
