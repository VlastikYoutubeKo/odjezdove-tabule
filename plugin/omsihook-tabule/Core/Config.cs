using System;
using System.Collections.Generic;
using System.IO;

namespace OmsiTabule
{
    /// <summary>Nastavení z OmsiTabule.ini (jednoduchý formát klíč=hodnota).</summary>
    public sealed class Config
    {
        public string Server = "http://localhost:8080/api/vehicles";
        public string Token = "";
        public string Driver = "";
        /// <summary>ID mapy ze souboru data/stops.json; prázdné = odvodí se z názvu mapy v OMSI.</summary>
        public string Map = "";
        /// <summary>ID tohoto hráče; prázdné = název počítače.</summary>
        public string Id = "";
        public int IntervalSeconds = 5;
        public bool IncludeAi = true;
        /// <summary>Po načtení mapy uložit její jízdní řád do složky export.</summary>
        public bool ExportOnLoad = true;
        /// <summary>Převod AI_Scheduled_Delay na sekundy (pro případ, že by OMSI počítalo v jiných jednotkách).</summary>
        public double DelayScale = 1.0;
        /// <summary>Záložní proměnné skriptu hráčova vozu, když OMSI nemá platná data jízdního řádu.</summary>
        public string PlayerLineVar = "";
        public string PlayerHeadsignVar = "";
        public string PlayerNextStopVar = "";

        public string BaseDir = AppContext.BaseDirectory;

        public static Config Load(string path)
        {
            var c = new Config { BaseDir = Path.GetDirectoryName(Path.GetFullPath(path)) ?? AppContext.BaseDirectory };
            if (!File.Exists(path)) return c;
            var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var raw in File.ReadAllLines(path))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line[0] == ';' || line[0] == '#' || line[0] == '[') continue;
                int eq = line.IndexOf('=');
                if (eq <= 0) continue;
                values[line[..eq].Trim()] = line[(eq + 1)..].Trim();
            }
            string Get(string k, string d) => values.TryGetValue(k, out var v) && v.Length > 0 ? v : d;
            c.Server = Get("server", c.Server);
            c.Token = Get("token", c.Token);
            c.Driver = Get("driver", c.Driver);
            c.Map = Get("map", c.Map);
            c.Id = Get("id", c.Id);
            c.IntervalSeconds = Math.Max(2, int.TryParse(Get("interval", "5"), out var i) ? i : 5);
            c.IncludeAi = Get("include_ai", "1") != "0";
            c.ExportOnLoad = Get("export_on_load", "1") != "0";
            c.DelayScale = double.TryParse(Get("delay_scale", "1"), System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var s) ? s : 1.0;
            c.PlayerLineVar = Get("player_line_var", "");
            c.PlayerHeadsignVar = Get("player_headsign_var", "");
            c.PlayerNextStopVar = Get("player_next_stop_var", "");
            if (c.Id.Length == 0) c.Id = "omsi-" + Environment.MachineName;
            return c;
        }
    }
}
