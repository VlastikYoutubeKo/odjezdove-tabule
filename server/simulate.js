#!/usr/bin/env node
// Simulátor pluginu OmsiTabule: posílá na server dávky smyšlených vozů (hráč + AI).
// Použití: node server/simulate.js [http://localhost:8080] [token]
"use strict";

const base = process.argv[2] || "http://localhost:8080";
const token = process.argv[3] || "";

const players = [
  {
    source: { id: "sim-hrac1", driver: "Tester", map: "autobahnmap" },
    buses: [
      { id: "1", vehicle: "SOR NB 12", route: "201", headsign: "Nemocnice", stops: ["0000000001", "0000000002"] },
      { id: "2", ai: true, vehicle: "Citaro", route: "210", headsign: "Maxičky", stops: ["0000000001", "0000000002", "0000000003"] }
    ]
  },
  {
    source: { id: "sim-hrac2", driver: "Tester2", map: "bilina" },
    buses: [{ id: "1", vehicle: "Karosa B 732", route: "1", headsign: "Kyselka", stops: ["Bílina, aut. nádr.", "Bílina, Kyselka"] }]
  }
];

let tick = 0;
async function send() {
  tick++;
  const now = new Date();
  for (const p of players) {
    const body = {
      source: { ...p.source, gameTime: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` },
      vehicles: p.buses.map((b) => ({
        id: b.id, ai: b.ai === true, vehicle: b.vehicle, route: b.route, headsign: b.headsign,
        nextStop: b.stops[Math.floor(tick / 6) % b.stops.length],
        delay: 60 * ((tick + b.id.length) % 5), speed: 20 + (tick * 7) % 30
      }))
    };
    try {
      const r = await fetch(base + "/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
        body: JSON.stringify(body)
      });
      console.log(p.source.id, r.status, await r.text());
    } catch (e) {
      console.error(p.source.id, e.message);
    }
  }
}
send();
setInterval(send, 5000);
