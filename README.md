# AI Dungeon Master

A tabletop adventure for your home network. You and your party say what your heroes do; a local AI (Qwen, via Ollama) is the Dungeon Master. The app keeps the character sheets and rolls the dice.

## Setup (Mac)

1. Install Node 24+ and Ollama (`brew install ollama`, or the app from ollama.com).
2. Start Ollama and fetch the model:
   ```bash
   ollama serve            # skip if the Ollama app is running
   ollama pull qwen3.6:27b # ~17 GB; for a faster, lighter DM use qwen3.5:9b
   ```
3. Install and configure:
   ```bash
   npm install
   cp .env.example .env    # then set TABLE_PASSWORD
   ```
4. Build and run:
   ```bash
   npm run build
   npm start
   ```
   The server prints addresses like `http://192.168.1.20:3000`. Open that on any phone or laptop on your Wi-Fi.
   The first time, macOS asks whether to allow incoming connections. Click **Allow**.

## Playing

- **New campaign**: choose a setting, write your own pitch, or pick a prepared adventure. Party = play together, Solo = just you.
- **Join**: each player creates a hero (5e point buy) on their own device, or picks an existing one.
- **Begin**, then each round type what you do. The DM asks for checks when things are risky; press **Roll d20**.
- **Go ahead without me** / **Don't wait for …** keeps the game moving.
- **Try again** appears if the DM gets stuck (e.g. Ollama was closed).
- **Pack up for the night** (bottom of the lobby) unloads the model to free memory. Ollama also unloads it after `OLLAMA_KEEP_ALIVE` (default 30 minutes) of quiet.

Saves are automatic: everything lives in the `data/` folder (`game.sqlite`, plus a `cookie-secret` file used to sign login sessions). Back up the whole `data/` folder, not just the database file. Deleting `cookie-secret` or changing `TABLE_PASSWORD` signs every device out — players just re-enter the password, nothing else is lost.

## Keeping it private

The server only answers devices on private network addresses, and asks for the table password. Your router blocks the internet from reaching it unless you've set up **port forwarding** for this port. Check your router's admin page and make sure nothing forwards to port 3000.

## Development

```bash
npm run dev          # API server with reload (port 3000)
npm run dev:client   # Vite dev server (port 5173, proxies to 3000)
npm test             # unit + integration tests (no AI needed)
npm run smoke        # plays 5 rounds against your real model and reports
```

Add a prepared adventure by dropping a JSON file in `src/server/campaigns/adventures/` (copy `drowned-chapel.json`).

## Moving to a Raspberry Pi or old laptop

A Pi can host the website but is far too slow to run the model, so split them:

1. **On the Mac (the DM's brain):** make Ollama listen on the network.
   - Ollama app: `launchctl setenv OLLAMA_HOST 0.0.0.0` and restart the app.
   - Or run `OLLAMA_HOST=0.0.0.0 ollama serve`.
   Ollama has no password, so only do this on your home network.
2. **On the Pi (64-bit Raspberry Pi OS, Pi 4/5):** install Node 24, copy this folder (or `git clone`), then:
   ```bash
   npm install && npm run build
   cp .env.example .env   # set TABLE_PASSWORD and OLLAMA_URL=http://<mac-ip>:11434
   npm start
   ```
3. To start it at boot, create a systemd service that runs `npm start` in this folder.

The Mac only needs to be awake while you play. Everything else (saves, website) lives on the Pi.
