/* Chapter 5 — Making a Scene */
defChapter(5, {
  tag: 'World Building',
  title: 'Making a Scene',
  sub: 'Static and dynamic entities, the level loader, layered efficient rendering, and the game HUD with responsive scaling.',
  color: '#f472b6',
  topics: ['Static vs dynamic entities', 'Terrain, backgrounds, water & props', 'The LevelLoader pipeline',
    'Layering & efficient world rendering', 'HUD: score, lives, FPS monitor', 'Real-time layout scaling']
});

SEC(5);

S(5, 'Static vs Dynamic — Two Kinds of Scene Things', `
${lead(`A level is made of exactly two species: things that <b>never change</b> during play (terrain,
decor) and things that <b>simulate</b> (player, items, hazards). Treating them differently is the
beginning of a real engine.`)}
${tbl(['Aspect', 'Static world', 'Dynamic actors'], [
  ['Storage', 'Tile grid (int array)', '<code class="inl">GameObject</code> array'],
  ['Collision', 'Solid tiles merged into boxes (this chapter)', 'Per-entity AABB (Ch 6)'],
  ['Drawn', 'Only visible tiles, one atlas pass', 'Layer-binned per entity'],
  ['Changes', 'Only on reload / destruction (Ch 11)', 'Every tick (positions, anim, state)'],
  ['Count', 'Hundreds–thousands', 'Dozens–hundreds'],
  ['Culling', 'Camera rect vs grid range', 'Cheap distance check']
])}
${diag(
`  LEVEL FILE (Ch 4)                     WORLD (runtime)
  ┌───────────────┐   LevelLoader    ┌────────────────────────┐
  │ terrain[]     │ ───────────────▶ │ solidBoxes[]  (static) │
  │ decor[]       │ ───────────────▶ │ decor list    (static) │
  │ objects[]     │ ───────────────▶ │ objects[]     (dynamic)│
  │ theme         │ ───────────────▶ │ renderer config        │
  └───────────────┘   parse ONCE     └────────────────────────┘`, 'The loader is a translation layer, not magic')}
${bp(`Resist putting tiles in the entity array &ldquo;for uniformity&rdquo;: a 60×14 level = 840 entities where
~30 solid boxes would do. Uniformity is a memory and cache tax you pay every frame.`)}
`);

S(5, 'Terrain: The Tile Grid', `
${lead(`Tiles are the level's atoms: small, uniform, reusable. We keep the raw grid (for cheap lookups
and editing) <b>and</b> derive merged collision boxes (for fast physics).`)}
${c`
// src/world/TileGrid.h
typedef enum { TILE_EMPTY = 0, TILE_GROUND, TILE_GRASS_TOP,
               TILE_STONE, TILE_SPIKE } TileId;

typedef struct TileGrid {
    int  *cells;             // width*height, row-major
    int   width, height;
    float tileSize;
} TileGrid;

// O(1) lookup — THE reason grids beat entity lists for terrain:
TileId TileAt(const TileGrid *g, int tx, int ty) {
    if (tx < 0 || ty < 0 || tx >= g->width || ty >= g->height)
        return TILE_STONE;               // outside = solid wall (bounds!)
    return (TileId)g->cells[ty * g->width + tx];
}

// world-space helpers used by physics every tick:
TileId TileAtWorld(const TileGrid *g, Vector2 wp) {
    return TileAt(g, (int)(wp.x / g->tileSize), (int)(wp.y / g->tileSize));
}
Rectangle TileRect(const TileGrid *g, int tx, int ty) {
    return (Rectangle){ (float)tx * g->tileSize, (float)ty * g->tileSize,
                        g->tileSize, g->tileSize };
}`}
${c`
// Merging horizontal runs of solid tiles into fewer boxes (greedy):
void BuildSolidBoxes(const TileGrid *g, Rectangle *out, int *count) {
    int n = 0;
    for (int ty = 0; ty < g->height; ty++) {
        int runStart = -1;
        for (int tx = 0; tx <= g->width; tx++) {
            bool solid = (tx < g->width) &&
                         TileIsSolid(TileAt(g, tx, ty));
            if (solid && runStart < 0) runStart = tx;
            if (!solid && runStart >= 0) {         // close the run
                out[n++] = (Rectangle){ (float)runStart * g->tileSize,
                                        (float)ty * g->tileSize,
                                        (float)(tx - runStart) * g->tileSize,
                                        g->tileSize };
                runStart = -1;
            }
        }
    }
    *count = n;   // 840 tiles ≈ 30 boxes — Ch 6 physics loops love this
}`}
${pit(`Out-of-bounds must return <b>solid</b> (walls), not empty — otherwise a fast-falling entity
<code class="inl">TileAt</code> below the map reads EMPTY and your player escapes the level through the
floor of an unindexed array access. One <code class="inl">if</code>, both bugs gone.`)}
`);

S(5, 'Rendering the Tilemap (Only What Is Visible)', `
${lead(`A 60×14 level is 840 draw calls if naive. With camera-range culling it is ~2× visible tiles ≈
60 — and all from the atlas, so one batch.`)}
${c`
// src/world/WorldRenderer.c — terrain pass
static void DrawTerrain(World *w, AssetManager *a) {
    const TileGrid *g = &w->tiles;
    Texture2D atlas = a->atlas;

    // 1) which tiles can possibly be on screen?
    Camera2D cam = w->camRef->cam;
    Vector2 tl = GetScreenToWorld2D((Vector2){0,0}, cam);
    Vector2 br = GetScreenToWorld2D((Vector2){
        (float)GetScreenWidth(), (float)GetScreenHeight()}, cam);
    int x0 = (int)(tl.x / g->tileSize), x1 = (int)(br.x / g->tileSize) + 1;
    int y0 = (int)(tl.y / g->tileSize), y1 = (int)(br.y / g->tileSize) + 1;
    x0 = Imax(x0, 0); y0 = Imax(y0, 0);          // clamp to grid
    x1 = Imin(x1, g->width - 1); y1 = Imin(y1, g->height - 1);

    // 2) draw the visible window only
    for (int ty = y0; ty <= y1; ty++)
        for (int tx = x0; tx <= x1; tx++) {
            TileId t = TileAt(g, tx, ty);
            if (t == TILE_EMPTY) continue;
            Rectangle src = AssetsRegion(a, TileSpriteName(t)); // atlas
            Vector2 pos = { (float)tx * g->tileSize,
                            (float)ty * g->tileSize };
            DrawTextureRec(atlas, src, pos, WHITE);
        }
}`}
${tbl(['Level size', 'Naive draws', 'Culled draws', 'Note'], [
  ['60×14 (course)', '840', '~60', 'Both fine — culling habit still pays'],
  ['200×50', '10,000', '~60', 'Naive = frame budget gone'],
  ['1000×200 streamed', '200,000', '~60', 'Culling + chunked loading (pro level)']
])}
${bp(`Culling is <b>four divisions and a double loop</b> — no spatial structure needed for tiles because
the grid IS the spatial structure. The uniform tile size makes the math free.`)}
`);

S(5, 'Background Layers & Sky Composition', `
${lead(`Depth in 2D is a stack of planes: sky gradient, far mountains, near hills, clouds. Each is a
strip drawn with its own parallax factor — full math lands in Chapter 8; today we build the structure.`)}
${c`
// src/world/Backdrop.c — layered background, camera-aware
typedef struct Backdrop {
    Texture2D sky, mountains, hills, clouds;
    float parMountains, parHills, parClouds;   // 0=fixed, 1=world speed
    float cloudScroll;                          // auto-drift even when idle
} Backdrop;

void BackdropDraw(Backdrop *b, Camera2D cam, float dt) {
    // SKY: screen-space gradient, ignores camera entirely
    DrawRectangleGradientV(0, 0, GetScreenWidth(), GetScreenHeight(),
                           COL_SKY_TOP, COL_SKY_BOT);

    // MOUNTAINS: drawn in world space but scaled by parallax factor:
    //  perceived position = camera.target * factor  (Ch 8 derives this)
    Vector2 m = { cam.target.x * b->parMountains * -1.0f, 0 };
    DrawTextureRec(b->mountains,
        (Rectangle){ -m.x*0.5f, 0, (float)b->mountains.width*4,
                     (float)b->mountains.height*4 },
        (Vector2){0, GetScreenHeight()*0.35f}, Fade(WHITE, 0.9f));

    b->cloudScroll += 8.0f * dt;               // idle motion = "alive"
    // hills + clouds similar with stronger/weaker factors…
}`}
${diag(
`  ┌ SKY ────────── parallax 0.0 (screen-fixed)
  ├ MOUNTAINS ──── parallax 0.2 (barely moves)
  ├ CLOUDS ─────── parallax 0.4 + self-drift
  ├ HILLS ──────── parallax 0.7
  ├ TERRAIN+ACTORS  parallax 1.0 (true world)
  └ WATER OVERLAY    parallax 1.0 + own wave anim (next slides)`, 'The depth sandwich — order IS depth in 2D')}
${bp(`Draw backdrops <b>before</b> <code class="inl">BeginMode2D</code> using the camera only as data
(<code class="inl">cam.target.x * factor</code>). Putting them inside camera space makes raylib do the
transform — then you cannot slow them down. Control the math, control the depth.`)}
`);

S(5, 'The Water Overlay', `
${lead(`Water is drawn <b>over</b> the world with alpha — and its surface moves. Two effects: a sine-waved
top edge and a scrolling highlight, both from Chapter 2's clock.`)}
${c`
// src/world/Water.c — semi-transparent animated overlay
typedef struct Water {
    Rectangle area;         // world-space rect the water fills
    Color     tint;
    float     waveAmp, waveLen, waveSpeed, scroll;
} Water;

void WaterDraw(const Water *w, float time) {
    // 1) body: plain translucent rect (cheap, covers actors → "submerged" feel)
    DrawRectangleRec((Rectangle){ w->area.x, w->area.y + 6,
        w->area.width, w->area.height - 6 }, (Color){40,110,220,110});

    // 2) surface: sine ribbon of quads along the top edge
    const float step = 8.0f;
    for (float x = w->area.x; x < w->area.x + w->area.width; x += step) {
        float phase = (x / w->waveLen + time * w->waveSpeed);
        float y = w->area.y + sinf(phase) * w->waveAmp;
        DrawRectangleRec((Rectangle){ x, y, step + 1, 10 },
                         (Color){150,210,255,150});   // +1 hides seams
    }
    // 3) sparkles: two rows of dashes scrolling opposite directions
    w->scroll; // advanced by caller with dt
    for (int i = 0; i < 20; i++) {
        float sx = w->area.x + fmodf(i*61.0f + time*30.0f, w->area.width);
        DrawRectangleRec((Rectangle){ sx, w->area.y + 14, 12, 2 },
                         (Color){255,255,255, 90});
    }
}`}
${note(`Buoyancy — objects bobbing and floating in this water — is Chapter 8's fluid dynamics module. The
draw layer exists now so actors can be <i>sorted behind</i> it; gameplay comes later.`)}
${pit(`Wave seams: if adjacent wave segments use different <code class="inl">phase</code> inputs (e.g. x from
a moving camera vs world), the surface tears. Compute phase from <b>world x only</b> — waves must live in
world space or they visibly &ldquo;swim&rdquo; when the camera moves.`)}
`);

S(5, 'Environmental Props & Decor Layer', `
${lead(`Props (grass tufts, rocks, cacti, signs) sell the theme. They are static, non-colliding, and
<b>cheap by design</b>: region + position, drawn in one pass between terrain and actors.`)}
${c`
// Loaded from the level's "decor" layer (Ch 4 schema):
typedef struct Prop {
    Rectangle region;       // atlas sprite
    Vector2   pos;
    float     scale;
    bool      behindActors; // some props draw in FRONT (LAYER_PROPS_FRONT)
} Prop;

static void DrawProps(const Prop *p, int n, Texture2D atlas,
                      bool front, int x0px, int x1px) {
    for (int i = 0; i < n; i++) {
        // decor culling: a single x-range test (props never leave their spot)
        if (p[i].behindActors != front) continue;
        if (p[i].pos.x < x0px - 64 || p[i].pos.x > x1px + 64) continue;
        Rectangle dst = { p[i].pos.x, p[i].pos.y,
            p[i].region.width * p[i].scale, p[i].region.height * p[i].scale };
        DrawTexturePro(atlas, p[i].region, dst,
                       (Vector2){0, dst.height},   // pivot: bottom-center → "planted"
                       0.0f, WHITE);
    }
}`}
${tbl(['Prop role', 'Layer', 'Example'], [
  ['Grounding', 'behind actors', 'Grass, flowers, pebbles'],
  ['Framing', 'in front', 'Foreground bushes, hanging vines'],
  ['Landmarks', 'behind', 'Big canyon arches (also wayfinding!)'],
  ['Story', 'either', 'Signs with hints (text via Ch 5 fonts)']
])}
${bp(`Bottom-center pivot makes placement in the level editor trivial: one (x,y) on the ground line
places any prop correctly regardless of sprite height. Small convention, huge editing win.`)}
`);

S(5, 'The LevelLoader — Design & Pipeline', `
${lead(`The loader is a pure function: <code class="inl">LevelData → World</code>. No drawing, no input — it
translates Ch 4's parsed JSON into runtime structures and <b>validates as it goes</b>.`)}
${diag(
`  level_01.json ──cJSON──▶ LevelData ──LevelLoader──▶ World
   (disk text)             (generic)                 (game structs)
                                                   ├ tiles (TileGrid)
                                                   ├ solidBoxes[]
                                                   ├ objects[]  ◀─ SPAWN TABLE
                                                   ├── decor/props
                                                   └ water/backdrop cfg
  Failure modes handled:
   · missing file ─────▶ TRACE error, return false (caller shows message)
   · bad version ──────▶ migrate or reject, never guess
   · unknown obj type ─▶ skip + WARN with line context
   · player missing ────▶ hard error: level is unplayable`, 'Translation + validation, one responsibility')}
${c`
// src/world/LevelLoader.h
bool LevelLoad(World *w, AssetManager *a, const char *path);
//  └─ resets World, fills everything, returns false + log on failure

bool LevelReload(World *w, AssetManager *a);   // same path again (F4 hot reload)
//  └─ PRESERVES score/lives: reload = world layout, not game progress`}
${bp(`Keep <b>progress separate from layout</b> (<code class="inl">score/lives</code> live in World but the
loader never touches them — Ch 4 slide). Then F4-reload and death-restart share 95% of code and artists
iterate instantly.`)}
`);

S(5, 'LevelLoader Implementation — Terrain & Statics', `
${lead(`Part 1: build the grid, derive collision boxes, spawn decor. Straight-line code a tester can
step through — loaders should be the <b>most boring</b> module you own.`)}
${c`
// src/world/LevelLoader.c — part 1 of 2
bool LevelLoad(World *w, AssetManager *a, const char *path) {
    LevelData d;
    if (!LevelParse(path, &d)) return false;            // Ch 4 parser

    // ---------- reset (progress fields survive) ----------
    int score = w->score, lives = w->lives;
    memset(w, 0, sizeof *w);
    w->score = score; w->lives = lives;

    // ---------- tiles ----------
    w->tiles = (TileGrid){ calloc((size_t)d.width*d.height, sizeof(int)),
                           d.width, d.height, (float)d.tileSize };
    memcpy(w->tiles.cells, d.terrain,
           (size_t)d.width * d.height * sizeof(int));
    snprintf(w->level.name, 32, "%s", d.name);

    // static collision boxes (merged runs — terrain slide)
    w->solidCount = 0;
    BuildSolidBoxes(&w->tiles, w->solidBoxes, &w->solidCount);

    // world bounds → camera clamp (Ch 3)
    w->bounds = (Rectangle){ 0, 0,
        (float)d.width * d.tileSize, (float)d.height * d.tileSize };

    // ---------- decor layer ----------
    for each decor id → w->props[w->propCount++] = MakeProp(id, &d);

    // ---------- theme → renderer config ----------
    WorldApplyTheme(w, &d);      // sky colors, water on/off, parallax count

    // part 2 (next slide): dynamic objects via the spawn table
    bool ok = LevelSpawnObjects(w, a, &d);

    LevelDataFree(&d);           // JSON world is dead; World owns its copies
    TraceLog(LOG_INFO, "[LEVEL] '%s': %d boxes, %d objects",
             w->level.name, w->solidCount, w->objectCount);
    return ok && (w->player != NULL);   // no player = unplayable level
}`}
${pit(`The <code class="inl">memset</code> reset is powerful and dangerous — any <b>pointer</b> you stash in
World must be NULL-ed and freed BEFORE the memset (tiles.cells of the previous level!). Free-then-reset,
always in that order.`)}
`);

S(5, 'LevelLoader Implementation — The Spawn Table', `
${lead(`Part 2: turning <code class="inl">{"type":"coin","x":7,"y":10}</code> into a live entity. The trick
that keeps this maintainable: a <b>factory table</b> — data, not a switch statement that grows forever.`)}
${c`
// A spawn function: fills one GameObject from a definition
typedef void (*SpawnFn)(GameObject *g, const GameObjectDef *def,
                        AssetManager *a);

typedef struct {
    const char *type;        // matches level JSON "type"
    SpawnFn     spawn;
    int         layer;       // render layer (Ch 3)
} SpawnEntry;

// THE table — adding a new entity type = one row + one function. That's it.
static const SpawnEntry SPAWN_TABLE[] = {
    { "player",    SpawnPlayer,  LAYER_ACTORS },
    { "coin",      SpawnCoin,    LAYER_ACTORS },
    { "feather",   SpawnFeather, LAYER_ACTORS },
    { "rock",      SpawnRock,    LAYER_ACTORS },
    { "porcupine", SpawnPorcupine, LAYER_ACTORS },
    { "goal",      SpawnGoal,    LAYER_ACTORS },
};

static bool LevelSpawnObjects(World *w, AssetManager *a, LevelData *d) {
    for (int i = 0; i < d->objCount; i++) {
        const GameObjectDef *def = &d->objs[i];
        const SpawnEntry *e = NULL;
        for (unsigned t = 0; t < ARRAY_LEN(SPAWN_TABLE); t++)
            if (strcmp(SPAWN_TABLE[t].type, def->type) == 0) { e = &SPAWN_TABLE[t]; break; }

        if (!e) { TraceLog(LOG_WARNING,
                   "[LEVEL] unknown type '%s' skipped", def->type); continue; }

        if (w->objectCount >= MAX_OBJECTS) { TraceLog(LOG_WARNING,
                   "[LEVEL] object budget full"); break; }

        GameObject *g = &w->objects[w->objectCount++];
        memset(g, 0, sizeof *g);
        g->alive = true; g->kind = KindOf(e->type);
        g->tf.pos = (Vector2){ (float)def->x, (float)def->y };
        e->spawn(g, def, a);                 // fill region/bounds/rules
        if (g->kind == OBJ_PLAYER) w->player = g;
    }
    return w->objectCount > 0;
}

// Example spawn functions are tiny and data-shaped:
static void SpawnCoin(GameObject *g, const GameObjectDef *d, AssetManager *a) {
    g->ren.atlasRegion = AssetsRegion(a, "coin_0");
    g->bounds.box = (Rectangle){ g->tf.pos.x, g->tf.pos.y, 28, 28 };
}`}
${bp(`The factory-table pattern scales from 6 entity types (course) to 60 (studio) without becoming a
2,000-line switch. It is also the seam where Ch 11's &ldquo;editor-authored entities&rdquo; plug in.`)}
`);

S(5, 'Assembling the World Draw Pass', `
${lead(`Everything from this chapter now composes into one ordered frame. This function is the
course's renderer centerpiece — study the order until it is boring.`)}
${c`
// src/world/WorldRenderer.c — full world pass (called inside GameDraw)
void WorldDraw(WorldRenderer *r, World *w, VCamera *vc,
               AssetManager *a, float alpha, bool debug) {
    Backdrop *bd = &r->backdrop;
    Water    *wt = &r->water;

    // ---- screen space: sky ----
    BackdropDrawSky(bd);

    // ---- world space ----
    BeginMode2D(vc->cam);
      BackdropDrawParallax(bd, vc->cam);              // mountains/clouds

      DrawTerrain(w, a);                              // LAYER_TERRAIN
      DrawProps(w->props, w->propCount, a->atlas, false, vc->viewX0, vc->viewX1);

      rlSetBlendMode(BLEND_ALPHA);                    // actor pass
      for (int i = 0; i < w->objectCount; i++) {      // LAYER_ACTORS
          GameObject *g = &w->objects[i];
          if (!g->alive || LayerOf(g->kind) != LAYER_ACTORS) continue;
          Vector2 rp = RenderPos(g, alpha);           // Ch 3 interpolation
          Rectangle src = g->ren.atlasRegion;
          Rectangle dst = { rp.x, rp.y,
              fabsf(src.width)*g->ren.scale, fabsf(src.height)*g->ren.scale };
          DrawTexturePro(a->atlas, src, dst, (Vector2){dst.width/2, dst.height/2},
                         0.0f, g->ren.tint);
      }

      if (wt->enabled) WaterDraw(wt, w->time);        // LAYER_WATER
      DrawProps(w->props, w->propCount, a->atlas, true, vc->viewX0, vc->viewX1);

      if (debug) {                                    // debug LAST over world
          for (int i = 0; i < w->solidCount; i++)
              DrawRectangleRec(w->solidBoxes[i], (Color){255,255,0,60});
      }
    EndMode2D();
}`}
${bp(`Run through the checklist mentally every time rendering &ldquo;looks wrong&rdquo;: sky → parallax →
terrain → props(back) → actors → water → props(front) → debug. 90% of visual bugs are a line in the
wrong place in this order.`)}
`);

S(5, 'Efficient Rendering: The Batch Budget', `
${lead(`Let's measure the frame we just built. raylib does not expose draw-call counts directly — but the
<i>structure</i> predicts the cost, and one debug overlay makes it observable.`)}
${diag(
`  PASS                    textures   batch breaks expected
  sky gradient            —          0   (pure geometry)
  parallax (3 strips)     bg atlas   ≤3
  terrain tiles           game.png   ~1  (one atlas, one pass!)
  props                   game.png   ~1  (same atlas, contiguous pass)
  actors (N sprites)      game.png   ~1  (same atlas again)
  water overlay           —          ~2  (geometry + alpha change)
  HUD text                font       ~1
  ────────────────────────────────────────────────
  TOTAL (typical frame)              ~10 breaks — trivial for any GPU
  NAIVE (per-sprite textures)        100+ breaks — 10× driver work`, 'Predict performance by counting texture/blend switches')}
${c`
// Make it observable: our own frame profiler (ms per pass)
typedef struct PassTiming { const char *name; double ms; } PassTiming;

// wrap hot passes in the renderer:
double t0 = GetTime();
DrawTerrain(w, a);
passes[n++] = (PassTiming){ "terrain", (GetTime() - t0) * 1000.0 };

// debug overlay draws the table + a mini bar graph each frame`}
${tbl(['If you see…', 'Likely cause', 'Fix'], [
  ['Terrain pass 4ms+', 'Per-tile <code class="inl">AssetsRegion</code> string lookups', 'Pre-resolve regions at load into tiles'],
  ['Random spikes', 'New texture each frame somewhere (alloc in draw!)', 'grep for Load in renderer — zero allowed'],
  ['Fill-rate bound (big GPU, low FPS)', 'Full-screen alpha water + parallax overdraw', 'Scissor water to its rect: <code class="inl">rlEnableScissorTest</code>']
])}
${pit(`<b>Never allocate in the draw path</b>: no <code class="inl">LoadTexture</code>, no malloc, no
<code class="inl">TextFormat</code> building big strings. The renderer is a pure function of state — allocation
belongs to load and update (and <code class="inl">TextFormat</code> only in debug HUD).`)}
`);

S(5, 'HUD Architecture — Separated by Design', `
${lead(`The HUD is a <b>third renderer</b>: screen-space, camera-free, state-driven. Isolating it keeps
game rendering clean and makes responsive layout (final slides) tractable.`)}
${diag(
`  GameDraw
   ├─ WorldDraw   (camera space)   ← world moves
   ├─ HudDraw     (screen space)   ← UI anchored: corners/edges
   └─ DebugDraw   (screen space)

  Hud reads World, never writes:
   score, lives, fps, level name → glyphs & sprites
  Hud writes NOTHING to World — display only (buttons are Ch 7)`, 'One-way data flow: World → HUD')}
${c`
// src/ui/Hud.h
typedef enum { ANCHOR_TL, ANCHOR_TR, ANCHOR_BL, ANCHOR_BR,
               ANCHOR_TOP_CENTER } Anchor;

typedef struct HudWidget {          // one anchored element
    Anchor  anchor;
    Vector2 offset;                 // from the anchor point
    void  (*draw)(struct HudWidget *w, const World *world);
    bool    visible;
} HudWidget;

typedef struct Hud {
    HudWidget widgets[16]; int count;
    Font     *font;                 // pixel font from assets
    float    uiScale;               // responsive zoom (final slide)
    Vector2  shake;                 // HUD has its OWN juice (Ch 8)
} Hud;

void HudDraw(Hud *h, const World *w, bool debug);   // outside BeginMode2D!`}
${bp(`Anchors over absolute coordinates, <b>always</b>. <code class="inl">(10,10)</code> works until the first
 ultrawide monitor; <code class="inl">ANCHOR_TL + offset</code> works forever and costs nothing.`)}
`);

S(5, 'HUD: Score & Level Banner', `
${lead(`Text rendering done right: one loaded font, measured layout, <code class="inl">TextFormat</code> only
here (it allocates), and a zero-padded score that doesn't jitter as digits tick over.`)}
${c`
// src/ui/Hud.c — score widget (top-left)
static void DrawScore(HudWidget *w, const World *world) {
    Hud *h = w->hud;
    // %06d: fixed width → the layout never shifts as score grows
    const char *txt = TextFormat("SCORE %06d", world->score);
    Vector2 size = MeasureTextEx(*h->font, txt, 24.0f * h->uiScale, 2.0f);

    // soft plate behind text = readability over any sky (cheap: 1 rect)
    DrawRectangleRounded((Rectangle){ w->pos.x - 10, w->pos.y - 6,
        size.x + 20, size.y + 12 }, 0.35f, 6, (Color){10,14,24,160});

    DrawTextEx(*h->font, txt, w->pos, 24.0f * h->uiScale, 2.0f, GOLD);
}

// Level banner: appears 2s on level start, eases out (Ch 8 preview!)
static void DrawBanner(HudWidget *w, const World *world) {
    float t = world->levelTime;
    float alpha = t < 1.6f ? 1.0f : 1.0f - (t - 1.6f) / 0.6f;  // fade tail
    if (alpha <= 0) return;
    Vector2 sz = MeasureTextEx(bannerFont, world->level.name, 40, 2);
    Vector2 pos = { (GetScreenWidth() - sz.x)/2, 140 };
    DrawTextEx(bannerFont, world->level.name, pos, 40, 2,
               Fade((Color){255,240,200,255}, alpha));
}`}
${pit(`Score digits changing width = layout jitter every pickup. <b>Fixed-width formatting</b>
(<code class="inl">%06d</code>) or per-digit sprite cells — never a variable-width string in a corner
widget that ticks.`)}
${note(`<code class="inl">TextFormat</code> builds a fresh string each call — fine at HUD scale (once/frame),
forbidden in per-entity loops (Ch 3 debug overlay already respects this).`)}
`);

S(5, 'HUD: Health & Lives Counters', `
${lead(`Hearts/icons beat numbers for lives — players parse them pre-verbally. Draw N icons, highlight
the state change, and never recompute layouts in the draw call.`)}
${c`
// Lives widget (top-right): heart icons, one per life, pop on change
static void DrawLives(HudWidget *w, const World *world) {
    Hud *h = w->hud;
    Rectangle heart = AssetsRegion(&h->assets, "ui_heart");

    for (int i = 0; i < world->lives; i++) {
        float pop = 1.0f;
        if (i == world->lives - 1 && h->heartPulse > 0) {
            pop = 1.0f + 0.4f * h->heartPulse;      // gained a life!
        }
        float s = 34.0f * h->uiScale * pop;
        Rectangle dst = { w->pos.x + i * (s + 8), w->pos.y, s, s };
        DrawTexturePro(h->assets.atlas, heart, dst, (Vector2){0,0}, 0, WHITE);
    }
    // (pulse decays in HudUpdate: h->heartPulse -= dt*3 — Ch 12 does this properly)
}

// Health variant when a bar fits better (power-up state, Ch 6):
static void DrawPowerTimer(HudWidget *w, const World *world) {
    if (world->player->power <= 0) return;
    float t = world->player->power / POWER_DURATION;   // 1..0
    DrawRectangleRec((Rectangle){ w->pos.x, w->pos.y, 180, 10 },
                     (Color){20,24,38,220});
    DrawRectangleRec((Rectangle){ w->pos.x, w->pos.y, 180 * t, 10 },
                     t > 0.3f ? GREEN : RED);          // urgency color
}`}
${tbl(['Principle', 'Applied'], [
  ['Icons over numbers where feels matter', 'Hearts for lives, numbers for score'],
  ['Animate the <b>change</b>, not the state', 'Pop on gain, flash on loss (Ch 12: tweens)'],
  ['Layout constant, content variable', 'Icon slots fixed; fill count changes'],
  ['Blink urgency when critical', '<code class="inl">alpha = t>3s ? pulse : 1</code> pattern']
])}
${bp(`Reserve HUD <b>state changes as events</b> (onLifeGained, onHit) rather than diffing last frame's
count — Ch 6's event bus makes this clean and Ch 12 animates from the same events.`)}
`);

S(5, 'Framerate Monitor & Dev Readouts', `
${lead(`Ship a real perf HUD, not just <code class="inl">DrawFPS</code>: frame time graph, entity count,
worst-pass timer — the numbers you will need on a low-end phone at 2am.`)}
${c`
// src/ui/PerfHud.c — 30-sample frame time graph
typedef struct PerfHud {
    float  samples[30]; int head;
    double passMs[8];  const char *passNames[8]; int passCount;
} PerfHud;

void PerfHudTick(PerfHud *p, float dt) {          // once per frame
    p->samples[p->head++] = dt * 1000.0f;         // ms
    if (p->head >= 30) p->head = 0;
}

void PerfHudDraw(const PerfHud *p, Font f) {
    int x = 12, y = 60;
    // text block
    float avg = 0; for (int i = 0; i < 30; i++) avg += p->samples[i];
    avg /= 30;
    DrawTextEx(f, TextFormat("%d fps  %.2f ms avg",
               (int)(1000.0/Imax(avg,0.01)), avg),
               (Vector2){(float)x,(float)y}, 18, 2,
               avg < 17.0f ? LIME : (avg < 34.0f ? ORANGE : RED));
    // graph: 1px per ms target lines at 16.6 / 33.3
    for (int i = 0; i < 30; i++) {
        float ms = p->samples[(p->head + i) % 30];
        DrawRectangle(x + i*6, y + 40 - ms, 5, ms,
                      ms < 17.0f ? (Color){80,220,120,220}
                                 : (Color){255,90,90,220});
    }
    DrawLine(x, y + 40 - 16.6f, x + 180, y + 40 - 16.6f, (Color){255,255,255,90});
    // per-pass table from Ch 5 batch-budget instrumentation…
}`}
${pit(`<code class="inl">GetFPS()</code> is a smoothed average — a frame that takes 100ms hides in a
&ldquo;60 fps&rdquo; readout. The <b>graph of per-frame ms</b> is the honest instrument; spikes are spikes.
Ship both eyes on it.`)}
`);

S(5, 'Responsive Layout: Design Resolution & Scaling', `
${lead(`Players own every screen size: 1366×768 laptops, 21:9 monitors, phones. The classic solve:
render at a fixed <b>design resolution</b>, scale to fit with letterboxing — gameplay math never changes.`)}
${c`
// src/ui/Viewport.c — fit 1280x720 design into ANY window
typedef struct Viewport {
    Rectangle dst;         // on-screen position of the game rect
    float     scale;
} Viewport;

Viewport ViewportCompute(int winW, int winH) {
    Viewport v;
    v.scale = fminf((float)winW / DESIGN_WIDTH,
                    (float)winH / DESIGN_HEIGHT);   // FIT = min
    v.dst = (Rectangle){
        (winW - DESIGN_WIDTH  * v.scale) / 2.0f,    // centered
        (winH - DESIGN_HEIGHT * v.scale) / 2.0f,
        DESIGN_WIDTH  * v.scale,
        DESIGN_HEIGHT * v.scale };
    return v;
}

// In GameDraw: everything renders into an offscreen buffer…
RenderTexture2D target = LoadRenderTexture(DESIGN_WIDTH, DESIGN_HEIGHT);

BeginTextureMode(target);            // ← instead of drawing to screen
    GameDrawWorldAndHud(&game, alpha);
EndTextureMode();

BeginDrawing();                      // then blit, scaled + letterboxed
    ClearBackground(BLACK);          // the bars
    Rectangle src = { 0, 0, (float)target.texture.width,
                           -(float)target.texture.height };  // flip Y!
    DrawTexturePro(target.texture, src, v.dst,
                   (Vector2){0,0}, 0.0f, WHITE);
EndDrawing();`}
${tbl(['Strategy', 'Pro', 'Con', 'Use'], [
  ['<b>Letterbox (above)</b>', 'Identical gameplay math; pixel-perfect', 'Bars on mismatched ratios', 'Pixel art, competitive fairness'],
  ['Extend visible world', 'No bars; immersion', 'See more = advantage; UI anchors move', 'Casual scrolling games'],
  ['Stretch', 'Trivial', 'Circles become ovals — instantly amateur', 'Never']
])}
${pit(`Render textures are <b>upside-down</b> (GL origin bottom-left): destination height must be
negative (or flip in shader) or your game renders mirrored vertically. The #1 &ldquo;why is my game
flipped?!&rdquo; question — solved in one line above.`)}
`);

S(5, 'Real-Time Layout Scaling in Practice', `
${lead(`With letterboxing, HUD coordinates are in design units — but we still handle window resize,
DPI text sharpness, and UI scale settings gracefully.`)}
${c`
// Resize handling — recomputed once per resize event, not per frame
if (IsWindowResized()) {
    game.viewport = ViewportCompute(GetScreenWidth(), GetScreenHeight());
}

// UI scale setting (Ch 7 persists it): 1.0 normal, 1.25 large
h->uiScale = game.settings.uiScale;
// every HUD draw multiplies font sizes & offsets by uiScale (slides above)

// Sharp text at any window size: draw HUD AFTER the blit, directly to the
// backbuffer in window pixels (crisper than scaling through the target):
BeginDrawing();
    // 1) world through the letterboxed render target (pixel-stable)
    DrawTexturePro(target.texture, src, v.dst, (Vector2){0,0}, 0, WHITE);
    // 2) HUD in REAL window pixels, anchored to v.dst edges — always crisp
    DrawHudInRect(&game.hud, &game.world, v.dst);
EndDrawing();`}
${tbl(['Element', 'Rendered via', 'Why'], [
  ['World (pixel art)', 'RenderTexture → scaled blit', 'Point-filtered pixels stay square'],
  ['HUD text/icons', 'Direct to window, anchored to game rect', 'Crisp at 4K, independent of world zoom'],
  ['Letterbox bars', '<code class="inl">ClearBackground(BLACK)</code>', 'Free'],
  ['Debug overlays', 'Direct, window space', 'Readability > aesthetics']
])}
${bp(`Handle resize <b>event-style</b> (raylib: <code class="inl">IsWindowResized()</code> once per frame is
cheap), not by recomputing layout every draw. Layout computation is pure — do it on change, cache the
result.`)}
`);

S(5, 'raygui — Quick Debug & Tool UI (Optional Detour)', `
${lead(`For dev overlays and tiny option panels, our anchored-widget HUD is more than needed. raylib's
<b>raygui</b> gives instant immediate-mode controls — perfect for tools, overkill for the shipped HUD.`)}
${c`
#include "raygui.h"

// A debug panel in 10 lines — no retained state anywhere:
void DrawDebugPanel(Game *g) {
    Rectangle p = { GetScreenWidth() - 240, 60, 220, 190 };

    DrawRectangleRec((Rectangle){p.x-8,p.y-8,p.width+16,p.height+16},
                     (Color){12,16,28,220});
    GuiPanel(p, "DEBUG");

    g->timeScale = GuiSliderBar((Rectangle){p.x+20, p.y+40, 180, 18},
                  "timeScale", TextFormat("%.2f", g->timeScale),
                  g->timeScale, 0.0f, 2.0f);

    g->debugColliders = GuiCheckBox((Rectangle){p.x+20, p.y+80, 18, 18},
                  "show colliders", g->debugColliders);

    if (GuiButton((Rectangle){p.x+20, p.y+120, 180, 26}, "Reload level (F4)"))
        LevelReload(&g->world, &g->assets);
}`}
${tbl(['Use raygui for', 'Use custom HUD (our widgets) for'], [
  ['Debug panels, level editors, tools', 'Shipped in-game HUD'],
  ['Rapid prototyping of options', 'Stylized, art-directed UI'],
  ['Anything only developers see', 'Anything with custom animation (Ch 12)']
])}
${note(`raygui is <b>immediate mode</b>: controls exist only while the call runs — no retained tree to
sync with game state. Chapter 7 compares modes properly and shows styling with
<code class="inl">GuiLoadStyle</code>.`)}
`);

S(5, 'Chapter 5 Summary — Key Takeaways', `
${lead(`The level is alive: tiles, parallax, water, props — plus a HUD that behaves on every screen.`)}
<ul class="check">
  <li>Static world (grid + merged boxes) vs dynamic actors (objects) — different structures, different loops.</li>
  <li>Out-of-bounds tiles are <b>solid</b>; runs-merge turns 840 tiles into ~30 collision boxes.</li>
  <li>Tile rendering = visible-range double loop; culling is four divisions.</li>
  <li>Depth = draw order: sky → parallax → terrain → props → actors → water → front props.</li>
  <li>LevelLoader = pure translation with a <b>spawn table</b>; unknown types warn and skip; no player = error.</li>
  <li>Reload preserves progress; free-before-memset on reset.</li>
  <li>HUD: third renderer, screen space, anchored widgets, reads-only.</li>
  <li>Letterbox via render target (flip Y!) + direct crisp HUD; <code class="inl">uiScale</code> as a setting.</li>
</ul>
<h3>Carrying forward</h3>
<p>The world is a stage without actors. Chapter 6 brings the <b>gameplay</b>: the player controller,
AABB collisions, pickups, hazards, lives, and game over.</p>
${bp(`Checkpoint: three tile types render from the atlas; F4 reloads a hand-edited JSON level in under a
second; the HUD stays anchored through window resize; the perf graph stays green.`)}
`);
