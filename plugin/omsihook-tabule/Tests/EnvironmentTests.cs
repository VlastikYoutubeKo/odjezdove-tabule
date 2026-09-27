using System;
using System.IO;
using OmsiTabule;
using Xunit;

public class EnvironmentTests
{
    [Fact]
    public void ReadsVersionFromOmsiLogfile()
    {
        var dir = Directory.CreateTempSubdirectory().FullName;
        Assert.Null(OmsiEnvironment.DetectVersion(dir));
        File.WriteAllText(Path.Combine(dir, "logfile.txt"),
            "Omsi-Logfile\r\n------------\r\n  12:00:01 - Version: 2.3.004 - 1.3.2018\r\n  12:00:05 - Loading map...\r\n");
        Assert.Equal("2.3.004", OmsiEnvironment.DetectVersion(dir));
    }

    [Fact]
    public void PicksMostRecentSteamUser()
    {
        const string vdf = @"""users""
{
	""76561190000000001""
	{
		""AccountName""		""stary""
		""PersonaName""		""Starý účet""
		""MostRecent""		""0""
	}
	""76561190000000002""
	{
		""AccountName""		""vlasta""
		""PersonaName""		""Vlasta""
		""MostRecent""		""1""
	}
}";
        Assert.Equal("Vlasta", OmsiEnvironment.ParsePersonaName(vdf));
        Assert.Equal("Starý účet", OmsiEnvironment.ParsePersonaName(vdf.Replace(@"""MostRecent""		""1""", @"""MostRecent""		""0""")));
        Assert.Null(OmsiEnvironment.ParsePersonaName("nic"));
    }
}

public class MapUploadConfigTests
{
    [Theory]
    [InlineData("https://x.workers.dev/api/vehicles", "https://x.workers.dev/api/maps/autobahnmap")]
    [InlineData("http://localhost:8080/api/vehicles/", "http://localhost:8080/api/maps/autobahnmap")]
    [InlineData("https://muj.server.cz", "https://muj.server.cz/api/maps/autobahnmap")]
    public void DerivesMapUploadUrl(string server, string expected)
    {
        var c = new Config { Server = server };
        Assert.Equal(expected, c.MapUploadUrl("autobahnmap"));
    }

    [Fact]
    public void ParsesSteamLibraries()
    {
        const string vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}";
        Assert.Equal(new[] { @"C:\Program Files (x86)\Steam", @"D:\SteamLibrary" }, OmsiEnvironment.ParseLibraryFolders(vdf));
    }

    [Fact]
    public void ListsMapsWithTiles()
    {
        var root = Directory.CreateTempSubdirectory().FullName;
        var withTiles = Path.Combine(root, "maps", "Autobahnmap");
        Directory.CreateDirectory(withTiles);
        File.Copy(Path.Combine(AppContext.BaseDirectory, "data", "tile_2510_10709.map"), Path.Combine(withTiles, "tile_2510_10709.map"));
        Directory.CreateDirectory(Path.Combine(root, "maps", "Prazdna"));
        var maps = OmsiEnvironment.ListMaps(root);
        Assert.Single(maps);
        Assert.Equal("Autobahnmap", maps[0].Name);
        Assert.Equal(root, OmsiEnvironment.FindOmsiDir(root));
    }
}
