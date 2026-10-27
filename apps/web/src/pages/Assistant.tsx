import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Send } from 'lucide-react';
import { call, errorMessage } from '../services/api';
import { useSpace } from '../hooks/session';
import { Button, inputCls, PageHeader } from '../components/ui';

interface Msg { from: 'me' | 'bot'; text: string; actionId?: string; choices?: string[]; done?: boolean }
interface Reply { text: string; actionId?: string; choices?: string[] }

/** Mismo motor que el bot de Telegram: las acciones financieras siempre piden confirmación. */
export default function Assistant() {
  const { spaceId, space } = useSpace();
  const [msgs, setMsgs] = useState<Msg[]>([{ from: 'bot', text: 'Hola. Escríbeme como a una persona: «Gasté Q90 en almuerzo», «Recuérdame el viernes a las 9 pagar la renta», «¿Qué pendientes tengo hoy?».' }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs]);
  useEffect(() => setMsgs((m) => m.slice(0, 1)), [spaceId]);

  async function talk(op: () => Promise<Reply>, mine?: string) {
    setBusy(true);
    if (mine) setMsgs((m) => [...m, { from: 'me', text: mine }]);
    try {
      const r = await op();
      setMsgs((m) => [...m, { from: 'bot', ...r }]);
    } catch (e) {
      setMsgs((m) => [...m, { from: 'bot', text: errorMessage(e) }]);
      if (mine) setText(mine); // no se pierde lo escrito
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setText('');
    talk(() => call('assistant.message', spaceId, { text: t }), t);
  }
  function answer(i: number, actionId: string, accept: boolean, choice?: number) {
    setMsgs((m) => m.map((x, j) => (j === i ? { ...x, done: true } : x)));
    talk(() => call('assistant.confirm', spaceId, { actionId, accept, choice }));
  }

  return (
    <div className="flex h-[calc(100dvh-11rem)] flex-col md:h-[calc(100dvh-7rem)]">
      <PageHeader title="Asistente" action={<span className="text-sm text-ink-soft">en {space.name}</span>} />
      <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain pb-4" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.from === 'me' ? 'justify-end' : ''}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-line ${m.from === 'me' ? 'bg-brand-600 text-white' : 'border border-line bg-surface'}`}>
              {m.text}
              {m.actionId && !m.done && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.choices?.map((c, k) => <Button key={k} onClick={() => answer(i, m.actionId!, true, k)} disabled={busy}>{c}</Button>)}
                  <Button variant="secondary" onClick={() => answer(i, m.actionId!, false)} disabled={busy}>Cancelar</Button>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-line pt-3">
        <label className="sr-only" htmlFor="msg">Mensaje</label>
        <input id="msg" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Escribe un mensaje…" className={inputCls} autoComplete="off" />
        <Button type="submit" busy={busy} aria-label="Enviar"><Send className="size-4" /></Button>
      </form>
    </div>
  );
}
