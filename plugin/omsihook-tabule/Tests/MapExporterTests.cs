using System;
using System.IO;
using System.Linq;
using OmsiTabule;
using Xunit;

public class MapExporterTests
{
    static string Sample() => MapExporter.ReadOmsiText(File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "data", "tile_2510_10709.map")));

    [Fact]
    public void ParsesRealTile()
    {
        var splines = MapExporter.ParseTile(Sample());
        Assert.Equal(49, splines.Count);
        var s = splines.Single(x => x.Id == 1352);
        Assert.Equal(@"Splines\Vodorovne_znaceni\Plna_cara_s.sli", s.File);
        Assert.Equal(344.9609, s.X, 4);
        Assert.Equal(264.3279, s.Y, 4);
        Assert.Equal(-70.64667, s.Heading, 4);
        Assert.Equal(20, s.Length);
        Assert.Equal(400, s.Radius);
    }

    [Theory]
    // úsek → navazující úsek (hodnoty přímo z dlaždice): konec musí sedět na začátek dalšího
    [InlineData(1352, 1675)]   // oblouk R = 400
    [InlineData(1343, 1344)]   // rovný úsek
    [InlineData(1686, 1687)]   // silnice, oblouk R = 200
    public void SplineEndMeetsNextSplineStart(int id, int nextId)
    {
        var all = MapExporter.ParseTile(Sample());
        var a = all.Single(x => x.Id == id);
        var b = all.Single(x => x.Id == nextId);
        var end = MapExporter.Sample(a).Last();
        Assert.True(Math.Abs(end.X - b.X) < 0.3, $"x {end.X} vs {b.X}");
        Assert.True(Math.Abs(end.Y - b.Y) < 0.3, $"y {end.Y} vs {b.Y}");
    }

    [Fact]
    public void BuildsRoadLayerInAbsoluteCoordinates()
    {
        var f = MapExporter.Build("autobahnmap", "Autobahnmap", new[] { (2510, 10709, Sample()) });
        // v dlaždici je 6 úseků silnice; značení a neviditelné cesty AI se vynechají
        Assert.Equal(6, f.Layers.Roads.Count);
        Assert.Empty(f.Layers.Rails);
        var first = f.Layers.Roads[0];
        Assert.Equal(2510 * 300 + 242.5, first[0], 0);
        Assert.Equal(10709 * 300 + 320.4, first[1], 0);
    }

    [Fact]
    public void ClassifiesSplines()
    {
        Assert.Equal(MapExporter.Kind.Skip, MapExporter.Classify(@"Splines\Vodorovne_znaceni\Plna_cara.sli"));
        Assert.Equal(MapExporter.Kind.Skip, MapExporter.Classify(@"Splines\invis_street.sli"));
        Assert.Equal(MapExporter.Kind.Road, MapExporter.Classify(@"Splines\Silnicni sit_Emty\Silnice-2pruhy\asfalt2p-7m-plna+vodici.sli"));
        Assert.Equal(MapExporter.Kind.Rail, MapExporter.Classify(@"Splines\Gleis\strab_gleis.sli"));
    }
}
