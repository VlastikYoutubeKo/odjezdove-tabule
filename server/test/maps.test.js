"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// server s vlastní kopií data/ a zapnutým nahráváním map (samostatný proces testu)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabule-maps-"));
fs.cpSync(path.join(__dirname, "..", "..", "data"), dir, { recursive: true });
fs.rmSync(path.join(dir, "maps"), { recursive: true, force: true });
process.env.DATA_DIR = dir;
process.env.MAP_TOKENS = "mapovy-token";
const { server } = require("../server.js");
const Core = require("../core.js");

const map = {
  format: "odjezdove-tabule-mapa", version: 1, map: { id: "testmapa", name: "Testovací mapa" },
  layers: { roads: [[753242.5, 3213020.4, 753239.8, 3213022.3]], rails: [] }
};

test("nahrání mapy: token, uložení, čtení, seznam map", async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    let r = await fetch(base + "/api/maps/testmapa", { method: "POST", body: JSON.stringify(map) });
    assert.strictEqual(r.status, 401);
    r = await fetch(base + "/api/maps/testmapa", {
      method: "POST", headers: { Authorization: "Bearer mapovy-token" }, body: JSON.stringify(map)
    });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(await r.json(), { ok: true, map: "testmapa", roads: 1, rails: 0, github: "vypnuto" });
    assert.ok(fs.existsSync(path.join(dir, "maps", "testmapa.json")));

    r = await fetch(base + "/api/maps/testmapa");
    assert.deepStrictEqual((await r.json()).roads, map.layers.roads);
    assert.strictEqual((await fetch(base + "/api/maps/neexistuje")).status, 404);

    const list = await (await fetch(base + "/api/vehicles")).json();
    assert.ok(list.maps.some((m) => m.id === "testmapa" && m.name === "Testovací mapa"));

    r = await fetch(base + "/api/maps/..%2Fx", { method: "POST", headers: { Authorization: "Bearer mapovy-token" }, body: "{}" });
    assert.notStrictEqual(r.status, 200);
  } finally {
    server.close();
  }
});

test("commit na GitHub: nový soubor i přepsání existujícího", async () => {
  const calls = [];
  const realFetch = global.fetch;
  let exists = false;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET", body: opts.body && JSON.parse(opts.body), auth: opts.headers.Authorization });
    if ((opts.method || "GET") === "GET") {
      return exists ? new Response(JSON.stringify({ sha: "abc" }), { status: 200 }) : new Response("{}", { status: 404 });
    }
    return new Response(JSON.stringify({ commit: { html_url: "https://github.com/o/r/commit/1" } }), { status: 201 });
  };
  try {
    const gh = { token: "tkn", repo: "o/r", branch: "main" };
    const url = await Core.commitToGitHub(gh, "data/maps/testmapa.json", "Čau\n", "zpráva");
    assert.strictEqual(url, "https://github.com/o/r/commit/1");
    assert.strictEqual(calls[0].url, "https://api.github.com/repos/o/r/contents/data/maps/testmapa.json?ref=main");
    assert.strictEqual(calls[1].method, "PUT");
    assert.strictEqual(calls[1].auth, "Bearer tkn");
    assert.strictEqual(Buffer.from(calls[1].body.content, "base64").toString("utf8"), "Čau\n");
    assert.strictEqual(calls[1].body.sha, undefined);

    exists = true;
    calls.length = 0;
    await Core.commitToGitHub(gh, "data/maps/testmapa.json", "x", "zpráva");
    assert.strictEqual(calls[1].body.sha, "abc");
  } finally {
    global.fetch = realFetch;
  }
});

test("kontrola mapy", () => {
  assert.throws(() => Core.normalizeMap({ map: { id: "a b" }, layers: { roads: [[0, 0, 1, 1]] } }), /ID/);
  assert.throws(() => Core.normalizeMap({ map: { id: "a" }, layers: { roads: [] } }), /žádné/);
  assert.strictEqual(Core.checkMapToken({ mapTokens: [] }, "Bearer x"), "disabled");
  assert.strictEqual(Core.checkMapToken({ mapTokens: ["x"] }, "Bearer x"), "ok");
});
