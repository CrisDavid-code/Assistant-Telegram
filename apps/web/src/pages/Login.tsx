import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { auth } from '../services/firebase';
import { Button, ErrorBox, Field, inputCls, useAction } from '../components/ui';
import { bootstrap, registering, useSession } from '../hooks/session';

export function Login() {
  const s = useSession();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [sent, setSent] = useState(false);
  const { busy, error, run, clear } = useAction();
  if (s.user) return <Navigate to="/" replace />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email')).trim();
    const password = String(f.get('password') ?? '');
    await run(async () => {
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email);
        setSent(true);
      } else if (mode === 'register') {
        const name = String(f.get('name')).trim();
        registering.active = true;
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          await updateProfile(cred.user, { displayName: name });
          sendEmailVerification(cred.user).catch(() => undefined); // no bloquea el registro
          await bootstrap(name);
        } finally {
          registering.active = false;
        }
      } else await signInWithEmailAndPassword(auth, email, password);
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-6">
      <div className="mb-8 text-center">
        <img src="/icon.svg" alt="" className="mx-auto mb-3 size-16" />
        <h1 className="text-2xl font-bold">Aguiteks LifeOS</h1>
        <p className="text-sm text-ink-soft">Tu vida personal, finanzas y trabajo en un solo lugar.</p>
      </div>
      <form onSubmit={submit} onChange={clear} className="space-y-4">
        {mode === 'register' && <Field label="Nombre"><input name="name" required maxLength={60} autoComplete="name" className={inputCls} /></Field>}
        <Field label="Correo"><input name="email" type="email" required autoComplete="email" className={inputCls} /></Field>
        {mode !== 'reset' && (
          <Field label="Contraseña" hint={mode === 'register' ? 'Mínimo 8 caracteres.' : undefined}>
            <input name="password" type="password" required minLength={mode === 'register' ? 8 : 6} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} className={inputCls} />
          </Field>
        )}
        {error ? <ErrorBox error={error} /> : null}
        {sent && <p role="status" className="rounded-xl bg-ok-50 p-3 text-sm text-ok-700">Si existe una cuenta con ese correo, te enviamos un enlace para restablecer la contraseña.</p>}
        <Button type="submit" busy={busy} className="w-full">
          {{ login: 'Entrar', register: 'Crear cuenta', reset: 'Enviar enlace' }[mode]}
        </Button>
      </form>
      <div className="mt-6 flex flex-col items-center gap-2 text-sm">
        {mode !== 'login' && <button className="text-brand-700" onClick={() => setMode('login')}>Ya tengo cuenta</button>}
        {mode !== 'register' && <button className="text-brand-700" onClick={() => setMode('register')}>Crear una cuenta</button>}
        {mode === 'login' && <button className="text-ink-soft" onClick={() => setMode('reset')}>Olvidé mi contraseña</button>}
      </div>
    </main>
  );
}
