const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();

const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 443;
const PASSWORD = process.env.PASSWORD || '';
const CERT_KEY = path.join(__dirname, 'certs', 'key.pem');
const CERT_FILE = path.join(__dirname, 'certs', 'cert.pem');

// ─── CORS ───
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── SSL Detection ───
let sslAvailable = false;
let sslOptions = {};
try {
  if (fs.existsSync(CERT_KEY) && fs.existsSync(CERT_FILE)) {
    sslOptions = {
      key: fs.readFileSync(CERT_KEY),
      cert: fs.readFileSync(CERT_FILE)
    };
    sslAvailable = true;
  }
} catch (e) {
  console.log('[SSL] Could not load certificates:', e.message);
}

// ─── HTTPS Redirect Middleware ───
if (sslAvailable) {
  app.use((req, res, next) => {
    if (!req.secure && req.headers['x-forwarded-proto'] !== 'https') {
      const host = req.headers.host.replace(/:\d+$/, '');
      const port = HTTPS_PORT === 443 ? '' : `:${HTTPS_PORT}`;
      return res.redirect(301, `https://${host}${port}${req.url}`);
    }
    next();
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-memory stores ───
const locations = new Map();
const locationHistory = new Map(); // userId -> [{lat, lng, timestamp}, ...] (last 50)

// ─── Rate limiting ───
const rateLimits = new Map(); // userId -> lastUpdateTimestamp

function isRateLimited(userId) {
  const now = Date.now();
  const last = rateLimits.get(userId) || 0;
  if (now - last < 1000) return true;
  rateLimits.set(userId, now);
  return false;
}

// ─── Input validation ───
function validateLocationData(data) {
  const { userId, lat, lng } = data;
  if (!userId || typeof userId !== 'string' || userId.length > 100) return false;
  const parsedLat = parseFloat(lat);
  const parsedLng = parseFloat(lng);
  if (isNaN(parsedLat) || isNaN(parsedLng)) return false;
  if (parsedLat < -90 || parsedLat > 90) return false;
  if (parsedLng < -180 || parsedLng > 180) return false;
  return true;
}

function addToHistory(userId, lat, lng) {
  if (!locationHistory.has(userId)) locationHistory.set(userId, []);
  const hist = locationHistory.get(userId);
  hist.push({ lat, lng, timestamp: Date.now() });
  if (hist.length > 50) hist.shift();
}

// ─── Password Auth ───
function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function authMiddleware(req, res, next) {
  if (!PASSWORD) return next();
  const token = req.cookies?.token || req.headers.cookie?.split(';')
    .map(c => c.trim().split('='))
    .find(c => c[0] === 'token')?.[1];
  if (token && token === hashPassword(PASSWORD)) return next();
  // Serve login page
  res.send(loginPage());
}

function loginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Family Locator — Login</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
  <style>
    :root { --bg:#0a0f1a; --card:#0f172a; --accent:#38bdf8; --text:#f1f5f9; --muted:#475569; --border:rgba(148,163,184,0.1); }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'DM Sans',sans-serif; background:var(--bg); color:var(--text); height:100vh; display:flex; align-items:center; justify-content:center; }
    .login-box { background:var(--card); border:1px solid var(--border); border-radius:20px; padding:40px 32px; max-width:360px; width:100%; text-align:center; }
    .login-box h1 { font-family:'Instrument Serif',serif; font-size:28px; margin-bottom:8px; }
    .login-box h1 span { color:var(--accent); }
    .login-box p { color:var(--muted); font-size:14px; margin-bottom:24px; }
    .login-box input { width:100%; padding:14px 16px; background:rgba(255,255,255,0.06); border:1px solid var(--border); border-radius:12px; color:var(--text); font-family:inherit; font-size:15px; outline:none; margin-bottom:16px; text-align:center; letter-spacing:2px; }
    .login-box input:focus { border-color:var(--accent); }
    .login-box button { width:100%; padding:14px; background:linear-gradient(135deg,var(--accent),#818cf8); border:none; border-radius:12px; color:#fff; font-family:inherit; font-size:15px; font-weight:600; cursor:pointer; }
    .login-box button:hover { opacity:0.9; }
    .error-msg { color:#f43f5e; font-size:13px; margin-top:12px; display:none; }
  </style>
</head>
<body>
  <div class="login-box">
    <h1>Family <span>Locator</span></h1>
    <p>Enter the family password to continue</p>
    <form onsubmit="return doLogin(event)">
      <input type="password" id="pw" placeholder="Password" autofocus autocomplete="current-password" />
      <button type="submit">Unlock Dashboard</button>
    </form>
    <div class="error-msg" id="err">Wrong password. Try again.</div>
  </div>
  <script>
    async function doLogin(e) {
      e.preventDefault();
      const pw = document.getElementById('pw').value;
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      });
      if (res.ok) {
        const { token } = await res.json();
        document.cookie = 'token=' + token + ';path=/;max-age=86400;SameSite=Strict';
        window.location.reload();
      } else {
        document.getElementById('err').style.display = 'block';
      }
    }
  </script>
</body>
</html>`;
}

// ─── Auth endpoint ───
app.post('/api/auth', (req, res) => {
  if (!PASSWORD) return res.json({ token: '' });
  const { password } = req.body || {};
  if (typeof password !== 'string') return res.status(400).json({ error: 'Missing password' });
  if (password === PASSWORD) {
    return res.json({ token: hashPassword(PASSWORD) });
  }
  res.status(401).json({ error: 'Invalid password' });
});

// ─── Pages ───

// Parent dashboard — password protected
app.get('/', authMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Child tracking page — always accessible, no auth
app.get('/track/:name', (req, res) => {
  const name = req.params.name;
  if (!name || name.length > 100) return res.status(400).send('Invalid name');
  res.sendFile(path.join(__dirname, 'public', 'tracker.html'));
});

// ─── REST API ───

app.post('/api/location', (req, res) => {
  const { userId, name, lat, lng, accuracy } = req.body;
  if (!validateLocationData(req.body)) {
    return res.status(400).json({ error: 'Invalid location data. Required: userId (string), lat (-90..90), lng (-180..180)' });
  }
  if (isRateLimited(userId)) {
    return res.status(429).json({ error: 'Rate limited. Max 1 update per second.' });
  }

  const locationData = {
    userId,
    name: (name && typeof name === 'string') ? name.slice(0, 50) : userId,
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    accuracy: accuracy ? Math.max(0, parseFloat(accuracy)) : null,
    timestamp: Date.now()
  };

  locations.set(userId, locationData);
  addToHistory(userId, locationData.lat, locationData.lng);
  io.emit('location-update', locationData);
  io.emit('all-locations', Array.from(locations.values()));
  res.json({ success: true });
});

app.get('/api/locations', (req, res) => {
  res.json(Array.from(locations.values()));
});

app.get('/api/history/:userId', (req, res) => {
  const userId = req.params.userId;
  if (!userId || userId.length > 100) return res.status(400).json({ error: 'Invalid userId' });
  const hist = locationHistory.get(userId) || [];
  res.json(hist);
});

// ─── Servers ───

const httpServer = http.createServer(app);
let httpsServer = null;

const ioOptions = { cors: { origin: '*' } };

if (sslAvailable) {
  httpsServer = https.createServer(sslOptions, app);
  // Attach socket.io to HTTPS server (primary)
  var io = new Server(httpsServer, ioOptions);
  // Also attach to HTTP server for local dev
  io.attach(httpServer);
} else {
  var io = new Server(httpServer, ioOptions);
}

// ─── WebSocket ───

io.on('connection', (socket) => {
  console.log(`[WS] Connected: ${socket.id}`);
  socket.emit('all-locations', Array.from(locations.values()));

  socket.on('location-update', (data) => {
    if (!data || typeof data !== 'object') return;
    const { userId, name, lat, lng, accuracy } = data;
    if (!validateLocationData(data)) return;
    if (isRateLimited(userId)) return;

    const locationData = {
      userId,
      name: (name && typeof name === 'string') ? name.slice(0, 50) : userId,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      accuracy: accuracy ? Math.max(0, parseFloat(accuracy)) : null,
      timestamp: Date.now()
    };

    locations.set(userId, locationData);
    addToHistory(userId, locationData.lat, locationData.lng);
    io.emit('location-update', locationData);
    io.emit('all-locations', Array.from(locations.values()));
  });

  socket.on('user-offline', (userId) => {
    if (typeof userId !== 'string') return;
    if (locations.has(userId)) {
      // Mark as offline instead of deleting
      const loc = locations.get(userId);
      loc.offline = true;
      io.emit('all-locations', Array.from(locations.values()));
    }
  });

  // Keep-alive pong
  socket.on('ping-alive', () => {
    socket.emit('pong-alive');
  });

  socket.on('disconnect', () => {
    console.log(`[WS] Disconnected: ${socket.id}`);
  });
});

// Clean stale locations (30 min)
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [userId, loc] of locations) {
    if (loc.timestamp < cutoff) {
      locations.delete(userId);
      locationHistory.delete(userId);
    }
  }
  io.emit('all-locations', Array.from(locations.values()));
}, 60 * 1000);

// ─── Start servers ───
httpServer.listen(PORT, () => {
  console.log('');
  console.log('  ┌──────────────────────────────────────────────────────┐');
  console.log('  │                                                      │');
  console.log('  │   Family Locator                                     │');
  console.log('  │                                                      │');
  console.log(`  │   HTTP:  http://localhost:${PORT}                       │`);
  if (sslAvailable) {
    console.log(`  │   HTTPS: https://localhost${HTTPS_PORT === 443 ? '' : ':' + HTTPS_PORT}                      │`);
  }
  console.log('  │                                                      │');
  console.log('  │   Parent map:   /                                    │');
  console.log('  │   Child links:  /track/Sara                          │');
  console.log('  │                 /track/Ahmed                         │');
  if (PASSWORD) {
    console.log('  │                                                      │');
    console.log('  │   Password protection: ENABLED                       │');
  }
  console.log('  │                                                      │');
  console.log('  └──────────────────────────────────────────────────────┘');

  if (!sslAvailable) {
    console.log('');
    console.log('  [SSL] No certificates found at ./certs/');
    console.log('  To enable HTTPS (required for iPhone GPS), run:');
    console.log('');
    console.log('    mkdir certs');
    console.log('    openssl req -x509 -newkey rsa:2048 -keyout certs/key.pem -out certs/cert.pem -days 365 -nodes -subj "/CN=localhost"');
    console.log('');
    console.log('  Or use ngrok for instant HTTPS:');
    console.log('');
    console.log('    npx ngrok http 3000');
  }
  console.log('');
});

if (sslAvailable) {
  httpsServer.listen(HTTPS_PORT, () => {
    console.log(`  [SSL] HTTPS server running on port ${HTTPS_PORT}`);
  });
}
