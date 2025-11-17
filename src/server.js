import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createBot } from "./bot.js";

const app = express();

// ============== INICIA O BOT ==============
const bot = createBot();

bot.launch()
  .then(() => console.log("🤖 Bot Telegram iniciado com sucesso!"))
  .catch((err) => console.error("❌ Erro ao iniciar bot:", err));

// ============== EVITA DERRUBAR NO RAILWAY ==============
app.get("/", (req, res) => {
  res.send("Bot ativo e rodando!");
});

// ============== INICIA SERVIDOR EXPRESS ==============
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

// ============== CAPTURA SINAIS DO RAILWAY ==============
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
