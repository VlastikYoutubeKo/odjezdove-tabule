# odjezdove-tabule

Odjezdové tabule pro fiktivní mapu Autobahnmap do hry OMSI 2, případně i pro MHD Bílina.

- **Tabule** ve stylu zastávkových LCD panelů – `tabule.html?id=<zastávka>`, škáluje se na TV i mobil, střídá češtinu a angličtinu.
- **Vlastní data** – jízdní řády a zastávky jsou obyčejné JSON soubory v `data/`, tabule umí načíst i JSON z libovolné adresy. Viz [docs/DATOVY-FORMAT.md](docs/DATOVY-FORMAT.md).
- **Bez serveru** – s jízdními řády běží vše na GitHub Pages, odjezdy se počítají v prohlížeči.
- **Živá data z OMSI 2** (volitelné) – [plugin](plugin/omsi2-tracker/README.md) posílá stav vozu na server, ten ukazuje živé odjezdy se zpožděním a seznam vozů v provozu rozdělený podle map. Server běží buď [na Cloudflare Workers](worker/README.md) (zdarma, bez vlastního počítače), nebo [v Node.js](server/README.md) kdekoli jinde.

```
index.html               seznam zastávek podle map, vlastní JSON
tabule.html              odjezdová tabule
vozy.html                vozy v provozu (vyžaduje server)
assets/js/departures.js  výpočet odjezdů (sdílí prohlížeč i server)
data/                    zastávky, jízdní řády, hotové tabule, nastavení
server/                  Node.js server (příjem dat z pluginu, API); server/core.js = sdílená logika
worker/                  totéž jako Cloudflare Worker
plugin/omsi2-tracker/    plugin do OMSI 2 (C++, Win32 DLL)
```

## Rychlý start

Bez serveru: otevřete web na GitHub Pages, nebo lokálně `python3 -m http.server` a <http://localhost:8000>.

Na Cloudflare Workers: viz [worker/README.md](worker/README.md).

Se serverem v Node.js a živými daty:

```
cp server/config.example.json server/config.json
node server/server.js
node server/simulate.js      # smyšlené vozy na vyzkoušení
```

# Hledáme frontend/backend developery!
Z důvodu že tohle je můj první projekt s kámošem, hledám developery co by nám zprovoznili backend (odjezdy z určité zastávky) a frontend (styl, trochu to zvládnem, ale nemyslím si že to dopadne dobře)
Pro kontakt se mnou použijte [můj Discord](https://discord.com/users/696826147081814027), nebo [mojí email adresu](mailto:mapy.od.fanousku@post.cz)


# Discord
[![Discord Profile](https://discord.c99.nl/widget/theme-3/696826147081814027.png)](https://discord.com/users/696826147081814027)
