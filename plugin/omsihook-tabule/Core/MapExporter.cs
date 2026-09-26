using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace OmsiTabule
{
    /// <summary>
    /// Silniční síť ze souborů mapy OMSI (maps\&lt;mapa&gt;\tile_X_Y.map) jako podklad pro mapu na webu.
    ///
    /// Úsek v sekci [spline] má na řádcích (od nuly): 1 = soubor .sli, 2 = ID, 3/4 = předchozí/další,
    /// 5 = x, 6 = výška, 7 = y, 8 = směr ve stupních (0 = sever, po směru hodin), 9 = délka,
    /// 10 = poloměr (0 = rovně, kladný = zatáčí doprava). Ověřeno na navazujících úsecích.
    /// Souřadnice jsou vůči dlaždici 300 × 300 m, jejíž pozice je v názvu souboru.
    /// </summary>
    public static class MapExporter
    {
        public const double TileSize = 300.0;

        public sealed record Spline(string File, int Id, double X, double Y, double Heading, double Length, double Radius);

        public enum Kind { Road, Rail, Skip }

        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
        private static readonly Regex TileName = new(@"^tile_(-?\d+)_(-?\d+)\.map$", RegexOptions.IgnoreCase);

        /// <summary>Soubory OMSI bývají v UTF-16 s BOM, starší v ANSI (Windows-1250/1252).</summary>
        public static string ReadOmsiText(byte[] bytes)
        {
            if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE) return Encoding.Unicode.GetString(bytes, 2, bytes.Length - 2);
            if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF) return Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3);
            return Encoding.Latin1.GetString(bytes);
        }

        public static List<Spline> ParseTile(string text)
        {
            var result = new List<Spline>();
            var lines = text.Replace("\r", "").Split('\n');
            for (int i = 0; i < lines.Length; i++)
            {
                var head = lines[i].Trim();
                if (!head.Equals("[spline]", StringComparison.OrdinalIgnoreCase) &&
                    !head.Equals("[spline_h]", StringComparison.OrdinalIgnoreCase)) continue;
                if (i + 11 >= lines.Length) break;
                string F(int k) => lines[i + 1 + k].Trim();
                if (!int.TryParse(F(2), NumberStyles.Integer, Inv, out var id)) continue;
                if (!TryNum(F(5), out var x) || !TryNum(F(7), out var y) || !TryNum(F(8), out var rot) ||
                    !TryNum(F(9), out var len) || !TryNum(F(10), out var rad)) continue;
                result.Add(new Spline(F(1), id, x, y, rot, len, rad));
            }
            return result;
        }

        private static bool TryNum(string s, out double v) =>
            double.TryParse(s, NumberStyles.Float, Inv, out v) && double.IsFinite(v);

        public static Kind Classify(string sli)
        {
            var s = sli.ToLowerInvariant();
            if (s.Contains("invis") || s.Contains("znaceni") || s.Contains("markierung") || s.Contains("marking")) return Kind.Skip;
            if (s.Contains("gleis") || s.Contains("rail") || s.Contains("kolej") || s.Contains("tram") ||
                s.Contains("schiene") || s.Contains("strab")) return Kind.Rail;
            return Kind.Road;
        }

        /// <summary>Body úseku v souřadnicích dlaždice; oblouk se dělí po zhruba 4 m.</summary>
        public static List<(double X, double Y)> Sample(Spline s)
        {
            var pts = new List<(double, double)>();
            double h0 = s.Heading * Math.PI / 180.0;
            bool straight = Math.Abs(s.Radius) < 1e-6;
            int n = straight ? 1 : Math.Max(2, (int)Math.Ceiling(Math.Abs(s.Length) / 4.0));
            for (int k = 0; k <= n; k++)
            {
                double d = s.Length * k / n;
                if (straight)
                {
                    pts.Add((s.X + d * Math.Sin(h0), s.Y + d * Math.Cos(h0)));
                }
                else
                {
                    double h = h0 + d / s.Radius;
                    pts.Add((s.X + s.Radius * (Math.Cos(h0) - Math.Cos(h)), s.Y + s.Radius * (Math.Sin(h) - Math.Sin(h0))));
                }
            }
            return pts;
        }

        public static MapFile Build(string mapId, string mapName, IEnumerable<(int TileX, int TileY, string Text)> tiles)
        {
            var file = new MapFile { Map = new MapDto { Id = mapId, Name = mapName }, Generated = DateTime.UtcNow.ToString("o") };
            int tileCount = 0;
            foreach (var (tx, ty, text) in tiles)
            {
                tileCount++;
                double ox = tx * TileSize, oy = ty * TileSize;
                foreach (var s in ParseTile(text))
                {
                    var kind = Classify(s.File);
                    if (kind == Kind.Skip || s.Length <= 0) continue;
                    var flat = new List<double>();
                    foreach (var (x, y) in Sample(s))
                    {
                        flat.Add(Math.Round(ox + x, 1));
                        flat.Add(Math.Round(oy + y, 1));
                    }
                    (kind == Kind.Rail ? file.Layers.Rails : file.Layers.Roads).Add(flat);
                }
            }
            file.Tiles = tileCount;
            return file;
        }

        /// <summary>Načte všechny tile_X_Y.map ze složky mapy.</summary>
        public static MapFile FromFolder(string folder, string mapId, string mapName)
        {
            var tiles = new List<(int, int, string)>();
            foreach (var path in Directory.EnumerateFiles(folder, "tile_*.map"))
            {
                var m = TileName.Match(Path.GetFileName(path));
                if (!m.Success) continue;
                tiles.Add((int.Parse(m.Groups[1].Value, Inv), int.Parse(m.Groups[2].Value, Inv), ReadOmsiText(File.ReadAllBytes(path))));
            }
            return Build(mapId, mapName, tiles);
        }

        /// <summary>Název mapy z global.cfg ([friendlyname]), jinak název složky.</summary>
        public static string MapNameFromFolder(string folder)
        {
            var cfg = Path.Combine(folder, "global.cfg");
            if (File.Exists(cfg))
            {
                var lines = ReadOmsiText(File.ReadAllBytes(cfg)).Replace("\r", "").Split('\n');
                for (int i = 0; i + 1 < lines.Length; i++)
                    if (lines[i].Trim().Equals("[friendlyname]", StringComparison.OrdinalIgnoreCase) && lines[i + 1].Trim().Length > 0)
                        return lines[i + 1].Trim();
            }
            return Path.GetFileName(Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        }
    }

    public sealed class MapFile
    {
        [JsonPropertyName("format")] public string Format { get; set; } = "odjezdove-tabule-mapa";
        [JsonPropertyName("version")] public int Version { get; set; } = 1;
        [JsonPropertyName("generated")] public string Generated { get; set; } = "";
        [JsonPropertyName("map")] public MapDto Map { get; set; } = new();
        [JsonPropertyName("tiles")] public int Tiles { get; set; }
        /// <summary>Každá čára je plochý seznam [x0, y0, x1, y1, …] v metrech (x = východ, y = sever).</summary>
        [JsonPropertyName("layers")] public MapLayers Layers { get; set; } = new();
    }

    public sealed class MapLayers
    {
        [JsonPropertyName("roads")] public List<List<double>> Roads { get; set; } = new();
        [JsonPropertyName("rails")] public List<List<double>> Rails { get; set; } = new();
    }
}
