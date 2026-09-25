/*
 * Odjezdová tabule.
 *
 * Parametry v URL:
 *   ?id=0000000001        ID zastávky ze souboru data/stops.json
 *   ?src=https://…/x.json vlastní JSON (formát tabule nebo jízdního řádu)
 *   ?api=https://…        adresa serveru (přebije apiBase z data/config.json)
 *   ?lang=cs|en           vypne střídání jazyků
 */
(function () {
  "use strict";

  var params = new URLSearchParams(location.search);
  var stopId = params.get("id") || "0000000001";
  var customSrc = params.get("src");
  var fixedLang = params.get("lang");

  var config = {};
  var stop = null;
  var board = null;
  var lastOk = 0;
  var lang = fixedLang || "cs";
  var timetablesCache = null;

  var $ = function (id) { return document.getElementById(id); };

  function fetchJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(url + ": HTTP " + r.status);
      return r.json();
    });
  }

  function loadTimetables() {
    if (timetablesCache) return Promise.resolve(timetablesCache);
    return fetchJson("data/timetables/index.json").then(function (idx) {
      return Promise.all(idx.files.map(function (f) { return fetchJson("data/timetables/" + f); }));
    }).then(function (tts) {
      timetablesCache = tts;
      return tts;
    });
  }

  function apiBase() {
    return (params.get("api") || config.apiBase || "").replace(/\/+$/, "");
  }

  // Vrátí data tabule ve formátu data/boards/*.json.
  function getBoard() {
    if (customSrc) {
      return fetchJson(customSrc).then(function (data) {
        if (data.routes) {
          // vlastní jízdní řád → dopočítáme odjezdy v prohlížeči
          return Departures.buildBoard({
            stop: stop || { id: stopId, name: stopId },
            timetables: [data],
            now: new Date(),
            config: config
          });
        }
        return data;
      });
    }
    if (apiBase()) return fetchJson(apiBase() + "/api/boards/" + encodeURIComponent(stopId));
    if (!stop || stop.source === "static") return fetchJson("data/boards/" + stopId + ".json");
    return loadTimetables().then(function (tts) {
      return Departures.buildBoard({ stop: stop, timetables: tts, now: new Date(), config: config });
    });
  }

  function pick(obj, key) {
    if (!obj) return "";
    return (lang === "en" && obj[key + "En"]) || obj[key] || "";
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render() {
    document.querySelectorAll("[data-cs]").forEach(function (e) {
      e.textContent = e.getAttribute("data-" + lang);
    });
    if (!board) return;

    $("stop-name").textContent = board.StopName || stopId;
    document.title = (board.StopName || stopId) + " – odjezdy";

    var rows = $("rows");
    rows.textContent = "";
    var items = board.Items || [];
    if (!items.length) {
      rows.appendChild(el("div", "no-data", pick(board, "NoDataText") || "—"));
    }
    items.slice(0, config.maxRows || 8).forEach(function (it) {
      var row = el("div", "row");

      var line = el("div", "line");
      var badge = el("span", "badge", it.RouteName);
      if (it.RouteColor) { badge.style.background = it.RouteColor; badge.style.color = "#fff"; }
      line.appendChild(badge);
      row.appendChild(line);

      var hs = el("div", "headsign");
      if (it.Live) hs.appendChild(el("span", "live"));
      var text = String(it.TripHeadsign || "");
      if (text.charAt(0) === "\u267F") {
        hs.appendChild(el("span", "wc", "\u267F"));
        text = text.slice(1).trim();
      }
      hs.appendChild(document.createTextNode(text));
      if (it.Live && typeof it.Delay === "number") {
        var d = el("span", "delay" + (it.Delay <= 0 ? " ok" : ""),
          it.Delay > 0 ? "+" + it.Delay + " min" : (lang === "en" ? "on time" : "včas"));
        hs.appendChild(d);
      }
      var note = pick(it, "Note");
      if (note) hs.appendChild(el("span", "note", note));
      row.appendChild(hs);

      row.appendChild(el("div", "plat", it.Platform || ""));

      var t = String(it.TimeToDeparture);
      var time = el("div", "time" + (t === "<1" || t === "0" ? " now" : ""), t);
      if (/^\d+$/.test(t)) time.appendChild(el("small", null, "min"));
      row.appendChild(time);

      rows.appendChild(row);
    });

    $("note").textContent = pick(board, "DispatcherNote");
    renderStatus();
  }

  function renderStatus() {
    var s = $("status");
    var stale = !lastOk || Date.now() - lastOk > (config.refreshSeconds || 20) * 3000;
    s.className = "status" + (stale ? " stale" : "");
    if (!lastOk) s.textContent = "";
    else s.textContent = (stale ? (lang === "en" ? "Offline · " : "Bez spojení · ") : "") +
      (lang === "en" ? "Updated " : "Aktualizováno ") +
      new Date(lastOk).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
  }

  function refresh() {
    return getBoard().then(function (data) {
      board = data;
      lastOk = Date.now();
      render();
    }).catch(function (err) {
      console.error(err);
      if (!board) {
        $("rows").textContent = "";
        $("rows").appendChild(el("div", "error", "Chyba načítání dat: " + err.message));
      }
      renderStatus();
    });
  }

  function tickClock() {
    $("clock").textContent = new Date().toLocaleTimeString("cs-CZ", {
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
  }

  // Reklama: každou minutu se na Duration sekund zobrazí obrázek z Advertising.URL.
  function showAd() {
    var ad = board && board.Advertising;
    if (!ad || !ad.URL) return;
    var box = $("ad");
    var img = box.querySelector("img");
    img.onload = function () {
      box.classList.add("show");
      setTimeout(function () { box.classList.remove("show"); }, (ad.Duration || 10) * 1000);
    };
    img.src = ad.URL;
  }

  function start() {
    tickClock();
    setInterval(tickClock, 1000);
    refresh();
    setInterval(refresh, (config.refreshSeconds || 20) * 1000);
    if (!fixedLang) {
      setInterval(function () {
        lang = lang === "cs" ? "en" : "cs";
        render();
      }, (config.languageSwitchSeconds || 8) * 1000);
    }
    setInterval(showAd, 60 * 1000);
  }

  Promise.all([
    fetchJson("data/config.json").catch(function () { return {}; }),
    fetchJson("data/stops.json").catch(function () { return { stops: [] }; })
  ]).then(function (res) {
    config = res[0];
    stop = (res[1].stops || []).filter(function (s) { return s.id === stopId; })[0] || null;
    start();
  });
})();
