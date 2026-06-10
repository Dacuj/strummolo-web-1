# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 📊 Statistiche (analytics privacy-friendly)

Il sito conta visite e tempo di lettura **senza dati personali**: niente cookie,
niente IP, niente fingerprinting. Solo contatori aggregati per giorno+pagina,
salvati nel D1 del worker `chat-api`. Il beacon (`public/stats-beacon.js`)
rispetta Do Not Track / Global Privacy Control.

Componenti:

- `chat-api` — endpoint `POST /track` (beacon anonimo), `GET /stats` (lettura, protetta da token)
  e `GET/DELETE /admin/messages` (moderazione bacheca, stesso token)
- `public/stats-beacon.js` — script incluso in ogni pagina via `Seo.astro`
- `/admin/stats` — pannello admin (non linkato, noindex, fuori sitemap); chiede il token e
  include statistiche + moderazione dei messaggi della bacheca (il CMS Decap resta su `/admin`)

### Attivazione (da fare una volta sola)

```sh
cd chat-api
# 1. Crea la tabella delle statistiche nel D1 di produzione
npx wrangler d1 execute sturmmolo-chat --remote --file=./migrations/0002_add_page_stats.sql
# 2. Imposta il token segreto per leggere le statistiche (inventane uno lungo)
npx wrangler secret put STATS_TOKEN
# 3. Rideploya il worker
npx wrangler deploy
```

Poi vai su `https://www.strummolo.com/admin/stats` e inserisci il token.

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
