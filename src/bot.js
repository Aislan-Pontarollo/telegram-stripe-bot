import { Telegraf } from "telegraf";
import fs from "fs";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ==============================
// FUNÇÃO PARA CRIAR O BOT
// ==============================
export function createBot() {
  const bot = new Telegraf(process.env.TOKEN_TELEGRAM);

  // ==============================
  // Função anti-crash mídia
  // ==============================
  async function safeSendMedia(ctx, sendFunc, filePath, extra = {}) {
    try {
      if (!fs.existsSync(filePath)) throw new Error("Arquivo não encontrado");
      await sendFunc({ source: filePath }, extra);
    } catch (err) {
      console.log(`⚠️ Falha ao enviar mídia (${filePath}):`, err.message);
    }
  }

  // ==============================
  // /start
  // ==============================
  bot.start(async (ctx) => {
    await ctx.reply("⏳ Carregando…");

    await safeSendMedia(
      ctx,
      ctx.replyWithPhoto.bind(ctx),
      "./assets/im.jpg",
      { caption: "🤖 *Bem-vindo ao BOTVIP.CO!*", parse_mode: "Markdown" }
    );

    await safeSendMedia(
      ctx,
      ctx.replyWithAudio.bind(ctx),
      "./assets/audio.mp3"
    );

    await ctx.reply(
      "👋 Bem-vindo ao *BOTVIP.CO!*\n" +
        "Aqui você encontra ferramentas premium e automatizações avançadas.\n\n" +
        "Escolha uma opção:",
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "💳 Ver Planos", callback_data: "ver_planos" }],
            [{ text: "❓ Ajuda", callback_data: "ajuda" }],
            [{ text: "🛠 Suporte", callback_data: "suporte" }],
          ],
        },
      }
    );
  });

  // ==============================
  // Comando /planos
  // ==============================
  bot.command("planos", (ctx) => {
    ctx.reply("💳 *Nossos Planos:*", {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "💎 Plano Semanal", callback_data: "plano1" }],
          [{ text: "🔥 Plano Mensal", callback_data: "plano2" }],
          [{ text: "🚀 Plano Vitalício", callback_data: "plano3" }],
        ],
      },
    });
  });

  // ==============================
  // Callback dos planos → GERA CHECKOUT
  // ==============================
  bot.on("callback_query", async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCbQuery();

    const PREÇOS = {
      plano1: process.env.PLANO_1,
      plano2: process.env.PLANO_2,
      plano3: process.env.PLANO_3,
    };

    if (PREÇOS[data]) {
      try {
        const checkout = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "subscription",
          line_items: [
            {
              price: PREÇOS[data],
              quantity: 1,
            },
          ],
          success_url: "https://t.me/" + process.env.BOT_USERNAME,
          cancel_url: "https://t.me/" + process.env.BOT_USERNAME,
        });

        return ctx.reply(
          "💳 Clique para finalizar o pagamento:",
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "Pagar Agora", url: checkout.url }],
              ],
            },
          }
        );
      } catch (err) {
        console.log("❌ Erro Stripe:", err);
        return ctx.reply("❌ Erro ao criar checkout. Tente novamente.");
      }
    }

    // Outros menus
    const menus = {
      ajuda: "📘 *Ajuda*\nUse /help para ver comandos.",
      suporte: "🛠 Suporte: @SeuAtendimento",
    };

    if (menus[data]) {
      return ctx.reply(menus[data], { parse_mode: "Markdown" });
    }

    ctx.reply("❌ Opção inválida.");
  });

  return bot;
}
