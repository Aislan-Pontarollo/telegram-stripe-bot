// src/server.js
import express from "express";
import Stripe from "stripe";
import { createBot } from "./bot.js";

// ---- Config / ENV ----
// Espera-se que seu .env tenha:
// WEBHOOK_URL            -> domínio público (sem slash final preferível)
// WEBHOOK_SECRET         -> secret do endpoint do Stripe (assinatura)
// TOKEN_TELEGRAM         -> token do bot Telegram
// TELEGRAM_WEBHOOK_PATH  -> caminho do webhook para Telegram (ex: /bot-webhook) (opcional)
// LOGS_CHAT_ID           -> chat ID para logs (opcional)
// PORT                   -> porta (Railway define automaticamente)

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || "";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ""; // seu .env tinha WEBHOOK_SECRET
const TELEGRAM_TOKEN = process.env.TOKEN_TELEGRAM || "";
const TELEGRAM_WEBHOOK_PATH = process.env.TELEGRAM_WEBHOOK_PATH || "/bot-webhook";
const LOGS_CHAT_ID = process.env.LOGS_CHAT_ID || null;

if (!STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY não está configurado no .env");
  process.exit(1);
}
if (!STRIPE_WEBHOOK_SECRET) {
  console.warn("⚠️ STRIPE webhook secret (WEBHOOK_SECRET) não configurado. Webhook signature verification ficará inativa.");
}
if (!TELEGRAM_TOKEN) {
  console.error("❌ TOKEN_TELEGRAM não está configurado no .env");
  process.exit(1);
}
if (!WEBHOOK_URL) {
  console.warn("⚠️ WEBHOOK_URL não configurado. Certifique-se de setar WEBHOOK_URL no .env para registrar webhook do Telegram.");
}

// ---- Init libs ----
const stripe = new Stripe(STRIPE_SECRET_KEY);
const app = express();

// ---- Create bot instance (from src/bot.js) ----
const bot = createBot();

// ---- Utility: safe join URL (avoid //) ----
function joinUrl(base, path) {
  if (!base) return path;
  const b = base.replace(/\/+$/, ""); // remove trailing slashes
  const p = path.startsWith("/") ? path : "/" + path;
  return b + p;
}

// ------------------------
// 1) STRIPE WEBHOOK ROUTE
//    (must use raw body for signature verification)
// ------------------------
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    // Verify signature when secret available
    if (STRIPE_WEBHOOK_SECRET) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        console.error("❌ Webhook signature verification failed:", err.message);
        // Inform Stripe it's a bad request
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }
    } else {
      // If no secret provided, try to parse body (less secure)
      try {
        event = JSON.parse(req.body.toString("utf8"));
        console.warn("⚠️ Webhook received but signature verification is disabled (no WEBHOOK_SECRET).");
      } catch (err) {
        console.error("❌ Failed to parse webhook body:", err.message);
        return res.status(400).send("Invalid webhook body");
      }
    }

    // Process events
    try {
      const type = event.type;
      console.log("🔔 Stripe event received:", type);

      switch (type) {
        // -------------------------
        // 1) Checkout session completed (primeira compra)
        // -------------------------
        case "checkout.session.completed": {
          const session = event.data.object;

          // Prefer client_reference_id (enviado pelo checkout)
          const telegramId = session.client_reference_id || session.metadata?.telegram_id || null;
          const customerId = session.customer || null;
          const subscriptionId = session.subscription || null;

          // Try to get price id from metadata
          const priceId = session.metadata?.price_id || null;

          // If subscription exists, fetch details to get current_period_end
          let current_period_end = null;
          if (subscriptionId) {
            try {
              const sub = await stripe.subscriptions.retrieve(subscriptionId);
              if (sub && sub.current_period_end) current_period_end = sub.current_period_end;
            } catch (err) {
              console.warn("⚠️ Não foi possível recuperar subscription info:", err.message);
            }
          }

          if (telegramId) {
            console.log(`✅ checkout.session.completed -> granting access to ${telegramId}`);
            try {
              await bot.grantAccess(telegramId, {
                stripeCustomerId: customerId,
                subscriptionId,
                priceId,
                current_period_end,
              });
              // optional log to logs chat
              if (LOGS_CHAT_ID) {
                try {
                  await bot.telegram.sendMessage(
                    LOGS_CHAT_ID,
                    `✅ checkout.session.completed: user=${telegramId} customer=${customerId} subscription=${subscriptionId} price=${priceId}`
                  );
                } catch (_) {}
              }
            } catch (err) {
              console.error("❌ Erro ao conceder acesso (checkout.session.completed):", err.message);
            }
          } else {
            console.warn("⚠️ checkout.session.completed sem telegramId (client_reference_id/metadata). Salve manualmente.");
            if (LOGS_CHAT_ID) {
              try {
                await bot.telegram.sendMessage(
                  LOGS_CHAT_ID,
                  `⚠️ checkout.session.completed sem telegramId. session_id=${session.id}, customer=${customerId}`
                );
              } catch (_) {}
            }
          }
          break;
        }

        // -------------------------
        // 2) Invoice paid -> renovação bem-sucedida
        // -------------------------
        case "invoice.payment_succeeded": {
          const invoice = event.data.object;

          // invoice.subscription contém id da subscription
          const subscriptionId = invoice.subscription || null;

          if (!subscriptionId) {
            console.log("ℹ️ invoice.payment_succeeded sem subscription. Ignorando.");
            break;
          }

          // fetch subscription to get details (customer, period end, metadata)
          let sub;
          try {
            sub = await stripe.subscriptions.retrieve(subscriptionId);
          } catch (err) {
            console.error("❌ Falha ao recuperar subscription (invoice.payment_succeeded):", err.message);
            break;
          }

          const customerId = sub.customer || null;
          const current_period_end = sub.current_period_end || null;
          const priceId = sub.items?.data?.[0]?.price?.id || null;

          // Try to find telegramId from invoice metadata or subscription metadata
          let telegramId = invoice.metadata?.telegram_id || sub.metadata?.telegram_id || null;

          // If still not found, search local DB by stripeCustomerId
          if (!telegramId) {
            const all = bot.getAllSubscribers ? bot.getAllSubscribers() : {};
            for (const key in all) {
              if (all[key] && all[key].stripeCustomerId === customerId) {
                telegramId = key;
                break;
              }
            }
          }

          if (telegramId) {
            console.log(`🔄 invoice.payment_succeeded -> renew/grant for ${telegramId}`);
            try {
              await bot.grantAccess(telegramId, {
                stripeCustomerId: customerId,
                subscriptionId: subscriptionId,
                priceId,
                current_period_end,
              });
              if (LOGS_CHAT_ID) {
                try {
                  await bot.telegram.sendMessage(LOGS_CHAT_ID, `🔄 invoice.payment_succeeded: user=${telegramId} subscription=${subscriptionId} price=${priceId}`);
                } catch (_) {}
              }
            } catch (err) {
              console.error("❌ Erro ao processar invoice.payment_succeeded:", err.message);
            }
          } else {
            console.warn("⚠️ invoice.payment_succeeded não encontrou telegramId no DB.");
            if (LOGS_CHAT_ID) {
              try {
                await bot.telegram.sendMessage(LOGS_CHAT_ID, `⚠️ invoice.payment_succeeded sem telegramId. subscription=${subscriptionId}`);
              } catch (_) {}
            }
          }
          break;
        }

        // -------------------------
        // 3) Invoice payment failed
        // -------------------------
        case "invoice.payment_failed": {
          const invoice = event.data.object;
          const subscriptionId = invoice.subscription || null;
          if (!subscriptionId) break;

          // fetch subscription to get customer
          let sub;
          try {
            sub = await stripe.subscriptions.retrieve(subscriptionId);
          } catch (err) {
            console.error("❌ Falha ao recuperar subscription (invoice.payment_failed):", err.message);
            break;
          }

          const customerId = sub.customer || null;

          // search local DB by customerId
          const all = bot.getAllSubscribers ? bot.getAllSubscribers() : {};
          let telegramId = null;
          for (const key in all) {
            if (all[key] && all[key].stripeCustomerId === customerId) {
              telegramId = key;
              break;
            }
          }

          if (telegramId) {
            try {
              await bot.telegram.sendMessage(
                telegramId,
                "⚠️ Seu pagamento falhou. Atualize seu método de pagamento no Stripe para não perder o acesso."
              );
              if (LOGS_CHAT_ID) {
                try {
                  await bot.telegram.sendMessage(LOGS_CHAT_ID, `⚠️ invoice.payment_failed: user=${telegramId} subscription=${subscriptionId}`);
                } catch (_) {}
              }
            } catch (err) {
              console.warn("⚠️ Falha ao notificar usuário sobre pagamento falhado:", err.message);
            }
          } else {
            console.warn("⚠️ invoice.payment_failed: não encontrou telegramId para customer:", customerId);
            if (LOGS_CHAT_ID) {
              try {
                await bot.telegram.sendMessage(LOGS_CHAT_ID, `⚠️ invoice.payment_failed sem telegramId. customer=${customerId}`);
              } catch (_) {}
            }
          }
          break;
        }

        // -------------------------
        // 4) Subscription deleted (cancelamento)
        // -------------------------
        case "customer.subscription.deleted": {
          const subObj = event.data.object;
          const customerId = subObj.customer || null;

          // search local DB
          const all = bot.getAllSubscribers ? bot.getAllSubscribers() : {};
          let targetTelegramId = null;
          for (const key in all) {
            if (all[key] && all[key].stripeCustomerId === customerId) {
              targetTelegramId = key;
              break;
            }
          }

          if (targetTelegramId) {
            console.log(`❌ customer.subscription.deleted -> revoking access for ${targetTelegramId}`);
            try {
              await bot.revokeAccess(targetTelegramId);
              if (LOGS_CHAT_ID) {
                try {
                  await bot.telegram.sendMessage(LOGS_CHAT_ID, `❌ customer.subscription.deleted: user=${targetTelegramId} customer=${customerId}`);
                } catch (_) {}
              }
            } catch (err) {
              console.error("❌ Erro ao revogar acesso (customer.subscription.deleted):", err.message);
            }
          } else {
            console.warn("⚠️ customer.subscription.deleted: não encontrou telegramId para customer:", customerId);
            if (LOGS_CHAT_ID) {
              try {
                await bot.telegram.sendMessage(LOGS_CHAT_ID, `⚠️ customer.subscription.deleted sem telegramId. customer=${customerId}`);
              } catch (_) {}
            }
          }
          break;
        }

        // -------------------------
        // Default: log unknown event
        // -------------------------
        default: {
          console.log("ℹ️ Evento Stripe recebido e não tratado especificamente:", event.type);
          // opcional: log para LOGS_CHAT_ID
          if (LOGS_CHAT_ID) {
            try {
              await bot.telegram.sendMessage(LOGS_CHAT_ID, `🔔 Stripe event: ${event.type}`);
            } catch (_) {}
          }
        }
      }

      // Acknowledge receipt
      return res.status(200).json({ received: true });
    } catch (err) {
      console.error("❌ Erro ao processar evento Stripe:", err);
      return res.status(500).send("Webhook handler failed.");
    }
  }
);

// ------------------------
// 2) JSON parser para demais rotas (após /webhook raw handler)
// ------------------------
app.use(express.json());

// ------------------------
// 3) TELEGRAM WEBHOOK ROUTE
//    Recebe updates do Telegram (registered via setWebhook)
// ------------------------
app.post(TELEGRAM_WEBHOOK_PATH, (req, res) => {
  try {
    // Passa o update para o Telegraf
    bot.handleUpdate(req.body);
    return res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Erro ao processar update do Telegram:", err);
    return res.status(500).send("Error");
  }
});

// ------------------------
// 4) Root (basic health check)
// ------------------------
app.get("/", (req, res) => {
  res.send("OK - Bot server is running");
});

// ------------------------
// 5) Start server and register Telegram webhook
// ------------------------
app.listen(PORT, async () => {
  console.log(`🚀 Server listening on port ${PORT}`);

  // Register Telegram webhook URL (if WEBHOOK_URL provided)
  try {
    if (!WEBHOOK_URL) {
      console.warn("⚠️ WEBHOOK_URL não definido; pulei registro automático do webhook do Telegram.");
    } else {
      const webhookUrl = joinUrl(WEBHOOK_URL, TELEGRAM_WEBHOOK_PATH);
      await bot.telegram.setWebhook(webhookUrl);
      console.log("🤖 Telegram webhook set to:", webhookUrl);
      if (LOGS_CHAT_ID) {
        try {
          await bot.telegram.sendMessage(LOGS_CHAT_ID, `🚀 Server started. Telegram webhook set to ${webhookUrl}`);
        } catch (_) {}
      }
    }
  } catch (err) {
    console.error("❌ Falha ao setar webhook do Telegram:", err.message);
    if (LOGS_CHAT_ID) {
      try {
        await bot.telegram.sendMessage(LOGS_CHAT_ID, `❌ Falha ao setar webhook do Telegram: ${err.message}`);
      } catch (_) {}
    }
  }
});
