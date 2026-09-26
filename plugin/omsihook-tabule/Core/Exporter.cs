using System;
using System.Collections.Generic;
using System.Linq;

namespace OmsiTabule
{
    /// <summary>Převede jízdní řád OMSI (linky → oběhy → spoje) na formát data/timetables/*.json.</summary>
    public static class Exporter
    {
        /// <summary>
        /// OMSI ukládá časy jako desetinná čísla. Podle dosavadních znalostí jsou to minuty,
        /// ale jistotu nemáme – když začátky oběhů přesahují dva dny v minutách, bereme sekundy.
        /// Zjištěná jednotka se zapisuje do exportu i do logu, ať se dá ověřit.
        /// </summary>
        public static double DetectTimeUnit(IEnumerable<TtLine> lines)
        {
            double max = 0;
            foreach (var l in lines)
                foreach (var t in l.Tours)
                    foreach (var e in t.Entries)
                        max = Math.Max(max, e.StartTime);
            return max > 2 * 1440 ? 1.0 / 60.0 : 1.0;
        }

        public static ExportFile Build(string mapId, string mapName, IReadOnlyList<TtLine> lines, IReadOnlyList<TtTrip> trips)
        {
            double toMin = DetectTimeUnit(lines);
            var file = new ExportFile
            {
                Generated = DateTime.UtcNow.ToString("o"),
                TimeUnit = toMin == 1.0 ? "minutes" : "seconds",
                Map = new MapDto { Id = mapId, Name = mapName },
                Timetable = new TimetableDto { Map = mapId }
            };

            var stops = new Dictionary<string, StopDto>();
            var routes = new Dictionary<string, RouteDto>();

            string StopId(TtStop s)
            {
                var id = Text.Slug(s.Name);
                if (id.Length == 0) return "";
                if (!stops.ContainsKey(id)) stops[id] = new StopDto { Id = id, Name = s.Name.Trim(), Map = mapId };
                return id;
            }

            foreach (var line in lines)
            {
                foreach (var tour in line.Tours)
                {
                    if (tour.Invalid) continue;
                    int[]? days = tour.Days.Length is 0 or 7 ? null : tour.Days;
                    string daysKey = days == null ? "*" : string.Join(",", days);

                    foreach (var entry in tour.Entries)
                    {
                        if (entry.TripIndex < 0 || entry.TripIndex >= trips.Count) continue;
                        var trip = trips[entry.TripIndex];
                        if (trip.Invalid || entry.Profile < 0 || entry.Profile >= trip.Profiles.Count) continue;
                        var profile = trip.Profiles[entry.Profile];
                        if (profile.Service) continue;

                        string lineName = string.IsNullOrWhiteSpace(trip.Line) ? line.Name : trip.Line;
                        string key = $"{lineName}|{entry.TripIndex}|{entry.Profile}|{daysKey}";
                        if (!routes.TryGetValue(key, out var route))
                        {
                            route = new RouteDto { Route = lineName.Trim(), Headsign = trip.Target.Trim(), Days = days };
                            int n = Math.Min(trip.Stops.Count, profile.Times.Count);
                            for (int i = 0; i < n; i++)
                            {
                                var time = profile.Times[i];
                                if (!time.Stopping && i != 0 && i != n - 1) continue;
                                var id = StopId(trip.Stops[i]);
                                if (id.Length == 0) continue;
                                // na poslední zastávce je důležitý příjezd, jinde odjezd
                                double t = (i == n - 1 ? time.Arr : time.Dep) * toMin;
                                route.Stops.Add(new RouteStopDto
                                {
                                    Stop = id,
                                    Platform = string.IsNullOrWhiteSpace(trip.Stops[i].Extra) ? null : trip.Stops[i].Extra.Trim(),
                                    Offset = Math.Round(t, 2)
                                });
                            }
                            if (route.Stops.Count < 2) continue;
                            routes[key] = route;
                        }
                        route.Departures.Add(Text.HM(entry.StartTime * toMin));
                    }
                }
            }

            foreach (var r in routes.Values)
                r.Departures = r.Departures.Distinct().OrderBy(d => d, StringComparer.Ordinal).ToList();
            file.Timetable.Routes = routes.Values
                .OrderBy(r => int.TryParse(r.Route, out var n) ? n : int.MaxValue)
                .ThenBy(r => r.Route, StringComparer.Ordinal)
                .ThenBy(r => r.Headsign, StringComparer.Ordinal)
                .ToList();
            file.Stops = stops.Values.OrderBy(s => s.Name, StringComparer.Ordinal).ToList();
            return file;
        }
    }
}
