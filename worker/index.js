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
    vehicleTimeoutSeconds: Number(env.VEHICLE_TIMEOUT_SECONDS) || Core.DEFAULTS.vehicleTimeoutSeconds,
    mapTokens: (env.MAP_TOKENS || "").split(",").map((t) => t.trim()).filter(Boolean),
    github: env.GITHUB_TOKEN && env.GITHUB_REPO
      ? { token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH || "main" }
      : null
  };
}

// Nahrané mapy se ukládají do úložiště Durable Objectu po kouscích (jedna hodnota má omezenou velikost).
const MAP_CHUNK = 512 * 1024;

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

  async putMap(map) {
    const text = JSON.stringify(map);
    const entries = {};
    const chunks = Math.ceil(text.length / MAP_CHUNK);
    for (let i = 0; i < chunks; i++) entries["map:" + map.map + ":" + i] = text.slice(i * MAP_CHUNK, (i + 1) * MAP_CHUNK);
    const old = await this.ctx.storage.get("mapmeta:" + map.map);
    entries["mapmeta:" + map.map] = { name: map.name, chunks, updatedAt: Date.now() };
    const keys = Object.keys(entries);
    for (let i = 0; i < keys.length; i += 100) {
      const batch = {};
      keys.slice(i, i + 100).forEach((k) => { batch[k] = entries[k]; });
      await this.ctx.storage.put(batch);
    }
    if (old && old.chunks > chunks) {
      const stale = [];
      for (let i = chunks; i < old.chunks; i++) stale.push("map:" + map.map + ":" + i);
      await this.ctx.storage.delete(stale);
    }
    return text;
  }

  async getMap(id) {
    const meta = await this.ctx.storage.get("mapmeta:" + id);
    if (!meta) return null;
    const keys = [];
    for (let i = 0; i < meta.chunks; i++) keys.push("map:" + id + ":" + i);
    const parts = await this.ctx.storage.get(keys);
    return keys.map((k) => parts.get(k) || "").join("");
  }

  async uploadedMaps() {
    const list = await this.ctx.storage.list({ prefix: "mapmeta:" });
    return [...list].map(([k, v]) => ({ id: k.slice(8), name: v.name }));
  }

  async fetch(request) {
    const url = new URL(request.url);
    const p = url.pathname;
    const data = await this.getData();

    const mp = /^\/api\/maps\/([\w-]{1,60})(\.json)?$/.exec(p);
    if (mp && request.method === "POST") {
      const auth = Core.checkMapToken(this.settings, request.headers.get("Authorization"));
      if (auth !== "ok") {
        await request.arrayBuffer();
        return auth === "disabled"
          ? json({ error: "nahrávání map není na serveru zapnuté (secret MAP_TOKENS)" }, 403)
          : json({ error: "neplatný token pro nahrávání map" }, 401);
      }
      const body = await request.text();
      if (body.length > Core.MAX_MAP_BODY) return json({ error: "mapa je příliš velká" }, 413);
      const map = Core.normalizeMap(JSON.parse(body), mp[1]);
      const text = (await this.putMap(map)) + "\n";
      let github = "vypnuto";
      if (this.settings.github) {
        try {
          github = await Core.commitToGitHub(this.settings.github, "data/maps/" + map.map + ".json", text,
            "Mapa " + map.name + ": " + map.roads.length + " úseků silnic (nahráno z OmsiTabule)") || "ok";
        } catch (e) { github = "chyba: " + e.message; }
      }
      return json({ ok: true, map: map.map, roads: map.roads.length, rails: map.rails.length, github });
    }
    if (mp && request.method === "GET") {
      const stored = await this.getMap(mp[1]);
      if (stored) return new Response(stored, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS } });
      // podklad nasazený se stránkou (data/maps z GitHubu)
      const res = await this.env.ASSETS.fetch(new Request("https://assets.local/data/maps/" + mp[1] + ".json"));
      if (res.ok) return new Response(res.body, { headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
      return json({ error: "mapa nemá podklad" }, 404);
    }

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

    if (p === "/api/vehicles") return json({ maps: Core.mapList(data, await this.uploadedMaps()), vehicles: this.activeVehicles() });
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
      if (request.method !== "GET" && url.pathname.startsWith("/api/vehicles") &&
          !Core.checkToken(settingsFrom(env), request.headers.get("Authorization"))) {
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
