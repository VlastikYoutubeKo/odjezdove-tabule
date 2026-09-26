/*
 * Server odjezdových tabulí jako Cloudflare Worker.
 *
 *  - frontend a data/ servíruje Workers Static Assets (binding ASSETS)
 *  - /api/* obsluhuje Durable Object VehicleHub, který drží vozy v paměti
 *  - logika je sdílená s Node.js serverem (server/core.js)
 */
import { DurableObject } from "cloudflare:workers";
import Core from "../server/core.js";

const DATA_TTL_MS = 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS }
  });
}

async function asset(env, path) {
  const res = await env.ASSETS.fetch(new Request("https://assets.local/" + path));
  if (!res.ok) throw new Error(path + ": HTTP " + res.status);
  return res.json();
}

function settingsFrom(env) {
  return {
    ...Core.DEFAULTS,
    tokens: (env.TOKENS || "").split(",").map((t) => t.trim()).filter(Boolean),
    clock: env.CLOCK || Core.DEFAULTS.clock,
    timeZone: env.TIME_ZONE || Core.DEFAULTS.timeZone,
    vehicleTimeoutSeconds: Number(env.VEHICLE_TIMEOUT_SECONDS) || Core.DEFAULTS.vehicleTimeoutSeconds
  };
}

export class VehicleHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.settings = settingsFrom(env);
    this.vehicles = new Map();
    this.data = null;
    this.loadedAt = 0;
  }

  // Data z data/ se načítají ze statických souborů a drží se minutu v paměti.
  async getData() {
    if (!this.data || Date.now() - this.loadedAt > DATA_TTL_MS) {
      const [config, stops, index] = await Promise.all([
        asset(this.env, "data/config.json").catch(() => ({})),
        asset(this.env, "data/stops.json"),
        asset(this.env, "data/timetables/index.json").catch(() => ({ files: [] }))
      ]);
      const timetables = await Promise.all(index.files.map((f) => asset(this.env, "data/timetables/" + f)));
      this.data = Core.indexData({ config, stops, timetables });
      this.loadedAt = Date.now();
    }
    return this.data;
  }

  activeVehicles() {
    const now = Date.now();
    for (const [id, v] of this.vehicles) if (!Core.isFresh(v, this.settings, now)) this.vehicles.delete(id);
    return [...this.vehicles.values()];
  }

  unauthorized(request) {
    if (Core.checkToken(this.settings, request.headers.get("Authorization"))) return null;
    return json({ error: "neplatný token" }, 401);
  }

  async fetch(request) {
    const url = new URL(request.url);
    const p = url.pathname;
    const data = await this.getData();

    if (p === "/api/vehicles" && request.method === "POST") {
      const denied = this.unauthorized(request);
      if (denied) return denied;
      const text = await request.text();
      if (text.length > Core.MAX_BODY) return json({ error: "příliš velké tělo" }, 413);
      return json(Core.applyReport(data, this.vehicles, JSON.parse(text)));
    }
    const del = /^\/api\/vehicles\/([^/]+)$/.exec(p);
    if (del && request.method === "DELETE") {
      const denied = this.unauthorized(request);
      if (denied) return denied;
      this.vehicles.delete(decodeURIComponent(del[1]));
      return json({ ok: true });
    }
    if (request.method !== "GET") return json({ error: "nepodporovaná metoda" }, 405);

    if (p === "/api/vehicles") return json({ maps: data.stopsFile.maps, vehicles: this.activeVehicles() });
    if (p === "/api/stops") return json(data.stopsFile);
    const b = /^\/api\/boards\/([^/]+?)(\.json)?$/.exec(p);
    if (b) {
      const stop = data.stopsById[decodeURIComponent(b[1])];
      if (!stop) return json({ error: "neznámá zastávka" }, 404);
      if (stop.source === "static") return json(await asset(this.env, "data/boards/" + stop.id + ".json"));
      return json(Core.liveBoard(data, stop, this.activeVehicles(), this.settings));
    }
    return json({ error: "nenalezeno" }, 404);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    // Frontend servírovaný Workerem má brát data z jeho API.
    if (url.pathname === "/data/config.json") {
      const config = await asset(env, "data/config.json").catch(() => ({}));
      return json({ ...config, apiBase: config.apiBase || "." });
    }

    if (url.pathname.startsWith("/api/")) {
      // Neoprávněné zápisy odmítneme hned, ať se tělo zbytečně nepředává dál.
      if (request.method !== "GET" && !Core.checkToken(settingsFrom(env), request.headers.get("Authorization"))) {
        await request.arrayBuffer();
        return json({ error: "neplatný token" }, 401);
      }
      try {
        // Jeden globální objekt → všichni hráči i tabule vidí stejné vozy.
        const hub = env.HUB.get(env.HUB.idFromName("global"));
        return await hub.fetch(request);
      } catch (e) {
        return json({ error: e.message }, 400);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
