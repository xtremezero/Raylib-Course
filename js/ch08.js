/* Chapter 8 — Special Effects */
defChapter(8, {
  tag: 'Juice',
  title: 'Special Effects',
  sub: 'Particle systems, environmental effects, parallax scrolling, interpolation & easing, and water that behaves.',
  color: '#a3e635',
  topics: ['Particle systems: emitter model', 'Emitters from files & editors', 'Dust, smoke, sparks in gameplay',
    'Procedural movement', 'Parallax scrolling done right', 'Lerp & the easing library', 'Buoyancy & floating objects']
});

SEC(8);

S(8, 'The Juice Manifesto', `
${lead(`Same mechanics, different feel — the difference is <b>feedback density</b>: every state change
should be acknowledged by motion, sound, and light. This chapter builds the machinery of acknowledgment.`)}
${tbl(['Gameplay event (already shipped)', 'Juice we add this chapter'], [
  ['Player lands (<code class="inl">EV</code>-less call in Ch 6)', 'Dust puff burst + tiny camera dip'],
  ['Coin collected (Ch 6 event)', 'Sparkle burst + score floatie (Ch 12 tweens it)'],
  ['Player hit', 'Impact ring + red vignette (already) + shake (already)'],
  ['Feather picked', 'Rising sparkle column + glow trail while active'],
  ['Rock lands', 'Dust cloud + rubble particles + thud (Ch 10)'],
  ['Idle world', 'Ambient dust motes, drifting clouds, water sparkle'],
  ['Jump', 'Stretch-squash (Ch 12) + 2-frame puff']
])}
${diag(
`  FEEL =  AUDIBLE (Ch 10)  ┐
          VISIBLE (Ch 8)   ├─ reacting to EVERY state change
          PHYSICAL (Ch 6)  ┘   within 100ms, then decaying
  the decay is the art: effects must ARRIVE loud and LEAVE quietly`, 'Juice is feedback + decay')}
${bp(`Budget rule: effects are <b>multipliers on clarity, never noise</b>. If a burst doesn't answer
&ldquo;what just happened?&rdquo;, delete it. Beautiful games are edited games.`)}
${pit(`The amateur tell is <b>persistence</b>: effects that never fade (permanent glows, looping shakes,
floating text that lingers). Every effect this chapter has a lifetime — usually under one second.`)}
`);

S(8, 'Particle Systems — The Model', `
${lead(`One mental model powers 95% of game VFX: <b>emitters spawn particles; particles live, move,
fade, die; a pool recycles them.</b> Everything else is configuration.`)}
${diag(
`  EMITTER (the tap)                 PARTICLE (the droplet)
  ┌──────────────────────┐          ┌─────────────────────┐
  │ position (may follow)│ spawn    │ pos, vel            │
  │ rate / burst count   │ ──────▶  │ life / maxLife      │
  │ spawn cone + speed   │  N/frame │ size  start→end     │
  │ lifetime range       │          │ color start→end     │
  │ color/size curves    │          │ rotation + spin     │
  │ gravity/drag factors │          └─────────┬───────────┘
  └──────────────────────┘                    │ life ≤ 0
        ▲ configuration (file/editor)         ▼
        └────────────── POOL ◀──────── recycle (no malloc!)`, 'Emitter = spawning policy · Particle = a small state machine')}
${c`
// src/fx/Particles.h — the particle (deliberately plain)
typedef struct Particle {
    Vector2 pos, vel;
    float   life, maxLife;      // life counts DOWN
    float   sizeStart, sizeEnd;
    Color   colStart, colEnd;
    float   rot, rotV;
    float   drag, gravity;      // per-particle overrides of emitter
    uint8_t blend;              // ALPHA or ADDITIVE
    bool    alive;
} Particle;

typedef struct ParticlePool {
    Particle p[512];            // fixed: Ch 4 memory discipline
    int      count;             // high-water mark (debug graph!)
} ParticlePool;`}
${bp(`Particles are <b>pure data</b>: no pointers, no per-particle behavior code — behavior comes from
the field values the emitter chose. That constraint is what makes them cache-friendly, savable, and
editable by a non-programmer (file format, slide 7).`)}
`);

S(8, 'Particle Update — Integration & Curves', `
${lead(`One loop moves everything. The craft: how fields <b>interpolate over life</b> — normalized
<code class="inl">t = 1 - life/maxLife</code> drives every curve.`)}
${c`
// src/fx/Particles.c — the whole simulation, one pass
void ParticlesUpdate(ParticlePool *pool, float dt) {
    for (int i = 0; i < pool->count; i++) {
        Particle *p = &pool->p[i];
        if (!p->alive) continue;

        p->life -= dt;
        if (p->life <= 0) { p->alive = false; continue; }

        // forces: gravity pulls, drag brakes (frame-rate safe! Ch 3)
        p->vel.y += p->gravity * dt;
        p->vel   = Vector2Scale(p->vel, 1.0f / (1.0f + p->drag * dt));
        p->pos   = Vector2Add(p->pos, Vector2Scale(p->vel, dt));
        p->rot   += p->rotV * dt;

        // normalized age drives every visual curve 0→1
        float t = 1.0f - p->life / p->maxLife;
        p->drawSize = Lerp(p->sizeStart, p->sizeEnd, t);
        p->drawCol  = LerpColor(p->colStart, p->colEnd, t);
    }
}

// Color lerp — the helper everything above leans on:
Color LerpColor(Color a, Color b, float t) {
    return (Color){
        (unsigned char)(a.r + (b.r - a.r) * t),
        (unsigned char)(a.g + (b.g - a.g) * t),
        (unsigned char)(a.b + (b.b - a.b) * t),
        (unsigned char)(a.a + (b.a - a.a) * t) };
}`}
${tbl(['Curve pattern', 'Look'], [
  ['size 1→0', 'Shrinking puff (dust, smoke)'],
  ['size 0.3→1 + alpha 1→0', 'Expanding ring (impact)'],
  ['alpha 1→0 only', 'Simple spark'],
  ['white→orange→red (2-stage)', 'Ember cooling'],
  ['shrink + gravity + drag', 'Water droplet']
])}
${pit(`Interpolate <b>alpha with color</b>, not instead of it — <code class="inl">colEnd</code> with
a=0 gives a proper fade-out; relying on additive blending alone to &ldquo;hide&rdquo; the death makes particles
blink on dark backgrounds.`)}
`);

S(8, 'Particle Rendering — Sorted & Batched', `
${lead(`Draw pass rules: group by blend mode, draw as camera-space quads from a small &ldquo;dot&rdquo;
texture, and let the <b>texture's alpha gradient</b> do the softness — not per-particle effects.`)}
${c`
// src/fx/Particles.c — render
void ParticlesDraw(const ParticlePool *pool, Texture2D dot) {
    // ONE source texture (a radial-gradient dot), hundreds of quads:
    // batched by raylib into ~1 draw call (Ch 1 batching rules)

    rlSetBlendMode(BLEND_ALPHA);
    for (int i = 0; i < pool->count; i++) {
        const Particle *p = &pool->p[i];
        if (!p->alive || p->blend != BLEND_ALPHA) continue;
        Rectangle dst = { p->pos.x, p->pos.y, p->drawSize, p->drawSize };
        DrawTexturePro(dot, (Rectangle){0,0,64,64}, dst,
                       (Vector2){p->drawSize/2, p->drawSize/2},
                       p->rot * RAD2DEG, p->drawCol);
    }
    rlSetBlendMode(BLEND_ADDITIVE);           // glow pass LAST (Ch 5 order)
    for (int i = 0; i < pool->count; i++) {
        const Particle *p = &pool->p[i];
        if (!p->alive || p->blend != BLEND_ADDITIVE) continue;
        // … same draw, additive: sparks, embers, magic
    }
    rlSetBlendMode(BLEND_ALPHA);              // restore (Ch 5 law!)
}

// The dot texture — generated once at boot, zero art required:
Image img = GenImageColor(64, 64, BLANK);
for (y…) for (x…) {
    float d = Vector2Length((Vector2){x-32, y-32}) / 32;
    float a = ClampF(1.0f - d, 0, 1);
    ImageDrawPixel(&img, x, y, (Color){255,255,255,(unsigned char)(a*a*255)});
}
Texture2D dot = LoadTextureFromImage(img); UnloadImage(img);`}
${tbl(['Particle texture', 'Effect family'], [
  ['Radial gradient dot (generated)', 'Smoke, dust, glows — 90% of usage'],
  ['4-point star sprite', 'Sparkles, coin pickups'],
  ['Hard square 2×2', 'Chunky retro debris'],
  ['Streak (16×2)', 'Speed lines, rain']
])}
${bp(`Rotating a gradient dot plus two colors reads as <b>completely different materials</b> — exploit
it. One 64px dot + parameters is a whole art style; a folder of 40 effect textures is a build-size tax.`)}
`);

S(8, 'Emitters — Configuration & Burst API', `
${lead(`Two spawn modes cover everything: <b>continuous</b> (rate/second: smoke, ambience) and
<b>burst</b> (N at once: impacts, pickups). Both come from one config struct.`)}
${c`
// src/fx/Emitter.h
typedef struct EmitterCfg {
    // spawn shape
    float     angle, spread;        // cone in radians (spread=2π = radial)
    float     speedMin, speedMax;
    // lifetime & rate
    float     lifeMin, lifeMax;
    float     ratePerSec;           // 0 = burst-only emitter
    // visuals
    float     sizeStart, sizeEnd;
    Color     colStart, colEnd;
    float     gravity, drag;
    uint8_t   blend;                // ALPHA / ADDITIVE
    // behavior
    bool      follow;               // track a source object (jet trails)
    uint8_t   dotShape;             // dot / star / square / streak
} EmitterCfg;

typedef struct Emitter {
    EmitterCfg cfg;
    Vector2    pos;
    GameObject *follow;             // if cfg.follow
    float      accum;               // fractional-rate carry
    bool       active;
} Emitter;

// --- continuous: called every tick ---
void EmitterTick(Emitter *e, ParticlePool *pool, float dt) {
    e->pos = e->cfg.follow ? e->follow->tf.pos : e->pos;
    e->accum += e->cfg.ratePerSec * dt;
    while (e->accum >= 1.0f) {
        ParticleSpawn(pool, &e->cfg, e->pos);
        e->accum -= 1.0f;                    // fractional spawn: EVEN rates
    }
}

// --- burst: event-driven (Ch 6 handlers call these) ---
void FxBurst(ParticlePool *pool, const EmitterCfg *cfg, Vector2 at, int n) {
    for (int i = 0; i < n; i++) ParticleSpawn(pool, cfg, at);
}

// The shipped effect library = const configs. Gameplay never invents physics:
static const EmitterCfg FX_DUST    = { .angle=-PI/2,.spread=2.4f,.speedMin=30,.speedMax=90,
    .lifeMin=.3f,.lifeMax=.7f,.ratePerSec=0,.sizeStart=18,.sizeEnd=2,
    .colStart={200,190,170,220},.colEnd={200,190,170,0},.drag=3,.blend=BLEND_ALPHA };
static const EmitterCfg FX_SPARKLE = { .angle=0,.spread=6.2832f,.speedMin=60,.speedMax=160,
    .lifeMin=.4f,.lifeMax=.8f,.sizeStart=10,.sizeEnd=0,
    .colStart={255,240,150,255},.colEnd={255,140,40,0},.gravity=200,.blend=BLEND_ADDITIVE };`}
${bp(`<b>Fractional accumulation</b> (<code class="inl">accum</code>) keeps low rates honest: 3
particles/second at 60fps spawns every 20 frames — never &ldquo;3 or 0 depending on rounding&rdquo;. Uniform,
unglitchy trails are the visible result.`)}
`);

S(8, 'The Emitter Library — Named Presets', `
${lead(`Effects as <b>named constants</b> — one file gameplay treats as a menu. This is the exact table
Canyon Hopper ships; tuning means editing numbers in one obvious place.`)}
${c`
// src/fx/FxLibrary.c — the whole effects vocabulary
typedef enum {
    FX_NONE, FX_DUST, FX_DUST_BIG, FX_SPARKLES, FX_IMPACT,
    FX_EMBER, FX_SPLASH, FX_PUFF, FX_RESPAWN, FX_COUNT
} FxId;

static const EmitterCfg FX_TABLE[FX_COUNT] = {
    [FX_DUST]     = { .angle=-1.5708f,.spread=2.4f,.speedMin=30,.speedMax=90,
                      .lifeMin=.3f,.lifeMax=.7f,.sizeStart=18,.sizeEnd=2,
                      .colStart={200,190,170,220},.colEnd={200,190,170,0},.drag=3 },
    [FX_SPARKLES] = { .spread=6.2832f,.speedMin=60,.speedMax=160,.lifeMin=.4f,
                      .lifeMax=.8f,.sizeStart=10,.sizeEnd=0,
                      .colStart={255,240,150,255},.colEnd={255,140,40,0},
                      .gravity=200,.blend=BLEND_ADDITIVE },
    [FX_IMPACT]   = { .spread=6.2832f,.speedMin=120,.speedMax=260,.lifeMin=.15f,
                      .lifeMax=.35f,.sizeStart=14,.sizeEnd=2,
                      .colStart={255,255,255,255},.colEnd={255,80,40,0},
                      .drag=4,.blend=BLEND_ADDITIVE },
    [FX_EMBER]    = { .angle=-1.5708f,.spread=.6f,.speedMin=15,.speedMax=40,
                      .lifeMin=1.5f,.lifeMax=3,.ratePerSec=6,.sizeStart=6,.sizeEnd=1,
                      .colStart={255,180,60,200},.colEnd={200,40,20,0},
                      .blend=BLEND_ADDITIVE,.dotShape=DOT_SQUARE },
    [FX_SPLASH]   = { .angle=-1.5708f,.spread=1.8f,.speedMin=80,.speedMax=200,
                      .lifeMin=.3f,.lifeMax=.6f,.sizeStart=8,.sizeEnd=2,
                      .colStart={160,210,255,230},.colEnd={160,210,255,0},
                      .gravity=700,.drag=1 },
    // … DUST_BIG, PUFF, RESPAWN similar
};

// The ENTIRE gameplay-facing API — three calls:
void FxBurst    (FxId id, Vector2 at, int count);
void FxAttach   (FxId id, GameObject *follow);     // continuous + tracking
void FxStopAll  (GameObject *follow);`}
${bp(`Resist per-call-site tweaking (&ldquo;just this once make it redder&rdquo;) — add an
<code class="inl">FxId</code> variant instead. Fifty call sites of bespoke magic numbers is how effects
become un-tunable and the game acquires visual noise.`)}
`) ;

S(8, 'Effects & Data — Loading Emitter Configs from JSON', `
${lead(`Designers tune effects without touching C: the table above serializes to JSON, a loader reads it
back, and hot-reload (Ch 4) re-reads it live. Particle configs are <b>data</b>.`)}
${json`
{ "effects": [
  { "id": "FX_SPARKLES",
    "spawn": { "angleDeg": 0, "spreadDeg": 360,
               "speedMin": 60,  "speedMax": 160 },
    "life":  { "min": 0.4, "max": 0.8 },
    "look":  { "sizeStart": 10, "sizeEnd": 0,
               "colStart": "#FFF096FF", "colEnd": "#FF8C2800",
               "blend": "additive", "shape": "star" },
    "forces": { "gravity": 200, "drag": 0 },
    "rate": 0, "burst": 24
  },
  { "id": "FX_EMBER", "spawn": { "angleDeg": -90, "spreadDeg": 35,
    "speedMin": 15, "speedMax": 40 },
    "life": { "min": 1.5, "max": 3.0 },
    "look": { "sizeStart": 6, "sizeEnd": 1,
      "colStart": "#FFB43CC8", "colEnd": "#C8281400",
      "blend": "additive", "shape": "square" },
    "forces": { "gravity": 0, "drag": 0 }, "rate": 6, "burst": 0 }
]}`}
${c`
// Loader: JSON row → EmitterCfg (colors from hex strings!)
static Color HexColor(const char *s) {     // "#RRGGBBAA"
    unsigned v = (unsigned)strtoul(s + 1, NULL, 16);
    return (Color){ (v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255 };
}

bool FxLoadTable(const char *jsonPath) {   // cJSON walk → FX_TABLE
    // per effect: map each sub-object into cfg fields,
    // unknown fields → WARN + keep default (forwards-compatible files)
    return true;
}
// Ch 4 hot-reload hook: F5 → FxLoadTable("assets/fx.json") → live tuning`}
${pit(`Keep <b>unknown-field tolerance</b> both directions: loader warns on unknown keys (typos like
<code class="inl">"gravty"</code> become visible) but never crashes — a designer's half-saved file should
degrade, not detonate.`)}
`);

S(8, 'Particle Editors — Why & The Tool Loop', `
${lead(`Tuning numbers by recompiling is slow; tuning in a <b>live editor</b> is 10× faster. You do not
need to ship a tool — you need the loop: edit → see instantly → export JSON.`)}
${diag(
`  ┌── GAME (running, live) ─────────────────┐
  │  [F8] fx editor: pick FX_EMBER          │
  │   sliders: rate speed life colors …     │   edit in-game,
  │  emitter previews in a small stage box  │   see at 60fps,
  └───────────────┬─────────────────────────┘
                  │ "export"
                  ▼
          assets/fx.json  ── hot-reload ──▶ same game, next frame
  (external tools exist — rPE / TexturePacker-adjacent — but a
   raygui panel from Ch 5 gets you 80% in an afternoon)`, 'The tuning loop is the product; the editor is 40 lines of raygui')}
${c`
// src/tools/FxEditor.c — the 80% editor (debug builds only)
void FxEditorDraw(Game *g) {
    EmitterCfg *c = &FX_TABLE[g->fxEditSel];
    Rectangle p = { 40, 60, 300, 420 };
    GuiPanel(p, "FX EDITOR");
    c->speedMin = GuiSliderBar((Rectangle){56, 100, 260, 18}, "spdMin", NULL,
                               c->speedMin, 0, 400);
    c->speedMax = GuiSliderBar((Rectangle){56, 130, 260, 18}, "spdMax", NULL,
                               c->speedMax, 0, 400);
    c->lifeMin  = GuiSliderBar((Rectangle){56, 160, 260, 18}, "lifeMin", NULL,
                               c->lifeMin, 0.05f, 3);
    // … size, gravity, drag sliders
    if (GuiButton((Rectangle){56, 380, 120, 30}, "TEST"))
        FxBurst(g->fxEditSel, g->editorSpawnPoint, 24);
    if (GuiButton((Rectangle){190, 380, 120, 30}, "EXPORT"))
        FxExportTable("assets/fx.json");     // writes the JSON of slide 7
}`}
${bp(`The editor writes <b>the same JSON file the game loads</b> — no separate export pipeline to drift
out of sync. One format, one truth, two doors (hand-edit or slider-edit).`)}
`);

S(8, 'Environmental Effects I — Dust, Smoke, Steam', `
${lead(`Ambience sells worlds: motes in light shafts, campfire smoke, cave steam. All continuous
emitters placed by level data (Ch 4 <code class="inl">theme</code>) — zero gameplay code.`)}
${c`
// Ambient emitters: spawned at level load from level decor entries
// level json: { "decor":[{"type":"campfire","x":12,"y":11}, …] }
static void OnCampfireProp(World *w, Vector2 at) {
    EmitterCfg smoke = FX_TABLE[FX_SMOKE];
    EmitterCfg ember = FX_TABLE[FX_EMBER];
    smoke.colStart = (Color){120,110,100,140};   // gray column
    FxAttachCfg(&smoke, at);                     // continuous, fixed pos
    FxAttachCfg(&ember, at);
}

// Dust motes: the classic "alive air" — few, slow, light-seeded
static const EmitterCfg FX_MOTES = {
    .spread = 6.2832f, .speedMin = 4, .speedMax = 12,
    .lifeMin = 3, .lifeMax = 6, .ratePerSec = 3,
    .sizeStart = 3, .sizeEnd = 1,
    .colStart = {255,245,210,90}, .colEnd = {255,245,210,0},
    .blend = BLEND_ADDITIVE,
};
// spawn region = camera view: they exist where the player looks
void AmbientMotesTick(World *w, float dt) {
    Rectangle view = VCamViewRect(w->camRef);
    if (RandomChance(dt * 3.0f))                 // ~3/sec, Poisson-ish
        ParticleSpawnIn(&w->fxPool, &FX_MOTES,
                        RandomPointInRect(view));
}`}

${tbl(['Ambient', 'Signature params'], [
  ['Dust motes', 'Very slow, long life, additive, ~3/sec'],
  ['Campfire smoke', 'Up cone, drag 1, size grows 6→20, alpha soft'],
  ['Waterfall mist', 'Fast down + upward bounce, high rate'],
  ['Cave steam', 'Wide slow up-cone, big sizes, low alpha']
])}
${pit(`Ambient emitters live in <b>camera space regions</b>, not the whole level — 500 drifting motes
across a level you never see is pure waste. Spawn in-view, cull by distance, keep the pool high-water
mark small (it's on your perf HUD from Ch 5).`)}
`);

S(8, 'Environmental Effects II — Gameplay Sparks & Impacts', `
${lead(`Event bursts differ from ambience: they must be <b>instant, directional, and readable</b>. Wire
them to the Ch 6 event bus — effects code never polls gameplay.`)}
${c`
// src/fx/FxGameplay.c — all subscriptions in one init
void FxBindGameplay(void) {
    EventsOn(EV_COIN_PICKED, FxOnCoin);
    EventsOn(EV_PLAYER_HIT,  FxOnHit);
    EventsOn(EV_LAND_HARD,   FxOnLand);      // new event Ch 6 emits
    EventsOn(EV_PLAYER_DIED, FxOnDeath);
}

static void FxOnHit(const Event *e, World *w) {
    GameObject *p = e->a;
    // directional burst: ring + sparks AWAY from hazard (knockback dir)
    Vector2 dir = Vector2Normalize(
        Vector2Subtract(p->tf.pos, e->b->tf.pos));
    EmitterCfg ring = FX_TABLE[FX_IMPACT];
    ring.angle = atan2f(dir.y, dir.x);           // aim the cone
    ring.spread = 2.2f;                          // forward hemisphere
    FxBurstCfg(&w->fxPool, &ring, p->tf.pos, 18);
    FxBurst(FX_SPARKLES, p->tf.pos, 10);
    VCamAddShake(w->camRef, 6.0f);               // Ch 3 hook, finally fed
}

static void FxOnLand(const Event *e, World *w) {
    float impact = fabsf(e->a->tf.vel.y);        // recorded pre-zero
    if (impact > 700.0f)                         // hard landing only
        FxBurst(FX_DUST, (Vector2){ e->a->tf.pos.x,
                 e->a->tf.pos.y + 20 }, 8 + (int)impact / 100);
}`}
${tbl(['Readability rule', 'Applied'], [
  ['Direction from gameplay', 'Burst cone aims along knockback/hit normal'],
  ['Magnitude from gameplay', 'Dust count scales with fall speed'],
  ['Layered response', 'Ring (shape) + sparks (motion) + shake (camera)'],
  ['Sound completes it', 'Ch 10 maps 1:1 to these same events']
])}
${bp(`<b>One event → one audio + one burst + optional shake.</b> The mapping table (event → effect ids) is
worth writing down in your repo docs: new events get juice by adding a row, and the &ldquo;why is getting
hit silent?&rdquo; bug is a missing row, not a mystery.`)}
`);

S(8, 'Procedural Motion — Bob, Orbit, Wander', `
${lead(`&ldquo;Animals&rdquo; of idle motion — the sine bob, the orbit, the wander — are one-liners that make props
and pickups feel alive without animators. All are pure functions of time + seed.`)}
${c`
// 1) BOB — coins, power-ups, menu title (you've seen it: Ch 6)
float Bob(float t, float seed, float amp, float freq) {
    return sinf(t * freq + seed) * amp;          // seed from world pos!
}

// 2) ORBIT — fairy companions, shield sparkles
Vector2 Orbit(Vector2 center, float t, float seed,
              float radius, float freq, float *outAngle) {
    float a = t * freq + seed;
    if (outAngle) *outAngle = a;                 // draw rotation too
    return Vector2Add(center, (Vector2){ cosf(a)*radius, sinf(a)*radius });
}

// 3) WANDER — ambient critters, drunk porcupines: noise via layered sines
Vector2 Wander(Vector2 center, float t, float seed, float radius) {
    // two incommensurate sines per axis ≈ organic loop-less motion
    return (Vector2){
        center.x + radius * (sinf(t*0.7f + seed)        * 0.6f
                           + sinf(t*1.9f + seed*2.3f)   * 0.4f),
        center.y + radius * (sinf(t*0.5f + seed*1.7f)   * 0.6f
                           + sinf(t*2.3f + seed*3.1f)   * 0.4f) };
}

// 4) SQUASH-AND-STRETCH preview (Ch 12 animates it properly):
// scale.y = 1 + 0.2*sinf(t*10) while charging a jump…`}
${diag(
`  bob:      ● sin wave, 1 axis        orbit:  ●→●→● around anchor
  wander:   pseudo-random loop (2 sines beat = never repeats exactly)
  ALL SEEDED BY POSITION → deterministic across replays (Ch 6 law)`, 'Idle motion vocabulary — four functions, infinite life')}
${pit(`Layered-sine &ldquo;noise&rdquo; beats <code class="inl">rand()</code> for idle motion: it is <b>smooth</b>
(no teleporting props) and <b>deterministic</b> (replays & netcode-friendly). Reserve
<code class="inl">rand()</code> for genuinely random events — and even then, a seeded PRNG (Ch 14).`)}
`);

S(8, 'Parallax Scrolling — The Math', `
${lead(`Parallax = distant things move slower. Chapter 5 drew strips by factor; now the full derivation —
including the wrap-around trick for endless layers.`)}
${c`
// THE LAW: screen offset = (camera.position * factor) then tile/wrap.
// factor: 0 = infinitely far (never moves) … 1 = gameplay plane

Vector2 ParallaxOffset(Vector2 camTarget, float factor) {
    // negative because the world moves OPPOSITE the camera
    return Vector2Scale(camTarget, -factor);
}

// Endless horizontal wrap for a strip of width W:
float ParallaxWrapX(float worldX, float viewW, float W) {
    return fmodf(worldX, W);                      // python-mod ok in C99? no:
    // fmodf keeps sign — normalize to [0, W):
    float x = fmodf(worldX, W); if (x < 0) x += W;
    return x;
}

// Draw a layer so it always covers the view, tiled 2–3 times:
void DrawParallaxLayer(Texture2D strip, Camera2D cam, float factor,
                       float yOffset, Color tint) {
    float W = (float)strip.width;
    float off = ParallaxWrapX(cam.target.x * factor, 0, W);

    for (int i = -1; i <= (int)(GetScreenWidth() / W) + 1; i++) {
        float x = off + i * W;
        DrawTextureRec(strip, (Rectangle){0,0,W,(float)strip.height},
                       (Vector2){ x, yOffset }, tint);
    }
}
// Ch 5's BackdropDraw now becomes three calls:
// DrawParallaxLayer(mountains, cam, 0.25f, horizonY, Fade(WHITE,.9f));
// DrawParallaxLayer(hills,     cam, 0.55f, horizonY+40, Fade(WHITE,.95f));
// DrawParallaxLayer(clouds,    cam, 0.40f, 60, WHITE);  + self-drift offset`}
${diag(
`  camera moves right by Δ
  ─────────────────────────────▶
  layer f=0.25 shifts ← by 0.25Δ     (far: lazy)
  layer f=0.55 shifts ← by 0.55Δ     (mid)
  layer f=1.00 shifts ← by 1.00Δ     (game plane: pinned to world)
  wrap: offset mod stripWidth → the SAME 1024px strip, forever`, 'Depth is a multiplication factor')}
${pit(`Wrap the <b>offset</b>, never the camera — and make strip widths divide cleanly into the view
(or over-draw as above). A seam crossing the screen mid-jump is the classic parallax bug: test by
sprinting at top speed through 3+ screen widths.`)}
`);

S(8, 'Parallax in Practice — Drift, Zoom & Layers', `
${lead(`Production parallax has three refinements: <b>auto-drift</b> (idle motion), <b>zoom-aware</b>
tiling, and depth-consistent <b>vertical</b> parallax.`)}
${c`
// Full backdrop driver — replaces Ch 5's simple version
typedef struct BackdropLayer {
    Texture2D tex; float factor; float y; float drift; Color tint;
} BackdropLayer;

typedef struct Backdrop {
    BackdropLayer layers[4];
    int count;
    float t;
} Backdrop;

void BackdropDraw(Backdrop *b, Camera2D cam, float dt) {
    b->t += dt;
    for (int i = 0; i < b->count; i++) {
        BackdropLayer *L = &b->layers[i];
        // drift ADDS to the camera term: clouds move even when idle
        float effCamX = cam.target.x * L->factor + b->t * L->drift;
        float effCamY = cam.target.y * L->factor * 0.3f; // subtle vertical
        // zoom: scale strip so it always covers the (larger at z<1) view
        float cover = 1.0f / Imax(cam.zoom, 0.5f);
        DrawStripTiled(L->tex, effCamX, effCamY, L->y, cover, L->tint);
    }
}`}

${tbl(['Layer stack (Canyon Hopper)', 'factor', 'drift px/s', 'Note'], [
  ['Sky gradient', '0.00', '0', 'Screen-fixed (Ch 5)'],
  ['Far mesas', '0.20', '0', 'Heaviest tint (aerial perspective)'],
  ['Clouds', '0.35', '+6', 'Self-drift + slow factor'],
  ['Near hills', '0.60', '0', 'Darkest silhouette'],
  ['Mist band', '0.80', '−4', 'Additive, low alpha']
])}
${bp(`<b>Aerial perspective</b> (far = lighter/hazier, near = darker/saturated) is the free depth cue
that makes layered strips read as distance rather than five wallpapers. Tint distance via
<code class="inl">Fade(WHITE, 0.5–0.9)</code> + a sky-colored overlay.`)}
`);

S(8, 'Interpolation — Lerp, Damp & Remap', `
${lead(`Before easing curves: three primitives you will use daily forever. <b>Lerp</b> (blend),
<b>Damp</b> (frame-rate-safe approach), <b>Remap</b> (translate ranges).`)}
${c`
// 1) LERP — linear blend; t clamped for safety, unclamped variant for bounce
float Lerp(float a, float b, float t) { return a + (b - a) * t; }
Vector2 Vector2Lerp(Vector2 a, Vector2 b, float t)
    { return (Vector2){ Lerp(a.x,b.x,t), Lerp(a.y,b.y,t) }; }
// Lerp(a,b,0)=a  Lerp(a,b,1)=b  Lerp(a,b,0.5)=midpoint

// 2) DAMP — exponential approach, THE frame-rate-safe follow
//    (Ch 3 camera used it; now you know its name and family)
float  DampF (float  a, float  b, float lambda, float dt)
    { return Lerp(a, b, 1.0f - expf(-lambda * dt)); }
Vector2 DampV2(Vector2 a, Vector2 b, float lambda, float dt)
    { return Vector2Lerp(a, b, 1.0f - expf(-lambda * dt)); }

// 3) REMAP — value from one range to another (bars, meters, thumbsticks)
float Remap(float v, float inLo, float inHi, float outLo, float outHi) {
    float t = (v - inLo) / (inHi - inLo);       // normalize 0..1
    return Lerp(outLo, outHi, ClampF(t, 0, 1));
}
// hp 40/120 → Remap(0.333, 0,1, 0,180) = 60px of health bar`}
${tbl(['Primitive', 'Question it answers', 'Shipped examples'], [
  ['<code class="inl">Lerp</code>', '&ldquo;Blend these two by t&rdquo;', 'Camera zoom punch, color fades, HUD bars'],
  ['<code class="inl">Damp</code>', '&ldquo;Approach b smoothly over time&rdquo;', 'Camera follow (Ch 3), button hover, aim assist'],
  ['<code class="inl">Remap</code>', '&ldquo;Rescale a value into my UI&rdquo;', 'HP→pixels, stick→speed, score→bar']
])}
${pit(`The classic error remains worth repeating: <code class="inl">a += (b-a)*0.1</code> per <b>frame</b>
is damping with λ tied to FPS — on a 144Hz monitor everything follows 2.4× faster. Every approach this
chapter goes through <code class="inl">dt</code>. No exceptions, including in menus.`)}
`);

S(8, 'The Easing Library — A Catalog', `
${lead(`Easing = lerp with a <b>shaped</b> t. One header, 20 functions, and suddenly every animation in
the game has professional timing. We ship the full catalog; you'll use six daily.`)}
${c`
// src/util/Easing.h — t clamped 0..1 unless noted
typedef float (*EaseFn)(float t);

float EaseLinear (float t){ return t; }
// --- the daily six ---
float EaseOutQuad(float t){ return 1 - (1-t)*(1-t); }        // snappy open
float EaseInQuad (float t){ return t*t; }                    // gentle start
float EaseInOutQuad(float t)                                  // smooth both
  { return t<.5f ? 2*t*t : 1-powf(-2*t+2,2)/2; }
float EaseOutBack(float t){ float c=1.70158f;                 // overshoot pop
  t-=1; return 1 + (c+1)*t*t*t + c*t*t; }
float EaseOutElastic(float t){                                // rubber bounce
  if (t==0||t==1) return t;
  float c4=(2*PI)/3; return powf(2,-10*t)*sinf((t*10-.75f)*c4)+1; }
float EaseOutBounce(float t){ float n1=7.5625f, d1=2.75f;    // ball drop
  if (t < 1/d1) return n1*t*t;
  if (t < 2/d1) return n1*(t-=1.5f/d1)*t + .75f;
  if (t < 2.5/d1) return n1*(t-=2.25f/d1)*t + .9375f;
  return n1*(t-=2.625f/d1)*t + .984375f; }

// Composed ease-along-a-duration — the pattern Chapter 12 wraps in Actions:
float EaseAcross(float t /*0..1*/, float dur, EaseFn fn) {
    return fn(ClampF(t / dur, 0, 1));
}`}
${tbl(['Feel', 'Function', 'Use on'], [
  ['Instant energy', 'OutQuad / OutCubic', 'Damage numbers, doors, UI in'],
  ['Building energy', 'InQuad', 'Wind-ups, charges, telegraphs'],
  ['Cinematic', 'InOutQuad/Cubic', 'Camera pans, screen wipes (Ch 9!)'],
  ['Playful overshoot', 'OutBack', 'Buttons, pickups, mascot pops'],
  ['Rubbery', 'OutElastic', 'Squash characters, bouncy UI'],
  ['Falling weight', 'OutBounce', 'Landings, drops, results screens']
])}
${note(`Naming convention (Penner): <code class="inl">Ease<In|Out|InOut><Curve></code> — In = slow start,
Out = fast start then settle. When everything in a game uses &ldquo;Out&rdquo; family + one signature
overshoot, the UI acquires a coherent personality.`)}
`);

S(8, 'Easing in the Game — Camera, UI, HUD', `
${lead(`Wire the library into three shipped systems — small diffs, transformative feel. These exact
calls return in Chapter 12 wrapped as reusable tween Actions.`)}
${c`
// 1) CAMERA: zoom punch on coin streak — punch value eased back to 1
typedef struct CamPunch { float t; float dur; float amp; } CamPunch;
void CamPunchTick(CamPunch *cp, VCamera *vc, float dt) {
    if (cp->t >= cp->dur) return;
    cp->t += dt;
    float k = EaseOutQuad(cp->t / cp->dur);          // 0→1 settled
    vc->cam.zoom = Lerp(1.0f + cp->amp, 1.0f, k);   // 1.06 → 1.00
}

// 2) UI: menu buttons pop in staggered (Ch 7 nodes + ease)
void MenuItemIntro(SceneNode *n, int index, float dt) {
    float delay = index * 0.07f;                     // cascade!
    float t = ClampF((menuTime - delay) / 0.35f, 0, 1);
    float k = EaseOutBack(t);                        // overshoot pop
    n->pos.y = Lerp(-40, 0, k);                      // slide+overshoot
    n->alpha = EaseOutQuad(t);
}

// 3) HUD: score number ROLLS instead of jumping (500→620 counts up)
void HudScoreRoll(Hud *h, int target, float dt) {
    h->scoreShown = DampF(h->scoreShown, (float)target, 12.0f, dt);
    if (target - (int)h->scoreShown < 1) h->scoreShown = (float)target;
    DrawTextEx(font, TextFormat("%06d", (int)h->scoreShown), …);
}`}
${tbl(['Before', 'After (eased)', 'Perceived quality'], [
  ['Zoom snaps 1→1.06→1', 'EaseOutQuad both ways', 'Physical, organic'],
  ['Menu items appear', 'Staggered OutBack cascade', 'Expensive, alive'],
  ['Score jumps +120', 'Rolls over 0.4s', 'Rewarding, arcade'],
  ['Overlay α 0→1', 'InOut + slight slide', 'Cinematic (Ch 9 builds on this)']
])}
${bp(`Stagger (<code class="inl">index * 0.07s</code>) is the secret ingredient of &ldquo;juicy&rdquo; menus:
elements entering together look like a spreadsheet; cascading looks choreographed. Applies to exits too
(reversed order, faster).`)}
`);

S(8, 'Water Dynamics — The Buoyancy Model', `
${lead(`Simplified Archimedes: an object in water feels an <b>upward force proportional to submerged
depth</b>, plus heavy drag. ~15 lines produce convincing bobbing, floating debris, and splash logic.`)}
${diag(
`  water surface ────────────────
        ┌────┐
        │    │  ← submerged depth d (0..height)
  ──────┴────┴──────
  FORCE MODEL per tick (submerged):
   buoyancy: F_up = -k_buoy * d          (deeper = pushed harder)
   drag:     v *= 1/(1 + k_drag*dt)      (water resists BOTH axes)
   gravity:  still applies (g scaled ~0.3 in "water")
  EQUILIBRIUM: buoyancy == gravity → object settles bobbing at
               its natural line. Disturb it → damped oscillation = BOAT.`, 'A spring, basically — depth is the displacement')}
${c`
// src/fx/WaterPhysics.c — runs in WorldUpdate for water-affected actors
void SystemBuoyancy(World *w, float dt) {
    const Water *wt = &w->water;
    if (!wt->enabled) return;

    for (int i = 0; i < w->objectCount; i++) {
        GameObject *g = &w->objects[i];
        if (!g->alive || !g->gp.floats) continue;      // marked floaters

        float surface = wt->area.y + WaterSurfaceAt(wt, g->tf.pos.x);
        float bottom  = g->tf.pos.y + g->bounds.box.height/2;
        if (bottom < surface) continue;                // not touching

        float d = ClampF(bottom - surface, 0, g->bounds.box.height);
        float sub = d / g->bounds.box.height;          // 0..1 submerged

        // buoyant force grows with submersion (k tuned per mass feel)
        g->tf.vel.y -= WATER_BUOYANCY * sub * dt;
        // water drag on both axes, scaled by submersion
        float drag = 1.0f / (1.0f + WATER_DRAG * sub * dt);
        g->tf.vel   = Vector2Scale(g->tf.vel, drag);
        g->gp.inWater = true;                          // splash state
    }
}`}
${note(`<code class="inl">WaterSurfaceAt</code> reuses Chapter 5's sine surface — so buoyancy and the
<b>drawn</b> wave stay in sync. One source of truth for the wave, consumed by both render and physics.`)}
`);

S(8, 'Floating Objects — Buoys, Debris & Splashes', `
${lead(`With buoyancy running, gameplay arrives almost free: floating platforms the player can ride,
driftwood, and splash events at entry.`)}
${c`
// A rideable lily pad: buoyant body the player collides with (solid!)
static void OnLilyPadProp(World *w, Vector2 at) {
    GameObject *pad = SpawnSolid(w, at, 64, 12);   // solid: stand on it
    pad->gp.floats = true;                         // …but buoyant
    pad->gp.dragSide = 60.0f;                      // drifts with "current"
}

// Splash on ENTRY (edge-triggered, not per-frame):
void SystemWaterEvents(World *w, float dt) {
    for (floaters and player) {
        bool inNow = IsInWater(g);
        if (inNow && !g->gp.wasInWater) {          // the ENTRY edge
            float speed = fabsf(g->tf.vel.y);
            if (speed > 120.0f) {
                FxBurstCfg(&w->fxPool, &FX_TABLE[FX_SPLASH],
                           (Vector2){ g->tf.pos.x, WaterSurfaceAt(
                           &w->water, g->tf.pos.x) },
                           6 + (int)(speed / 60));
                SoundPlay(&w->sound, "sfx_splash"); // Ch 10!
                VCamAddShake(w->camRef, fminf(speed/120, 3.0f));
            }
        }
        g->gp.wasInWater = inNow;
    }
}

// Player swimming (feel tweaks in water):
p->tf.vel.x *= 1/(1+2.5f*dt);        // heavy horizontal drag
p->gp.coyote = 0;                    // no coyote in water
if (ActionDown(ACT_JUMP))            // swim strokes instead
    p->tf.vel.y = DampF(p->tf.vel.y, -150, 6, dt);`}
${tbl(['Water gameplay', 'Enabled by'], [
  ['Bobbing debris', 'Buoyancy + drag (constants tuned)'],
  ['Rideable lily pads', 'Buoyant + solid object'],
  ['Splashes', 'Entry edge + speed magnitude'],
  ['Swimming', 'Same model on player + control tweaks'],
  ['Underwater FX', '<code class="inl">inWater</code> flag → bubbles emitter + Ch 9 tint shader']
])}
${pit(`Tune <code class="inl">WATER_BUOYANCY</code> so equilibrium sits where art says the waterline is:
k = <code class="inl">gravity * mass / height</code> per object class. Objects that sink nose-up or fly out
of the water mean the constant ignores the object's own height/mass profile — split constants per
archetype instead of one global.`)}
`);

S(8, 'Combining Systems — The Effect Stack', `
${lead(`A single moment, fully juiced — the level-complete flag grab. Read it as a checklist: this table
IS the chapter's summary in one event.`)}
${c`
static void OnLevelWin(const Event *e, World *w) {
    GameObject *flag = e->b, *p = e->a;

    // 1) WORLD: freeze player control (Ch 6), lock camera (Ch 3)
    p->gp.controlFrozen = true;
    w->camRef->locked = true;

    // 2) PARTICLES: staggered bursts at the flag
    FxBurst(FX_SPARKLES, flag->tf.pos, 30);
    FxAttach(FX_EMBER, flag);                       // rising embers now

    // 3) CAMERA: slow zoom-out reveal (eased — slide 16)
    w->winZoomT = 0;   // GameUpdate eases zoom 1.0→0.92 InOutQuad

    // 4) UI: banner slides in (Ch 7 nodes + OutBack, delayed 0.4s)
    HudBannerShow("LEVEL CLEAR!", 0.4f);

    // 5) AUDIO: sting + music duck (Ch 10 completes the moment)
    SoundPlay(&w->sound, "sfx_win");

    // 6) HANDOFF: after 2.2s → transition (Ch 9!) to next level
    w->winTimer = 2.2f;
}`}
${diag(
`  timeline (seconds)
  0.0  flag grab: sparkle burst + shake-free zoom start + sting
  0.4  banner pops (OutBack) over frozen, zooming world
  0.4-2.2 embers rise; score rolls (Ch 5 damped counter)
  2.2  Ch 9 wipe → next level loads → banner out (reverse cascade)`, 'Six systems, one second, one memory: players call it "polish"')}
${bp(`Sequence <b>delays</b> on purpose: burst (0.0s) → banner (0.4s) → transition (2.2s). Simultaneity is
mud; stagger is drama. The 0.4s &ldquo;beat&rdquo; before UI appears lets the world effect breathe first — film
editing, in a platformer.`)}
`);

S(8, 'Performance & Budgets — FX Discipline', `
${lead(`Effects are the first place frame budgets go to die. The pool helps; these rules keep it
honest — verified on the Ch 5 perf HUD.`)}
${tbl(['Rule', 'Budget / check'], [
  ['Particle cap', '512 alive (desktop) / 160 (reduced-Fx mode) — enforce in spawn'],
  ['Per-event bursts', '≤ 40 particles; big &ldquo;wow&rdquo; = fewer, larger, additive'],
  ['Emitters in view only', 'Ambient tick checks camera rect before spawning'],
  ['Overdraw watch', 'Full-screen additive stacks kill mobile GPUs — watch fill rate'],
  ['Perf graph correlation', 'Burst during spike? halve counts, double size — looks same']
])}
${c`
// Cap enforcement INSIDE spawn — gameplay code never checks:
Particle *ParticleSpawn(ParticlePool *pool, const EmitterCfg *c, Vector2 at) {
    if (pool->aliveCount >= pool->budget) {        // budget from settings!
        TraceLog(LOG_DEBUG, "[FX] over budget — dropped");
        return NULL;                                // callers may ignore
    }
    Particle *p = &pool->p[pool->cursor++];
    // … initialize from cfg with randomized ranges
    return p;
}

// Settings-driven budget (Ch 7 flag):
pool->budget = settings.reducedFx ? 160 : 512;`}
${pit(`The perf trap that looks like a particle problem but isn't: <b>overdraw from big quads</b>.
Twenty 300px additive particles cover the screen 4× — fill-rate bound on a phone. Fix by shrinking
sizes or counts, never by &ldquo;optimizing the loop&rdquo; — the loop is fine; the pixels are the cost.`)}
${bp(`Ship the FX budget as a user setting, defaulting from platform capability
(<code class="inl">PlatformInfo</code>, Ch 2): desktop 512, mobile 192, reduced-Fx 128. Same game, every
device, one config table.`)}
`);

S(8, 'Chapter 8 Summary — Key Takeaways', `
${lead(`Canyon Hopper now responds to everything — visibly, audibly (next chapter… one after), physically.`)}
<ul class="check">
  <li>Particles = emitters (policy) + pooled particles (data) + curves over normalized life.</li>
  <li>Two spawn modes: continuous (rate + fractional accumulator) and burst (events).</li>
  <li>Render grouped by blend; one gradient dot + parameters = an art style.</li>
  <li>Effects as <b>named presets</b> in one table; JSON-driven; live editor loop (F8).</li>
  <li>Procedural idle motion: bob / orbit / wander — seeded by position, deterministic.</li>
  <li>Parallax: <code class="inl">offset = -cam * factor</code>, wrap the offset, aerial-perspective tint.</li>
  <li>Lerp / Damp (λ·dt!) / Remap + the easing catalog — feel is applied math.</li>
  <li>Water: depth-proportional buoyancy + drag; splashes on the entry edge; rideable floaters.</li>
  <li>Sequenced juice (beat delays) reads as polish; simultaneous juice reads as noise.</li>
</ul>
<h3>Carrying forward</h3>
<p>Every screen change is still a hard cut. Chapter 9: the <b>transition framework</b> — fades, wipes,
and shader morphs between everything.</p>
${bp(`Checkpoint: landing spawns dust scaled by fall speed; coins sparkle with directional ring on hits;
menu cascades; debris bobs in water with entry splashes; the perf graph stays under 17ms with 500
particles alive — and reduced-Fx mode demonstrably halves both.`)}
`);
