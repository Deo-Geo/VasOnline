// ═══════════════════════════════════════════════════════════════════
//  NYC CRIMINAL — Multiplayer Server
//  Deploy to Render as a Web Service (Free tier works fine)
//  Env vars needed:
//    SUPABASE_URL   → Your Supabase project URL (optional)
//    SUPABASE_KEY   → Your Supabase anon key (optional)
// ═══════════════════════════════════════════════════════════════════
const http    = require('http');
const express = require('express');
const cors    = require('cors');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3001;

// ── Optional Supabase ─────────────────────────────────────────────
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  console.log('Supabase connected ✓');
}

// ── HTTP server (Express) ─────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Health check (Render pings this)
app.get('/', (req, res) => {
  res.json({
    status: 'NYC Criminal Server Online 🗽',
    players: clients.size,
    uptime: Math.floor(process.uptime()) + 's'
  });
});

// All-time leaderboard endpoint
app.get('/leaderboard', async (req, res) => {
  if (!supabase) { return res.json({ scores: [], message: 'Supabase not configured' }); }
  const { data, error } = await supabase
    .from('leaderboard')
    .select('*')
    .order('money', { ascending: false })
    .limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ scores: data || [] });
});

const server = http.createServer(app);

// ── WebSocket Server ──────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

// clients: Map<id, { ws, name, carColor, state, kills, joinedAt }>
const clients = new Map();
let nextId = 1;

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(data)); } catch (_) {}
  }
}

function broadcast(data, excludeId = null) {
  const msg = JSON.stringify(data);
  for (const [id, c] of clients) {
    if (id !== excludeId && c.ws.readyState === WebSocket.OPEN) {
      try { c.ws.send(msg); } catch (_) {}
    }
  }
}

function broadcastAll(data) {
  const msg = JSON.stringify(data);
  for (const [, c] of clients) {
    if (c.ws.readyState === WebSocket.OPEN) {
      try { c.ws.send(msg); } catch (_) {}
    }
  }
}

// ── Server tick: broadcast world state at 20hz ────────────────────
setInterval(() => {
  if (clients.size === 0) return;
  const players = [];
  for (const [id, c] of clients) {
    if (!c.state) continue;
    players.push({
      id,
      name:     c.name,
      carColor: c.carColor,
      pos:      c.state.pos,
      rot:      c.state.rot,
      carRot:   c.state.carRot,
      speed:    c.state.speed,
      mode:     c.state.mode,
      hp:       c.state.hp,
      wanted:   c.state.wanted,
      money:    c.state.money,
    });
  }
  broadcastAll({ type: 'stateUpdate', players });
}, 50);

// ── Leaderboard broadcast every 5s (+ Supabase save) ─────────────
setInterval(async () => {
  if (clients.size === 0) return;

  // Build live leaderboard
  const scores = [];
  for (const [id, c] of clients) {
    scores.push({
      id,
      name:   c.name,
      money:  c.state?.money  || 0,
      kills:  c.kills         || 0,
      wanted: c.state?.wanted || 0,
    });
  }
  scores.sort((a, b) => b.money - a.money);
  broadcastAll({ type: 'leaderboard', scores });

  // Persist top score per player to Supabase
  if (supabase) {
    for (const s of scores) {
      await supabase.from('leaderboard').upsert(
        { player_name: s.name, money: s.money, kills: s.kills, updated_at: new Date().toISOString() },
        { onConflict: 'player_name' }
      ).catch(() => {});
    }
  }
}, 5000);

// ── Connection handler ────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const id = String(nextId++);
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  const client = {
    ws,
    name:     'Player_' + id,
    carColor: 0xCC2211,
    state:    null,
    kills:    0,
    joinedAt: Date.now(),
  };
  clients.set(id, client);
  console.log(`[+] Player ${id} joined (${ip}) — total: ${clients.size}`);

  // Send existing world state to newcomer
  const existingPlayers = [];
  for (const [eid, ec] of clients) {
    if (eid !== id && ec.state) {
      existingPlayers.push({ id: eid, name: ec.name, carColor: ec.carColor, ...ec.state });
    }
  }
  send(ws, { type: 'welcome', id, players: existingPlayers });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }

    switch (msg.type) {
      case 'join':
        client.name     = String(msg.name     || client.name).substring(0, 20).replace(/[<>]/g, '');
        client.carColor = Number(msg.carColor) || 0xCC2211;
        broadcast({ type: 'playerJoin', id, name: client.name, carColor: client.carColor }, id);
        break;

      case 'state':
        client.state = {
          pos:    { x: +msg.pos?.x || 0, z: +msg.pos?.z || 0 },
          rot:    +msg.rot    || 0,
          carRot: +msg.carRot || 0,
          speed:  +msg.speed  || 0,
          mode:   msg.mode === 'walking' ? 'walking' : 'driving',
          hp:     +msg.hp     || 100,
          wanted: +msg.wanted || 0,
          money:  +msg.money  || 0,
        };
        break;

      case 'event':
        if (msg.event === 'kill') client.kills++;
        if (msg.event === 'wasted') {
          broadcast({ type: 'event', from: id, name: client.name, event: 'wasted' }, id);
        } else if (msg.event === 'crash') {
          broadcast({ type: 'event', from: id, name: client.name, event: 'crash', data: msg.data }, id);
        } else if (msg.event === 'pickup') {
          broadcast({ type: 'event', from: id, name: client.name, event: 'pickup', data: msg.data }, id);
        }
        break;

      case 'chat': {
        const text = String(msg.msg || '').substring(0, 100).replace(/[<>]/g, '');
        if (text.trim()) {
          broadcastAll({ type: 'chat', from: id, name: client.name, msg: text });
          console.log(`[chat] ${client.name}: ${text}`);
        }
        break;
      }

      case 'ping':
        send(ws, { type: 'pong', ts: msg.ts });
        break;
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    broadcastAll({ type: 'playerLeave', id });
    console.log(`[-] Player ${id} (${client.name}) left — total: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.warn(`[!] WS error for ${id}:`, err.message);
    clients.delete(id);
  });
});

server.listen(PORT, () => {
  console.log(`\n🗽 NYC Criminal Server running on port ${PORT}`);
  console.log(`   HTTP: http://localhost:${PORT}`);
  console.log(`   WS:   ws://localhost:${PORT}`);
  console.log(`   Supabase: ${supabase ? 'enabled' : 'disabled (optional)'}\n`);
});
