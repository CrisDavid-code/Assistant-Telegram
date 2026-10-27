import { logger } from 'firebase-functions';
import { rulesProvider } from './rules';
import { zIntent, type AIProvider, type Intent, type InterpretContext } from './types';

/** Proveedor de IA externo (opcional). Sin credenciales, el asistente funciona solo con reglas. */
let llm: AIProvider | null = null;
export const setLLM = (p: AIProvider | null) => {
  llm = p;
};
export const getLLM = () => llm;

/** Reglas primero (gratis, deterministas); si no entienden y hay IA configurada, se consulta a la IA. */
export async function interpret(text: string, ctx: InterpretContext): Promise<Intent> {
  const byRules = await rulesProvider.interpret(text, ctx);
  if (byRules.type !== 'unknown' || !llm) return byRules;
  try {
    // La salida de la IA es una entrada NO confiable: se valida con el mismo esquema.
    return zIntent.parse(await llm.interpret(text, ctx));
  } catch (err) {
    logger.warn('ai.interpret.failed', { provider: llm.name, error: (err as Error).message });
    return { type: 'unknown' };
  }
}
