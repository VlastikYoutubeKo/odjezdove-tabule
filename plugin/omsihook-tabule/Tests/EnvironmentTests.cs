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
