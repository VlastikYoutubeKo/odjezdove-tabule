// OMSI 2 Tracker – plugin, který posílá stav vozu (linka, směr, příští
// zastávka, zpoždění, rychlost) na server odjezdových tabulí.
//
// OMSI 2 je 32bitová aplikace → plugin je nutné přeložit jako Win32 DLL.
// Které proměnné OMSI plugin dostává, určuje soubor omsi2tracker.opl
// (pořadí proměnných musí odpovídat výčtům níže).

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winhttp.h>

#include <atomic>
#include <cmath>
#include <cstdio>
#include <mutex>
#include <string>
#include <thread>

// ---- pořadí proměnných v omsi2tracker.opl ----
enum FloatVar   { V_VELOCITY = 0, V_DELAY, V_POS_X, V_POS_Y, FLOAT_VAR_COUNT };
enum StringVar  { S_LINE = 0, S_HEADSIGN, S_NEXT_STOP, STRING_VAR_COUNT };
enum SystemVar  { SYS_TIME = 0, SYS_PAUSE, SYSTEM_VAR_COUNT };

namespace {

struct Config {
    std::wstring host = L"localhost";
    INTERNET_PORT port = 8080;
    bool https = false;
    std::wstring path = L"/api/vehicles";
    std::string token;
    std::string driver;
    std::string vehicle;
    std::string map;
    std::string id;
    int intervalMs = 5000;
    float delayScale = 1.0f; // násobek hodnoty zpoždění → sekundy
};

struct State {
    float floats[FLOAT_VAR_COUNT] = {};
    bool hasFloat[FLOAT_VAR_COUNT] = {};
    std::string strings[STRING_VAR_COUNT];
    float time = -1.0f;
    bool paused = false;
};

Config g_cfg;
State g_state;
std::mutex g_mutex;
std::atomic<bool> g_running{false};
std::thread g_worker;
HMODULE g_module = nullptr;

std::string toUtf8(const wchar_t* w) {
    if (!w || !*w) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    std::string s(n > 0 ? n - 1 : 0, '\0');
    if (n > 1) WideCharToMultiByte(CP_UTF8, 0, w, -1, &s[0], n, nullptr, nullptr);
    return s;
}

std::wstring toWide(const std::string& s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    std::wstring w(n > 0 ? n - 1 : 0, L'\0');
    if (n > 1) MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &w[0], n);
    return w;
}

std::string jsonEscape(const std::string& s) {
    std::string out;
    for (unsigned char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); out += b; }
                else out += static_cast<char>(c);
        }
    }
    return out;
}

std::string trim(const std::string& s) {
    size_t a = s.find_first_not_of(" \t\r\n");
    size_t b = s.find_last_not_of(" \t\r\n");
    return a == std::string::npos ? std::string() : s.substr(a, b - a + 1);
}

std::wstring moduleDir() {
    wchar_t buf[MAX_PATH] = {};
    GetModuleFileNameW(g_module, buf, MAX_PATH);
    std::wstring p(buf);
    size_t slash = p.find_last_of(L"\\/");
    return slash == std::wstring::npos ? L"." : p.substr(0, slash);
}

std::string iniGet(const std::wstring& file, const wchar_t* key, const char* def) {
    wchar_t buf[512] = {};
    GetPrivateProfileStringW(L"tracker", key, toWide(def).c_str(), buf, 512, file.c_str());
    return trim(toUtf8(buf));
}

void loadConfig() {
    std::wstring file = moduleDir() + L"\\omsi2tracker.ini";

    // server=http://example.com:8080/api/vehicles
    std::wstring url = toWide(iniGet(file, L"server", "http://localhost:8080/api/vehicles"));
    URL_COMPONENTS uc = {};
    uc.dwStructSize = sizeof uc;
    wchar_t host[256] = {}, path[1024] = {};
    uc.lpszHostName = host;  uc.dwHostNameLength = 256;
    uc.lpszUrlPath = path;   uc.dwUrlPathLength = 1024;
    if (WinHttpCrackUrl(url.c_str(), 0, 0, &uc)) {
        g_cfg.host = host;
        g_cfg.port = uc.nPort;
        g_cfg.https = uc.nScheme == INTERNET_SCHEME_HTTPS;
        if (path[0]) g_cfg.path = path;
    }

    g_cfg.token = iniGet(file, L"token", "");
    g_cfg.driver = iniGet(file, L"driver", "");
    g_cfg.vehicle = iniGet(file, L"vehicle", "");
    g_cfg.map = iniGet(file, L"map", "");
    g_cfg.id = iniGet(file, L"id", "");
    g_cfg.intervalMs = GetPrivateProfileIntW(L"tracker", L"interval", 5, file.c_str()) * 1000;
    if (g_cfg.intervalMs < 2000) g_cfg.intervalMs = 2000;
    g_cfg.delayScale = static_cast<float>(std::atof(iniGet(file, L"delay_scale", "1").c_str()));

    if (g_cfg.id.empty()) {
        // stabilní ID z názvu počítače, aby se po restartu hry nevytvořil nový vůz
        wchar_t name[MAX_COMPUTERNAME_LENGTH + 1] = {};
        DWORD len = MAX_COMPUTERNAME_LENGTH + 1;
        GetComputerNameW(name, &len);
        g_cfg.id = "omsi-" + toUtf8(name);
    }
}

std::string buildJson() {
    State s;
    {
        std::lock_guard<std::mutex> lock(g_mutex);
        s = g_state;
    }
    std::string j = "{";
    auto addStr = [&](const char* k, const std::string& v) {
        if (v.empty()) return;
        if (j.size() > 1) j += ",";
        j += "\""; j += k; j += "\":\""; j += jsonEscape(v); j += "\"";
    };
    auto addNum = [&](const char* k, double v) {
        if (!std::isfinite(v)) return;
        char b[64];
        std::snprintf(b, sizeof b, "%s\"%s\":%.2f", j.size() > 1 ? "," : "", k, v);
        j += b;
    };
    addStr("id", g_cfg.id);
    addStr("driver", g_cfg.driver);
    addStr("vehicle", g_cfg.vehicle);
    addStr("map", g_cfg.map);
    addStr("route", trim(s.strings[S_LINE]));
    addStr("headsign", trim(s.strings[S_HEADSIGN]));
    addStr("nextStop", trim(s.strings[S_NEXT_STOP]));
    if (s.hasFloat[V_VELOCITY]) addNum("speed", std::fabs(s.floats[V_VELOCITY]));
    if (s.hasFloat[V_DELAY]) addNum("delay", s.floats[V_DELAY] * g_cfg.delayScale);
    if (s.hasFloat[V_POS_X]) addNum("x", s.floats[V_POS_X]);
    if (s.hasFloat[V_POS_Y]) addNum("y", s.floats[V_POS_Y]);
    if (s.time >= 0) {
        // systémová proměnná Time = sekundy od půlnoci herního dne
        int t = static_cast<int>(s.time) % 86400;
        char b[16];
        std::snprintf(b, sizeof b, "%02d:%02d", t / 3600, (t / 60) % 60);
        addStr("gameTime", b);
    }
    j += "}";
    return j;
}

void post(HINTERNET session, const std::string& body) {
    HINTERNET conn = WinHttpConnect(session, g_cfg.host.c_str(), g_cfg.port, 0);
    if (!conn) return;
    HINTERNET req = WinHttpOpenRequest(conn, L"POST", g_cfg.path.c_str(), nullptr, WINHTTP_NO_REFERER,
                                       WINHTTP_DEFAULT_ACCEPT_TYPES, g_cfg.https ? WINHTTP_FLAG_SECURE : 0);
    if (req) {
        std::wstring headers = L"Content-Type: application/json\r\n";
        if (!g_cfg.token.empty()) headers += L"Authorization: Bearer " + toWide(g_cfg.token) + L"\r\n";
        if (WinHttpSendRequest(req, headers.c_str(), static_cast<DWORD>(-1L),
                               const_cast<char*>(body.data()), static_cast<DWORD>(body.size()),
                               static_cast<DWORD>(body.size()), 0)) {
            WinHttpReceiveResponse(req, nullptr);
        }
        WinHttpCloseHandle(req);
    }
    WinHttpCloseHandle(conn);
}

void workerLoop() {
    HINTERNET session = WinHttpOpen(L"OMSI2Tracker/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                    WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) return;
    WinHttpSetTimeouts(session, 3000, 3000, 3000, 3000);
    while (g_running) {
        bool paused;
        {
            std::lock_guard<std::mutex> lock(g_mutex);
            paused = g_state.paused;
        }
        if (!paused) post(session, buildJson());
        for (int waited = 0; g_running && waited < g_cfg.intervalMs; waited += 100) Sleep(100);
    }
    WinHttpCloseHandle(session);
}

} // namespace

// ---- rozhraní pluginu OMSI 2 ----
extern "C" {

__declspec(dllexport) void __stdcall PluginStart(void* /*aOwner*/) {
    loadConfig();
    g_running = true;
    g_worker = std::thread(workerLoop);
}

__declspec(dllexport) void __stdcall PluginFinalize() {
    g_running = false;
    if (g_worker.joinable()) g_worker.join();
}

__declspec(dllexport) void __stdcall AccessVariable(unsigned short index, float* value, bool* write) {
    if (write) *write = false;
    if (!value || index >= FLOAT_VAR_COUNT) return;
    std::lock_guard<std::mutex> lock(g_mutex);
    g_state.floats[index] = *value;
    g_state.hasFloat[index] = true;
}

__declspec(dllexport) void __stdcall AccessStringVariable(unsigned short index, wchar_t* value, bool* write) {
    if (write) *write = false;
    if (!value || index >= STRING_VAR_COUNT) return;
    std::string v = toUtf8(value);
    std::lock_guard<std::mutex> lock(g_mutex);
    g_state.strings[index] = v;
}

__declspec(dllexport) void __stdcall AccessSystemVariable(unsigned short index, float* value, bool* write) {
    if (write) *write = false;
    if (!value) return;
    std::lock_guard<std::mutex> lock(g_mutex);
    if (index == SYS_TIME) g_state.time = *value;
    else if (index == SYS_PAUSE) g_state.paused = *value != 0.0f;
}

__declspec(dllexport) void __stdcall AccessTrigger(unsigned short /*index*/, bool* /*active*/) {}

} // extern "C"

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        g_module = module;
        DisableThreadLibraryCalls(module);
    }
    return TRUE;
}
