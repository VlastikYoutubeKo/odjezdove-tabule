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
            reader = new OmsiReader(hook, cfg);
            http.DefaultRequestHeaders.UserAgent.ParseAdd("OmsiTabule/1.0");
            if (cfg.Token.Length > 0)
                http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", cfg.Token);
        }

        public void Start() => loop = Task.Run(() => Run(cts.Token));

        private async Task Run(CancellationToken ct)
        {
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
