/* Chapter 11 — Advanced Programming Techniques */
defChapter(11, {
  tag: 'Advanced',
  title: 'Advanced Programming Techniques',
  sub: '2D physics with physac, level design tooling, win/loss systems, custom shaders, and alternative inputs.',
  color: '#60a5fa',
  topics: ['2D physics: bodies, shapes, fixtures', 'Integrating physac into the project', 'Sim/render sync & debug draw',
    'Spawning, goals, win/loss, progression', 'Custom shaders & post-processing', 'Tilt, virtual joysticks, gestures']
});

SEC(11);

S(11, 'What a Physics Engine Actually Buys You', `
${lead(`Chapters 3–6 moved things by hand. A physics engine gives you <b>emergent behavior</b>: stacks
that topple, bridges that sag, debris that bounces — interactions you never explicitly programmed.`)}
${tbl(['Hand-rolled (Ch 6)', 'Physics engine (this chapter)'], [
  ['You move; world resolves', 'Engine integrates ALL bodies, then resolves'],
  ['Perfect control, predictable', 'Emergent: weight, momentum, torque'],
  ['Player + tiles = ideal fit', 'Crates, ropes, ragdolls, vehicles = ideal fit'],
  ['One-way interactions', 'Everything-vs-everything (via broadphase)'],
  ['Tuning = a few constants', 'Tuning = materials, masses, restitution…']
])}
${diag(
`  THE HYBRID TRUTH (what shipped games do)
   · PLAYER  → kinematic controller (Ch 6 style!) for feel
   · WORLD   → dynamic bodies for props/debris
   · TERRAIN → static bodies
   Our course: physac world + the Ch 6 player controller driving a
   kinematic-ish body → best of both, zero compromise.`, 'Player-feel meets world-physics')}
${bp(`Do NOT put the player under full dynamic simulation &ldquo;because realism&rdquo; — a rigidbody player
slides off slopes you want to stand on and bounces off walls you want to hug. Control the avatar; simulate
the junk.`)}
`);

S(11, 'Rigid Bodies — The State & Integration', `
${lead(`A rigid body = mass properties + state. The engine advances state with numerical integration every
fixed step — the same fixed-step philosophy as Chapter 3, now with momentum.`)}
${c`
// The conceptual model (physac implements this internally):
typedef struct RigidBody {
    // state
    Vector2 position;        // center of mass
    Vector2 velocity;
    float   angle, angularVelocity;
    // intrinsic
    float   mass, inverseMass;      // invMass=0 → infinite → static
    float   inertia, inverseInertia;
    float   restitution;            // bounciness 0..1
    float   friction;               // 0..1
    Vector2 forceAccum;             // cleared each step
    float   torqueAccum;
} RigidBody;

// Semi-implicit Euler — the workhorse integrator:
//   v += (gravity + force/mass) * dt     ← velocity FIRST
//   x += v * dt                          ← then position
// (implicit in velocity = stable when things stack)`}
${tbl(['Quantity', 'Unit', 'Feel knob'], [
  ['Mass', 'kg (arbitrary in 2D)', 'Heavier = harder to push, same fall speed'],
  ['Restitution', '0..1', '0 = clay, 0.4 = wood, 0.9 = rubber'],
  ['Friction', '0..1', 'Ice ramps vs grippy platforms'],
  ['Inertia', 'kg·m²', 'Spin resistance — crates barely, balls freely']
])}
${note(`Mass ≠ fall speed! A heavier body falls at the same acceleration; it only resists <i>forces</i>
more. If &ldquo;heavy things fall faster&rdquo; appears in your game, that is a design choice layered ON TOP of
physics (e.g., extra downward force), not physics.`)}
`);

S(11, 'Body Types — Static, Dynamic, Kinematic', `
${lead(`Three roles, three behaviors. Choosing wrong per object is the root of most &ldquo;physics feels
broken&rdquo; reports.`)}
${tbl(['Type', 'Moves?', 'Collides?', 'Examples in Canyon Hopper'], [
  ['<b>Static</b>', 'Never (infinite mass)', 'Pushes everything', 'Ground tiles, canyon walls, platforms'],
  ['<b>Dynamic</b>', 'Forces + collisions', 'Full response', 'Crates, rocks, debris, the lily pads'],
  ['<b>Kinematic</b>', 'Only by your code', 'Pushes dynamics (unaffected by them)', 'Moving platforms, doors, player proxy']
])}
${c`
// physac: types via the rigidbodyType field
PhysicsBody b = CreatePhysicsBodyRectangle(pos, 64, 64, 1.0f);

b->rigidbodyType = PHYSICS_STATIC;     // frozen forever
b->rigidbodyType = PHYSICS_KINEMATIC;  // you set velocity; it never reacts
// default: PHYSICS_DYNAMIC

// Kinematic moving platform — velocity only, never position:
PhysicsBody plat = CreatePhysicsBodyRectangle(
    (Vector2){ 400, 300 }, 160, 24, 1.0f);
plat->rigidbodyType = PHYSICS_KINEMATIC;
plat->velocity = (Vector2){ 60, 0 };      // rides right forever
// player standing on it? rides along — collision solver carries them
`}
${pit(`Moving a static body by teleporting <code class="inl">body->position</code> every frame makes it an
unstoppable ram that shoves dynamics violently (or tunnels). Moving platforms are
<b>KINEMATIC + velocity</b>, not static + teleport.`)}
`);

S(11, 'Collision Shapes & Fixtures', `
${lead(`The shape is what collides; the body is what moves. physac couples them simply (one shape per
body); classic engines (Box2D) generalize into <b>fixtures</b> — multiple shapes, each with own material.`)}
${c`
// physac shape zoo:
PhysicsBody circle = CreatePhysicsBodyCircle(
    (Vector2){100, 100}, 24.0f,          // radius
    1.0f);                               // density → mass

PhysicsBody box = CreatePhysicsBodyRectangle(
    (Vector2){200, 100}, 64, 32, 0.5f);  // w,h + density

PhysicsBody poly = CreatePhysicsBodyPolygon(
    (Vector2){300, 100}, 32.0f, 5,       // radius, SIDES (pentagon)
    1.0f);

// Density: mass = density × area — design in kg via density, not magic mass
float mass = box->mass;      // engine computed from size × density

// Material tuning on any body:
box->restitution = 0.3f;     // mild bounce
box->friction    = 0.4f;     // wood-ish`}
${tbl(['Shape', 'Best for', 'Watch out'], [
  ['Circle', 'Rolling, balls, barrels', 'Never rests perfectly on slopes'],
  ['Rectangle (OBB)', 'Crates, platforms, tiles', 'Corners snag — chamfer art &amp; shape'],
  ['Polygon (n-gon)', 'Rocks, organic props', 'Keep convex &lt; 8 vertices'],
  ['Edge/chain (Box2D)', 'Terrain contours', 'physac: use many thin static rects instead']
])}
${bp(`Shape <b>smaller than art</b> — the Ch 6 hitbox law, now with momentum: a crate whose shape matches
its chunky pixels will catch on every seam. 10–15% inset on dynamic shapes; players never see it, they
feel it.`)}
`);

S(11, 'physac — Setup & Stepping', `
${lead(`physac is a single-header 2D engine tuned for raylib. Setup is four calls; the step model mirrors
our fixed-timestep loop exactly.`)}
${c`
// src/physics/PhysicsWorld.c
#define PHYSAC_IMPLEMENTATION      // in impl_deps.c ONLY (Ch 1 law!)
#include "physac.h"

void PhysicsInit(FixedStep step) {
    InitPhysics();
    SetPhysicsGravity(0, 900.0f);          // px/s²  (y-down world!)
    SetPhysicsTimeStep(1.0f / 60.0f);      // MATCH the game tick (Ch 3!)
    // physac can run its own thread; we step MANUALLY for determinism:
    // (build with PHYSAC_NO_THREADS or call manually as below)
}

void PhysicsTick(void) {
    UpdatePhysics();       // advances one fixed step, solves contacts
    // if bodies moved, grab their transforms for rendering (next slides)
}

void PhysicsShutdown(void) {
    ClosePhysics();        // frees all bodies & internal state
}`}

${diag(
`  GAME LOOP (Ch 3)                     PHYSAC
  ─────────────────                    ──────
  fixed tick 60Hz ──────────────────▶ UpdatePhysics()
     ├─ player controller (kinematic)   ├─ integrate dynamics
     ├─ apply gameplay forces           ├─ broadphase pairs
     └─ read back positions for draw    └─ solve contacts ×N iters`, 'One tick, one physics step — always in lockstep')}
${pit(`<code class="inl">SetPhysicsTimeStep</code> must equal <code class="inl">FIXED_DT</code>. If physics
steps at 50Hz while the game ticks at 60Hz, everything physical <b>drifts</b> — bodies visibly desync from
input. One constant, one truth (Ch 3 law).`)}
`);

S(11, 'Creating Bodies from Level Data', `
${lead(`Level JSON (Ch 4) now spawns <b>physics bodies</b> alongside GameObjects. The spawn table grows a
physics column — data-driven, as always.`)}
${c`
// Extend the Ch 5 spawn entries with physics intent:
typedef enum { PHYS_NONE, PHYS_STATIC_BOX, PHYS_DYNAMIC_BOX,
               PHYS_CIRCLE, PHYS_KINEMATIC } PhysRole;

static const SpawnEntry SPAWN_TABLE[] = {
    // type        spawnFn          layer         phys
    { "player",    SpawnPlayer,     LAYER_ACTORS, PHYS_NONE },   // Ch 6 ctrl
    { "crate",     SpawnCrate,      LAYER_ACTORS, PHYS_DYNAMIC_BOX },
    { "rock",      SpawnFallingRock,LAYER_ACTORS, PHYS_DYNAMIC_CIRCLE },
    { "platform",  SpawnPlatform,   LAYER_TERRAIN, PHYS_STATIC_BOX },
    { "mover",     SpawnMover,      LAYER_TERRAIN, PHYS_KINEMATIC },
};

static void SpawnCrate(GameObject *g, const GameObjectDef *d,
                       AssetManager *a) {
    g->ren.atlasRegion = AssetsRegion(a, "crate");
    PhysicsBody b = CreatePhysicsBodyRectangle(
        g->tf.pos, 48, 48, 0.6f);
    b->friction = 0.5f;  b->restitution = 0.15f;
    b->userData = g;                 // back-pointer: body → object
    g->physBody = b;                 // object → body (sync pair)
}

// Terrain: one static body per MERGED box (Ch 5 runs — not per tile!)
for (int i = 0; i < level->solidCount; i++) {
    PhysicsBody s = CreatePhysicsBodyRectangle(
        (Vector2){ box.x + box.width/2, box.y + box.height/2 },
        box.width, box.height, 1.0f);
    s->rigidbodyType = PHYSICS_STATIC;
}`}
${bp(`The <b>merged terrain boxes</b> from Chapter 5 pay off twice: fewer physics bodies (30 vs 840)
and no phantom seams between tile bodies for dynamics to catch on.`)}
`);

S(11, 'Forces, Impulses & Velocity Control', `
${lead(`Three ways to move a body — each correct for a different situation. Know the taxonomy, avoid the
per-frame-force trap.`)}
${c`
// 1) FORCE — continuous, mass-dependent (per step, like gravity):
PhysicsAddForce(crate, (Vector2){ 0, -9000.0f });   // wind gust upward

// 2) IMPULSE — instant velocity change (knockback, jumps, explosions):
PhysicsAddForce?  no — impulse via velocity math for exact control:
crate->velocity = Vector2Add(crate->velocity,
                             Vector2Scale(dir, 300.0f));  // px/s kick

// 3) DIRECT VELOCITY — when gameplay owns the motion:
//    kinematic platforms, "magnet" pickups, conveyor belts:
belt->velocity = (Vector2){ 120, 0 };      // set, don't accumulate

// The trap everyone hits once:
void WrongWind(float dt) {
    PhysicsAddForce(crate, (Vector2){ 5000, 0 });   // EVERY FRAME?
}
// forces accumulate within a step and are CLEARED each step —
// apply per STEP from the tick (constant = constant result), never
// per RENDER FRAME (double-applies at 120Hz vs 60Hz!).`}
${tbl(['Method', 'Mass matters?', 'Accumulates?', 'Use for'], [
  ['<code class="inl">PhysicsAddForce</code>', 'Yes (a=F/m)', 'Cleared per step', 'Continuous fields: wind, water flow, thrusters'],
  ['Velocity kick', 'No', 'You add it once', 'Knockback, jumps, explosions'],
  ['Set <code class="inl">velocity</code>', 'No', 'You own it', 'Kinematics, gameplay rails, belts']
])}
${pit(`Applying forces per <b>render frame</b> instead of per <b>tick</b> double-strengths them at high FPS
(every frame ≠ every tick on 144Hz). All physics writes live inside the fixed step — Ch 3's law, now
load-bearing.`)}
`);

S(11, 'Reading Collisions — Contacts & Events', `
${lead(`Gameplay needs <b>contact knowledge</b>: crate lands on the pressure plate, rock hits the player.
physac exposes body state to poll; we wrap it into the Ch 6 event bus.`)}
${c`
// Poll bodies each tick, translate into gameplay events:
void SystemPhysicsEvents(World *w) {
    for (int i = 0; i < w->objectCount; i++) {
        GameObject *g = &w->objects[i];
        if (!g->alive || !g->physBody) continue;
        PhysicsBody b = g->physBody;

        // grounded: touching something below this step
        if (b->isGrounded && !g->gp.wasGrounded)
            EventsEmit(EV_PHYS_LANDED, g, NULL);

        // velocity snapshot for impact strength (before solver zeroes it)
        float speed = Vector2Length(b->velocity);

        // overlaps with sensors stay in OUR hands (Ch 6 grid/AABB):
        // triggers were never physics — keep them cheap & simple
    }
}

// Pressure plates: static-ish body + our overlap check vs crates:
void SystemPressurePlates(World *w) {
    for (plate in plates) {
        bool pressed = AnyDynamicBodyOverlaps(plate->sensorBox);
        if (pressed && !plate->wasPressed) {
            EventsEmit(EV_PLATE_PRESSED, plate, NULL);   // door opens
            SoundPlay(&w->sound, "sfx_clunk");
        }
        plate->wasPressed = pressed;
    }
}`}

${note(`Why sensors stay hand-rolled: triggers are <i>questions</i> (&ldquo;is the player in this zone?&rdquo;),
not interactions. Physics engines exist to resolve momentum; zones only need
<code class="inl">CheckCollisionRecs</code>. Cheaper, deterministic, and testable (Ch 6).`)}
`);

S(11, 'Sim–Render Sync & the Player Body', `
${lead(`Two sync problems: bodies move the <b>renderer's</b> objects each tick, and the Ch 6 player must
coexist with the physics world. Both are one function each.`)}
${c`
// 1) BODY → OBJECT sync (in the fixed tick, after UpdatePhysics):
void SystemSyncFromPhysics(World *w) {
    for (int i = 0; i < w->objectCount; i++) {
        GameObject *g = &w->objects[i];
        if (!g->alive || !g->physBody) continue;
        g->tf.prevPos = g->tf.pos;                  // Ch 3 interpolation!
        g->tf.pos = g->physBody->position;
        g->tf.vel = g->physBody->velocity;
        g->ren.rotation = g->physBody->orient * RAD2DEG;
        SyncBounds(g);
    }
}

// 2) PLAYER → BODY sync (controller drives, physics obeys):
void SystemPlayerPhysicsBridge(World *w, float dt) {
    GameObject *p = w->player;
    PhysicsBody b = p->physBody;              // created PHYSICS_KINEMATIC
    // Ch 6 controller computed desired velocity:
    b->velocity = p->tf.vel;                  // push intent INTO the world
    // after UpdatePhysics, sync back (function 1) — the player now
    // rides kinematic platforms & gets shoved by falling crates!
    // (crates CAN push the kinematic player: kinematic vs dynamic
    //  contacts still displace... if not, add a dynamic proxy body)
}`}
${tbl(['Artifact', 'Cause', 'Fix'], [
  ['Jittery physics objects', 'Sync per render frame', 'Sync once per TICK; interpolate (prevPos)'],
  ['Player falls through moving platform', 'Teleporting static platform', 'Kinematic + velocity'],
  ['Crate tunnels through thin wall at high speed', 'Step too coarse for speed', 'Cap speeds, thicken walls, or substep (slide 13)']
])}
${bp(`Reuse Chapter 3's <b>interpolation</b> for physics objects — the machinery already exists
(<code class="inl">RenderPos(g, alpha)</code>). Physics at 60Hz rendered at 144Hz is the same problem
as gameplay at 60 rendered at 144.`)}
`);

S(11, 'Physics Debug Drawing', `
${lead(`You cannot tune what you cannot see. Ship a physics overlay: bodies, velocities, contacts,
sleeping — mapped onto ${kbd('F1')} next to hitboxes.`)}
${c`
// Debug draw, in world space, over the normal frame:
void PhysicsDebugDraw(World *w) {
    int count = GetPhysicsBodiesCount();
    for (int i = 0; i < count; i++) {
        PhysicsBody b = GetPhysicsBody(i);
        Color col = b->isGrounded ? GREEN
                  : b->rigidbodyType == PHYSICS_STATIC ? GRAY
                  : b->isAwake ? SKYBLUE : DARKBLUE;      // sleeping!

        int vc = GetPhysicsShapeVerticesCount(i);
        for (int v = 0; v < vc; v++) {
            Vector2 a = GetPhysicsShapeVertex(b, v);
            Vector2 c = GetPhysicsShapeVertex(b, (v + 1) % vc);
            DrawLineV(a, c, col);
        }
        // velocity vector: where will it be in 0.25s?
        DrawLineV(b->position, Vector2Add(b->position,
            Vector2Scale(b->velocity, 0.25f)), YELLOW);
    }
    DrawText(TextFormat("bodies %d", count), 12, 118, 16, ORANGE);
}`}
${tbl(['Color code', 'Means'], [
  ['Gray', 'Static — should never move'],
  ['Sky blue', 'Awake dynamic'],
  ['Dark blue', 'Sleeping (free — encourage it!)'],
  ['Green outline', 'Grounded this step'],
  ['Yellow line', 'Velocity × 0.25s — spot tunneling risks']
])}
${note(`<b>Sleeping</b> bodies cost ~nothing: bodies at rest for a while are skipped until touched. A pile
that never sleeps (micro-jitter) is a tuning bug — raise sleep thresholds or fix restitution/friction
until stacks settle.`)}
`);

S(11, 'Physics Tuning & Stability Clinic', `
${lead(`Physics &ldquo;feels wrong&rdquo; is diagnosable. The five classic ailments, their symptoms, and cures —
print this slide for the wall.`)}
${tbl(['Symptom', 'Disease', 'Cure'], [
  ['Stacks jitter/sink slowly', 'Solver iterations too low / soft contacts', 'Raise solver iterations; reduce mass ratios (heavy-on-light ≤ 10:1)'],
  ['Objects vibrate when resting', 'Restitution too high / tiny bodies', 'restitution ≤ 0.2 for props; min body size ≥ ~8px'],
  ['Crate sinks into floor over minutes', 'Deep penetration accumulation', 'Fewer bodies stacked; larger shapes; positional-correction bias up'],
  ['Fast rock passes through thin floor', 'Tunneling', 'Cap velocity, thicken statics, or substep: 2× half-steps'],
  ['Everything explodes on level start', 'Bodies spawned overlapping', 'Validate spawn spacing at load (Ch 4 validator, now for physics)']
])}
${c`
// Substepping when fast things must not tunnel:
void PhysicsTickSubstep(World *w) {
    for (rock in fastBodies)                 // only the risky ones
        if (Vector2Length(rock->physBody->velocity) > 900.0f) {
            // split this tick: 2 half-steps for the WHOLE world
            SetPhysicsTimeStep(FIXED_DT / 2.0f);
            UpdatePhysics(); UpdatePhysics();
            SetPhysicsTimeStep(FIXED_DT);    // restore
            return;
        }
    UpdatePhysics();                          // normal single step
}`}
${bp(`Tune with the <b>debug draw on</b> and one variable at a time. Physics parameters interact
(friction ↔ restitution ↔ mass ratios); two knobs at once and you chase your tail.`)}
`);

S(11, 'Visual Editors & Level Design Tooling', `
${lead(`Studios edit physics in visual tools (RUBE for Box2D) and export JSON. Our pipeline: <b>Tiled +
properties</b> covers the same 90%, staying in formats Chapter 4 already owns.`)}
${json`
{ "objects": [
  { "type": "crate", "x": 14, "y": 6,
    "props": { "density": 0.8, "friction": 0.5, "restitution": 0.1 } },
  { "type": "mover", "x": 20, "y": 9, "w": 5,
    "props": { "range": 240, "speed": 60, "axis": "x" } },
  { "type": "plate", "x": 26, "y": 11,
    "props": { "target": "door_3" } }
]}
`}
${c`
// The loader reads "props" generically → every physical knob is data:
static void ApplyPhysicsProps(PhysicsBody b, const cJSON *props) {
    if (!props) return;
    b->friction    = ReqFloat(props, "friction", 0.4f);
    b->restitution = ReqFloat(props, "restitution", 0.1f);
    b->gravityScale= ReqFloat(props, "gravityScale", 1.0f);
}`}
${tbl(['Editor workflow', 'Tool', 'Export'], [
  ['Level layout + entity placement', 'Tiled (free)', 'JSON — our Ch 4 subset'],
  ['Physics parameter tweaks', 'Tiled custom properties', 'props block above'],
  ['Live tuning while running', 'In-game F8 panel (Ch 8 editor loop)', 'writes back to JSON']
])}
${bp(`Give designers the <b>in-game editor loop</b>: run game → F8 tweaks restitution live → export
JSON → commit. A designer waiting on a programmer to recompile for a friction tweak is a studio
tax you never need to pay again.`)}
`);

S(11, 'Gameplay: Spawning Mechanics', `
${lead(`With physics running, spawning becomes rich: mine carts that drop rocks, geyser launchers, timed
crate dispensers. All built from one budgeted spawner.`)}
${c`
// src/actors/Spawner.c
typedef struct Spawner {
    Vector2   at;
    const char *spawnType;      // "crate" | "rock"…
    float     interval;         // 0 = event-only
    float     accum;
    int       budget;           // alive cap (perf + design)
    float     spawnVelocity;    // initial kick
} Spawner;

void SystemSpawners(World *w, float dt) {
    for (sp in w->spawners) {
        // alive count tracked via object kind scan (cheap at our scale)
        int alive = CountAlive(w, sp->spawnType);
        if (alive >= sp->budget) continue;

        sp->accum += dt;
        if (sp->accum >= sp->interval) {
            sp->accum = 0;                      // no -= : no debt spiral
            GameObject *g = SpawnByType(w, sp->spawnType, sp->at);
            if (g && g->physBody)
                g->physBody->velocity = (Vector2){ 0, sp->spawnVelocity };
            SoundPlay(&w->sound, "sfx_plop");   // audible machinery
        }
    }
}

// Event-driven spawn: plate pressed → drop a reward crate
static void OnPlatePressed(const Event *e, World *w) {
    SpawnByType(w, "crate", w->rewardDropPoint);
}`}
${pit(`Reset <code class="inl">accum = 0</code> on fire, not <code class="inl">accum -= interval</code>, when
interval &gt; tick: the subtraction pattern builds a &ldquo;debt&rdquo; after a stall and machine-guns to
&ldquo;catch up&rdquo;. For fast spawners (interval &lt; tick) keep the subtraction — same fractional rule as
Ch 8 emitters.`)}
`);

S(11, 'Gameplay: Goals, Win & Loss Conditions', `
${lead(`The goal flag exists since Ch 5; physics completes the fantasy — a <b>stack the crates</b> puzzle
goal, weight plates, timed runs. Conditions become data per level.`)}
${json`
{ "goal": {
    "type": "reach",        // reach | stack | collect | survive
    "x": 57, "y": 11
},
"conditions": {
    "lose": [ "fall", "timeout:180", "lives:0" ],
    "optional": [ "coins:80%", "time:120" ]     // star ratings (next)
} }
`}
${c`
// Evaluator runs each tick — conditions are tiny predicates:
static void SystemGoalCheck(World *w) {
    switch (w->goal.type) {
    case GOAL_REACH:
        if (CheckCollisionRecs(player.box, goal.box))
            EventsEmit(EV_LEVEL_WIN, w->player, goal->obj);
        break;
    case GOAL_STACK: {         // build a tower to the target line
        Rectangle zone = w->goal.zone;
        int inZone = 0;
        for (crate in dynamics)
            if (CheckCollisionRecs(crate.box, zone)) inZone++;
        if (inZone >= w->goal.needCrates)
            EventsEmit(EV_LEVEL_WIN, NULL, goal->obj);
        break;
    }
    case GOAL_SURVIVE:
        if (w->levelTime > w->goal.duration)
            EventsEmit(EV_LEVEL_WIN, NULL, NULL);
        break;
    }
    // lose conditions: fall-out (Ch 6), timeout, lives
    if (w->levelTime > w->timeout) EventsEmit(EV_LEVEL_LOSE, NULL, NULL);
}`}
${bp(`Fire the win event <b>once</b> (guard with a state flag) and let the Ch 8 choreography + Ch 9
transition own everything after. The condition evaluator's job ends at raising the event — keep it
side-effect-free.`)}
`);

S(11, 'Gameplay: Level Progression', `
${lead(`Levels end → progress persists (Ch 7 saves) → next level flows in behind a transition. The
progression table is pure data; the flow is three hooks.`)}
${c`
// src/core/Progression.c
static const struct { const char *file; int parTime; } LEVELS[] = {
    { "level_01.json", 150 }, { "level_02.json", 210 },
    { "level_03.json", 300 },
};

static void OnLevelWin(const Event *e, World *w) {
    Game *g = w->game;
    g->stars[g->levelIndex] = RateStars(w, LEVELS[g->levelIndex].parTime);
    ProgressRecordWin(g, g->levelIndex);      // Ch 7 save on event

    g->levelIndex++;
    bool more = g->levelIndex < ARRAY_LEN(LEVELS);

    // route: next level behind Ch 9 wipe; or finale
    GoTo(&g->screens, more ? &ScreenGame : &ScreenCredits,
         TR_INTENT_LEVEL_FLOW);
    // ScreenGame.enter (Ch 7) reloads world at g->levelIndex — already wired!

    // completion: unlock gates the menu (Continue / level select)
    if (!more) g->progress.gameComplete = true;
}

static int RateStars(const World *w, int parTime) {
    int stars = 1;                                     // finished = 1 star
    if (w->coinsThisLevel >= w->coinsTotal * 0.8f) stars++;   // collector
    if (w->levelTime <= parTime) stars++;                     // speedrun
    return stars;
}`}
${tbl(['Flow moment', 'Owner'], [
  ['Detect win/lose', 'Condition evaluator (this chapter)'],
  ['Rate & record', 'Progression (stars → Ch 7 progress file)'],
  ['Feel the win', 'Ch 8 choreography stack'],
  ['Change level', 'Ch 9 transition → ScreenGame.enter reload'],
  ['Show the map', 'Level-select menu builds from progress state']
])}
${note(`Level select = the Ch 7 menu builder reading <code class="inl">progress.unlockedLevel</code> —
buttons exist per unlocked level, stars render under each. Zero new UI systems; state drives the
graph, exactly as CONTINUE did.`)}
`);

S(11, 'Shaders — The Pipeline Model', `
${lead(`Now the graphics deep-end. A shader is a program running <b>on the GPU</b>, once per vertex or
per pixel. Chapter 9 used them for wipes; this section makes you fluent.`)}
${diag(
`  CPU (your C code)                     GPU pipeline
  ─────────────────                     ─────────────────────────
  DrawTexturePro ──batch──▶  ┌─ VERTEX shader: where on screen?
  SetShaderValue uniforms ─▶ │    (position, rotation, UV transform)
  SetShaderValueTexture ───▶ ├─ rasterizer: which pixels?
  BeginShaderMode ─────────▶ └─ FRAGMENT shader: what color?
                                   (your per-pixel math)`, 'Two stages you can program; uniforms are the bridge')}
${tbl(['Concept', 'In raylib', 'In GLSL'], [
  ['Program', '<code class="inl">LoadShader(vsFile, fsFile)</code>', '<code class="inl">#version 330 core</code>…'],
  ['Parameter slot', '<code class="inl">GetShaderLocation(s, "name")</code>', '<code class="inl">uniform float name;</code>'],
  ['Feed a value', '<code class="inl">SetShaderValue(s, loc, &v, TYPE)</code>', 'read-only in shader'],
  ['Feed a texture', '<code class="inl">SetShaderValueTexture</code>', '<code class="inl">uniform sampler2D</code>'],
  ['Built-in vertex inputs', '— (rlgl provides)', '<code class="inl">aVertexPosition, aTexCoord</code>…']
])}
${note(`raylib injects useful defaults into every shader: <code class="inl">uniform mat4 mvp</code> and
texture <code class="inl">texture0</code> + <code class="inl">vec2 textureSize</code>. That is why a
5-line fragment shader can tint the whole screen — the plumbing is pre-built (rlgl).`)}
`);

S(11, 'GLSL Syntax Survival Guide', `
${lead(`GLSL is C's cousin: typed, vector-first, and weirdly strict about implicit conversion. Ten rules
cover everything this course writes.`)}
${glsl`
#version 330 core               // or 120 for max compatibility
// types: float vec2 vec3 vec4 | int ivec2.. | mat3 mat4 | sampler2D
uniform float uTime;            // set from C each frame
uniform vec2  uResolution;
uniform sampler2D uMask;        // extra texture (SetShaderValueTexture)
in vec2 fragTexCoord;           // from vertex stage (raylib default VAO)
out vec4 finalColor;            // ONE output: the pixel color

float saturate1(float x) {      // functions like C; swizzling is the magic:
    return clamp(x, 0.0, 1.0);  //   v.xy, v.rgb, v.xzy — any combo
}
void main() {
    vec2 uv = fragTexCoord;                     // 0..1 across quad
    vec3 tex = texture(uMask, uv).rgb;          // sample (GLSL 330)
    vec3 tint = vec3(1.0, 0.9, 0.8);
    float pulse = 0.5 + 0.5 * sin(uTime * 2.0); // animate from C time
    finalColor = vec4(tex * tint * pulse, 1.0); // RGBA out, always
}`}
${tbl(['Rule', 'Consequence'], [
  ['No implicit int→float', '<code class="inl">float x = 1;</code> errors — write <code class="inl">1.0</code>'],
  ['Constructors are casts', '<code class="inl">vec3(1.0)</code>, <code class="inl">vec2(1,2)</code> — wait, no: <code class="inl">vec2(1.0,2.0)</code>'],
  ['Swizzle freely', '<code class="inl">v.xyz, v.bgr, v.xx</code> — free, vectorized'],
  ['<code class="inl">texture(s, uv)</code> (330) vs <code class="inl">texture2D</code> (120)', 'Pick per target GL version'],
  ['Everything is parallel', 'No loops over pixels; you write ONE pixel&rsquo;s math']
])}
${pit(`A shader that compiles on your desktop (GL 4.6) can fail on web (WebGL2≈GL 330) or old laptops
(2.1). Target <b>#version 120 or 330</b> per platform matrix — raylib examples default to 120 + 330
pairs precisely for this reason.`)}
`);

S(11, 'Uniforms — Feeding Data from C', `
${lead(`The uniform lifecycle is strict: locate once, set often, types must match exactly. Wrap it in a
tiny cache and shaders become boring — the good kind of boring.`)}
${c`
// src/gfx/ShaderCache.c — locate ONCE at load, never per frame
typedef struct CachedShader {
    Shader sh;
    int uTime, uResolution, uProgress;
    int uScene, uMask;        // sampler slots
} CachedShader;

CachedShader LoadPostShader(const char *fsPath) {
    CachedShader c = {0};
    c.sh = LoadShader(NULL, fsPath);      // NULL vs = raylib default
    c.uTime       = GetShaderLocation(c.sh, "uTime");
    c.uResolution = GetShaderLocation(c.sh, "uResolution");
    c.uProgress   = GetShaderLocation(c.sh, "uProgress");
    return c;
}

// per frame — set BEFORE/in BeginShaderMode draws:
void ApplyPostUniforms(CachedShader *c, float t) {
    float time = t;
    Vector2 res = { (float)GetScreenWidth(), (float)GetScreenHeight() };
    SetShaderValue(c->sh, c.uTime, &time, SHADER_UNIFORM_FLOAT);
    SetShaderValue(c->sh, c.uResolution, &res, SHADER_UNIFORM_VEC2);
}
// types: FLOAT | VEC2 | VEC3 | VEC4 | INT | IVEC2.. | SAMPLER2D`}
${tbl(['Mistake', 'Symptom', 'Rule'], [
  ['<code class="inl">GetShaderLocation</code> per frame', 'Silent perf drain', 'Cache locations at load'],
  ['Wrong uniform type enum', 'Garbage values / no effect', 'Match GLSL type exactly (float vs vec2)'],
  ['Optimized-out uniform', 'Location = −1', 'Shader compiler strips unused — use it or lose it'],
  ['Setting after draw', 'No effect this frame', 'Uniforms apply at draw time']
])}
${bp(`Location −1 is not an error — it means &ldquo;name not found&rdquo; (typo) or &ldquo;unused, stripped&rdquo;.
Log it loudly in debug builds; catching a typo&rsquo;d uniform at load beats an afternoon of &ldquo;why is my
effect static?&rdquo;`)}
`);

S(11, 'Post-Processing — The RenderTexture Pattern', `
${lead(`Full-screen effects = render the game to an <b>offscreen texture</b>, then draw that texture
through a shader. The pattern (from Ch 5 &amp; 9, now canonical) powers everything from tint to CRT.`)}
${c`
// The 5-line skeleton — commit it to memory:
RenderTexture2D target = LoadRenderTexture(W, H);   // once!

BeginTextureMode(target);          // 1) game renders INTO texture
    GameDrawWorld(game, alpha);    //    (everything: world, HUD after?)
EndTextureMode();

BeginDrawing();                    // 2) now the real backbuffer
    BeginShaderMode(post.shader);  // 3) effect ON while we blit
        ApplyPostUniforms(&post, t);
        Rectangle src = { 0, 0, W, -H };            // 4) Y-FLIP (GL!)
        DrawTexturePro(target.texture, src,
            (Rectangle){ 0, 0, W, H }, (Vector2){0,0}, 0, WHITE);
    EndShaderMode();
EndDrawing();                      // 5) swap`}
${diag(
`  [game draw] ──▶ RenderTexture ──▶ fullscreen quad ──▶ [fragment
                  (offscreen)        with shader          shader] ──▶ screen
  cost: 1 extra fullscreen render + 1 shader pass ≈ 1–3ms desktop`, 'Post pipeline: render → blit through shader')}
${pit(`Two evergreen bugs live here: forgetting the <b>Y-flip</b> (source height negative — game renders
upside-down) and drawing the <b>HUD into the target</b> (CRT scanlines over your menu text = unreadable).
World through the effect; HUD after <code class="inl">EndShaderMode</code>.`)}
`);

S(11, 'Custom Filter I — Tint, Sepia, Grayscale', `
${lead(`Color-space math on every pixel — the gateway shaders. Master these three and vignettes, day/night
cycles, and damage flashes are all the same skeleton.`)}
${glsl`
// assets/shaders/post_color.fs  (#version 120 style)
#version 120
uniform sampler2D texture0;      // raylib injects the scene here
uniform vec2 textureSize;
uniform float uAmount;           // 0 = original, 1 = full effect
uniform int   uMode;             // 0 tint 1 gray 2 sepia

void main() {
    vec2 uv = gl_TexCoord[0].xy;
    vec3 c = texture2D(texture0, uv).rgb;

    if (uMode == 1) {                       // grayscale: luminance
        float g = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(c, vec3(g), uAmount);
    } else if (uMode == 2) {                // sepia matrix
        vec3 s = vec3(dot(c, vec3(0.393, 0.769, 0.189)),
                      dot(c, vec3(0.349, 0.686, 0.168)),
                      dot(c, vec3(0.272, 0.534, 0.131)));
        c = mix(c, s, uAmount);
    }
    gl_FragColor = vec4(c, 1.0);
}`}
${c`
// C side: level themes ride the same uniform (Ch 4 "theme" block!):
float amount = level->theme.sepiaAmount;      // dusk = 0.35
int   mode   = 1;
SetShaderValue(sh, uAmount, &amount, SHADER_UNIFORM_FLOAT);
SetShaderValue(sh, uMode,   &mode,   SHADER_UNIFORM_INT);`}
${tbl(['Look', 'Math', 'Use'], [
  ['Grayscale', 'luminance dot product', 'Death flash, flashbacks'],
  ['Sepia', 'color matrix', 'Old-west theme levels'],
  ['Tint (multiply)', '<code class="inl">c * tintColor</code>', 'Underwater blue, poison green, cave dark'],
  ['Day/night', 'tint by time-of-day curve', 'Ch 8 wander + this = living world']
])}
`);

S(11, 'Custom Filter II — Vignette & CRT Scanlines', `
${lead(`The retro signature pass: barrel curve, scanlines, vignette, slight chromatic offset — one shader,
the whole 1980s.`)}
${glsl`
#version 120
uniform sampler2D texture0;
uniform vec2 textureSize;      // needed for pixel-accurate lines
uniform float uTime;

float vignette(vec2 uv) {
    vec2 d = uv - 0.5;                     // distance from center
    return 1.0 - dot(d, d) * 1.4;          // darken corners
}
void main() {
    vec2 uv = gl_TexCoord[0].xy;

    // 1) subtle barrel distortion (CRT bulge)
    vec2 cc = uv - 0.5;
    uv = uv + cc * dot(cc, cc) * 0.08;

    // 2) chromatic aberration: sample R/G/B at tiny offsets
    float ab = 0.0015;
    float r = texture2D(texture0, uv + cc * ab).r;
    float g = texture2D(texture0, uv).g;
    float b = texture2D(texture0, uv - cc * ab).b;
    vec3 c = vec3(r, g, b);

    // 3) scanlines: sin on the pixel's Y coordinate
    float scan = 0.92 + 0.08 * sin(uv.y * textureSize.y * 3.1415);
    c *= scan;

    // 4) vignette + slight phosphor tint
    c *= vignette(uv);
    c *= vec3(1.0, 0.98, 0.95);

    gl_FragColor = vec4(c, 1.0);
}`}
${bp(`Ship CRT as an <b>options toggle</b> (default off beyond a gentle vignette): a minority of players
genuinely get eye strain from scanline shimmer. Beauty that hurts a subset of your audience is a
settings item — you already have the infrastructure (Ch 7).`)}
`);

S(11, 'Custom Filter III — Water Ripple Distortion', `
${lead(`Ch 8's water gets its finale: <b>refract</b> the world behind the surface with scrolling sine
waves. Same post pipeline, sampling with displaced UVs.`)}
${glsl`
#version 120
uniform sampler2D texture0;    // the scene (pre-water!)
uniform float uTime;
uniform vec4  uWaterRect;      // screen-space water rectangle (C computes)

void main() {
    vec2 uv = gl_TexCoord[0].xy;
    vec3 c = texture2D(texture0, uv).rgb;

    // inside the water band?
    if (uv.y > uWaterRect.x && uv.y < uWaterRect.y) {
        float depth = (uv.y - uWaterRect.x) / (uWaterRect.y - uWaterRect.x);

        // scrolling dual sine = organic surface, matches Ch 8 buoyancy
        float w1 = sin(uv.x * 40.0 + uTime * 2.0);
        float w2 = sin(uv.x * 23.0 - uTime * 1.3);
        vec2 bend = vec2((w1 + w2) * 0.004, 0.0);

        c = texture2D(texture0, uv + bend * depth).rgb;  // refraction!
        c *= mix(vec3(0.75, 0.9, 1.0), vec3(0.4, 0.6, 0.95), depth);
    }
    gl_FragColor = vec4(c, 1.0);
}`}
${c`
// C computes the water band in SCREEN space for the uniform:
Vector2 top = GetWorldToScreen2D((Vector2){ 0, water.area.y }, cam);
Vector2 bot = GetWorldToScreen2D((Vector2){ 0, water.area.y + water.area.height }, cam);
Vector4 band = { top.y / H, bot.y / H, 0, 0 };      // normalized for shader
SetShaderValue(sh, uWater, &band, SHADER_UNIFORM_VEC4);`}
${note(`The wave math here and Chapter 8's buoyancy surface use the <b>same phase formula</b> — keep the
constants in one header so what the player SEES and what objects FLOAT on never disagree.`)}
`);

S(11, 'Vertex Shaders — Displacement & Wind', `
${lead(`Fragment shaders color pixels; <b>vertex shaders move geometry</b>. One uniform time + a sine =
grass that sways, flags that ripple, jelly platforms that wobble.`)}
${glsl`
// assets/shaders/wind.vs — raylib default vertex + wind offset
#version 120
attribute vec3 vertexPosition;    // raylib's default attribs
attribute vec2 vertexTexCoord;
uniform mat4 mvp;                 // raylib injects
uniform float uTime;
uniform float uWindStrength;
varying vec2 fragTexCoord;

void main() {
    fragTexCoord = vertexTexCoord;
    vec3 pos = vertexPosition;

    // sway amplitude by HEIGHT in the sprite (v coordinate):
    // roots planted (v=1 bottom), tips free (v=0 top)
    float sway = (1.0 - vertexTexCoord.y);
    pos.x += sin(uTime * 2.2 + pos.x * 0.05) * sway * uWindStrength;
    pos.y += cos(uTime * 1.7 + pos.x * 0.07) * sway * uWindStrength * 0.4;

    gl_Position = mvp * vec4(pos, 1.0);
}`}
${c`
// Apply to a whole GRASS LAYER: draw through this shader mode
BeginShaderMode(windShader);
SetShaderValue(windShader, uWind, &windGust, SHADER_UNIFORM_FLOAT);
DrawLayer(LAYER_PROPS_GRASS, w, a, alpha);   // nothing else changes!
EndShaderMode();`}
${pit(`Vertex displacement needs <b>geometry to bend</b>: a single quad has 4 vertices — it can only
shear, not ripple. Sub-divide the layer mesh (or draw grass in 2–3 horizontal strips) to give the
shader vertices to work with. Displacement is limited by topology, not math.`)}
`);

S(11, 'Alternative Input I — Tilt / Accelerometer', `
${lead(`Mobile Canyon Hopper: tilt the phone to steer. The platform seam (Ch 2) surfaces the sensor;
gameplay consumes an axis exactly like a thumbstick.`)}
${c`
// platform_android.c (behind the seam):
float PlatformTiltX(void) {          // -1..1, calibrated
    // from JNI: SensorManager ACCELEROMETER, x / gravity, clamped
    return clampf(g_accelX / 9.81f, -1.0f, 1.0f);
}

// core/Input.c — tilt feeds the SAME action pipeline:
float ActionAxisX(void) {
    float v = 0;
    if (ActionDown(ACT_LEFT))  v -= 1;
    if (ActionDown(ACT_RIGHT)) v += 1;
    if (v == 0 && plat.hasAccelerometer)
        v = PlatformTiltX() * tiltSensitivity;      // settings slider!
    return ClampF(v, -1, 1);
}

// Calibration ritual: hold phone comfortably → capture neutral:
void TiltCalibrate(void) { g_tiltNeutral = PlatformTiltX(); }
// settings screen: "Hold phone comfortably, then tap CALIBRATE"
float PlatformTiltX(void) { /* ... raw ... */ return raw - g_tiltNeutral; }`}
${tbl(['Tilt design rule', 'Why'], [
  ['Neutral-point calibration', 'People hold phones differently — never assume 0°'],
  ['Deadzone ~0.15', 'Hands are never still; without it the bunny drifts'],
  ['Sensitivity slider', 'Motion sickness protection — some players want 2× others'],
  ['Never required', 'Touch controls must always remain viable (Ch 2 capabilities)']
])}
${pit(`Accelerometer ≠ gyroscope: accel includes gravity AND hand tremor, and it's noisy. Filter it
(the Ch 8 damp), or steering feels like driving on ice with a bee in the cabin.`)}
`);

S(11, 'Alternative Input II — The Virtual Joystick', `
${lead(`Touch screens need thumbsticks that feel physical: a base, a drifting cap, deadzones, and a
visual state. One widget, done properly.`)}
${c`
// src/ui/VirtualPad.c
typedef struct VStick {
    Vector2 base;         // touch-down anchor (where the thumb landed)
    Vector2 cap;          // current cap position
    float   radius;       // 64px base radius
    float   deadzone;     // 0.18f inner
    bool    active;       // a finger owns it
    int     touchId;
} VStick;

void VStickUpdate(VStick *s) {
    if (!s->active) {                     // wait for a landing in the zone
        for (int i = 0; i < MAX_TOUCHES; i++)
            if (IsTouchEvent(i) && TouchInZone(i, s->zone)) {
                s->active = true; s->touchId = i;
                s->base = GetTouchPosition(i);
                s->cap  = s->base;        // stick forms WHERE you touch!
                break;
            }
        return;
    }
    Vector2 t = GetTouchPosition(s->touchId);
    Vector2 d = Vector2Subtract(t, s->base);
    float len = Vector2Length(d);
    if (!IsTouchEvent(s->touchId)) { s->active = false; return; }
    if (len > s->radius) {               // clamp cap to ring
        s->cap = Vector2Add(s->base,
                Vector2Scale(Vector2Normalize(d), s->radius));
        // option: "follow" — drag the base along for long swipes:
        s->base = Vector2Subtract(t, Vector2Scale(
                  Vector2Normalize(d), s->radius));
    } else s->cap = t;
}

Vector2 VStickValue(const VStick *s) {    // gameplay consumes THIS
    Vector2 d = Vector2Subtract(s->cap, s->base);
    float len = Vector2Length(d) / s->radius;
    if (len < s->deadzone) return (Vector2){0,0};
    return Vector2Scale(Vector2Normalize(d),      // normalized dir
                        (len - s->deadzone) / (1 - s->deadzone)); // mag 0..1
}`}
${bp(`The stick forms <b>where the thumb lands</b> (dynamic base), not at a fixed on-screen spot —
players never look down to align. Console-quality feel in 60 lines; fixed-position sticks are the #1
tell of a port that doesn't care.`)}
`);

S(11, 'Alternative Input III — Gestures', `
${lead(`raylib ships a gesture recognizer (tap, drag, swipe, pinch). Recognize the intent you mean —
never raw touch deltas — and gameplay stays one vocabulary richer.`)}
${c`
// Setup: enable what you use (cheaper + fewer false positives)
SetGesturesEnabled(GESTURE_TAP | GESTURE_SWIPE_RIGHT |
                   GESTURE_SWIPE_LEFT | GESTURE_PINCH);

void SystemGestures(World *w) {
    switch (GetGestureDetected()) {      // 5.5: GetGesture()
    case GESTURE_SWIPE_LEFT:
        if (screens.onMenu) MenuFocusPrev();
        break;
    case GESTURE_SWIPE_RIGHT:
        if (screens.onMenu) MenuFocusNext();
        break;
    case GESTURE_PINCH: {               // camera zoom (dev / map screen)
        float scale = GetGesturePinchScale? 1.0f :
                      GesturePinchDelta();   // via seam if not exposed
        VCamZoom(w->camRef, scale, VCamFocus());
        break;
    }
    case GESTURE_TAP:
        // route like a mouse click: focus + activate at point
        UiHandleTap(GetTouchPosition(0));
        break;
    default: break;
    }
}`}

${tbl(['Gesture', 'Gameplay meaning (ours)'], [
  ['Swipe L/R', 'Menu navigation, screens'],
  ['Tap', 'Activate / UI click'],
  ['Swipe up', 'Jump (alt to the virtual button)'],
  ['Hold + drag', 'Aim slingshot crates (bonus mode)'],
  ['Pinch', 'Zoom level map']
])}
${pit(`Gestures are <b>discrete post-hoc recognition</b> — a swipe is only known after it finished, so
never gate second-to-second controls on them. Jump-on-swipe feels laggy; jump-on-virtual-button
(+ optional swipe-up) feels instant.`)}
`);

S(11, 'Chapter 11 Summary — Key Takeaways', `
${lead(`Physics, shaders, and new inputs are now native tools, not mysteries.`)}
<ul class="tight">
<li>Bodies: <b>static world, dynamic props, kinematic machinery</b>; the player keeps its Ch 6 controller.</li>
<li>Shapes smaller than art; density defines mass; friction/restitution per material.</li>
<li><code class="inl">UpdatePhysics</code> in <b>lockstep</b> with the fixed tick; forces per tick, never per frame.</li>
<li>Sync body→object once per tick with <code class="inl">prevPos</code> interpolation; debug draw colors tell the story.</li>
<li>Stability clinic: mass ratios, restitution caps, substep fast objects, validate spawn spacing.</li>
<li>Level JSON carries physics props; in-game editor loop exports live tuning.</li>
<li>Goals/win/lose are data-driven predicates → events; progression rides Ch 7 saves + Ch 9 transitions.</li>
<li>Shaders: vertex moves, fragment colors; cached uniforms; RenderTexture post pipeline (Y-flip!).</li>
<li>Filter catalog: tint/gray/sepia, vignette/CRT, water refraction, wind displacement — all one pattern.</li>
<li>Inputs: calibrated tilt with deadzone, dynamic-base virtual stick, raylib gestures for intents.</li>
</ul>
<h3>Carrying forward</h3>
<p>Everything is motion-adjacent now. Chapter 12 makes motion itself first-class: <b>tween actions,
sprite animation, and the animation systems that tie the whole game together</b>.</p>
${bp(`Checkpoint: crates stack and settle quietly; the player rides kinematic platforms; a wind-shader
grass layer sways; mobile build steers by tilt AND virtual stick; the CRT toggle round-trips through
settings persistence.`)}
`);
