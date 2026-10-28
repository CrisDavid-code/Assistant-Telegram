// Cliente mínimo de la Bot API. El token es un secreto del Worker (TELEGRAM_BOT_TOKEN), nunca en el código ni en logs.

export type InlineKeyboard = { text: string; callback_data: string }[][];

export interface TelegramClient {
  send(chatId: number, text: string, keyboard?: InlineKeyboard): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  getFile(fileId: string): Promise<{ bytes: Uint8Array; path: string }>;
}

async function call(method: string, body: unknown) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN no configurado');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: any };
  // Solo `ok: true` cuenta como entregado; cualquier otra respuesta es un fallo real.
  if (!json.ok) throw new Error(`Telegram ${method}: ${res.status} ${json.description ?? ''}`.trim());
  return json.result;
}

const real: TelegramClient = {
  async send(chatId, text, keyboard) {
    await call('sendMessage', {
      chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  },
  async answerCallback(callbackId, text) {
    await call('answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) });
  },
  async getFile(fileId) {
    const file = (await call('getFile', { file_id: fileId })) as { file_path: string };
    const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Telegram file: ${res.status}`);
    return { bytes: new Uint8Array(await res.arrayBuffer()), path: file.file_path };
  },
};

/** Las pruebas reemplazan el cliente para no llamar a Telegram. */
export let telegram: TelegramClient = real;
export const setTelegramClient = (c: TelegramClient) => {
  telegram = c;
};

/** Escapa texto del usuario para parse_mode HTML. */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
