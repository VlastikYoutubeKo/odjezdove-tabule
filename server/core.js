/*
 * Jádro serveru nezávislé na prostředí – používá ho Node.js server
 * (server/server.js) i Cloudflare Worker (worker/index.js).
 * Nečte soubory ani nic neukládá; data a vozy dostává jako parametry.
 */
"use strict";

const Departures = require("../assets/js/departures.js");

const DEFAULTS = {
  tokens: [], vehicleTimeoutSeconds: 60, clock: "real", timeZone: "Europe/Prague",
  // nahrávání map: bez tokenu je vypnuté (jinak by kdokoli mohl přepisovat mapy a commitovat na GitHub)
  mapTokens: [],
  github: null   // { token, repo: "owner/repo", branch }
};

// Připraví načtená data: { config, stops, timetables: [..] }
function indexData({ config, stops, timetables }) {
  const stopsFile = stops || { maps: [], stops: [] };
  const stopsById = {};
  stopsFile.stops.forEach((s) => { stopsById[s.id] = s; });
  const timetablesByMap = {};
  (timetables || []).forEach((tt) => {
    (timetablesByMap[tt.map] = timetablesByMap[tt.map] || []).push(tt);
  });
  return { boardConfig: config || {}, stopsFile, stopsById, timetablesByMap };
}

function resolveStop(data, ref) {
  if (!ref) return null;
  if (data.stopsById[ref]) return data.stopsById[ref];
  const n = Departures.normalize(ref);
  return data.stopsFile.stops.find((s) => Departures.normalize(s.name) === n) || null;
}

const str = (v, max) => (v == null || v === "" ? undefined : String(v).slice(0, max || 100));
const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? undefined : Number(v));

const MAX_BODY = 256 * 1024;
const MAX_BATCH = 300;

// Zkontroluje a očistí hlášení jednoho vozu. `source` = údaje společné pro dávku.
function sanitizeVehicle(data, body, now, source) {
  if (!body || typeof body !== "object") throw new Error("neplatná data");
  const src = source || {};
  const localId = str(body.id, 64);
  if (!localId) throw new Error("chybí id");
  const id = src.id ? src.id + ":" + localId : localId;
  const nextStop = resolveStop(data, body.nextStop);
  const gameTime = body.gameTime != null ? body.gameTime : src.gameTime;
  return {
    id,
    source: src.id,
    ai: body.ai === true,
    driver: body.ai === true ? undefined : str(body.driver != null ? body.driver : src.driver, 40),
    vehicle: str(body.vehicle, 60),
    map: str(body.map, 60) || str(src.map, 60) || (nextStop && nextStop.map) || undefined,
    route: str(body.route, 10),
    headsign: str(body.headsign, 80),
    nextStop: nextStop ? nextStop.id : str(body.nextStop, 80),
    nextStopName: nextStop ? nextStop.name : str(body.nextStop, 80),
    delay: num(body.delay),
    speed: num(body.speed),
    gameTime: /^\d{1,2}:\d{2}$/.test(String(gameTime)) ? String(gameTime) : undefined,
    x: num(body.x),
    y: num(body.y),
    heading: num(body.heading),
    passengers: num(body.passengers),
    updatedAt: now || Date.now()
  };
}

/**
 * Zpracuje hlášení z pluginu a zapíše ho do `store` (Map id → vůz).
 *  - jeden vůz:  { id, route, nextStop, … }                       (plugin v1)
 *  - dávka:      { source: { id, driver, map, gameTime }, vehicles: [ … ] }  (OmsiHook plugin)
 * Dávka je úplný snímek zdroje: vozy zdroje, které v ní chybí, se smažou.
 */
function applyReport(data, store, body, now) {
  now = now || Date.now();
  if (!body || typeof body !== "object") throw new Error("neplatná data");
  if (!Array.isArray(body.vehicles)) {
    const v = sanitizeVehicle(data, body, now);
    store.set(v.id, v);
    return { ok: true, accepted: 1, map: v.map || null, nextStop: v.nextStop || null };
  }
  const src = body.source || {};
  const sourceId = str(src.id, 64);
  if (!sourceId) throw new Error("chybí source.id");
  if (body.vehicles.length > MAX_BATCH) throw new Error("příliš mnoho vozů v dávce");
  const source = { id: sourceId, driver: src.driver, map: src.map, gameTime: src.gameTime };
  const seen = new Set();
  let accepted = 0;
  body.vehicles.forEach((raw) => {
    try {
      const v = sanitizeVehicle(data, raw, now, source);
      store.set(v.id, v);
      seen.add(v.id);
      accepted++;
    } catch (e) {
      // vadný vůz v dávce přeskočíme, ostatní přijmeme
    }
  });
  for (const [id, v] of store) if (v.source === sourceId && !seen.has(id)) store.delete(id);
  return { ok: true, accepted, map: str(src.map, 60) || null };
}

function isFresh(v, settings, now) {
  return v.updatedAt >= (now || Date.now()) - settings.vehicleTimeoutSeconds * 1000;
}

// Aktuální čas pro výpočet odjezdů: skutečný, nebo herní čas posledního vozu na mapě.
function nowFor(map, vehicles, settings) {
  const real = Departures.zonedNow(new Date(), settings.timeZone);
  if (settings.clock === "game") {
    const v = vehicles.filter((x) => x.map === map && x.gameTime)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (v) return { minutes: Departures.parseHM(v.gameTime), weekday: real.weekday };
  }
  return real;
}

// Tabule zastávky ze jízdních řádů a živých vozů (statické tabule řeší volající).
function liveBoard(data, stop, vehicles, settings) {
  const onMap = vehicles.filter((v) => !v.map || v.map === stop.map);
  return Departures.buildBoard({
    stop,
    config: data.boardConfig,
    timetables: data.timetablesByMap[stop.map] || [],
    vehicles: onMap,
    stopsById: data.stopsById,
    now: nowFor(stop.map, onMap, settings)
  });
}

function checkToken(settings, authorization) {
  if (!settings.tokens.length) return true;
  const h = authorization || "";
  return settings.tokens.includes(h.startsWith("Bearer ") ? h.slice(7) : "");
}

// ---------- mapové podklady (silnice) ----------

const MAX_MAP_BODY = 20 * 1024 * 1024;
const MAX_MAP_LINES = 300000;
const MAP_ID = /^[\w-]{1,60}$/;

function checkMapToken(settings, authorization) {
  if (!settings.mapTokens || !settings.mapTokens.length) return "disabled";
  const h = authorization || "";
  return settings.mapTokens.includes(h.startsWith("Bearer ") ? h.slice(7) : "") ? "ok" : "denied";
}

/** Zkontroluje nahranou mapu (formát z OmsiTabule / tools/import-omsi.js) a vrátí data/maps/<id>.json. */
function normalizeMap(body, id) {
  if (!body || typeof body !== "object") throw new Error("neplatná data mapy");
  const mapId = id || (body.map && (typeof body.map === "string" ? body.map : body.map.id));
  if (!mapId || !MAP_ID.test(mapId)) throw new Error("neplatné ID mapy");
  const layers = body.layers || body;
  let count = 0;
  const clean = (lines) => (Array.isArray(lines) ? lines : []).filter((l) => {
    const ok = Array.isArray(l) && l.length >= 4 && l.length % 2 === 0 && l.every(Number.isFinite);
    if (ok) count++;
    return ok;
  });
  const out = {
    map: mapId,
    name: str((body.map && body.map.name) || body.name || mapId, 100),
    roads: clean(layers.roads),
    rails: clean(layers.rails)
  };
  if (count > MAX_MAP_LINES) throw new Error("mapa má příliš mnoho úseků");
  if (!count) throw new Error("mapa neobsahuje žádné silnice ani koleje");
  return out;
}

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Uloží soubor do repozitáře přes GitHub API (vytvoří nebo přepíše, jeden commit).
 * github = { token, repo: "owner/repo", branch }
 */
async function commitToGitHub(github, path, content, message) {
  const base = "https://api.github.com/repos/" + github.repo + "/contents/" + path.split("/").map(encodeURIComponent).join("/");
  const headers = {
    Authorization: "Bearer " + github.token,
    Accept: "application/vnd.github+json",
    "User-Agent": "odjezdove-tabule",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const branch = github.branch || "main";
  let sha;
  const cur = await fetch(base + "?ref=" + encodeURIComponent(branch), { headers });
  if (cur.ok) sha = (await cur.json()).sha;
  else if (cur.status !== 404) throw new Error("GitHub: " + cur.status + " " + (await cur.text()).slice(0, 200));
  const res = await fetch(base, {
    method: "PUT",
    headers: Object.assign({ "Content-Type": "application/json" }, headers),
    body: JSON.stringify({ message, content: utf8ToBase64(content), branch, sha })
  });
  if (!res.ok) throw new Error("GitHub: " + res.status + " " + (await res.text()).slice(0, 200));
  const out = await res.json();
  return out.commit && out.commit.html_url;
}

/** Seznam map pro /api/vehicles: mapy ze stops.json + nahrané mapy. */
function mapList(data, uploaded) {
  const maps = data.stopsFile.maps.slice();
  (uploaded || []).forEach((m) => { if (!maps.some((x) => x.id === m.id)) maps.push(m); });
  return maps;
}

module.exports = { DEFAULTS, MAX_BODY, MAX_MAP_BODY, checkMapToken, normalizeMap, commitToGitHub, mapList, utf8ToBase64, indexData, resolveStop, sanitizeVehicle, applyReport, isFresh, nowFor, liveBoard, checkToken };
