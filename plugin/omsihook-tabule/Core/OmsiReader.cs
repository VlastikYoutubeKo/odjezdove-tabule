using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using OmsiHook;

namespace OmsiTabule
{
    /// <summary>Čte data z paměti OMSI přes OmsiHook (OMSI 2.3.004).</summary>
    public sealed class OmsiReader
    {
        private readonly OmsiHook.OmsiHook hook;
        private readonly Config cfg;

        // Názvy linek a cílů spojů se čtou jen při změně mapy (čtení celého jízdního řádu je pomalé).
        private string cachedMap = "";
        private List<TtLine> lines = new();
        private List<TtTrip> trips = new();

        public OmsiReader(OmsiHook.OmsiHook hook, Config cfg)
        {
            this.hook = hook;
            this.cfg = cfg;
        }

        public (string id, string name)? CurrentMap()
        {
            var map = hook.Globals.Map;
            if (map == null) return null;
            string name = FirstNonEmpty(map.FriendlyName, map.Name);
            if (name.Length == 0) return null;
            string id = cfg.Map.Length > 0 ? cfg.Map : Text.Slug(name);
            return (id, name);
        }

        /// <summary>Načte jízdní řád mapy. Vrací true, když se mapa od minula změnila.</summary>
        public bool RefreshTimetable(bool force = false)
        {
            var map = CurrentMap();
            if (map == null) return false;
            if (!force && map.Value.id == cachedMap && lines.Count > 0) return false;

            var tt = hook.Globals.TimeTableManager;
            if (tt == null) return false;
            lines = (tt.Lines ?? Array.Empty<OmsiTTLine>()).Select(ConvertLine).ToList();
            trips = (tt.Trips ?? Array.Empty<OmsiTTTrip>()).Select(ConvertTrip).ToList();
            cachedMap = map.Value.id;
            Log.Write($"Mapa „{map.Value.name}“ (id {map.Value.id}): {lines.Count} linek, {trips.Count} spojů, " +
                      $"jednotka času {(Exporter.DetectTimeUnit(lines) == 1.0 ? "minuty" : "sekundy")}");
            return true;
        }

        public ExportFile? BuildExport()
        {
            var map = CurrentMap();
            if (map == null) return null;
            RefreshTimetable();
            return Exporter.Build(map.Value.id, map.Value.name, lines, trips);
        }

        /// <summary>Snímek všech vozů s platnými daty jízdního řádu (hráč + AI).</summary>
        public ReportDto Snapshot()
        {
            var g = hook.Globals;
            var map = CurrentMap();
            var time = g.Time;
            var report = new ReportDto
            {
                Source = new SourceDto
                {
                    Id = cfg.Id,
                    Driver = cfg.Driver.Length > 0 ? cfg.Driver : null,
                    Map = map?.id,
                    GameTime = time != null ? $"{time.Hour:00}:{time.Minute:00}" : null
                }
            };
            if (map == null) return report;
            RefreshTimetable();

            var list = g.RoadVehicles?.FList;
            if (list == null) return report;
            int player = g.PlayerVehicleIndex;
            for (int i = 0; i < list.Count; i++)
            {
                OmsiRoadVehicleInst? v;
                try { v = list[i]; } catch { continue; }
                if (v == null) continue;
                bool isPlayer = i == player;
                if (!isPlayer && !cfg.IncludeAi) continue;
                try
                {
                    var dto = ReadVehicle(v, i, isPlayer);
                    if (dto != null) report.Vehicles.Add(dto);
                }
                catch (Exception ex)
                {
                    Log.Write($"Vůz {i}: {ex.Message}");
                }
            }
            return report;
        }

        private VehicleDto? ReadVehicle(OmsiRoadVehicleInst v, int index, bool isPlayer)
        {
            string? route = null, headsign = null, nextStop = null;
            double? delay = null;

            if (v.AI_Scheduled_Info_Valid)
            {
                int li = v.AI_Scheduled_Line, ti = v.AI_Scheduled_Trip;
                var trip = ti >= 0 && ti < trips.Count ? trips[ti] : null;
                route = FirstNonEmpty(trip?.Line, li >= 0 && li < lines.Count ? lines[li].Name : null);
                headsign = trip?.Target;
                nextStop = v.AI_Scheduled_NextBusstopName;
                delay = v.AI_Scheduled_Delay * cfg.DelayScale;
            }
            else if (isPlayer)
            {
                // Hráč bez jízdního řádu: zkusíme proměnné skriptu vozu z ini.
                route = ReadStringVar(v, cfg.PlayerLineVar);
                headsign = ReadStringVar(v, cfg.PlayerHeadsignVar);
                nextStop = ReadStringVar(v, cfg.PlayerNextStopVar);
            }

            // AI auta bez jízdního řádu (běžný provoz) nás nezajímají.
            if (string.IsNullOrWhiteSpace(route) && !isPlayer) return null;

            var dto = new VehicleDto
            {
                Id = v.IDCode != 0 ? v.IDCode.ToString() : "i" + index,
                Ai = !isPlayer,
                Route = Clean(route),
                Headsign = Clean(headsign),
                NextStop = Clean(nextStop),
                Delay = delay,
                Speed = Math.Round(Math.Abs(v.Tacho), 1),
                Vehicle = VehicleName(v),
                Passengers = (int)Math.Max(0, Math.Round(v.Humans_Count))
            };
            SetPosition(dto, v, isPlayer);
            return dto;
        }

        /// <summary>
        /// Poloha v souřadnicích souborů mapy: OMSI drží polohu vozu vůči dlaždici 300 × 300 m,
        /// takže dlaždice × 300 + poloha na dlaždici. Stejně počítá MapExporter silnice
        /// (dlaždice = čísla v názvu tile_X_Y.map), takže vozy a silnice na webu sedí na sebe.
        /// Směr jízdy je z třetího řádku matice polohy (vektor dopředu).
        /// </summary>
        private void SetPosition(VehicleDto dto, OmsiRoadVehicleInst v, bool isPlayer)
        {
            var tile = v.MyKachelPnt;
            var pos = v.Position;
            dto.X = Math.Round(tile.x * TileSize + pos.x, 1);
            dto.Y = Math.Round(tile.y * TileSize + pos.z, 1);
            var m = v.Pos_Mat;
            double hdg = Math.Atan2(m._20, m._22) * 180.0 / Math.PI;
            dto.Heading = Math.Round(hdg < 0 ? hdg + 360 : hdg, 1);
            if (isPlayer && !loggedTile)
            {
                // pro kontrolu při testu: dlaždice by měla odpovídat souboru tile_X_Y.map, kde vůz stojí
                loggedTile = true;
                Log.Write($"Vůz hráče: dlaždice {tile.x}_{tile.y}, poloha na dlaždici {pos.x:0.0} / {pos.z:0.0}");
            }
        }

        private bool loggedTile;

        /// <summary>Složka mapy (…\maps\Mapa) podle toho, odkud OMSI mapu načetlo.</summary>
        public string? MapFolder()
        {
            try
            {
                var file = hook.Globals.Map?.Filename;
                if (string.IsNullOrWhiteSpace(file)) return null;
                if (!Path.IsPathRooted(file))
                {
                    var exe = hook.OmsiProcess?.MainModule?.FileName;
                    if (exe == null) return null;
                    file = Path.Combine(Path.GetDirectoryName(exe)!, file);
                }
                var dir = Directory.Exists(file) ? file : Path.GetDirectoryName(file);
                return dir != null && Directory.EnumerateFiles(dir, "tile_*.map").Any() ? dir : null;
            }
            catch { return null; }
        }

        private const double TileSize = 300.0;

        private static string? VehicleName(OmsiRoadVehicleInst v)
        {
            var model = Clean(v.ComplMapObj?.FriendlyName);
            string? maker = null;
            try { maker = Clean(v.RoadVehicle?.Hersteller); } catch { }
            if (maker == null) return model;
            if (model == null) return maker;
            return model.StartsWith(maker, StringComparison.OrdinalIgnoreCase) ? model : maker + " " + model;
        }

        private static string? ReadStringVar(OmsiRoadVehicleInst v, string name)
        {
            if (string.IsNullOrEmpty(name)) return null;
            try { return v.GetStringVariable(name); } catch { return null; }
        }

        private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();

        private static string FirstNonEmpty(params string?[] values) =>
            values.FirstOrDefault(s => !string.IsNullOrWhiteSpace(s))?.Trim() ?? "";

        // ---- převod struktur OmsiHook na vlastní modely ----

        private static TtLine ConvertLine(OmsiTTLine l) => new(
            l.name ?? "",
            (l.tours ?? Array.Empty<OmsiTTTour>()).Select(t => new TtTour(
                t.name ?? "",
                t.invalide != 0,
                Days(t.validOn),
                (t.entrys ?? Array.Empty<OmsiTTTourEntry>())
                    .Select(e => new TtEntry(e.tripIndex, e.profile, e.startTime)).ToList()
            )).ToList());

        private static TtTrip ConvertTrip(OmsiTTTrip t) => new(
            t.linie ?? "",
            t.target ?? "",
            t.invalide != 0,
            (t.busstops ?? Array.Empty<OmsiTTBusstop>()).Select(b => new TtStop(b.name ?? "", b.name_zusatz ?? "")).ToList(),
            (t.profiles ?? Array.Empty<OmsiTTProfile>()).Select(p => new TtProfile(
                p.serviceTrip,
                (p.stop_times ?? Array.Empty<OmsiTTStopTime>())
                    .Select(s => new TtStopTime(s.arr_time, s.dep_time, s.stopping != 0)).ToList()
            )).ToList());

        private static int[] Days(OmsiTTTourValid v)
        {
            var d = new List<int>();
            if (v.mon != 0) d.Add(1);
            if (v.tue != 0) d.Add(2);
            if (v.wed != 0) d.Add(3);
            if (v.thu != 0) d.Add(4);
            if (v.fri != 0) d.Add(5);
            if (v.sat != 0) d.Add(6);
            if (v.sun != 0) d.Add(7);
            return d.ToArray();
        }
    }
}
