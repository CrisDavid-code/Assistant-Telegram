import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, limit, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { AlertTriangle, Bell, Bot, CheckCircle2, Plus } from 'lucide-react';
import { categoryLabel, type FinanceSummary, type ObligationDoc, type ReminderDoc, type TaskDoc } from '@lifeos/contracts';
import { db } from '../services/firebase';
import { call } from '../services/api';
import { useSpace } from '../hooks/session';
import { useQueryLive } from '../hooks/useLive';
import { Badge, Card, Empty, ErrorBox, Loading } from '../components/ui';
import { dateTimeLabel, dayLabel, money, todayIn } from '../lib/format';
import { TaskRow } from './Agenda';

export default function Dashboard() {
  const { spaceId, space, profile, can } = useSpace();
  const tz = space.timezone;
  const today = todayIn(tz);
  const endOfDay = Timestamp.fromDate(new Date(Date.now() + 36 * 3_600_000)); // margen; se filtra por fecha local abajo
  const in7 = Timestamp.fromDate(new Date(Date.now() + 7 * 86_400_000));
  const col = (c: string) => collection(db, 'spaces', spaceId, c);

  const tasks = useQueryLive<TaskDoc>(() => query(col('tasks'), where('status', '==', 'open'), where('dueAt', '<=', endOfDay), orderBy('dueAt'), limit(30)), `t:${spaceId}`);
  const reminders = useQueryLive<ReminderDoc>(() => query(col('reminders'), where('status', '==', 'scheduled'), where('scheduledFor', '<=', in7), orderBy('scheduledFor'), limit(10)), `r:${spaceId}`);
  const problems = useQueryLive<ReminderDoc>(() => query(col('reminders'), where('status', 'in', ['failed', 'undeliverable']), limit(5)), `p:${spaceId}`);
  const bills = useQueryLive<ObligationDoc>(() => (can('finance.read') ? query(col('obligations'), where('status', 'in', ['open', 'partial']), where('dueAt', '<=', in7), orderBy('dueAt'), limit(10)) : null), `b:${spaceId}:${can('finance.read')}`);

  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [sumErr, setSumErr] = useState<unknown>(null);
  useEffect(() => {
    setSummary(null);
    if (can('finance.read')) call('finance.summary', spaceId, {}).then(setSummary, setSumErr);
  }, [spaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dueToday = tasks.data.filter((t) => t.dueDate && t.dueDate <= today);
  const hour = Number(new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date()));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-ink-soft">{new Intl.DateTimeFormat('es-GT', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date())}</p>
        <h1 className="text-2xl font-bold">{hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches'}, {profile?.displayName.split(' ')[0]}</h1>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <Link to="/agenda?nuevo=tarea" className="flex shrink-0 items-center gap-1 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white"><Plus className="size-4" />Tarea</Link>
        <Link to="/agenda?nuevo=recordatorio" className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold"><Bell className="size-4" />Recordatorio</Link>
        {can('finance.write') && <Link to="/finanzas?nuevo=movimiento" className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold"><Plus className="size-4" />Gasto o ingreso</Link>}
        <Link to="/asistente" className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold"><Bot className="size-4" />Asistente</Link>
      </div>

      {problems.data.length > 0 && (
        <p role="alert" className="flex gap-2 rounded-xl bg-warn-50 p-3 text-sm text-warn-700">
          <AlertTriangle className="size-5 shrink-0" />
          {problems.data.length} recordatorio(s) no se pudieron enviar{problems.data.some((p) => p.status === 'undeliverable') ? ' porque no tienes Telegram vinculado' : ''}. Revísalos en <Link className="underline" to="/agenda?vista=recordatorios">Agenda</Link>{!profile?.telegram && <> o vincula Telegram en <Link className="underline" to="/configuracion">Configuración</Link></>}.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Para hoy" action={<Link to="/agenda" className="text-sm text-brand-700">Ver agenda</Link>}>
          {tasks.loading ? <Loading /> : tasks.error ? <ErrorBox error={tasks.error} /> : dueToday.length === 0
            ? <Empty icon={<CheckCircle2 className="size-8 text-ok-700" />} text="No tienes tareas para hoy." />
            : <ul className="divide-y divide-line">{dueToday.map((t) => <TaskRow key={t.id} task={t} tz={tz} />)}</ul>}
        </Card>

        <Card title="Próximos recordatorios">
          {reminders.loading ? <Loading /> : reminders.error ? <ErrorBox error={reminders.error} /> : reminders.data.length === 0
            ? <Empty text="Sin recordatorios en los próximos 7 días." />
            : <ul className="space-y-2">{reminders.data.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-sm"><Bell className="size-4 text-brand-600" /><span className="flex-1">{r.title}</span><span className="text-ink-soft">{dateTimeLabel(r.scheduledFor.toDate(), tz)}</span></li>
              ))}</ul>}
        </Card>

        {can('finance.read') && (
          <>
            <Card title="Pagos y cobros (7 días)" action={<Link to="/finanzas?tab=pagos" className="text-sm text-brand-700">Ver todos</Link>}>
              {bills.loading ? <Loading /> : bills.error ? <ErrorBox error={bills.error} /> : bills.data.length === 0
                ? <Empty text="Nada vence esta semana." />
                : <ul className="space-y-2">{bills.data.map((b) => (
                    <li key={b.id} className="flex items-center gap-2 text-sm">
                      <Badge tone={b.direction === 'payable' ? 'warn' : 'ok'}>{b.direction === 'payable' ? 'Pagar' : 'Cobrar'}</Badge>
                      <span className="flex-1">{b.title}</span>
                      <span className="font-semibold">{money(b.amount - b.paid, b.currency)}</span>
                      <span className={`text-xs ${b.dueDate && b.dueDate < today ? 'text-danger-700' : 'text-ink-soft'}`}>{b.dueDate ? dayLabel(b.dueDate, tz) : ''}</span>
                    </li>
                  ))}</ul>}
            </Card>
            <Card title="Este mes" action={<Link to="/finanzas" className="text-sm text-brand-700">Finanzas</Link>}>
              {sumErr ? <ErrorBox error={sumErr} /> : !summary ? <Loading /> : Object.keys(summary.totals).length === 0
                ? <Empty text="Aún no hay movimientos este mes." />
                : Object.entries(summary.totals).map(([cur, t]) => (
                    <div key={cur} className="mb-3 grid grid-cols-3 gap-2 text-sm">
                      <div><p className="text-ink-soft">Ingresos</p><p className="font-semibold text-ok-700">{money(t.income, cur)}</p></div>
                      <div><p className="text-ink-soft">Gastos</p><p className="font-semibold text-danger-700">{money(t.expense, cur)}</p></div>
                      <div><p className="text-ink-soft">Balance</p><p className="font-semibold">{money(t.income - t.expense, cur)}</p></div>
                    </div>
                  ))}
              {summary?.budgets.filter((b) => b.spent >= b.limit * 0.8).map((b) => (
                <p key={b.category} className="text-sm text-warn-700">⚠️ {categoryLabel('expense', b.category)}: {Math.round((b.spent / b.limit) * 100)}% del presupuesto</p>
              ))}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
