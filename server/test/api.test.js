"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { server } = require("../server.js");

test("API: příjem vozu, seznam vozů, tabule, statické soubory", async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    let r = await fetch(base + "/api/vehicles", {
      method: "POST",
      body: JSON.stringify({ id: "t1", route: "210", headsign: "Maxičky", nextStop: "Lovosice, aut. nádr.", delay: 120 })
    });
    const res = await r.json();
    assert.strictEqual(res.map, "autobahnmap");
    assert.strictEqual(res.nextStop, "0000000001");

    r = await fetch(base + "/api/vehicles");
    const list = await r.json();
    assert.strictEqual(list.vehicles.length, 1);
    assert.strictEqual(list.vehicles[0].nextStopName, "Lovosice, aut. nádr.");
    

    r = await fetch(base + "/api/boards/0000000002");
    const board = await r.json();
    assert.strictEqual(board.StopName, "Lovosice, nemocnice");
    assert.ok(board.Items.some((i) => i.Live && i.RouteName === "210" && i.TimeToDeparture === "5"));

    r = await fetch(base + "/api/boards/0000000001.json");
    assert.strictEqual((await r.json()).StopId, "0000000001");

    assert.strictEqual((await fetch(base + "/tabule.html")).status, 200);
    assert.strictEqual((await fetch(base + "/server/server.js")).status, 404);
    assert.strictEqual((await fetch(base + "/..%2fserver%2fserver.js")).status, 404);
  } finally {
    server.close();
  }
});
