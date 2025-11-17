import express from "express";
import Stripe from "stripe";
import { Telegraf } from "telegraf";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const bot = new Telegraf(process.env.TOKEN_TELEGRAM);

// ======================================================
// MIDDLEWARE – RAW BODY APENAS PARA O WEBHOOK DO STRIPE
// ======================================================
app.use(
  "/webhook",
  express.raw({ type: "application/json" })
);

// Para todas as outras rotas → JSON normal
app.use(express.json());

// ======================================================
// INICIALIZAR bot.botInfo ANTES DE USAR
// ======================================================
await bot.telegram.getMe().then(info => {
  bot.botInfo = info;
});

// ======================================================
// BOT /start
// ======================================================
bot.start(async (ctx) => {
  try {
    // Enviar imagem (OPCIONAL, mas coloque um link real)
    await ctx.replyWithPhoto(
      { url: "https://placehold.co/600x400" },
      { caption: "🤖 Bem-vindo ao BOTVIP.CO!" }
    );

    // Enviar áudio (OPCIONAL)
    await ctx.replyWithAudio(
      { url: "https://www2.cs.uic.edu/~i101/SoundFiles/StarWars60.wav" }
    );

    // Mensagem de apresentação
    await ctx.reply(
      "👋 Bem-vindo ao *BOTVIP.CO!*\n\n" +
      "Aqui você encontra ferramentas exclusivas:\n" +
      "💎 Recursos premium\n" +
      "⚡ Automação avançada\n" +
      "🚀 Suporte especializado\n\n" +
      "Escolha seu plano de assinatura:",
      { parse_mode: "Markdown" }
    );

    // Botões dos planos
    await ctx.reply("Selecione um plano:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Plano Semanal", callback_data: "plano1" }],
          [{ text: "Plano Mensal", callback_data: "plano2" }],
          [{ text: "Plano Vitalício", callback_data: "plano3" }]
        ]
      }
    });

  } catch (err) {
    console.log("Erro ao enviar mensagens:", err);
  }
});

// ======================================================
// FUNÇÃO PARA CRIAR CHECKOUT (Corrigida)
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
    metadata: {
      telegram_id: telegramId,
    },
    subscription_data: {
      metadata: {
        telegram_id: telegramId,
      }
    },
    success_url: `https://t.me/${bot.botInfo.username}?start=sucesso`,
    cancel_url: `https://t.me/${bot.botInfo.username}?start=cancelado`,
  });
}

// ======================================================
// CALLBACK DO BOT (Planos)
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

  const session = await criarCheckout(priceId, telegramId);
  ctx.reply(`Clique no link abaixo para assinar:\n${session.url}`);
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
    console.error("❌ Erro ao validar webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 1️⃣ Checkout finalizado
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const telegramId = session.metadata?.telegram_id;

    if (telegramId) {
      bot.telegram.sendMessage(
        telegramId,
        "✔️ Checkout concluído! Seu pagamento está sendo processado."
      );
    }
  }

  // 2️⃣ Pagamento aprovado da assinatura
  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object;

    // metadata agora existe por causa da subscription_data
    const telegramId = invoice.metadata?.telegram_id;

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
