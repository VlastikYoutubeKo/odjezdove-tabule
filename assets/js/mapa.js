// Mapa vozů: poloha a směr jízdy z pluginu OmsiTabule (x = východ, y = sever, metry).
// OMSI nemá mapový podklad, takže se z projetých stop postupně vykreslí silnice.
(function () {
  "use strict";

  var POLL_MS = 3000;
  var TRAIL_POINTS = 600;        // max. bodů stopy na vůz
  var TRAIL_BREAK_M = 250;       // větší skok = teleport, stopu přerušit
  var TRAIL_MIN_STEP_M = 8;      // body blíž než tohle se neukládají
  var STORE_KEY = "mapa-stopy-v1";
  var SVG_NS = "http://www.w3.org/2000/svg";

  var params = new URLSearchParams(location.search);
  var $ = function (id) { return document.getElementById(id); };
  var svg = $("map"), gTrails = $("trails"), gVeh = $("vehicles");

  var api = "";
  var mapNames = {};
  var currentMap = params.get("map") || "";
  var vehicles = [];
  var selectedId = null;
  var view = { cx: 0, cy: 0, s: 0.5 };   // střed ve světě, pixelů na metr
  var userMoved = false;
  var trails = loadTrails();            // { mapa: { vůz: [[x,y]|null, …] } }
  var basemaps = {};                    // { mapa: { ox, oy, roads: "d", rails: "d", bbox } | false }
  var gBase = $("base");

  // ---------- ukládání stop (jen v tomto prohlížeči) ----------
  function loadTrails() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  var saveTimer = null;
  function saveTrails() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(trails)); } catch (e) { /* plné úložiště apod. */ }
    }, 2000);
  }

  function addTrailPoint(map, v) {
    var m = trails[map] = trails[map] || {};
    var t = m[v.id] = m[v.id] || [];
    var last = t.length ? t[t.length - 1] : null;
    if (last) {
      var d = Math.hypot(v.x - last[0], v.y - last[1]);
      if (d < TRAIL_MIN_STEP_M) return;
      if (d > TRAIL_BREAK_M) t.push(null);
    }
    t.push([Math.round(v.x), Math.round(v.y)]);
    if (t.length > TRAIL_POINTS) t.splice(0, t.length - TRAIL_POINTS);
  }

  // ---------- souřadnice ----------
  function size() { var r = svg.getBoundingClientRect(); return { w: r.width, h: r.height }; }
  function toScreen(x, y) {
    var z = size();
    return [(x - view.cx) * view.s + z.w / 2, -(y - view.cy) * view.s + z.h / 2];
  }
  function toWorld(sx, sy) {
    var z = size();
    return [(sx - z.w / 2) / view.s + view.cx, -(sy - z.h / 2) / view.s + view.cy];
  }

  function visibleVehicles() {
    var showAi = $("show-ai").checked;
    return vehicles.filter(function (v) {
      return (v.map || "?") === currentMap && v.x != null && v.y != null && (showAi || !v.ai);
    });
  }

  function fit() {
    var pts = visibleVehicles().map(function (v) { return [v.x, v.y]; });
    if ($("show-trails").checked) {
      var m = trails[currentMap] || {};
      Object.keys(m).forEach(function (k) { m[k].forEach(function (p) { if (p) pts.push(p); }); });
    }
    var base = basemaps[currentMap];
    if (!pts.length && base) {
      pts = [[base.bbox[0], base.bbox[1]], [base.bbox[2], base.bbox[3]]];
    }
    if (!pts.length) return;
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    pts.forEach(function (p) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    });
    var z = size();
    var spanX = Math.max(maxX - minX, 200), spanY = Math.max(maxY - minY, 200);
    view.cx = (minX + maxX) / 2;
    view.cy = (minY + maxY) / 2;
    view.s = Math.min((z.w - 140) / spanX, (z.h - 140) / spanY, 2);
    userMoved = false;
    render();
  }

  // ---------- podklad: silnice z mapy OMSI (data/maps/<mapa>.json, viz tools/import-omsi.js) ----------
  function loadBasemap(map) {
    if (!map || basemaps[map] !== undefined) return;
    basemaps[map] = false;
    fetch("data/maps/" + encodeURIComponent(map) + ".json")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) {
        var first = (data.roads || [])[0] || (data.rails || [])[0];
        if (!first) return;
        // souřadnice jsou velká čísla (dlaždice × 300 m) – kvůli přesnosti SVG kreslíme vůči počátku
        var ox = first[0], oy = first[1];
        var bbox = [Infinity, Infinity, -Infinity, -Infinity];
        function toD(lines) {
          var d = "";
          (lines || []).forEach(function (l) {
            for (var i = 0; i + 1 < l.length; i += 2) {
              var x = l[i], y = l[i + 1];
              if (x < bbox[0]) bbox[0] = x; if (y < bbox[1]) bbox[1] = y;
              if (x > bbox[2]) bbox[2] = x; if (y > bbox[3]) bbox[3] = y;
              d += (i ? "L" : "M") + (x - ox).toFixed(1) + " " + (y - oy).toFixed(1);
            }
          });
          return d;
        }
        basemaps[map] = { ox: ox, oy: oy, roads: toD(data.roads), rails: toD(data.rails), bbox: bbox };
        if (map === currentMap) { gBase.textContent = ""; if (!userMoved) fit(); else render(); }
      })
      .catch(function () { /* mapa bez podkladu */ });
  }

  function renderBase() {
    var base = basemaps[currentMap];
    if (!base) { gBase.textContent = ""; return; }
    if (!gBase.firstChild) {
      if (base.roads) gBase.appendChild(el("path", { d: base.roads, class: "road", "vector-effect": "non-scaling-stroke" }));
      if (base.rails) gBase.appendChild(el("path", { d: base.rails, class: "rail", "vector-effect": "non-scaling-stroke" }));
    }
    var z = size();
    // svět → obrazovka: posun na střed, měřítko, osa y míří na sever (nahoru)
    gBase.setAttribute("transform",
      "translate(" + (z.w / 2) + " " + (z.h / 2) + ") scale(" + view.s + " " + (-view.s) + ") translate(" +
      (base.ox - view.cx) + " " + (base.oy - view.cy) + ")");
    // silnice ~7 m široká, ale aspoň 1,5 px, ať je vidět i při oddálení
    gBase.setAttribute("stroke-width", Math.max(1.5, Math.min(14, view.s * 7)).toFixed(2));
  }

  // ---------- vykreslení ----------
  function el(name, attrs) {
    var e = document.createElementNS(SVG_NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function renderTrails() {
    gTrails.textContent = "";
    if (!$("show-trails").checked) return;
    var m = trails[currentMap] || {};
    var width = Math.max(2, Math.min(8, view.s * 7));
    Object.keys(m).forEach(function (id) {
      var d = "", pen = false;
      m[id].forEach(function (p) {
        if (!p) { pen = false; return; }
        var s = toScreen(p[0], p[1]);
        d += (pen ? "L" : "M") + s[0].toFixed(1) + " " + s[1].toFixed(1);
        pen = true;
      });
      if (d) gTrails.appendChild(el("path", { d: d, class: "trail", "stroke-width": width }));
    });
  }

  function renderVehicles() {
    gVeh.textContent = "";
    var r = Math.max(6, Math.min(12, 6 + view.s * 4));
    visibleVehicles().forEach(function (v) {
      var s = toScreen(v.x, v.y);
      var cls = "veh" + (v.ai ? "" : " player") + ((v.delay || 0) > 120 ? " late" : "") + (v.id === selectedId ? " selected" : "");
      var g = el("g", { class: cls, transform: "translate(" + s[0].toFixed(1) + " " + s[1].toFixed(1) + ")", tabindex: "0" });
      var body = el("g", v.heading != null ? { transform: "rotate(" + v.heading + ")" } : {});
      // šipka ukazuje směr jízdy (0° = sever, po směru hodin)
      body.appendChild(el("path", {
        class: "body", "stroke-width": 1.5,
        d: "M0 " + (-r * 1.5) + " L" + r + " " + r + " L0 " + (r * 0.45) + " L" + (-r) + " " + r + " Z"
      }));
      g.appendChild(body);
      g.appendChild(el("circle", { class: "ring", r: r * 1.8, "stroke-width": 2 }));
      if (v.route) {
        var t = el("text", { y: -r * 2, "text-anchor": "middle", "font-size": 13, "stroke-width": 3 });
        t.textContent = v.route;
        g.appendChild(t);
      }
      g.addEventListener("click", function (e) { e.stopPropagation(); select(v.id); });
      g.addEventListener("keydown", function (e) { if (e.key === "Enter") select(v.id); });
      gVeh.appendChild(g);
    });
  }

  function renderScale() {
    var target = 110 / view.s, pow = Math.pow(10, Math.floor(Math.log10(target))), len = pow;
    [1, 2, 5, 10].forEach(function (k) { if (k * pow <= target) len = k * pow; });
    $("scale").style.width = Math.round(len * view.s) + "px";
    $("scale").textContent = len >= 1000 ? len / 1000 + " km" : len + " m";
  }

  function fmtDelay(s) {
    if (s == null) return "–";
    var m = Math.round(s / 60);
    return m > 0 ? "+" + m + " min" : m < 0 ? m + " min" : "včas";
  }

  function renderDetail() {
    var box = $("detail");
    var v = vehicles.filter(function (x) { return x.id === selectedId; })[0];
    if (!v) { box.hidden = true; return; }
    box.hidden = false;
    box.textContent = "";
    var close = document.createElement("button");
    close.className = "close"; close.type = "button"; close.textContent = "×"; close.setAttribute("aria-label", "Zavřít");
    close.onclick = function () { select(null); };
    box.appendChild(close);
    var h = document.createElement("h2");
    h.textContent = (v.route ? v.route + " " : "") + (v.headsign ? "→ " + v.headsign : "");
    box.appendChild(h);
    var dl = document.createElement("dl");
    [
      ["Příští zastávka", v.nextStopName || v.nextStop || "–"],
      ["Zpoždění", fmtDelay(v.delay)],
      ["Rychlost", v.speed != null ? Math.round(v.speed) + " km/h" : "–"],
      ["Cestující", v.passengers != null ? v.passengers : "–"],
      ["Řidič", v.ai ? "AI" : (v.driver || "–")],
      ["Vůz", v.vehicle || "–"]
    ].forEach(function (row) {
      var dt = document.createElement("dt"); dt.textContent = row[0];
      var dd = document.createElement("dd"); dd.textContent = row[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
    box.appendChild(dl);
  }

  function render() {
    renderBase();
    renderTrails();
    renderVehicles();
    renderScale();
    renderDetail();
    var n = visibleVehicles().length;
    $("empty").hidden = n > 0 || Object.keys(trails[currentMap] || {}).length > 0 || !!basemaps[currentMap];
  }

  function select(id) {
    selectedId = id;
    render();
  }

  // ---------- data ----------
  function updateMapSelect(data) {
    (data.maps || []).forEach(function (m) { mapNames[m.id] = m.name; });
    var ids = {};
    Object.keys(mapNames).forEach(function (k) { ids[k] = true; });
    data.vehicles.forEach(function (v) { ids[v.map || "?"] = true; });
    if (!currentMap) {
      // výchozí mapa = ta, kde jezdí nejvíc vozů s polohou
      var counts = {};
      data.vehicles.forEach(function (v) { if (v.x != null) counts[v.map || "?"] = (counts[v.map || "?"] || 0) + 1; });
      currentMap = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })[0] || Object.keys(ids)[0] || "";
    }
    var sel = $("map-select");
    var keys = Object.keys(ids).sort();
    if (sel.options.length !== keys.length) {
      sel.textContent = "";
      keys.forEach(function (k) {
        var o = document.createElement("option");
        o.value = k; o.textContent = mapNames[k] || k;
        sel.appendChild(o);
      });
    }
    sel.value = currentMap;
  }

  var firstData = true;
  function refresh() {
    fetch(api + "/api/vehicles", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        vehicles = data.vehicles || [];
        updateMapSelect(data);
        loadBasemap(currentMap);
        vehicles.forEach(function (v) { if (v.x != null && v.y != null) addTrailPoint(v.map || "?", v); });
        saveTrails();
        var n = visibleVehicles().length;
        $("info").textContent = n ? n + (n === 1 ? " vůz" : n < 5 ? " vozy" : " vozů") + " na mapě" : "";
        if (firstData || !userMoved) fit(); else render();
        firstData = false;
      })
      .catch(function (e) { $("info").textContent = "Server neodpovídá: " + e.message; });
  }

  // ---------- ovládání: posun, zoom (kolečko i dva prsty) ----------
  var pointers = {}, lastPinch = null, dragged = false;
  svg.addEventListener("pointerdown", function (e) {
    pointers[e.pointerId] = [e.clientX, e.clientY];
    dragged = false;
  });
  svg.addEventListener("pointermove", function (e) {
    var prev = pointers[e.pointerId];
    if (!prev) return;
    if (!dragged && Math.hypot(e.clientX - prev[0], e.clientY - prev[1]) < 4) return;
    if (!dragged) {
      // zachytávat až při tažení, jinak by kliknutí na vůz nedošlo
      dragged = true;
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ukazatel už skončil */ }
      svg.classList.add("dragging");
    }
    pointers[e.pointerId] = [e.clientX, e.clientY];
    var ids = Object.keys(pointers);
    if (ids.length === 1) {
      view.cx -= (e.clientX - prev[0]) / view.s;
      view.cy += (e.clientY - prev[1]) / view.s;
    } else if (ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]];
      var dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (lastPinch) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, dist / lastPinch);
      lastPinch = dist;
    }
    userMoved = true;
    render();
  });
  function endPointer(e) {
    delete pointers[e.pointerId];
    lastPinch = null;
    if (!Object.keys(pointers).length) svg.classList.remove("dragging");
  }
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);

  function zoomAt(clientX, clientY, factor) {
    var rect = svg.getBoundingClientRect();
    var sx = clientX - rect.left, sy = clientY - rect.top;
    var before = toWorld(sx, sy);
    view.s = Math.min(20, Math.max(0.005, view.s * factor));
    var after = toWorld(sx, sy);
    view.cx += before[0] - after[0];
    view.cy += before[1] - after[1];
  }
  svg.addEventListener("wheel", function (e) {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    userMoved = true;
    render();
  }, { passive: false });
  svg.addEventListener("click", function () { if (!dragged && selectedId) select(null); });

  $("fit").addEventListener("click", fit);
  $("show-ai").addEventListener("change", render);
  $("show-trails").addEventListener("change", render);
  $("map-select").addEventListener("change", function (e) {
    currentMap = e.target.value;
    gBase.textContent = "";
    loadBasemap(currentMap);
    selectedId = null;
    fit();
    render();
  });
  window.addEventListener("resize", render);

  fetch("data/config.json").then(function (r) { return r.json(); }).catch(function () { return {}; })
    .then(function (cfg) {
      api = (params.get("api") || cfg.apiBase || "").replace(/\/+$/, "");
      refresh();
      setInterval(refresh, POLL_MS);
    });
})();
