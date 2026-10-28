/** Registro estructurado (JSON por línea): visible con `wrangler tail` y en el panel de Cloudflare. */
const log = (severity: string) => (message: string, data: Record<string, unknown> = {}) => console.log(JSON.stringify({ severity, message, ...data }));
export const logger = { info: log('INFO'), warn: log('WARNING'), error: log('ERROR') };
