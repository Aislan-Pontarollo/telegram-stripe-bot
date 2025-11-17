import express from "express";
import Stripe from "stripe";
import dotenv from "dotenv";
import { createBot } from "./bot.js";

dotenv.config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const bot = createBot();

// RAW body para Stripe
app.use("/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// Inicializar botInfo (necessário para usar bot.botInfo.username)
await bot.telegram.getMe().then((info) => {
  bot.botInfo = info;
});

// Webhook Stripe (aqui você vai integrar depois com seus planos)
app.post("/webhook", (req, res) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.WEBHOOK_SECRET
    );
  } catch (err) {
    console.log("❌ Webhook inválido:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  res.sendStatus(200);
});

// Iniciar bot + servidor
bot.launch();
app.listen(process.env.PORT || 3000, () =>
  console.log("🚀 Servidor online")
);
