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
    /// </summary>
    public static class Program
    {
        public static async Task<int> Main(string[] args)
        {
            Log.Console = true;
            var dir = AppContext.BaseDirectory;
            Log.FilePath = Path.Combine(dir, "OmsiTabule.log");
            var cfg = Config.Load(Path.Combine(dir, "OmsiTabule.ini"));
            string cmd = args.Length > 0 ? args[0].ToLowerInvariant() : "run";

            Console.WriteLine("Připojuji se k OMSI 2 (musí běžet, verze 2.3.004)…");
            using var hook = new OmsiHook.OmsiHook();
            await hook.AttachToOMSI(false);
            Console.WriteLine("Připojeno.");

            using var tracker = new Tracker(hook, cfg);
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
                    Console.WriteLine("Použití: OmsiTabule.exe [run|export|dump]");
                    return 2;
            }
        }
    }
}
