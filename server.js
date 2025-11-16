import express from "express";
import Stripe from "stripe";
import { Telegraf } from "telegraf";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const bot = new Telegraf(process.env.TOKEN_TELEGRAM);

// Necessário para o webhook Stripe
app.use(
  "/webhook",
  express.raw({ type: "application/json" })
);

// JSON normal para as outras rotas
app.use(express.json());

// ===================== BOT =====================
bot.start(async (ctx) => {
  ctx.reply("Olá! 👋\nEscolha seu plano de assinatura:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Plano 1 💎", callback_data: "plano1" }],
        [{ text: "Plano 2 🔥", callback_data: "plano2" }],
        [{ text: "Plano 3 🚀", callback_data: "plano3" }]
      ]
    }
  });
});

// ================== CHECKOUT ====================
async function criarCheckout(priceId, telegramId) {
  return await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [
      {
        price: priceId,
        quantity: 1
      }
    ],
    success_url: `https://t.me/${bot.botInfo.username}?start=sucesso`,
    cancel_url: `https://t.me/${bot.botInfo.username}?start=cancelado`,
    metadata: {
      telegram_id: telegramId
    }
  });
}

// Botões dos planos
bot.on("callback_query", async (ctx) => {
  const escolha = ctx.callbackQuery.data;
  const telegramId = ctx.from.id;

  const planos = {
    plano1: process.env.PLANO_1,
    plano2: process.env.PLANO_2,
    plano3: process.env.PLANO_3
  };

  const priceId = planos[escolha];

  if (!priceId) return ctx.reply("Erro ao localizar o plano.");

  const session = await criarCheckout(priceId, telegramId);

  ctx.reply(`Clique para assinar:\n${session.url}`);
});

// ================== WEBHOOK =====================
app.post("/webhook", (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.WEBHOOK_SECRET
    );
  } catch (err) {
    console.log("Erro no webhook:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Evento real de finalização de assinatura
  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object;
    const telegramId = invoice.metadata?.telegram_id;

    if (telegramId) {
      bot.telegram.sendMessage(
        telegramId,
        "🎉 Pagamento confirmado! Sua assinatura está ativa."
      );
    }
  }

  // Caso a sessão do checkout finalize antes da invoice
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const telegramId = session.metadata?.telegram_id;

    if (telegramId) {
      bot.telegram.sendMessage(
        telegramId,
        "✔️ Checkout concluído! Estamos processando seu pagamento..."
      );
    }
  }

  res.status(200).send("OK");
});

// ================= SERVIDOR + BOT =================
bot.launch();
console.log("Bot Telegram iniciado!");

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Servidor rodando na porta " + PORT)
);
