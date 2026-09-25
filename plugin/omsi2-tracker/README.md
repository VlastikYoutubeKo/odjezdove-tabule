# OMSI 2 Tracker (plugin)

Plugin do OMSI 2, který každých pár sekund pošle na server odjezdových tabulí stav vašeho vozu:
linku, směr, příští zastávku, zpoždění, rychlost a herní čas. Server z toho počítá živé odjezdy
na tabulích a ukazuje seznam vozů na stránce `vozy.html`.

> **Stav: experimentální.** DLL se přeloží a exportuje správné funkce pluginového rozhraní OMSI 2,
> ale ve hře zatím otestovaný nebyl. Hlavně je potřeba ověřit názvy proměnných (viz níže).

## Co plugin umí a co ne

- Plugin vidí **jen vůz, který právě řídíte** (to je omezení pluginového rozhraní OMSI).
  AI vozy neposílá. „Všechny vozy“ tedy znamená všichni hráči, kteří mají plugin nainstalovaný.
- Mapu OMSI pluginu nesděluje. Buď ji nastavte v `omsi2tracker.ini` (`map=autobahnmap`),
  nebo ji server odhadne podle názvu příští zastávky.
- Souřadnice vozu OMSI standardně pluginu nedává. Kód umí poslat `x`/`y`, pokud je doplníte
  jako 3. a 4. proměnnou do `[varlist]` (musíte je mít ve skriptu vozu).

## Instalace

1. Stáhněte `omsi2tracker.dll` (GitHub → Actions → poslední běh CI → artefakt `omsi2tracker`),
   nebo si ho přeložte (níže).
2. Zkopírujte `omsi2tracker.dll`, `omsi2tracker.opl` a `omsi2tracker.ini` do složky
   `OMSI 2\plugins\`.
3. V `omsi2tracker.ini` nastavte adresu serveru, token a svoje jméno.
4. Upravte názvy proměnných v `omsi2tracker.opl` podle skriptů vašeho autobusu.

## Proměnné (`omsi2tracker.opl`)

Plugin čte proměnné **podle pořadí**, ne podle názvu. Pořadí proto neměňte, jen názvy:

| Sekce | Pořadí | Význam | Výchozí název |
|---|---|---|---|
| `[varlist]` | 1 | rychlost v km/h | `Velocity` |
| `[varlist]` | 2 | zpoždění (sekundy; jinak nastavte `delay_scale`) | `IBIS_Delay` |
| `[varlist]` | 3, 4 | volitelně souřadnice X, Y | – |
| `[stringvarlist]` | 1 | číslo linky | `IBIS_Linie` |
| `[stringvarlist]` | 2 | cílová zastávka (směr) | `IBIS_Ziel` |
| `[stringvarlist]` | 3 | příští zastávka | `IBIS_NextStop` |
| `[systemvarlist]` | 1 | herní čas (sekundy od půlnoci) | `Time` |
| `[systemvarlist]` | 2 | pauza | `Pause` |

Výchozí názvy u IBISu jsou **zástupné**. Každý autobus má jiné skripty, takže správné názvy
najdete ve `vars.txt` / `stringvars.txt` ve složce skriptů vozu (`Vehicles\<vůz>\script\`).
Počet v hlavičce sekce (`2`, `3`, …) musí odpovídat počtu řádků pod ním.

Názvy zastávek posílané pluginem se na serveru párují s názvy v `data/stops.json`
(bez ohledu na velikost písmen a diakritiku), nebo přímo s ID zastávky.

## Překlad

OMSI 2 je 32bitové, DLL musí být **Win32 (x86)**.

**Windows, Visual Studio:**

```
cmake -S . -B build -A Win32
cmake --build build --config Release
```

**Linux, MinGW:**

```
sudo apt install g++-mingw-w64-i686
./build-mingw.sh
```

## Co se posílá

`POST /api/vehicles` s hlavičkou `Authorization: Bearer <token>`:

```json
{
  "id": "omsi-MUJPC", "driver": "Vlasta", "vehicle": "SOR NB 12", "map": "autobahnmap",
  "route": "201", "headsign": "Nemocnice", "nextStop": "Lovosice, aut. nádr.",
  "delay": 120, "speed": 42.5, "gameTime": "14:32"
}
```
