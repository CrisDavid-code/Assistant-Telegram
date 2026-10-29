import { Link } from 'react-router-dom';
import { Bot, FileText, FolderKanban, Handshake, Settings, Users } from 'lucide-react';

/** Destinos que no caben en la barra inferior del teléfono. */
export default function More() {
  const items = [
    { to: '/contactos', label: 'Contactos', icon: Users },
    { to: '/oportunidades', label: 'Oportunidades', icon: Handshake },
    { to: '/proyectos', label: 'Proyectos', icon: FolderKanban },
    { to: '/documentos', label: 'Documentos', icon: FileText },
    { to: '/asistente', label: 'Asistente', icon: Bot },
    { to: '/configuracion', label: 'Configuración', icon: Settings },
  ];
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Más</h1>
      <div className="grid grid-cols-2 gap-3">
        {items.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-[--radius-card] border border-line bg-surface font-semibold hover:border-brand-600">
            <Icon className="size-6 text-brand-600" aria-hidden />{label}
          </Link>
        ))}
      </div>
    </div>
  );
}
