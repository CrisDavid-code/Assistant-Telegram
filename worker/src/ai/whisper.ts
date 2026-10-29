// Transcripción de notas de voz con Workers AI (Whisper) — incluido en el plan gratuito de Cloudflare
// dentro de su asignación diaria. El binding `AI` llega en el entorno del Worker (wrangler.toml [ai]).

export interface WorkersAI {
  run(model: string, input: unknown): Promise<unknown>;
}

let ai: WorkersAI | null = null;
export const setWorkersAI = (binding: WorkersAI | null | undefined) => {
  ai = binding ?? null;
};

export function workersAITranscriber() {
  if (!ai) return null;
  const binding = ai;
  return {
    async transcribe(audio: Uint8Array) {
      const out = (await binding.run('@cf/openai/whisper', { audio: [...audio] })) as { text?: string };
      return out.text ?? '';
    },
  };
}
