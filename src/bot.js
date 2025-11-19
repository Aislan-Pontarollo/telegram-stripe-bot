// src/bot.js
import { Telegraf } from "telegraf";
import fs from "fs";
import path from "path";
import Stripe from "stripe";

const DATA_DIR = path.resolve("./data");
const DB_FILE = path.join(DATA_DIR, "subscribers.json");

// ======= ENV expected (use estes nomes no .env) =======
// TOKEN_TELEGRAM
// BOT_USERNAME
// CHANNEL_ID            (ex: -1001234567890)
// LOGS_CHAT_ID          (opcional, ex: -1009876543210)
// SUCCESS_URL           (opcional)
// CANCEL_URL            (opcional)
// STRIPE_SECRET_KEY
// PLANO_1, PLANO_2, PLANO_3
// =====================================================

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// -----------------------------
// Persistência simples (JSON)
// -----------------------------
let inMemoryDb = { subscribers: {} };

async function ensureDataFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(inMemoryDb, null, 2));
    } else {
      const content = fs.readFileSync(DB_FILE, "utf8");
      inMemoryDb = JSON.parse(content || JSON.stringify(inMemoryDb));
    }
  } catch (err) {
    console.warn("⚠️ Falha ao acessar data file. Usando memória apenas.", err.message);
  }
}

function saveDbSync() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(inMemoryDb, null, 2));
  } catch (err) {
    console.warn("⚠️ Falha ao salvar DB (fallback para memória):", err.message);
  }
}

// -----------------------------
// Helpers de Subscriber (CRUD)
// -----------------------------
function addSubscriberObj(obj) {
  inMemoryDb.subscribers[String(obj.telegramId)] = obj;
  saveDbSync();
}

function removeSubscriberObj(telegramId) {
  delete inMemoryDb.subscribers[String(telegramId)];
  saveDbSync();
}

function getSubscriberObj(telegramId) {
  return inMemoryDb.subscribers[String(telegramId)];
}

function getAllSubscribersObj() {
  return inMemoryDb.subscribers || {};
}

function isSubscriberObj(telegramId) {
  const s = getSubscriberObj(telegramId);
  if (!s) return false;
  if (s.current_period_end && Number(s.current_period_end) < Math.floor(Date.now() / 1000)) {
    return false;
  }
  return true;
}

// -----------------------------
// Cria e retorna o bot + funções auxiliares
// -----------------------------
export function createBot() {
  const botToken = process.env.TOKEN_TELEGRAM;
  if (!botToken) throw new Error("TOKEN_TELEGRAM não encontrado em env");

  const bot = new Telegraf(botToken);

  // init DB (async but fire-and-forget)
  ensureDataFile().catch((err) => console.warn("Erro init DB:", err.message));

  // ==============================
  // safeSendMedia - não quebra se arquivo não existir
  // ==============================
  async function safeSendMedia(sendFunc, filePath, extra = {}) {
    try {
      if (!fs.existsSync(filePath)) throw new Error("Arquivo não encontrado: " + filePath);
      await sendFunc({ source: filePath }, extra);
    } catch (err) {
      console.log(`⚠️ Falha ao enviar mídia (${filePath}):`, err.message);
    }
  }

  // ==============================
  // UTIL: gerar checkout session (Stripe)
  // Recebe telegramId e priceId
  // ==============================
  async function createCheckoutSession({ telegramId, priceId }) {
    if (!priceId) throw new Error("priceId é obrigatório para criar checkout");

    const successUrl = process.env.SUCCESS_URL || `https://t.me/${process.env.BOT_USERNAME}`;
    const cancelUrl = process.env.CANCEL_URL || `https://t.me/${process.env.BOT_USERNAME}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl + "?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: cancelUrl,
      client_reference_id: String(telegramId),
      metadata: { telegram_id: String(telegramId), price_id: priceId },
    });

    return session;
  }

  // ==============================
  // Geração de invite link único (1 uso)
  // ==============================
  async function generateSingleUseInviteLink(channelId, expireSeconds = 60 * 60) {
    if (!channelId) throw new Error("CHANNEL_ID não configurado");
    const expireDate = Math.floor(Date.now() / 1000) + expireSeconds;
    const invite = await bot.telegram.createChatInviteLink(channelId, {
      expire_date: expireDate,
      member_limit: 1,
      name: "Acesso VIP - link único",
    });
    return invite.invite_link;
  }

  // ==============================
  // Função pública: concede acesso
  // ==============================
  async function grantAccess(telegramId, { stripeCustomerId = null, subscriptionId = null, priceId = null, current_period_end = null } = {}) {
    try {
      const tId = String(telegramId);
      const entry = {
        telegramId: tId,
        stripeCustomerId: stripeCustomerId || null,
        subscriptionId: subscriptionId || null,
        planPriceId: priceId || null,
        current_period_end: current_period_end ? Number(current_period_end) : null,
        created_at: Math.floor(Date.now() / 1000),
      };
      addSubscriberObj(entry);

      // send log to logs chat if configured
      if (process.env.LOGS_CHAT_ID) {
        try {
          await bot.telegram.sendMessage(process.env.LOGS_CHAT_ID, `✅ GrantAccess: ${tId}\nplan: ${entry.planPriceId || "unknown"}\nperiod_end: ${entry.current_period_end || "unknown"}`);
        } catch (err) {
          console.warn("⚠️ Falha ao enviar log para LOGS_CHAT_ID:", err.message);
        }
      }

      // if no channel configured, just notify user
      const channelId = process.env.CHANNEL_ID || process.env.TELEGRAM_VIP_GROUP_ID;
      if (!channelId) {
        try {
          await bot.telegram.sendMessage(tId, "✅ Pagamento confirmado — seu acesso foi registrado. Em breve você receberá o link do canal VIP.");
        } catch (err) {
          console.warn("⚠️ Não foi possível enviar DM ao usuário (grantAccess):", err.message);
        }
        return entry;
      }

      // generate invite and send to user
      try {
        const inviteLink = await generateSingleUseInviteLink(channelId, 60 * 60 * 24); // 24h
        await bot.telegram.sendMessage(tId, `🎉 Pagamento confirmado! Aqui está seu link de acesso (válido 24h / 1 uso):\n\n${inviteLink}`);
      } catch (err) {
        console.warn("⚠️ Falha ao gerar/enviar invite:", err.message);
        try {
          await bot.telegram.sendMessage(tId, "✅ Pagamento confirmado, mas houve um problema ao gerar o link automático. Em breve te adicionaremos manualmente.");
        } catch (err2) {
          // ignora se não for possível enviar mensagem
        }
      }

      return entry;
    } catch (err) {
      console.error("❌ grantAccess erro:", err.message);
      throw err;
    }
  }

  // ==============================
  // Função pública: revogar acesso
  // ==============================
  async function revokeAccess(telegramId) {
    try {
      const tId = String(telegramId);
      const channelId = process.env.CHANNEL_ID || process.env.TELEGRAM_VIP_GROUP_ID;

      // remove from DB first
      removeSubscriberObj(tId);

      if (!channelId) {
        if (process.env.LOGS_CHAT_ID) {
          try {
            await bot.telegram.sendMessage(process.env.LOGS_CHAT_ID, `⚠️ revokeAccess: ${tId} (CHANNEL_ID não configurado)`);
          } catch (_) {}
        }
        return true;
      }

      try {
        await bot.telegram.banChatMember(channelId, tId);
        await bot.telegram.unbanChatMember(channelId, tId);
      } catch (err) {
        console.warn("⚠️ Erro ao ban/unban (revokeAccess):", err.message);
      }

      // notify user
      try {
        await bot.telegram.sendMessage(tId, "⚠️ Seu acesso ao canal VIP foi removido. Se quiser, faça uma nova assinatura.");
      } catch (err) {
        // usuário pode ter bloqueado bot ou não iniciado
      }

      if (process.env.LOGS_CHAT_ID) {
        try {
          await bot.telegram.sendMessage(process.env.LOGS_CHAT_ID, `❌ RevokeAccess: ${tId}`);
        } catch (_) {}
      }

      return true;
    } catch (err) {
      console.error("❌ revokeAccess erro:", err.message);
      return false;
    }
  }

  // ==============================
  // Consulta de assinante
  // ==============================
  function isSubscriber(telegramId) {
    return isSubscriberObj(telegramId);
  }

  function getSubscriber(telegramId) {
    return getSubscriberObj(telegramId);
  }

  function getAllSubscribers() {
    return getAllSubscribersObj();
  }

  // ==============================
  // Middleware: exige assinante
  // ==============================
  function requireSubscriber(ctx, next) {
    const id = ctx.from && String(ctx.from.id);
    if (!id || !isSubscriber(id)) {
      return ctx.reply("❌ Você não possui assinatura ativa. Use /planos para assinar.");
    }
    return next();
  }

  // ==============================
  // BOT HANDLERS
  // ==============================
  bot.start(async (ctx) => {
    try {
      await ctx.reply("⏳ Carregando...");

      const imgPath = path.resolve("./assets/im.jpg");
      if (fs.existsSync(imgPath)) {
        await safeSendMedia(ctx.replyWithPhoto.bind(ctx), imgPath, {
          caption: "🤖 *Bem-vindo ao BOTVIP!*",
          parse_mode: "Markdown",
        });
      }

      const greeting = `👋 Olá, *${ctx.from.first_name || "amigo"}*! Bem-vindo.\nEscolha abaixo:`;
      const keyboard = {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "💳 Ver Planos", callback_data: "ver_planos" }],
            [{ text: "🔐 Acessar Canal VIP", callback_data: "acessar_vip" }],
            [{ text: "❓ Ajuda", callback_data: "ajuda" }],
          ],
        },
      };

      const isSub = isSubscriber(String(ctx.from.id));
      if (isSub) {
        await ctx.reply(greeting + `\n\n✅ Você tem assinatura ativa. Use "🔐 Acessar Canal VIP" para receber seu link (novamente).`, keyboard);
      } else {
        await ctx.reply(greeting, keyboard);
      }
    } catch (err) {
      console.error("Erro no /start:", err.message);
    }
  });

  // /planos
  bot.command("planos", (ctx) => {
    ctx.reply("💳 *Nossos Planos:*", {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💎 Plano Semanal", callback_data: "plano_semanal" }],
          [{ text: "🔥 Plano Mensal", callback_data: "plano_mensal" }],
          [{ text: "🚀 Plano Vitalício", callback_data: "plano_vitalicio" }],
        ],
      },
    });
  });

  // /vip
  bot.command("vip", (ctx) => {
    const id = String(ctx.from.id);
    const sub = getSubscriber(id);
    if (!sub || !isSubscriber(id)) {
      return ctx.reply("❌ Você não possui assinatura ativa. Use /planos para assinar.");
    }
    const until = sub.current_period_end ? new Date(sub.current_period_end * 1000).toLocaleString() : "indefinido";
    return ctx.reply(`✅ Você é assinante!\nPlano: ${sub.planPriceId || "desconhecido"}\nVálido até: ${until}`);
  });

  // callback_query centralizado
  bot.on("callback_query", async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCbQuery();

    const PRICES = {
      plano_semanal: process.env.PLANO_1,
      plano_mensal: process.env.PLANO_2,
      plano_vitalicio: process.env.PLANO_3,
    };

    if (data === "ver_planos") {
      return ctx.reply("💳 *Planos disponíveis:*", {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "💎 Plano Semanal", callback_data: "plano_semanal" }],
            [{ text: "🔥 Plano Mensal", callback_data: "plano_mensal" }],
            [{ text: "🚀 Plano Vitalício", callback_data: "plano_vitalicio" }],
          ],
        },
      });
    }

    if (data === "acessar_vip") {
      const id = String(ctx.from.id);
      if (!isSubscriber(id)) {
        return ctx.reply("❌ Você não possui assinatura ativa. Use /planos para assinar.");
      }
      const channelId = process.env.CHANNEL_ID || process.env.TELEGRAM_VIP_GROUP_ID;
      if (!channelId) return ctx.reply("⚠️ Canal não configurado. Contate o suporte.");
      try {
        const invite = await generateSingleUseInviteLink(channelId, 60 * 60 * 24);
        await ctx.reply(`🔐 Aqui está seu link de acesso (válido 24h / 1 uso):\n\n${invite}`);
      } catch (err) {
        console.warn("Erro ao gerar invite:", err.message);
        return ctx.reply("❌ Não foi possível gerar link. Tente novamente mais tarde.");
      }
      return;
    }

    if (PRICES[data]) {
      const priceId = PRICES[data];
      try {
        const session = await createCheckoutSession({ telegramId: ctx.from.id, priceId });
        return ctx.reply("💳 Clique para pagar:", {
          reply_markup: {
            inline_keyboard: [[{ text: "Pagar Agora", url: session.url }]],
          },
        });
      } catch (err) {
        console.error("Erro ao criar checkout:", err.message);
        return ctx.reply("❌ Erro ao criar checkout. Tente novamente mais tarde.");
      }
    }

    if (data === "ajuda") {
      return ctx.reply("📘 *Ajuda*\nSe precisar, fale com @SeuAtendimento", { parse_mode: "Markdown" });
    }

    return ctx.reply("❌ Opção inválida.");
  });

  // Exemplo comando protegido
  bot.command("conteudo", (ctx) => {
    if (!isSubscriber(String(ctx.from.id))) {
      return ctx.reply("❌ Este conteúdo é só para assinantes. Use /planos para assinar.");
    }
    return ctx.reply("🔒 Aqui está o conteúdo exclusivo!");
  });

  // Expor funções úteis no bot object para uso pelo server.js
  bot.context.appHelpers = {
    grantAccess,
    revokeAccess,
    isSubscriber,
    getSubscriber,
    getAllSubscribers,
    createCheckoutSession,
  };

  // Atachar também diretamente
  bot.grantAccess = grantAccess;
  bot.revokeAccess = revokeAccess;
  bot.isSubscriber = isSubscriber;
  bot.getSubscriber = getSubscriber;
  bot.getAllSubscribers = getAllSubscribers;
  bot.createCheckoutSession = createCheckoutSession;

  return bot;
}

// Export utilitário para inicializar o data file se quiser rodar separado
export async function initDataFile() {
  await ensureDataFile();
}

// Export helpers para dev
export { addSubscriberObj as __addSubscriberForDev, removeSubscriberObj as __removeSubscriberForDev };
