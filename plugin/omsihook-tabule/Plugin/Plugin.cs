using System;
using System.IO;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using DNNE;

namespace OmsiTabule
{
    /// <summary>
    /// Vstupní body pluginu OMSI 2. DNNE z nich vyrobí nativní OmsiTabuleNE.dll,
    /// kterou načítá OMSI podle OmsiTabule.opl. Konvence volání odpovídá ukázkovému
    /// pluginu OmsiHook (OmsiHookPlugin), který je ve hře ověřený.
    /// </summary>
    public static class Plugin
    {
        private static OmsiHook.OmsiHook? hook;
        private static Tracker? tracker;

        [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) }, EntryPoint = nameof(PluginStart))]
        public static void PluginStart(IntPtr aOwner)
        {
            try
            {
                var dir = AppContext.BaseDirectory;
                Log.FilePath = Path.Combine(dir, "OmsiTabule.log");
                try { File.Delete(Log.FilePath); } catch { }
                var cfg = Config.Load(Path.Combine(dir, "OmsiTabule.ini"));
                Log.Write("OmsiTabule: start");

                // Připojení k OMSI chvíli trvá – neblokujeme načítání hry.
                Task.Run(async () =>
                {
                    try
                    {
                        hook = new OmsiHook.OmsiHook();
                        await hook.AttachToOMSI(false);
                        tracker = new Tracker(hook, cfg);
                        tracker.Start();
                    }
                    catch (Exception ex)
                    {
                        Log.Write("Nepodařilo se připojit k OMSI: " + ex);
                    }
                });
            }
            catch (Exception ex)
            {
                Log.Write("PluginStart: " + ex);
            }
        }

        [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) }, EntryPoint = nameof(PluginFinalize))]
        public static void PluginFinalize()
        {
            Log.Write("OmsiTabule: konec");
            tracker?.Dispose();
            hook?.Dispose();
        }

        // OMSI tyto funkce vyžaduje, i když plugin žádné proměnné nečte.
        [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) }, EntryPoint = nameof(AccessVariable))]
        public static void AccessVariable(ushort variableIndex, [C99Type("float*")] IntPtr value, [C99Type("__crt_bool*")] IntPtr writeValue) { }

        [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) }, EntryPoint = nameof(AccessStringVariable))]
        public static void AccessStringVariable(ushort variableIndex, [C99Type("char*")] IntPtr firstCharacterAddress, [C99Type("__crt_bool*")] IntPtr writeValue) { }

        [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) }, EntryPoint = nameof(AccessSystemVariable))]
        public static void AccessSystemVariable(ushort variableIndex, [C99Type("float*")] IntPtr value, [C99Type("__crt_bool*")] IntPtr writeValue) { }

        [UnmanagedCallersOnly(CallConvs = new[] { typeof(CallConvCdecl) }, EntryPoint = nameof(AccessTrigger))]
        public static void AccessTrigger(ushort variableIndex, [C99Type("__crt_bool*")] IntPtr triggerScript) { }
    }
}
