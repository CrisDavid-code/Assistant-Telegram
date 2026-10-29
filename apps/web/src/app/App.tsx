import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { isFirebaseConfigured } from '../services/firebase';
import { SessionProvider, useSession } from '../hooks/session';
import { ToastProvider } from '../hooks/useToast';
import { Loading } from '../components/ui';
import { AppLayout } from './AppLayout';
import { ErrorBoundary } from './ErrorBoundary';
import { Login } from '../pages/Login';

const Dashboard = lazy(() => import('../pages/Dashboard'));
const Agenda = lazy(() => import('../pages/Agenda'));
const Finance = lazy(() => import('../pages/Finance'));
const Contacts = lazy(() => import('../pages/Contacts'));
const Assistant = lazy(() => import('../pages/Assistant'));
const Settings = lazy(() => import('../pages/Settings'));
const Projects = lazy(() => import('../pages/Projects'));
const Opportunities = lazy(() => import('../pages/Opportunities'));
const Documents = lazy(() => import('../pages/Documents'));
const Admin = lazy(() => import('../pages/Admin'));
const More = lazy(() => import('../pages/More'));

function Protected({ children }: { children: ReactNode }) {
  const s = useSession();
  if (!s.ready) return <Loading />;
  if (!s.user) return <Navigate to="/entrar" replace />;
  return <>{children}</>;
}

function FinanceGuard({ children }: { children: ReactNode }) {
  const s = useSession();
  return s.can('finance.read') ? <>{children}</> : <Navigate to="/" replace />;
}

export function App() {
  if (!isFirebaseConfigured) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-bold">Falta configurar Firebase</h1>
        <p className="mt-2 text-ink-soft">Copia <code>apps/web/.env.example</code> a <code>.env.local</code> y completa la configuración web del proyecto (ver README).</p>
      </main>
    );
  }
  return (
    <ErrorBoundary>
      <ToastProvider>
        <SessionProvider>
          <BrowserRouter>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/entrar" element={<Login />} />
                <Route element={<Protected><AppLayout /></Protected>}>
                  <Route index element={<Dashboard />} />
                  <Route path="agenda" element={<Agenda />} />
                  <Route path="finanzas" element={<FinanceGuard><Finance /></FinanceGuard>} />
                  <Route path="contactos" element={<Contacts />} />
                  <Route path="asistente" element={<Assistant />} />
                  <Route path="configuracion" element={<Settings />} />
                  <Route path="proyectos" element={<Projects />} />
                  <Route path="oportunidades" element={<Opportunities />} />
                  <Route path="documentos" element={<Documents />} />
                  <Route path="admin" element={<Admin />} />
                  <Route path="mas" element={<More />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </SessionProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
