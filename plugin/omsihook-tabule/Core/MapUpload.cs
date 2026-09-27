using System;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace OmsiTabule
{
    /// <summary>Jednorázové nahrání silnic mapy na server (a přes server do GitHubu).</summary>
    public static class MapUpload
    {
        public sealed record Result(bool Ok, string Message);

        public static async Task<Result> Upload(Config cfg, MapFile map)
        {
            var url = cfg.MapUploadUrl(map.Map.Id);
            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
            http.DefaultRequestHeaders.UserAgent.ParseAdd("OmsiTabule/" + Log.Version);
            if (cfg.MapToken.Length > 0)
                http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", cfg.MapToken);
            var body = JsonSerializer.Serialize(map, JsonOpts.Default);
            using var content = new StringContent(body, Encoding.UTF8, "application/json");
            HttpResponseMessage res;
            try { res = await http.PostAsync(url, content); }
            catch (Exception ex) { return new Result(false, $"Server {url} neodpovídá: {ex.Message}"); }
            var text = await res.Content.ReadAsStringAsync();
            string? error = null, github = null;
            try
            {
                using var doc = JsonDocument.Parse(text);
                if (doc.RootElement.TryGetProperty("error", out var e)) error = e.GetString();
                if (doc.RootElement.TryGetProperty("github", out var g)) github = g.GetString();
            }
            catch { }
            if (!res.IsSuccessStatusCode)
                return new Result(false, $"Server odmítl mapu ({(int)res.StatusCode}): {error ?? text}");
            var gh = github switch
            {
                null or "vypnuto" => "Ukládání do GitHubu není na serveru zapnuté.",
                var s when s.StartsWith("chyba") => "Do GitHubu se nepodařilo uložit: " + s,
                var s => "Uloženo i do GitHubu: " + s
            };
            return new Result(true, $"Mapa „{map.Map.Name}“ nahrána ({map.Layers.Roads.Count} úseků silnic). {gh}");
        }
    }
}
