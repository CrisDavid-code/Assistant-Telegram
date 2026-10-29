import { useState, type FormEvent } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { Download, FileText, Plus, Search, Trash2 } from 'lucide-react';
import { DOCUMENT_TYPES, MAX_FILE_BYTES, type DocumentDoc } from '@lifeos/contracts';
import { db } from '../services/firebase';
import { call, newId } from '../services/api';
import { useSpace } from '../hooks/session';
import { useQueryLive } from '../hooks/useLive';
import { Badge, Button, Empty, ErrorBox, Field, FormFooter, inputCls, Loading, Modal, PageHeader, useAction } from '../components/ui';
import { addDays, dayLabel, todayIn } from '../lib/format';

type Doc = DocumentDoc & { id: string };
export const DOC_TYPE: Record<string, string> = {
  invoice: 'Factura', receipt: 'Recibo', contract: 'Contrato', id: 'Identificación', license: 'Licencia', warranty: 'Garantía',
  vehicle: 'Vehículo', work: 'Laboral', business: 'Empresa', certificate: 'Certificado', other: 'Otro',
};

const toBase64 = (blob: Blob) => new Promise<string>((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] ?? '');
  r.onerror = () => ko(new Error('No se pudo leer el archivo.'));
  r.readAsDataURL(blob);
});

/** Fotos: se reducen y comprimen en el teléfono hasta caber en 700 KB. PDF: se envía tal cual si cabe. */
async function prepareFile(file: File): Promise<{ name: string; base64: string }> {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_FILE_BYTES) throw new Error('El PDF supera 700 KB. Comprímelo o súbelo como foto.');
    return { name: file.name, base64: await toBase64(file) };
  }
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) throw new Error('Solo PDF o imágenes.');
  const img = await createImageBitmap(file);
  for (const [max, q] of [[2000, 0.82], [1600, 0.75], [1280, 0.7], [1000, 0.6]] as const) {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', q));
    if (blob && blob.size <= MAX_FILE_BYTES) return { name: file.name.replace(/\.\w+$/, '') + '.jpg', base64: await toBase64(blob) };
  }
  throw new Error('La imagen es demasiado grande incluso comprimida.');
}

function DocumentForm({ onClose }: { onClose: () => void }) {
  const { spaceId } = useSpace();
  const { busy, error, run, clear } = useAction();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const f = Object.fromEntries(form) as Record<string, string>;
    const file = form.get('file') as File | null;
    const ok = await run(async () => call('document.create', spaceId, {
      requestId: newId(), title: f.title!, type: f.type as never, issuer: f.issuer || undefined, issuedAt: f.issuedAt || undefined,
      expiresAt: f.expiresAt || undefined, remindDaysBefore: f.expiresAt && f.remind !== '' ? Number(f.remind) : undefined,
      tags: f.tags ? f.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      file: file && file.size ? await prepareFile(file) : undefined,
    }), 'Documento guardado');
    if (ok) onClose();
  }
  return (
    <form onSubmit={submit} onChange={clear} className="space-y-3">
      <Field label="Título"><input name="title" required maxLength={120} className={inputCls} autoFocus /></Field>
      <Field label="Tipo"><select name="type" required defaultValue="" className={inputCls}><option value="" disabled>Selecciona una opción</option>{DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{DOC_TYPE[t]}</option>)}</select></Field>
      <Field label="Emisor"><input name="issuer" maxLength={80} className={inputCls} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Emisión"><input name="issuedAt" type="date" className={inputCls} /></Field>
        <Field label="Vencimiento"><input name="expiresAt" type="date" className={inputCls} /></Field>
      </div>
      <Field label="Avisarme del vencimiento"><select name="remind" defaultValue="7" className={inputCls}><option value="">No avisar</option><option value="0">El mismo día</option><option value="3">3 días antes</option><option value="7">7 días antes</option><option value="30">30 días antes</option></select></Field>
      <Field label="Etiquetas" hint="Separadas por comas"><input name="tags" className={inputCls} /></Field>
      <Field label="Archivo (opcional)" hint="PDF de hasta 700 KB o una foto (se comprime automáticamente).">
        <input name="file" type="file" accept="application/pdf,image/*" className="block w-full text-sm" />
      </Field>
      <FormFooter busy={busy} error={error} onCancel={onClose} />
    </form>
  );
}

export default function Documents() {
  const { spaceId, space, can } = useSpace();
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const { busy, error, run } = useAction();
  const list = useQueryLive<DocumentDoc>(() => query(collection(db, 'spaces', spaceId, 'documents'), orderBy('createdAt', 'desc'), limit(500)), `docs:${spaceId}`);
  const today = todayIn(space.timezone);
  const soon = addDays(today, 30);
  const term = q.trim().toLowerCase();
  const shown = list.data.filter((d) => !term || [d.title, d.issuer ?? '', DOC_TYPE[d.type] ?? '', ...d.tags].some((x) => x.toLowerCase().includes(term)));

  async function download(d: Doc) {
    await run(async () => {
      const r = (await call('document.download', spaceId, { documentId: d.id })) as { name: string; mime: string; base64: string };
      const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = r.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });
  }

  return (
    <div>
      <PageHeader title="Documentos" action={can('core.write') && <Button onClick={() => setCreating(true)}><Plus className="size-4" />Nuevo</Button>} />
      <label className="relative mb-4 block">
        <span className="sr-only">Buscar documentos</span>
        <Search className="absolute top-3 left-3 size-5 text-ink-soft" aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Título, emisor, tipo o etiqueta" className={`${inputCls} pl-10`} />
      </label>
      {error ? <div className="mb-3"><ErrorBox error={error} /></div> : null}
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : !shown.length ? (
        <Empty icon={<FileText className="size-8" />} text={q ? 'Sin resultados.' : 'Guarda facturas, contratos, licencias o garantías y te aviso antes de que venzan.'} />
      ) : (
        <ul className="divide-y divide-line rounded-[--radius-card] border border-line bg-surface px-4">
          {shown.map((d) => {
            const expired = d.expiresAt && d.expiresAt < today;
            const expiring = d.expiresAt && !expired && d.expiresAt <= soon;
            return (
              <li key={d.id} className="flex items-center gap-3 py-3">
                <FileText className="size-5 shrink-0 text-brand-600" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{d.title}</p>
                  <p className="flex flex-wrap gap-1.5 text-xs text-ink-soft">
                    {DOC_TYPE[d.type]}{d.issuer && ` · ${d.issuer}`}
                    {d.expiresAt && <Badge tone={expired ? 'danger' : expiring ? 'warn' : 'neutral'}>{expired ? 'Venció' : 'Vence'} {dayLabel(d.expiresAt, space.timezone)}</Badge>}
                    {d.tags.map((t) => <Badge key={t}>#{t}</Badge>)}
                  </p>
                </div>
                {d.file && <button aria-label={`Descargar ${d.title}`} disabled={busy} onClick={() => download(d)} className="grid size-10 place-items-center rounded-full text-ink-soft hover:bg-paper"><Download className="size-4" /></button>}
                {can('core.write') && <button aria-label={`Eliminar ${d.title}`} onClick={() => confirm(`¿Eliminar «${d.title}» y su archivo?`) && run(() => call('document.delete', spaceId, { documentId: d.id }), 'Documento eliminado')} className="grid size-10 place-items-center rounded-full text-ink-soft hover:bg-paper"><Trash2 className="size-4" /></button>}
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="Nuevo documento">{creating && <DocumentForm onClose={() => setCreating(false)} />}</Modal>
    </div>
  );
}
