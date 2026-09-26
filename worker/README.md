# Cloudflare Workers

Stejný server jako `server/`, ale běží na Cloudflare Workers – bez vlastního počítače a zdarma
(v rámci limitů free tarifu). Logiku sdílí s Node.js serverem (`server/core.js`).

- **Web a data** (`*.html`, `assets/`, `data/`, `docs/`) servíruje Workers Static Assets.
  Při nasazení je `build.mjs` zkopíruje do `worker/public/`.
- **API** (`/api/*`) obsluhuje jeden Durable Object `VehicleHub`, který drží vozy v paměti.
  Vozy se po 60 s bez zprávy smažou, takže je není potřeba nikam ukládat.

## Nasazení

Potřebujete účet na Cloudflare (stačí free) a Node.js 18+.

```
cd worker
npm install
npx wrangler login
npx wrangler secret put TOKENS      # token(y) pro plugin, více oddělte čárkou
npx wrangler deploy
```

Wrangler vypíše adresu, např. `https://odjezdove-tabule.<vas-ucet>.workers.dev`. Na ní běží web
i API. V `omsi2tracker.ini` pak nastavte:

```
server=https://odjezdove-tabule.<vas-ucet>.workers.dev/api/vehicles
token=<váš token>
```

Vlastní doménu (např. `tabla.plainrock127.xyz`) lze připojit v Cloudflare dashboardu
(Workers → odjezdove-tabule → Settings → Domains & Routes), pokud je doména na Cloudflare.

Po změně jízdních řádů nebo zastávek v `data/` stačí znovu spustit `npx wrangler deploy`.
Nasazení lze i zautomatizovat z GitHubu (Cloudflare → Workers → Import a repository,
kořenový adresář `worker`).

## Lokální vývoj

```
cd worker
echo "TOKENS=tajny" > .dev.vars
npx wrangler dev                              # http://localhost:8787
node ../server/simulate.js http://localhost:8787 tajny
```

## Nastavení (`wrangler.toml` → `[vars]`)

| Proměnná | Význam |
|---|---|
| `TOKENS` | **secret**, tokeny pro zápis vozů; bez něj může vozy posílat kdokoli |
| `CLOCK` | `real` = skutečný čas, `game` = herní čas posledního vozu na mapě |
| `TIME_ZONE` | časové pásmo odjezdů (Cloudflare běží v UTC), výchozí `Europe/Prague` |
| `VEHICLE_TIMEOUT_SECONDS` | po kolika sekundách bez zprávy vůz zmizí |

## Limity free tarifu

Free tarif má 100 000 požadavků denně (limit se nuluje v 00:00 UTC). Durable Objects
s úložištěm SQLite jsou ve free tarifu k dispozici, proto `wrangler.toml` používá
`new_sqlite_classes`. Workers KV by nestačilo: zdarma povoluje jen 1 000 zápisů denně.

- Každé hlášení z pluginu jsou 2 požadavky (Worker + Durable Object). Jeden hráč s intervalem
  5 s za hodinu udělá ~1 440 požadavků. S `interval=10` v `omsi2tracker.ini` je to polovina.
- Každá otevřená tabule se obnovuje každých 20 s, tj. ~360 požadavků za hodinu.
- Statické soubory (HTML, JS, JSON) se do limitu požadavků nepočítají.

Pro menší komunitu to bohatě stačí. Při větším provozu je potřeba placený tarif
(Workers Paid) nebo vlastní server se `server/server.js`.
