/* Chapter 2 — Cross-Platform Development: Build Once, Deploy Anywhere */
defChapter(2, {
  tag: 'Cross-Platform',
  title: 'Cross-Platform Development — Build Once, Deploy Anywhere',
  sub: 'One codebase, five platforms: the abstraction layer, the lifecycle, and the per-platform realities of desktop, mobile, and web.',
  color: '#34d399',
  topics: ['Demo app architecture & multi-target builds', 'Platform abstraction layers', 'Application lifecycle, logging, shutdown',
    'Graphics: delta time, display size, framerate', 'Audio: SFX vs streaming music', 'Input: keyboard, touch, gamepad, sensors',
    'Files: internal vs external storage', 'Network: HTTP, WebSockets, URIs', 'Entry points & hot reloading']
});

SEC(2);

S(2, 'What “Build Once” Actually Means', `
${lead(`Cross-platform does <b>not</b> mean the platform disappears. It means differences are <b>quarantined
behind one seam</b> — a platform layer — while 95% of your code never learns what OS it runs on.`)}
${diag(
`        ┌──────────────────────────────────────┐
        │   Game code (platform-agnostic)      │  ~95%
        │   gameplay · UI · fx · audio logic   │
        ├──────────────────────────────────────┤
        │   Platform Layer (this chapter)      │  the seam
        │   app.h  — lifecycle, paths, input,  │
        │             display, threads, net    │
        ├──────────┬──────────┬────────┬───────┤
        │ desktop  │ android  │  web   │  ...  │  ~5%
        │ rglfw    │ NDK/GLES │ wasm/  │       │
        │ OpenGL   │ + touch  │ Emscr. │       │
        └──────────┴──────────┴────────┴───────┘`, 'The portability pyramid — keep the base tiny')}
<h3>Where platforms actually differ</h3>
${tbl(['Concern', 'Desktop', 'Mobile', 'Web'], [
  ['Window/GL', 'GL 3.3/4.3, resizable', 'GLES 3.0, surface pause/resume', 'WebGL2, canvas size = browser'],
  ['Input', 'Keyboard + mouse + pads', 'Touch + accelerometer', 'Mouse emulates touch; gamepads OK'],
  ['Files', 'Real FS, anywhere', 'Internal (read) vs external (write) dirs', 'Virtual FS in memory — no sync FS!'],
  ['Lifecycle', 'Process owns itself', 'OS kills/pauses you at will', 'Tab hidden = loop throttled'],
  ['Audio', 'Play on start', 'Focus-dependent', '<b>Must unlock on first gesture</b>']
])}
${bp(`Decide platform differences as <b>data and small functions</b>, never as <code class="inl">#ifdef</code>s
scattered through gameplay code. The pyramid must stay layered — gameplay reaching around the seam is
technical debt with interest.`)}
`);

S(2, 'Demo Application Architecture', `
${lead(`We build a small <b>multi-target demo</b> — the embryo of Canyon Hopper — that boots, logs platform
info, draws, plays sound, saves a file, and fetches nothing yet. Its project layout is the template for
every chapter that follows.`)}
${diag(
` canyon-hopper/
 ├── src/                    # ALL game code (platform-agnostic)
 │   main.c                  # entry: calls AppRun()
 │   app.c / app.h           # App lifecycle owner
 │   platform/               # the seam (this chapter)
 │   │   platform.h          #   interface (types + decls)
 │   │   platform_desktop.c  #   Windows/macOS/Linux impl
 │   │   platform_web.c      #   wasm specifics
 │   │   └── platform_android.c
 │   └── core/ world/ ui/ fx/  # grows each chapter
 ├── assets/                 # packed game data (Ch 4)
 ├── third_party/            # raylib, cjson, physac (pinned)
 ├── tools/                  # asset pipeline scripts
 └── platforms/
     ├── web/shell.html      # emscripten shell
     └── android/            # gradle project wrapper`, 'One tree, many targets')}
<h3>The golden rule of the layout</h3>
<p><code class="inl">src/</code> contains <b>zero</b> platform headers — it includes only
<code class="inl">platform.h</code>. Each platform backend compiles alongside the same
<code class="inl">src/</code> files; only the build target changes.</p>
${note(`This mirrors how libGDX-style projects work (core + per-platform launchers) — proven at studio
scale — but expressed in plain C with raylib.`)}
`);

S(2, 'Designing the Platform Abstraction Layer', `
${lead(`The seam is one header: a handful of types and ~a dozen functions that answer every question
game code might ask about <i>where</i> it runs.`)}
${c`
// src/platform/platform.h  — the ONLY platform-aware header game code sees
#pragma once
#include "raylib.h"

typedef enum {
    PLATFORM_DESKTOP_WINDOWS,
    PLATFORM_DESKTOP_MACOS,
    PLATFORM_DESKTOP_LINUX,
    PLATFORM_ANDROID,
    PLATFORM_WEB
} PlatformType;

typedef struct PlatformInfo {
    PlatformType type;
    int apiLevel;            // OS version hint (e.g. Android API 34)
    bool hasTouch;           // touch input available?
    bool hasAccelerometer;
    bool hasGamepad;
    bool canWriteAnywhere;   // desktop true; mobile/web sandboxed
} PlatformInfo;

typedef struct SavePath { char dir[512]; bool external; } SavePath;

PlatformInfo PlatformQuery(void);
SavePath     PlatformSavePath(const char *gameName); // writable dir
double       PlatformClock(void);                    // monotonic seconds
const char  *PlatformName(void);                     // "web", "windows"...
void         PlatformLog(const char *tag, const char *msg);
bool         PlatformOpenURL(const char *url);       // shop page, help…
// implemented once per backend: platform_desktop.c / platform_web.c / …`}
${tbl(['Game code may ask…', 'Never asks…'], [
  ['&ldquo;Is touch the primary input?&rdquo;', '&ldquo;Am I on Windows?&rdquo; — in gameplay logic'],
  ['&ldquo;Where do I write saves?&rdquo;', '&ldquo;What is the GL version?&rdquo; — renderer handles that'],
  ['&ldquo;Can I spawn threads?&rdquo;', '&ldquo;What is the screen DPI constant?&rdquo;']
])}
${bp(`Keep the interface <b>small and answerable</b>. Every new platform function must be needed by at
least two platforms — otherwise it belongs to a backend, not the seam.`)}
`);

S(2, 'The Application Module: Lifecycle', `
${lead(`Every platform runs your game through the same five phases. Encoding them in one
<code class="inl">App</code> module makes lifecycle bugs impossible to write by accident.`)}
${diag(
`  ┌────────┐  ┌─────────┐  ┌──────────────────────────┐  ┌──────────┐
  │ CREATE │─▶│ RESUME  │─▶│ RUN: input→update→draw   │─▶│ PAUSE    │
  │ alloc, │  │ audio   │  │  (60x per second)        │  │ mute,    │
  │ load   │  │ focus   │  │                          │  │ flush    │
  └────────┘  └─────────┘  └──────────────────────────┘  └──────────┘
       ▲                                                    │
       └──────────────── QUIT: unload, free, save ◀─────────┘
       (mobile: PAUSE can become QUIT at any moment — OS decides)`, 'The five-phase lifecycle')}
${c`
// src/app.c — owns the lifecycle; main.c only calls this
#include "app.h"

int AppRun(void) {
    App app = {0};                       // zero-init: every pointer NULL

    AppInit(&app);                       // CREATE: window, audio, assets
    while (!WindowShouldClose() && !app.quit) {
        if (IsWindowMinimized()) { WaitTime(0.1); continue; }  // be nice

        if (IsFileDropped()) { /* dev: quick asset drop (Ch 4) */ }

        AppUpdate(&app, GetFrameTime()); // logic
        AppDraw(&app);                   // render
    }
    AppShutdown(&app);                   // QUIT: reverse-order unload
    return 0;
}`}
${pit(`On Android, <b>the OS owns you</b>: a phone call = pause; low memory = your process dies between
frames. Save progress on every meaningful event (Ch 7 persistence), not &ldquo;on quit&rdquo; — on mobile there
often is no quit moment.`)}
`);

S(2, 'Lifecycle in Code: Init / Update / Draw / Dispose', `
${lead(`Here is the demo's App module in full — note the strict ordering rules; they generalize to every
subsystem you will build.`)}
${c`
// src/app.c (continued)
typedef struct App {
    bool   quit, paused;
    Texture2D logo;
    Sound   blip;
    Music   theme;
    int     ticks;                 // frame counter for debug
    PlatformInfo plat;
} App;

static void AppInit(App *a) {
    SetTraceLogLevel(LOG_INFO);
    InitWindow(1280, 720, "Canyon Hopper — cross-platform demo");
    InitAudioDevice();                    // audio AFTER window
    a->plat = PlatformQuery();
    TraceLog(LOG_INFO, "PLATFORM: %s (touch=%d, api=%d)",
             PlatformName(), a->plat.hasTouch, a->plat.apiLevel);

    a->logo = LoadTexture("assets/logo.png");
    a->blip = LoadSound("assets/blip.wav");
    a->theme = LoadMusicStream("assets/theme.ogg");
    PlayMusicStream(a->theme);
    SetTargetFPS(60);
}

static void AppUpdate(App *a, float dt) {
    UpdateMusicStream(a->theme);          // feed the stream (Ch 10)
    if (IsKeyPressed(KEY_ESCAPE)) a->quit = true;
    if (IsKeyPressed(KEY_SPACE))  PlaySound(a->blip);
    a->ticks++;
}

static void AppDraw(App *a) {
    BeginDrawing();
      ClearBackground(BLACK);
      DrawTexture(a->logo, 40, 40, WHITE);
      DrawText(TextFormat("ticks %d  dt %.4f", a->ticks, GetFrameTime()),
               40, 640, 24, LIME);
    EndDrawing();
}

static void AppShutdown(App *a) {         // REVERSE of Init, always
    UnloadMusicStream(a->theme);
    UnloadSound(a->blip);
    UnloadTexture(a->logo);
    CloseAudioDevice();                   // audio BEFORE window
    CloseWindow();
}`}
${bp(`Teardown is <b>mirror order</b>: last acquired, first released. And <i>every</i> Load gets an
Unload — write both lines together, always. Leak discipline in C is a habit, not a tool (though ASan
helps — Ch 1).`)}
`);

S(2, 'Logging: TraceLog & Custom Callbacks', `
${lead(`Logging is your telemetry on five platforms where you often cannot attach a debugger (iOS review
builds, web users' machines). raylib's <code class="inl">TraceLog</code> + a custom callback = a portable log bus.`)}
${c`
// Route raylib's internal logs AND ours through one sink
static void LogSink(int logLevel, const char *text, va_list args) {
    char buf[1024];
    vsnprintf(buf, sizeof buf, text, args);
    double t = GetTime();
    // Desktop: stderr. Web: console via EM_JS. Mobile: logcat...
    fprintf(stderr, "[%8.3f][L%d] %s\n", t, logLevel, buf);
}

// at startup:
SetTraceLogCallback(LogSink);
SetTraceLogLevel(LOG_WARNING);      // silence chatter, keep warnings
TraceLog(LOG_INFO,    "boot complete");   // filtered OUT (info < warn)
TraceLog(LOG_WARNING, "save file missing: defaults used");`}
${tbl(['Level', 'Meaning', 'Keep enabled in…'], [
  ['<code class="inl">LOG_ALL / TRACE / DEBUG</code>', 'Firehose', 'Dev builds only'],
  ['<code class="inl">LOG_INFO</code>', 'Normal events (level loaded)', 'Dev + QA'],
  ['<code class="inl">LOG_WARNING</code>', 'Recovered problems', 'Always'],
  ['<code class="inl">LOG_ERROR / FATAL</code>', 'Broken assumptions', 'Always — plus a user-facing message']
])}
${bp(`Prefix every subsystem: <code class="inl">[ASSET]</code>, <code class="inl">[WORLD]</code>,
<code class="inl">[NET]</code>. Later, filtering a crashing session's log by prefix turns 4,000 lines into 40
relevant ones.`)}
${pit(`<code class="inl">TraceLog</code> is <b>not free</b> — it formats strings. Never leave per-entity,
per-frame logs in release; a log line inside a 500-entity update loop costs real frames.`)}
`);

S(2, 'Graceful Shutdown & Persisting Data', `
${lead(`&ldquo;It segfaults on exit&rdquo; is not a joke on mobile — a crash at shutdown can still corrupt your
save file. Persist early, teardown in order, and know each platform's writable paths.`)}
${c`
// Where CAN we write? Ask the seam.
SavePath sp = PlatformSavePath("CanyonHopper");
//  Windows: %USERPROFILE%\\Documents\\CanyonHopper\\   (external=true)
//  Linux:   ~/.local/share/CanyonHopper/
//  macOS:   ~/Library/Application Support/CanyonHopper/
//  Android: internal files dir (app-private) or public external
//  Web:     virtual FS — survives reload only if you sync (IDBFS)

char path[600];
snprintf(path, sizeof path, "%s/settings.bin", sp.dir);

// Atomic-ish save: write temp, then rename — never corrupt the only copy
SaveFileData("tmp_save", data, size);
// (rename omitted for brevity; see ch07 for full settings serialization)`}
${tbl(['Platform', 'Read-only assets', 'Writable saves'], [
  ['Desktop', 'next to binary', 'Documents / AppData / ~/.local'],
  ['Android', 'APK <code class="inl">assets/</code> (internal)', 'Internal dir (private) or external (user-visible)'],
  ['Web', 'packed into .wasm/.data', 'in-memory; persist via IndexedDB sync before unload']
])}
${bp(`Save <b>on meaningful events</b> (level complete, setting changed) and at <code class="inl">PAUSE</code>
— not only at exit. Then even a hard crash loses seconds, not hours of progress.`)}
${pit(`Web builds have <b>no synchronous filesystem</b>. <code class="inl">SaveFileData</code> works only if
your shell mounts and flushes an IDBFS volume on <code class="inl">beforeunload</code> — Chapter 2's web
backend shows the mount; ignoring this &ldquo;works&rdquo; until the first refresh wipes everything.`)}
`);

S(2, 'Platform Types, API Levels & Capability Detection', `
${lead(`Feature-detect at boot, then cache the answer. Runtime branching per frame (or worse, per draw)
is both slower and untestable.`)}
${c`
// platform_desktop.c
PlatformInfo PlatformQuery(void) {
    PlatformInfo p = {0};
    p.type = PLATFORM_DESKTOP_LINUX;         // set by build flag
    p.hasTouch   = false;
    p.hasGamepad = IsGamepadAvailable(0);
    p.canWriteAnywhere = true;
    return p;   // queried ONCE at AppInit, stored in App.plat
}

// Game code branches on CAPABILITIES, not names:
if (app.plat.hasTouch)   ui.ShowVirtualPad();   // Ch 11 builds it
if (!app.plat.hasGamepad) menu.HidePadHints();`}
${tbl(['Check', 'Why at runtime'], [
  ['<code class="inl">IsGamepadAvailable</code>', 'Pads hot-plug — re-check on focus events'],
  ['Max texture size (<code class="inl">rlGetGlParams</code>)', 'Old mobile GPUs: 2048; desktop: 8192+'],
  ['Android API level', 'Scoped storage rules differ by version'],
  ['<code class="inl">IsWindowFullscreen</code>', 'Web canvas vs desktop fullscreen differ']
])}
${note(`<b>API levels</b> (Android) decide which OS features you may call — e.g. API 29+ scoped storage
changes external path rules. Our seam surfaces it as data; the Android backend (slide 21) reads it from
the JNI bridge.`)}
`);

S(2, 'Multithreading: What Runs Where', `
${lead(`The iron rule: <b>the GL context lives on the main thread</b>. Everything expensive that is not a
GPU call — decoding images, parsing JSON, decompressing — can and should move to workers.`)}
${diag(
`  MAIN THREAD                    WORKER THREAD (1..N)
  ───────────────                ─────────────────────
  input poll                     LoadImage("big.png")   ← CPU pixels OK
  game update                    DecompressZIP(...)
  Draw* / rlgl flush             ParseJSON(level.txt)
  LoadTextureFromImage  ◀──────  hand off finished Image
        ▲                        (mutex/queue boundary)
        └── ONLY main thread may create/destroy GPU objects`, 'Thread rules of a raylib game')}
${c`
// Producer-consumer asset load (Ch 4 turns this into AssetManager)
typedef struct LoadJob { const char *path; Image result; bool done; } LoadJob;

static void AssetWorker(void *arg) {           // raylib thread API
    LoadJob *job = (LoadJob *)arg;
    job->result = LoadImage(job->path);        // CPU work: safe off-thread
    job->done = true;                          // simple flag; use atomics
}                                             // for real queues
Thread t = LoadThread(AssetWorker, &job);

// main thread, later:
while (!job.done) WaitTime(0.005);
Texture2D tex = LoadTextureFromImage(job.result);  // GPU: main only
UnloadImage(job.result);`}
${pit(`Never touch <code class="inl">Draw*</code>, <code class="inl">LoadTexture</code>, font loading, or
audio-device calls from workers. The GL context is thread-bound; violating it = driver-dependent crashes
that reproduce &ldquo;randomly&rdquo; — the worst kind.`)}
`);

S(2, 'Graphics Module: Delta Time & Display Size', `
${lead(`Two numbers drive every visual decision: <b>delta time</b> (how long the last frame took) and the
<b>drawable size</b> (which changes at runtime on every platform).`)}
${c`
// Delta time: the great equalizer
float dt = GetFrameTime();             // e.g. 0.0166 @60Hz, 0.032 @30Hz
pos.x += SPEED * dt;                   // SAME world speed everywhere
anim.t += dt;                          // animations clock in seconds

// NEVER:  pos.x += 2;   // 2 pixels/frame => 120px/s @60, 240 @120Hz

// Display size: query, don't assume — resize & rotate happen
int w = GetScreenWidth(), h = GetScreenHeight();
if (IsWindowResized()) RecomputeLayout(w, h);    // Ch 5 HUD scaling`}
${tbl(['Quantity', 'Getter', 'Gotcha'], [
  ['Frame delta', '<code class="inl">GetFrameTime()</code>', 'First frames can spike — clamp: <code class="inl">dt = fminf(dt, 0.05f)</code>'],
  ['Total time', '<code class="inl">GetTime()</code>', 'Monotonic double — use for shaders/easing'],
  ['Window size', '<code class="inl">GetScreenWidth/Height</code>', '≠ physical pixels on HiDPI; web canvas resizes with page'],
  ['Monitor refresh', '<code class="inl">GetMonitorRefreshRate</code>', 'Vsync + SetTargetFPS interact (next slide)']
])}
${bp(`Clamp your delta (e.g. max 50&nbsp;ms). A debugger breakpoint or OS hiccup otherwise teleports
physics through walls on resume — the &ldquo;tunneling&rdquo; bug you will meet again in Chapters 6, 11, 14.`)}
`);

S(2, 'Framerate Management: Target FPS & Vsync', `
${lead(`You control frame pacing with two tools that must cooperate, not fight: a <b>target FPS</b>
(software cap) and <b>vsync</b> (hardware cap to the monitor).`)}
${c`
// Strategy A — classic 60 cap, vsync off (deterministic feel):
SetTargetFPS(60);          // loop busy-waits to hit 16.6ms

// Strategy B — uncapped render, vsync on (min latency):
SetConfigFlags(FLAG_VSYNC_HINT);   // BEFORE InitWindow
SetTargetFPS(0);                   // 0 = no software cap

// Strategy C — battery-friendly mobile:
SetTargetFPS(30);                  // phones: 30 saves ~40% battery

// Measure, don't guess:
DrawText(TextFormat("%d FPS | %.2fms", GetFPS(),
         GetFrameTime()*1000.0f), 10, 10, 20, LIME);`}
${tbl(['Setup', 'Behavior', 'Use when'], [
  ['Target 60, no vsync', 'Tears if over budget, exact pacing', 'Competitive 2D, deterministic sims'],
  ['Vsync + Target 0', 'No tears, pacing owned by monitor', 'Most desktop games'],
  ['Target = refresh/2 (30)', 'Stable halves on weak GPUs', 'Mobile, handhelds'],
  ['Target 0, no vsync', 'Runs hot; 1000+ FPS menus', 'Never (except benchmarks)']
])}
${pit(`Vsync + <code class="inl">SetTargetFPS(60)</code> on a 60&nbsp;Hz panel = periodic stutter: the two
clocks beat against each other. Pick one pacing authority per platform and expose it as a setting
(Ch 7).`)}
`);

S(2, 'Audio Module: SFX vs Streaming — The Split', `
${lead(`The single most important audio decision happens before any code: which sounds are
<b>Sound</b> (fully decoded in RAM, instant) and which are <b>Music</b> (streamed in small chunks)?`)}
${cols(`
<h3>Sound — fire and forget</h3>
${c`
Sound coin = LoadSound("assets/coin.wav");
// whole file decoded into RAM at load:
//   1s 44.1kHz stereo 16-bit ≈ 176 KB
PlaySound(coin);                 // instant start
SetSoundVolume(coin, 0.8f);
SetSoundPitch(coin, 1.2f);       // variety!
SetSoundPan(coin, -0.5f);        // left bias`}
<p>Use for: jumps, pickups, UI clicks — anything under ~3&nbsp;s, played often.</p>
`, `
<h3>Music — stream in chunks</h3>
${c`
Music theme = LoadMusicStream("assets/theme.ogg");
PlayMusicStream(theme);
// EVERY frame, feed the decoder:
UpdateMusicStream(theme);
// ~a few 100 KB RAM regardless of song length`}
<p>Use for: background tracks, ambience — minutes of audio at tiny memory cost.</p>
`)}
${diag(
`  Sound path:   file ─▶ DECODE ALL ─▶ RAM ─▶ ─ ─ ─ mix ─▶ out
                              (load cost ↑, play cost ~0)
  Music path:   file ─▶ DECODE CHUNK ─▶ ring buffer ─▶ mix ─▶ out
                            (load ~0, play cost = UpdateMusicStream/frame)`, 'Memory vs CPU — pick your poison')}
${pit(`A 3-minute OGG as <code class="inl">LoadSound</code> ≈ <b>30&nbsp;MB of RAM</b> and a loading hitch.
Chapter 10 builds the full manager; the split decision you just learned is 80% of audio architecture.`)}
`);

S(2, 'Input Module: The Unified Poll', `
${lead(`raylib unifies five input families behind one polled API. The cross-platform skill is building a
<b>mapping layer</b> so gameplay asks for &ldquo;Jump&rdquo;, never &ldquo;SPACE&rdquo;.`)}
${c`
// The two temporalities — know them cold:
if (IsKeyPressed(KEY_SPACE))  { /* EDGE: once per press   */ }
if (IsKeyDown(KEY_LEFT))      { /* LEVEL: true while held */ }

// Mouse / touch unify naturally:
Vector2 p = GetTouchPosition(0);             // mouse = touch 0 on desktop
if (IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) /* edge click */;

// Gamepads (hot-pluggable):
if (IsGamepadAvailable(0)) {
    float lx = GetGamepadAxisMovement(0, GAMEPAD_AXIS_LEFT_X);
    if (fabsf(lx) > 0.15f) player.x += lx * SPEED * dt;  // deadzone!
    if (IsGamepadButtonPressed(0, GAMEPAD_BUTTON_RIGHT_FACE_DOWN))
        Jump(&player);
}`}
${tbl(['Family', 'Desktop', 'Mobile', 'Web'], [
  ['Keyboard', 'Full', 'Bluetooth only', 'Full (after focus)'],
  ['Mouse', 'Full', 'n/a', 'Full'],
  ['Touch', '—', 'Primary', 'Mouse emulates touch 0'],
  ['Gamepad', 'Full', 'BT pads', 'Gamepad API, modern browsers'],
  ['Accelerometer', '—', 'Native', 'Some browsers (permission-gated)']
])}
${bp(`Deadzone analog sticks (~0.15) — drifting controllers are ubiquitous. And read gestures through
raylib's gesture system (Ch 11) rather than raw touch deltas when a swipe is what you mean.`)}
`);

S(2, 'Input Abstraction: Virtual Buttons', `
${lead(`Here is the seam for input: gameplay registers <b>actions</b>; the platform layer maps devices onto
them. Adding a new device later touches exactly one table.`)}
${c`
// src/core/input.h — device-agnostic actions
typedef enum {
    ACT_JUMP, ACT_LEFT, ACT_RIGHT, ACT_PAUSE, ACT_DEBUG,
    ACT_COUNT
} GameAction;

typedef struct InputMap {
    int  key[ACT_COUNT];        // KeyboardKey
    int  padButton[ACT_COUNT];  // GamepadButton
    bool touchZone[ACT_COUNT];  // UI rectangles, Ch 11
} InputMap;

static InputMap g_defaultMap = {
    .key       = { KEY_SPACE, KEY_A, KEY_D, KEY_ESCAPE, KEY_F1 },
    .padButton = { GAMEPAD_BUTTON_RIGHT_FACE_DOWN, GAMEPAD_BUTTON_LEFT_FACE_1,
                   GAMEPAD_BUTTON_LEFT_FACE_2, GAMEPAD_BUTTON_MIDDLE,
                   GAMEPAD_BUTTON_RIGHT_TRIGGER_1 },
};

bool ActionPressed(GameAction a) {   // edge, any device
    return IsKeyPressed(g_defaultMap.key[a]) ||
           (IsGamepadAvailable(0) &&
            IsGamepadButtonPressed(0, g_defaultMap.padButton[a])) ||
           (g_defaultMap.touchZone[a] && TouchZoneHit(a));
}
bool ActionDown(GameAction a) { /* same, IsKeyDown … */ }`}
${bp(`This indirection also unlocks <b>rebindable keys</b> (Ch 7 settings screen) and local co-op: two
players are two InputMaps. Gameplay code never changes.`)}
${note(`Touch zones only exist on touch platforms — the <code class="inl">PlatformInfo.hasTouch</code> flag
decides whether the HUD shows a virtual pad (Ch 11 builds a real one with a thumbstick + buttons).`)}
`);

S(2, 'Files Module: Internal vs External Storage', `
${lead(`Two namespaces, one mental model: <b>internal</b> (read-only, shipped with the game) and
<b>external</b> (writable, user data). Confusing them is the #1 first-week mobile bug.`)}
${c`
// Internal: assets compiled/shipped with the build — never write here
Texture2D t   = LoadTexture("assets/hero.png");   // resolved internally
char *jsonTxt = LoadFileText("assets/levels/1.json");

// External: the PlatformSavePath() dir from earlier
SavePath sp = PlatformSavePath("CanyonHopper");
char path[600];
snprintf(path, sizeof path, "%s/progress.bin", sp.dir);
SaveFileData(path, &progress, sizeof progress);

// Directory scan works on both (5.5: GetDirectoryFiles)
FilePathList lvl = GetDirectoryFiles("assets/levels");
for (unsigned i = 0; i < lvl.count; i++)
    TraceLog(LOG_INFO, "[LEVEL] %s", lvl.paths[i]);
UnloadDirectoryFiles(lvl.count ? &lvl : NULL);   // free the list (see note)`}
${tbl(['Platform', '&ldquo;Internal&rdquo; really is', '&ldquo;External&rdquo; really is'], [
  ['Desktop', 'folder next to the binary', 'same folder — but use Documents/AppData for politeness'],
  ['Android', 'APK <code class="inl">assets/</code> (read via AAssetManager)', '<code class="inl">getFilesDir()</code> (private) / public storage'],
  ['Web', 'files packed into the .data bundle (virtual FS)', 'in-memory FS; sync to IndexedDB to survive reloads']
])}
${pit(`<code class="inl">GetDirectoryFiles</code> allocates the list — always free it. Also note pre-5.5
code calls it <code class="inl">LoadDirectoryFiles</code>; the rename trips every migration (Ch 1's cheatsheet rule).`)}
`);

S(2, 'Network Module: HTTP, WebSockets & URIs', `
${lead(`raylib deliberately ships no networking. Real games need three things — HTTP calls, persistent
sockets, URL handling — and each platform answers differently, so the seam earns its keep again.`)}
${diag(
`  Game
   │  NetGet("https://api.game.com/v1/hi")
   ▼
  platform.h/net.h  ──┬─▶ DESKTOP: libcurl (easy API)
                      ├─▶ WEB:     fetch() via EM_ASM — async!
                      └─▶ MOBILE:  platform HTTP client behind the seam
  Same signature, different transport. URI parse: shared C code.`, 'Networking behind one interface')}
${c`
// Minimal desktop HTTP GET with libcurl (vendored, CMake find_package)
#include <curl/curl.h>
static size_t WriteCB(void *data, size_t sz, size_t n, void *out) {
    strcat((char *)out, (char *)data);   // demo only — bounded in real code
    return sz * n;
}
bool NetGet(const char *url, char *body, int bodyMax) {
    CURL *c = curl_easy_init();
    curl_easy_setopt(c, CURLOPT_URL, url);
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, WriteCB);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, body);
    bool ok = (curl_easy_perform(c) == CURLE_OK);
    curl_easy_cleanup(c);
    return ok;
}
// Web backend instead uses: EM_ASM({ return fetch($0)... }) + callbacks`}
${tbl(['Need', 'Desktop', 'Web'], [
  ['HTTP', 'libcurl (sync OK off main thread)', '<code class="inl">fetch</code> — async only; callback into game'],
  ['WebSockets', 'libwebsockets / uWebSockets', 'Native <code class="inl">WebSocket</code> via EM_ASM bridge'],
  ['URI parse/encode', 'shared pure-C helper (write once)', 'same code — it is platform-free']
])}
${bp(`Design all net APIs <b>async-first</b> (request + callback), even where curl is synchronous: the web
cannot offer sync, and mobile networks are slow anyway. Chapter 14's leaderboards sketch uses this.`)}
`);

S(2, 'Entry Points: main Is Not Always main', `
${lead(`Who calls <code class="inl">AppRun</code>? Each platform has its own bootstrap ritual — and on the
web, the &ldquo;main loop&rdquo; is borrowed, not owned.`)}
${cols(`
<h3>Desktop — trivial</h3>
${c`
// src/main.c — the only main() in the project
#include "app.h"
int main(void) { return AppRun(); }`}
`, `
<h3>Web — Emscripten owns the loop</h3>
${c`
// platforms/web/main_web.c
#include <emscripten/emscripten.h>
#include "app.h"
static App g_app;

static void FrameCallback(void) {        // called by browser
    AppUpdate(&g_app, GetFrameTime());
    AppDraw(&g_app);
}
int main(void) {
    AppInit(&g_app);      // no while-loop!
    emscripten_set_main_loop(FrameCallback,
                             0 /*fps: vsync*/, 1 /*simulate loop*/);
    return 0;             // unreachable
}`}
`)}
${c`
// Android (summary): raylib's native-activity backend owns ANativeActivity_onCreate.
// Your Makefile targets it directly:
//   make PLATFORM=PLATFORM_ANDROID ANDROID_NDK="path" \
//        ANDROID_ARCH=ARM64 APP_PLATFORM_NAME=android-34
// The gradle wrapper (platforms/android) packages APK + assets + icons (Ch 4).`}
${pit(`Web builds must <b>return from every callback</b>; a blocking <code class="inl">while</code> freezes the
tab. That also bans synchronous &ldquo;loading…&rdquo; loops — use the async AssetManager pattern from Chapter 4.`)}
`);

S(2, 'Running the Demo: Desktop, Android, Web', `
${lead(`Time to watch one codebase boot three ways. These are the exact commands; each produces a
runnable artifact from the same <code class="inl">src/</code>.`)}
${c`
# ---- Desktop (from repo root) ----
cmake -B build-desktop && cmake --build build-desktop -j
./build-desktop/game                      # or game.exe / game.app

# ---- Web (emscripten SDK active) ----
mkdir build-web && cd build-web
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release
emmake make -j
# produces game.html + game.wasm + game.data (assets)
python -m http.server 8000                # SERVE it — file:// blocks wasm

# ---- Android (NDK + SDK installed) ----
cd platforms/android
./gradlew assembleDebug                   # builds native via CMake+NDK
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb logcat -s raylib                      # see TraceLog on device`}
${tbl(['Platform', 'Iteration loop', 'Watch out for'], [
  ['Desktop', 'seconds (F5 your run task)', 'Test ALL THREE desktops if you ship them'],
  ['Web', 'seconds with <code class="inl">emrun</code> or a local server', 'Asset path case-sensitivity — Windows forgives, web does not'],
  ['Android', 'minutes (gradle + install)', '<code class="inl">logcat</code> is your console; keep a device or emulator always on']
])}
${bp(`Make the web build part of daily development, not a port-week event: it catches path bugs, case
bugs, and blocking-code bugs while they are one line old. <code class="inl">emrun --no_browser game.html</code>
even auto-reloads on rebuild.`)}
`);

S(2, 'Debugging Cross-Platform & Hot Reloading', `
${lead(`Debugging is per-platform; <b>hot reloading</b> is the cross-platform superpower: keep editing
game logic while the game runs.`)}
${tbl(['Platform', 'Debugger', 'Pro move'], [
  ['Desktop (MSVC)', 'Visual Studio — data breakpoints', 'Break on <code class="inl">player.hp</code> <i>write</i>, not on code'],
  ['Desktop (gdb/lldb)', 'VS Code debug UI', 'Watch the App struct, conditional breakpoints on entity id'],
  ['Android', 'lldb via Android Studio, or logcat', '<code class="inl">adb logcat -s raylib</code> streams your TraceLog sink'],
  ['Web', 'Browser devtools (source maps!)', 'Build with <code class="inl">-gsource-map</code>; breakpoint C in Chrome']
])}
<h3>Hot reload: game code as a plugin</h3>
${c`
// main.c loads game logic as a shared library and hot-swaps it:
typedef struct GameAPI {
    int  (*Init)(void);
    void (*Update)(float dt);
    void (*Draw)(void);
    void (*Reloaded)(void);        // re-grab state after swap
} GameAPI;

static void *lib = NULL;
static GameAPI LoadGame(void) {
    if (lib) UnloadLibrary(lib);          // raylib: UnloadLibrary
    CopyFile("game.dll", "game_tmp.dll", 0);  // Windows file lock!
    lib = LoadLibrary("game_tmp.dll");
    GameAPI api = {0};
    api.Init    = (void *)GetSymbol(lib, "GameInit");
    api.Update  = (void *)GetSymbol(lib, "GameUpdate");
    api.Draw    = (void *)GetSymbol(lib, "GameDraw");
    api.Reloaded = (void *)GetSymbol(lib, "GameReloaded");
    return api;
}
// On F5 key:  api = LoadGame(); api.Reloaded();  — live logic swap`}
${pit(`Hot reload stores <b>all game state outside the DLL</b> (a static <code class="inl">GameState</code> in
main). If state lives inside the swapped module, every reload resets the game — the classic first failure.`)}
${note(`Even without plugin machinery, Chapter 4 adds <b>asset</b> hot reload (textures/levels refresh on
file change), which delivers 80% of the iteration win for 10% of the complexity.`)}
`);

S(2, 'Chapter 2 Summary — Key Takeaways', `
${lead(`Your 20-line loop grew a spine: a platform seam, a lifecycle, and five-platform awareness.`)}
<ul class="check">
  <li>Quarantine differences in a <b>platform layer</b>; gameplay sees capabilities (<code class="inl">hasTouch</code>), not names.</li>
  <li>Life is <b>CREATE → RESUME → RUN → PAUSE → QUIT</b>; mobile may kill you between phases — save on events.</li>
  <li><b>GL on the main thread</b>; workers decode, main uploads.</li>
  <li>Pick <b>one pacing authority</b> (target FPS or vsync); clamp <code class="inl">dt</code>.</li>
  <li>Audio split decided early: <b>Sound</b> for SFX RAM, <b>Music</b> for streams.</li>
  <li>Input is <b>actions, not keys</b> — the InputMap table travels to Ch 7 settings and Ch 11 virtual pads.</li>
  <li>Files: internal read-only vs external writable; web needs IDBFS syncing; network async-first.</li>
  <li>Web &ldquo;main&rdquo; is <code class="inl">emscripten_set_main_loop</code>; hot reload keeps state outside the swapped module.</li>
</ul>
<h3>Carrying forward</h3>
<p>Chapter 3 starts Canyon Hopper proper: project structure, the Core/World/Renderer trio, the real
game loop, and the virtual camera.</p>
${bp(`Checkpoint: the demo boots on desktop <b>and</b> web from one <code class="inl">src/</code>, logs platform
info through one sink, saves a file to the right place per platform, and survives a pause/resume cycle
on mobile without audio glitches.`)}
`);
