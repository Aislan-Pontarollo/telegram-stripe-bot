import dotenv from "dotenv";
dotenv.config();

import express from "express";
import Stripe from "stripe";
import { createBot } from "./bot.js";

const app = express();

// Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.WEBHOOK_SECRET;

// Telegram Bot
const bot = createBot();

// Impede o Telegram de cair no Railway
app.get("/", (req, res) => {
  res.send("Bot ativo!");
});

// ============================
// WEBHOOK DO STRIPE (OBRIGATÓRIO)
// ============================
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
        endpointSecret
      );
    } catch (err) {
      console.log("❌ Webhook Error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Eventos Stripe
    if (event.type === "checkout.session.completed") {
      console.log("💰 Pagamento aprovado!");
    }

    res.sendStatus(200);
  }
);

// Lança o bot
bot.launch()
  .then(() => console.log("🤖 Bot Telegram iniciado!"))
  .catch((err) => console.error("❌ Erro ao iniciar bot:", err));

// ============================
// Servidor Express
// ============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Servidor rodando na porta ${PORT}`)
);

// Finalizar no Railway
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
