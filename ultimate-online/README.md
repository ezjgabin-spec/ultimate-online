# Ultimate Online – your own game server

Everything in this folder runs your game at your own website. Anyone who opens the site lands in the same park, sees everyone else walking around, and can walk up to someone, press **T** to invite them, and press **Y** to accept. Parties and online games all go through this server.

## What's in here

| File | What it is |
|---|---|
| `public/index.html` | The game. |
| `src/worker.js` | The server. It relays the park, parties and games between players. |
| `wrangler.jsonc` | Cloudflare settings. |
| `package.json` | Tells Cloudflare which tools to use. |

## Put it online (one time, about 15 minutes)

### 1. Put these files on GitHub
1. Make a free account at **github.com**.
2. Click **+ → New repository**, name it `ultimate-online`, and click **Create repository**.
3. On the next page, click **uploading an existing file**.
4. Drag in everything inside this folder: the `public` and `src` folders, plus `wrangler.jsonc`, `package.json` and `README.md`.
5. Click **Commit changes**.

### 2. Turn it on with Cloudflare (free)
1. Make a free account at **dash.cloudflare.com**.
2. Go to **Workers & Pages → Create → Import a repository**, connect your GitHub account, and pick `ultimate-online`.
3. Keep the default settings and click **Deploy**.
4. When it finishes, you get a link like `ultimate-online.yourname.workers.dev`. Open it in two tabs to check the park works.

### 3. Get your .com (about $10.46 a year)
1. In Cloudflare, go to **Domain Registration → Register Domains**. Search for your name and buy it.
2. Open **Workers & Pages → ultimate-online → Settings → Domains & Routes → Add → Custom domain**, type your .com, and save.
3. After a few minutes, **yourname.com** is your game.

## Updating the game later
1. Open your GitHub repo and go into the `public` folder.
2. Click **Add file → Upload files** and drop in the new `index.html`.
3. Click **Commit changes**. Cloudflare redeploys by itself in about a minute.

## Limits on the free plan
- Each park server holds 30 players. When one fills up, new players go into park 2, then park 3, and so on.
- The free plan covers several hours of busy online play a day. If you go over, online play pauses until the daily reset at 8pm Eastern.
- The $5-a-month Workers plan removes that limit if the game takes off.
