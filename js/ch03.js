/* Chapter 3 — Configuring the Game */
defChapter(3, {
  tag: 'Configuration',
  title: 'Configuring the Game',
  sub: 'Project structure, architectural patterns, the Core/World/Renderer trio, the real game loop, and the virtual camera.',
  color: '#fbbf24',
  topics: ['Project structure & folder conventions', 'Architecture patterns: EC & MVC in games', 'Constants, Game coordinator, World controller, World renderer',
    'Fixed vs variable timestep', 'Test assets & render layers', 'Debug controls & the virtual camera']
});

SEC(3);

S(3, 'Project Structure & Package Hierarchy', `
${lead(`Before code: layout. A predictable tree means any file is one guess away, new teammates onboard in
minutes, and the build script stays boring.`)}
${diag(
` canyon-hopper/
 ├── src/
 │   main.c                 # entry point only (Ch 2)
 │   app.c                  # lifecycle owner (Ch 2)
 │   core/                  # Game, Constants, Input map, Config
 │   │   ├── Game.h / Game.c
 │   │   ├── Constants.h
 │   │   └── Input.h / Input.c
 │   world/                 # MODEL: simulation
 │   │   ├── World.h / World.c        # controller
 │   │   ├── WorldRenderer.h / .c     # VIEW (draw only!)
 │   │   ├── LevelLoader.h / .c       # data → entities (Ch 5)
 │   │   └── objects.h                # GameObject & friends
 │   actors/                # player, items, hazards (Ch 6)
 │   ui/                    # HUD, screens, menus (Ch 5, 7)
 │   fx/                    # particles, transitions, actions (Ch 8, 9, 12)
 │   audio/                 # SoundManager (Ch 10)
 │   res/                   # AssetManager (Ch 4)
 │   └── util/              # math helpers, easing, camera
 ├── assets/
 │   ├── atlases/ sprites/ levels/ audio/ fonts/
 ├── platforms/             # per-platform backends (Ch 2)
 ├── third_party/ tools/ builds/`, 'Mirror structure in folders AND prefixes: World*, Player*, Particle*')}
${bp(`Naming law: <b>file name = primary type name</b> (<code class="inl">World.c</code> owns
<code class="inl">World</code>). Header per module; include what you use; no header includes
<code class="inl">.c</code> files — ever.`)}
${note(`Keep <code class="inl">src/</code> flat-ish on purpose: one folder per subsystem, files prefixed by it.
Deep trees in C projects mostly produce include-path pain.`)}
`);

S(3, 'Architecture Patterns: Why, and Which', `
${lead(`Games resist classic OOP hierarchies: an &ldquo;Entity&rdquo; subclass tree collapses under
combinations (a flying, burning, collectible enemy?). Two patterns survive contact with reality.`)}
${tbl(['Pattern', 'Core idea', 'Wins', 'Costs', 'Where we use it'], [
  ['<b>Entity-Component (EC)</b>', 'Entities are IDs; components are plain data; systems iterate data', 'Combinatorial behavior, cache-friendly arrays, tiny code', 'Needs a small framework, indirection', 'World objects: render, bounds, anim components'],
  ['<b>MVC-ish separation</b>', 'Model = World state · View = WorldRenderer · Controller = input→World calls', 'Simulation testable headless; rendering swappable', 'Discipline to keep View dumb', 'The Core/World/Renderer trio (this chapter)'],
  ['<b>State machines</b>', 'Explicit states + allowed transitions', 'No impossible &ldquo;paused menu while dead&rdquo; bugs', 'Boilerplate per state', 'Screens (Ch 7), player states (Ch 12)']
])}
${diag(
`   INPUT ──▶ CONTROLLER ──▶ MODEL (World)  ──▶ VIEW (Renderer) ──▶ SCREEN
   keyboard     WorldUpdate     entities,      WorldDraw:          swap
   gamepad      applies rules   physics,       camera, layers,
   touch        to state        timers         sprites, HUD`, 'Our MVC-ish flow — data flows one way')}
${pit(`The pattern that kills projects: a <b>God Object</b> that updates, draws, loads and saves. When a
file called <code class="inl">Game.c</code> passes 2000 lines and touches every subsystem, you have
re-invented it. Our <code class="inl">Game</code> struct coordinates; it does not implement.`)}
`);

S(3, 'Entity-Component in Plain C', `
${lead(`No classes needed: an entity is a struct of <b>by-value components</b> (or an ID into component
arrays — we show the simple &ldquo;fat entity&rdquo; first, the SoA variant is discussed below).`)}
${c`
// src/world/objects.h — components as plain data
typedef enum {
    OBJ_NONE = 0, OBJ_TERRAIN, OBJ_COIN, OBJ_FEATHER,
    OBJ_ROCK, OBJ_PLAYER, OBJ_GOAL
} ObjKind;

typedef struct CTransform {         // COMPONENT: where things are
    Vector2 pos;
    Vector2 vel;
} CTransform;

typedef struct CRender {            // COMPONENT: how it draws
    Rectangle atlasRegion;          // source rect in the atlas (Ch 4)
    Color    tint;
    bool     flipX;
    float    scale;
} CRender;

typedef struct CBounds {            // COMPONENT: collision box
    Rectangle box;                  // world-space AABB
} CBounds;

typedef struct GameObject {         // ENTITY = id + chosen components
    ObjKind   kind;
    bool      alive;                // false → slot reusable
    CTransform tf;
    CRender   ren;
    CBounds   bounds;
    float     animT;                // shared scratch timers
} GameObject;`}
${c`
// SYSTEM example: a system is just a loop over one component aspect
void SystemApplyGravity(GameObject *arr, int n, float dt) {
    for (int i = 0; i < n; i++) {
        GameObject *g = &arr[i];
        if (!g->alive) continue;
        if (g->kind == OBJ_COIN) continue;        // coins float
        g->tf.vel.y += GRAVITY * dt;              // rules live HERE
    }
}`}
${note(`Our &ldquo;fat entity&rdquo; trades memory for simplicity — perfect to ~1,000 objects. Beyond that,
move hot components into parallel arrays (structure-of-arrays): <code class="inl">positions[N]</code>,
<code class="inl">velocities[N]</code>… the system loops stay identical, memory layout gets cache-friendly.`)}
`);

S(3, 'The Class Diagram — Canyon Hopper Architecture', `
${lead(`Here is the whole engine we are building, one diagram. Print it; every chapter shades in another
box.`)}
${diag(
`  ┌──────────────────── Game (core/Game.c) ─────────────────────┐
  │  owns & sequences everything, implements nothing            │
  │                                                             │
  │   Assets(res)    World(world)      Renderer(world)          │
  │   ┌─────────┐    ┌───────────┐    ┌──────────────┐          │
  │   │textures │    │objects[]  │    │layers        │          │
  │   │fonts    │    │player     │    │camera(VCam)  │          │
  │   │sounds   │    │level grid │    │draw order    │          │
  │   │atlas    │    │score/lives│    └──────▲───────┘          │
  │   └────┬────┘    └─────▲─────┘           reads              │
  │        │load            │ update(dt)                        │
  │   ┌────▼────────────────┴──────┐                            │
  │   │  Systems: gravity, collide,│  actors/  fx/   audio/     │
  │   │  spawn, triggers, anim     │  Player   Particles SM     │
  │   └────────────────────────────┘                            │
  │        HUD(ui)      Screens(ui)      Transitions(fx)        │
  └─────────────────────────────────────────────────────────────┘
  Data flows: Input → Game.update → World (mutates) → Renderer (reads)`, 'Everything in one picture — Ch 3 builds the shaded center')}
<h3>Ownership rules (C has no garbage collector — ownership IS the architecture)</h3>
<ul>
  <li><b>Game</b> owns all subsystem structs (by value, zero heap when possible).</li>
  <li><b>Assets</b> owns every <code class="inl">Texture2D/Sound/Music</code>; nobody else loads or unloads GPU objects.</li>
  <li><b>World</b> owns entity arrays; systems receive <code class="inl">World*</code> and mutate freely.</li>
  <li><b>Renderer</b> owns <i>nothing</i> — it reads World and Assets. Pure function of state.</li>
</ul>
${bp(`Rule of thumb for leaks: for every <code class="inl">XxxInit</code> an <code class="inl">XxxShutdown</code>, written
the same day, mirroring order (Ch 2). Ownership assigned by module = memory bugs halved before you write a line.`)}
`);

S(3, 'Constants.h — Design-Time Configuration', `
${lead(`Every magic number you would otherwise sprinkle through gameplay gets one name, one place, one
comment. Tuning a game is 90% number-fiddling — make it centralized or suffer.`)}
${c`
// src/core/Constants.h
#pragma once
#include "raylib.h"

// ---- World simulation ----
#define WORLD_GRAVITY        1500.0f   // px/s^2  (feel: heavy bunny)
#define PLAYER_RUN_SPEED     320.0f    // px/s
#define PLAYER_JUMP_SPEED    640.0f    // px/s initial
#define PLAYER_MAX_FALL     1200.0f    // terminal velocity
#define COIN_VALUE               10
#define START_LIVES               3
#define IFRAME_SECONDS         1.5f    // invulnerability after hit

// ---- Fixed timestep (this chapter) ----
#define TICK_RATE               60.0f  // simulation Hz
#define FIXED_DT            (1.0f/60.0f)
#define MAX_FRAME_SECONDS       0.05f  // dt clamp (Ch 2!)

// ---- View ----
#define DESIGN_WIDTH           1280
#define DESIGN_HEIGHT           720
#define CAMERA_LERP             0.12f  // follow smoothing
#define CAMERA_ZOOM             1.0f

// ---- Palette (design as code!) ----
#define COL_SKY_TOP    ((Color){ 32, 34, 51,255})
#define COL_SKY_BOT    ((Color){255,175,130,255})
#define COL_UI_ACCENT  GOLD`}
${tbl(['Kind of value', 'Lives in'], [
  ['Feel/tuning (speeds, gravity)', '<code class="inl">Constants.h</code> — recompile, but reviewed'],
  ['User settings (volume, keys)', 'runtime <code class="inl">Settings</code> struct (Ch 7) + save file'],
  ['Level data (spawns)', 'level files (Ch 4–5), never code']
])}
${pit(`Do not put <b>per-level</b> values in Constants.h — that path ends with
<code class="inl">LEVEL2_GRAVITY_UNDERWATER</code>. Code constants = global truths only; everything
level-specific belongs in level data.`)}
`);

S(3, 'The Core Game Coordinator', `
${lead(`<code class="inl">Game</code> is the conductor: it owns subsystems, sequences the frame, and routes
events between them — while containing almost no logic of its own.`)}
${c`
// src/core/Game.h
#pragma once
#include "raylib.h"
#include "Constants.h"
#include "res/AssetManager.h"
#include "world/World.h"
#include "world/WorldRenderer.h"
#include "util/VCamera.h"
#include "ui/Hud.h"

typedef struct Game {
    // --- subsystems (owned by value: one free() to rule them all) ---
    AssetManager  assets;
    World         world;
    WorldRenderer renderer;
    VCamera       cam;
    Hud           hud;

    // --- global state ---
    float  time;                 // total game time (seconds)
    bool   debug;                // F1 toggle — see debug slide
    bool   quit;
} Game;

void GameInit(Game *g);
void GameUpdate(Game *g, float dt);   // called by fixed-step loop
void GameDraw(Game *g, float alpha);  // alpha = interpolation factor
void GameShutdown(Game *g);`}
${c`
// src/core/Game.c — the conductor, ~100 lines total, forever
void GameInit(Game *g) {
    *g = (Game){0};                       // zero everything
    AssetsLoadAll(&g->assets);            // Ch 4: atlas, fonts, sounds
    WorldInit(&g->world, &g->assets);     // loads level 1 (Ch 5)
    WorldRendererInit(&g->renderer);
    VCamInit(&g->cam, (Rectangle){0,0,DESIGN_WIDTH,DESIGN_HEIGHT});
    g->cam.worldBounds = g->world.bounds;
    HudInit(&g->hud);
}

void GameUpdate(Game *g, float dt) {
    g->time += dt;
    if (IsKeyPressed(KEY_F1)) g->debug = !g->debug;

    WorldUpdate(&g->world, dt, &g->assets);      // ALL simulation
    VCamFollow(&g->cam, g->world.player.tf.pos, dt);
    HudUpdate(&g->hud, &g->world);
}

void GameDraw(Game *g, float alpha) {            // VIEW only
    WorldDraw(&g->renderer, &g->world, &g->cam, alpha, g->debug);
    HudDraw(&g->hud, &g->world, g->debug);       // UI never moves with camera
}`}
${bp(`If <code class="inl">GameUpdate</code> needs an <code class="inl">if (kind == OBJ_COIN)</code>, stop — that
rule belongs in World/actors. The coordinator routes; systems decide.`)}
`);

S(3, 'World Controller — The Simulation Owner', `
${lead(`<b>World</b> is the model: entities, the level, score/lives, timers. Its update is a fixed pipeline
of systems — readable at a glance, testable without a window.`)}
${c`
// src/world/World.h
#define MAX_OBJECTS 512

typedef struct LevelHeader {
    char  name[32];
    int   width, height;        // tile dims
    float tileSize;
    Rectangle bounds;           // world-space playfield
} LevelHeader;

typedef struct World {
    LevelHeader level;
    GameObject  objects[MAX_OBJECTS];
    int         objectCount;
    GameObject *player;         // points INTO objects[] — never freed!
    int   score, lives;
    float levelTime;
    bool  gameOver, won;
    // (Ch 5 adds tile grid; Ch 6 adds triggers & damage)
} World;

void  WorldInit(World *w, AssetManager *a);
void  WorldUpdate(World *w, float dt, AssetManager *a);`}
${c`
// src/world/World.c — the system pipeline IS the architecture
void WorldUpdate(World *w, float dt, AssetManager *assets) {
    w->levelTime += dt;

    SystemApplyGravity(w->objects, w->objectCount, dt);
    SystemIntegrateMotion(w->objects, w->objectCount, dt);  // pos += vel*dt
    SystemCollideWorldBounds(w);                            // Ch 6: AABBs
    SystemPlayerControl(w, dt);                             // input → player
    SystemCollectPickups(w, assets);                        // coins, feathers
    SystemCullDead(w);                                      // free slots
    if (w->player->tf.pos.y > w->level.bounds.height + 200)
        WorldKillPlayer(w);                                 // fell off
}`}
${note(`World has <b>no Draw function and no raylib drawing</b> — it may use raylib math/input types, but
drawing belongs to the renderer. Keep this line and you can unit-test gameplay headless (run
<code class="inl">WorldUpdate</code> 10,000 times in a CI test with synthetic input).`)}
${pit(`<code class="inl">GameObject *player</code> is a pointer <b>into</b> <code class="inl">objects[]</code>. If you
ever sort or realloc that array, the pointer dangles. Either re-find by id/kind each frame (cheap) or
store an index — never both conventions.`)}
`);

S(3, 'World Renderer — The View', `
${lead(`The renderer reads World + Assets + Camera and produces pixels. It owns <b>draw order</b> — the
single most under-designed aspect of 2D engines.`)}
${c`
// src/world/WorldRenderer.c
typedef enum {
    LAYER_SKY = 0,      // gradient + far parallax (Ch 8)
    LAYER_BACK,         // mountains, clouds
    LAYER_TERRAIN,      // tiles & platforms
    LAYER_PROPS,        // decorations behind actors
    LAYER_ACTORS,       // player, items, hazards
    LAYER_WATER,        // overlay in front (Ch 8)
    LAYER_FX,           // particles
    LAYER_COUNT
} RenderLayer;

static void DrawLayer(int layer, World *w, AssetManager *a, bool dbg) {
    for (int i = 0; i < w->objectCount; i++) {
        GameObject *g = &w->objects[i];
        if (!g->alive) continue;
        if (LayerOf(g->kind) != layer) continue;   // bin once per frame
        Rectangle src = g->ren.atlasRegion;
        if (g->ren.flipX) { src.width = -src.width; }  // mirror region
        Rectangle dst = { g->tf.pos.x, g->tf.pos.y,
                          fabsf(src.width)*g->ren.scale,
                          fabsf(src.height)*g->ren.scale };
        DrawTexturePro(a->atlas, src, dst,
                       (Vector2){dst.width/2, dst.height/2},  // center pivot!
                       0.0f, g->ren.tint);
        if (dbg) DrawRectangleRec(g->bounds.box,
                 (Color){255,80,80,(g->kind==OBJ_PLAYER?200:90)});
    }
}

void WorldDraw(WorldRenderer *r, World *w, VCamera *cam, float alpha, bool dbg){
    ClearBackground(COL_SKY_TOP);
    BeginMode2D(cam->cam);                 // camera transform ON
      for (int l = LAYER_SKY; l < LAYER_COUNT; l++)
          DrawLayer(l, w, &r->assetsRef, dbg);
    EndMode2D();                           // HUD draws OUTSIDE (Ch 5)
}`}
${bp(`Loop <b>layers outer, entities inner</b>. Iterating entities outer forces a layer check per sprite
<i>and</i> scatters your draw order; the layer loop makes order explicit, debuggable, and ready for
per-layer effects (parallax L 8, water L 8, transitions Ch 9).`)}
`);

S(3, 'The Game Loop: Fixed vs Variable Time', `
${lead(`The most consequential 20 lines in your engine. Choose wrong and physics jitters, replays desync,
and networking becomes impossible.`)}
${tbl(['Strategy', 'How it works', 'Pros', 'Cons'], [
  ['<b>Variable step</b>', '<code class="inl">update(GetFrameTime())</code> once per frame', 'Simple; 1:1 with frames', 'Different dt every frame → integration error; nondeterministic'],
  ['<b>Fixed step</b>', 'Accumulate time; run <code class="inl">update(FIXED_DT)</code> 0..N times', 'Deterministic sim, stable physics, replay/netcode-ready', 'Needs interpolation to look smooth; spiral-of-death guard'],
  ['<b>Semi-fixed</b>', 'Split big dt into ≤8ms chunks', 'Simple stability win for physics', 'Still nondeterministic']
])}
${diag(
`  render frame (60Hz)   ────────▶  next frame
  │                                    │
  ├── update(FIXED_DT)  16.6ms         │   1 tick/frame on 60Hz
  │                                    │   2 ticks/frame on 30Hz
  ├── update(FIXED_DT) ───… (catch-up) │   0 ticks on 144Hz some frames
  │                                    │
  └── draw(interpolate prev→curr) ◀────┘   alpha = accumulator / FIXED_DT`, 'Fixed step decouples SIMULATION RATE from FRAME RATE')}
${pit(`The <b>spiral of death</b>: if <code class="inl">update</code> costs 20ms and the tick is 16.6ms, the
accumulator grows every frame → more ticks → slower → more ticks… Cap catch-up ticks (we allow 5) and
clamp dt (Ch 2) so a stall becomes brief slow-motion, not a freeze.`)}
`);

S(3, 'Implementing the Fixed-Step Loop', `
${lead(`Here is the loop we ship with for the rest of the course — deterministic simulation, smooth
rendering, guarded against stalls.`)}
${c`
// src/main.c — fixed timestep with interpolation
#include "raylib.h"
#include "core/Game.h"

int main(void) {
    SetConfigFlags(FLAG_VSYNC_HINT);
    InitWindow(DESIGN_WIDTH, DESIGN_HEIGHT, "Canyon Hopper");
    SetTargetFPS(0);                        // vsync paces us

    static Game game;                       // static: outside hot-reload DLL
    GameInit(&game);

    double accumulator = 0.0;
    double prevTime = GetTime();

    while (!WindowShouldClose() && !game.quit) {
        // 1) clamp the frame delta (Ch 2 rule)
        double now = GetTime();
        double dt = now - prevTime;
        prevTime = now;
        if (dt > MAX_FRAME_SECONDS) dt = MAX_FRAME_SECONDS;

        // 2) consume time in FIXED_DT slices
        accumulator += dt;
        int ticks = 0;
        while (accumulator >= FIXED_DT && ticks < 5) {   // spiral guard
            GameUpdate(&game, FIXED_DT);       // ALL gameplay mutates here
            accumulator -= FIXED_DT;
            ticks++;
        }

        // 3) render with interpolation factor
        float alpha = (float)(accumulator / FIXED_DT);
        BeginDrawing();
            GameDraw(&game, alpha);            // views lerp prev→curr
        EndDrawing();
    }

    GameShutdown(&game);
    CloseWindow();
    return 0;
}`}
${bp(`Simplicity valve: if interpolation (next slide) is overkill for your jam game, draw current state
(<code class="inl">alpha=1</code>) — the loop stays correct. Add interpolation when 30Hz devices show
micro-stutter.`)}
`);

S(3, 'Interpolation: Making Fixed Steps Look Smooth', `
${lead(`At 60Hz frames + 60Hz ticks everything lines up — until a 144Hz monitor or a hitch. Then the
renderer displays state that is up to one tick old, and motion visibly stutters. The fix: remember
previous state, render the <b>blend</b>.`)}
${c`
// entities keep their previous position each tick
typedef struct CTransform {
    Vector2 pos, vel;
    Vector2 prevPos;               // snapshot BEFORE integrating
} CTransform;

void SystemIntegrateMotion(GameObject *arr, int n, float dt) {
    for (int i = 0; i < n; i++) {
        GameObject *g = &arr[i];
        if (!g->alive) continue;
        g->tf.prevPos = g->tf.pos;             // remember
        g->tf.pos = Vector2Add(g->tf.pos,
                               Vector2Scale(g->tf.vel, dt));
    }
}

// renderer draws the blend, not the raw state:
Vector2 RenderPos(const GameObject *g, float alpha) {
    return (Vector2){
        g->tf.prevPos.x + (g->tf.pos.x - g->tf.prevPos.x)*alpha,
        g->tf.prevPos.y + (g->tf.pos.y - g->tf.prevPos.y)*alpha
    };
}`}
${diag(
`  tick timeline:  P ──────▶ C ──────▶ (next)
                        ▲ alpha=0 → draw P (previous)
                        ▲ alpha=.5 → halfway
                        ▲ alpha=1 → C (current)
  frame lands at alpha = accumulator/FIXED_DT`, 'alpha measures "where between ticks are we"')}
${pit(`Interpolate <b>positions only</b>. Blending velocities, health, or &ldquo;collected&rdquo; flags makes no
sense and causes flicker (what is 50% of &ldquo;picked up&rdquo;?). Discrete events fire once, inside the tick.`)}
`);

S(3, 'Test Assets & Drawing Layers', `
${lead(`Before art exists, we prove the pipeline with <b>programmer placeholder art</b> — colored shapes
and generated textures. The renderer works day one; artists swap in later without code changes.`)}
${c`
// One-time dev asset: a checker "sprite sheet" standing in for the atlas
static Texture2D MakePlaceholderSheet(void) {
    Image img = GenImageColor(256, 64, BLANK);
    for (int y = 0; y < 4; y++)               // 4 rows × 8 frames of 32px
        for (int x = 0; x < 8; x++) {
            Color c = { (unsigned char)(60+x*24), (unsigned char)(80+y*44), 130, 255 };
            ImageDrawRectangle(&img, x*32, y*32, 30, 30, c);
        }
    Texture2D t = LoadTextureFromImage(img);
    UnloadImage(img);
    SetTextureFilter(t, TEXTURE_FILTER_POINT);   // pixel-art crispness
    return t;
}

// Mapping placeholder regions uses the SAME data path as real art:
coin.ren.atlasRegion   = (Rectangle){ 0,  0, 32, 32 };  // row 0
rock.ren.atlasRegion   = (Rectangle){ 0, 32, 32, 32 };  // row 1
player.ren.atlasRegion = (Rectangle){ 0, 64, 32, 32 };  // row 2`}
${tbl(['Placeholder', 'Stands for', 'Swap when'], [
  ['Colored rects/circles', 'Terrain, props', 'Tile atlas (Ch 5)'],
  ['Checker sheet regions', 'Animated sprites', 'Real sprite sheets (Ch 12)'],
  ['<code class="inl">DrawText</code> default font', 'HUD', '<code class="inl">LoadFontEx</code> pixel font (Ch 5)'],
  ['<code class="inl">SineWave</code> beeps', 'SFX', 'Real/generative SFX (Ch 10)']
])}
${bp(`Lock the <b>data contract</b> now (region rects, layer ids, sizes) and swap <i>content</i> freely.
The bug you avoid: art arrives and the pipeline refactors for a week.`)}
`);

S(3, 'Render Order & Draw State Discipline', `
${lead(`2D &ldquo;3D engine&rdquo; problems are ordering problems: what draws on top, in what blend mode, with
which texture. Formalize it and rendering stops being mysterious.`)}
${c`
// WorldDraw — the full frame with explicit state phases
void WorldDraw(WorldRenderer *r, World *w, VCamera *cam, float a, bool dbg) {
    ClearBackground(COL_SKY_TOP);

    // Phase 1: sky gradient — not even in camera space
    DrawRectangleGradientV(0, 0, GetScreenWidth(), GetScreenHeight()/2,
                           COL_SKY_TOP, COL_SKY_BOT);

    BeginMode2D(cam->cam);
      DrawParallax(r, cam);                  // LAYER_SKY/BACK (Ch 8 math)

      rlSetBlendMode(BLEND_ALPHA);           // standard alpha world
      for (int l = LAYER_TERRAIN; l <= LAYER_ACTORS; l++)
          DrawLayer(l, w, &r->assetsRef, a, dbg);

      rlSetBlendMode(BLEND_ADDITIVE);        // glow pass!
      DrawLayer(LAYER_FX_GLOW, w, &r->assetsRef, a, false);

      rlSetBlendMode(BLEND_ALPHA);           // restore BEFORE water/UI
      DrawLayer(LAYER_WATER, w, &r->assetsRef, a, false);
    EndMode2D();
}`}
${tbl(['Rule', 'Why'], [
  ['Group by blend mode', 'Every <code class="inl">rlSetBlendMode</code> can flush the batch (Ch 1)'],
  ['Camera-space inside <code class="inl">BeginMode2D</code>, screen-space outside', 'HUD scrolling with the world = amateur hour giveaway'],
  ['Debug draw LAST, own blend', 'Bounds boxes must never hide behind sprites'],
  ['One atlas per layer pass', 'Texture switches are the #1 silent batch breaker']
])}
${pit(`<code class="inl">BLEND_ADDITIVE</code> left on through your UI pass makes every menu glow and text
bake into the background. Always restore <code class="inl">BLEND_ALPHA</code> immediately after a glow pass —
treat blend modes like <code class="inl">malloc</code>: acquire and release in the same function.`)}
`);

S(3, 'Debug Controls — Build Them Now', `
${lead(`Debug tooling is a <b>day-one feature</b>, not a luxury: toggles, overlays, and a free camera
halve your bug-hunting time for the rest of the course.`)}
${c`
// src/core/Game.c — the debug block grows every chapter
void GameUpdate(Game *g, float dt) {
    if (IsKeyPressed(KEY_F1)) g->debug = !g->debug;
    if (IsKeyPressed(KEY_F2)) g->timeScale = (g->timeScale==1.f)?0.25f:1.f;
    if (IsKeyPressed(KEY_F3)) g->stepOnce = true;         // frame-step
    if (IsKeyPressed(KEY_F4)) WorldReload(&g->world);     // Ch 5 hot reload
    // ...
    float simDt = dt * g->timeScale;
    if (g->paused && g->stepOnce) { simDt = FIXED_DT; g->stepOnce = false; }
    if (IsKeyPressed(KEY_P)) g->paused = !g->paused;

    WorldUpdate(&g->world, simDt, &g->assets);
}

void GameDrawDebug(Game *g) {               // screen-space, top-left stack
    int y = 28;
    DrawText(TextFormat("FPS %d", GetFPS()), 12, y, 18, LIME); y+=22;
    DrawText(TextFormat("objects %d/%d", g->world.objectCount,
             MAX_OBJECTS), 12, y, 18, LIME); y+=22;
    DrawText(TextFormat("player %.0f,%.0f  vel %.0f,%.0f",
             g->world.player->tf.pos.x, g->world.player->tf.pos.y,
             g->world.player->tf.vel.x, g->world.player->tf.vel.y),
             12, y, 18, LIME); y+=22;
    DrawText(TextFormat("score %d  lives %d  t %.1f",
             g->world.score, g->world.lives, g->time), 12, y, 18, LIME);
}`}
${tbl(['Key', 'Feature', 'Pays off'], [
  [kbd('F1'), 'Debug overlay on/off', 'Release builds ship without it'],
  [kbd('F2'), 'Slow-mo (timeScale)', 'Watch collision frames'],
  [kbd('P') + ' ' + kbd('F3'), 'Pause + frame step', 'Nail one-frame bugs'],
  [kbd('F4'), 'Reload level', 'Level-editing loop (Ch 5)']
])}
${bp(`<b>timeScale</b> multiplies dt before update — nothing else changes. Do not implement slow-mo by
changing <code class="inl">SetTargetFPS</code>: that also slows input polling and animations differently.`)}
`);

S(3, 'The Virtual Camera: Camera2D Essentials', `
${lead(`The <code class="inl">Camera2D</code> is four numbers that transform world → screen. Master the
mental model once; every 2D effect after this is arithmetic on these four.`)}
${c`
// raylib's Camera2D — the entire structure:
Camera2D cam = {
    .target   = (Vector2){ 600, 300 }, // world point at the screen anchor
    .offset   = (Vector2){ 640, 360 }, // screen anchor (center for our size)
    .rotation = 0.0f,                  // degrees (we rarely rotate)
    .zoom     = 1.0f                   // 2 = half world visible, pixel-doubled
};

BeginMode2D(cam);
    // everything here draws in WORLD coordinates:
    DrawCircle(600, 300, 20, RED);     // appears exactly at screen center
EndMode2D();

// Convert between spaces when needed (picking, UI anchoring):
Vector2 scr = GetWorldToScreen2D(worldPoint, cam);   // world → screen
Vector2 wld = GetScreenToWorld2D(GetMousePosition(), cam); // mouse → world`}
${diag(
`   world coords                     screen coords
   (0,0)─────▶ x                    (0,0)─────▶ x
     │                                │
     │   target ●───────────┶offset┶──┼─▶ target lands ON offset
     ▼ y                              ▼ y
   zoom scales AROUND the target point`, 'target: where the camera looks · offset: where that lands on screen')}
${bp(`Set <code class="inl">offset</code> to the screen center (<code class="inl">{W/2, H/2}</code>) so the
player is centered, or lower (<code class="inl">{W/2, H*0.62}</code>) for classic platformer framing — more
sky less floor… or more floor ahead of falls. One number, big feel change.`)}
`);

S(3, 'Camera Utility: Smooth Tracking (Lerp)', `
${lead(`Snapping the camera to the player every tick reads as robotic. A <b>critically-smoothed follow</b>
(either exponential smoothing or frame-rate-independent lerp) is the industry default.`)}
${c`
// src/util/VCamera.c — our camera utility module
typedef struct VCamera {
    Camera2D  cam;
    Rectangle worldBounds;     // clamp limits
    float     followLerp;      // 0=frozen, 1=glued
    bool      locked;          // cutscenes / death (Ch 6)
    Vector2   shakeOffset;     // Ch 8 screenshake lands here
} VCamera;

// FRAME-RATE INDEPENDENT smoothing — the formula that works at any FPS:
static Vector2 Damp(Vector2 a, Vector2 b, float lambda, float dt) {
    float t = 1.0f - expf(-lambda * dt);       // exponential decay
    return (Vector2){
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t
    };
}

void VCamFollow(VCamera *vc, Vector2 focus, float dt) {
    if (vc->locked) return;
    // Lead the target slightly: camera settles AHEAD of motion
    focus.y -= 40.0f;                          // bias skyward a touch
    vc->cam.target = Damp(vc->cam.target, focus, 6.0f /*lambda*/, dt);
}`}
${tbl(['lambda', 'Feel'], [
  ['2–3', 'Floaty, cinematic — big levels, exploration'],
  ['5–8', 'Platformer standard — snappy but alive <b>(we ship 6)</b>'],
  ['12+', 'Nearly glued — action games, twin-sticks'],
  ['lerp t = 0.1/frame', '<b>WRONG</b> — speed varies with FPS (classic bug)']
])}
${pit(`Naive <code class="inl">pos += (target-pos)*0.1f</code> per <b>frame</b> is FPS-dependent: at 144Hz it
converges 2.4× faster than at 60Hz. Use the <code class="inl">1-exp(-λdt)</code> form above — same feel on every
device (Ch 8 formalizes this as easing/damping).`)}
`);

S(3, 'Camera Utility: Bounds Clamping', `
${lead(`The camera must never show space <b>outside the level</b> — black voids break immersion instantly.
Clamping is four <code class="inl">if</code>s once you derive the view rect.`)}
${c`
void VCamClamp(VCamera *vc) {
    // Half-view size in world units (what zoom shows around target):
    float halfW = (DESIGN_WIDTH  / 2.0f) / vc->cam.zoom;
    float halfH = (DESIGN_HEIGHT / 2.0f) / vc->cam.zoom;
    Rectangle b = vc->worldBounds;

    // If the level is SMALLER than the view, center it instead of clamping
    if (b.width  < halfW*2) vc->cam.target.x = b.x + b.width/2;
    else vc->cam.target.x = Clamp(vc->cam.target.x, b.x + halfW,
                                              b.x + b.width  - halfW);
    if (b.height < halfH*2) vc->cam.target.y = b.y + b.height/2;
    else vc->cam.target.y = Clamp(vc->cam.target.y, b.y + halfH,
                                              b.y + b.height - halfH);
}

// Clamp from raymath (write it once yourself if you like):
// float Clamp(float v, float lo, float hi){ return v<lo?lo:(v>hi?hi:v); }`}
${diag(
`  worldBounds
  ┌────────────────────────────────┐
  │        ┌─view─┐                │   target clamped so the
  │        │  ◉   │                │   view rect never leaves
  │        └──────┘                │   the bounds on any axis
  └────────────────────────────────┘
  small level? ──▶ center lock (no clamping jitter)`, 'The view rectangle must stay inside the world')}
${bp(`Clamp <b>after</b> smoothing, <b>before</b> drawing — order matters:
<code class="inl">VCamFollow → VCamClamp → BeginMode2D</code>. Clamping before damping lets smoothing fight
the walls and vibrate at level edges.`)}
`);

S(3, 'Camera Utility: Zoom & Screenshake Hooks', `
${lead(`Zoom and shake are the two camera &ldquo;moods&rdquo; you will wire to gameplay events (Ch 6 deaths, Ch 8
impacts). Both are tiny — if they live in one place.`)}
${c`
// Zoom toward a focus point (scroll wheel dev feature; Ch 11 pinch):
void VCamZoom(VCamera *vc, float factor, Vector2 worldFocus) {
    float oldZoom = vc->cam.zoom;
    vc->cam.zoom = Clamp(vc->cam.zoom * factor, 0.5f, 3.0f);
    // keep the point under the cursor stable while zooming:
    Vector2 before = GetScreenToWorld2D(GetMousePosition(), vc->cam);
    vc->cam.zoom = oldZoom;                       // recompute delta properly
    Vector2 after  = GetScreenToWorld2D(GetMousePosition(), vc->cam);
    // (full anchor math elided; principle: adjust target by after-before)
    vc->cam.target = Vector2Add(vc->cam.target, Vector2Subtract(after, before));
}

// Screenshake: decaying random offset — Ch 8 drives it from impacts
void VCamAddShake(VCamera *vc, float strength) {
    vc->shakeAmount = fmaxf(vc->shakeAmount, strength);
}
void VCamUpdateShake(VCamera *vc, float dt) {
    vc->shakeAmount *= expf(-8.0f * dt);          // exponential decay
    float s = vc->shakeAmount;
    vc->shakeOffset = (Vector2){
        GetRandomValue(-100,100)/100.0f * s,
        GetRandomValue(-100,100)/100.0f * s };
    // applied at draw time: cam.target + shakeOffset inside BeginMode2D
}`}
${tbl(['Effect', 'Trigger (later chapters)', 'Params'], [
  ['Zoom punch (1.0→1.06→1.0)', 'Coin streaks, power-up (Ch 8/12)', 'Amplitude, decay λ'],
  ['Screenshake', 'Rock impact, player hit (Ch 6/8)', 'Strength 2–8px, decay ~8/s'],
  ['Camera lock', 'Death, cutscene (Ch 6/12)', '<code class="inl">locked</code> flag stops follow']
])}
${pit(`Apply shake to <code class="inl">target</code>, never to the <b>player position</b>. Shaking world state
jitters physics; shaking the camera shakes only the view. And keep shake ≤8px + ≤0.3s — it is seasoning,
not the meal.`)}
`);

S(3, 'Wiring It Together: The Frame, End to End', `
${lead(`Let's trace one frame through everything this chapter built — the diagram you should be able to
redraw from memory.`)}
${diag(
` main loop (fixed step, 60Hz ticks)
 │
 ├─▶ GameUpdate(FIXED_DT)
 │     ├─ input: ActionPressed/Down  (Ch 2 map)
 │     ├─ WorldUpdate
 │     │    ├ SystemApplyGravity
 │     │    ├ SystemIntegrateMotion (prevPos snapshot)
 │     │    ├ SystemPlayerControl
 │     │    └ SystemCullDead …
 │     ├─ VCamFollow(player) → damp(λ=6)
 │     └─ VCamClamp(worldBounds)
 │
 └─▶ GameDraw(alpha)
       ├─ ClearBackground + sky (screen space)
       ├─ BeginMode2D(cam + shakeOffset)
       │    ├ parallax layers (Ch 8)
       │    ├ LAYER_TERRAIN → ACTORS (interp positions!)
       │    ├ additive FX pass
       │    └ water overlay
       ├─ EndMode2D
       ├─ HUD (screen space, Ch 5)
       └─ debug overlay if g->debug`, 'One frame, every arrow owned by exactly one module')}
${c`
// The whole main loop fit for a slide — nothing hidden:
while (!WindowShouldClose() && !game.quit) {
    dt = ClampFrameDelta(GetTime() - prev); prev = GetTime();
    accumulator += dt;
    while (accumulator >= FIXED_DT && ticks < 5) {
        GameUpdate(&game, FIXED_DT);
        accumulator -= FIXED_DT; ticks++;
    }
    BeginDrawing();
        GameDraw(&game, (float)(accumulator / FIXED_DT));
    EndDrawing();
}`}
${bp(`If you can narrate this diagram out loud — who owns input, who owns state, who owns pixels —
you have internalized more engine architecture than most tutorials ever teach.`)}
`);

S(3, 'Chapter 3 Summary — Key Takeaways', `
${lead(`Canyon Hopper now has a skeleton with joints: structure, patterns, loop, and camera.`)}
<ul class="check">
  <li>Folder + prefix discipline (<code class="inl">world/</code>, <code class="inl">core/</code>, …) is cheap and pays forever.</li>
  <li><b>EC as data + system loops</b>; <b>MVC-ish split</b>: World (model) — WorldRenderer (view) — input/controllers.</li>
  <li><code class="inl">Game</code> coordinates; subsystems implement. Ownership mirrors init/shutdown order.</li>
  <li><b>Fixed timestep + accumulator + interpolation</b>; spiral-guard and dt clamp included.</li>
  <li>Layers outer loop in the renderer; blend modes acquired/released in-function.</li>
  <li>Debug overlay, slow-mo, frame-step from day one.</li>
  <li>Camera: center offset, <code class="inl">1-exp(-λdt)</code> damping, bounds clamp after smoothing, shake on view not state.</li>
</ul>
<h3>Carrying forward</h3>
<p>The placeholder checker sheet did its job — Chapter 4 replaces it with a <b>real asset pipeline</b>:
icons, atlases, an AssetManager with async loading, and level data formats.</p>
${bp(`Checkpoint: run the game; F1 shows the debug overlay; the camera follows the placeholder bunny
smoothly, clamps at level edges, and survives window resize. You have an engine — everything else is
content.`)}
`);
