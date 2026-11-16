/* Chapter 4 — Gathering Resources */
defChapter(4, {
  tag: 'Resources',
  title: 'Gathering Resources',
  sub: 'Icons and splash screens, atlases, an AssetManager with async loading, and level data formats that scale.',
  color: '#fb923c',
  topics: ['App icons & splash screens per platform', 'Asset optimization & sprite atlases', 'Sync vs async loading & progress', 'Reference counting & memory cleanup',
    'Organizing asset directories', 'Validating & hot-reloading assets', 'Level data: JSON, XML, text, binary']
});

SEC(4);

S(4, 'What the Game Needs — Asset Inventory', `
${lead(`Before a single PNG: enumerate every asset the shipped game needs, with budget. Surprises in the
asset list become surprises in memory — budget them like money.`)}
${tbl(['Category', 'Canyon Hopper needs', 'Format', 'Est. budget'], [
  ['Sprites', 'Player (12 frames), coins (8), feather, rocks, porcupine (6), props, tiles (16)', 'PNG in <b>one atlas</b>', '1 atlas 2048² ≈ 16MB GPU'],
  ['Backgrounds', 'Sky gradient, 3 parallax strips, water tile', 'PNG (separate, tiled)', '~4MB GPU'],
  ['UI', 'Logo, buttons, panel 9-patch, hearts, virtual pad (Ch 11)', 'PNG atlas #2', '~2MB GPU'],
  ['Fonts', 'Pixel display font + readable body font', 'TTF (packed at load)', '~1MB GPU'],
  ['Audio', '12 SFX (<3s), 3 music tracks (2–3min)', 'WAV/OGG; music OGG', 'SFX ~6MB RAM; music streamed ~0'],
  ['Levels', '3 levels', 'JSON', 'few KB'],
  ['Meta', 'Icon set, splash, manifest', 'PNG/ICO', 'tiny']
])}
${diag(
`  SOURCE ART ( aseprite/psd )          SHIPPED GAME
  ├── hero.aseprite  ──export──▶  atlas.png  (all sprites)
  ├── tiles.aseprite ─export──▶  atlas.json (frame map)
  ├── theme.flac     ─encode──▶  theme.ogg  (quality 5)
  └── level1.tiled   ─export──▶  level1.json
           tools/ scripts own these arrows  ← build once, run forever`, 'Pipeline thinking: transform source → shippable, repeatably')}
${bp(`Budget <b>GPU memory</b> (textures) and <b>RAM</b> (decoded audio) separately — mobile devices die at
~500MB GPU long before desktops care. The table above totals ~25MB: comfortably shippable everywhere.`)}
`);

S(4, 'Application Icons on Every Platform', `
${lead(`The icon is the first thing users see and the last thing developers add. Do it properly per
platform — each has its own channel.`)}
${c`
// Desktop: set at runtime (window/taskbar on Linux/some Win setups)
Image icon = LoadImage("assets/meta/icon_64.png");
SetWindowIcon(icon);
UnloadImage(icon);   // raylib copies the pixels`}
${tbl(['Platform', 'Icon mechanism', 'Files'], [
  ['Windows', '<code class="inl">.rc</code> resource compiled into the EXE', '<code class="inl">icon.ico</code> (16→256px)'],
  ['macOS', '<code class="inl">.icns</code> in the app bundle', '<code class="inl">icon.icns</code>'],
  ['Linux', 'desktop entry + <code class="inl">Icon=</code> path', 'PNG 128px'],
  ['Android', 'manifest mipmap sets + <b>adaptive</b> fg/bg layers', 'fg 108dp, bg color'],
  ['Web', 'favicon + apple-touch-icon in shell.html', '32/180/192px PNG']
])}
${c`
# Windows resource (meta/icon.rc) — one line, compiled into the exe:
1 ICON "assets/meta/icon.ico"
# build:  windres meta/icon.rc icon.res   (MinGW)
#         then link icon.res into game.exe`}
${pit(`A single 4096² PNG &ldquo;icon&rdquo; scaled by the OS looks blurry everywhere and burns load time. Ship
<b>real size steps</b> (16/32/48/64/128/256) inside the .ico — 20 minutes of work, visible in every store
screenshot.`)}
`);

S(4, 'Splash Screens & First-Frame Politics', `
${lead(`raylib has <b>no forced engine splash</b> — but platforms and stores impose their own moments: cold
start, shader compile, asset load. Design the first 2 seconds deliberately.`)}
${c`
// A splash that loads in the BACKGROUND (pattern, not law):
InitWindow(...);                       // first frame ASAP
bool loaded = false; float t = 0;

while (!WindowShouldClose() && t < 3.0f) {
    t += GetFrameTime();
    if (!loaded) loaded = AssetsPoll(&assets);  // Ch: async manager below

    BeginDrawing();
      ClearBackground(BLACK);
      DrawTexture(smallPreloadedLogo, cx, cy, Fade(WHITE,
                    t < 0.4f ? t/0.4f : 1.0f));   // fade in
      if (!loaded) DrawLoadingBar(t);              // honest progress
    EndDrawing();
}
// THEN swap to the menu screen (Ch 7)`}
${tbl(['Platform', 'Who shows a splash', 'Our job'], [
  ['Desktop', 'Nobody (instant window)', 'Own logo moment, optional'],
  ['Android', 'OS launch theme (static drawable)', 'Theme bg = our brand; keep it <400ms to menu'],
  ['iOS', 'Launch storyboard (still images)', 'Same: storyboard ≈ first frame of menu'],
  ['Web', 'shell.html paints before wasm boots', 'Styled HTML spinner = perceived speed']
])}
${bp(`The trick users feel as &ldquo;fast&rdquo;: show the <b>window with something in it within 100ms</b>, then
load. A black window + 3-second wait reads as broken; a branded splash + progress bar reads as
professional even at identical total time.`)}
`);

S(4, 'Asset Optimization: Formats & Sizes', `
${lead(`Pick formats by <b>decoding cost, memory, and platform support</b> — not by habit. This table is the
whole decision space for a 2D game.`)}
${tbl(['Asset', 'Ship as', 'Why', 'Avoid'], [
  ['2D sprites', 'PNG (lossless, alpha)', 'Exact pixels, fast decode', 'JPG (artifacts on hard edges)'],
  ['Photos/full-screen art', 'JPG q85 <i>if</i> no alpha', '5–10× smaller', 'JPG for sprites/UI'],
  ['SFX', 'WAV 16-bit (or OGG q5)', 'WAV = zero decode latency', 'FLAC for SFX (decode cost)'],
  ['Music', 'OGG Vorbis q5', 'Streaming, ~1MB/min', 'WAV music (30MB+/min!)'],
  ['Retro music', 'XM/MOD trackers', 'KBs, authentic (Ch 10)', '—'],
  ['Levels/data', 'JSON (text)', 'Debuggable, diff-able', 'XML (bulky, parser cost) unless tooling demands'],
  ['Big worlds', 'Binary chunk format', 'Load speed, size', 'Premature: JSON until profiler complains']
])}
<h3>Texture sizes</h3>
<ul>
  <li><b>Powers of two</b> (256, 512, 2048…) — mipmapping and old-GPU support (Ch 2 capability slide).</li>
  <li>2048² is the safe mobile ceiling for one atlas; desktop handles 4096²+.</li>
  <li>Pixel art: <code class="inl">SetTextureFilter(tex, TEXTURE_FILTER_POINT)</code> — nearest-neighbor, or
  your crisp pixels blur into mush.</li>
</ul>
${pit(`Do not &ldquo;optimize&rdquo; by downscaling pixel art. Art with 1px outlines must stay 1:1 — scale at
<b>draw time</b> with point filtering. Batch your upscaling decisions into the pipeline script, not the
renderer.`)}
`);

S(4, 'Sprite Packing & Texture Atlases — Why', `
${lead(`An atlas is many sprites fused into one texture with a JSON map of regions. It exists for one
reason: <b>batching</b> (Ch 1) — one texture = no GPU state switch between draws.`)}
${diag(
`  NAIVE (4 textures)                 ATLAS (1 texture)
  Draw coin  → bind atlas.png  …batch break…        Draw coin ─┐
  Draw rock  → bind rock.png   …batch break…        Draw rock  │ same
  Draw player→ bind hero.png   …batch break…        Draw player│ texture:
  Draw tree  → bind tree.png   …batch break…        Draw tree ─┘ 1 draw call
  = 4 draw calls, 4 state changes                  = 1 draw call, 0 switches
  (real games: hundreds of sprites per layer!)`, 'Same pixels, ¼ the driver work — or 100× with hundreds of sprites')}
${c`
// Drawing from an atlas costs nothing extra — it's the SAME call:
Texture2D atlas = LoadTexture("assets/atlases/game.png");

// "sprite" = a region of the atlas, defined once, reused everywhere:
Rectangle coinRegion = { 0, 0, 32, 32 };         // x,y,w,h in atlas px
Rectangle rockRegion = { 32, 0, 32, 32 };

DrawTexturePro(atlas, coinRegion,
               (Rectangle){ 400, 300, 32, 32 },   // world-space dest
               (Vector2){16,16},                   // pivot: center
               0.0f, WHITE);`}
${tbl(['Atlasing wins', 'Costs'], [
  ['Draw calls collapse', 'Harder to debug one sprite (use region overlays)'],
  ['Memory: less padding/driver overhead per texture', 'Sprite must share filter settings (point vs linear)'],
  ['Enables sprite batching + sheet animation (Ch 12)', 'Requires a packing step in the pipeline']
])}
${bp(`Two or three themed atlases (world / UI / fx) beat one mega-atlas: you still batch per layer, and
teams can work on themes independently without re-packing everything.`)}
`);

S(4, 'Building Atlases with rTexPacker', `
${lead(`raylib's companion tool <b>rTexPacker</b> packs folders of images into atlases with a companion
<code class="inl">.rtxp</code> descriptor raylib loads natively. Alternatives: TexturePacker, freeDSA,
or a 30-line shelf packer of your own.`)}
${c`
# 1) Pack a folder (rTexPacker CLI / GUI — output is atlas + descriptor):
rtxp pack assets/sprites/ --out assets/atlases/game.rtxp --size 2048 --trim

// 2) Load the packed atlas — raylib reads .rtxp natively:
Texture2D atlas = LoadTexture("assets/atlases/game.rtxp");

// 3) For custom pipelines (ours), export JSON alongside and parse it:
//    { "frames": [ { "name":"coin_0", "x":0, "y":0, "w":32, "h":32 }, ... ] }`}
${c`
// src/res/AtlasMap.c — name → region lookup (used by EVERYTHING later)
typedef struct AtlasRegion { char name[32]; Rectangle r; } AtlasRegion;

typedef struct AtlasMap {
    AtlasRegion regions[256];
    int count;
} AtlasMap;

bool AtlasLoadJSON(AtlasMap *m, const char *path) {
    char *text = LoadFileText(path);
    if (!text) { TraceLog(LOG_WARNING, "[ASSET] atlas map missing: %s", path); return false; }
    cJSON *root = cJSON_Parse(text);          // vendored cJSON (Ch 1)
    const cJSON *frames = cJSON_GetObjectItem(root, "frames");
    const cJSON *f; int i = 0;
    cJSON_ArrayForEach(f, frames) {
        AtlasRegion *r = &m->regions[i++];
        snprintf(r->name, 32, "%s", cJSON_GetObjectItem(f,"name")->valuestring);
        r->r.x = (float)cJSON_GetObjectItem(f,"x")->valueint;
        r->r.y = (float)cJSON_GetObjectItem(f,"y")->valueint;
        r->r.width  = (float)cJSON_GetObjectItem(f,"w")->valueint;
        r->r.height = (float)cJSON_GetObjectItem(f,"h")->valueint;
        if (i >= 256) break;
    }
    cJSON_Delete(root); UnloadFileText(text);
    TraceLog(LOG_INFO, "[ASSET] atlas: %d regions", m->count = i);
    return true;
}`}
${bp(`Pack with <b>1–2px gutter/extrusion</b> between sprites. Without it, linear filtering bleeds
neighboring sprites' edge pixels into yours — the classic &ldquo;purple halo around my hero&rdquo; bug.`)}
`);

S(4, 'The AssetManager — Design', `
${lead(`One module owns <b>every</b> GPU/audio handle: loads by name, caches, counts, unloads all. The rest
of the codebase requests — never loads.`)}
${diag(
`  any code ──"assets, give me 'coin_0'"──▶ AssetManager
                                            │ found? return cached region
                                            │ missing? [dev: log + placeholder]
  loader thread ──"image decoded"──▶ main thread: LoadTextureFromImage
                                            │
  GameShutdown ─────────────────────▶ UnloadAll (mirror order)`, 'One door for all resources')}
${c`
// src/res/AssetManager.h
typedef enum { RES_TEXTURE, RES_FONT, RES_SOUND, RES_MUSIC } ResKind;

typedef struct ResEntry {
    char    name[64];       // "coin_0", "theme", "pix_font"
    ResKind kind;
    int     refCount;       // who is using it (see cleanup slide)
    union {
        Texture2D tex; Sound snd; Music mus; Font fnt;
    };
} ResEntry;

typedef struct AssetManager {
    Texture2D atlas;              // the big sheet
    AtlasMap  map;                // name → region
    ResEntry  entries[128];
    int       entryCount;
    // async state (later slide)
    bool      loading;
    float     progress;           // 0..1 for the loading screen
} AssetManager;

Rectangle AssetsRegion(AssetManager *a, const char *spriteName);
Sound    *AssetsSound (AssetManager *a, const char *name);
bool      AssetsLoadAll(AssetManager *a);          // manifest-driven
bool      AssetsPoll  (AssetManager *a);           // async tick → true when done
void      AssetsUnloadAll(AssetManager *a);`}
${bp(`The manager is also your <b>assertion surface</b>: every miss logs name + caller. &ldquo;Invisible
sprite&rdquo; bugs become one-line log entries instead of hour-long archaeology.`)}
`);

S(4, 'Synchronous Loading', `
${lead(`Sync loading is one <code class="inl">for</code> loop: simple, blocking, perfect for small games and
level restarts. Understand it first — the async manager is this plus a thread.`)}
${c`
// Manifest = a JSON list: the ONE place new assets get registered
// assets/manifest.json:
//  { "textures": ["bg_sky","bg_mountains"],
//    "sounds":   ["jump","coin","hit"],
//    "music":    ["theme"] }

bool AssetsLoadAll(AssetManager *a) {
    a->atlas = LoadTexture("assets/atlases/game.png");   // sync: fine here
    AtlasLoadJSON(&a->map, "assets/atlases/game.json");

    char *txt = LoadFileText("assets/manifest.json");
    cJSON *man = cJSON_Parse(txt);
    // sounds:
    cJSON_ArrayForEach(f, cJSON_GetObjectItem(man, "sounds")) {
        char path[256];
        snprintf(path, sizeof path, "assets/audio/%s.wav", f->valuestring);
        AssetsPut(a, f->valuestring, RES_SOUND, &(Sound){0});
        a->entries[a->entryCount-1].snd = LoadSound(path);
    }
    // music + fonts: same shape (LoadMusicStream / LoadFontEx)…
    cJSON_Delete(man); UnloadFileText(txt);
    TraceLog(LOG_INFO, "[ASSET] loaded %d entries", a->entryCount);
    return true;
}

void AssetsUnloadAll(AssetManager *a) {
    for (int i = 0; i < a->entryCount; i++) {
        switch (a->entries[i].kind) {
        case RES_SOUND:  UnloadSound(a->entries[i].snd); break;
        case RES_MUSIC:  UnloadMusicStream(a->entries[i].mus); break;
        case RES_FONT:   UnloadFont(a->entries[i].fnt); break;
        default: break;
        }
    }
    UnloadTexture(a->atlas);          // atlas LAST (users reference it)
    a->entryCount = 0;
}`}
${pit(`Sync-loading <b>per level restart</b> re-decodes the atlas every death → hitch. Cache across
restarts (load once at boot, levels share the atlas), and only stream what truly varies per level
(music).</p>`)}
`);

S(4, 'Asynchronous Loading & Progress Tracking', `
${lead(`For boot and level swaps, load on a worker thread while the main thread renders a progress bar.
The Ch 2 thread rules apply: workers decode <b>CPU data</b>; main thread uploads <b>GPU objects</b>.`)}
${c`
// src/res/AssetManagerAsync.c — the pattern in 3 pieces
typedef struct LoadRequest {
    char path[256]; ResKind kind;
    Image img;  bool cpuDone;      // worker finished decoding?
    bool  gpuDone;                 // main finished uploading?
} LoadRequest;

static void WorkerDecode(void *arg) {           // runs on THREAD
    AssetManager *a = (AssetManager *)arg;
    for (int i = 0; i < a->queueCount; i++) {
        LoadRequest *q = &a->queue[i];
        if (q->kind == RES_TEXTURE)
            q->img = LoadImage(q->path);        // CPU-only: ALLOWED off-main
        q->cpuDone = true;
    }
    a->queueDone = true;
}

bool AssetsPoll(AssetManager *a) {              // main thread, each frame
    if (a->loading && a->queueDone) {           // worker finished?
        for (int i = 0; i < a->queueCount; i++) {
            LoadRequest *q = &a->queue[i];
            if (q->cpuDone && !q->gpuDone) {
                // GPU UPLOAD — main thread only (Ch 2 iron rule):
                Texture2D t = LoadTextureFromImage(q->img);
                UnloadImage(q->img);
                AssetsPutTexture(a, q->path, t);
                q->gpuDone = true;
            }
        }
        a->progress = (float)a->uploadedCount / a->queueCount;
        if (a->uploadedCount == a->queueCount) { a->loading = false; return true; }
    }
    return a->progress >= 1.0f;
}

// Boot:  a->loading = true; LoadThread(WorkerDecode, a);
// Loop:  if (AssetsPoll(a)) SwitchToMenu();  else DrawBar(a->progress);`}
${diag(
`  WORKER: LoadImage ──LoadImage──LoadImage──▶ done flag
                 │ handoff (plain struct + flag)
  MAIN:   draw bar ▸ upload tex ▸ draw bar ▸ upload tex ▸ … ▸ done→menu
  (upload 1-2 per frame → progress bar animates AND no frame spikes)`, 'One image per frame: smooth bar, smooth framerate')}
${bp(`Throttle uploads to 1–2 textures per frame — uploading 50 at once just moves the hitch from
&ldquo;load&rdquo; to &ldquo;first frame&rdquo;. The visible progress bar is free UX.`)}
`);

S(4, 'Reference Counting & Memory Cleanup', `
${lead(`When two systems share a sound, who unloads it? <b>Nobody decides</b> — the manager counts users
and unloads at zero. C's answer to garbage collection, one int at a time.`)}
${c`
// Get with +1 ref; Release with -1; manager frees at 0 (or never, if pooled)
Sound *AssetsSound(AssetManager *a, const char *name) {
    ResEntry *e = AssetsFind(a, name);
    if (!e) { TraceLog(LOG_WARNING, "[ASSET] miss: %s", name); return NULL; }
    e->refCount++;
    return &e->snd;
}

void AssetsRelease(AssetManager *a, const char *name) {
    ResEntry *e = AssetsFind(a, name);
    if (!e || e->refCount <= 0) return;
    if (--e->refCount == 0 && e->kind == RES_MUSIC) {
        UnloadMusicStream(e->mus);      // big memory: free eagerly
        AssetsRemove(a, e);
        TraceLog(LOG_INFO, "[ASSET] freed music '%s'", name);
    }
    // small shared assets (sfx/atlas) live for the session — freed in UnloadAll
}`}
${tbl(['Strategy', 'Use for', 'Behavior'], [
  ['Session-long pool', 'Atlas, fonts, common SFX', 'Loaded once, freed in <code class="inl">AssetsUnloadAll</code> — simplest, our default'],
  ['Ref-counted', 'Per-level music, big textures', 'Free at refcount 0 — bounds peak memory'],
  ['LRU cache', 'Many levels, big assets', 'Evict least-recently-used past budget — advanced (skip until needed)']
])}
${pit(`The double-unload is C's silent killer: <code class="inl">UnloadTexture</code> twice = heap corruption
<i>far from the crime scene</i>. Centralizing every unload in the manager (nobody else calls
<code class="inl">Unload*</code> for shared assets) removes the bug class entirely.`)}
`);

S(4, 'Organizing Asset Directories', `
${lead(`Names are API. A consistent naming scheme is autocomplete for artists — and prevents
<code class="inl">Coin (final)2.png</code> from ever reaching your atlas.`)}
${diag(
`  assets/
  ├── atlases/   game.png + game.json (packed — DO NOT hand-edit)
  ├── src-art/   hero.aseprite, tiles.aseprite (SOURCE, not shipped)
  ├── audio/     sfx_jump.wav  sfx_coin.wav  mus_theme.ogg  mus_cave.ogg
  ├── fonts/     font_pixel.ttf  font_body.ttf
  ├── levels/    level_01.json  level_02.json  level_03.json
  ├── meta/      icon.ico  icon.icns  adaptive-*.png  splash.png
  └── manifest.json              ← the ONE registry (previous slide)`, 'Two trees: source art (repo only) vs shipped assets')}
${tbl(['Convention', 'Example', 'Why'], [
  ['<code class="inl">kind_noun_variant</code>', '<code class="inl">sfx_jump_big.wav</code>, <code class="inl">spr_coin_4</code>', 'Sortable, greppable, self-describing'],
  ['snake_case everywhere', '<code class="inl">mus_theme.ogg</code>', 'Case-safety on web/Android (Ch 2!)'],
  ['Frame-suffixed sheets', '<code class="inl">hero_run_0..7</code>', 'Anim clips index by name (Ch 12)'],
  ['No spaces, no accents, no <code class="inl">final2</code>', '—', 'Every exception costs someone an hour']
])}
${bp(`Automate enforcement: a 20-line pipeline script that <b>fails the build</b> on uppercase filenames or
missing manifest entries. Conventions that are not checked do not exist.`)}
`);

S(4, 'Validating Assets at Load Time', `
${lead(`Fail <b>loudly and early</b> in dev; degrade <b>gracefully</b> in release. Both need the same
validation pass — write it once.`)}
${c`
// src/res/AssetValidate.c — runs after every load in DEBUG builds
void AssetsValidate(AssetManager *a) {
    // 1) every region in the map actually lies inside the atlas
    for (int i = 0; i < a->map.count; i++) {
        Rectangle r = a->map.regions[i].r;
        if (r.x < 0 || r.y < 0 ||
            r.x + r.width  > (float)a->atlas.width ||
            r.y + r.height > (float)a->atlas.height)
            TraceLog(LOG_ERROR, "[ASSET] region '%s' out of atlas bounds!",
                     a->map.regions[i].name);
    }
    // 2) textures are power-of-two where it matters (mobile)
    // 3) sounds under duration budget; music streams exist
    // 4) manifest names resolve (no orphans, no missing)
}

// Release-mode graceful fallback:
Rectangle AssetsRegion(AssetManager *a, const char *name) {
    Rectangle r = AtlasFind(&a->map, name);
    if (r.width == 0) {                          // miss
        if (DEBUG_BUILD) assert(false && "missing sprite");
        else return (Rectangle){0,0,32,32};      // magenta checker square
    }
    return r;
}`}
${tbl(['Build', 'On missing asset'], [
  ['Debug', '<b>assert + abort</b> — find it the second it happens'],
  ['QA', 'Red placeholder + persistent on-screen warning counter'],
  ['Release', 'Invisible placeholder + one TraceLog; game keeps running']
])}
${pit(`The worst failure mode is <b>silent success</b>: a zero-sized region draws nothing, the game
&ldquo;works&rdquo;, and nobody notices the missing power-up until players do. Never let
<code class="inl">(Rectangle){0}</code> flow onward quietly.`)}
`);

S(4, 'Hot-Reloading Assets', `
${lead(`The artist's accelerator: edit a PNG, press ${kbd('F5')} in-game, see it <i>immediately</i>. Runtime cost:
near zero — raylib can re-upload texture pixels over the same GPU object.`)}
${c`
// src/res/AssetHotReload.c
typedef struct WatchedFile { char path[256]; long mtime; } WatchedFile;

void AssetsWatch(AssetManager *a, const char *path) { /* store path+stat */ }

bool AssetsCheckReload(AssetManager *a) {          // call on F5 or 2s timer
    bool any = false;
    for (int i = 0; i < a->watchCount; i++) {
        WatchedFile *w = &a->watch[i];
        long mtime = GetFileModTime(w->path);
        if (mtime > 0 && mtime != w->mtime) {
            w->mtime = mtime;
            if (strcmp(w->path, "assets/atlases/game.png") == 0) {
                Image img = LoadImage(w->path);   // CPU decode
                UpdateTexture(a->atlas, img.data);// SAME handle: no re-bind!
                UnloadImage(img);
                TraceLog(LOG_INFO, "[ASSET] hot-swapped atlas");
                any = true;
            }
            // levels (JSON) hot reload via WorldReload — Ch 5
        }
    }
    return any;
}`}
${tbl(['Reload target', 'Mechanism', 'Caveat'], [
  ['Atlas pixels', '<code class="inl">UpdateTexture</code> (same handle)', 'Regions fixed at pack time — re-run packer first'],
  ['Shaders (Ch 11)', '<code class="inl">LoadShader</code> + swap', 'Uniform locations must be re-cached!'],
  ['Levels', 're-parse JSON → rebuild World', 'Game state (score) must survive — reload entities only'],
  ['Audio', 'unload + reload Sound', 'Playing instances stop — reload between screens']
])}
${bp(`Wire reload to a <b>2-second polling timer</b>, not just a key: artists alt-tab, save, look back —
it already reloaded. Tiny feature, giant morale.`)}
`);

S(4, 'Level Data Formats: The Decision', `
${lead(`Levels are the asset class that becomes a <b>schema</b>. Choose the format by who edits it and how
big it gets — not by fashion.`)}
${tbl(['Format', 'Human-writable', 'Size', 'Parse cost', 'Tooling story'], [
  ['<b>JSON</b>', 'Yes (diff-able!)', 'Verbose', 'Small — cJSON is ~1000 LOC', 'Tiled exports it; every language reads it'],
  ['<b>XML/TMX</b>', 'Painfully', 'Very verbose', 'Heavier parser to vendor', 'Tiled native; schema bloat over time'],
  ['<b>Plain text</b>', 'Trivially', 'Tiny', 'Trivial <code class="inl">sscanf</code>', 'Great for grids; weak for structured data'],
  ['<b>Binary</b>', 'No', 'Optimal', ' memcpy + offsets = instant', 'Needs versioning + editor export']
])}
${c`
// Our call for Canyon Hopper: JSON (Tiled-compatible subset), because:
//  - designers tweak values without a programmer,
//  - git merges stay sane,
//  - size is KBs — binary's only win is irrelevant here.
// The same loader later streams binary chunks IF a level ever exceeds ~1MB.`}
${note(`Tiled (free, ubiquitous) exports exactly the JSON subset we need: tile layers (CSV) + object
layer (spawns). Designers get a real editor; programmers get a boring parser. Ch 5 consumes it.`)}
${pit(`Whatever you pick, <b>version your schema</b>: first field = <code class="inl">"version": 2</code>. The
day you add fields, old saves/levels still load with defaults instead of crashing — this is Ch 7's
persistence lesson arriving early.`)}
`);

S(4, 'Level JSON — Authoring the First Level', `
${lead(`Here is level 1 as we will ship it. Read it as a contract: every key below becomes a field the
Chapter 5 loader reads.`)}
${json`
{
  "version": 2,
  "name": "Sunrise Slopes",
  "tileSize": 32,
  "width": 60,
  "height": 14,
  "layers": {
    "terrain": [            // row-major tile ids (0 = empty, 1 = ground,
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
      0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
      1,1,1,1,0,0,1,1,1,0,0,0,1,1,1,1,1,0,0,0,1,1,0,0,1,1,1,1,1,1
    ],
    "decor":  [ "...same shape, prop ids..." ]
  },
  "objects": [
    { "type": "player", "x": 2,   "y": 11 },
    { "type": "coin",   "x": 7,   "y": 10 }, { "type": "coin", "x": 8,  "y": 10 },
    { "type": "feather","x": 14,  "y": 9  },
    { "type": "rock",   "x": 21,  "y": 10 },
    { "type": "goal",   "x": 57,  "y": 11 }
  ],
  "theme": { "skyTop": "#20223333", "water": true, "parallax": 3 }
}`}
${tbl(['Field', 'Read by (Ch 5)', 'Notes'], [
  ['<code class="inl">terrain[]</code>', 'Tile grid → static collision boxes', 'Rows of <code class="inl">width</code> ints; 0=air'],
  ['<code class="inl">objects[]</code>', 'Entity factory → dynamic objects', '<code class="inl">x,y</code> in <b>tiles</b>, converted to world px'],
  ['<code class="inl">theme</code>', 'Renderer setup (Ch 8 parallax, water)', 'Per-level mood without code'],
  ['<code class="inl">version</code>', 'Migration guard', 'Old files load with defaults']
])}
${bp(`Grid ids as plain numbers (not strings!) keep levels under 10KB and make procedural mutation
trivial — you will thank yourself in Chapter 11 when levels become physics bodies.`)}
`);

S(4, 'Parsing Level JSON with cJSON', `
${lead(`The full parser for the schema above — defensive, logged, and honest about partial failure. This
is the exact code Chapter 5's LevelLoader calls.`)}
${c`
#include "cjson.h"

typedef struct LevelData {
    int version; char name[32];
    int tileSize, width, height;
    int  *terrain;          // width*height ints (malloc'd)
    GameObjectDef *objs; int objCount;
} LevelData;

bool LevelParse(const char *path, LevelData *out) {
    char *txt = LoadFileText(path);
    if (!txt) { TraceLog(LOG_ERROR, "[LEVEL] no file: %s", path); return false; }
    cJSON *j = cJSON_Parse(txt);
    if (!j) {
        const char *err = cJSON_GetErrorPtr();
        TraceLog(LOG_ERROR, "[LEVEL] JSON syntax error near: %.20s",
                 err ? err : "?");
        goto fail;
    }
    out->version  = cJSON_GetObjectItem(j,"version")->valueint;
    if (out->version > 2) { TraceLog(LOG_WARNING, "[LEVEL] newer schema, attempting"); }
    strcpy(out->name, cJSON_GetObjectItem(j,"name")->valuestring);
    out->tileSize = cJSON_GetObjectItem(j,"tileSize")->valueint;
    out->width    = cJSON_GetObjectItem(j,"width")->valueint;
    out->height   = cJSON_GetObjectItem(j,"height")->valueint;

    const cJSON *t = cJSON_GetObjectItem(cJSON_GetObjectItem(j,"layers"),
                                         "terrain");
    out->terrain = calloc((size_t)out->width * out->height, sizeof(int));
    int i = 0;
    cJSON_ArrayForEach(v, t)
        if (i < out->width * out->height) out->terrain[i++] = v->valueint;

    const cJSON *objs = cJSON_GetObjectItem(j, "objects");
    out->objCount = cJSON_GetArraySize(objs);
    out->objs = calloc((size_t)out->objCount, sizeof(GameObjectDef));
    i = 0;
    cJSON_ArrayForEach(o, objs) {
        GameObjectDef *d = &out->objs[i++];
        d->x = cJSON_GetObjectItem(o,"x")->valueint * out->tileSize;
        d->y = cJSON_GetObjectItem(o,"y")->valueint * out->tileSize;
        snprintf(d->type, 16, "%s", cJSON_GetObjectItem(o,"type")->valuestring);
    }
    cJSON_Delete(j); UnloadFileText(txt);
    return true;
fail:
    UnloadFileText(txt);
    return false;
}`}
${pit(`cJSON gives <code class="inl">NULL</code> for missing keys — and dereferencing NULL crashes mid-load.
Wrap hot expectations in a tiny <code class="inl">ReqInt(j,"width")</code> helper that logs the exact missing field
instead of a debugger session.`)}
`);

S(4, 'Custom Binary Assets — When & How', `
${lead(`Binary is a <b>load-speed and size</b> tool for large data (big worlds, baked physics, replays).
Structure it like a tiny file system: header, table of contents, blobs.`)}
${c`
// A minimal chunk format — versioned, endian-explicit, TOC-first
#pragma pack(push, 1)                 // exact layout, no padding surprises
typedef struct {
    char     magic[4];                // "CHPK"
    uint16_t version;                 // bump on schema change
    uint16_t chunkCount;
} PackHeader;

typedef struct {
    char     id[24];                  // "level_03", "atlas_ui"
    uint32_t offset, sizeBytes;       // into the file
    uint32_t kind;                    // 0=level 1=image 2=audio
} PackEntry;
#pragma pack(pop)

bool PackLoad(const char *file) {
    unsigned char *data;  int size;
    data = LoadFileData(file, &size);            // one disk hit
    PackHeader h;  memcpy(&h, data, sizeof h);
    if (memcmp(h.magic, "CHPK", 4) != 0 || h.version > PACK_VERSION)
        { TraceLog(LOG_ERROR, "[PACK] bad/old pack"); return false; }

    PackEntry *toc = (PackEntry *)(data + sizeof h);
    for (int i = 0; i < h.chunkCount; i++) {
        unsigned char *blob = data + toc[i].offset;
        // zero-copy: parse straight from the pack buffer
        LevelParseFromMemory(blob, toc[i].sizeBytes, ...);
    }
    // keep 'data' alive while chunks reference it (or copy out per chunk)
}`}
${tbl(['Rule', 'Reason'], [
  ['Magic + version header first', 'Reject garbage and old packs instantly'],
  ['TOC up-front, blobs after', 'Seek/read exactly what you need'],
  ['<code class="inl">#pragma pack(1)</code> + fixed int types', 'Padding and long-size differ across platforms'],
  ['Explicit endianness for cross-platform packs', 'ARM Android ↔ x86 PC saves']]
)}
${bp(`Do not build this until a profiler proves JSON is slow. But when you do: keep the JSON path as the
<b>authoring format</b> and the pack as a build output — humans edit text, machines eat binary.`)}
`);

S(4, 'The Asset Pipeline — Putting It All Together', `
${lead(`One script owns source→shipped transforms. Local dev uses loose files (hot reload!); release
builds pack. Same game code either way — paths never change.`)}
${sh`
# tools/build_assets.sh (or .py) — run on every build, ~2 seconds
set -e
# 1) pack sprites → atlas (fails on: duplicate names, over-size, uppercase)
rtxp pack assets/src-art/ --out assets/atlases/game.rtxp --json --size 2048 --trim --gutter 2
# 2) transcode music ( FLAC/MP3 sources → OGG q5 )
for f in assets/src-art/music/*.flac; do
  ffmpeg -y -q:a 5 "$f" "assets/audio/mus_$(basename "$f" .flac).ogg"
done
# 3) validate: every manifest entry exists; every level parses
./build/tools/validate_assets assets/manifest.json
# 4) (release only) bundle into pack + report budget
if [ "$1" = "--release" ]; then packer assets/ game.pack --budget-mb 64; fi`}
${diag(
`   artists/level designers            CI / release
   └─ save .aseprite/.tiled ──▶ build_assets ──▶ game.pack
             │                      │
             ▼ (dev)                ▼ (release)
        loose files  ◀── same loader ──▶  pack chunks
             └────── AssetsManager hides which ──────┘`, 'One pipeline, two consumers, zero game-code branches')}
${pit(`If the pipeline script is optional, it will rot. Wire it into the build (CMake custom command) so a
fresh clone produces a <b>reproducible</b> asset set — &ldquo;works only with Dave's local PNGs&rdquo; is how
shipping dates die.`)}
`);

S(4, 'Testing & QA for Assets', `
${lead(`Assets break in ways code doesn't: aspect ratios drift, names typo, volumes mismatch. Three cheap
practices catch 95% of it.`)}
<ul class="check">
  <li><b>Automated validation</b> (build fails): names resolve, regions in-bounds, POT sizes, case rules, manifest completeness.</li>
  <li><b>Asset gallery screen</b> (debug key ${kbd('F6')}): renders EVERY atlas region in a grid with names — wrong pixels pop out instantly.</li>
  <li><b>Audio board</b> (debug ${kbd('F7')}): click-to-play every sound at standard volume; outliers reveal themselves.</li>
</ul>
${c`
// The gallery in ~15 lines — worth its weight in gold:
void DrawAssetGallery(AssetManager *a, int cols) {
    int x = 16, y = 48;
    for (int i = 0; i < a->map.count; i++) {
        Rectangle r = a->map.regions[i].r;
        DrawTextureRec(a->atlas, r, (Vector2){(float)x,(float)y}, WHITE);
        DrawRectangleLines((int)x-1,(int)y-1,(int)r.width+2,(int)r.height+2,
                           (Color){80,80,80,255});
        DrawText(a->map.regions[i].name, x, (int)(y + r.height + 2), 10, LIME);
        x += (int)r.width + 24;
        if (x > GetScreenWidth() - 64) { x = 16; y += 96; }
    }
}`}
${bp(`Add a <b>&ldquo;budget report&rdquo;</b> to the pipeline: total texture MB, sound RAM, biggest asset.
Emailed by CI on every merge, it makes regressions visible the day they land — not the week before ship.`)}
`);

S(4, 'Chapter 4 Summary — Key Takeaways', `
${lead(`Canyon Hopper can now look and sound like a real game — through a professional pipeline.`)}
<ul class="check">
  <li>Inventory + <b>budgets</b> before art; formats chosen per asset class (PNG/OGG/JSON).</li>
  <li>Icons per platform (rc/ico/icns/mipmap/favicon); splash = <b>something on screen in 100ms</b>.</li>
  <li><b>Atlases = batching</b>; pack with gutters; <code class="inl">TEXTURE_FILTER_POINT</code> for pixel art.</li>
  <li>AssetManager is the <b>only</b> door to GPU/audio handles; manifest-driven; sync simple, async = worker decodes + main uploads (1–2 per frame).</li>
  <li>Ref-count only what varies per level; session pool for the rest; centralize unloads.</li>
  <li>Naming law + pipeline enforcement; validation loud in dev, graceful in release.</li>
  <li>Hot reload = <code class="inl">UpdateTexture</code> + level re-parse = artist speed.</li>
  <li>Levels: JSON (Tiled-compatible, versioned); binary packs only when the profiler demands.</li>
</ul>
<h3>Carrying forward</h3>
<p>Chapter 5 turns terrain arrays and object lists into a <b>living scene</b>: the LevelLoader, layered
world rendering, and the HUD.</p>
${bp(`Checkpoint: game boots through the manifest (no hardcoded <code class="inl">LoadTexture</code> calls outside
the manager), F5 hot-swaps an edited atlas, F6 shows the gallery, and a missing file logs a name — not a
crash.`)}
`);
