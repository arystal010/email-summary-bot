# Email Summary Bot 🤖📧

Multi-user Telegram bot for AI-powered email summaries with Gmail OAuth and Telegram Stars payments. Built on Cloudflare Workers + Zaro.

## Features
- ✅ **Multi-user** — each user connects their own Gmail via OAuth
- ✅ **AI summaries** — smart 2-3 bullet point summaries per email
- ✅ **Per-minute polling** — emails checked every 60 seconds
- ✅ **Telegram Stars** — paid plans (1-day test, 7, 14, 30 days)
- ✅ **Cloudflare Worker** — handles webhooks, OAuth, and payments
- ✅ **KV-backed** — user tokens and state stored in Cloudflare KV

## Architecture
```
Telegram User → Bot (@testv1000bbot) → Cloudflare Worker
                                          ├─ OAuth → Google Gmail API
                                          ├─ Webhook → Bot commands
                                          └─ Payments → Telegram Stars
Zaro Scheduler → Cloudflare Worker → User's Gmail → AI Summary → Telegram
```

## Commands
- `/start` — Register
- `/connect` — Connect Gmail via OAuth
- `/plans` — View plans
- `/pay {plan}` — Buy with Stars
- `/status` — Check your plan & Gmail status

## Deployment
1. `wrangler deploy`
2. Visit `/register` to set webhook
3. Set secrets: `BOT_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ZARO_SECRET`

## Plans
| Plan | Stars | Days |
|------|-------|------|
| Test | 1 ⭐ | 1 |
| 7-Day | 50 ⭐ | 7 |
| 14-Day | 100 ⭐ | 14 |
| 30-Day | 200 ⭐ | 30 |
