using System;
using System.IO;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace OmsiTabule
{
    /// <summary>
    /// Samostatný program – připojí se k běžícímu OMSI zvenku. Dělá totéž co plugin,
    /// jen když něco selže, nespadne kvůli tomu hra. Hodí se na testování.
    ///
    ///   OmsiTabule.exe            posílá vozy na server (Ctrl+C = konec)
    ///   OmsiTabule.exe export     uloží jízdní řád načtené mapy do export\
    ///   OmsiTabule.exe dump       vypíše jeden snímek vozů (nic neposílá)
    ///   OmsiTabule.exe mapa DIR   převede silnice mapy ze složky DIR do export\ (OMSI nemusí běžet)
    ///   OmsiTabule.exe nahrat DIR pošle silnice mapy na server (a přes něj do GitHubu)
    ///   Když OMSI neběží, program nabídne výběr mapy k nahrání.
    /// </summary>
    public static class Program
    {
        private static bool OmsiRunning() =>
            System.Diagnostics.Process.GetProcessesByName("Omsi").Length > 0;

        /// <summary>OMSI neběží: nabídne jednorázové nahrání mapy na server.</summary>
        private static async Task<int> OfflineMenu(Config cfg)
        {
            Console.WriteLine("OMSI 2 neběží.");
            var omsi = OmsiEnvironment.FindOmsiDir(cfg.OmsiDir);
            if (omsi == null)
            {
                Console.WriteLine("Složku OMSI 2 se nepodařilo najít. Nastavte omsi_dir v OmsiTabule.ini, nebo spusťte OMSI a program znovu.");
                return 1;
            }
            var maps = OmsiEnvironment.ListMaps(omsi);
            if (maps.Count == 0) { Console.WriteLine($"Ve složce {omsi}\\maps nejsou žádné mapy."); return 1; }

            Console.WriteLine("Můžete nahrát silnice mapy na server (podklad pro mapu vozů na webu).");
            Console.WriteLine();
            for (int i = 0; i < maps.Count; i++) Console.WriteLine($"  {i + 1,3}  {maps[i].Name}");
            Console.WriteLine("    0  konec");
            Console.Write("\nČíslo mapy: ");
            if (!int.TryParse(Console.ReadLine(), out var n) || n < 1 || n > maps.Count) return 0;

            var (folder, name) = maps[n - 1];
            var suggested = cfg.Map.Length > 0 ? cfg.Map : Text.Slug(name);
            Console.Write($"ID mapy na serveru [{suggested}]: ");
            var typed = (Console.ReadLine() ?? "").Trim();
            var id = typed.Length > 0 ? Text.Slug(typed) : suggested;
            return await UploadMap(cfg, folder, id) ? 0 : 1;
        }

        private static async Task<bool> UploadMap(Config cfg, string folder, string? id)
        {
            var name = MapExporter.MapNameFromFolder(folder);
            id ??= Text.Slug(name);
            Console.WriteLine($"Čtu silnice mapy „{name}“…");
            var map = MapExporter.FromFolder(folder, id, name);
            if (map.Layers.Roads.Count == 0 && map.Layers.Rails.Count == 0)
            {
                Console.WriteLine("V mapě se nenašly žádné silnice.");
                return false;
            }
            Console.WriteLine($"{map.Tiles} dlaždic, {map.Layers.Roads.Count} úseků silnic. Posílám na {cfg.MapUploadUrl(id)} …");
            var r = await MapUpload.Upload(cfg, map);
            Log.Write(r.Message);
            if (!r.Ok && cfg.MapToken.Length == 0) Console.WriteLine("Tip: nastavte map_token v OmsiTabule.ini (token od správce serveru).");
            return r.Ok;
        }

        public static async Task<int> Main(string[] args)
        {
            Log.Console = true;
            var dir = AppContext.BaseDirectory;
            Log.FilePath = Path.Combine(dir, "OmsiTabule.log");
            var cfg = Config.Load(Path.Combine(dir, "OmsiTabule.ini"));
            string cmd = args.Length > 0 ? args[0].ToLowerInvariant() : "run";

            Log.Write($"OmsiTabule {Log.Version}");
            if (cmd == "mapa" || cmd == "nahrat")
            {
                // převod silnic ze složky mapy – OMSI nemusí běžet; „nahrat“ je navíc pošle na server
                if (args.Length < 2 || !Directory.Exists(args[1]))
                {
                    Console.WriteLine($"Použití: OmsiTabule.exe {cmd} \"C:\\…\\OMSI 2\\maps\\Mapa\" [id-mapy]");
                    return 2;
                }
                var id = args.Length > 2 ? args[2] : (cfg.Map.Length > 0 ? cfg.Map : null);
                if (cmd == "mapa") { Tracker.ExportMap(args[1], id, null, dir); return 0; }
                return await UploadMap(cfg, args[1], id) ? 0 : 1;
            }

            if (cmd == "run" && !OmsiRunning())
                return await OfflineMenu(cfg);

            Console.WriteLine("Připojuji se k OMSI 2 (musí běžet, verze 2.3.004)…");
            using var hook = new OmsiHook.OmsiHook();
            await hook.AttachToOMSI(false);
            Console.WriteLine("Připojeno.");

            using var tracker = new Tracker(hook, cfg);
            if (cmd != "run" && !tracker.Preflight()) return 1;
            switch (cmd)
            {
                case "export":
                    return tracker.Export() != null ? 0 : 1;
                case "dump":
                    Console.WriteLine(JsonSerializer.Serialize(tracker.Snapshot(),
                        new JsonSerializerOptions(Tracker.Json) { WriteIndented = true }));
                    return 0;
                case "run":
                    tracker.Start();
                    var done = new ManualResetEventSlim();
                    Console.CancelKeyPress += (_, e) => { e.Cancel = true; done.Set(); };
                    Console.WriteLine("Běží. Ctrl+C = konec.");
                    done.Wait();
                    return 0;
                default:
                    Console.WriteLine("Použití: OmsiTabule.exe [run|export|dump|mapa <složka>|nahrat <složka>]");
                    return 2;
            }
        }
    }
}
