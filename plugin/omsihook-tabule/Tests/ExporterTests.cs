using System.Collections.Generic;
using System.IO;
using System.Linq;
using OmsiTabule;
using Xunit;

public class ExporterTests
{
    static TtTrip Trip(string line, string target, params (string name, double arr, double dep, bool stop)[] stops) =>
        new(line, target, false,
            stops.Select(s => new TtStop(s.name, "")).ToList(),
            new List<TtProfile> { new(false, stops.Select(s => new TtStopTime(s.arr, s.dep, s.stop)).ToList()) });

    static readonly List<TtTrip> Trips = new()
    {
        Trip("201", "Nemocnice", ("Lovosice, aut. nádr.", 0, 0, true), ("Průjezdná", 2, 2, false), ("Lovosice, nemocnice", 6, 6.5, true)),
        Trip("", "Maxičky", ("Lovosice, aut. nádr.", 0, 0.5, true), ("Maxičky", 12, 12, true))
    };

    [Fact]
    public void GroupsTripsIntoRoutesWithDaysAndOffsets()
    {
        var lines = new List<TtLine>
        {
            new("201", new List<TtTour>
            {
                new("1", false, new[] { 1, 2, 3, 4, 5, 6, 7 }, new List<TtEntry> { new(0, 0, 330), new(0, 0, 390) }),
                new("2", false, new[] { 1, 2, 3, 4, 5, 6, 7 }, new List<TtEntry> { new(0, 0, 360), new(0, 0, 330) }),
                new("zrušený", true, new[] { 1 }, new List<TtEntry> { new(0, 0, 999) })
            }),
            new("210", new List<TtTour>
            {
                new("1", false, new[] { 1, 2, 3, 4, 5 }, new List<TtEntry> { new(1, 0, 1450) })
            })
        };

        var f = Exporter.Build("autobahnmap", "Autobahnmap", lines, Trips);

        Assert.Equal("minutes", f.TimeUnit);
        Assert.Equal(2, f.Timetable.Routes.Count);
        var r201 = f.Timetable.Routes[0];
        Assert.Equal("201", r201.Route);
        Assert.Null(r201.Days);
        Assert.Equal(new[] { "05:30", "06:00", "06:30" }, r201.Departures);   // bez duplicit, seřazené
        Assert.Equal(new[] { "lovosice-aut-nadr", "lovosice-nemocnice" }, r201.Stops.Select(s => s.Stop)); // průjezd vynechán
        Assert.Equal(6, r201.Stops[1].Offset); // konečná = příjezd

        var r210 = f.Timetable.Routes[1];
        Assert.Equal("210", r210.Route);           // prázdná linka spoje → název linky
        Assert.Equal(new[] { 1, 2, 3, 4, 5 }, r210.Days);
        Assert.Equal(new[] { "00:10" }, r210.Departures); // přes půlnoc
        Assert.Equal(0.5, r210.Stops[0].Offset);

        Assert.Equal(new[] { "Lovosice, aut. nádr.", "Lovosice, nemocnice", "Maxičky" }, f.Stops.Select(s => s.Name));
        Assert.All(f.Stops, s => Assert.Equal("autobahnmap", s.Map));
    }

    [Fact]
    public void DetectsSecondsAndSkipsServiceTrips()
    {
        var trips = new List<TtTrip>(Trips)
        {
            new("201", "Vozovna", false, new() { new("A", ""), new("B", "") },
                new() { new(true, new() { new(0, 0, true), new(5, 5, true) }) })
        };
        var lines = new List<TtLine>
        {
            new("201", new() { new("1", false, new[] { 1, 2, 3, 4, 5, 6, 7 }, new() { new(0, 0, 19800), new(2, 0, 20000) }) })
        };
        var f = Exporter.Build("m", "M", lines, trips);
        Assert.Equal("seconds", f.TimeUnit);
        var r = Assert.Single(f.Timetable.Routes);
        Assert.Equal(new[] { "05:30" }, r.Departures);
        Assert.Equal(0.1, r.Stops[1].Offset, 3); // 6 s = 0,1 min
    }

    [Fact]
    public void SlugAndConfig()
    {
        Assert.Equal("bilina-aut-nadr", Text.Slug("Bílina, aut. nádr."));
        Assert.Equal("autobahnmap-v-cesku", Text.Slug("  Autobahnmap v Česku! "));

        var path = Path.GetTempFileName();
        File.WriteAllText(path, "; komentář\n[x]\nserver = https://a.b/api/vehicles\ninterval=1\ninclude_ai=0\ndelay_scale=60\nid=hrac\n");
        var c = Config.Load(path);
        Assert.Equal("https://a.b/api/vehicles", c.Server);
        Assert.Equal(2, c.IntervalSeconds);   // minimum
        Assert.False(c.IncludeAi);
        Assert.Equal(60, c.DelayScale);
        Assert.Equal("hrac", c.Id);
    }
}
