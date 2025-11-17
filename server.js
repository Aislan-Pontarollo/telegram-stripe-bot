import express from "express";
import Stripe from "stripe";
import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const bot = new Telegraf(process.env.TOKEN_TELEGRAM);

// ======================================================
// RAW BODY PARA O WEBHOOK DO STRIPE
// ======================================================
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// ======================================================
// INICIALIZAR bot.botInfo SEM TRAVAR
// ======================================================
bot.telegram.getMe().then(info => {
  bot.botInfo = info;
  console.log("Bot carregado como:", info.username);
}).catch(err => {
  console.error("Erro ao pegar botInfo:", err);
});

// ======================================================
// FUNÇÃO PARA ENVIAR MÍDIA/MSG SEM TRAVAR O BOT
// ======================================================
async function safeSend(ctx, method, payload, extra = {}) {
  try {
    await method(payload, extra);
  } catch (err) {
    console.log("⚠️ Erro ao enviar mídia (ignorado):", err.message);
  }
}

// ======================================================
// BOT /start
// ======================================================
bot.start(async (ctx) => {
  const audioPath = path.resolve("assets/audio.mp3"); // arquivo local

  // Envia imagem (URL pública)
  await safeSend(
    ctx,
    ctx.replyWithPhoto.bind(ctx),
    { url: "https://picsum.photos/400/300" }, // SUBSTITUA POR UMA URL REAL
    { caption: "🤖 Bem-vindo ao BOTVIP.CO!" }
  );

  // Envia áudio local como arquivo REAL
  await safeSend(
    ctx,
    ctx.replyWithAudio.bind(ctx),
    { source: fs.createReadStream(audioPath) }
  );

  // Envia texto de apresentação
  await safeSend(
    ctx,
    ctx.reply.bind(ctx),
    "👋 Bem-vindo ao *BOTVIP.CO!*\n\n" +
    "Aqui você encontra ferramentas exclusivas:\n" +
    "💎 Recursos premium\n" +
    "⚡ Automação avançada\n" +
    "🚀 Suporte especializado\n\n" +
    "Escolha seu plano de assinatura:",
    { parse_mode: "Markdown" }
  );

  // Envia botões
  await safeSend(
    ctx,
    ctx.reply.bind(ctx),
    "Selecione um plano:",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Plano Semanal", callback_data: "plano1" }],
          [{ text: "Plano Mensal", callback_data: "plano2" }],
          [{ text: "Plano Vitalício", callback_data: "plano3" }]
        ]
      }
    }
  );
});

// ======================================================
// FUNÇÃO PARA CRIAR CHECKOUT
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
// CALLBACK DOS PLANOS
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
    console.error("Erro ao criar checkout:", err);
    ctx.reply("❌ Erro ao criar pagamento. Tente novamente.");
  }
});

// ======================================================
// WEBHOOK DO STRIPE
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
    console.error("❌ Erro no webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Checkout finalizado
  if (event.type === "checkout.session.completed") {
    const data = event.data.object;
    const telegramId = data?.metadata?.telegram_id;

    if (telegramId) {
      bot.telegram.sendMessage(
        telegramId,
        "✔️ Checkout concluído! Seu pagamento está sendo processado."
      );
    }
  }

  // Pagamento confirmado
  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object;
    const telegramId = invoice?.metadata?.telegram_id;

    if (telegramId) {
      bot.telegram.sendMessage(
        telegramId,
        "🎉 Pagamento confirmado! Sua assinatura foi ativada!"
      );
    }
  }

  res.status(200).send("OK");
});

// ======================================================
// INICIAR BOT + SERVIDOR
// ======================================================
bot.launch().then(() => console.log("🤖 Bot Telegram iniciado!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
