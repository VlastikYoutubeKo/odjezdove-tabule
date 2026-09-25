#!/usr/bin/env node
/*
 * Server odjezdových tabulí.
 *
 *  - servíruje frontend (index.html, tabule.html, …) z kořene repozitáře
 *  - přijímá polohy vozů z pluginu OMSI 2 (POST /api/vehicles)
 *  - počítá odjezdy ze zastávek z jízdních řádů + živých vozů
 *
 * Bez závislostí, stačí Node.js 18+:  node server/server.js
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const Departures = require("../assets/js/departures.js");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}

const serverConfig = Object.assign(
  { port: 8080, host: "0.0.0.0", tokens: [], vehicleTimeoutSeconds: 60, clock: "real" },
  readJson(path.join(__dirname, "config.json"), {})
);
if (process.env.PORT) serverConfig.port = Number(process.env.PORT);
if (process.env.TOKENS) serverConfig.tokens = process.env.TOKENS.split(",").filter(Boolean);

// ---- data (znovu se načtou při změně souborů) ----
let boardConfig, stopsFile, stopsById, timetablesByMap;

function loadData() {
  boardConfig = readJson(path.join(DATA, "config.json"), {});
  stopsFile = readJson(path.join(DATA, "stops.json"), { maps: [], stops: [] });
  stopsById = {};
  stopsFile.stops.forEach((s) => { stopsById[s.id] = s; });
  const index = readJson(path.join(DATA, "timetables", "index.json"), { files: [] });
  timetablesByMap = {};
  index.files.forEach((f) => {
    const tt = readJson(path.join(DATA, "timetables", f));
    (timetablesByMap[tt.map] = timetablesByMap[tt.map] || []).push(tt);
  });
  console.log(`Načteno: ${stopsFile.stops.length} zastávek, ${index.files.length} jízdních řádů`);
}
loadData();
function watchData() {
  let reloadTimer = null;
  try {
    fs.watch(DATA, { recursive: true }, () => {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        try { loadData(); } catch (e) { console.error("Chyba v datech:", e.message); }
      }, 300);
    });
  } catch (e) {
    // fs.watch recursive není všude podporováno – data se pak načtou jen při startu
  }
}

// ---- živé vozy ----
const vehicles = new Map();

function resolveStop(ref) {
  if (!ref) return null;
  if (stopsById[ref]) return stopsById[ref];
  const n = Departures.normalize(ref);
  return stopsFile.stops.find((s) => Departures.normalize(s.name) === n) || null;
}

function activeVehicles() {
  const limit = Date.now() - serverConfig.vehicleTimeoutSeconds * 1000;
  for (const [id, v] of vehicles) if (v.updatedAt < limit) vehicles.delete(id);
  return [...vehicles.values()];
}

const str = (v, max) => (v == null ? undefined : String(v).slice(0, max || 100));
const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? undefined : Number(v));

function acceptVehicle(body, remote) {
  const id = str(body.id, 64);
  if (!id) throw new Error("chybí id");
  const nextStop = resolveStop(body.nextStop);
  const v = {
    id,
    driver: str(body.driver, 40),
    vehicle: str(body.vehicle, 60),
    map: str(body.map, 60) || (nextStop && nextStop.map) || undefined,
    route: str(body.route, 10),
    headsign: str(body.headsign, 80),
    nextStop: nextStop ? nextStop.id : str(body.nextStop, 80),
    nextStopName: nextStop ? nextStop.name : str(body.nextStop, 80),
    delay: num(body.delay),
    speed: num(body.speed),
    gameTime: /^\d{1,2}:\d{2}$/.test(String(body.gameTime)) ? String(body.gameTime) : undefined,
    x: num(body.x),
    y: num(body.y),
    updatedAt: Date.now(),
    remote
  };
  vehicles.set(id, v);
  return v;
}

function publicVehicle(v) {
  const o = Object.assign({}, v);
  delete o.remote;
  return o;
}

// Herní čas mapy = čas naposledy aktualizovaného vozu na mapě.
function nowFor(map, active) {
  if (serverConfig.clock === "game") {
    const v = active.filter((x) => x.map === map && x.gameTime)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (v) {
      const date = new Date();
      return { minutes: Departures.parseHM(v.gameTime), weekday: date.getDay() || 7 };
    }
  }
  return new Date();
}

function boardFor(stopId) {
  const stop = stopsById[stopId];
  if (!stop) return null;
  if (stop.source === "static") {
    return readJson(path.join(DATA, "boards", stopId + ".json"), null);
  }
  const active = activeVehicles().filter((v) => !v.map || v.map === stop.map);
  return Departures.buildBoard({
    stop,
    config: boardConfig,
    timetables: timetablesByMap[stop.map] || [],
    vehicles: active,
    stopsById,
    now: nowFor(stop.map, active)
  });
}

// ---- HTTP ----
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};
const STATIC_DIRS = ["assets", "data", "docs"];

function send(res, status, body, type) {
  res.writeHead(status, {
    "Content-Type": type || "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store"
  });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function authorized(req) {
  if (!serverConfig.tokens.length) return true;
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  return serverConfig.tokens.includes(token);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 16 * 1024) { reject(new Error("příliš velké tělo")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  if (pathname === "/") pathname = "/index.html";
  const rel = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  const top = rel.split(path.sep)[0];
  const allowed = STATIC_DIRS.includes(top) || /^[\w-]+\.html$/.test(rel);
  const file = path.join(ROOT, rel);
  if (!allowed || !file.startsWith(ROOT + path.sep)) return send(res, 404, { error: "nenalezeno" });
  // Frontend servírovaný tímto serverem má brát data z API tohoto serveru.
  if (rel === path.join("data", "config.json")) {
    return send(res, 200, Object.assign({}, boardConfig, { apiBase: boardConfig.apiBase || "." }));
  }
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: "nenalezeno" });
    send(res, 200, buf, MIME[path.extname(file)] || "application/octet-stream");
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      return send(res, 204, "");
    }
    if (p === "/api/vehicles" && req.method === "POST") {
      if (!authorized(req)) return send(res, 401, { error: "neplatný token" });
      const body = JSON.parse(await readBody(req));
      const v = acceptVehicle(body, req.socket.remoteAddress);
      return send(res, 200, { ok: true, map: v.map || null, nextStop: v.nextStop || null });
    }
    const del = /^\/api\/vehicles\/([^/]+)$/.exec(p);
    if (del && req.method === "DELETE") {
      if (!authorized(req)) return send(res, 401, { error: "neplatný token" });
      vehicles.delete(decodeURIComponent(del[1]));
      return send(res, 200, { ok: true });
    }
    if (req.method !== "GET") return send(res, 405, { error: "nepodporovaná metoda" });

    if (p === "/api/vehicles") {
      return send(res, 200, { maps: stopsFile.maps, vehicles: activeVehicles().map(publicVehicle) });
    }
    if (p === "/api/stops") return send(res, 200, stopsFile);
    const b = /^\/api\/boards\/([^/]+?)(\.json)?$/.exec(p);
    if (b) {
      const board = boardFor(decodeURIComponent(b[1]));
      return board ? send(res, 200, board) : send(res, 404, { error: "neznámá zastávka" });
    }
    if (p.startsWith("/api/")) return send(res, 404, { error: "nenalezeno" });
    return serveStatic(req, res, p);
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
});

if (require.main === module) {
  watchData();
  server.listen(serverConfig.port, serverConfig.host, () => {
    console.log(`Server běží na http://localhost:${serverConfig.port}`);
    if (!serverConfig.tokens.length) console.log("POZOR: nejsou nastaveny tokeny, zápis vozů je otevřený komukoli.");
  });
}

module.exports = { server, vehicles, boardFor, acceptVehicle };
