/* Chapter 6 — Adding the Actors */
defChapter(6, {
  tag: 'Gameplay',
  title: 'Adding the Actors',
  sub: 'The player, collectibles, power-ups and hazards — AABB collisions, damage, lives, camera lock, and game over.',
  color: '#f87171',
  topics: ['Interactive dynamic entities', 'Bounding boxes & spatial partitioning', 'Entity spawning from levels',
    'AABB detection & response', 'Triggers, pickups, power-ups, hazards', 'Health, lives, game over, camera lock']
});

SEC(6);

S(6, 'The Actor Cast — Gameplay Vocabulary', `
${lead(`Four archetypes cover almost every 2D game object. Deciding an entity's archetype — and its
<b>data contract</b> — is game design expressed as C structs.`)}
${tbl(['Archetype', 'Canyon Hopper', 'Solid?', 'Moves?', 'On overlap with player'], [
  ['<b>Collectible</b>', 'Gold coin', 'No', 'Anim only', 'Pickup: +score, despawn, SFX'],
  ['<b>Power-up</b>', 'Feather (double jump)', 'No', 'Anim', 'Pickup: timed ability, HUD timer'],
  ['<b>Hazard</b>', 'Porcupine, falling rock, spikes', 'Solid or trigger', 'Patrol / fall', 'Damage: lose life, i-frames'],
  ['<b>Avatar</b>', 'The bunny player', 'Solid', 'Full physics', '— (others react to it)'],
  ['<b>Goal</b>', 'Flag', 'No', 'No', 'Win level (trigger)']
])}
${c`
// Gameplay fields added to GameObject this chapter:
typedef struct CGameplay {
    float     power;          // >0 = double-jump active (seconds left)
    float     iframes;        // >0 = invulnerable (hit cooldown)
    float     patrolMin, patrolMax;   // hazard walk range (world x)
    int       value;          // coin value, damage amount…
    bool      isTrigger;      // overlap events only — no resolution
} CGameplay;

typedef struct GameObject {
    ObjKind kind; bool alive;
    CTransform tf;      // pos, vel, prevPos   (Ch 3)
    CRender   ren;      // region, tint, flip  (Ch 3)
    CBounds   bounds;   // world AABB          (Ch 3)
    CGameplay gp;       // ← NEW: per-archetype data
    float     animT;
} GameObject;`}
${bp(`One struct serves all archetypes via <b>unused fields = zero</b> (we zero-init on spawn). The
alternative — one struct per type — multiplies systems by types; data-uniformity is what keeps our
system loops simple.`)}
`);

S(6, 'Bounding Boxes & Collision Boundaries', `
${lead(`The <b>AABB</b> (axis-aligned box) is 2D collision's workhorse: cheap tests, stable behavior. The
craft is in <i>choosing the box</i> — smaller than art, generous where it helps players.`)}
${c`
// Box derived from sprite + inset — recomputed on move, never stored stale:
static void SyncBounds(GameObject *g) {
    float w = fabsf(g->ren.atlasRegion.width)  * g->ren.scale;
    float h = fabsf(g->ren.atlasRegion.height) * g->ren.scale;
    g->bounds.box = (Rectangle){
        g->tf.pos.x - w*0.5f + INSET_X,   // inset X: fair hops
        g->tf.pos.y - h*0.5f + INSET_Y,   // inset Y: smaller than art
        w - 2*INSET_X, h - 2*INSET_Y };
}
// player:  inset 4px x, 3px y   → forgiving near-misses
// coin:    box BIGGER than art (28 vs 24)  → generous pickups
// spikes:  box TINY vs art      → fair hazards (players forgive
//          being NEAR spikes, never ON them)`}
${tbl(['Object', 'Art size', 'Hitbox', 'Rationale'], [
  ['Player', '32×32', '24×26 inset', 'Feet solid, sides forgiving'],
  ['Coin', '24×24', '30×30 expanded', 'Pickups should feel magnetic'],
  ['Porcupine body', '36×24', '30×18', 'Spines are visual threat, not lethal pixels'],
  ['Spike tile', '32×32', '32×12 (bottom)', 'Only the tips hurt']
])}
${pit(`Never let two sources of truth fight: derive bounds from pos each tick (<code class="inl">SyncBounds</code>),
or store pos as the box's center and derive rendering from it. A hand-set box that drifts from its
sprite is invisible cheating players can feel.`)}
`);

S(6, 'AABB Collision Detection — The Primitives', `
${lead(`raylib ships the primitives; knowing what they cost and mean lets you build everything else.
All are O(1) per pair — the challenge is never one test, it's N×M tests (next slide).`)}
${c`
// The core primitives (rshapes):
bool hit = CheckCollisionRecs(a.bounds.box, b.bounds.box);

bool pointIn = CheckCollisionPointRec(GetScreenToWorld2D(
                   GetMousePosition(), cam), someWorldRect);

Rectangle overlap = GetCollisionRec(a, b);   // the INTERSECTION box:
//   overlap.width/height > 0 = colliding
//   and it tells you WHERE — the basis of resolution (2 slides ahead)

bool circleHit = CheckCollisionCircles(c1.pos, r1, c2.pos, r2);
// circles: smoother feel for rolling hazards; boxes: everything else`}
${diag(
`  ┌────────A────────┐
  │        ┌─┬──────┼────┐
  │        │ │ OVL  │    │   OVL = intersection rectangle
  │        └─┴──────┼────┘   width×height = penetration on
  └─────────────────┘        BOTH axes simultaneously
                ┌─────────B────────┐
                │                  │
                └──────────────────┘`, 'GetCollisionRec: collision + direction in one call')}
${tbl(['Test', 'Cost', 'Use for'], [
  ['<code class="inl">CheckCollisionRecs</code>', '~6 compares', 'Broad, everything'],
  ['<code class="inl">GetCollisionRec</code>', 'same + result', 'When you need the overlap to resolve'],
  ['Point/Rec', '4 compares', 'Picking, triggers vs small bullets'],
  ['Circle/Circle', '1 distance', 'Rolling objects, radial pickups']
])}
${bp(`Write your own <code class="inl">AABB(a,b)</code> once (4 compares) if you avoid raylib's dependency in
simulation code — World stays window-free (Ch 3 rule) and unit-testable.`)}
`);

S(6, 'Spatial Partitioning — Why & The Uniform Grid', `
${lead(`The naive &ldquo;everything vs everything&rdquo; check is O(N²): 300 objects = 45,000 tests per tick.
A <b>uniform grid</b> cuts it to ~O(N): objects only test their cell's neighbors.`)}
${diag(
`  WORLD (broadphase grid, cell 128px)
  ┌────┬────┬────┬────┬────┐
  │    │ ●  │    │ ●● │    │      Each frame:
  ├────┼────┼────┼────┼────┤      1. clear cell lists
  │ ●  │    │ ◉  │    │ ●  │      2. insert each object's
  ├────┼────┼────┼────┼────┤         box into covered cells
  │    │ ●● │    │    │    │      3. pairs within a cell (or
  └────┴────┴────┴────┴────┘         neighbors) → narrowphase
   ◉ player only ever tests vs ●s in its cell — never the whole world`, 'Hash the world into cells; query only nearby')}
${c`
// src/world/SpatialGrid.c — fixed uniform grid (no allocs, no hashing)
#define GRID_CELL 128
#define GRID_W 32
#define GRID_H 16

typedef struct SpatialGrid {
    int cells[GRID_H][GRID_W][16];   // object indices, 16/cell cap
    int counts[GRID_H][GRID_W];
} SpatialGrid;

void GridClear(SpatialGrid *g) { memset(g->counts, 0, sizeof g->counts); }

void GridInsert(SpatialGrid *g, int idx, Rectangle box) {
    int x0 = Iclamp((int)(box.x / GRID_CELL), 0, GRID_W-1);
    int x1 = Iclamp((int)((box.x+box.width)  / GRID_CELL), 0, GRID_W-1);
    int y0 = Iclamp((int)(box.y / GRID_CELL), 0, GRID_H-1);
    int y1 = Iclamp((int)((box.y+box.height)/ GRID_CELL), 0, GRID_H-1);
    for (int y = y0; y <= y1; y++)
        for (int x = x0; x <= x1; x++) {
            int *c = &g->counts[y][x];
            if (*c < 16) g->cells[y][x][(*c)++] = idx;
        }
}

// Query: iterate the player's covered cells; each co-habiting index
// that's > ours is a candidate pair (dedups a==b).
// Cells rebuilt ONCE per tick, after integration, before interactions.`}
${tbl(['Structure', 'Build', 'Query', 'When to graduate to it'], [
  ['N² pairs', '—', 'O(N²)', 'N < ~80: honestly fine (ship it)'],
  ['<b>Uniform grid</b>', 'O(N)', '~O(k) neighbors', '<b>Course choice</b>: uniform-sized world'],
  ['Quadtree', 'O(N log N)', 'O(log N + k)', 'Huge sparse worlds, varied sizes'],
  ['Sort-and-sweep (x-axis)', 'O(N log N)', 'O(N + k)', 'Many fast objects on one axis']
])}
${pit(`Grid cell size is a <b>tuning value</b>: cell ≈ average object size. Cells too small → big objects
span many cells; too large → each cell holds everything (back to N²). 128px fits our 32–64px actors
with headroom.`)}
`);

S(6, 'Spatial Queries in the Tick', `
${lead(`Here's the whole collision pipeline assembled — where grid build, narrowphase, and reactions sit
in the fixed-step update.`)}
${c`
// src/world/World.c — the collision spine (grows each chapter)
void WorldUpdate(World *w, float dt, AssetManager *assets) {
    w->levelTime += dt;

    SystemApplyGravity (w, dt);          // archetypes opt in/out
    SystemIntegrateMotion(w, dt);        // pos += vel*dt (+prevPos snap)
    SystemPatrolHazards (w, dt);         // porcupines walk their range
    SyncAllBounds(w);                    // boxes follow positions ONCE

    GridClear(&w->grid);                 // ← rebuild broadphase
    for (int i = 0; i < w->objectCount; i++)
        if (w->objects[i].alive)
            GridInsert(&w->grid, i, w->objects[i].bounds.box);

    SystemCollidePlayerWorld(w, dt);     // vs terrain boxes (next slides)
    SystemOverlapsPlayerActor(w, assets);// vs triggers/pickups/hazards
    SystemCollectPickups(w, assets);     // overlap → collect events
    SystemCullDead(w);                   // alive=false slots reclaimed
}`}
${diag(
`  tick:  gravity ─▶ integrate ─▶ patrol ─▶ sync bounds
              ─▶ GRID REBUILD ─▶ resolve (solid) ─▶ triggers (events)
              ─▶ collect ─▶ cull
  ORDER IS CONTRACT: resolve BEFORE triggers so overlap tests
  use post-resolution boxes (no phantom hits inside walls)`, 'Update order is gameplay correctness')}
${bp(`Rebuild the grid <b>after</b> integration and <b>before</b> any interaction — a stale grid is worse
than no grid because it's confidently wrong. Rebuilding a fixed array grid costs microseconds; don't
optimize it away with incremental updates until measured.`)}
`);

S(6, 'Player Controller — Kinematic Platformer Physics', `
${lead(`Our player is <b>kinematic</b>: we integrate velocity ourselves and resolve against the world by
moving one axis at a time. (Chapter 11 shows the dynamic-body alternative — and why platformers often
still prefer this.)`)}
${c`
// src/actors/Player.c — the controller, one axis at a time
void SystemPlayerControl(World *w, float dt) {
    GameObject *p = w->player;

    // ---- horizontal intent ----
    float dirX = 0;
    if (ActionDown(ACT_LEFT))  dirX -= 1;
    if (ActionDown(ACT_RIGHT)) dirX += 1;
    p->tf.vel.x = dirX * PLAYER_RUN_SPEED;
    p->ren.flipX = (dirX < 0);          // face travel (Ch 12 animates walk)

    // ---- jump: coyote time + input buffer = modern feel ----
    bool grounded = p->gp.grounded;
    p->gp.coyote  = grounded ? COYOTE_SECONDS : p->gp.coyote - dt;
    if (ActionPressed(ACT_JUMP)) p->gp.jumpBuf = BUFFER_SECONDS;
    else                         p->gp.jumpBuf -= dt;

    if (p->gp.jumpBuf > 0 && p->gp.coyote > 0) {
        p->tf.vel.y = -PLAYER_JUMP_SPEED;
        p->gp.coyote = p->gp.jumpBuf = 0;          // consumed
        SoundPlay(assets, "sfx_jump");
    }
    // variable jump height: release early → cut velocity
    if (ActionReleased(ACT_JUMP) && p->tf.vel.y < 0)
        p->tf.vel.y *= 0.45f;

    // double jump while feather-power active (Ch: power-ups slide)
    if (p->gp.power > 0 && p->gp.jumpBuf > 0 && p->gp.airJumps > 0) {
        p->tf.vel.y = -PLAYER_JUMP_SPEED * 0.9f;
        p->gp.airJumps--;  p->gp.jumpBuf = 0;
        FxSpawnBurst(w, p->tf.pos, FX_PUFF);       // Ch 8!
    }

    // ---- terminal velocity ----
    if (p->tf.vel.y > PLAYER_MAX_FALL) p->tf.vel.y = PLAYER_MAX_FALL;
}`}
${tbl(['Feel feature', 'Value', 'What it forgives'], [
  ['Coyote time', '0.09s', 'Jumping just after leaving a ledge'],
  ['Input buffer', '0.12s', 'Pressing jump just before landing'],
  ['Variable height', 'cut ×0.45', 'Tapping vs holding jump'],
  ['Air control', 'full (set vx directly)', 'Steering mid-flight']
])}
${bp(`These four &ldquo;cheats&rdquo; are why good platformers feel good. They cost 6 lines — skipping them is
the single most common amateur-feel bug in the genre.`)}
`);

S(6, 'Axis-Separated Collision Response', `
${lead(`The resolution algorithm that powers a thousand platformers: move X, fix X; move Y, fix Y.
Separating axes makes wall slides, landings, and corner cases <i>fall out correctly</i>.`)}
${c`
// src/actors/PlayerCollide.c — vs terrain solid boxes (Ch 5 merged runs)
void SystemCollidePlayerWorld(World *w, float dt) {
    GameObject *p = w->player;

    // ---------- MOVE X, RESOLVE X ----------
    p->tf.pos.x += p->tf.vel.x * dt;
    SyncBounds(p);
    for (int i = 0; i < w->solidCount; i++) {
        Rectangle hit = GetCollisionRec(p->bounds.box, w->solidBoxes[i]);
        if (hit.width <= 0) continue;
        if (p->tf.vel.x > 0)      // was moving right → push back left
            p->tf.pos.x -= hit.width;
        else if (p->tf.vel.x < 0) // moving left → push right
            p->tf.pos.x += hit.width;
        p->tf.vel.x = 0;          // wall slide: vertical keeps going
        SyncBounds(p);
    }

    // ---------- MOVE Y, RESOLVE Y ----------
    p->gp.grounded = false;
    p->tf.pos.y += p->tf.vel.y * dt;
    SyncBounds(p);
    for (int i = 0; i < w->solidCount; i++) {
        Rectangle hit = GetCollisionRec(p->bounds.box, w->solidBoxes[i]);
        if (hit.height <= 0) continue;
        if (p->tf.vel.y > 0) {            // FALLING → land on top
            p->tf.pos.y -= hit.height;
            p->gp.grounded = true;
            if (p->gp.wasFallingFast) FxSpawnDust(w, p->tf.pos); // Ch 8
        } else if (p->tf.vel.y < 0) {     // RISING → bump head
            p->tf.pos.y += hit.height;
        }
        p->tf.vel.y = 0;
        SyncBounds(p);
    }
}`}
${diag(
`  frame:  ──▶ move X ──▶ resolve X ──▶ move Y ──▶ resolve Y ──▶ done
  results:  walls slide ✔      landings detect ✔   head bumps ✔
  WHY IT WORKS: each resolution has ONE unambiguous direction,
  because only ONE axis moved since the last known-good position`, 'One axis at a time = no diagonal paradoxes')}
${pit(`Resolve against the <b>merged boxes</b> (Ch 5), never raw tiles — tile seams cause the infamous
&ldquo;edge catch&rdquo;: moving along flat ground, you snag on each tile boundary. Merged runs make flat
ground literally one box.`)}
`);

S(6, 'Trigger Zones — Events Without Physics', `
${lead(`A trigger overlaps but never <b>pushes</b>: coins, goal flags, hazard hitboxes, spawn markers.
Triggers turn collision into <b>game events</b> — and events keep systems decoupled.`)}
${c`
// src/world/Events.h — tiny typed event bus (C function pointers)
typedef enum {
    EV_COIN_PICKED, EV_POWER_PICKED, EV_PLAYER_HIT,
    EV_LEVEL_WIN,   EV_PLAYER_DIED
} EventType;

typedef struct Event {
    EventType type;
    GameObject *a, *b;       // actor + other (may be NULL)
} Event;

typedef void (*EventHandler)(const Event *e, World *w);

// systems subscribe; World dispatches at END of tick (buffered!)
void EventsOn(EventType t, EventHandler h);
void EventsEmit(EventType t, GameObject *a, GameObject *b);

// dispatch loop — after all systems ran this tick:
void EventsFlush(World *w) {
    for (int i = 0; i < g_eventCount; i++)
        for (int h = 0; h < g_handlers[g_events[i].type].count; h++)
            g_handlers[g_events[i].type].fn[h](&g_events[i], w);
    g_eventCount = 0;
}`}
${c`
// Trigger check in the overlap system:
static void TryTrigger(World *w, GameObject *player, GameObject *other) {
    if (!other->gp.isTrigger) return;
    if (!CheckCollisionRecs(player->bounds.box, other->bounds.box)) return;

    switch (other->kind) {
    case OBJ_COIN:    EventsEmit(EV_COIN_PICKED, player, other); break;
    case OBJ_FEATHER: EventsEmit(EV_POWER_PICKED, player, other); break;
    case OBJ_ROCK:    EventsEmit(EV_PLAYER_HIT, player, other);  break;
    case OBJ_GOAL:    EventsEmit(EV_LEVEL_WIN, player, other);   break;
    default: break;   // solids handled by resolution, not here
    }
}`}
${bp(`<b>Buffer events, flush after update.</b> An event handler that spawns/kills objects mid-loop
mutates the array other systems are iterating — classic crash. The queue defers all reactions to a safe
point in the tick.`)}
`);

S(6, 'Collectibles — Coins That Feel Good', `
${lead(`A coin is 3 things: a trigger, a visual magnet (idle bob + spin — animated fully in Ch 12), and an
event with feedback on every channel: score, sound, particles.`)}
${c`
// Event handler registered at boot:
static void OnCoinPicked(const Event *e, World *w) {
    GameObject *coin = e->b;
    if (!coin->alive) return;              // same-frame double pickup guard
    coin->alive = false;                   // cull system frees the slot

    w->score += coin->gp.value;            // STATE
    SoundPlay(assets, "sfx_coin");         // AUDIO (pitch rises in streaks)
    FxSpawnBurst(w, coin->tf.pos, FX_SPARKLES);   // FX (Ch 8)
    // (HUD updates itself by reading score — no direct call! Ch 5 flow)
}

// The idle bob that sells "pick me" — pure function of time:
void CoinIdleAnim(GameObject *coin, float t) {
    float phase = t * 3.0f + coin->tf.pos.x * 0.05f;  // x-seeded: no sync!
    coin->ren.tint = WHITE;
    coin->bobOffset = sinf(phase) * 4.0f;   // renderer adds to pos
}`}
${tbl(['Feedback channel', 'Implementation', 'Chapter'], [
  ['Visual pop', 'Spawn sparkle burst + score floatie', '8, 12'],
  ['Audio', '<code class="inl">sfx_coin</code>, pitch +streak', '10'],
  ['Score', 'event → World.score → HUD reads', 'this'],
  ['Game feel', 'pickup radius &gt; art (magnet box)', 'this']
])}
${pit(`Seed idle-anims from <b>world position</b> (as above), not <code class="inl">rand()</code>: coins seeded
randomly all bob in sync if seeded by time-only — worse, level reloads re-randomize. Position-seeded =
stable, unsynchronized, and deterministic across replays.`)}
`);

S(6, 'Power-Ups — Timed Abilities', `
${lead(`Feathers grant <b>double jump</b> for 8 seconds. The pattern generalizes to speed, shield,
magnet — one timer field, one HUD bar (Ch 5), one player-state check.`)}
${c`
static void OnPowerPicked(const Event *e, World *w) {
    GameObject *p = e->a;                 // the player
    p->gp.power   = POWER_DURATION;       // countdown starts
    p->gp.airJumps = 1;                   // refreshed while active
    SoundPlay(assets, "sfx_power");
    // Ch 12: player sprite swaps to "helmet" variant while active
}

// per tick: countdown + expire gracefully
void SystemPowerTimer(World *w, float dt) {
    GameObject *p = w->player;
    if (p->gp.power <= 0) return;
    p->gp.power -= dt;
    if (p->gp.power > 0 && p->gp.grounded) p->gp.airJumps = 1;  // refill
    if (p->gp.power <= 0) {
        p->gp.power = 0;                  // clamp: HUD bar reads 0..1
        // mid-air expiry does NOT yank the jump already banked — fair
    }
}`}

${c`
// Design rule of thumb — power-up timers:
//   visible:   HUD bar  (Ch 5 DrawPowerTimer)
//   audible:   last-2s ticking (Ch 10 pitch rises)
//   forgiving: expiring mid-air never cancels an ALREADY-USED air jump`}
${tbl(['Power-up', 'Field', 'Player effect', 'Counterplay'], [
  ['Feather (shipped)', '<code class="inl">gp.power</code>', '+1 air jump', '8s timer'],
  ['Speed pepper', '<code class="inl">gp.speedMul</code>', '×1.5 run speed', 'harder control'],
  ['Shield shell', '<code class="inl">gp.shield</code>', 'absorbs 1 hit', 'rare drops']
])}
${bp(`Keep power-ups as <b>small modifiers on existing systems</b> (a multiplier, a jump allowance) — never
fork the controller into &ldquo;powered mode&rdquo;. One controller, parameterized, testable.`)}
`);

S(6, 'Hazards — Patrol & Falling Damage', `
${lead(`Porcupines patrol; rocks fall and roll off ledges. Hazards teach the level's rhythm — their data
comes straight from the level file (Ch 4) through the spawn table (Ch 5).`)}
${c`
// Porcupine: patrol between two x markers, flip at edges, no gravity
void SystemPatrolHazards(World *w, float dt) {
    for (int i = 0; i < w->objectCount; i++) {
        GameObject *h = &w->objects[i];
        if (!h->alive || h->kind != OBJ_PORCUPINE) continue;

        h->tf.pos.x += HAZARD_PATROL_SPEED * h->gp.patrolDir * dt;
        h->ren.flipX = (h->gp.patrolDir < 0);

        if (h->tf.pos.x < h->gp.patrolMin) {         // bounce at ends
            h->tf.pos.x = h->gp.patrolMin; h->gp.patrolDir = +1;
        } else if (h->tf.pos.x > h->gp.patrolMax) {
            h->tf.pos.x = h->gp.patrolMax; h->gp.patrolDir = -1;
        }
        SyncBounds(h);
    }
}

// Falling rock: sleeps until player is near, then gravity + warn flash
void SystemFallingRocks(World *w, float dt) {
    for (/* rocks */) {
        GameObject *r = &w->objects[i];
        if (r->gp.isTrigger && r->gp.woke == false) {
            float dx = fabsf(w->player->tf.pos.x - r->tf.pos.x);
            if (dx < 220.0f) {             // proximity fuse
                r->gp.woke = true;
                r->gp.isTrigger = false;    // becomes SOLID: can stand on!
                SoundPlay(assets, "sfx_rumble");
            }
        } else if (r->gp.woke) {
            r->tf.vel.y += WORLD_GRAVITY * dt;       // falls
            // ...axis-resolve vs terrain like the player (shared code!)
        }
    }
}`}
${bp(`Shared resolution code, parameterized: the rock reuses the player's axis-separated collide function
(<code class="inl">CollideBodyVsWorld(w, obj, dt)</code>). Duplicated &ldquo;simple&rdquo; physics per entity type is
where platformer codebases rot.`)}
${pit(`Hazards must <b>telegraph</b>: the rock's proximity-fuse shake, the porcupine's patrol visibility.
Damage without warning reads as unfair; fair difficulty = warning → danger.`)}
`);

S(6, 'Damage, i-Frames & Knockback', `
${lead(`Being hit should be loud, clear, and <b>survivable</b>: knockback sells impact, i-frames prevent
double-hits, and the player flickers while invulnerable.`)}
${c`
static void OnPlayerHit(const Event *e, World *w) {
    GameObject *p = e->a;                    // player
    if (p->gp.iframes > 0) return;           // invulnerable: ignore
    if (p->gp.shield > 0) {                  // Ch: shield powerup
        p->gp.shield = 0;  p->gp.iframes = IFRAME_SECONDS;
        SoundPlay(assets, "sfx_shield_pop"); return;
    }

    w->lives--;                              // STATE first
    p->gp.iframes = IFRAME_SECONDS;          // grace period
    VCamAddShake(w->camRef, 6.0f);           // camera juice (Ch 3)
    FxSpawnBurst(w, p->tf.pos, FX_IMPACT);   // Ch 8

    // knockback away from the hazard — direction from positions
    Vector2 away = Vector2Normalize(
        Vector2Subtract(p->tf.pos, e->b->tf.pos));
    p->tf.vel = Vector2Scale(away, 420.0f);
    p->tf.vel.y = -260.0f;                   // always a little UP: readable

    SoundPlay(assets, "sfx_hit");
    if (w->lives <= 0) EventsEmit(EV_PLAYER_DIED, p, e->b);
}

// per tick: flicker while invulnerable (renderer):
float flicker = (p->gp.iframes > 0)
    ? (sinf(w->levelTime * 40.0f) > 0 ? 1.0f : 0.25f) : 1.0f;
DrawTexturePro(atlas, src, dst, pivot, 0, Fade(WHITE, flicker));`}
${tbl(['Mechanic', 'Value', 'Why'], [
  ['i-frames', '1.5s', 'Room to escape after a hit; flicker communicates it'],
  ['Knockback', '420 px/s + up 260', 'Impact + moves player OUT of the hazard box'],
  ['Camera shake', '6px', 'The hit is felt, not just seen'],
  ['Death check', 'lives ≤ 0 → event', 'Game-over flow owns the rest (below)']
])}
${pit(`Knockback that ignores hazard position (always &ldquo;up&rdquo;) feels random; computing
<b>away-from-hazard</b> takes one <code class="inl">Vector2Normalize</code> and doubles readability.`)}
`);

S(6, 'Health, Lives & Respawning', `
${lead(`Death flow: lives hit zero or the player falls out of the world. Respawn restores position and
grace — from a <b>checkpoint</b> if the level defines one, else level start.`)}
${c`
static void OnPlayerDied(const Event *e, World *w) {
    GameObject *p = e->a;
    SoundPlay(assets, "sfx_die");
    w->gameOver = true;                       // Game screens take over (Ch 7)
    // camera LOCKS (next slide) — death is framed, not chased
}

// Fall-out check (in WorldUpdate — the cheapest "hazard" there is):
if (p->tf.pos.y > w->bounds.height + 200) {
    w->lives--;                               // falling costs a life
    if (w->lives <= 0) EventsEmit(EV_PLAYER_DIED, p, NULL);
    else WorldRespawn(w);                     // try again
}

void WorldRespawn(World *w) {
    GameObject *p = w->player;
    p->tf.pos = w->respawnPoint;              // last checkpoint / start
    p->tf.vel = (Vector2){0,0};
    p->gp.iframes = 2.0f;                     // generous on respawn
    p->gp.power = 0;                          // powers don't survive death
    VCamSnapTo(w->camRef, p->tf.pos);         // camera CUTS, no long pan
    FxSpawnBurst(w, p->tf.pos, FX_RESPAWN);
}

// Checkpoints: just another trigger type in the level file:
//   { "type":"checkpoint", "x":18, "y":11 }
static void OnCheckpoint(const Event *e, World *w) {
    if (w->respawnPoint.x != e->b->tf.pos.x) {     // new (not re-arm)
        w->respawnPoint = e->b->tf.pos;
        SoundPlay(assets, "sfx_checkpoint");
        e->b->ren.tint = LIME;                     // flag turns green
    }
}`}
${bp(`Respawn <b>snaps</b> the camera (a 2-second pan over the corpse of your failure is punishment
theater). Instant restart is respect for the player's time — and Ch 12 will still add a 0.4s death
fade for dignity.`)}
`);

S(6, 'Camera Lock Mechanics', `
${lead(`Sometimes the camera must <b>stop following</b>: death framing, boss arenas, cutscene beats, and
&ldquo;letterbox&rdquo; story moments. The <code class="inl">locked</code> flag from Chapter 3 earns its keep.`)}
${c`
// Death framing: lock + slow zoom on the player
static void OnPlayerDied(const Event *e, World *w) {
    w->camRef->locked = true;                  // stop following (Ch 3!)
    w->deathZoom = 0.0f;                       // animate 1.0 → 1.25 over 0.6s
}

// In GameUpdate while game-over is pending:
if (w->gameOver && w->deathZoom < 1.0f) {
    w->deathZoom = fminf(1.0f, w->deathZoom + dt / 0.6f);
    cam.cam.zoom = Lerp(1.0f, 1.25f, EaseOut(w->deathZoom));  // Ch 8!
}

// Arena rooms: lock to a room rect while player is inside
void VCamLockToRoom(VCamera *vc, Rectangle room, Vector2 playerPos) {
    if (CheckCollisionPointRec(playerPos, room)) {
        vc->locked = true;
        vc->cam.target = (Vector2){ room.x + room.width/2,
                                    room.y + room.height/2 };
        // clamp normally: room may be smaller than view → center lock (Ch 3)
    } else {
        vc->locked = false;                    // resume follow
    }
}`}
${tbl(['Lock moment', 'Camera behavior', 'Release condition'], [
  ['Death', 'Freeze + zoom 1.25×', 'Restart / overlay dismissal'],
  ['Arena room', 'Center on room rect', 'Player exits room'],
  ['Cutscene (Ch 12)', 'Scripted pan path', 'Sequence ends'],
  ['Level intro', 'Pan from goal → player', 'Pan completes']
])}
${pit(`Every lock needs a <b>guaranteed release path</b> — a lock that can stay on (e.g. arena exit check
references a deleted room object) freezes the camera forever. Prefer lock states that re-evaluate
<b>every tick</b> from live world data, as the arena check above does.`)}
`);

S(6, 'Game Over & Win Overlays', `
${lead(`End-states are <b>screens</b> (Chapter 7 formalizes them) — but their first version is an overlay:
dim the world, freeze simulation, show verdict + options. Note what stays running.`)}
${c`
// src/ui/GameOver.c — overlay while World sits frozen-but-drawn
typedef struct EndOverlay {
    bool active, won;
    float t;                    // time since activation (animates)
} EndOverlay;

void EndOverlayUpdate(EndOverlay *o, float dt) { if (o->active) o->t += dt; }

void EndOverlayDraw(const EndOverlay *o) {
    if (!o->active) return;
    float a = EaseOut(fminf(o->t / 0.5f, 1.0f));      // Ch 8 easing!

    // dim world — reads as "the game is over", HUD stays visible below
    DrawRectangle(0, 0, GetScreenWidth(), GetScreenHeight(),
                  Fade(BLACK, 0.65f * a));

    const char *title = o->won ? "LEVEL CLEAR!" : "GAME OVER";
    Font f = *assets.fontBig;
    Vector2 sz = MeasureTextEx(f, title, 72, 2);
    Vector2 pos = { (GetScreenWidth() - sz.x)/2,
                    220 - (1.0f - a) * 60 };           // slide up + fade
    DrawTextEx(f, title, pos, 72, 2,
               Fade(o->won ? GOLD : RED, a));

    // stats + options (buttons become real in Ch 7; keys for now)
    DrawTextEx(*assets.font, TextFormat(
        "SCORE %06d   LIVES %d", world.score, world.lives),
        (Vector2){(GetScreenWidth()-300)/2, 330}, 24, 2,
        Fade(WHITE, a));
    DrawTextEx(*assets.font, o->won ?
        "[ENTER] next level    [ESC] menu" :
        "[ENTER] retry         [ESC] menu",
        (Vector2){(GetScreenWidth()-420)/2, 430}, 22, 2, Fade(LIME, a));
}`}
${tbl(['Layer (draw order)', 'During game-over'], [
  ['World', 'Frozen, still drawn (context!)'],
  ['Water/FX', 'Update STOPS — time is suspended'],
  ['Dim rect', 'α 0.65 — the universal "modal" signal'],
  ['Overlay UI', 'Animated in (slide 1: this chapter, eased)'],
  ['Debug', 'Hidden unless F1']
])}
${bp(`Freeze gameplay but keep the <b>overlay's own clock</b> running (<code class="inl">o->t += dt</code>
outside the simulation). A game-over that animates feels alive; one that hard-freezes including its own
entrance feels broken.`)}
`);

S(6, 'Dynamic Status Indicators — HUD Level 2', `
${lead(`Chapter 5's HUD showed state; this chapter's HUD <b>reacts</b>: damage vignette, low-lives pulse,
power-up bar from the last slides. Game events drive it — the HUD still writes nothing.`)}
${c`
// HUD subscribes to the SAME events gameplay uses (Ch 6 bus):
static void HudOnHit(const Event *e, World *w) {
    hud->damageFlash = 1.0f;        // red vignette intensity
}
static void HudOnCoin(const Event *e, World *w) {
    hud->scorePunch = 1.0f;         // scale bounce on score text
}
// HudUpdate: decay each effect
void HudUpdate(Hud *h, const World *w) {
    h->damageFlash = fmaxf(0, h->damageFlash - 2.5f*w->dt);
    h->scorePunch  = fmaxf(0, h->scorePunch  - 4.0f*w->dt);
    h->heartPulse  = fmaxf(0, h->heartPulse  - 3.0f*w->dt);
}

// Damage vignette: 4 edge gradients, intensity = flash
static void DrawDamageVignette(const Hud *h) {
    if (h->damageFlash <= 0) return;
    Color c = Fade((Color){200,30,30,255}, 0.45f * h->damageFlash);
    int W = GetScreenWidth(), H = GetScreenHeight();
    DrawRectangleGradientV(0, 0, W, 60, c, BLANK);
    DrawRectangleGradientV(0, H-60, W, 60, BLANK, c);
    // ...left/right similar — cheap, readable "ouch"
}

// Low-lives: hearts pulse when on the last one
bool critical = (w->lives == 1);
float pulse = critical ? 0.15f * sinf(w->time * 8.0f) : 0.0f;`}
${tbl(['Indicator', 'Trigger event', 'Decay'], [
  ['Red vignette', '<code class="inl">EV_PLAYER_HIT</code>', '2.5/s'],
  ['Score punch', '<code class="inl">EV_COIN_PICKED</code>', '4/s'],
  ['Heart pop', 'lives gained', '3/s'],
  ['Last-heart pulse', 'state: lives == 1', 'looping (no decay)']
])}
${pit(`Reactive HUD must <b>decay deterministically</b> (per second, not per frame) — same Ch 3 lesson as
camera damping. <code class="inl">flash -= 0.1</code> per frame pulses at different speeds on a 144Hz monitor.`)}
`);

S(6, 'Tuning the Feel — The Gameplay Survey', `
${lead(`Numbers are design. Here is Canyon Hopper's tuned sheet — and how each was <i>found</i> (nobody
guesses these correctly the first time).`)}
${tbl(['Parameter', 'Value', 'How it was tuned'], [
  ['Gravity', '1500 px/s²', 'Raised until jumps felt weighty, not floaty'],
  ['Run speed', '320 px/s', 'Camera lead felt right at ~10 tiles/sec'],
  ['Jump speed', '640 px/s', 'Set jump HEIGHT (≈4 tiles), solved backwards'],
  ['Coyote / buffer', '0.09 / 0.12s', 'Playtesters missed jumps; widened until they stopped'],
  ['i-frames', '1.5s', 'Long enough to cross a porcupine patrol'],
  ['Knockback', '420 + 260 up', 'Must clear the hazard box in one bounce'],
  ['Coin value', '10', 'Level 1 holds ~300 → scores feel arcade-big'],
  ['Lives', '3', 'Genre default; checkpoint density compensates']
])}
${c`
// The jump formula every platformer derives once:
//   height h = v² / (2g)   →   v = sqrt(2·g·h)
float JumpSpeedForHeight(float tiles, float tileSize, float g) {
    return sqrtf(2.0f * g * tiles * tileSize);
}
// PLAYER_JUMP_SPEED = JumpSpeedForHeight(4.0f, 32, 1500) ≈ 620 ✓`}
${bp(`Tune with the game <b>running</b> — constants hot-reloaded (recompile-and-restart loop &lt; 3s, or a
debug raygui slider panel, Ch 5). Tuning by edit-compile-play cycles of 30s kills iteration; protect
the loop.`)}
${note(`Design target used throughout: at 60Hz, one tick moves the player 5.3px — smaller than a tile.
That is why axis-separated resolution never skips geometry. If speeds exceed ~tile/2 per tick, you need
swept tests or substeps (Ch 11 revisits with physics engine).`)}
`);

S(6, 'Playtesting Checklist — Gameplay QA', `
${lead(`Before calling actors done, run the checklist a QA engineer would run — each line maps to a system
from this chapter.`)}
${ul(`
<li>Walk into every wall type: <b>no snag</b> on tile seams (merged boxes, axis order).</li>
<li>Jump from every ledge in level 1 <b>late</b>: coyote catches it.</li>
<li>Press jump 0.1s <b>before</b> landing on each platform: buffer catches it.</li>
<li>Tap vs hold jump on flat ground: two distinct heights.</li>
<li>Collect a coin at its very corner pixels: still collected (magnet box).</li>
<li>Take a hit mid-jump: knockback direction reads correctly (away from hazard).</li>
<li>Take two hits within 1.5s: second is free (i-frames) + visible flicker.</li>
<li>Dive onto a porcupine from above: you are hit, not standing on it (box order).</li>
<li>Fall out of the world: life lost, respawn snap, no camera pan over the void.</li>
<li>Reach 0 lives: world freezes, overlay animates in, retry restores everything.</li>
<li>Grab a feather mid-air: air jump available immediately; expiry mid-air is fair.</li>
<li>Lose a life at 999990 points: score display never shifts width (Ch 5 rule).</li>`)}
${bp(`Automate what you can: a &ldquo;dummy player&rdquo; bot that walks right and jumps on intervals, run in CI
headless (World has no window dependencies — Ch 3 pays off). Crash/softlock detection while you sleep.`)}
${pit(`The classic post-Chapter-6 bug: <b>standing on a killed hazard's old collision</b>. Culling must
remove entities from both the objects array AND the broadphase grid next tick — verify the grid rebuild
really follows the cull.`)}
`);

S(6, 'Chapter 6 Summary — Key Takeaways', `
${lead(`Canyon Hopper is a <b>game</b> now: you can lose, win, collect, and die trying.`)}
<ul class="check">
  <li>Archetypes (collectible / power-up / hazard / avatar / goal) = one data-uniform struct + zeroed unused fields.</li>
  <li>Hitboxes are design: inset solids, expand pickups, shrink lethals.</li>
  <li><code class="inl">GetCollisionRec</code> gives collision + direction; resolve <b>one axis at a time</b> vs merged terrain boxes.</li>
  <li>Uniform grid broadphase (cell ≈ object size) turns O(N²) into O(N); rebuild after integration, before interactions.</li>
  <li>Modern feel = coyote + input buffer + variable jump — 6 lines, massive difference.</li>
  <li>Triggers emit <b>buffered events</b>, flushed after systems run; handlers never mutate mid-loop.</li>
  <li>Damage: knockback away from hazard, i-frame flicker, camera shake; death locks the camera.</li>
  <li>Overlays dim a <b>frozen-but-drawn</b> world; their own clock keeps animating.</li>
</ul>
<h3>Carrying forward</h3>
<p>Core loop done — time for the shell around it. Chapter 7: <b>screens, state machines, menus, and
persistent settings</b>.</p>
${bp(`Checkpoint: all 12 QA lines pass; a friend plays level 1 without instructions and smiles at least
once (usually the coin pickups). That smile is the spec.`)}
`);
