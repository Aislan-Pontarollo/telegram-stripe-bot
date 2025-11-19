// bot.js
import { Telegraf } from "telegraf";
import fs from "fs";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export function createBot() {
  const bot = new Telegraf(process.env.TOKEN_TELEGRAM);

  async function safeSendMedia(ctx, sendFunc, filePath, extra = {}) {
    try {
      if (!fs.existsSync(filePath)) throw new Error("Arquivo não encontrado");
      await sendFunc({ source: filePath }, extra);
    } catch (err) {
      console.log(`⚠️ Falha ao enviar mídia (${filePath}):`, err.message);
    }
  }

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
      "👋 Bem-vindo ao *BOTVIP.CO!*",
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

  bot.on("callback_query", async (ctx) => {
    const data = ctx.callbackQuery.data;
    await ctx.answerCbQuery();

    // ==============================
    // PAGAMENTOS STRIPE
    // ==============================
    const planos = {
      plano1: process.env.PLANO_1,
      plano2: process.env.PLANO_2,
      plano3: process.env.PLANO_3,
    };

    if (planos[data]) {
      try {
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          line_items: [
            {
              price: planos[data],
              quantity: 1,
            },
          ],
          success_url: "https://botvip.co/sucesso",
          cancel_url: "https://botvip.co/cancelado",
        });

        return ctx.reply(
          "💳 Clique no botão abaixo para realizar o pagamento:",
          {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: "💰 Finalizar Pagamento",
                    url: session.url,
                  },
                ],
              ],
            },
          }
        );
      } catch (err) {
        console.error("Erro Stripe:", err);
        return ctx.reply("❌ Erro ao criar checkout.");
      }
    }

    // ==============================
    // MENUS NORMAIS
    // ==============================
    const menus = {
      ver_planos: "💳 Escolha seu plano:",
      ajuda: "❓ Central de Ajuda.\nUse /help para ver comandos.",
      suporte: "🛠 Suporte oficial: @SeuAtendimento",
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
                  [{ text: "🚀 Plano Vitalício", callback_data: "plano3" }],
                ],
              }
            : undefined,
      });
    }

    return ctx.reply("❌ Opção desconhecida!");
  });

  return bot;
}
