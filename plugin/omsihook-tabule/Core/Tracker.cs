using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace OmsiTabule
{
    /// <summary>
    /// Na pozadí každých pár sekund přečte vozy z OMSI a pošle je na server.
    /// Po načtení mapy uloží její jízdní řád do složky export/.
    /// </summary>
    public sealed class Tracker : IDisposable
    {
        public static readonly JsonSerializerOptions Json = new()
        {
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            WriteIndented = false,
            DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
        };

        private readonly Config cfg;
        private readonly OmsiReader reader;
        private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(5) };
        private readonly CancellationTokenSource cts = new();
        private Task? loop;
        private int failures;

        public Tracker(OmsiHook.OmsiHook hook, Config cfg)
        {
            this.cfg = cfg;
            this.hook = hook;
            reader = new OmsiReader(hook, cfg);
            http.DefaultRequestHeaders.UserAgent.ParseAdd("OmsiTabule/1.0");
            if (cfg.Token.Length > 0)
                http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", cfg.Token);
        }

        public void Start() => loop = Task.Run(() => Run(cts.Token));

        private readonly OmsiHook.OmsiHook hook;

        /// <summary>Kontrola verze OMSI a doplnění jména řidiče. False = neodesílat.</summary>
        public bool Preflight()
        {
            if (cfg.Driver.Length == 0)
            {
                var steam = OmsiEnvironment.SteamPersonaName();
                if (steam != null) { cfg.Driver = steam; Log.Write($"Jméno řidiče ze Steamu: {steam}"); }
            }
            string? exe = null;
            try { exe = hook.OmsiProcess?.MainModule?.FileName; } catch { }
            var dir = exe != null ? Path.GetDirectoryName(exe) : null;
            var version = dir != null ? OmsiEnvironment.DetectVersion(dir) : null;
            if (version == null)
            {
                Log.Write($"Verzi OMSI se nepodařilo zjistit (logfile.txt), pokračuji. Podporovaná je {OmsiEnvironment.SupportedVersion}.");
                return true;
            }
            if (version != OmsiEnvironment.SupportedVersion && cfg.CheckVersion)
            {
                Log.Write($"CHYBA: OMSI {version} není podporované (jen {OmsiEnvironment.SupportedVersion}). " +
                          "OmsiHook by četl špatná místa v paměti, odesílání je vypnuté. (check_version=0 kontrolu vypne)");
                return false;
            }
            Log.Write($"OMSI {version}");
            return true;
        }

        private async Task Run(CancellationToken ct)
        {
            if (!Preflight()) return;
            Log.Write($"Odesílám na {cfg.Server} každých {cfg.IntervalSeconds} s jako „{cfg.Id}“");
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    if (reader.RefreshTimetable() && cfg.ExportOnLoad) Export();
                    await Send(reader.Snapshot(), ct);
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex)
                {
                    // chyby logujeme jen občas, ať log nezaplní disk
                    if (failures++ % 12 == 0) Log.Write($"Chyba: {ex.Message}");
                }
                try { await Task.Delay(TimeSpan.FromSeconds(cfg.IntervalSeconds), ct); }
                catch (OperationCanceledException) { break; }
            }
        }

        public async Task Send(ReportDto report, CancellationToken ct = default)
        {
            if (report.Source.Map == null) return; // mapa ještě není načtená
            var body = JsonSerializer.Serialize(report, Json);
            using var content = new StringContent(body, Encoding.UTF8, "application/json");
            using var res = await http.PostAsync(cfg.Server, content, ct);
            if (!res.IsSuccessStatusCode)
                throw new Exception($"server vrátil {(int)res.StatusCode}: {await res.Content.ReadAsStringAsync(ct)}");
            if (failures > 0) { Log.Write($"Spojení se serverem obnoveno ({report.Vehicles.Count} vozů)"); failures = 0; }
        }

        /// <summary>Uloží jízdní řád aktuální mapy. Vrací cestu k souboru.</summary>
        public string? Export()
        {
            var file = reader.BuildExport();
            if (file == null) { Log.Write("Export: mapa není načtená"); return null; }
            var dir = Path.Combine(cfg.BaseDir, "export");
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, file.Map.Id + ".json");
            File.WriteAllText(path, JsonSerializer.Serialize(file, new JsonSerializerOptions(Json) { WriteIndented = true }));
            Log.Write($"Export: {file.Stops.Count} zastávek, {file.Timetable.Routes.Count} tras → {path}");
            var folder = reader.MapFolder();
            if (folder != null) ExportMap(folder, file.Map.Id, file.Map.Name, cfg.BaseDir);
            else Log.Write("Export mapy: složku mapy se nepodařilo zjistit – použijte OmsiTabule.exe mapa <složka>");
            return path;
        }

        /// <summary>Silniční síť mapy do export\&lt;mapa&gt;-mapa.json (nepotřebuje běžící OMSI).</summary>
        public static string ExportMap(string folder, string? mapId, string? mapName, string baseDir)
        {
            mapName ??= MapExporter.MapNameFromFolder(folder);
            mapId ??= Text.Slug(mapName);
            var map = MapExporter.FromFolder(folder, mapId, mapName);
            var dir = Path.Combine(baseDir, "export");
            Directory.CreateDirectory(dir);
            var path = Path.Combine(dir, mapId + "-mapa.json");
            File.WriteAllText(path, JsonSerializer.Serialize(map, Json));
            Log.Write($"Export mapy: {map.Tiles} dlaždic, {map.Layers.Roads.Count} úseků silnic, {map.Layers.Rails.Count} kolejí → {path}");
            return path;
        }

        public ReportDto Snapshot() => reader.Snapshot();

        public void Dispose()
        {
            cts.Cancel();
            try { loop?.Wait(TimeSpan.FromSeconds(3)); } catch { }
            http.Dispose();
        }
    }
}
