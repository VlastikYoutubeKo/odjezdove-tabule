"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Core = require("../core.js");
const D = require("../../assets/js/departures.js");

const data = Core.indexData({
  config: {},
  stops: { maps: [{ id: "m" }], stops: [{ id: "A", name: "Áčko", map: "m" }, { id: "B", name: "Béčko", map: "m" }, { id: "C", name: "Cé", map: "m" }] },
  timetables: [{ map: "m", routes: [{ route: "5", headsign: "Cé", stops: [{ stop: "A", offset: 0 }, { stop: "B", offset: 4 }, { stop: "C", offset: 9 }], departures: ["10:00"] }] }]
});

test("dávka: přijme vozy, doplní zdroj a smaže chybějící", () => {
  const store = new Map();
  let r = Core.applyReport(data, store, {
    source: { id: "hrac1", driver: "Vlasta", map: "m", gameTime: "10:01" },
    vehicles: [
      { id: "7", route: "5", headsign: "Cé", nextStop: "Áčko", delay: 60, x: -120.5, y: 300, heading: 90, passengers: 12 },
      { id: "8", ai: true, route: "5", headsign: "Cé", nextStop: "acko" },
      { route: "bez id" }
    ]
  });
  assert.strictEqual(r.accepted, 2);
  assert.deepStrictEqual([...store.keys()].sort(), ["hrac1:7", "hrac1:8"]);
  const ai = store.get("hrac1:8");
  assert.strictEqual(ai.ai, true);
  assert.strictEqual(ai.driver, undefined);
  assert.strictEqual(ai.nextStop, "A");
  assert.strictEqual(store.get("hrac1:7").driver, "Vlasta");
  assert.strictEqual(store.get("hrac1:7").gameTime, "10:01");
  assert.deepStrictEqual([store.get("hrac1:7").x, store.get("hrac1:7").heading, store.get("hrac1:7").passengers], [-120.5, 90, 12]);

  // jiný zdroj se nesmaže, chybějící vůz téhož zdroje ano
  Core.applyReport(data, store, { id: "stary-plugin", route: "5" });
  Core.applyReport(data, store, { source: { id: "hrac1" }, vehicles: [{ id: "7", route: "5" }] });
  assert.deepStrictEqual([...store.keys()].sort(), ["hrac1:7", "stary-plugin"]);
});

test("dávka: limit počtu vozů a povinné source.id", () => {
  assert.throws(() => Core.applyReport(data, new Map(), { vehicles: [] }), /source.id/);
  const many = Array.from({ length: 301 }, (_, i) => ({ id: String(i) }));
  assert.throws(() => Core.applyReport(data, new Map(), { source: { id: "x" }, vehicles: many }), /příliš mnoho/);
});

test("stejný spoj od dvou hráčů se na tabuli ukáže jednou, přednost má hráč", () => {
  const store = new Map();
  Core.applyReport(data, store, { source: { id: "h1" }, vehicles: [{ id: "1", ai: true, route: "5", headsign: "Cé", nextStop: "A", delay: 60 }] });
  Core.applyReport(data, store, { source: { id: "h2", driver: "Pepa" }, vehicles: [{ id: "1", route: "5", headsign: "Cé", nextStop: "A", delay: 90 }] });
  const board = D.buildBoard({
    stop: data.stopsById.B, timetables: data.timetablesByMap.m, vehicles: [...store.values()],
    stopsById: data.stopsById, now: { minutes: 600, weekday: 1 }, config: {}
  });
  assert.strictEqual(board.Items.length, 1);
  assert.strictEqual(board.Items[0].Live, true);
  assert.strictEqual(board.Items[0].Ai, false);
});
