import { Component, type ReactNode } from 'react';

/** Un error de pantalla no deja la app en blanco. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="text-xl font-bold">Algo salió mal</h1>
        <p className="mt-2 text-sm text-ink-soft">Recarga la página. Si se repite, avísanos.</p>
        <button className="mt-4 rounded-full bg-brand-600 px-4 py-2 font-semibold text-white" onClick={() => location.reload()}>Recargar</button>
      </main>
    );
  }
}
