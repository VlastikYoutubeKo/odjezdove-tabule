# OmsiTabule (plugin přes OmsiHook)

Hlavní plugin projektu. Přes [OmsiHook](https://github.com/space928/Omsi-Extensions) čte paměť
OMSI 2, takže nezávisí na skriptech autobusu a vidí:

- **všechny autobusy jedoucí podle jízdního řádu**: vůz hráče i AI v načtené části mapy,
  s linkou, cílem, příští zastávkou a zpožděním,
- **název mapy a herní čas**,
- **celý jízdní řád mapy**, který umí vyexportovat do formátu `data/` (nemusíte ho přepisovat ručně).

> **Stav: čeká na první test ve hře.** Kód se přeloží proti OmsiHook 2.5.3 a export je pokrytý
> testy, ale nikdo ho zatím nespustil v OMSI. Postup testu je níže.

## Požadavky

- **OMSI 2 verze 2.3.004** (aktuální Steam). OmsiHook čte paměť na pevných adresách, jiná verze nefunguje.
- **.NET 8 Runtime pro x86**: <https://dotnet.microsoft.com/download/dotnet/8.0>, sekce „.NET Runtime“,
  instalátor **x86** (ne x64, OMSI je 32bitové). Novější verze .NET fungují taky.

## Stažení

GitHub → **Actions** → poslední úspěšný běh **CI** → dole **Artifacts**:

- `OmsiTabule-plugin`: plugin do OMSI,
- `OmsiTabule-program`: samostatný program (totéž, ale běží mimo hru).

## Instalace pluginu

1. Obsah `OmsiTabule-plugin` zkopírujte do `OMSI 2\plugins\` (všechny soubory, i `OmsiHook*.dll`).
2. V `plugins\OmsiTabule.ini` nastavte `server`, `token` a `driver`.
3. Spusťte OMSI. Plugin zapisuje do `plugins\OmsiTabule.log`.

Samostatný program: rozbalte `OmsiTabule-program` kamkoli, upravte `OmsiTabule.ini` vedle `.exe`,
spusťte OMSI a pak `OmsiTabule.exe`. Oba najednou nepoužívejte, posílaly by stejné vozy dvakrát.

## Test (pro testera)

Doporučené pořadí, od nejbezpečnějšího:

**1. Samostatný program, bez serveru.** Spusťte OMSI, načtěte mapu, sedněte do autobusu s jízdním
řádem a v příkazové řádce ve složce programu:

```
OmsiTabule.exe dump
```

Vypíše vozy, které vidí. Zkontrolujte, že sedí linka (`route`), cíl (`headsign`), příští zastávka
(`nextStop`) a zpoždění (`delay`, mělo by být v sekundách). Když jsou AI autobusy vidět, mají `"ai": true`.

**2. Export jízdního řádu:**

```
OmsiTabule.exe export
```

Vytvoří `export\<mapa>.json`. V logu je řádek „jednotka času minuty/sekundy“. Otevřete JSON
a porovnejte pár odjezdů (`departures`) a minut mezi zastávkami (`offset`) se skutečným jízdním
řádem v OMSI. Tady je největší riziko: jednotky časů v paměti OMSI nemáme ověřené.

**3. Odesílání na server.** Nastavte `server` v `.ini` na lokální server nebo Workers a spusťte
`OmsiTabule.exe` bez parametrů. Na webu otevřete **Vozy v provozu** a tabuli zastávky, kolem které jede
autobus.

**4. Plugin ve hře.** Až program funguje, zkuste plugin (instalace výše). Když OMSI spadne nebo se
nic neděje, pošlete `OmsiTabule.log`.

**Co poslat zpět:** výpis `dump`, `OmsiTabule.log` a exportovaný JSON (stačí kousek). Pokud něco nesedí,
napište, co ukazuje OMSI a co program.

## Vložení exportu do webu

```
node tools/import-omsi.js cesta\k\export\autobahnmap.json
```

Mapu a nové zastávky přidá do `data/stops.json` a jízdní řád uloží do `data/timetables/`.
Zastávky, které už v `data/stops.json` jsou (podle názvu), si ponechají svoje ID.
Pak commit a push (GitHub Pages), případně `npx wrangler deploy` (Workers).

## Nastavení (`OmsiTabule.ini`)

| Klíč | Význam |
|---|---|
| `server` | adresa `…/api/vehicles` |
| `token` | token ze serveru |
| `driver` | vaše jméno v seznamu vozů |
| `id` | ID hráče (výchozí: název počítače) |
| `map` | ID mapy z `data/stops.json`; prázdné = odvodí se z názvu mapy v OMSI |
| `interval` | jak často posílat, v sekundách |
| `include_ai` | posílat i AI autobusy (`1`/`0`) |
| `export_on_load` | po načtení mapy uložit jízdní řád do `export\` |
| `delay_scale` | převod zpoždění na sekundy, kdyby se ukázalo, že OMSI počítá jinak |
| `player_*_var` | záloha pro jízdu bez jízdního řádu OMSI: názvy string proměnných skriptu vozu |

## Jak to funguje

- `Core/OmsiReader.cs` čte přes OmsiHook `Globals.RoadVehicles` (u každého vozu pole
  `AI_Scheduled_*`), `Globals.Map`, `Globals.Time` a `Globals.TimeTableManager`.
- `Core/Exporter.cs` převádí linky → oběhy → spoje na trasy ve formátu `data/timetables/*.json`.
  Spoje se stejnou trasou, profilem a dny se sloučí do jedné trasy se seznamem odjezdů.
- `Core/Tracker.cs` každých `interval` sekund pošle snímek na server jako jednu dávku.
  Server ji bere jako úplný stav hráče: vozy, které z okolí zmizely, smaže.
- `Plugin/` je vstupní bod pro OMSI (nativní DLL vyrábí DNNE), `Cli/` je samostatný program.

Připojení běží s `AttachToOMSI(false)`, bez vzdáleného volání funkcí OMSI, takže plugin
OmsiHookRPCPlugin není potřeba.

## Překlad

```
dotnet test  Tests
dotnet build Plugin -c Release -o out\plugins     # jen Windows (DNNE potřebuje MSVC)
dotnet publish Cli  -c Release -o out\program
```

OmsiHook je pod licencí LGPL-3.0 a používá se jako nezměněná knihovna z NuGetu.
