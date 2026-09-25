#!/usr/bin/env node
// Simulátor pluginu: posílá na server polohy několika smyšlených vozů.
// Použití: node server/simulate.js [http://localhost:8080] [token]
"use strict";

const base = process.argv[2] || "http://localhost:8080";
const token = process.argv[3] || "";

const buses = [
  { id: "sim-1", driver: "Tester", vehicle: "SOR NB 12", map: "autobahnmap", route: "201", headsign: "Nemocnice", stops: ["0000000001", "0000000002"] },
  { id: "sim-2", driver: "Tester2", vehicle: "Citaro", map: "autobahnmap", route: "210", headsign: "Maxičky", stops: ["0000000001", "0000000002", "0000000003"] },
  { id: "sim-3", driver: "Tester3", vehicle: "Karosa B 732", route: "1", headsign: "Kyselka", stops: ["Bílina, aut. nádr.", "Bílina, Kyselka"] }
];

let tick = 0;
async function send() {
  tick++;
  for (const b of buses) {
    const i = Math.floor(tick / 6) % b.stops.length;
    const body = {
      id: b.id, driver: b.driver, vehicle: b.vehicle, map: b.map, route: b.route, headsign: b.headsign,
      nextStop: b.stops[i], delay: 60 * ((tick + b.id.length) % 5), speed: 20 + (tick * 7) % 30
    };
    try {
      const r = await fetch(base + "/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
        body: JSON.stringify(body)
      });
      console.log(b.id, r.status, await r.text());
    } catch (e) {
      console.error(b.id, e.message);
    }
  }
}
send();
setInterval(send, 5000);
