import express from "express";
import Stripe from "stripe";
import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import bodyParser from "body-parser";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const bot = new Telegraf(process.env.TOKEN_TELEGRAM);

// Permitir JSON
app.use(express.json());

// ====== BOT COMANDO /start ======
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

// Criar sessão de checkout Stripe
async function criarCheckout(preco, userId) {
  return await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: preco, quantity: 1 }],
    success_url: `https://t.me/${bot.botInfo.username}?start=sucesso`,
    cancel_url: `https://t.me/${bot.botInfo.username}?start=cancelado`,
    metadata: { telegram_id: userId }
  });
}

// ======= CALLBACK DOS BOTÕES =======
bot.on("callback_query", async (ctx) => {
  const escolha = ctx.callbackQuery.data;
  const userId = ctx.from.id;

  const planos = {
    plano1: process.env.PLANO_1,
    plano2: process.env.PLANO_2,
    plano3: process.env.PLANO_3
  };

  const price = planos[escolha];

  if (!price)
    return ctx.reply("Erro ao localizar o plano.");

  const session = await criarCheckout(price, userId);

  ctx.reply(`Clique para assinar:\n${session.url}`);
});

// ====== WEBHOOK STRIPE ======
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.WEBHOOK_SECRET
      );
    } catch (err) {
      console.log("Webhook signature error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Evento de pagamento concluído
    if (event.type === "checkout.session.completed") {
      const data = event.data.object;
      const telegramId = data.metadata.telegram_id;

      bot.telegram.sendMessage(
        telegramId,
        "🎉 Pagamento confirmado! Sua assinatura está ativa."
      );
    }

    res.status(200).send("OK");
  }
);

// Iniciar BOT
bot.launch();
console.log("Bot Telegram iniciado!");

// Iniciar server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Servidor rodando na porta " + PORT));
