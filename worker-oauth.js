/**
 * Email Summary Bot — Cloudflare Worker
<<<<<<< HEAD
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/') return new Response('Bot is running!');
    return new Response('Not Found', { status: 404 });
  }
};
=======
 * 
 * Handles:
 *  - /webhook       → Telegram bot updates (commands from users)
 *  - /oauth/login   → Redirect user to Google OAuth
 *  - /oauth/callback → Handle Google OAuth callback, store tokens in KV
 *  - /send          → Receive summaries from Zaro, forward to Telegram users
 *  - /register      → Set Telegram webhook
 * 
 * KV Namespaces needed:
 *  - USER_TOKENS   → Maps telegram_id → { access_token, refresh_token, expiry }
 *  - USER_STATE    → Maps telegram_id → { plan, plan_expiry, processed_ids }
 * 
 * Environment variables (secrets):
 *  - BOT_TOKEN      → Telegram bot token
 *  - GOOGLE_CLIENT_ID
 *  - GOOGLE_CLIENT_SECRET
 *  - OAUTH_REDIRECT_URI → e.g. https://your-worker.workers.dev/oauth/callback
 *  - ZARO_SECRET    → Secret for Zaro → Worker communication
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ──── CORS headers ────
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
    if (method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    // ──── GET / ────
    if (path === '/' && method === 'GET') {
      return new Response('🤖 Email Summary Bot Worker is running!', { status: 200 });
    }

    // ═══════════════════════════════════════════
    // OAUTH FLOW
    // ═══════════════════════════════════════════

    // ──── GET /oauth/login?user={telegram_id} ────
    if (path === '/oauth/login' && method === 'GET') {
      const telegramId = url.searchParams.get('user');
      if (!telegramId) {
        return new Response('Missing ?user= parameter', { status: 400 });
      }

      const state = encodeURIComponent(JSON.stringify({ t: telegramId, r: crypto.randomUUID() }));
      
      const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: env.OAUTH_REDIRECT_URI,
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
        state: state
      }).toString();

      return Response.redirect(authUrl, 302);
    }

    // ──── GET /oauth/callback?code=...&state=... ────
    if (path === '/oauth/callback' && method === 'GET') {
      const code = url.searchParams.get('code');
      const stateParam = url.searchParams.get('state');
      
      if (!code || !stateParam) {
        return new Response('Missing code or state', { status: 400 });
      }

      let state;
      try {
        state = JSON.parse(decodeURIComponent(stateParam));
      } catch {
        return new Response('Invalid state', { status: 400 });
      }

      const telegramId = state.t;

      // Exchange code for tokens
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: env.OAUTH_REDIRECT_URI,
          grant_type: 'authorization_code'
        }).toString()
      });

      if (!tokenResp.ok) {
        const err = await tokenResp.text();
        return new Response(`OAuth token exchange failed: ${err}`, { status: 500 });
      }

      const tokens = await tokenResp.json();

      // Get user's email
      const profileResp = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
        headers: { 'Authorization': `Bearer ${tokens.access_token}` }
      });
      const profile = await profileResp.json();

      // Store tokens in KV
      await env.USER_TOKENS.put(`token:${telegramId}`, JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry: Date.now() + (tokens.expires_in * 1000),
        email: profile.emailAddress
      }));

      // Notify user via Telegram
      const botMsgUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
      await fetch(botMsgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: telegramId,
          text: `✅ <b>Gmail Connected!</b>\n\n📧 ${profile.emailAddress}\n\nYour email summaries will start arriving soon!`,
          parse_mode: 'HTML'
        })
      });

      return new Response(
        '✅ Gmail connected! You can close this window and return to Telegram.',
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }

    // ═══════════════════════════════════════════
    // TELEGRAM WEBHOOK
    // ═══════════════════════════════════════════

    // ──── POST /webhook ────
    if (path === '/webhook' && method === 'POST') {
      try {
        const update = await request.json();

        if (update.message) {
          const msg = update.message;
          const chatId = msg.chat.id;
          const text = msg.text || '';
          const firstName = msg.chat.first_name || 'there';
          const username = msg.chat.username || '';

          // ── /start ──
          if (text.startsWith('/start')) {
            const userKey = `user:${chatId}`;
            let userData = await env.USER_STATE.get(userKey, { type: 'json' });
            
            if (!userData) {
              userData = {
                telegram_id: chatId,
                username: username,
                first_name: firstName,
                plan: 'none',
                plan_expiry: null,
                joined_at: new Date().toISOString()
              };
              await env.USER_STATE.put(userKey, JSON.stringify(userData));
            }

            await sendTelegram(env.BOT_TOKEN, chatId,
              `👋 <b>Welcome, ${firstName}!</b>\n\n` +
              `I'm your AI Email Summary Bot. I'll read your Gmail and send you smart summaries.\n\n` +
              `📋 <b>Commands:</b>\n` +
              `/connect — Connect your Gmail\n` +
              `/plans — View subscription plans\n` +
              `/status — Check your plan\n` +
              `/pay — Buy a plan with Telegram Stars\n` +
              `/help — Show all commands\n\n` +
              `Start with /connect to link your Gmail! 🔗`,
              'HTML'
            );
          }

          // ── /connect ──
          else if (text === '/connect') {
            const oauthUrl = `https://${url.hostname}/oauth/login?user=${chatId}`;
            
            await sendTelegram(env.BOT_TOKEN, chatId,
              `🔗 <b>Connect Your Gmail</b>\n\n` +
              `Click the link below to authorize access to your Gmail inbox:\n\n` +
              `<a href="${oauthUrl}">🔐 Authorize Gmail Access</a>\n\n` +
              `⚠️ This opens Google's login page. After authorizing, come back here and I'll start summarizing your emails!`,
              'HTML'
            );
          }

          // ── /plans ──
          else if (text === '/plans') {
            await sendTelegram(env.BOT_TOKEN, chatId,
              `⭐ <b>Subscription Plans</b>\n\n` +
              `🧪 <b>1-Day Test</b> — 1 ⭐\n` +
              `📅 <b>7-Day</b> — 50 ⭐\n` +
              `📅 <b>14-Day</b> — 100 ⭐\n` +
              `📅 <b>30-Day</b> — 200 ⭐\n\n` +
              `Use /pay {plan} to purchase, e.g. /pay test\n` +
              `All plans include AI-powered email summaries every minute!`,
              'HTML'
            );
          }

          // ── /pay {plan} ──
          else if (text.startsWith('/pay')) {
            const plan = text.split(' ')[1]?.toLowerCase();
            const plans = {
              test: { stars: 1, days: 1, label: '1-Day Test' },
              '7day': { stars: 50, days: 7, label: '7-Day' },
              '14day': { stars: 100, days: 14, label: '14-Day' },
              '30day': { stars: 200, days: 30, label: '30-Day' }
            };

            if (!plans[plan]) {
              await sendTelegram(env.BOT_TOKEN, chatId,
                `❌ Unknown plan. Use: /pay test, /pay 7day, /pay 14day, or /pay 30day`,
                'HTML'
              );
            } else {
              const p = plans[plan];
              const paymentId = crypto.randomUUID().slice(0, 8);
              const amount = p.stars;
              const label = `${p.label} — Email Summary Bot`;

              // Create invoice link using Telegram Bot API
              const invoiceUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/createInvoiceLink`;
              const invoiceResp = await fetch(invoiceUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  title: label,
                  description: `AI email summaries for ${p.days} day(s)`,
                  payload: `plan_${plan}_${chatId}_${paymentId}`,
                  currency: 'XTR',
                  prices: [{ label: label, amount: amount }],
                  provider_token: '',
                  max_tip_amount: 0,
                  suggested_tip_amounts: [],
                  start_parameter: `pay_${plan}`
                })
              });

              const invoiceData = await invoiceResp.json();

              if (invoiceData.ok) {
                // Store payment record in KV
                await env.USER_STATE.put(`payment:${paymentId}`, JSON.stringify({
                  payment_id: paymentId,
                  telegram_id: chatId,
                  plan: plan,
                  stars: amount,
                  days: p.days,
                  status: 'pending',
                  created_at: new Date().toISOString()
                }));

                await sendTelegram(env.BOT_TOKEN, chatId,
                  `⭐ <b>Pay ${amount} Star${amount > 1 ? 's' : ''} for ${p.label}</b>\n\n` +
                  `<a href="${invoiceData.result}">💳 Click here to pay</a>\n\n` +
                  `After payment, your plan activates automatically!\n` +
                  `Payment ID: <code>${paymentId}</code>`,
                  'HTML'
                );
              } else {
                await sendTelegram(env.BOT_TOKEN, chatId,
                  `❌ Could not create invoice. Error: ${JSON.stringify(invoiceData)}\n\nTry again or contact support.`,
                  'HTML'
                );
              }
            }
          }

          // ── /status ──
          else if (text === '/status') {
            const userKey = `user:${chatId}`;
            const userData = await env.USER_STATE.get(userKey, { type: 'json' });
            const tokenKey = `token:${chatId}`;
            const tokenData = await env.USER_STATE.get(tokenKey, { type: 'json' });
            
            const plan = userData?.plan || 'none';
            const expiry = userData?.plan_expiry 
              ? new Date(userData.plan_expiry).toLocaleDateString() 
              : 'N/A';
            const gmail = tokenData?.email || 'Not connected';
            const daysLeft = userData?.plan_expiry
              ? Math.max(0, Math.ceil((new Date(userData.plan_expiry) - Date.now()) / 86400000))
              : 0;

            await sendTelegram(env.BOT_TOKEN, chatId,
              `📊 <b>Your Status</b>\n\n` +
              `👤 ${firstName} (@${username})\n` +
              `📧 Gmail: ${gmail}\n` +
              `⭐ Plan: ${plan.toUpperCase()}\n` +
              `📅 Expires: ${expiry} (${daysLeft} days left)\n\n` +
              `Use /pay to extend your plan!`,
              'HTML'
            );
          }

          // ── /help ──
          else if (text === '/help') {
            await sendTelegram(env.BOT_TOKEN, chatId,
              `🤖 <b>Email Summary Bot Help</b>\n\n` +
              `/start — Register & welcome\n` +
              `/connect — Connect your Gmail\n` +
              `/plans — View plans & pricing\n` +
              `/pay {plan} — Buy a plan (e.g. /pay test)\n` +
              `/status — Check your plan & Gmail\n` +
              `/help — This menu`,
              'HTML'
            );
          }
        }

        // Handle PreCheckoutQuery (before payment)
        if (update.pre_checkout_query) {
          const pq = update.pre_checkout_query;
          await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/answerPreCheckoutQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pre_checkout_query_id: pq.id,
              ok: true
            })
          });
        }

        // Handle successful payment
        if (update.message?.successful_payment) {
          const payment = update.message.successful_payment;
          const payload = payment.invoice_payload; // "plan_test_5866465296_abc123"
          const parts = payload.split('_'); // ["plan", "test", "5866465296", "abc123"]
          
          if (parts[0] === 'plan') {
            const planType = parts[1];
            const tgId = parts[2];
            const paymentId = parts[3];

            const plans = {
              test: 1, '7day': 7, '14day': 14, '30day': 30
            };
            const days = plans[planType] || 1;
            const expiry = new Date(Date.now() + days * 86400000).toISOString();

            // Update user state
            const userKey = `user:${tgId}`;
            let userData = await env.USER_STATE.get(userKey, { type: 'json' }) || {};
            userData.plan = planType;
            userData.plan_expiry = expiry;
            userData.plan_activated_at = new Date().toISOString();
            await env.USER_STATE.put(userKey, JSON.stringify(userData));

            // Update payment record
            const paymentRecord = await env.USER_STATE.get(`payment:${paymentId}`, { type: 'json' });
            if (paymentRecord) {
              paymentRecord.status = 'paid';
              paymentRecord.paid_at = new Date().toISOString();
              await env.USER_STATE.put(`payment:${paymentId}`, JSON.stringify(paymentRecord));
            }

            await sendTelegram(env.BOT_TOKEN, tgId,
              `✅ <b>Payment Successful!</b>\n\n` +
              `Plan: ${planType.toUpperCase()} (${days} days)\n` +
              `Expires: ${new Date(expiry).toLocaleDateString()}\n\n` +
              `Your email summaries will start arriving now! 📧`,
              'HTML'
            );

            // Notify owner
            await sendTelegram(env.BOT_TOKEN, '5866465296',
              `💰 <b>New Payment!</b>\nUser: ${tgId}\nPlan: ${planType}\nStars: ${payment.total_amount}\nID: ${paymentId}`,
              'HTML'
            );
          }
        }

        return new Response('OK', { status: 200 });
      } catch (err) {
        return new Response(`Webhook error: ${err.message}`, { status: 500 });
      }
    }

    // ═══════════════════════════════════════════
    // ZARO → WORKER: Receive summaries
    // ═══════════════════════════════════════════

    // ──── POST /send ────
    if (path === '/send' && method === 'POST') {
      const auth = request.headers.get('Authorization');
      if (auth !== `Bearer ${env.ZARO_SECRET}`) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      try {
        const { chat_id, text } = await request.json();
        if (!chat_id || !text) {
          return new Response(JSON.stringify({ error: 'Missing fields' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const result = await sendTelegram(env.BOT_TOKEN, chat_id, text, 'HTML');
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // ═══════════════════════════════════════════
    // GET /users → List active users (for Zaro poller)
    // ═══════════════════════════════════════════
    if (path === '/users' && method === 'GET') {
      const auth = request.headers.get('Authorization');
      if (auth !== `Bearer ${env.ZARO_SECRET}`) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const list = await env.USER_STATE.list({ prefix: 'user:' });
      const users = [];
      for (const key of list.keys) {
        const data = await env.USER_STATE.get(key.name, { type: 'json' });
        if (data && data.plan !== 'none' && data.plan_expiry && new Date(data.plan_expiry) > new Date()) {
          users.push(data);
        }
      }
      return new Response(JSON.stringify(users), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // ═══════════════════════════════════════════
    // GET /register → Set webhook
    // ═══════════════════════════════════════════
    if (path === '/register' && method === 'GET') {
      const webhookUrl = `https://${url.hostname}/webhook`;
      const tgResp = await fetch(
        `https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: webhookUrl, allowed_updates: ['message', 'pre_checkout_query'] })
        }
      );
      const result = await tgResp.json();
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};

// ──── Helpers ────
async function sendTelegram(botToken, chatId, text, parseMode = 'HTML') {
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: String(chatId),
      text: text,
      parse_mode: parseMode,
      disable_web_page_preview: true
    })
  });
  return resp.json();
}
>>>>>>> e331151 (Initial commit: Cloudflare Worker with OAuth, Telegram webhook, Star payments)
