// Roles y permisos por espacio. Fuente única para backend (autorización real) y PWA (solo navegación).
// firestore.rules replica la parte de LECTURA de esta tabla: si cambias aquí, cambia allá y sus pruebas.

export const ROLES = ['owner', 'admin', 'supervisor', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  supervisor: 'Supervisor',
  member: 'Miembro',
  viewer: 'Solo lectura',
};

export type Permission =
  | 'core.read' // tareas, recordatorios, contactos, actividades
  | 'core.write'
  | 'finance.read'
  | 'finance.write'
  | 'members.manage'
  | 'space.manage'
  | 'audit.read';

const MATRIX: Record<Role, readonly Permission[]> = {
  owner: ['core.read', 'core.write', 'finance.read', 'finance.write', 'members.manage', 'space.manage', 'audit.read'],
  admin: ['core.read', 'core.write', 'finance.read', 'finance.write', 'members.manage', 'space.manage', 'audit.read'],
  supervisor: ['core.read', 'core.write', 'finance.read'],
  member: ['core.read', 'core.write'],
  viewer: ['core.read'],
};

export function can(role: Role | null | undefined, perm: Permission): boolean {
  return !!role && MATRIX[role].includes(perm);
}

/** Roles que un administrador puede asignar. "owner" nunca se asigna por invitación. */
export const ASSIGNABLE_ROLES = ['admin', 'supervisor', 'member', 'viewer'] as const satisfies readonly Role[];
