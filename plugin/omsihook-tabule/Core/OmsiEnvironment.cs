using System;
using System.IO;
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
