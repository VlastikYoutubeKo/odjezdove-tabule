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
const Core = require("./core.js");

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
  { port: 8080, host: "0.0.0.0" },
  Core.DEFAULTS,
  readJson(path.join(__dirname, "config.json"), {})
);
if (process.env.PORT) serverConfig.port = Number(process.env.PORT);
if (process.env.TOKENS) serverConfig.tokens = process.env.TOKENS.split(",").filter(Boolean);

// ---- data (znovu se načtou při změně souborů) ----
let data;

function loadData() {
  const index = readJson(path.join(DATA, "timetables", "index.json"), { files: [] });
  data = Core.indexData({
    config: readJson(path.join(DATA, "config.json"), {}),
    stops: readJson(path.join(DATA, "stops.json"), { maps: [], stops: [] }),
    timetables: index.files.map((f) => readJson(path.join(DATA, "timetables", f)))
  });
  console.log(`Načteno: ${data.stopsFile.stops.length} zastávek, ${index.files.length} jízdních řádů`);
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

// ---- živé vozy (jen v paměti) ----
const vehicles = new Map();

function activeVehicles() {
  const now = Date.now();
  for (const [id, v] of vehicles) if (!Core.isFresh(v, serverConfig, now)) vehicles.delete(id);
  return [...vehicles.values()];
}

function boardFor(stopId) {
  const stop = data.stopsById[stopId];
  if (!stop) return null;
  if (stop.source === "static") return readJson(path.join(DATA, "boards", stopId + ".json"), null);
  return Core.liveBoard(data, stop, activeVehicles(), serverConfig);
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
  return Core.checkToken(serverConfig, req.headers.authorization);
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
    return send(res, 200, Object.assign({}, data.boardConfig, { apiBase: data.boardConfig.apiBase || "." }));
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
      const v = Core.sanitizeVehicle(data, body);
      vehicles.set(v.id, v);
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
      return send(res, 200, { maps: data.stopsFile.maps, vehicles: activeVehicles() });
    }
    if (p === "/api/stops") return send(res, 200, data.stopsFile);
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

module.exports = { server, vehicles, boardFor };
