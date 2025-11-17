import express from "express";
import dotenv from "dotenv";
import Stripe from "stripe";
import { createBot } from "./bot.js";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Bot
const bot = createBot();
bot.launch().then(() => {
  console.log("🤖 Bot Telegram iniciado!");
});

// MIDDLEWARE RAW para webhook do Stripe
app.use(
  "/webhook",
  express.raw({ type: "application/json" })
);

// Para outras rotas
app.use(express.json());

// WEBHOOK STRIPE
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
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Evento 1 – Checkout concluído
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

  // Evento 2 – Pagamento aprovado
  if (event.type === "invoice.payment_succeeded") {
    const invoice = event.data.object;
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

// SERVIDOR WEB
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
