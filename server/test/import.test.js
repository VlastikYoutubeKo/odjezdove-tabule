"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { importExport } = require("../../tools/import-omsi.js");

test("import exportu z OMSI do data/", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabule-"));
  fs.writeFileSync(path.join(dir, "stops.json"), JSON.stringify({
    maps: [{ id: "autobahnmap", name: "Autobahnmap" }],
    stops: [
      { id: "0000000001", name: "Lovosice, aut. nádr.", map: "autobahnmap", source: "static" },
      { id: "maxicky", name: "Maxičky", map: "jina-mapa", source: "timetable" }
    ]
  }));
  const exp = {
    format: "odjezdove-tabule-export", version: 1, timeUnit: "minutes",
    map: { id: "autobahnmap", name: "Autobahnmap" },
    stops: [
      { id: "lovosice-aut-nadr", name: "Lovosice, aut. nádr.", map: "autobahnmap" },
      { id: "maxicky", name: "Maxičky", map: "autobahnmap" }
    ],
    timetable: { map: "autobahnmap", routes: [{ route: "210", headsign: "Maxičky", stops: [{ stop: "lovosice-aut-nadr", offset: 0 }, { stop: "maxicky", offset: 12 }], departures: ["05:23"] }] }
  };

  const r = importExport(exp, dir);
  assert.deepStrictEqual(r, { mapId: "autobahnmap", routes: 1, added: 1, reused: 1, timeUnit: "minutes" });

  const stops = JSON.parse(fs.readFileSync(path.join(dir, "stops.json"), "utf8"));
  const added = stops.stops.find((s) => s.name === "Maxičky" && s.map === "autobahnmap");
  assert.strictEqual(added.id, "autobahnmap-maxicky"); // ID "maxicky" už má jiná mapa
  const tt = JSON.parse(fs.readFileSync(path.join(dir, "timetables", "autobahnmap.json"), "utf8"));
  assert.deepStrictEqual(tt.routes[0].stops.map((s) => s.stop), ["0000000001", "autobahnmap-maxicky"]);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, "timetables", "index.json"), "utf8")).files, ["autobahnmap.json"]);

  // opakovaný import nic nezdvojí
  importExport(exp, dir);
  const again = JSON.parse(fs.readFileSync(path.join(dir, "stops.json"), "utf8"));
  assert.strictEqual(again.stops.length, 3);

  assert.throws(() => importExport({ format: "x" }, dir), /není export/);
});

test("import silnic mapy do data/maps/", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tabule-"));
  fs.writeFileSync(path.join(dir, "stops.json"), JSON.stringify({ maps: [], stops: [] }));
  const r = importExport({
    format: "odjezdove-tabule-mapa", version: 1, map: { id: "autobahnmap", name: "Autobahnmap" },
    layers: { roads: [[0, 0, 10, 0], [1, 2, 3], "x"], rails: [] }
  }, dir);
  assert.deepStrictEqual(r, { kind: "mapa", mapId: "autobahnmap", roads: 1, rails: 0 });
  const m = JSON.parse(fs.readFileSync(path.join(dir, "maps", "autobahnmap.json"), "utf8"));
  assert.deepStrictEqual(m.roads, [[0, 0, 10, 0]]);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, "stops.json"), "utf8")).maps[0].id, "autobahnmap");
  assert.throws(() => importExport({ format: "odjezdove-tabule-mapa", map: { id: "../x" } }, dir), /platné ID/);
});
