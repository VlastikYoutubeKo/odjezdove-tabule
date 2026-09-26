/*
 * Jádro serveru nezávislé na prostředí – používá ho Node.js server
 * (server/server.js) i Cloudflare Worker (worker/index.js).
 * Nečte soubory ani nic neukládá; data a vozy dostává jako parametry.
 */
"use strict";

const Departures = require("../assets/js/departures.js");

const DEFAULTS = { tokens: [], vehicleTimeoutSeconds: 60, clock: "real", timeZone: "Europe/Prague" };

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

module.exports = { DEFAULTS, MAX_BODY, indexData, resolveStop, sanitizeVehicle, applyReport, isFresh, nowFor, liveBoard, checkToken };
