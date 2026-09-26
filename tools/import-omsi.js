#!/usr/bin/env node
/*
 * Vloží export z pluginu OmsiTabule do data/:
 *  - jízdní řád (export/<mapa>.json)       → data/stops.json + data/timetables/<mapa>.json
 *  - silnice mapy (export/<mapa>-mapa.json) → data/maps/<mapa>.json (podklad pro mapa.html)
 *
 *   node tools/import-omsi.js cesta/k/autobahnmap.json [--data data]
 *
 *  - mapu přidá do data/stops.json (pokud tam není)
 *  - zastávky se stejným názvem jako existující zastávky mapy použijí jejich ID,
 *    nové zastávky se přidají
 *  - jízdní řád zapíše do data/timetables/<mapa>.json a přidá ho do index.json
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { normalize } = require("../assets/js/departures.js");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (fallback !== undefined) return fallback; throw e; }
}
function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function importMap(exp, dataDir) {
  const mapId = exp.map && exp.map.id;
  if (!mapId || !/^[\w-]+$/.test(mapId)) throw new Error("Export mapy nemá platné ID mapy.");
  const layers = exp.layers || {};
  const clean = (lines) => (Array.isArray(lines) ? lines : [])
    .filter((l) => Array.isArray(l) && l.length >= 4 && l.length % 2 === 0 && l.every(Number.isFinite));
  const out = { map: mapId, name: (exp.map.name || mapId), roads: clean(layers.roads), rails: clean(layers.rails) };
  const dir = path.join(dataDir, "maps");
  fs.mkdirSync(dir, { recursive: true });
  // bez odsazení – soubor bývá velký
  fs.writeFileSync(path.join(dir, mapId + ".json"), JSON.stringify(out) + "\n");

  const stopsPath = path.join(dataDir, "stops.json");
  const stopsFile = readJson(stopsPath, { maps: [], stops: [] });
  if (!stopsFile.maps.some((m) => m.id === mapId)) {
    stopsFile.maps.push({ id: mapId, name: out.name });
    writeJson(stopsPath, stopsFile);
  }
  return { kind: "mapa", mapId, roads: out.roads.length, rails: out.rails.length };
}

function importExport(exp, dataDir) {
  if (exp && exp.format === "odjezdove-tabule-mapa") return importMap(exp, dataDir);
  if (!exp || exp.format !== "odjezdove-tabule-export") throw new Error("Soubor není export z OmsiTabule.");
  const mapId = exp.map && exp.map.id;
  if (!mapId || !/^[\w-]+$/.test(mapId)) throw new Error("Export nemá platné ID mapy.");

  const stopsPath = path.join(dataDir, "stops.json");
  const stopsFile = readJson(stopsPath, { maps: [], stops: [] });
  if (!stopsFile.maps.some((m) => m.id === mapId)) stopsFile.maps.push({ id: mapId, name: exp.map.name || mapId });

  const idMap = {};
  let added = 0, reused = 0;
  const taken = new Set(stopsFile.stops.map((s) => s.id));
  (exp.stops || []).forEach((s) => {
    const existing = stopsFile.stops.find((x) => x.map === mapId && normalize(x.name) === normalize(s.name));
    if (existing) { idMap[s.id] = existing.id; reused++; return; }
    let id = s.id;
    if (taken.has(id)) id = mapId + "-" + s.id;
    taken.add(id);
    stopsFile.stops.push({ id, name: s.name, map: mapId, source: "timetable" });
    idMap[s.id] = id;
    added++;
  });

  const routes = ((exp.timetable && exp.timetable.routes) || []).map((r) => Object.assign({}, r, {
    stops: r.stops.map((st) => Object.assign({}, st, { stop: idMap[st.stop] || st.stop }))
  }));

  const ttDir = path.join(dataDir, "timetables");
  fs.mkdirSync(ttDir, { recursive: true });
  const ttFile = mapId + ".json";
  writeJson(path.join(ttDir, ttFile), { map: mapId, routes });
  const indexPath = path.join(ttDir, "index.json");
  const index = readJson(indexPath, { files: [] });
  if (!index.files.includes(ttFile)) index.files.push(ttFile);
  writeJson(indexPath, index);
  writeJson(stopsPath, stopsFile);

  return { mapId, routes: routes.length, added, reused, timeUnit: exp.timeUnit };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const di = args.indexOf("--data");
  const dataDir = path.resolve(di >= 0 ? args[di + 1] : path.join(__dirname, "..", "data"));
  if (!file) {
    console.error("Použití: node tools/import-omsi.js <export.json> [--data data]");
    process.exit(2);
  }
  try {
    const r = importExport(readJson(file), dataDir);
    if (r.kind === "mapa") {
      console.log(`Mapa ${r.mapId}: ${r.roads} úseků silnic, ${r.rails} kolejí → data/maps/${r.mapId}.json`);
      process.exit(0);
    }
    console.log(`Mapa ${r.mapId}: ${r.routes} tras, ${r.added} nových zastávek, ${r.reused} existujících.`);
    if (r.timeUnit && r.timeUnit !== "minutes") console.log(`Pozor: časy v OMSI vypadaly jako ${r.timeUnit} – zkontrolujte odjezdy.`);
  } catch (e) {
    console.error("Chyba: " + e.message);
    process.exit(1);
  }
}

module.exports = { importExport, importMap };
