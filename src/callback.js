// src/callback.js
// Sistema de callback / follow-up (ES module, singleton)

const MS = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
};

// default timings — edite se necessário
const FIRST_DELAY_MS = 0.05 * MS.minute; // 3 minutos (ajuste se quiser)
const DAY_DELAY_MS = 0.5 * MS.day; // 12 horas
const MAX_SENDS = 5;

// Mensagens padrão
const DEFAULT_MESSAGE_A = `👋 Ei! Vii que você começou aqui no BOTVIP e deu uma olhada nas ofertas, mas não finalizou a compra. Posso tirar alguma dúvida rápida pra você?`;
const DEFAULT_MESSAGE_B = `Olá de novo! Só passando pra lembrar das vantagens do plano VIP: conteúdo exclusivo, atualizações e suporte. Quer que eu envie o link novamente ou prefere a opção de uma call rápida para tirar dúvidas?`;

const PRICE_B = process.env.PLANO_B;

let botInstance = null;

// Internals
const state = new Map();

function ensureBot() {
  if (!botInstance) throw new Error("callbackSystem not initialized. Call init(bot) first.");
}

export function init(bot) {
  if (!bot) throw new Error("init(bot) requires a Telegraf bot instance");
  if (botInstance) return;
  botInstance = bot;
}

function _key(id) {
  return String(id);
}

function _clearEntry(entry) {
  if (!entry) return;
  if (entry.timeouts) entry.timeouts.forEach(t => clearTimeout(t));
  if (entry.intervalId) clearInterval(entry.intervalId);
}

/**
 * Gera o teclado com link de checkout.
 * Tenta criar uma Stripe Checkout Session usando botInstance.createCheckoutSession.
 * Se não for possível, retorna um fallback que usa WEBHOOK_URL (como anteriormente).
 */
async function checkoutKeyboardForId(id) {
  // 1) tenta criar Checkout Session via util do bot (melhor opção)
  if (PRICE_B && botInstance && typeof botInstance.createCheckoutSession === "function") {
    try {
      const session = await botInstance.createCheckoutSession({ telegramId: id, priceId: PRICE_B, mode: "payment"});
      if (session && session.url) {
        return {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "💳 Comprar Plano VIP", url: session.url }
              ]
            ]
          }
        };
      } else {
        console.warn("callback: createCheckoutSession não retornou session.url, fallback para WEBHOOK_URL");
      }
    } catch (err) {
      console.warn("⚠️ Erro ao criar Checkout Session (callback):", err?.message || err);
      // prossegue para fallback abaixo
    }
  } else {
    if (!PRICE_B) console.warn("⚠️ PLANO_B não configurado (process.env.PLANO_B)");
    if (!botInstance || typeof botInstance.createCheckoutSession !== "function") {
      console.warn("⚠️ botInstance.createCheckoutSession não disponível - usando fallback de URL");
    }
  }

  // 2) fallback: usa WEBHOOK_URL /checkout?price=... (comportamento antigo)
  const webhookUrl = process.env.WEBHOOK_URL || "";
  if (webhookUrl && PRICE_B) {
    const url = `${webhookUrl.replace(/\/+$/, "")}/checkout?price=${encodeURIComponent(PRICE_B)}&telegramId=${encodeURIComponent(id)}`;
    return {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "💳 Comprar Plano VIP", url }
          ]
        ]
      }
    };
  }

  // 3) fallback final: botão genérico apontando para o username do bot (se configurado)
  const botUser = process.env.BOT_USERNAME ? `https://t.me/${process.env.BOT_USERNAME}` : null;
  if (botUser) {
    return {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "💳 Comprar Plano VIP", url: botUser }
          ]
        ]
      }
    };
  }

  // 4) se não há nada, retorna um keyboard vazio (sem botão)
  return { reply_markup: { inline_keyboard: [] } };
}

export function startCallbackFlow(rawId, opts = {}) {
  ensureBot();
  const id = _key(rawId);

  (async () => {
    try {
      let chatInfo = null;
      try {
        chatInfo = await botInstance.telegram.getChat(id);
      } catch (_) {}

      if (chatInfo && chatInfo.type !== "private") return;
    } catch (_) {}

    if (state.has(id)) {
      _clearEntry(state.get(id));
      state.delete(id);
    }

    const entry = {
      timeouts: [],
      intervalId: null,
      sentCount: 0,
      startedAt: Date.now(),
    };

    const messageA = opts.messageA || DEFAULT_MESSAGE_A;
    const messageB = opts.messageB || DEFAULT_MESSAGE_B;

    const logsChat = process.env.LOGS_CHAT_ID || null;

    // 🔥 NOTE: checkoutKeyboard() agora é assíncrono e criado via checkoutKeyboardForId

    // 1ª mensagem
    const t1 = setTimeout(async () => {
      try {
        const isSub = botInstance.isSubscriber ? await safeIsSubscriber(botInstance, id) : false;
        if (isSub) return stopCallbackFlow(id);

        const keyboard = await checkoutKeyboardForId(id);
        await botInstance.telegram.sendMessage(id, messageA, keyboard);
        entry.sentCount++;
      } catch (err) {
        console.warn("callback t1 error:", err.message);
      }
    }, FIRST_DELAY_MS);
    entry.timeouts.push(t1);

    // 2ª mensagem
    const t2 = setTimeout(async () => {
      try {
        const isSub = botInstance.isSubscriber ? await safeIsSubscriber(botInstance, id) : false;
        if (isSub) return stopCallbackFlow(id);

        if (entry.sentCount < MAX_SENDS) {
          const keyboard = await checkoutKeyboardForId(id);
          await botInstance.telegram.sendMessage(id, messageB, keyboard);
          entry.sentCount++;
        }
      } catch (err) {
        console.warn("callback t2 error:", err.message);
      }
    }, FIRST_DELAY_MS + DAY_DELAY_MS);
    entry.timeouts.push(t2);

    // 3ª mensagem
    const t3 = setTimeout(async () => {
      try {
        const isSub = botInstance.isSubscriber ? await safeIsSubscriber(botInstance, id) : false;
        if (isSub) return stopCallbackFlow(id);

        if (entry.sentCount < MAX_SENDS) {
          const keyboard = await checkoutKeyboardForId(id);
          await botInstance.telegram.sendMessage(id, messageA, keyboard);
          entry.sentCount++;
        }
      } catch (err) {
        console.warn("callback t3 error:", err.message);
      } finally {
        if (state.has(id)) {
          _clearEntry(state.get(id));
          state.delete(id);
        }
      }
    }, FIRST_DELAY_MS + 2 * DAY_DELAY_MS);
    entry.timeouts.push(t3);

    state.set(id, entry);

    if (logsChat) {
      botInstance.telegram.sendMessage(logsChat, `📩 Follow-ups agendados para ${id}`);
    }
  })();
}

export function stopCallbackFlow(rawId) {
  if (!botInstance) return false;
  const id = _key(rawId);

  if (!state.has(id)) return false;

  _clearEntry(state.get(id));
  state.delete(id);

  const logsChat = process.env.LOGS_CHAT_ID || null;
  if (logsChat) {
    botInstance.telegram.sendMessage(logsChat, `⛔ Followups cancelados para ${id}`);
  }

  return true;
}

export function stopByPayment(rawId) {
  return stopCallbackFlow(rawId);
}

export function getPending(rawId) {
  return state.get(_key(rawId)) || null;
}

async function safeIsSubscriber(bot, telegramId) {
  try {
    const res = bot.isSubscriber(telegramId);
    if (res?.then) return await res;
    return res;
  } catch (_) {
    return false;
  }
}
