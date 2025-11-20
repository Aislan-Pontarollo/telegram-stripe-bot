// src/callback.js
// Sistema de callback / follow-up (ES module, singleton)

const MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

// default timings — edite se necessário
const FIRST_DELAY_MS = 5 * MS.minute; // 5 minutos
const DAY_DELAY_MS = 1 * MS.day; // 24 horas
const MAX_SENDS = 3; // total de envios: 5min + day1 + day2

// Mensagens padrão (troque no .env ou aqui)
const DEFAULT_MESSAGE_A = `👋 Ei! Vi que você começou aqui no BOTVIP e deu uma olhada nas ofertas, mas não finalizou a compra. Posso tirar alguma dúvida rápida pra você? Se preferir, também ofereço uma call curta (paga) pra te orientar — me diz se quer que eu envie o link.`;
const DEFAULT_MESSAGE_B = `Olá de novo! Só passando pra lembrar das vantagens do plano VIP: conteúdo exclusivo, atualizações e suporte. Quer que eu envie o link novamente ou prefere que eu te ofereça a opção de uma call rápida para tirar dúvidas?`;

/*
API pública:
  init(bot)                -> inicializa com a instância do Telegraf (chame UMA vez)
  startCallbackFlow(id)    -> agenda followups para telegramId (String or Number)
  stopCallbackFlow(id)     -> cancela e limpa timers para telegramId
  stopByPayment(id)        -> alias para stopCallbackFlow (uso semântico)
  getPending(id)           -> retorna objeto interno (para debug)
*/

let botInstance = null;

// Internals: Map<telegramIdString, { timeouts: [], intervalId, sentCount, startedAt }>
const state = new Map();

function ensureBot() {
  if (!botInstance) throw new Error("callbackSystem not initialized. Call init(bot) first.");
}

export function init(bot) {
  if (!bot) throw new Error("init(bot) requires a Telegraf bot instance");
  if (botInstance) {
    // já inicializado — não recriar
    return;
  }
  botInstance = bot;
}

function _key(id) {
  return String(id);
}

function _clearEntry(entry) {
  if (!entry) return;
  if (entry.timeouts && Array.isArray(entry.timeouts)) {
    for (const t of entry.timeouts) {
      try {
        clearTimeout(t);
      } catch (_) {}
    }
  }
  if (entry.intervalId) {
    try {
      clearInterval(entry.intervalId);
    } catch (_) {}
  }
}

export function startCallbackFlow(rawId, opts = {}) {
  ensureBot();
  const id = _key(rawId);
  // only schedule for private chats (avoid spamming groups)
  // we can check bot API to fetch chat type, but that requires an API call.
  // Best practice: caller (bot.start) should only call this for private chats.
  // Still we protect a bit: if chat type is group, do nothing (attempt to fetch)
  (async () => {
    try {
      // try read chat info — best-effort (if fails, proceed)
      let chatInfo = null;
      try {
        chatInfo = await botInstance.telegram.getChat(id);
      } catch (_) {
        // ignore
      }
      if (chatInfo && chatInfo.type && chatInfo.type !== "private") {
        // don't schedule for non-private chats
        return;
      }
    } catch (_) {}

    // reset if exists
    if (state.has(id)) {
      const prev = state.get(id);
      _clearEntry(prev);
      state.delete(id);
    }

    const messageA = opts.messageA || DEFAULT_MESSAGE_A;
    const messageB = opts.messageB || DEFAULT_MESSAGE_B;
    const logsChat = process.env.LOGS_CHAT_ID || null;

    const entry = {
      timeouts: [],
      intervalId: null,
      sentCount: 0,
      startedAt: Date.now(),
    };

    // primeira mensagem em FIRST_DELAY_MS (5 minutos)
    const t1 = setTimeout(async () => {
      try {
        // ver se virou assinante antes de enviar
        const isSub = botInstance && typeof botInstance.isSubscriber === "function"
          ? await safeIsSubscriber(botInstance, id)
          : false;
        if (isSub) {
          // se assinante, cancela
          stopCallbackFlow(id);
          return;
        }
        await botInstance.telegram.sendMessage(id, messageA);
        entry.sentCount += 1;
      } catch (err) {
        console.warn("callback t1 send error:", err.message || err);
      }
    }, FIRST_DELAY_MS);
    entry.timeouts.push(t1);

    // segunda mensagem: FIRST_DELAY_MS + 24h
    const t2 = setTimeout(async () => {
      try {
        const isSub = botInstance && typeof botInstance.isSubscriber === "function"
          ? await safeIsSubscriber(botInstance, id)
          : false;
        if (isSub) {
          stopCallbackFlow(id);
          return;
        }
        if (entry.sentCount < MAX_SENDS) {
          await botInstance.telegram.sendMessage(id, messageB);
          entry.sentCount += 1;
        }
      } catch (err) {
        console.warn("callback t2 send error:", err.message || err);
      }
    }, FIRST_DELAY_MS + DAY_DELAY_MS);
    entry.timeouts.push(t2);

    // terceira message: FIRST_DELAY_MS + 48h
    const t3 = setTimeout(async () => {
      try {
        const isSub = botInstance && typeof botInstance.isSubscriber === "function"
          ? await safeIsSubscriber(botInstance, id)
          : false;
        if (isSub) {
          stopCallbackFlow(id);
          return;
        }
        if (entry.sentCount < MAX_SENDS) {
          await botInstance.telegram.sendMessage(id, messageA);
          entry.sentCount += 1;
        }
      } catch (err) {
        console.warn("callback t3 send error:", err.message || err);
      } finally {
        // cleanup after last send
        if (state.has(id)) {
          const e = state.get(id);
          _clearEntry(e);
          state.delete(id);
        }
      }
    }, FIRST_DELAY_MS + 2 * DAY_DELAY_MS);
    entry.timeouts.push(t3);

    state.set(id, entry);

    // optional logging
    if (logsChat) {
      try {
        botInstance.telegram.sendMessage(logsChat, `🕒 Followups agendados para ${id} (5m, +24h, +48h)`);
      } catch (_) {}
    }
  })();
}

export function stopCallbackFlow(rawId) {
  if (!botInstance) return false;
  const id = _key(rawId);
  if (!state.has(id)) return false;
  const entry = state.get(id);
  _clearEntry(entry);
  state.delete(id);
  const logsChat = process.env.LOGS_CHAT_ID || null;
  if (logsChat) {
    try {
      botInstance.telegram.sendMessage(logsChat, `⛔ Followups cancelados para ${id}`);
    } catch (_) {}
  }
  return true;
}

export function stopByPayment(rawId) {
  return stopCallbackFlow(rawId);
}

export function getPending(rawId) {
  const id = _key(rawId);
  return state.get(id) || null;
}

// Helper: check subscriber (safe)
async function safeIsSubscriber(bot, telegramId) {
  try {
    if (typeof bot.isSubscriber === "function") {
      // note: isSubscriber might be sync in your bot; handle both
      const res = bot.isSubscriber(telegramId);
      if (res && typeof res.then === "function") return await res;
      return res;
    }
    return false;
  } catch (_) {
    return false;
  }
}
