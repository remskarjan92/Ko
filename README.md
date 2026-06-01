# 🛍️ Etsy Flux Mockup Generator — Railway Edition

## Deploy to Railway (2 minutes)

1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Select your repo — Railway auto-detects Node.js
4. Go to your service → **Variables** tab → add:
   - `GEMINI_API_KEY` = `AIza...`
   - `REPLICATE_API_KEY` = `r8_...`
   - `ADMIN_TOKEN` = any long random secret if you want to lock down the API
5. Railway redeploys automatically — your app is live!

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Your Gemini key (for prompt generation) |
| `REPLICATE_API_KEY` | Your Replicate key (for Flux image generation) |
| `ADMIN_TOKEN` | Optional shared secret that protects `/api/*` routes |
| `PORT` | Set automatically by Railway — do not set manually |

Keys set as env vars take priority over anything entered in the UI.
If neither env var is set, users can still enter keys via the Settings panel.
If `ADMIN_TOKEN` is set, paste the same value into the Settings panel once per browser.

## Local Dev

```bash
npm install
npm start
# open http://localhost:3000
```

## Requirements
- Node.js >= 18

## What's in v2
- ✅ `node-fetch` removed — uses Node 18 native fetch
- ✅ `max_tokens` raised 1000 → 4000
- ✅ Manual Fix Template added
- ✅ Mockup count selector (6 / 12 / 18)
- ✅ Railway env var support (`GEMINI_API_KEY`, `REPLICATE_API_KEY`)
- ✅ Optional `ADMIN_TOKEN` protection for `/api/*` routes
