# OmsiTabule (plugin přes OmsiHook)

Hlavní plugin projektu. Přes [OmsiHook](https://github.com/space928/Omsi-Extensions) čte paměť
OMSI 2, takže nezávisí na skriptech autobusu a vidí:

- **všechny autobusy jedoucí podle jízdního řádu**: vůz hráče i AI v načtené části mapy,
  s linkou, cílem, příští zastávkou a zpožděním,
- **polohu a směr jízdy** každého vozu (metry od středu mapy), počet cestujících a výrobce/model vozu,
- **název mapy a herní čas**,
- **celý jízdní řád mapy**, který umí vyexportovat do formátu `data/` (nemusíte ho přepisovat ručně),
- **silnice mapy** jako podklad pro živou mapu vozů na webu.

> **Stav: čeká na první test ve hře.** Kód se přeloží proti OmsiHook 2.5.3 a export je pokrytý
> testy, ale nikdo ho zatím nespustil v OMSI. Postup testu je níže.

## Požadavky

- **OMSI 2 verze 2.3.004** (aktuální Steam). OmsiHook čte paměť na pevných adresách, jiná verze nefunguje.
- **.NET 8 Runtime pro x86**: <https://dotnet.microsoft.com/download/dotnet/8.0>, sekce „.NET Runtime“,
  instalátor **x86** (ne x64, OMSI je 32bitové). Novější verze .NET fungují taky.

## Stažení

Hotové verze jsou na GitHubu v sekci **Releases**:

- `OmsiTabule-plugin-<verze>.zip`: plugin do OMSI,
- `OmsiTabule-program-<verze>.zip`: samostatný program (totéž, ale běží mimo hru),
- `omsi2tracker-zaloha-<verze>.zip`: záložní jednoduchý plugin.

Vývojové buildy z každého commitu jsou v **Actions** → běh **CI** → **Artifacts**.

### Vydání nové verze

GitHub → **Releases** → **Draft a new release** → *Choose a tag* → napište nový tag, např. `0.2`
nebo `v1.0.0` → **Publish release**. Workflow `Release` pak sám postaví všechny balíčky a přiloží
je k releasu (trvá to pár minut); váš popis releasu zůstane a návod se připojí na konec.

Když k releasu ZIPy nepřibudou (nebo jde o starší release), spusťte ručně: **Actions** → **Release**
→ **Run workflow** → zadejte název tagu (např. `0.1`). U existujícího tagu se staví přesně jeho commit.
Verze s pomlčkou (`1.1.0-beta.1`) se označí jako předběžná.

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

## Podklad pro mapu vozů (silnice)

**Nejjednodušší cesta:** spusťte `OmsiTabule.exe`, když OMSI **neběží**. Program najde OMSI přes
Steam (nebo podle `omsi_dir` v `.ini`), nabídne seznam map, vyberete číslo a silnice se pošlou
na server. Ten je hned ukazuje na `mapa.html` a (pokud to má správce zapnuté) uloží je i do
GitHubu. Potřebujete `map_token` od správce serveru. Totéž bez menu:
`OmsiTabule.exe nahrat "…\OMSI 2\maps\Autobahnmap" autobahnmap`.

Ruční cesta přes soubor:

Mapa na webu (`mapa.html`) umí pod autobusy vykreslit skutečné silnice z mapy OMSI:

```
OmsiTabule.exe mapa "C:\Program Files (x86)\Steam\steamapps\common\OMSI 2\maps\Autobahnmap" autobahnmap
```

OMSI k tomu nemusí běžet. Program přečte všechny `tile_X_Y.map` ve složce mapy a uloží
`export\autobahnmap-mapa.json` (poslední parametr je ID mapy z `data/stops.json`). Plugin totéž
udělá sám po načtení mapy, pokud najde její složku. Do webu se soubor vloží stejně jako jízdní řád:

```
node tools/import-omsi.js export\autobahnmap-mapa.json
```

→ `data/maps/autobahnmap.json`. Kreslí se silnice a koleje; vodorovné značení a neviditelné cesty
AI se vynechávají. Polohy vozů i silnice jsou ve stejných souřadnicích (dlaždice × 300 m + poloha
na dlaždici), takže na sebe sedí. **Při testu ověřte:** plugin do logu zapíše „Vůz hráče: dlaždice X_Y“
– čísla by měla odpovídat souboru `tile_X_Y.map`, na kterém autobus stojí.

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
| `driver` | vaše jméno v seznamu vozů; prázdné = přezdívka z účtu Steam |
| `id` | ID hráče (výchozí: název počítače) |
| `map` | ID mapy z `data/stops.json`; prázdné = odvodí se z názvu mapy v OMSI |
| `interval` | jak často posílat, v sekundách |
| `include_ai` | posílat i AI autobusy (`1`/`0`) |
| `export_on_load` | po načtení mapy uložit jízdní řád do `export\` |
| `check_version` | na jiné verzi OMSI než 2.3.004 nic neposílat (`1`/`0`) |
| `omsi_dir` | složka OMSI 2; prázdné = najde se přes Steam |
| `map_token` | token pro nahrávání map na server |
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

- Poloha: OMSI drží polohu vozu relativně k dlaždici 300 × 300 m, takže
  `x = (MyKachelPnt.x − Map.CenterKachel.x) · 300 + Position.x`, obdobně `y` z `Position.z`.
  Směr jízdy je `atan2(Pos_Mat._20, Pos_Mat._22)` ve stupních.
- Verze OMSI se čte z `logfile.txt` v adresáři hry (řádek `Version: 2.3.004`). Na jiné verzi
  plugin nic neposílá, protože adresy v paměti by nesedělo.

Připojení běží s `AttachToOMSI(false)`, bez vzdáleného volání funkcí OMSI, takže plugin
OmsiHookRPCPlugin není potřeba.

## Překlad

```
dotnet test  Tests
dotnet build Plugin -c Release -o out\plugins     # jen Windows (DNNE potřebuje MSVC)
dotnet publish Cli  -c Release -o out\program
```

OmsiHook je pod licencí LGPL-3.0 a používá se jako nezměněná knihovna z NuGetu.
