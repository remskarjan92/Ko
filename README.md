# 🛍️ Etsy Flux Mockup Generator — Railway Edition

## Deploy to Railway (2 minutes)

1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Select your repo — Railway auto-detects Node.js
4. Go to your service → **Variables** tab → add:
   - `ANTHROPIC_API_KEY` = `sk-ant-api03-...`
   - `REPLICATE_API_KEY` = `r8_...`
5. Railway redeploys automatically — your app is live!

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic key (for Claude prompt generation) |
| `REPLICATE_API_KEY` | Your Replicate key (for Flux image generation) |
| `PORT` | Set automatically by Railway — do not set manually |

Keys set as env vars take priority over anything entered in the UI.
If neither env var is set, users can still enter keys via the Settings panel.

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
- ✅ Railway env var support (`ANTHROPIC_API_KEY`, `REPLICATE_API_KEY`)
