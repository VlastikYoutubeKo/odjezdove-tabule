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

## Konfigurace (`server/config.json`)

| Klíč | Význam |
|---|---|
| `port`, `host` | kde server poslouchá (port lze přepsat proměnnou `PORT`) |
| `tokens` | seznam tokenů, které smí posílat vozy (lze přepsat `TOKENS=a,b`). Prázdný = kdokoli. |
| `vehicleTimeoutSeconds` | po kolika sekundách bez zprávy vůz zmizí |
| `clock` | `real` = odjezdy podle skutečného času, `game` = podle herního času posledního vozu na mapě |
| `timeZone` | časové pásmo odjezdů, výchozí `Europe/Prague` (důležité, když server běží v UTC) |

Změny v `data/` se načtou automaticky bez restartu.

## API

| Metoda | Cesta | Popis |
|---|---|---|
| GET | `/api/stops` | obsah `data/stops.json` |
| GET | `/api/boards/<id>` | tabule zastávky (stejný formát jako `data/boards/*.json`) |
| GET | `/api/vehicles` | vozy v provozu |
| POST | `/api/vehicles` | hlášení vozu (plugin), vyžaduje `Authorization: Bearer <token>` |
| DELETE | `/api/vehicles/<id>` | odebrání vozu |

GET požadavky mají povolený CORS, takže tabule na GitHub Pages může brát data ze serveru jinde:
stačí nastavit `apiBase` v `data/config.json`, nebo přidat `?api=https://muj-server.cz` do adresy tabule.

## Jak se páruje živý vůz se zastávkou

1. Z jízdních řádů mapy se vyberou trasy se stejnou linkou (a pokud sedí, i se stejným směrem).
2. V trase se najde příští zastávka vozu a za ní zastávka tabule.
3. Čas do odjezdu = rozdíl `offset` těchto dvou zastávek.
4. Živý vůz nahradí plánovaný spoj, kterému odpovídá (plánovaný čas = ETA − zpoždění).
