/* Chapter 1 — Introduction to Game Engines & Project Setup (incl. Preface) */
defChapter(1, {
  tag: 'Foundations',
  title: 'Introduction to Game Engines & Project Setup',
  sub: 'How real-time games are structured, what raylib gives you, and how to build a professional project from day one.',
  color: '#38bdf8',
  topics: ['Engine architecture & core subsystems', 'The raylib feature set & module map', 'Community, documentation & resources',
    'Dev environment, toolchain & IDE setup', 'SDKs, runtimes & dependency management', 'Build systems & project configuration',
    'Planning our course project: Canyon Hopper']
});

S(1, '', `
From your first window to shipping a physics-driven, cross-platform game — architecture, shaders,
physics, audio, UI and animation, taught entirely in modern C with raylib.
`, { type: 'title' });

S(1, 'How to Use This Course', `
${lead(`This deck is a <b>self-paced masterclass</b>: 330+ slides, 14 chapters, and one game —
<b>Canyon Hopper</b> — that grows with every chapter until it is genuinely shippable.`)}
<h3>Navigating the deck</h3>
<ul>
  <li>Move with ${kbd('→')} ${kbd('←')} ${kbd('Space')} — jump anywhere with ${kbd('Home')}/${kbd('End')}.</li>
  <li>Press ${kbd('S')} for a <b>searchable slide index</b> (searches slide text <i>and</i> code), ${kbd('O')} for a grid overview, ${kbd('F')} for fullscreen.</li>
  <li>Every code block has a <b>Copy</b> button — snippets are drop-in ready for a raylib 5.x project.</li>
  <li>The URL hash deep-links slides (<code class="inl">#123</code>), so you can bookmark and share exact slides.</li>
</ul>
<h3>How each chapter is structured</h3>
<ul class="check">
  <li><b>Concept</b> — the theory and architecture behind the feature.</li>
  <li><b>Implementation</b> — real, commented C code integrated into the course game.</li>
  <li><b>Best Practices &amp; Pitfalls</b> — production experience, not just API tours.</li>
  <li><b>Summary</b> — recap and what carries into the next chapter.</li>
</ul>
${bp(`Read with an editor open. Every snippet compiles against raylib 5.x; copy them, break them, and rebuild them. Passive reading does not build engines.`)}
`);

S(1, 'What Is a Game Engine?', `
${lead(`A game engine is the <b>reusable technology layer</b> between your game-specific code and the
machine: it manages the window, the GPU, the audio device, input, files, and the frame loop — so you
can spend your time on gameplay instead of platform plumbing.`)}
${tbl(['Term', 'What it is', 'Examples'], [
  ['<b>Engine</b>', 'An integrated, opinionated product: editor, asset pipeline, scripting and runtime bundled together', 'Unity, Unreal, Godot'],
  ['<b>Framework</b>', 'A structured library set that calls <i>your</i> code through mandated patterns (you fill in the blanks)', 'libGDX, MonoGame, LÖVE'],
  ['<b>Library</b>', 'A toolbox you call whenever you want; it imposes no architecture of its own', '<b>raylib</b>, SDL, raymath']
])}
${diag(
`  Your Game (gameplay, levels, UI flow, art)
 ─────────────────────────────────────────────
  Architecture you build:  screens · entities · assets   ← Chapters 3–12
 ─────────────────────────────────────────────
  raylib:  core · shapes · textures · text · models · audio
 ─────────────────────────────────────────────
  C runtime library (libc) · OpenGL / OpenGL ES · miniaudio
 ─────────────────────────────────────────────
  OS: Windows · macOS · Linux · Android · Web`, 'The layer cake of a raylib game')}
${note(`raylib is technically a <b>library</b>, but because it ships the full subsystem set of an engine
(window, graphics, audio, input, files, math), we will build a thin <i>engine layer</i> of our own on top of
it — which is exactly what this course teaches.`)}
`);

S(1, 'Why raylib? Philosophy & Design Goals', `
${lead(`raylib was created by Ramon Santamaria (<b>raysan</b>) in 2013 with a radical constraint: teach
graphics programming with <b>zero setup friction</b>. Every design decision follows from education first.`)}
<ul class="check">
  <li><b>Plain C99, no forced paradigm</b> — no classes, no reflection, no ceremony. You see every pointer.</li>
  <li><b>No editor, no project format</b> — your code, your assets, your build system.</li>
  <li><b>Consistent naming</b> — <code class="inl">LoadX / UnloadX</code>, <code class="inl">IsX / GetX / SetX</code>, <code class="inl">DrawX</code>. Guessable APIs.</li>
  <li><b>Batteries included</b> — window, OpenGL abstraction, textures, fonts, models, audio, and math in one binary.</li>
  <li><b>~120 official examples</b> — nearly every function has a runnable demo.</li>
  <li><b>Multi-platform</b> — Windows, macOS, Linux, Android, iOS, Web (WebAssembly), Raspberry Pi, and consoles via partners.</li>
</ul>
<h3>What you give up vs. a full engine</h3>
<ul class="x">
  <li>No visual scene editor (we build level tooling in Ch 4–5 and use external editors).</li>
  <li>No built-in physics (we integrate <b>physac</b> in Ch 11 and hand-roll 3D dynamics in Ch 14).</li>
  <li>No ECS, UI framework, or scripting (we design all of it — that is the point of the course).</li>
</ul>
${pit(`Beginners often try to &ldquo;hide&rdquo; raylib behind giant wrappers on day one. Learn the raw API first
(Chapters 1–2); wrap it only where a real need appears.`)}
`);

S(1, 'raylib at a Glance: Versions & Ecosystem', `
${lead(`raylib evolves in stable, planned releases. Knowing the version landscape keeps your code — and
your tutorials — compatible.`)}
${tbl(['Release', 'Highlights', 'State'], [
  ['<b>4.x (2022)</b>', 'RLGL batch renderer overhaul, <code class="inl">SetSoundPan</code>, glTF animations, QOA audio', 'Legacy but common in tutorials'],
  ['<b>5.0 (Nov 2023)</b>', 'Unicode text shaping, <code class="inl">SetTextureWrap</code> improvements, camera tweaks, OSS vault', 'Widely deployed'],
  ['<b>5.5 (Nov 2024)</b>', '<b>cJSON embedded</b> (JSON loading in core), API renames for clarity, new config/trace log system', '<b>This course targets 5.5</b>']
])}
<h3>The wider family</h3>
<ul>
  <li><b>raygui</b> — immediate-mode GUI widgets for tools and menus (Ch 7).</li>
  <li><b>physac</b> — 2D rigid-body physics, single header (Ch 11).</li>
  <li><b>raymath</b> — vector/matrix math, header-only, no dependencies.</li>
  <li><b>rTexPacker, rGuiLayout, rGuiStyler, rFXGen, rIconForge</b> — the companion tooling ecosystem (Ch 4, 7, 8, 10).</li>
</ul>
${note(`raylib 5.5 renamed several functions for consistency — e.g. <code class="inl">GetGestureDetected()</code> →
<code class="inl">GetGesture()</code> and <code class="inl">LoadDirectoryFiles()</code> → <code class="inl">GetDirectoryFiles()</code>.
When an old tutorial fails to compile, check the official cheatsheet for renames.`)}
`);

S(1, 'Architecture: The raylib Module Map', `
${lead(`raylib is organized as clean, layered modules. Understanding the map tells you exactly which
header owns which responsibility — and where to look when something breaks.`)}
${diag(
`  ┌────────────────────────────────────────────────────────┐
  │  Your game code                                        │
  ├────────────────────────────────────────────────────────┤
  │ rshapes   rtextures   rtext      rmodels     raudio    │  ← drawing & loading APIs
  │ DrawCircle LoadTexture DrawText   LoadModel  PlaySound │
  ├────────────────────────────────────────────────────────┤
  │ rcore: window · input · timing · files · logging · cfg │  ← platform services
  ├────────────────────────────────────────────────────────┤
  │ rlgl   — thin OpenGL abstraction (state, batches, VAOs)│
  │ raymath— Vector2/3/4, Matrix, Quaternion (header-only) │
  ├────────────────────────────────────────────────────────┤
  │ rglfw platform backend · miniaudio · stb_image · ...   │
  └────────────────────────────────────────────────────────┘`, 'raylib module map (dependencies flow downward)')}
${tbl(['Module', 'Responsibility', 'Typical calls'], [
  ['<b>rcore</b>', 'Window, GL context, input events, timing, files, storage, logging', '<code class="inl">InitWindow</code>, <code class="inl">GetFrameTime</code>, <code class="inl">IsKeyDown</code>'],
  ['<b>rshapes</b>', 'Primitives + collision helpers, all batched', '<code class="inl">DrawRectangle</code>, <code class="inl">CheckCollisionRecs</code>'],
  ['<b>rtextures</b>', 'Image CPU manipulation, GPU textures, render targets', '<code class="inl">LoadTexture</code>, <code class="inl">ImageResize</code>'],
  ['<b>rtext</b>', 'Font loading, glyph atlases, text shaping, drawing', '<code class="inl">LoadFontEx</code>, <code class="inl">DrawTextEx</code>'],
  ['<b>rmodels</b>', 'Meshes, materials, models, animation, 3D drawing', '<code class="inl">LoadModel</code>, <code class="inl">DrawModel</code>'],
  ['<b>raudio</b>', 'Audio device, buffered sounds, streamed music', '<code class="inl">PlaySound</code>, <code class="inl">UpdateMusicStream</code>'],
  ['<b>rlgl</b>', 'OpenGL abstraction &amp; the internal batch renderer', '<code class="inl">rlSetBlendMode</code>, custom buffers']
])}
${bp(`Dependencies only point <b>downward</b>. Your game should depend on raylib's public API, and reach
for <code class="inl">rlgl</code>/<code class="inl">raymath</code> only for advanced effects (Ch 9, 11, 13).`)}
`);

S(1, 'Core Subsystems: rcore Deep Dive', `
${lead(`<b>rcore</b> is the heart of raylib: it owns the window, the game loop clock, every input device,
and the file system view. Everything else builds on it.`)}
<h3>What rcore manages</h3>
${cols(`
<ul>
  <li><b>Window &amp; GL context</b> — creation, resizing, fullscreen, vsync, flags via <code class="inl">SetConfigFlags</code>.</li>
  <li><b>Frame timing</b> — <code class="inl">GetFrameTime()</code> (delta), <code class="inl">GetTime()</code> (total), <code class="inl">SetTargetFPS()</code>.</li>
  <li><b>Input polling</b> — keyboard, mouse, gamepad, touch, gestures — <b>refreshed once per frame</b>.</li>
  <li><b>Filesystem</b> — <code class="inl">LoadFileData</code>/<code class="inl">SaveFileData</code>, directory scans, working directory.</li>
  <li><b>Persistent storage</b> — <code class="inl">SaveStorageValue</code>/<code class="inl">LoadStorageValue</code> key-value ints.</li>
  <li><b>Logging</b> — <code class="inl">TraceLog(LOG_*)</code> with filterable levels and a custom callback hook.</li>
</ul>
`, `
${c`
#include "raylib.h"

int main(void) {
    // Window flags must be set BEFORE InitWindow()
    SetConfigFlags(FLAG_WINDOW_RESIZABLE | FLAG_VSYNC_HINT);
    InitWindow(1280, 720, "rcore tour");
    SetTargetFPS(60);                 // desired step; vsync still clamps

    while (!WindowShouldClose()) {    // true when X / ESC pressed
        float dt = GetFrameTime();    // seconds since last frame

        if (IsKeyPressed(KEY_F11)) ToggleFullscreen();

        BeginDrawing();
            ClearBackground(RAYWHITE);
            DrawText(TextFormat("dt = %.4f s (%d FPS)",
                     dt, GetFPS()), 20, 20, 24, DARKGRAY);
        EndDrawing();                 // swaps buffers + polls input
    }
    CloseWindow();                    // destroys context, frees core
    return 0;
}`}
`)}
${pit(`<code class="inl">SetConfigFlags</code> after <code class="inl">InitWindow</code> does nothing —
flags configure window <b>creation</b>. The same applies to <code class="inl">SetTraceLogLevel</code>: set it first
or early logs are already filtered.`)}
`);

S(1, 'The Graphics Subsystem: rlgl & Batching', `
${lead(`Every <code class="inl">Draw*</code> call you make is queued into a <b>vertex batch</b> and flushed as
few GPU draw calls as possible. Knowing the batching rules is the difference between 1200 FPS and 12 FPS in 2D.`)}
<h3>How a frame really works</h3>
${diag(
` BeginDrawing()
   ├─ signals batch reset
   ├─ DrawTexture/Rect/Text... ──▶ append verts to CPU buffers
   │      (state changes force a flush: texture switch, blend, shader)
   └─ EndDrawing()
        ├─ rlglDraw()  — uploads + draws all buffered quads
        ├─ SwapBuffers()
        └─ PollInputEvents()   ← input for the NEXT frame`, 'The hidden life of a frame')}
${tbl(['Batch-friendly', 'Batch-hostile'], [
  ['Draw many sprites from <b>one texture atlas</b>', 'One <code class="inl">LoadTexture</code> per sprite (texture switch each draw)'],
  ['Group draws by blend mode (opaque → alpha → additive)', 'Interleaving blend modes every sprite'],
  ['Same shader for the whole layer', 'Toggling <code class="inl">BeginShaderMode</code> per sprite'],
  ['Static UI drawn last, world first', 'Unsorted z-fighting via painter&rsquo;s order mistakes']
])}
${bp(`Design your art pipeline around <b>one atlas per layer</b> (Ch 4 builds one with rTexPacker). A whole
parallax level can then render in a handful of draw calls.`)}
${note(`<code class="inl">rlgl</code> also powers <code class="inl">LoadRenderTexture</code> (offscreen targets) and raw
buffer control — the foundation for post-processing in Chapter 9 and shadow mapping in Chapter 14.`)}
`);

S(1, 'Subsystems: rtextures, rtext & Fonts', `
${lead(`CPU <code class="inl">Image</code> vs GPU <code class="inl">Texture</code> is the key mental split:
images are editable pixel arrays in RAM; textures are immutable-ish GPU uploads optimized for drawing.`)}
${cols(`
<h3>Image (CPU) pipeline</h3>
${c`
Image img = LoadImage("hero.png");      // RAM copy
ImageResize(&img, 64, 64);              // free transform
ImageCrop(&img, (Rectangle){0,0,32,32});
Color px = GetImageColor(img, 10, 10);  // read pixels
// ...when ready, upload once:
Texture2D tex = LoadTextureFromImage(img);
UnloadImage(img);   // CPU copy no longer needed`}
<ul>
  <li>Use CPU images for: procedural generation, cropping, atlas packing, pixel math.</li>
  <li>Use textures for: anything drawn every frame.</li>
</ul>
`, `
<h3>Text &amp; fonts</h3>
${c`
// Default font is baked in; custom fonts pack glyphs into an atlas
Font pix = LoadFontEx("res/pix.ttf", 32, 0, 250);
GenTextureMipmaps(&pix.texture);            // crisp at any scale
SetTextureFilter(pix.texture, TEXTURE_FILTER_BILINEAR);

DrawTextEx(pix, "SCORE 1200", (Vector2){20,20},
           32.0f, 2.0f, GOLD);              // size, spacing, tint`}
<ul>
  <li><code class="inl">MeasureTextEx</code> before drawing to center/align text.</li>
  <li>Unicode: pass the glyph count + codepoint list (5.x supports shaping).</li>
</ul>
`)}
${pit(`Never call <code class="inl">LoadTexture</code> (or any GPU op) outside the main thread on WebGL;
uploads belong to the main GL thread. Load images on workers, upload on main (Ch 2).`)}
`);

S(1, 'Subsystems: rmodels, raudio & Input', `
${lead(`A quick orientation on the three remaining big modules — each gets a full chapter later; here you
learn their shape and cost model.`)}
${tbl(['Subsystem', 'Mental model', 'Cost model'], [
  ['<b>rmodels</b> (Ch 13)', '<code class="inl">Mesh</code> = raw vertex arrays; <code class="inl">Material</code> = shader + texture maps; <code class="inl">Model</code> = mesh(es) + materials + bones', 'Bind cost per material switch; instance batches to amortize (<code class="inl">DrawMeshInstanced</code>)'],
  ['<b>raudio</b> (Ch 10)', '<code class="inl">Sound</code> = fully decoded in RAM (SFX); <code class="inl">Music</code> = streamed in chunks (BGM)', 'Sounds cost memory; streams cost CPU each frame (<code class="inl">UpdateMusicStream</code>)'],
  ['<b>Input</b> (Ch 2, 11)', 'Polled <b>once per frame</b>: <code class="inl">IsKeyPressed</code> (edge) vs <code class="inl">IsKeyDown</code> (level)', 'Free — but only valid on the main thread']
])}
${c`
// One slide, every subsystem touched
Sound jump  = LoadSound("res/jump.wav");     // raudio: RAM-buffered
Music theme = LoadMusicStream("res/theme.ogg"); // raudio: streamed

Model bot = LoadModel("res/robot.glb");      // rmodels: GPU meshes

if (IsKeyPressed(KEY_SPACE)) PlaySound(jump);// rcore input edge-trigger
if (IsMouseButtonDown(MOUSE_BUTTON_LEFT)) { /* rcore mouse level */ }

UpdateMusicStream(theme);                    // MUST run every frame
`}
${note(`Music streaming decodes a small buffer ahead of playback. Forget <code class="inl">UpdateMusicStream</code>
in your loop and the track stutters then stops — the #1 beginner audio bug, fixed in Chapter 10.`)}
`);

S(1, 'Utilities: raymath, Storage & Config', `
${lead(`The small modules matter daily: math types you will type thousands of times, tiny persistent
storage, and text formatting.`)}
${cols(`
<h3>raymath — header-only math</h3>
${c`
#include "raymath.h"               // works standalone, zero deps

Vector2 a = { 100, 200 };
Vector2 b = { 400, 300 };
Vector2 d = Vector2Subtract(b, a);
float len = Vector2Length(d);
Vector2 dir = Vector2Normalize(d);

// Operator overloads exist in C++ mode; in C use functions:
Vector2 step = Vector2Add(a, Vector2Scale(dir, 120.0f*GetFrameTime()));`}
<p>Vector2/3/4, Matrix, Quaternion — all pass <b>by value</b>. Cheap, cache-friendly, no allocs.</p>
`, `
<h3>Storage &amp; text helpers</h3>
${c`
// Tiny key-value store (ints) — perfect for high scores
SaveStorageValue(0, 12800);
int best = LoadStorageValue(0);

// TextFormat: raylib's printf for UI strings
DrawText(TextFormat("LIVES %d", lives), 10, 40, 24, RED);

// Works with any printf-style building of draw text
const char *msg = TextFormat("%s x%d", "COIN", 3);`}
<p><code class="inl">SaveFileText</code>/<code class="inl">SaveFileData</code> handle arbitrary files when
key-value ints are not enough (Ch 7 settings).</p>
`)}
${bp(`Pick one math convention now and keep it: <b>positions in world units, speeds in units/second,
everything multiplied by <code class="inl">GetFrameTime()</code></b>. Mixing per-frame and per-second speeds is
the classic source of &ldquo;game runs fast on gaming PC, slow on laptop&rdquo; bugs.`)}
`);

S(1, 'The Auxiliary Family: raygui & physac', `
${lead(`Two satellite libraries share raylib's philosophy — single include, no build-system surgery —
and this course leans on both.`)}
${cols(`
<h3>raygui — immediate-mode UI</h3>
${c`
#include "raygui.h"   // after raylib.h

if (GuiButton((Rectangle){ 40, 40, 200, 44 }, "Start Game")) {
    StartGame();       // returns true on click
}
float v = GuiSliderBar((Rectangle){ 40, 100, 200, 20 },
                       "Volume", NULL, musicVol, 0.0f, 1.0f);
bool fs = GuiCheckBox((Rectangle){ 40, 140, 20, 20 },
                      "Fullscreen", fullscreen);`}
<p>No retained widget tree — you <i>call</i> the UI every frame and it just works. Deep dive in Chapter 7.</p>
`, `
<h3>physac — 2D rigid bodies</h3>
${c`
#define PHYSAC_IMPLEMENTATION
#include "physac.h"    // before including in ONE .c file

InitPhysics();
PhysicsBody box = CreatePhysicsBodyRectangle(
    (Vector2){ 400, 100 }, 80, 40, 0.5f /*density*/);
box->enabled = false;      // becomes static (immovable)

// each frame:
UpdatePhysics();           // fixed-step simulation
Vector2 p = box->position; // sync with rendering`}
<p>Collision shapes, restitution, forces — the full 2D story lands in Chapter 11.</p>
`)}
${pit(`<code class="inl">PHYSAC_IMPLEMENTATION</code> (like raygui's <code class="inl">RAYGUI_IMPLEMENTATION</code>)
must appear in <b>exactly one translation unit</b>, or you get duplicate-symbol linker errors. Chapter 2's
&ldquo;single implementation file&rdquo; convention makes this painless.`)}
`);

S(1, 'Community, Documentation & Resources', `
${lead(`raylib's docs are famously learnable — if you know the four canonical entry points.`)}
${tbl(['Resource', 'What it is', 'When to use it'], [
  ['<b>raylib.com/cheatsheet</b>', 'One-page PDF of every function with signatures', 'Keep it open beside your editor'],
  ['<b>raylib.com/examples</b> (and the <code class="inl">examples/</code> folder in the repo)', '~120 web-runnable examples, one per feature', 'See any API working in 30 lines'],
  ['<b>raylib GitHub</b>', 'Source, issues, release notes, project templates', 'Reading <code class="inl">rcore.c</code> teaches real engineering'],
  ['<b>Discord · Reddit r/raylib · forum</b>', 'Active community + the author himself', 'Blocked more than an hour? Ask'],
  ['<b>raylib games showcase</b>', 'Hundreds of shipped games with sources', 'Study real architectures'],
  ['<b>raygui / physac repos</b>', 'Companion libs with their own examples', 'Chapters 7 and 11 companions']
])}
${bp(`When an example won't compile after a raylib upgrade: check the release notes for <b>renames</b>
(5.5 renamed several functions), then re-check the cheatsheet for your version. 90% of &ldquo;API missing&rdquo;
errors are version drift, not bugs.`)}
${note(`The source layout mirrors the module map slide: <code class="inl">src/rcore.c</code>,
<code class="inl">src/rshapes.c</code>… Reading even 100 lines of rcore.c is a masterclass in portable C.`)}
`);

S(1, 'Prerequisites: What You Should Know', `
${lead(`This course is written for a developer who has <b>met C</b> but not necessarily built large C
projects. Here is the honest self-check — and the rescue plan if a topic is rusty.`)}
<h3>You are ready if you can…</h3>
<ul class="check">
  <li>Read pointers, structs, and <code class="inl">typedef</code>s without panic.</li>
  <li>Write a <code class="inl">for</code> loop over an array and pass a struct by pointer to a function.</li>
  <li>Understand <code class="inl">malloc</code>/<code class="inl">free</code> at a basic level (we refine this with ownership rules).</li>
  <li>Use a terminal to compile and run a program.</li>
</ul>
<h3>Rusty? 30-minute rescue plan</h3>
${tbl(['Topic', 'Minimum to proceed', 'Where we re-teach it'], [
  ['Function pointers', 'Reading <code class="inl">void (*update)(World*, float)</code>', 'Ch 7 Screen interface'],
  ['Structs + composition', 'Nested structs, flexible arrays', 'Ch 3 Game context'],
  ['Preprocessor &amp; headers', 'Include guards, <code class="inl">#define</code>, implementation macros', 'Ch 2 build setup'],
  ['Basic linear algebra', 'Vectors as arrows, length, direction', 'Ch 3 math conventions']
])}
${note(`No prior graphics, shader, or audio knowledge is assumed — Chapters 8–14 build those from zero.
The only real prerequisite is the C reading level above.`)}
`);

S(1, 'Toolchain: Compilers & Debuggers per OS', `
${lead(`C is only as good as its toolchain. Pick one stack per platform now; the course builds on all three.`)}
${tbl(['Platform', 'Recommended compiler', 'Debugger', 'Notes'], [
  ['<b>Windows</b>', 'MSVC (<code class="inl">cl.exe</code>, via VS Build Tools) <i>or</i> MinGW-w64 GCC', 'Visual Studio · WinDbg · gdb', 'MSVC = best debugger; MinGW = lightest install'],
  ['<b>macOS</b>', 'Apple Clang (<code class="inl">clang</code>, ships with Xcode CLT)', 'LLDB (in Xcode/CLI)', 'Sign installers; universal binaries for ARM+Intel'],
  ['<b>Linux</b>', 'GCC or Clang from distro repos', 'gdb · lldb · Valgrind · ASan', 'Best sanitizer/valgrind story — use it in CI']
])}
${c`
# Compile a raylib program by hand (after Chapter 1's setup):
gcc main.c -o game -Ithird_party/raylib/src -Lthird_party/raylib/src \\
    -lraylib -lopengl32 -lgdi32 -lwinmm           # Windows + MinGW

gcc main.c -o game -lraylib -lGL -lm -lpthread -ldl   # Linux
clang main.c -o game -lraylib -framework OpenGL -framework Cocoa \\
    -framework IOKit -framework CoreAudio -framework CoreVideo  # macOS`}
${bp(`Enable warnings like they are errors from commit #1:
<code class="inl">-Wall -Wextra -Wshadow -Wconversion</code>. C silently coerces and truncates — warnings are
your first bug-finder, and they are free.`)}
${note(`Sanitizers (GCC/Clang): compile with <code class="inl">-fsanitize=address,undefined</code> in debug
builds. They catch out-of-bounds and use-after-free at the exact line — hours saved per bug.`)}
`);

S(1, 'IDEs & Editors: Pick Your Cockpit', `
${lead(`Any editor works — the course only assumes you can compile and debug. These are the tested setups
students actually ship with.`)}
${tbl(['Setup', 'Strengths', 'Chapter-1 checklist'], [
  ['<b>VS Code + C/C++ extension</b>', 'Free, light, huge ecosystem, tasks for builds, gdb/lldb UI', 'Install extension → open folder → add build task → F5 debug'],
  ['<b>Visual Studio 2022 (Win)</b>', 'Best-in-class debugger (data breakpoints!), MSVC, profiler', 'Create &ldquo;Console App&rdquo; → add raylib include/lib paths'],
  ['<b>CLion (JetBrains)</b>', 'Indexing, refactors, bundled CMake + debugger UI', 'Open the course CMakeLists → done'],
  ['<b>Raylib project templates</b>', 'Official VS Code template; community &ldquo;raylib-quick&rdquo; generators', 'One-click repo with build + debug configured']
])}
${bp(`Whatever you choose, get <b>debugging working on day one</b> — breakpoint in the game loop, inspect a
<code class="inl">Vector2</code>. Every later chapter assumes you can pause the frame and look.`)}
${note(`A debugger beats printfs for state bugs, but raylib's <code class="inl">TraceLog</code> (Ch 2) gives you
timestamped, level-filtered logging for flow bugs. You will use both daily.`)}
`);

S(1, 'Getting raylib: Installers & Package Managers', `
${lead(`Four ways to get the library — each valid at a different point of your journey.`)}
${tbl(['Method', 'Command / link', 'Best for'], [
  ['<b>Official installer</b>', 'W64 installer/AppImage/.dmg from raylib.com', 'Day one — zero decisions'],
  ['<b>Package managers</b>', '<code class="inl">winget install raysan5.raylib</code> · <code class="inl">brew install raylib</code> · <code class="inl">apt install libraylib-dev</code> · <code class="inl">vcpkg install raylib</code>', 'Quick setup, easy upgrades'],
  ['<b>Vendored source (this course)</b>', 'git clone raylib into <code class="inl">third_party/</code>, build with your project', 'Reproducibility, console ports, full control'],
  ['<b>Build from source</b>', '<code class="inl">cmake -B build -DBUILD_EXAMPLES=OFF && cmake --build build</code>', 'Custom flags (e.g. OpenGL 3.3 vs 2.1), CI']
])}
${c`
# Our course convention — pinned, vendored, reproducible:
mkdir canyon-hopper && cd canyon-hopper
git init
git submodule add https://github.com/raysan5/raylib.git third_party/raylib
cd third_party/raylib
git checkout 5.5          # pin the exact release
cd ../..
cmake -B build -S .       # our CMakeLists links third_party/raylib`}
${pit(`System package versions drift (and some distros ship <b>ancient</b> raylib). Anything you intend to
ship — pin the exact version by vendoring. &ldquo;Works on my machine&rdquo; ends careers.`)}
`);

S(1, 'Managing Dependencies Like a Pro', `
${lead(`Games pull in more than the engine: JSON, physics, networking, codec libs. C has no npm — you
become the package manager, so make it boring and systematic.`)}
<h3>The dependency tiers</h3>
${tbl(['Tier', 'Examples', 'Strategy'], [
  ['<b>Single-header libs</b>', 'cJSON, physac, raygui, stb', 'Vendor the header into <code class="inl">third_party/</code>, implement in one TU, commit it'],
  ['<b>Small C libraries</b>', 'miniaudio, glad, tinycc? no — e.g. <code class="inl">parson</code>', 'Git submodule pinned to a tag; build as part of your project'],
  ['<b>Big/system libs</b>', 'libcurl (HTTP, Ch 2), libwebsockets', 'Find via CMake <code class="inl">find_package</code>/pkg-config; fallback to vendoring']
])}
${c`
third_party/
  raylib/          # submodule, pinned 5.5
  physac/          # header-only
  raygui/          # header-only
  cjson/           # header + one .c
src/
  impl_deps.c      // ALL *_IMPLEMENTATION macros live here, only here
`}
${bp(`One rule saves you hours: every <code class="inl">#define XYZ_IMPLEMENTATION</code> goes in a single
<code class="inl">impl_deps.c</code>. Implementation macros expand definitions — duplicates mean linker wars you
will not enjoy.`)}
${note(`License hygiene: keep each vendored lib's <code class="inl">LICENSE</code> file beside its source. zlib/MIT
(the common case here) allows shipping closed games — but only if you preserve the notice.`)}
`);

S(1, 'Build Systems: Makefile vs. CMake', `
${lead(`raylib ships a classic <b>Makefile</b>; the wider C world speaks <b>CMake</b>. You will meet both —
here is when each earns its place.`)}
${cols(`
<h3>raylib Makefile — tiny &amp; direct</h3>
${c`
# Makefile (raylib's classic style)
RAYLIB = third_party/raylib/src/libraylib.a

game: main.c $(RAYLIB)
	gcc main.c -o game $(RAYLIB) \
	    -lGL -lm -lpthread -ldl

$(RAYLIB):
	$(MAKE) -C third_party/raylib PLATFORM=PLATFORM_DESKTOP

clean:
	rm -f game`}
<p>Perfect for a one-file demo. Pain grows with folders, platforms, and IDEs.</p>
`, `
<h3>CMake — scales to every target</h3>
${c`
cmake_minimum_required(VERSION 3.16)
project(canyon_hopper C)

set(CMAKE_C_STANDARD 99)
add_executable(game src/main.c src/core/Game.c)  # + all modules

add_subdirectory(third_party/raylib)   # builds raylib for us
target_link_libraries(game PRIVATE raylib)

# warnings + debug friendly
target_compile_options(game PRIVATE
    -Wall -Wextra -Wshadow)
`}
<p>One file drives Windows/macOS/Linux/Android/Web (Ch 2) and every IDE.</p>
`)}
${bp(`Course rule: <b>CMake for the project, Makefile only for quick experiments.</b> Chapter 2 adds a
platform matrix — with CMake toolchains it stays one <code class="inl">CMakeLists.txt</code> instead of five
divergent scripts.`)}
`);

S(1, 'Project Planning: Meet “Canyon Hopper”', `
${lead(`Every chapter from here on contributes to one shipping title. Let's scope the game the way a
small studio would — because architecture follows scope.`)}
<h3>The pitch</h3>
<p><b>Canyon Hopper</b> — a 2D side-scrolling platformer. A bunny crosses canyon levels: hop between
rock platforms, collect coins and power-ups (feathers = double jump), dodge porcupines and falling rocks,
reach the goal flag. Three levels, menus, settings, save data, juice everywhere.</p>
${diag(
`  Splash ──▶ Menu ──▶ Game ──▶ Win/Lose ──▶ Menu
   (Ch7)     (Ch7)   (Ch3-6,8,11,12)  (Ch6,7)
                    │
                    └── Pause / Options (Ch7, Ch9 transitions)`, 'Screen flow — the state spine of our game')}
<h3>Why this scope teaches everything</h3>
${tbl(['Feature', 'Chapters that build it'], [
  ['Window, loop, camera, debug tools', 'Ch 1–3'],
  ['Assets, atlases, level loading, world rendering, HUD', 'Ch 4–5'],
  ['Player, enemies, items, collisions, lives, game over', 'Ch 6'],
  ['Menus, settings, persistence', 'Ch 7'],
  ['Particles, parallax, water, easing', 'Ch 8'],
  ['Screen transitions, audio, physics, shaders, animation', 'Ch 9–12'],
  ['3D bonus mode &amp; 3D physics playground', 'Ch 13–14']
])}
${bp(`Scope discipline: three levels, one enemy type, two power-ups. The <b>systems</b> are the product of
this course; the content is just the test suite for those systems.`)}
`);

S(1, 'Hello raylib — Your First Program, Annotated', `
${lead(`Twenty lines that contain the skeleton of every game you will ever write. Read it slowly — the
comments are the lecture.`)}
${c`
#include "raylib.h"          // everything lives in one friendly header

int main(void) {
    const int W = 1280, H = 720;

    InitWindow(W, H, "Canyon Hopper — dev build");  // 1. window + GL context
    SetTargetFPS(60);                               // 2. frame pacing

    Vector2 bunny = { 200, 300 };                   // 3. game state lives in
    const float SPEED = 320.0f;                     //    plain C variables

    while (!WindowShouldClose()) {                  // 4. THE GAME LOOP
        float dt = GetFrameTime();                  // 5. frame-independent time

        // ---- UPDATE: read input, mutate state --------------------------
        if (IsKeyDown(KEY_RIGHT)) bunny.x += SPEED*dt;   // units/second
        if (IsKeyDown(KEY_LEFT))  bunny.x -= SPEED*dt;
        bunny.y += 100.0f*dt;                            // toy gravity

        // ---- DRAW: state -> pixels --------------------------------------
        BeginDrawing();                              // 6. batch begins
            ClearBackground((Color){ 32, 34, 51, 255 });

            DrawRectangle(0, H-60, W, 60, (Color){ 87, 60, 42, 255 }); // ground
            DrawCircleV(bunny, 24.0f, PINK);         // our "bunny" :)

            DrawText(TextFormat("POS %.0f, %.0f", bunny.x, bunny.y),
                     12, 12, 20, LIME);
            DrawFPS(W-90, 12);                       // 7. always debug
        EndDrawing();                                // 8. flush + swap + poll
    }

    CloseWindow();                                   // 9. teardown
    return 0;
}`}
${bp(`Memorize the loop shape: <b>input → update → draw</b>, all multiplied by <code class="inl">dt</code>.
Chapter 3 formalizes it; every engine on earth is a variation of these 20 lines.`)}
`);

S(1, 'Compiling & Running on Every Platform', `
${lead(`Take the hello-raylib program from zero to running on the three desktops and the browser — the
exact commands, and what each linker flag buys you.`)}
${c`
# ---------- Windows (MinGW-w64) ----------
gcc main.c -o game.exe -Ithird_party/raylib/src \
    -Lthird_party/raylib/src -lraylib -lopengl32 -lgdi32 -lwinmm
#   opengl32: GL   gdi32/winmm: windowing & timers Windows demands

# ---------- Linux ----------
gcc main.c -o game -Ithird_party/raylib/src -Lthird_party/raylib/src \
    -lraylib -lGL -lm -lpthread -ldl -lX11
#   X11: display   dl/pthread: dynamic loading & threads

# ---------- macOS ----------
clang main.c -o game -lraylib \
    -framework OpenGL -framework Cocoa -framework IOKit \
    -framework CoreAudio -framework CoreVideo
#   Cocoa: window   Core*: audio/video services

# ---------- WebAssembly (with emscripten) ----------
emcc main.c -o index.html -O1 -s USE_raylib=1 \
    -s ASYNCIFY -s ALLOW_MEMORY_GROWTH=1 --shell-file shell.html
#   then serve (NOT file://):  python -m http.server`}
${tbl(['Symptom', 'Cause'], [
  ['<code class="inl">undefined reference to InitWindow</code>', 'Missing <code class="inl">-lraylib</code> or library built for another arch (ARM vs x64)'],
  ['Runs then <i>black screen</i> on old GPU', 'raylib default needs GL 3.3 — rebuild with <code class="inl">PLATFORM=PLATFORM_DESKTOP_GL_33</code> alternatives or use GL 2.1 backend'],
  ['Web build: audio never plays', 'Browser autoplay policy — resume audio on first input (Ch 2 &amp; 10)']
])}
${pit(`On Windows, mixing MSVC-built raylib with MinGW builds (or vice versa) corrupts the heap silently.
One compiler per project, end to end.`)}
`);

S(1, 'Chapter 1 Summary — Key Takeaways', `
${lead(`You now speak the language of the whole course: modules, layers, and the loop.`)}
<ul class="check">
  <li>raylib is a <b>modular C library</b>: rcore (platform), rshapes/rtextures/rtext/rmodels (draw + load), raudio, backed by rlgl + raymath.</li>
  <li>All drawing is <b>batched</b> — atlas discipline = performance (Ch 4 pays this off).</li>
  <li><b>Image = CPU pixels, Texture = GPU upload</b>; <b>Sound = RAM, Music = stream</b>.</li>
  <li>Toolchain per OS, warnings as errors, sanitizers in debug — set up <b>now</b>.</li>
  <li>Pin dependencies (submodules), keep implementation macros in one TU, CMake for anything real.</li>
  <li>The 20-line loop — <b>input → update (×dt) → draw</b> — is the course's skeleton.</li>
</ul>
<h3>Carrying forward</h3>
<p>Chapter 2 turns this single binary into a <b>platform matrix</b>: the same code building for desktop,
mobile, and web — and the abstraction layer that makes it possible.</p>
${bp(`Checkpoint project: hello-raylib compiles with warnings-as-errors on your OS, shows FPS, and you
have set a breakpoint inside the game loop. Everything else this course builds stands on that.`)}
`);

/* Chapter 2 — Cross-Platform Development */
