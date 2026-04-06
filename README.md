# Treadmagotchi

A virtual pet that trades crypto futures for you. Your pet's health, mood, and evolution are tied to real trading performance — keep it fed, keep it happy, and watch it grow as it racks up volume across multiple exchanges.

Built with Next.js, SQLite, and Claude AI.

---

## What Is This?

Treadmagotchi combines a Tamagotchi-style pixel pet simulator with an AI-powered algorithmic trading bot. Every 5 minutes, Claude AI analyzes market conditions across your connected exchange accounts and makes autonomous market-making decisions. Your pet evolves through four stages based on cumulative trading volume, and its vitals (hunger, happiness, energy, health) respond to trading outcomes.

**This is not a toy.** It places real trades on real exchanges with real money through the [Tread.fi](https://tread.fi) API. Understand the risks before enabling auto-trading.

---

## Features

### Trading Engine
- **AI-powered decisions** — Claude analyzes market regime, pair suitability, risk metrics, and trade history every 5 minutes
- **Multi-exchange support** — Paradex, Hyperliquid, Bybit, and others via Tread.fi
- **Multi-account** — Trade across multiple exchange accounts simultaneously
- **Risk management** — Position sizing limits, max daily loss caps, max drawdown protection, and stop losses
- **Order monitoring** — Stale order detection, spread adjustment at 15 min, cancellation at 30 min if under-filled
- **Rule-based fallback** — Continues operating if the Claude API is unavailable

### Pet Mechanics
- **Vitals** — Hunger (decays over time), Happiness, Energy, Health
- **Mood system** — 13 moods derived from vitals (happy, hungry, starving, proud, determined, sleeping, etc.)
- **Evolution** — 4 stages based on cumulative volume:
  - Critter ($0) → Creature ($1M) → Beast ($5M) → Mythic ($55.5M)
- **Starvation** — Pet takes health damage when starving; can die if neglected
- **Trading integration** — Profitable trades feed your pet (+25 hunger), losses still count (+10 hunger)
- **43 characters** across 3 rarity tiers (common, uncommon, rare) with animated sprite sheets
- **6 background scenes** — Cozy, Cyberpunk, Lofi, Station, Tatami, Wizard
- **Reroll & Revive** — Randomize your pet's appearance or revive a dead pet

### Interface
- **Retro pixel art UI** with Press Start 2P font
- **Real-time updates** via Server-Sent Events (SSE)
- **Live trade history**, P&L tracking, and balance snapshots
- **Settings sidebar** for API keys, account management, and engine controls
- **Guided setup flow** for first-time configuration

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, React 19) |
| Database | SQLite via better-sqlite3 + Drizzle ORM |
| Styling | Tailwind CSS 4 with custom RPG theme |
| State | Zustand |
| Real-time | Server-Sent Events (SSE) |
| AI | Anthropic Claude (Haiku 4.5) |
| Trading | Tread.fi API |
| Analysis | TradingView API, TreadTools |
| Production | PM2 process manager |

---

## Prerequisites

- **Node.js** 18+ (20+ recommended)
- **npm** 9+
- A **[Tread.fi](https://tread.fi) account** with an API key and at least one connected exchange
- An **[Anthropic](https://console.anthropic.com/) API key** for AI trading decisions

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/jaytreadfi/treadmagotchi.git
cd treadmagotchi
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

The defaults work out of the box for local use. The `.env` file only controls server binding — API keys are configured through the web UI.

```env
PORT=3000
HOSTNAME=127.0.0.1
```

### 3. Run database migrations

```bash
npm run db:generate
npm run db:migrate
```

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The setup wizard will walk you through entering your API keys and selecting exchange accounts.

---

## Production Deployment

Treadmagotchi uses PM2 for production process management:

```bash
# Build and start
npm run pm2:start

# Management
npm run pm2:stop
npm run pm2:restart
npm run pm2:logs
```

The PM2 config (`ecosystem.config.js`) runs a single instance bound to localhost with a 750MB memory limit and 10-second graceful shutdown window. **Never use cluster mode** — duplicate engine instances will submit duplicate trades.

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOSTNAME` | `127.0.0.1` | Bind address (localhost only by default) |
| `DATA_DIR` | `~/.local/share/treadmagotchi` | Database location override |
| `REVERSE_PROXY` | — | Set to `true` if behind nginx/caddy |

### API Keys

API keys are entered through the web UI during setup (Settings > API Keys). They are encrypted and stored in the SQLite database — never in `.env` or plain text files.

- **Tread.fi API Key** — Required. Enables exchange access and order execution.
- **Anthropic API Key** — Required for AI-powered trading. Without it, the engine falls back to rule-based logic.

---

## Database

The SQLite database is stored at:
- **macOS/Linux:** `~/.local/share/treadmagotchi/treadmagotchi.db`
- **Windows:** `%LOCALAPPDATA%\treadmagotchi\treadmagotchi.db`
- **Custom:** Set `DATA_DIR` in `.env`

The location is chosen to avoid iCloud/OneDrive sync issues. Running the database from `~/Desktop` or `~/Documents` on macOS is not recommended.

### Backups

```bash
npm run backup
```

Creates a timestamped copy of the database in the data directory.

### Migrations

Migrations run automatically on startup. To manually generate or apply:

```bash
npm run db:generate   # Generate migration from schema changes
npm run db:migrate    # Apply pending migrations
```

---

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/                # API routes (engine, pet, trades, config, events)
│   ├── setup/              # First-time setup flow
│   └── page.tsx            # Main app shell
├── server/
│   ├── clients/            # External API integrations (Tread, Claude, TradingView)
│   ├── db/                 # Schema, repository, config store, encryption
│   └── engine/             # Trading engine, AI decisions, risk, pet state machine
├── components/             # React components (pet, panels, settings, UI primitives)
├── lib/                    # Types, constants, characters, maps, pet mechanics
├── hooks/                  # SSE hydration, trade history
└── store/                  # Zustand stores (trading, pet, config)
```

---

## Risk Parameters

These are the hardcoded risk limits in `src/lib/constants.ts`:

| Parameter | Value | Description |
|-----------|-------|-------------|
| Max position size | 80% of equity | Per-position limit |
| Max total exposure | 80% of equity | Across all positions |
| Max daily loss | $20 or 10% of equity | Whichever is greater |
| Max drawdown | 30% from peak | Circuit breaker |
| Stop loss | 10% per position | Automatic exit |
| Max leverage | 50x | Hard cap |
| Max concurrent bots | 8 | Simultaneous market-making operations |
| Max bots per cycle | 3 | New bots launched per 5-min cycle |

---

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate Drizzle migration |
| `npm run db:migrate` | Apply database migrations |
| `npm run pm2:start` | Build + start with PM2 |
| `npm run pm2:stop` | Stop PM2 process |
| `npm run pm2:restart` | Restart PM2 process |
| `npm run pm2:logs` | Tail PM2 logs |
| `npm run backup` | Backup SQLite database |

---

## Security

- **Localhost only** by default — the server binds to `127.0.0.1` and validates the Host header
- **DNS rebinding protection** — rejects requests with unexpected Host headers
- **Rate limiting** — sliding-window rate limiter on sensitive endpoints
- **Encrypted storage** — API keys are encrypted at rest (AES-256-GCM) in the database
- **No external auth** — this is a personal tool designed to run on your own machine

If deploying behind a reverse proxy, set `REVERSE_PROXY=true` to trust `X-Forwarded-Host` headers.

---

## Disclaimer

This software places real trades with real money on cryptocurrency exchanges. It is provided as-is with no guarantees of profitability, correctness, or reliability. You are solely responsible for any financial losses incurred. Use at your own risk.
