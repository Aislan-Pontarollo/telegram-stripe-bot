import { Telegraf } from "telegraf";
import fs from "fs";

export function createBot() {
  const bot = new Telegraf(process.env.TOKEN_TELEGRAM);

  // ====================================================
  // Função segura para enviar mídia (sem travar o bot)
  // ====================================================
  async function safeSend(ctx, handler, content, extra = {}) {
    try {
      await handler(content, extra);
    } catch (err) {
      console.log("⚠️ Falha ao enviar mídia (imagem/áudio). Continuando...");
    }
  }

  // ====================================================
  // /start — Menu profissional
  // ====================================================
  bot.start(async (ctx) => {
    await ctx.reply("⏳ Carregando...");

    // ---- PHOTO ----
    await safeSend(
      ctx,
      ctx.replyWithPhoto.bind(ctx),
      { source: "./assets/im.jpg" },
      { caption: "🤖 Bem-vindo ao BOTVIP.CO!" }
    );

    // ---- AUDIO ----
    await safeSend(
      ctx,
      ctx.replyWithAudio.bind(ctx),
      { source: "./assets/audio.mp3" }
    );

    // ---- Mensagem principal ----
    await ctx.reply(
      "👋 Bem-vindo ao *BOTVIP.CO!*\n\n" +
      "Aqui você encontra ferramentas premium, automações e recursos exclusivos.\n\n" +
      "Escolha o que deseja fazer:",
      { parse_mode: "Markdown" }
    );

    // ---- Menu principal ----
    await ctx.reply("📌 Menu principal:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💳 Ver Planos", callback_data: "ver_planos" }],
          [{ text: "❓ Ajuda", callback_data: "ajuda" }],
          [{ text: "🛠 Suporte", callback_data: "suporte" }]
        ]
      }
    });
  });

  // ====================================================
  // /help — Ajuda simples e profissional
  // ====================================================
  bot.command("help", (ctx) => {
    ctx.reply(
      "📘 *Ajuda - BOTVIP.CO*\n\n" +
      "Comandos disponíveis:\n" +
      "• /start — Menu principal\n" +
      "• /planos — Ver planos de assinatura\n" +
      "• /suporte — Contato com o suporte\n\n" +
      "Se precisar, só chamar! 😊",
      { parse_mode: "Markdown" }
    );
  });

  // ====================================================
  // /planos — botão rápido da lista de planos
  // ====================================================
  bot.command("planos", (ctx) => {
    ctx.reply("💳 *Nossos Planos de Assinatura:*\n\n", {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💎 Plano Semanal", callback_data: "plano1" }],
          [{ text: "🔥 Plano Mensal", callback_data: "plano2" }],
          [{ text: "🚀 Plano Vitalício", callback_data: "plano3" }]
        ]
      }
    });
  });

  // ====================================================
  // /suporte — contato profissional
  // ====================================================
  bot.command("suporte", (ctx) => {
    ctx.reply(
      "🛠 *Suporte BOTVIP.CO*\n\n" +
      "• Telegram: @SeuAtendimento\n" +
      "• Email: suporte@botvip.co\n" +
      "• Horário: 09h às 18h\n\n" +
      "Estamos à disposição! 😊",
      { parse_mode: "Markdown" }
    );
  });

  // ====================================================
  // CALLBACKS do menu principal
  // ====================================================
  bot.on("callback_query", async (ctx) => {
    const data = ctx.callbackQuery.data;

    await ctx.answerCbQuery(); // remove "loading..."

    if (data === "ver_planos") {
      return ctx.reply("💳 Escolha seu plano:", {
        reply_markup: {
          inline_keyboard: [
            [{ text: "💎 Plano Semanal", callback_data: "plano1" }],
            [{ text: "🔥 Plano Mensal", callback_data: "plano2" }],
            [{ text: "🚀 Plano Vitalício", callback_data: "plano3" }]
          ]
        }
      });
    }

    if (data === "ajuda") {
      return ctx.reply(
        "❓ *Central de Ajuda*\nUse /help para ver todos os comandos.",
        { parse_mode: "Markdown" }
      );
    }

    if (data === "suporte") {
      return ctx.reply(
        "🛠 Suporte oficial: @SeuAtendimento\nResponderemos o mais rápido possível!"
      );
    }
  });

  return bot;
}
