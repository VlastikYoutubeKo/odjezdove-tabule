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

// Zkontroluje a očistí hlášení vozu z pluginu.
function sanitizeVehicle(data, body, now) {
  if (!body || typeof body !== "object") throw new Error("neplatná data");
  const id = str(body.id, 64);
  if (!id) throw new Error("chybí id");
  const nextStop = resolveStop(data, body.nextStop);
  return {
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
    updatedAt: now || Date.now()
  };
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

module.exports = { DEFAULTS, indexData, resolveStop, sanitizeVehicle, isFresh, nowFor, liveBoard, checkToken };
