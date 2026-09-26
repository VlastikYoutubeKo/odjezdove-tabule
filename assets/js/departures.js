/*
 * Výpočet odjezdů z jízdních řádů (data/timetables/*.json) a sloučení
 * s živými polohami vozů. Sdílený kód – používá ho prohlížeč (tabule
 * bez serveru) i Node.js server (server/server.js).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Departures = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DAY = 1440;
  var WHEELCHAIR = "♿ ";

  function parseHM(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
    if (!m) throw new Error("Neplatný čas: " + s);
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  // Časy výjezdu spoje z první zastávky (minuty od půlnoci).
  function tripStarts(route) {
    var out = [];
    (route.departures || []).forEach(function (t) { out.push(parseHM(t)); });
    if (route.every) {
      var from = parseHM(route.every.from);
      var to = parseHM(route.every.to);
      var step = Number(route.every.interval);
      if (step > 0) for (var t = from; t <= to; t += step) out.push(t);
    }
    return out.sort(function (a, b) { return a - b; });
  }

  // ISO den v týdnu: 1 = pondělí … 7 = neděle
  function isoWeekday(date) {
    var d = date.getDay();
    return d === 0 ? 7 : d;
  }

  // Minuty od půlnoci a den v týdnu v daném časovém pásmu (servery běží často v UTC).
  function zonedNow(date, timeZone) {
    if (!timeZone) return { minutes: date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60, weekday: isoWeekday(date) };
    var parts = {};
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone, hourCycle: "h23", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit"
    }).formatToParts(date).forEach(function (p) { parts[p.type] = p.value; });
    var days = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    return {
      minutes: Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60,
      weekday: days[parts.weekday]
    };
  }

  function runsOn(route, weekday) {
    return !route.days || route.days.indexOf(weekday) !== -1;
  }

  function normalize(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function formatMinutes(min) {
    return min < 1 ? "<1" : String(Math.floor(min));
  }

  function makeItem(route, stopEntry, minutes, extra) {
    var item = {
      Platform: stopEntry.platform || "",
      RouteName: String(route.route),
      TimeToDeparture: formatMinutes(minutes),
      TripHeadsign: (route.wheelchair ? WHEELCHAIR : "") + route.headsign,
      _minutes: minutes
    };
    if (route.note) item.Note = route.note;
    if (route.noteEn) item.NoteEn = route.noteEn;
    if (route.color) item.RouteColor = route.color;
    if (extra) for (var k in extra) item[k] = extra[k];
    return item;
  }

  function allRoutes(timetables) {
    var out = [];
    timetables.forEach(function (tt) {
      (tt.routes || []).forEach(function (r) { out.push(r); });
    });
    return out;
  }

  /**
   * Plánované odjezdy ze zastávky.
   * @param timetables pole načtených jízdních řádů
   * @param stopId     ID zastávky
   * @param now        Date (lokální čas) nebo {minutes, weekday}
   * @param windowMin  kolik minut dopředu hledat
   */
  function scheduled(timetables, stopId, now, windowMin) {
    var nowMin, weekday;
    if (now instanceof Date) {
      nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
      weekday = isoWeekday(now);
    } else {
      nowMin = now.minutes;
      weekday = now.weekday;
    }
    var items = [];
    allRoutes(timetables).forEach(function (route) {
      var entries = (route.stops || []).filter(function (s) { return s.stop === stopId; });
      if (!entries.length) return;
      // Poslední zastávka spoje není odjezd.
      var last = route.stops[route.stops.length - 1];
      var starts = tripStarts(route);
      entries.forEach(function (entry) {
        if (entry === last) return;
        // -1 = včera (spoje přes půlnoc), 0 = dnes, 1 = zítra
        for (var dayShift = -1; dayShift <= 1; dayShift++) {
          var wd = ((weekday - 1 + dayShift + 7) % 7) + 1;
          if (!runsOn(route, wd)) continue;
          starts.forEach(function (start) {
            var at = start + (entry.offset || 0) + dayShift * DAY;
            var diff = at - nowMin;
            if (diff >= 0 && diff <= windowMin) {
              items.push(makeItem(route, entry, diff, { _route: route, _entry: entry }));
            }
          });
        }
      });
    });
    return items.sort(function (a, b) { return a._minutes - b._minutes; });
  }

  // Najde index zastávky ve spoji podle ID nebo názvu.
  function findStopIndex(route, stopRef, stopsById) {
    var ref = normalize(stopRef);
    for (var i = 0; i < route.stops.length; i++) {
      var id = route.stops[i].stop;
      if (id === stopRef) return i;
      var st = stopsById && stopsById[id];
      if (st && normalize(st.name) === ref) return i;
    }
    return -1;
  }

  /**
   * Odjezdy živých vozů, které teprve do zastávky přijedou.
   * vehicle: { route, headsign, nextStop, delay (s) }
   */
  function live(timetables, stopId, vehicles, stopsById, windowMin) {
    var routes = allRoutes(timetables);
    var items = [];
    vehicles.forEach(function (v) {
      if (!v.route || !v.nextStop) return;
      var best = null;
      var candidates = routes.filter(function (r) { return String(r.route) === String(v.route); });
      // Zná-li vůz svůj směr a některá trasa mu odpovídá, bereme jen ty trasy.
      var sameDir = candidates.filter(function (r) {
        return v.headsign && normalize(r.headsign) === normalize(v.headsign);
      });
      if (sameDir.length) candidates = sameDir;
      candidates.forEach(function (route) {
        var from = findStopIndex(route, v.nextStop, stopsById);
        if (from < 0) return;
        for (var i = from; i < route.stops.length - 1; i++) {
          if (route.stops[i].stop !== stopId) continue;
          var eta = (route.stops[i].offset || 0) - (route.stops[from].offset || 0);
          if (!best || eta < best.eta) best = { route: route, entry: route.stops[i], eta: eta };
          break;
        }
      });
      if (!best || best.eta > windowMin) return;
      var delayMin = Math.round((Number(v.delay) || 0) / 60);
      items.push(makeItem(best.route, best.entry, best.eta, {
        Live: true,
        Delay: delayMin,
        VehicleId: v.id,
        _route: best.route,
        _entry: best.entry
      }));
    });
    return items;
  }

  /**
   * Sloučí plánované a živé odjezdy: živý vůz nahradí plánovaný spoj,
   * kterému odpovídá (stejná trasa, plánovaný čas = ETA - zpoždění).
   */
  function merge(scheduledItems, liveItems) {
    var rest = scheduledItems.slice();
    liveItems.forEach(function (li) {
      var planned = li._minutes - li.Delay;
      var bestIdx = -1, bestDiff = 6;
      rest.forEach(function (si, idx) {
        if (si._route !== li._route) return;
        var d = Math.abs(si._minutes - planned);
        if (d < bestDiff) { bestDiff = d; bestIdx = idx; }
      });
      if (bestIdx >= 0) rest.splice(bestIdx, 1);
    });
    return rest.concat(liveItems).sort(function (a, b) { return a._minutes - b._minutes; });
  }

  // Odstraní interní pole (začínající "_") před odesláním/zobrazením.
  function clean(items, maxRows) {
    return items.slice(0, maxRows || items.length).map(function (it) {
      var o = {};
      for (var k in it) if (k.charAt(0) !== "_") o[k] = it[k];
      return o;
    });
  }

  /**
   * Sestaví kompletní JSON tabule ve stejném formátu jako data/boards/*.json.
   */
  function buildBoard(opts) {
    var stop = opts.stop;
    var config = opts.config || {};
    var windowMin = config.windowMinutes || 120;
    var sched = scheduled(opts.timetables, stop.id, opts.now, windowMin);
    var liv = opts.vehicles ? live(opts.timetables, stop.id, opts.vehicles, opts.stopsById, windowMin) : [];
    var items = clean(merge(sched, liv), config.maxRows || 8);
    return {
      StopId: stop.id,
      StopName: stop.name,
      NoDataText: config.noDataText || "",
      NoDataTextEn: config.noDataTextEn || "",
      DispatcherNote: stop.dispatcherNote || config.dispatcherNote || "",
      DispatcherNoteEn: stop.dispatcherNoteEn || config.dispatcherNoteEn || "",
      TimeStamp: new Date().toISOString(),
      Items: items
    };
  }

  return {
    parseHM: parseHM,
    zonedNow: zonedNow,
    tripStarts: tripStarts,
    scheduled: scheduled,
    live: live,
    merge: merge,
    clean: clean,
    buildBoard: buildBoard,
    normalize: normalize
  };
});
