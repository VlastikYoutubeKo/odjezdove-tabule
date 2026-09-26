using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace OmsiTabule
{
    // ---- jízdní řád tak, jak ho má OMSI (nezávislé na OmsiHook, kvůli testům) ----

    public sealed record TtLine(string Name, List<TtTour> Tours);
    /// <summary>Days: 1 = pondělí … 7 = neděle.</summary>
    public sealed record TtTour(string Name, bool Invalid, int[] Days, List<TtEntry> Entries);
    /// <summary>StartTime v jednotkách OMSI (viz Exporter.DetectTimeUnit).</summary>
    public sealed record TtEntry(int TripIndex, int Profile, double StartTime);
    public sealed record TtTrip(string Line, string Target, bool Invalid, List<TtStop> Stops, List<TtProfile> Profiles);
    public sealed record TtStop(string Name, string Extra);
    public sealed record TtProfile(bool Service, List<TtStopTime> Times);
    public sealed record TtStopTime(double Arr, double Dep, bool Stopping);

    // ---- JSON pro server (formát data/*.json a POST /api/vehicles) ----

    public sealed class ExportFile
    {
        [JsonPropertyName("format")] public string Format { get; set; } = "odjezdove-tabule-export";
        [JsonPropertyName("version")] public int Version { get; set; } = 1;
        [JsonPropertyName("generated")] public string Generated { get; set; } = "";
        [JsonPropertyName("timeUnit")] public string TimeUnit { get; set; } = "";
        [JsonPropertyName("map")] public MapDto Map { get; set; } = new();
        [JsonPropertyName("stops")] public List<StopDto> Stops { get; set; } = new();
        [JsonPropertyName("timetable")] public TimetableDto Timetable { get; set; } = new();
    }

    public sealed class MapDto
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("name")] public string Name { get; set; } = "";
    }

    public sealed class StopDto
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("name")] public string Name { get; set; } = "";
        [JsonPropertyName("map")] public string Map { get; set; } = "";
        [JsonPropertyName("source")] public string Source { get; set; } = "timetable";
    }

    public sealed class TimetableDto
    {
        [JsonPropertyName("map")] public string Map { get; set; } = "";
        [JsonPropertyName("routes")] public List<RouteDto> Routes { get; set; } = new();
    }

    public sealed class RouteDto
    {
        [JsonPropertyName("route")] public string Route { get; set; } = "";
        [JsonPropertyName("headsign")] public string Headsign { get; set; } = "";
        [JsonPropertyName("days")] [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int[]? Days { get; set; }
        [JsonPropertyName("stops")] public List<RouteStopDto> Stops { get; set; } = new();
        [JsonPropertyName("departures")] public List<string> Departures { get; set; } = new();
    }

    public sealed class RouteStopDto
    {
        [JsonPropertyName("stop")] public string Stop { get; set; } = "";
        [JsonPropertyName("platform")] [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Platform { get; set; }
        [JsonPropertyName("offset")] public double Offset { get; set; }
    }

    public sealed class ReportDto
    {
        [JsonPropertyName("source")] public SourceDto Source { get; set; } = new();
        [JsonPropertyName("vehicles")] public List<VehicleDto> Vehicles { get; set; } = new();
    }

    public sealed class SourceDto
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("driver")] public string? Driver { get; set; }
        [JsonPropertyName("map")] public string? Map { get; set; }
        [JsonPropertyName("gameTime")] public string? GameTime { get; set; }
    }

    public sealed class VehicleDto
    {
        [JsonPropertyName("id")] public string Id { get; set; } = "";
        [JsonPropertyName("ai")] public bool Ai { get; set; }
        [JsonPropertyName("route")] public string? Route { get; set; }
        [JsonPropertyName("headsign")] public string? Headsign { get; set; }
        [JsonPropertyName("nextStop")] public string? NextStop { get; set; }
        [JsonPropertyName("delay")] public double? Delay { get; set; }
        [JsonPropertyName("speed")] public double? Speed { get; set; }
        [JsonPropertyName("vehicle")] public string? Vehicle { get; set; }
        [JsonPropertyName("x")] public double? X { get; set; }
        [JsonPropertyName("y")] public double? Y { get; set; }
    }
}
