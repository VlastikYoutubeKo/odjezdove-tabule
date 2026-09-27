using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace OmsiTabule
{
    /// <summary>Informace o instalaci OMSI a Steamu mimo paměť hry.</summary>
    public static class OmsiEnvironment
    {
        public const string SupportedVersion = "2.3.004";

        /// <summary>
        /// OMSI při startu zapisuje do logfile.txt řádek „Version: 2.3.004“. Na jiné verzi
        /// by OmsiHook četl paměť na špatných adresách, proto odesílání zastavíme.
        /// Vrací null, když verzi nejde zjistit (soubor chybí) – pak pokračujeme s varováním.
        /// </summary>
        public static string? DetectVersion(string omsiDir)
        {
            var path = Path.Combine(omsiDir, "logfile.txt");
            if (!File.Exists(path)) return null;
            try
            {
                using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var reader = new StreamReader(fs);
                for (int i = 0; i < 200 && reader.ReadLine() is { } line; i++)
                {
                    var m = Regex.Match(line, @"Version:\s*([0-9][0-9.]*[0-9])");
                    if (m.Success) return m.Groups[1].Value;
                }
            }
            catch { }
            return null;
        }

        /// <summary>
        /// Složka OMSI 2: z nastavení (omsi_dir), jinak ze Steamu – hlavní knihovna i další
        /// knihovny ze steamapps\libraryfolders.vdf.
        /// </summary>
        public static string? FindOmsiDir(string? configured)
        {
            var candidates = new List<string>();
            if (!string.IsNullOrWhiteSpace(configured)) candidates.Add(configured);
            var steam = SteamPath();
            if (steam != null)
            {
                candidates.Add(Path.Combine(steam, "steamapps", "common", "OMSI 2"));
                var vdf = Path.Combine(steam, "steamapps", "libraryfolders.vdf");
                try
                {
                    if (File.Exists(vdf))
                        foreach (var lib in ParseLibraryFolders(File.ReadAllText(vdf)))
                            candidates.Add(Path.Combine(lib, "steamapps", "common", "OMSI 2"));
                }
                catch { }
            }
            return candidates.FirstOrDefault(d => Directory.Exists(Path.Combine(d, "maps")));
        }

        public static IEnumerable<string> ParseLibraryFolders(string vdf) =>
            Regex.Matches(vdf, @"""path""\s*""(?<p>[^""]+)""").Select(m => m.Groups["p"].Value.Replace(@"\\", @"\"));

        /// <summary>Mapy ve složce maps (podsložky s dlaždicemi tile_*.map), seřazené podle názvu.</summary>
        public static List<(string Folder, string Name)> ListMaps(string omsiDir)
        {
            var maps = new List<(string, string)>();
            var root = Path.Combine(omsiDir, "maps");
            if (!Directory.Exists(root)) return maps;
            foreach (var dir in Directory.EnumerateDirectories(root))
            {
                try
                {
                    if (!Directory.EnumerateFiles(dir, "tile_*.map").Any()) continue;
                    maps.Add((dir, MapExporter.MapNameFromFolder(dir)));
                }
                catch { }
            }
            return maps.OrderBy(m => m.Item2, StringComparer.CurrentCultureIgnoreCase).ToList();
        }

        private static string? SteamPath()
        {
            try
            {
                if (!OperatingSystem.IsWindows()) return null;
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam");
                return key?.GetValue("SteamPath") as string;
            }
            catch { return null; }
        }

        /// <summary>Přezdívka posledního přihlášeného účtu Steam (výchozí jméno řidiče).</summary>
        public static string? SteamPersonaName()
        {
            try
            {
                if (!OperatingSystem.IsWindows()) return null;
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam");
                var steam = key?.GetValue("SteamPath") as string;
                if (string.IsNullOrEmpty(steam)) return null;
                var vdf = Path.Combine(steam, "config", "loginusers.vdf");
                return File.Exists(vdf) ? ParsePersonaName(File.ReadAllText(vdf)) : null;
            }
            catch { return null; }
        }

        /// <summary>Z loginusers.vdf vybere účet s "MostRecent" "1" (jinak první).</summary>
        public static string? ParsePersonaName(string vdf)
        {
            string? first = null;
            foreach (Match user in Regex.Matches(vdf, @"""\d+""\s*\{(?<body>[^{}]*)\}"))
            {
                var body = user.Groups["body"].Value;
                var name = Regex.Match(body, @"""PersonaName""\s*""(?<v>[^""]*)""");
                if (!name.Success) continue;
                var value = name.Groups["v"].Value.Trim();
                if (value.Length == 0) continue;
                first ??= value;
                if (Regex.IsMatch(body, @"""MostRecent""\s*""1""")) return value;
            }
            return first;
        }
    }
}
