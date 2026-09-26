# Datové formáty

Všechna data jsou obyčejné JSON soubory ve složce `data/`. Stačí je upravit a nahrát na GitHub.

## `data/stops.json` – seznam zastávek

```json
{
  "maps": [{ "id": "autobahnmap", "name": "Autobahnmap" }],
  "stops": [
    { "id": "0000000001", "name": "Lovosice, aut. nádr.", "map": "autobahnmap", "source": "static" },
    { "id": "0000000002", "name": "Lovosice, nemocnice", "map": "autobahnmap", "source": "timetable" }
  ]
}
```

- `id` – libovolný text bez mezer, používá se v adrese `tabule.html?id=…`
- `map` – ID mapy ze seznamu `maps`
- `source`
  - `static` – tabule se čte ze souboru `data/boards/<id>.json` (hotová data, např. z jiného systému)
  - `timetable` – odjezdy se dopočítají z jízdních řádů v `data/timetables/`
- volitelně `dispatcherNote` / `dispatcherNoteEn` – vlastní text v patičce

## `data/timetables/*.json` – jízdní řády

Každý soubor musí být uvedený v `data/timetables/index.json`.

Jízdní řád nemusíte psát ručně: plugin OmsiTabule ho umí vyexportovat z OMSI a
`node tools/import-omsi.js export/<mapa>.json` ho sem vloží. `offset` může být i desetinné číslo.

```json
{
  "map": "autobahnmap",
  "routes": [
    {
      "route": "201",
      "headsign": "Nemocnice",
      "wheelchair": true,
      "days": [1, 2, 3, 4, 5],
      "note": "↬ 28.října",
      "color": "#e30613",
      "stops": [
        { "stop": "0000000001", "platform": "7", "offset": 0 },
        { "stop": "0000000002", "platform": "1", "offset": 6 }
      ],
      "departures": ["05:23", "06:23"],
      "every": { "from": "05:00", "to": "23:30", "interval": 15 }
    }
  ]
}
```

| Pole | Povinné | Význam |
|---|---|---|
| `route` | ano | číslo linky |
| `headsign` | ano | cíl (směr) zobrazený na tabuli |
| `stops` | ano | zastávky v pořadí; `offset` = minuty od výjezdu z první zastávky, `platform` = nástupiště |
| `departures` | * | seznam časů výjezdu z první zastávky |
| `every` | * | pravidelný interval (lze kombinovat s `departures`) |
| `days` | ne | dny provozu, 1 = pondělí … 7 = neděle (výchozí: každý den) |
| `wheelchair` | ne | přidá ♿ před cíl |
| `note`, `noteEn` | ne | poznámka pod cílem (např. jede přes…) |
| `color` | ne | barva čísla linky |

Z poslední zastávky trasy se odjezdy neukazují (je to konečná). Spoje přes půlnoc fungují.

## `data/boards/<id>.json` – hotová tabule

Stejný formát vrací i server na `/api/boards/<id>`, takže tabule se dá krmit z čehokoli, co ho umí vyrobit.

```json
{
  "StopId": "0000000001",
  "StopName": "Lovosice, aut. nádr.",
  "NoDataText": "V následujících 120 minutách nebyl nalezen žádný odjezd",
  "NoDataTextEn": "No departure was found in the following 120 minutes",
  "DispatcherNote": "www.ds-uk.cz  |  Autobahnmap v Česku",
  "DispatcherNoteEn": "www.ds-uk.cz  |  Autobahnmap in Czechia",
  "Advertising": { "URL": "https://example.com/reklama.jpg", "Duration": 10 },
  "Items": [
    { "Platform": "1", "RouteName": "607", "TimeToDeparture": "<1", "TripHeadsign": "♿ Most, gymnázium" },
    { "Platform": "7", "RouteName": "214", "TimeToDeparture": "55", "TripHeadsign": "Podskalí", "Note": "↬ 28.října" }
  ]
}
```

Položky v `Items` mohou mít navíc: `NoteEn`, `RouteColor`, `Live` (true = živý vůz), `Delay` (minuty).
`Advertising` je volitelné – obrázek se ukáže jednou za minutu na `Duration` sekund.

## Vlastní JSON odjinud

Tabule umí načíst libovolný JSON z jiné adresy:

```
tabule.html?src=https://example.com/moje-tabule.json
tabule.html?src=https://example.com/muj-jizdni-rad.json&id=0000000002
```

`src` může být hotová tabule (formát výše) nebo jízdní řád (pak je potřeba i `id` zastávky).
Server se souborem musí povolit CORS (GitHub Pages i raw.githubusercontent.com to dělají).

## `data/config.json` – nastavení tabulí

| Klíč | Význam |
|---|---|
| `apiBase` | adresa serveru s živými daty; prázdné = bez serveru |
| `refreshSeconds` | jak často se tabule obnovuje |
| `windowMinutes` | kolik minut dopředu hledat odjezdy |
| `maxRows` | počet řádků na tabuli |
| `languageSwitchSeconds` | interval střídání češtiny a angličtiny (`?lang=cs` střídání vypne) |
| `noDataText(En)`, `dispatcherNote(En)` | výchozí texty |

## `data/maps/<mapa>.json` – podklad pro mapu vozů

Silnice a koleje pro `mapa.html`. Vyrábí ho `OmsiTabule.exe mapa <složka mapy>` a do `data/` ho vloží
`node tools/import-omsi.js export/<mapa>-mapa.json`.

```json
{
  "map": "autobahnmap",
  "name": "Autobahnmap",
  "roads": [[753242.5, 3213020.4, 753239.8, 3213022.3]],
  "rails": []
}
```

Každá čára je plochý seznam souřadnic `[x0, y0, x1, y1, …]` v metrech (x = východ, y = sever,
dlaždice mapy × 300 + poloha na dlaždici) – ve stejném systému posílá polohy vozů plugin.
