// server.js
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import { createBot } from "./bot.js";

const app = express();
const bot = createBot();

bot.launch()
  .then(() => console.log("🤖 Bot Telegram iniciado com sucesso!"))
  .catch((err) => console.error("❌ Erro ao iniciar bot:", err));

app.get("/", (req, res) => {
  res.send("Bot ativo e rodando!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
