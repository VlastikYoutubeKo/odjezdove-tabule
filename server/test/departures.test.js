"use strict";
const test = require("node:test");
const assert = require("node:assert");
const D = require("../../assets/js/departures.js");

const tt = [{
  map: "m",
  routes: [
    {
      route: "5", headsign: "Centrum", wheelchair: true,
      stops: [{ stop: "A", platform: "1", offset: 0 }, { stop: "B", platform: "2", offset: 4 }, { stop: "C", offset: 10 }],
      departures: ["10:00", "10:30", "23:58"]
    },
    { route: "6", headsign: "Noc", days: [6], stops: [{ stop: "A", offset: 0 }, { stop: "C", offset: 3 }], every: { from: "00:10", to: "00:40", interval: 15 } }
  ]
}];
const stopsById = { A: { id: "A", name: "Áčko" }, B: { id: "B", name: "Béčko" }, C: { id: "C", name: "Cé" } };

test("plánované odjezdy včetně offsetu a posledního spoje", () => {
  const items = D.scheduled(tt, "B", { minutes: 10 * 60, weekday: 1 }, 120);
  assert.deepStrictEqual(items.map((i) => i._minutes), [4, 34]);
  assert.strictEqual(items[0].TripHeadsign, "♿ Centrum");
  assert.strictEqual(items[0].Platform, "2");
});

test("konečná zastávka nemá odjezdy", () => {
  assert.strictEqual(D.scheduled(tt, "C", { minutes: 600, weekday: 1 }, 120).length, 0);
});

test("přes půlnoc a omezení dnů", () => {
  // pátek 23:55 → spoj 23:58 dnes a linka 6 v sobotu po půlnoci
  const items = D.scheduled(tt, "A", { minutes: 23 * 60 + 55, weekday: 5 }, 60);
  assert.deepStrictEqual(items.map((i) => i.RouteName + "@" + i.TimeToDeparture), ["5@3", "6@15", "6@30", "6@45"]);
  // čtvrtek → linka 6 nejede
  assert.strictEqual(D.scheduled(tt, "A", { minutes: 23 * 60 + 55, weekday: 4 }, 60).length, 1);
});

test("živý vůz nahradí plánovaný spoj", () => {
  const now = { minutes: 10 * 60 + 1, weekday: 1 };
  const vehicles = [{ id: "v1", route: "5", headsign: "Centrum", nextStop: "Áčko", delay: 180 }];
  const board = D.buildBoard({ stop: { id: "B", name: "Béčko" }, timetables: tt, vehicles, stopsById, now, config: {} });
  const five = board.Items.filter((i) => i.RouteName === "5");
  assert.strictEqual(five.length, 2);
  assert.strictEqual(five[0].Live, true);
  assert.strictEqual(five[0].Delay, 3);
  assert.strictEqual(five[0].TimeToDeparture, "4");
  assert.ok(!("_route" in five[0]));
});

test("vůz za zastávkou se neukazuje", () => {
  const vehicles = [{ id: "v1", route: "5", nextStop: "C" }];
  assert.strictEqual(D.live(tt, "B", vehicles, stopsById, 120).length, 0);
});

test("vůz na konečné se neukazuje jako odjezd opačným směrem", () => {
  const t = [{ routes: [
    { route: "1", headsign: "Tam", stops: [{ stop: "A", offset: 0 }, { stop: "B", offset: 5 }], departures: [] },
    { route: "1", headsign: "Zpět", stops: [{ stop: "B", offset: 0 }, { stop: "A", offset: 5 }], departures: [] }
  ] }];
  assert.strictEqual(D.live(t, "B", [{ id: "x", route: "1", headsign: "Tam", nextStop: "B" }], {}, 120).length, 0);
  // bez známého směru se použije libovolná trasa linky
  assert.strictEqual(D.live(t, "B", [{ id: "x", route: "1", nextStop: "B" }], {}, 120).length, 1);
});

test("čas v časovém pásmu Europe/Prague", () => {
  // 2026-01-05 (pondělí) 23:30 UTC = úterý 00:30 v Praze (zimní čas)
  const n = D.zonedNow(new Date(Date.UTC(2026, 0, 5, 23, 30)), "Europe/Prague");
  assert.deepStrictEqual(n, { minutes: 30, weekday: 2 });
  // letní čas: 2026-07-01 10:00 UTC = 12:00
  assert.strictEqual(D.zonedNow(new Date(Date.UTC(2026, 6, 1, 10, 0)), "Europe/Prague").minutes, 720);
});
