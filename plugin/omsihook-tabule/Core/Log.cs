using System;
using System.IO;

namespace OmsiTabule
{
    /// <summary>Jednoduchý log do souboru OmsiTabule.log (a na konzoli u CLI).</summary>
    public static class Log
    {
        private static readonly object Lock = new();
        public static string? FilePath;
        public static bool Console;

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
