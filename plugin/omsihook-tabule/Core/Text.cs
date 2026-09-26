using System.Globalization;
using System.Text;

namespace OmsiTabule
{
    public static class Text
    {
        /// <summary>"Bílina, aut. nádr." → "bilina-aut-nadr" (ID zastávek a map).</summary>
        public static string Slug(string? s)
        {
            if (string.IsNullOrWhiteSpace(s)) return "";
            var sb = new StringBuilder();
            bool dash = false;
            foreach (var ch in s.Normalize(NormalizationForm.FormD))
            {
                if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark) continue;
                var c = char.ToLowerInvariant(ch);
                if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) { sb.Append(c); dash = false; }
                else if (!dash && sb.Length > 0) { sb.Append('-'); dash = true; }
            }
            return sb.ToString().Trim('-');
        }

        /// <summary>Minuty od půlnoci → "HH:MM" (přes půlnoc se přetočí).</summary>
        public static string HM(double minutes)
        {
            int m = (int)System.Math.Round(minutes);
            m = ((m % 1440) + 1440) % 1440;
            return $"{m / 60:00}:{m % 60:00}";
        }
    }
}
