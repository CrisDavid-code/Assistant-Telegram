import { logger } from '../shared/log';
import { rulesProvider } from './rules';
import { claudeProvider } from './claude';
import { workersAITranscriber } from './whisper';
import { zIntent, type AIProvider, type Intent, type InterpretContext } from './types';

/** Proveedor de IA externo (opcional). Sin credenciales, el asistente funciona solo con reglas. */
let llm: AIProvider | null | undefined;
export const setLLM = (p: AIProvider | null) => {
  llm = p;
};
/** Se activa solo con una clave real en el secreto ANTHROPIC_API_KEY (cualquier otro valor = desactivado). */
export const getLLM = () => {
  if (llm === undefined) {
    const key = process.env.ANTHROPIC_API_KEY ?? '';
    llm = key.startsWith('sk-ant-') ? claudeProvider(key) : null;
  }
  return llm;
};

/** Voz → texto: Workers AI (gratis) si está el binding; si no, el proveedor de IA si lo implementa. */
export const getTranscriber = (): { transcribe(audio: Uint8Array, mime: string): Promise<string> } | null => {
  const llm = getLLM();
  return workersAITranscriber() ?? (llm?.transcribe ? { transcribe: llm.transcribe.bind(llm) } : null);
};

/** Reglas primero (gratis, deterministas); si no entienden y hay IA configurada, se consulta a la IA. */
export async function interpret(text: string, ctx: InterpretContext): Promise<Intent> {
  const byRules = await rulesProvider.interpret(text, ctx);
  const llm = getLLM();
  if (byRules.type !== 'unknown' || !llm) return byRules;
  try {
    // La salida de la IA es una entrada NO confiable: se valida con el mismo esquema.
    return zIntent.parse(await llm.interpret(text, ctx));
  } catch (err) {
    logger.warn('ai.interpret.failed', { provider: llm.name, error: (err as Error).message });
    return { type: 'unknown' };
  }
}
