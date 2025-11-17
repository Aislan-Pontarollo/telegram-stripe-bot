import express from "express";
import Stripe from "stripe";
import { Telegraf } from "telegraf";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const bot = new Telegraf(process.env.TOKEN_TELEGRAM);

// ======================================================
// RAW BODY APENAS PARA O WEBHOOK STRIPE
// ======================================================
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// ======================================================
// INICIALIZAR bot.botInfo SEM TRAVAR O PROCESSO
// ======================================================
bot.telegram.getMe().then(info => {
  bot.botInfo = info;
  console.log("Bot info carregado:", info.username);
}).catch(err => {
  console.error("Erro ao carregar botInfo:", err);
});

// ======================================================
// FUNÇÃO SEGURA PARA ENVIAR MÍDIA SEM TRAVAR O BOT
// ======================================================
async function safeSend(ctx, fn, payload, extra = {}) {
  try {
    await fn(payload, extra);
  } catch (err) {
    console.log("⚠️ Erro ao enviar mídia, mas o bot continua rodando:", err.message);
  }
}

// ======================================================
// BOT /start
// ======================================================
bot.start(async (ctx) => {
  const chatId = ctx.chat.id;

  // IMAGEM ---------------------------------------------------
  await safeSend(
    ctx,
    ctx.replyWithPhoto.bind(ctx),
    { url: "https://MEU-LINK.com/imagem.jpg" },   // ← coloque um link real
    { caption: "🤖 Bem-vindo ao BOTVIP.CO!" }
  );

  // ÁUDIO ----------------------------------------------------
  await safeSend(
    ctx,
    ctx.replyWithAudio.bind(ctx),
    { url: "https://MEU-LINK.com/audio.mp3" }     // ← coloque um link real
  );

  // TEXTO ----------------------------------------------------
  try {
    await ctx.reply(
      "👋 Bem-vindo ao *BOTVIP.CO!*\n\n" +
      "Aqui você encontra ferramentas exclusivas:\n" +
      "💎 Recursos premium\n" +
      "⚡ Automação avançada\n" +
      "🚀 Suporte especializado\n\n" +
      "Escolha seu plano de assinatura:",
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.log("Erro ao enviar texto: ", err.message);
  }

  // BOTÕES ---------------------------------------------------
  try {
    await ctx.reply("Selecione um plano:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Plano Semanal", callback_data: "plano1" }],
          [{ text: "Plano Mensal", callback_data: "plano2" }],
          [{ text: "Plano Vitalício", callback_data: "plano3" }]
        ]
      }
    });
  } catch(err) {
    console.log("Erro ao enviar botões:", err.message);
  }
});

// ======================================================
// FUNÇÃO PARA CRIAR CHECKOUT DO STRIPE
// ======================================================
async function criarCheckout(priceId, telegramId) {
  return await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    subscription_data: {
      metadata: {
        telegram_id: telegramId,
      }
    },
    success_url: `https://t.me/${bot.botInfo?.username}?start=sucesso`,
    cancel_url: `https://t.me/${bot.botInfo?.username}?start=cancelado`,
  });
}

// ======================================================
// CALLBACK DOS BOTÕES
// ======================================================
bot.on("callback_query", async (ctx) => {
  await ctx.answerCbQuery();

  const escolha = ctx.callbackQuery.data;
  const telegramId = ctx.from.id;

  const planos = {
    plano1: process.env.PLANO_1,
    plano2: process.env.PLANO_2,
    plano3: process.env.PLANO_3,
  };

  const priceId = planos[escolha];

  if (!priceId) {
    return ctx.reply("Erro ao localizar o plano selecionado.");
  }

  try {
    const session = await criarCheckout(priceId, telegramId);
    await ctx.reply(`Clique no link abaixo para assinar:\n${session.url}`);
  } catch (err) {
    ctx.reply("❌ Erro ao criar sessão de pagamento. Tente novamente.");
    console.error(err);
  }
});

// ======================================================
// WEBHOOK STRIPE
// ======================================================
app.post("/webhook", (req, res) => {
  let event;
  const signature = req.headers["stripe-signature"];

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Erro ao validar webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // CHECKOUT COMPLETO ---------------------------------------
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const telegramId = session?.metadata?.telegram_id;

    if (telegramId) {
      bot.telegram.sendMessage(
        telegramId,
        "✔️ Checkout concluído! Seu pagamento está sendo processado."
      );
    }
  }

  // PAGAMENTO CONFIRMADO ------------------------------------
  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object;
    const telegramId = invoice?.metadata?.telegram_id;

    if (telegramId) {
      bot.telegram.sendMessage(
        telegramId,
        "🎉 Pagamento confirmado! Sua assinatura foi ativada com sucesso."
      );
    }
  }

  res.status(200).send("OK");
});

// ======================================================
// INICIAR BOT + SERVIDOR
// ======================================================
bot.launch().then(() => {
  console.log("🤖 Bot Telegram iniciado!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
