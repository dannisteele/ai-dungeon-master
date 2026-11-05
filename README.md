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

## Setup (Windows)

For someone who'd rather not touch a terminal:

1. Download **`windows/Setup Dungeon Master.bat`** from this repo on GitHub (open the file, then the **Download raw file** button) and double-click it. If Windows says "Windows protected your PC", click **More info → Run anyway**.
2. It installs Node, Git and Ollama (click **Yes** if Windows asks), downloads the game to `%USERPROFILE%\ai-dungeon-master`, and asks for a table password and, optionally, the feedback token.
3. It downloads the Qwen 9B model (about 7 GB), plus Qwen 27B (about 17 GB) if the laptop has 32 GB of memory or more. This is the slow part.
4. Two shortcuts appear on the desktop:
   - **Dungeon Master** starts the game (and Ollama, in the background, if it isn't already running) and opens it in the browser. Leave its window open while playing; close it to stop. The first time, Windows asks whether to allow it on the network: click **Allow** if friends will join from their phones.
   - **Check for Updates** lists the [release notes](../../releases) for every version you're missing and, if you say yes, closes the game, copies your saves to `data\backups` (the newest 10 are kept), installs the newest release and starts it again. If an update fails it puts the old version back.

Running the setup again is safe: it skips whatever is already done.

## Playing

- **New campaign**: choose a setting, write your own pitch, or pick a prepared adventure. Party = play together, Solo = just you.
- **Join**: each player creates a hero (5e point buy) on their own device, or picks an existing one.
- **Begin**, then each round type what you do. The DM asks for checks when things are risky; press **Roll d20**.
- **Go ahead without me** / **Don't wait for …** keeps the game moving.
- **Try again** appears if the DM gets stuck (e.g. Ollama was closed).
- **Dungeon Master's brain** (bottom of the lobby) switches between the models you've downloaded, e.g. Qwen 27B for the best storytelling or Qwen 9B for speed. The choice is remembered, and from then on overrides `OLLAMA_MODEL` in `.env`. It can't be changed while the DM is mid-sentence.
- **Pack up for the night** (bottom of the lobby) unloads the model to free memory. Ollama also unloads it after `OLLAMA_KEEP_ALIVE` (default 30 minutes) of quiet.
- **Nearby**: the people in the scene appear above the action box, coloured by attitude (red hostile, amber wary, grey neutral, green friendly) with their condition. Tap one for Attack / Talk to / Watch, which fills in your action so names are never misspelt.
- **When the whole party falls**, play stops with a choice: **Revive** (everyone wakes at half HP and the Dungeon Master decides how you survived) or **Start a new campaign**.

Saves are automatic: everything lives in the `data/` folder (`game.sqlite`, plus a `cookie-secret` file used to sign login sessions). Back up the whole `data/` folder, not just the database file. Deleting `cookie-secret` or changing `TABLE_PASSWORD` signs every device out — players just re-enter the password, nothing else is lost.

## Feedback button (optional)

Players can send a bug report or an idea from the **Feedback** button (Tavern and play screen). It becomes a GitHub issue; bug reports include the last few moments of the story. To turn it on:

1. On GitHub, go to **Settings → Developer settings → Fine-grained tokens → Generate new token**.
2. Under **Repository access**, choose **Only select repositories** and pick this repo.
3. Under **Permissions → Repository permissions**, set **Issues** to **Read and write**. Nothing else.
4. Put it in `.env` as `GITHUB_TOKEN=...` (and `GITHUB_REPO=owner/name` if you're using a fork), then restart.

With no token set, the button doesn't appear. Tokens expire: when sending starts failing with "Couldn't send that just now", make a new one.

## Making the DM faster

How long a turn takes depends mostly on whether the whole model fits in the graphics card's memory. Part of that memory goes on how much story the DM holds in mind at once (`OLLAMA_NUM_CTX`, default 16384). On a card with little memory (say 6 GB), lowering it can let the whole model fit, which is much faster.

To measure, open a terminal in the game folder and run `npm run bench` (`npm.cmd run bench` on Windows; close the game first). It tries a few sizes and prints, for each, how much of the model fits on the card and roughly how long a turn takes. Put the size you like in `.env` as `OLLAMA_NUM_CTX=8192`, for example, and restart. Lower sizes mean the DM remembers fewer recent turns word for word; it still has the story-so-far summary.

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

## Versions and releases

Every merge to `main` that adds a feature (`feat:` commits) or fixes something (`fix:`) becomes a new release automatically: CI tags it (`fix` bumps 1.2.**3**, `feat` bumps 1.**3**.0) and publishes a [release](../../releases) listing the merged PRs. Docs- or CI-only merges don't make a release. `npm run release:dry-run` shows what the next release would be.

The Tavern footer shows the running version, and notes when a newer release is out.

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
