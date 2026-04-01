# 🌍 Family Locator

Real-time location sharing for families. **Zero setup for children** — just send them a link.

## How It Works

| Role | URL | What happens |
|------|-----|-------------|
| **Parent** | `http://yourserver:3000/` | Dashboard with map showing all children |
| **Child** | `http://yourserver:3000/track/Sara` | Opens and **immediately** starts sharing GPS — no name entry, no buttons |

## Quick Start

```bash
# 1. Install
npm install

# 2. Run
node server.js

# 3. Open dashboard
# → http://localhost:3000
```

## Usage

1. Open the **parent dashboard** at `http://localhost:3000`
2. Type your child's name in the "Generate Child Link" box → click **Generate**
3. **Send the link** to your child (WhatsApp, SMS, etc.)
4. When your child opens the link, their location appears on your map **instantly**

### Example links:
- `http://192.168.1.5:3000/track/Sara`
- `http://192.168.1.5:3000/track/Ahmed`
- `http://192.168.1.5:3000/track/Mom`

> Replace `192.168.1.5` with your computer's local IP to access from phones.

## Child's Experience

When a child opens their link, they see:
- A simple calming screen with a radar animation
- Their name displayed
- Status: "Sharing your location ✓"
- **No buttons to press, no name to type, nothing to configure**
- The browser asks for location permission once — after that it's automatic

## Access From Anywhere

To share locations outside your home WiFi:

**ngrok (easiest):**
```bash
npx ngrok http 3000
# → gives you https://abc123.ngrok.io
# → child link becomes https://abc123.ngrok.io/track/Sara
```

**Cloudflare Tunnel (free):**
```bash
cloudflared tunnel --url http://localhost:3000
```

## REST API

Update location via HTTP (for Tasker / iOS Shortcuts):
```bash
curl -X POST http://localhost:3000/api/location \
  -H "Content-Type: application/json" \
  -d '{"userId":"sara","name":"Sara","lat":36.19,"lng":44.01}'
```

## Project Structure

```
family-locator/
├── server.js           # Express + Socket.io server
├── package.json
└── public/
    ├── dashboard.html  # Parent map view
    └── tracker.html    # Child auto-sharing page
```

## Security Notes

This is a personal/family tool. For production, consider adding:
- Password protection on the dashboard
- HTTPS via reverse proxy
- Token-based child links (so only valid links work)
- Persistent storage (SQLite/PostgreSQL)

## License

MIT
