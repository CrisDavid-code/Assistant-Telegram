/** Error de negocio con mensaje en español listo para el usuario (PWA o Telegram). */
export class DomainError extends Error {
  constructor(
    public code: 'invalid-argument' | 'not-found' | 'permission-denied' | 'failed-precondition' | 'already-exists' | 'resource-exhausted' | 'unauthenticated',
    message: string,
  ) {
    super(message);
  }
}

export const fail = (code: DomainError['code'], message: string): never => {
  throw new DomainError(code, message);
};
