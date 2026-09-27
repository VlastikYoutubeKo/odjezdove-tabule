# Server

Malý server v Node.js (bez závislostí), který:

- servíruje web (úvodní stránku, tabule, seznam vozů),
- přijímá polohy vozů z pluginu OMSI 2,
- počítá odjezdy ze zastávek z jízdních řádů a živých vozů.

Server je potřeba jen pro živá data z OMSI. Tentýž server jde nasadit i na Cloudflare Workers, viz [worker/README.md](../worker/README.md). Tabule podle jízdních řádů fungují i na GitHub Pages bez serveru.

## Spuštění

```
cp server/config.example.json server/config.json   # a nastavte token
node server/server.js
```

Web pak běží na <http://localhost:8080>. Na vyzkoušení bez OMSI spusťte simulátor:

```
node server/simulate.js http://localhost:8080 <token>
```

Testy: `cd server && npm test`

## Nasazení na VPS

Stačí malý VPS s Linuxem (Debian/Ubuntu), Node.js 18+ a doména nasměrovaná na VPS.

```
# jako root
apt install -y nodejs git caddy
useradd --system --home /opt/odjezdove-tabule tabule
git clone https://github.com/VlastikYoutubeKo/odjezdove-tabule /opt/odjezdove-tabule
cd /opt/odjezdove-tabule
cp server/config.example.json server/config.json      # nastavte tokens, host dejte "127.0.0.1"
chown -R tabule: /opt/odjezdove-tabule

cp server/deploy/odjezdove-tabule.service /etc/systemd/system/
systemctl enable --now odjezdove-tabule

cp server/deploy/Caddyfile /etc/caddy/Caddyfile        # nastavte svou doménu
systemctl reload caddy
```

Caddy sám zařídí HTTPS certifikát. Aktualizace: `git pull` a `systemctl restart odjezdove-tabule`
(změny jen v `data/` se načtou i bez restartu).

Logy: `journalctl -u odjezdove-tabule -f`

## Konfigurace (`server/config.json`)

| Klíč | Význam |
|---|---|
| `port`, `host` | kde server poslouchá (port lze přepsat proměnnou `PORT`) |
| `tokens` | seznam tokenů, které smí posílat vozy (lze přepsat `TOKENS=a,b`). Prázdný = kdokoli. |
| `mapTokens` | tokeny pro nahrávání map z programu (lze přepsat `MAP_TOKENS=a,b`). Prázdný = nahrávání vypnuté. |
| `vehicleTimeoutSeconds` | po kolika sekundách bez zprávy vůz zmizí |
| `clock` | `real` = odjezdy podle skutečného času, `game` = podle herního času posledního vozu na mapě |
| `timeZone` | časové pásmo odjezdů, výchozí `Europe/Prague` (důležité, když server běží v UTC) |

Změny v `data/` se načtou automaticky bez restartu.

Nahrané mapy se ukládají do `data/maps/`. Aby se ukládaly i do GitHubu, spusťte server s proměnnými
`GITHUB_TOKEN` (fine-grained token s oprávněním Contents: Read and write), `GITHUB_REPO=owner/repo`
a volitelně `GITHUB_BRANCH` (výchozí `main`) – např. v systemd službě přes `Environment=`.

## API

| Metoda | Cesta | Popis |
|---|---|---|
| GET | `/api/stops` | obsah `data/stops.json` |
| GET | `/api/boards/<id>` | tabule zastávky (stejný formát jako `data/boards/*.json`) |
| GET | `/api/vehicles` | vozy v provozu |
| POST | `/api/vehicles` | hlášení z pluginu, vyžaduje `Authorization: Bearer <token>` (formát níže) |
| DELETE | `/api/vehicles/<id>` | odebrání vozu |
| GET | `/api/maps/<mapa>` | podklad mapy (silnice) |
| POST | `/api/maps/<mapa>` | nahrání podkladu z programu, vyžaduje token z `mapTokens`; volitelně commit do GitHubu |

GET požadavky mají povolený CORS, takže tabule na GitHub Pages může brát data ze serveru jinde:
stačí nastavit `apiBase` v `data/config.json`, nebo přidat `?api=https://muj-server.cz` do adresy tabule.

### Formát hlášení

Plugin OmsiTabule posílá celý snímek hráče najednou. Vozy téhož `source.id`, které ve snímku
chybí, server smaže. ID vozu na serveru je `source.id:id`.

```json
{
  "source": { "id": "omsi-MUJPC", "driver": "Vlasta", "map": "autobahnmap", "gameTime": "14:32" },
  "vehicles": [
    { "id": "1234", "ai": false, "route": "201", "headsign": "Nemocnice", "nextStop": "Lovosice, aut. nádr.", "delay": 120, "speed": 42,
      "vehicle": "SOR NB 12", "passengers": 14, "x": -512.3, "y": 1890.0, "heading": 87.5 },
    { "id": "5678", "ai": true,  "route": "210", "headsign": "Maxičky",   "nextStop": "Lovosice, nemocnice", "delay": -30 }
  ]
}
```

`x`/`y` jsou metry od středové dlaždice mapy, `heading` směr jízdy ve stupních; zatím se jen ukládají
(připravené pro budoucí mapu vozů).

Starší plugin posílá jeden vůz bez `source`/`vehicles` (`{ "id": …, "route": …, … }`), i to se přijme.
Nejvýš 300 vozů v dávce, 256 KB na požadavek.

Každý hráč má v OMSI vlastní AI vozy. Když stejný spoj hlásí víc hráčů, tabule ukáže jen jeden
(přednost má vůz řízený hráčem).

## Jak se páruje živý vůz se zastávkou

1. Z jízdních řádů mapy se vyberou trasy se stejnou linkou (a pokud sedí, i se stejným směrem).
2. V trase se najde příští zastávka vozu a za ní zastávka tabule.
3. Čas do odjezdu = rozdíl `offset` těchto dvou zastávek.
4. Živý vůz nahradí plánovaný spoj, kterému odpovídá (plánovaný čas = ETA − zpoždění).
