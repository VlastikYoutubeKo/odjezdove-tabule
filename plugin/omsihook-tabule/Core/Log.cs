using System;
using System.IO;
using System.Reflection;

namespace OmsiTabule
{
    /// <summary>Jednoduchý log do souboru OmsiTabule.log (a na konzoli u CLI).</summary>
    public static class Log
    {
        private static readonly object Lock = new();
        public static string? FilePath;
        public static bool Console;

        /// <summary>Verze z releasu (tag vX.Y.Z), při lokálním buildu „dev“.</summary>
        public static string Version
        {
            get
            {
                var v = typeof(Log).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
                if (string.IsNullOrEmpty(v)) return "dev";
                int plus = v.IndexOf('+');   // .NET přidává +hash commitu
                return plus > 0 ? v[..plus] : v;
            }
        }

        public static void Write(string msg)
        {
            var line = $"[{DateTime.Now:HH:mm:ss}] {msg}";
            lock (Lock)
            {
                if (Console) System.Console.WriteLine(line);
                if (FilePath == null) return;
                try { File.AppendAllText(FilePath, line + Environment.NewLine); } catch { }
            }
        }
    }
}
