# 🗽 NYC CRIMINAL — Multiplayer Setup Guide

A GTA-style multiplayer browser game. Server on Render, frontend on Netlify, leaderboard on Supabase (optional).

---

## 📁 File Structure

```
/
├── server.js          ← Node.js WebSocket server (deploy to Render)
├── package.json       ← Server dependencies
├── netlify.toml       ← Netlify config (serves /public)
├── public/
│   └── index.html     ← Game client (deploy to Netlify)
└── README.md
```

---

## 1️⃣ Supabase Setup (Optional — for persistent leaderboard)

1. Go to [supabase.com](https://supabase.com) → New Project
2. Open **SQL Editor** and run:

```sql
CREATE TABLE leaderboard (
  id SERIAL PRIMARY KEY,
  player_name TEXT UNIQUE NOT NULL,
  money BIGINT DEFAULT 0,
  kills INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Allow public reads
ALTER TABLE leaderboard ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON leaderboard FOR SELECT USING (true);
CREATE POLICY "Service write" ON leaderboard FOR ALL USING (true);
```

3. Go to **Settings → API** and copy:
   - `Project URL` → `SUPABASE_URL`
   - `anon public` key → `SUPABASE_KEY`

---

## 2️⃣ Deploy Server to Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New → Web Service**
3. Connect your GitHub repo
4. Configure:
   - **Name:** `nyc-criminal-server` (or anything)
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free

5. Add Environment Variables (Settings → Environment):
   ```
   SUPABASE_URL   = https://xxxx.supabase.co    ← (optional)
   SUPABASE_KEY   = eyJhbGciOiJIUzI1...         ← (optional)
   ```

6. Click **Deploy** — wait ~2 minutes
7. Copy your server URL: `https://nyc-criminal-server.onrender.com`

---

## 3️⃣ Update the Client with Your Server URL

Open `public/index.html` and find line ~6:

```js
const WS_URL = 'wss://YOUR-APP-NAME.onrender.com'; // ← CHANGE THIS
```

Replace with your actual Render URL:

```js
const WS_URL = 'wss://nyc-criminal-server.onrender.com';
```

> ⚠️ **Important:** Use `wss://` (not `ws://`) for Render — it's always HTTPS.

---

## 4️⃣ Deploy Frontend to Netlify

**Option A — Drag & Drop (fastest):**
1. Go to [netlify.com](https://netlify.com) → **Add new site → Deploy manually**
2. Drag the `public/` folder onto the drop zone
3. Done! You get a URL like `https://amazing-name-123.netlify.app`

**Option B — Git (auto-deploys on push):**
1. Go to [netlify.com](https://netlify.com) → **Add new site → Import from Git**
2. Connect your GitHub repo
3. Set:
   - **Base directory:** *(leave empty)*
   - **Build command:** *(leave empty)*
   - **Publish directory:** `public`
4. Click **Deploy site**

---

## 5️⃣ Play!

Share your Netlify URL with friends. Everyone connects to the same Render server.

---

## 🎮 Controls

| Key | Action |
|-----|--------|
| `W A S D` | Drive / Walk |
| `E` | Enter / Exit car (steal any car!) |
| `SPACE` | Brake |
| `N` | Nitro boost |
| `H` | Horn |
| `R` | Change radio station |
| `V` | Cycle camera (Chase / Overhead / Bumper) |
| `SHIFT` | Sprint (on foot) |
| `Left Click` | Shoot (on foot, after clicking to lock mouse) |
| `T` | Open chat |
| `TAB` | Live leaderboard |
| `Esc` | Close chat / release mouse |

---

## 🔧 Local Development

```bash
npm install
node server.js
# Open public/index.html in browser
# Change WS_URL to ws://localhost:3001
```

---

## 🌐 Architecture

```
[Browser / Netlify]  ←→  WebSocket  ←→  [Render Server]  ←→  [Supabase]
   public/index.html                       server.js            leaderboard
   
- Clients connect via WebSocket
- Server broadcasts all player positions at 20hz
- Police AI, pedestrians, pickups = client-side only
- Scores saved to Supabase every 5s
- Render free tier sleeps after 15min inactivity (first connect takes ~30s)
```

---

## ⚡ Tips

- **Render free tier** spins down after 15 min of inactivity. First player to connect may wait ~30s for cold start. Upgrade to paid for always-on.
- **Multiplayer scope:** positions, modes, money, events (wasted/shoot/pickup) are synced. AI (police, peds, traffic) runs independently on each client.
- To add more players to the leaderboard, change `scores.slice(0, 10)` in `server.js`.
