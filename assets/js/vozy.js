// Seznam vozů hlášených pluginem OMSI 2 (vyžaduje server, viz server/README.md).
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var info = document.getElementById("info");
  var out = document.getElementById("out");
  var api = "";

  function cell(tr, text) {
    var td = document.createElement("td");
    td.textContent = text == null ? "" : text;
    tr.appendChild(td);
  }

  function fmtDelay(s) {
    if (s == null) return "";
    var m = Math.round(s / 60);
    return m > 0 ? "+" + m + " min" : m < 0 ? m + " min" : "včas";
  }

  function render(data) {
    out.textContent = "";
    var byMap = {};
    data.vehicles.forEach(function (v) { (byMap[v.map || "?"] = byMap[v.map || "?"] || []).push(v); });
    var names = {};
    (data.maps || []).forEach(function (m) { names[m.id] = m.name; });
    var keys = Object.keys(byMap).sort();
    info.textContent = data.vehicles.length ? data.vehicles.length + " vozů v provozu" : "Právě nikdo nejezdí.";
    keys.forEach(function (k) {
      var h = document.createElement("h2");
      h.textContent = names[k] || k;
      out.appendChild(h);
      var wrap = document.createElement("div");
      wrap.className = "table-scroll";
      var t = document.createElement("table");
      var head = document.createElement("tr");
      ["Linka", "Směr", "Příští zastávka", "Zpoždění", "Rychlost", "Řidič", "Vůz"].forEach(function (x) {
        var th = document.createElement("th"); th.textContent = x; head.appendChild(th);
      });
      t.appendChild(head);
      byMap[k].sort(function (a, b) { return String(a.route).localeCompare(String(b.route), "cs", { numeric: true }); })
        .forEach(function (v) {
          var tr = document.createElement("tr");
          cell(tr, v.route);
          cell(tr, v.headsign);
          cell(tr, v.nextStopName || v.nextStop);
          cell(tr, fmtDelay(v.delay));
          cell(tr, v.speed != null ? Math.round(v.speed) + " km/h" : "");
          cell(tr, v.driver);
          cell(tr, v.vehicle);
          t.appendChild(tr);
        });
      wrap.appendChild(t);
      out.appendChild(wrap);
    });
  }

  function refresh() {
    fetch(api + "/api/vehicles", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function (e) { info.textContent = "Server neodpovídá: " + e.message; });
  }

  fetch("data/config.json").then(function (r) { return r.json(); }).catch(function () { return {}; })
    .then(function (cfg) {
      api = (params.get("api") || cfg.apiBase || "").replace(/\/+$/, "");
      if (!api && location.protocol === "file:") {
        info.textContent = "Není nastaven server (apiBase v data/config.json).";
        return;
      }
      refresh();
      setInterval(refresh, 5000);
    });
})();
