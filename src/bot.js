import { Telegraf } from "telegraf";
import fs from "fs";

export function createBot() {
  const bot = new Telegraf(process.env.TOKEN_TELEGRAM);

  // ==========================
  // Função anti-crash para mídia
  // ==========================
  async function safeSendMedia(ctx, sendFunc, filePath, extra = {}) {
    try {
      if (!fs.existsSync(filePath)) throw new Error("Arquivo não encontrado");
      await sendFunc({ source: filePath }, extra);
    } catch (err) {
      console.log(`⚠️ Falha ao enviar mídia (${filePath}). Motivo:`, err.message);
    }
  }

  // ==========================
  // /start
  // ==========================
  bot.start(async (ctx) => {
    await ctx.reply("⏳ Carregando...");

    await safeSendMedia(
      ctx,
      ctx.replyWithPhoto.bind(ctx),
      "./assets/im.jpg",
      { caption: "🤖 Bem-vindo ao BOTVIP.CO!" }
    );

    await safeSendMedia(
      ctx,
      ctx.replyWithAudio.bind(ctx),
      "./assets/audio.mp3"
    );

    await ctx.reply(
      "👋 Bem-vindo ao *BOTVIP.CO!*\n\n" +
      "Aqui você encontra ferramentas premium, automações e recursos exclusivos.\n\n" +
      "Escolha o que deseja fazer:",
      { parse_mode: "Markdown" }
    );

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

  // ==========================
  // /help
  // ==========================
  bot.command("help", (ctx) => {
    ctx.reply(
      "📘 *Ajuda - BOTVIP.CO*\n\n" +
      "Comandos disponíveis:\n" +
      "• /start — Menu principal\n" +
      "• /planos — Ver planos\n" +
      "• /suporte — Contato suporte\n",
      { parse_mode: "Markdown" }
    );
  });

  // ==========================
  // /planos
  // ==========================
  bot.command("planos", (ctx) => {
    ctx.reply("💳 *Nossos Planos de Assinatura:*", {
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

  // ==========================
  // /suporte
  // ==========================
  bot.command("suporte", (ctx) => {
    ctx.reply(
      "🛠 *Suporte BOTVIP.CO*\n\n" +
      "• Telegram: @SeuAtendimento\n" +
      "• Email: suporte@botvip.co\n" +
      "• Horário: 09h às 18h\n",
      { parse_mode: "Markdown" }
    );
  });

  // ==========================
  // CALLBACKS
  // ==========================
  bot.on("callback_query", async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCbQuery();

    const menus = {
      ver_planos: "💳 Escolha seu plano:",
      ajuda: "❓ *Central de Ajuda*\nUse /help para ver comandos.",
      suporte: "🛠 Suporte oficial: @SeuAtendimento"
    };

    if (menus[data]) {
      return ctx.reply(menus[data], {
        parse_mode: "Markdown",
        reply_markup:
          data === "ver_planos"
            ? {
                inline_keyboard: [
                  [{ text: "💎 Plano Semanal", callback_data: "plano1" }],
                  [{ text: "🔥 Plano Mensal", callback_data: "plano2" }],
                  [{ text: "🚀 Plano Vitalício", callback_data: "plano3" }]
                ]
              }
            : undefined
      });
    }

    return ctx.reply("❌ Opção desconhecida!");
  });

  return bot;
}
