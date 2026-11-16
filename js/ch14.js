/* Chapter 14 — Advanced Physics and Simulation */
defChapter(14, {
  tag: '3D Physics',
  title: 'Advanced Physics and Simulation',
  sub: 'A 3D rigid-body world: shapes and motion states, constraints, contact listeners, raycasts, and the grand finale scene.',
  color: '#f97316',
  topics: ['3D rigid bodies: shapes, mass, motion states', 'The physics world & custom update loop', 'Impulse resolution: contacts & friction',
    'Constraints (distance joints, hinges)', 'Contact listeners & trigger volumes', 'Ray casting against bodies', 'The finale: tower stacking, collisions, shadows']
});

SEC(14);

S(14, 'The Finale Brief', `
${lead(`The last build of the course is a <b>3D physics playground</b> — Canyon 3D proving ground:
a stacked tower to knock down, rolling balls, a trigger volume that scores, and real shadows. Every
architecture law from Chapters 1–13 is load-bearing here.`)}
${diag(
`  ┌──────────────────── CANYON 3D: THE FINALE SCENE ───────────────────┐
  │  ☀ directional light + shadow map (dynamic shadows!)               │
  │  ▤ terrain (static box world)         🎯 trigger volume = score    │
  │  🧱 tower of 20 boxes (dynamic, sleeping)                          │
  │  ⚾ cannon: click to fire balls (raycast aim, impulse spawn)       │
  │  🔗 bridge planks connected by constraints (swinging)              │
  │  📊 HUD: body count, contacts/sec, draw calls, ms                  │
  └────────────────────────────────────────────────────────────────────┘
  built from: Ch 3 fixed loop · Ch 4 assets · Ch 5 render order ·
  Ch 6 events · Ch 11 shaders · Ch 13 cameras/culling + today: physics`, 'Everything converges on one runnable scene')}
${tbl(['Deliverable', 'Proves'], [
  ['Stacked tower + knockdown', 'Impulse resolution, sleep/wake, stacking stability'],
  ['Cannon balls on click', 'Raycast aiming, spawn budgets, contact events'],
  ['Score trigger volume', 'Sensors separate from solids'],
  ['Swinging plank bridge', 'Constraints (distance joints)'],
  ['Dynamic shadows', 'Shadow map pipeline (Ch 11 shaders applied)'],
  ['Debug HUD', 'The observability discipline from Ch 5']
])}
${bp(`Scope check: one scene, no save file, no menus beyond restart. The finale is a <b>stress test of
systems</b>, not a content showcase — exactly what a tech demo should be.`)}
`);

S(14, 'Rigid Bodies in 3D — State & Properties', `
${lead(`Chapter 11&rsquo;s 2D body grows one dimension and one rotation representation: 3D orientation
wants quaternions, and we add a <b>motion state</b> so rendering never touches the solver.`)}
${c`
// src/physics3/Body.h
typedef enum {
    BODY_STATIC, BODY_DYNAMIC, BODY_KINEMATIC
} BodyType;

typedef enum { SHAPE_SPHERE, SHAPE_BOX, SHAPE_PLANE } ShapeType;

typedef struct Rigid3 {
    BodyType  type;
    ShapeType shape;

    // state
    Vector3    pos;                // center of mass
    Vector3    vel;
    Quaternion rot;                // orientation (Euler = gimbal lock!)
    Vector3    angVel;             // angular velocity (axis*speed)

    // intrinsic
    float mass, invMass;           // 0 = static
    Matrix invInertia;             // 3×3: local-frame resistance
    float restitution, friction;
    Vector3 halfExtents;           // box: half-sizes; sphere: x = radius

    // integration cache
    Vector3 forceAccum, torqueAccum;
    float   sleepTimer;  bool asleep;   // Ch 11 sleep law, 3D edition

    // glue
    Model   *visual;               // motion state target (next slide)
    int      id;
} Rigid3;`}
${tbl(['Field', 'Why it exists', '3D newcomer'], [
  ['<code class="inl">rot (Quaternion)</code>', 'Orientation', 'No Euler storage — compose/normalize safely'],
  ['<code class="inl">angVel (Vector3)</code>', 'Spin around an axis', '2D had a scalar; 3D needs the axis'],
  ['<code class="inl">invInertia (Matrix)</code>', 'Rotational resistance', 'Box ≠ sphere ≠ none'],
  ['<code class="inl">sleepTimer/asleep</code>', 'Stack performance', 'A 20-box tower must sleep or melt CPUs']
])}
${note(`Why <b>inverse</b> mass/inertia: infinite mass = zero inverse — statics simply contribute 0 in
solver math without branching. Professional engines all store inverses; adopt the habit.`)}
`);

S(14, 'Motion States — Decoupling Sim from Render', `
${lead(`A motion state is the <b>bridge object</b> physics writes and rendering reads. It is the 3D
answer to Chapter 11&rsquo;s body→object sync, formalized — and it must respect interpolation.`)}
${c`
// src/physics3/MotionState.h
typedef struct MotionState {
    // written by the PHYSICS TICK, read by RENDER:
    Vector3    renderPos;
    Quaternion renderRot;
    // previous tick snapshot for interpolation (Ch 3 law):
    Vector3    prevPos;
    Quaternion prevRot;
} MotionState;

// physics tick: snapshot then advance
void BodyBeginTick(Rigid3 *b) {
    MotionState *m = b->motion;
    m->prevPos = m->renderPos;
    m->prevRot = m->renderRot;
}

void BodyWriteMotion(Rigid3 *b) {          // AFTER solver
    MotionState *m = b->motion;
    m->renderPos = b->pos;
    m->renderRot = QuaternionNormalize(b->rot);  // drift kills quats!
}

// render: interpolate exactly like Ch 3 RenderPos:
Vector3 BodyRenderPos(const MotionState *m, float alpha) {
    return Vector3Lerp(m->prevPos, m->renderPos, alpha);
}
Quaternion BodyRenderRot(const MotionState *m, float alpha) {
    return QuaternionSlerp(m->prevRot, m->renderRot, alpha);  // spherical!
}`}
${diag(
`  TICK (60Hz):  snapshot ──▶ integrate ──▶ solve ──▶ write motion
  RENDER (any Hz): lerp(prev, curr, alpha) ──▶ matrix ──▶ DrawModel
  the same alpha that drives 2D — one interpolation doctrine, all dims`, 'The motion-state contract')}
${pit(`Quaternions <b>drift from unit length</b> with every multiply (float error accumulates). One
<code class="inl">QuaternionNormalize</code> per tick is not optional — skip it and models visibly
shear/scale over minutes. Every engine has this bug story; now you skip yours.`)}
`);

S(14, 'The Physics World & Custom Update Loop', `
${lead(`Our own world struct (no external engine — 500 lines of solver) keeps the course
self-contained and every concept visible. The loop shape is Chapter 3&rsquo;s fixed step, wearing 3D.`)}
${c`
// src/physics3/World3.h
typedef struct World3 {
    Rigid3  bodies[256];
    int     bodyCount;
    Vector3 gravity;
    int     solverIterations;      // velocity+position correction passes
    // broadphase: uniform grid like Ch 6, 3D cells (or O(N²) below 64 bodies)
    int     contactsThisTick;      // for the debug HUD
} World3;

void World3Step(World3 *w, float dt, float alpha) {   // alpha unused here!
    // 1) snapshot motion states (prev = curr)
    for bodies: BodyBeginTick(b);

    // 2) accumulate forces (gameplay + gravity)
    for (b of dynamic, awake)
        b->forceAccum = Vector3Add(b->forceAccum,
            Vector3Scale(w->gravity, b->mass));

    // 3) integrate velocities (semi-implicit Euler, Ch 11 law)
    for (b of dynamic, awake) {
        b->vel = Vector3Add(b->vel,
            Vector3Scale(b->forceAccum, b->invMass * dt));
        b->angVel = Vector3Add(b->angVel,
            Vector3Scale(b->torqueAccum, dt));   // (× invInertia in real code)
    }

    // 4) collide → contact list; solve iterations
    Broadphase(w);                        // pairs
    for (int it = 0; it < w->solverIterations; it++)
        SolveContacts(w);                 // impulses, Ch 11 clinic values

    // 5) integrate positions from (now-corrected) velocities
    for (b of dynamic, awake) {
        b->pos = Vector3Add(b->pos, Vector3Scale(b->vel, dt));
        // quaternion integration of angular velocity:
        b->rot = QuaternionAdd? — via small-angle:
        Quaternion spin = { b->angVel.x*0.5f*dt, b->angVel.y*0.5f*dt,
                            b->angVel.z*0.5f*dt, 0.0f };
        b->rot = QuaternionNormalize(QuaternionAdd(b->rot,
            QuaternionScale(spin, 2.0f)));   // ≈ dq = ½ω·q·dt, normalized
    }

    // 6) sleep bookkeeping + write motion states + clear accumulators
}`}
${tbl(['Step', 'Purpose', 'Course callback'], [
  ['Forces', 'gravity + gameplay', 'Ch 11 force-per-tick law'],
  ['Velocity integrate', 'semi-implicit Euler', 'Ch 11'],
  ['Solve (iterations)', 'resolve penetrations via impulses', 'Ch 11 clinic'],
  ['Position integrate', 'move from corrected velocity', 'Ch 11'],
  ['Sleep + write motion', 'perf + render contract', 'this chapter']
])}
${pit(`<code class="inl">World3Step</code> runs inside the fixed tick ONLY — never per render frame.
The 120Hz-monitor double-step bug from Chapter 11 applies verbatim; the loop owns it, gameplay just
applies forces.`)}
`);

S(14, 'Collision Detection — Spheres, Boxes, Contacts', `
${lead(`Contact generation in 3D: sphere-sphere is trivial, sphere-box needs closest-point, box-box is
the hard one. We ship the first two and use SAT-lite for axis-aligned boxes.`)}
${c`
// 1) SPHERE-SPHERE — distance vs radii (2D law, +z):
bool CollideSphereSphere(Rigid3 *a, Rigid3 *b, Contact *out) {
    Vector3 d = Vector3Subtract(b->pos, a->pos);
    float dist = Vector3Length(d);
    float rsum = a->halfExtents.x + b->halfExtents.x;  // radii
    if (dist >= rsum || dist < 0.0001f) return false;
    *out = (Contact){
        .a = a, .b = b,
        .normal = Vector3Scale(d, 1.0f / dist),      // a → b
        .penetration = rsum - dist,
        .point = Vector3Add(a->pos, Vector3Scale(d, 0.5f)),
    };
    return true;
}

// 2) SPHERE-BOX (AABB): clamp center to box → closest point
bool CollideSphereBox(Rigid3 *s, Rigid3 *box, Contact *out) {
    Vector3 c = Vector3Clamp(s->pos,
        Vector3Subtract(box->pos, box->halfExtents),
        Vector3Add(box->pos, box->halfExtents));
    Vector3 d = Vector3Subtract(s->pos, c);
    float dist = Vector3Length(d);
    if (dist >= s->halfExtents.x) return false;
    // normal: from closest point toward sphere (degenerate when inside!)
    *out = (Contact){ .a = box, .b = s,
        .normal = dist > 0.001f ? Vector3Scale(d, 1/dist)
                                : (Vector3){0,1,0},
        .penetration = s->halfExtents.x - dist, .point = c };
    return true;
}`}
${tbl(['Pair', 'Method', 'Notes'], [
  ['sphere-sphere', 'distance', 'The whole course of 2D circle collision, 3D-ified'],
  ['sphere-box (AABB)', 'clamp closest-point', 'Degenerate-inside case needs the fallback normal'],
  ['box-box (AABB)', 'per-axis overlap → min axis', 'SAT with 3 axes; box faces are the normals'],
  ['rotated boxes', 'full SAT (15 axes)', 'Out of course scope — flag it, use AABBs or spheres']
])}
${bp(`<b>Contacts carry a normal + penetration + point</b> — the exact triple from Chapter 6&rsquo;s
<code class="inl">GetCollisionRec</code> lesson. Same shape, more dimensions; your instincts transfer.`)}
`);

S(14, 'Broadphase in 3D — The Uniform Grid, Extended', `
${lead(`Chapter 6&rsquo;s uniform grid law scales to 3D unchanged: hash space into cells, insert bodies,
test pairs per cell. The one new cost is memory — cells grew a third axis.`)}
${c`
// 3D grid: same pattern, 3 axes. Cell size ~= average body diameter (x2).
#define CELL 4.0f
#define GRID_X 32
#define GRID_Y 8       // vertical span smaller than horizontal — budget cells!
#define GRID_Z 32
// 32x8x32 = 8192 cells, ~256KB of indices — fine on desktop,
// halve X/Z (or use a hash map) for mobile.

int GridCellOf(float v) { return (int)floorf(v / CELL); }

void Broadphase(World3 *w) {
    GridClear(&w->grid);
    for (b of awake bodies)                       // sleeping skip = free win
        for each cell b bounds overlap:
            GridPush(&w->grid, cx, cy, cz, b->id);

    // pairs within shared cells (dedup: only j > i):
    for (cell with count > 1)
        for (i, j pairs in cell) TestPair(w, ById(i), ById(j));
}`}
${tbl(['Body count', 'Strategy', 'Why'], [
  ['&le; 64', 'O(N&sup2;) pairs directly', 'Grid overhead exceeds savings — Ch 6 honesty'],
  ['65–500', 'Uniform grid (course choice)', 'Uniform sizes, bounded world'],
  ['500–5k', 'Grid + sleeping bodies skipped', 'Sleep IS the broadphase optimizer'],
  ['5k+', 'Dynamic AABB tree (BVH)', 'Production engines (Bullet/Jolt) — study, then adopt']
])}
${pit(`The vertical axis is where naive 3D grids explode: a 64&times;64&times;64 grid of ints is 1MB of
zeroed cache-hostile memory for a world 12 units tall. Size each axis to the <b>play space</b>, not to
symmetry — 32&times;8&times;32 is not lopsided, it is honest.`)}
`);

S(14, 'Impulse Resolution — Contacts Become Velocities', `
${lead(`The solver turns contacts into velocity impulses: separate along the normal, apply friction
along the tangent, distribute between the pair. Chapter 11&rsquo;s math, now with rotation.`)}
${c`
// Per contact, per iteration:
void SolveContact(Contact *c) {
    Rigid3 *a = c->a, *b = c->b;
    float invMassSum = a->invMass + b->invMass;
    if (invMassSum == 0) return;               // static-static

    // relative velocity along normal
    Vector3 rv = Vector3Subtract(b->vel, a->vel);
    float velAlongNormal = Vector3DotProduct(rv, c->normal);

    if (velAlongNormal > 0) return;            // separating already

    // restitution (scaled to kill micro-bounces, Ch 11 clinic):
    float e = fminf(a->restitution, b->restitution);
    if (velAlongNormal > -0.3f) e = 0;         // rest threshold
    float j = -(1.0f + e) * velAlongNormal / invMassSum;

    Vector3 impulse = Vector3Scale(c->normal, j);
    a->vel = Vector3Subtract(a->vel, Vector3Scale(impulse, a->invMass));
    b->vel = Vector3Add(b->vel, Vector3Scale(impulse, b->invMass));

    // FRICTION (Coulomb): tangent impulse clamped by μ·|jn|
    Vector3 tangent = Vector3Subtract(rv,
        Vector3Scale(c->normal, velAlongNormal));
    if (Vector3Length(tangent) > 0.001f) {
        tangent = Vector3Normalize(tangent);
        float jt = -Vector3DotProduct(rv, tangent) / invMassSum;
        float mu = sqrtf(a->friction * b->friction);
        jt = ClampF(jt, -mu * j, mu * j);      // the friction cone!
        Vector3 tImp = Vector3Scale(tangent, jt);
        a->vel = Vector3Subtract(a->vel, Vector3Scale(tImp, a->invMass));
        b->vel = Vector3Add(b->vel, Vector3Scale(tImp, b->invMass));
    }
}`}
${tbl(['Concept', 'Formula home', 'Tuning'], [
  ['Normal impulse', 'j = −(1+e)·v·n / ΣinvMass', 'restitution pairs: min of the two'],
  ['Rest threshold', 'skip bounce under −0.3', 'Kills jittering stacks (Ch 11 law)'],
  ['Friction cone', '|jt| ≤ μ·jn', 'μ = sqrt(a·b) — geometric mean, both materials matter'],
  ['Iterations', 'solve N passes over all contacts', '5–8: stacking stability vs CPU']
])}
${pit(`Rotationless bodies (angular vel forced 0) simplify everything but look fake: balls never roll.
Even one iteration of angular response (torque from contact point offset) sells physicality — the
cannon balls MUST roll for the finale to feel right.`)}
`);

S(14, 'Sleep & Island Stabilization', `
${lead(`A 20-box tower at rest must cost zero. Sleep = velocity under thresholds for N ticks → park it;
any contact with an awake dynamic → wake. This is the Ch 11 sleep law with teeth.`)}
${c`
void SleepUpdate(Rigid3 *b, float dt) {
    if (b->type != BODY_DYNAMIC) return;
    float lin = Vector3Length(b->vel);
    float ang = Vector3Length(b->angVel);

    if (lin < 0.06f && ang < 0.06f) {
        b->sleepTimer += dt;
        if (b->sleepTimer > 0.5f) {           // settled for half a second
            b->asleep = true;
            b->vel = b->angVel = (Vector3){0};
        }
    } else b->sleepTimer = 0;
}

// WAKE rules (miss one and towers stay frozen mid-air):
void WakeTouching(World3 *w, Rigid3 *b) {
    b->asleep = false; b->sleepTimer = 0;
    // impulse from gameplay (cannon ball) wakes via CONTACTS below:
}
// in broadphase pair: if (a->asleep && !b->asleep && b moves fast)
//                        → wake a;  and symmetric
// gameplay forces on an asleep body must ALSO wake it first`}
${tbl(['Rule', 'Why'], [
  ['Thresholds ~0.06', 'Below visual perception; higher = early freeze pops'],
  ['Zero velocities on sleep', 'No drift accumulation while parked'],
  ['Asleep bodies skip integrate+solve', 'The whole point: 20-box tower = 0 cost'],
  ['Wake on contact from awake dynamics', 'Cannonball topples the tower naturally'],
  ['NEVER sleep kinematics/triggers', 'They are the world&rsquo;s clock for others']
])}
${pit(`The &ldquo;frozen floating box&rdquo; bug: a body put to sleep while overlapping (spawned inside
another) never resolves because sleeping bodies skip the solver. Validate spawn spacing (Ch 11
validator) OR wake anything whose penetration is corrected.`)}
`) ;

S(14, 'Constraints — Distance Joints & Hinges', `
${lead(`Constraints hold relations between bodies: the finale bridge is planks chained by <b>distance
joints</b>. Solve as another velocity-level correction pass, after contacts.`)}
${c`
// src/physics3/Constraint.h — distance joint (rope/rod between points)
typedef struct DistJoint {
    Rigid3 *a, *b;
    Vector3 localA, localB;     // anchor points in each body's frame
    float   restLength;         // solve to this distance
    float   stiffness;          // 1 = rigid rod, 0.3 = springy rope
    bool    tearable; float tearForce;
} DistJoint;

void SolveDistJoint(DistJoint *j) {
    Vector3 pa = WorldAnchor(j->a, j->localA);
    Vector3 pb = WorldAnchor(j->b, j->localB);
    Vector3 d  = Vector3Subtract(pb, pa);
    float len  = Vector3Length(d);
    if (len < 0.0001f) return;
    Vector3 n  = Vector3Scale(d, 1.0f / len);

    float diff = (len - j->restLength) * j->stiffness;
    // positional correction split by inverse mass (rope pulls, rod pushes):
    Vector3 corr = Vector3Scale(n, diff / (j->a->invMass + j->b->invMass));
    if (!j->a->asleep) j->a->pos = Vector3Add(j->a->pos,
        Vector3Scale(corr,  j->a->invMass));
    if (!j->b->asleep) j->b->pos = Vector3Subtract(j->b->pos,
        Vector3Scale(corr,  j->b->invMass));
    // (velocity-level pass omitted; positional is plenty for a bridge)
}

// HINGE = distance joint pair + angular limit — the door/case study.
// For the course: constrain two points along the hinge axis + damp spin.`}
${diag(
`  bridge: plank ──joint── plank ──joint── plank ──joint── plank
             ▲ anchors at plank ends, restLength = plank gap
  character: ball of mass hits plank → joint chain swings & sags
  solver order per tick: contacts FIRST, then constraints (they ride
  on the corrected state)`, 'The finale bridge: 8 planks, 7 joints, one swinging playground')}
${bp(`Constraint tuning starts <b>soft</b> (stiffness 0.3–0.5) and tightens toward rigid only if the
visual demands it. Rigid chains + high solver iterations = energy injection = the exploding bridge.
Springy reads better and never explodes.`)}
`) ;

S(14, 'A 3D Character Controller — Kinematic on Top', `
${lead(`The Ch 6 law holds in 3D: the player is a <b>kinematic capsule</b> driven by code, riding a
dynamic world. Ground check by raycast, movement by velocity, rotation by camera yaw.`)}
${c`
// src/scene3/Player3.c
typedef struct Player3 {
    Vector3 pos; Vector3 vel;
    bool   grounded;
    float  yaw;                 // faces camera direction (Ch 13 rig)
    Rigid3 *kinem;              // BODY_KINEMATIC capsule proxy
} Player3;

void Player3Tick(Player3 *p, Game *g, float dt) {
    // 1) INPUT -> desired motion in camera space (Ch 2 action law):
    Vector2 move = { ActionAxisX(), ActionAxisY() };     // stick / WASD
    Vector3 fwd = Vector3Subtract(g->cam3d.cam.target, g->cam3d.cam.position);
    fwd.y = 0; fwd = Vector3Normalize(fwd);              // flatten: walk, not fly
    Vector3 right = (Vector3){ -fwd.z, 0, fwd.x };

    Vector3 wish = Vector3Add(
        Vector3Scale(fwd, -move.y), Vector3Scale(right, move.x));
    wish = Vector3Scale(Vector3NormalizeOrZero(wish), RUN_SPEED_3D);

    // 2) GROUND by raycast (rays budget — 1 per frame):
    Ray down = { .position = p->pos, .direction = {0,-1,0} };
    RayHit h;
    p->grounded = RaycastWorld(&g->phys, down, 1.2f, &h);

    // 3) JUMP + gravity (Ch 6 feel: coyote + buffer port verbatim):
    p->coyote = p->grounded ? COYOTE_3D : p->coyote - dt;
    if (ActionPressed(ACT_JUMP)) p->jumpBuf = BUFFER_3D;
    else                         p->jumpBuf -= dt;
    if (p->jumpBuf > 0 && p->coyote > 0)
        { p->vel.y = JUMP_3D; p->coyote = p->jumpBuf = 0; }
    if (!p->grounded) p->vel.y += GRAVITY_3D * dt;

    // 4) MOVE: kinematic integration + world resolve (axis-separated, Ch 6!):
    Vector3 step = Vector3Scale(Vector3Add(wish,
        (Vector3){0, p->vel.y, 0}), dt);
    MoveAndCollide(p, step);     // capsule sweep vs statics, slide on walls
}`}
${tbl(['2D law (Ch 6)', '3D translation (Ch 14)'], [
  ['Kinematic player, dynamic world', 'Identical — capsule instead of AABB'],
  ['Axis-separated resolution', 'Horizontal move + vertical move, separately'],
  ['Coyote + input buffer + variable jump', 'Verbatim — feel laws are dimension-free'],
  ['Merged terrain boxes', 'Static boxes from the level format'],
  ['Grid broadphase', '3D grid (prev slide) for dynamic interactions']
])}
${bp(`Resist making the player a dynamic body in 3D too — capsules on dynamic simulation skate down
ramps and jitter on stairs. Kinematic + raycast ground + code-driven steps is what shipped third-person
games do, indie and AAA alike.`)}
`);

S(14, 'Contact Listeners — Gameplay Meets Solver', `
${lead(`Physics must <b>report</b>, gameplay must <b>decide</b> — the Ch 6 event law at solver depth.
Contacts are collected during the step, then dispatched as events after it.`)}
${c`
// Contact records enriched during solving:
typedef struct ContactEvent {
    int aId, bId;
    Vector3 point, normal;
    float impactSpeed;         // |relative velocity| along normal, pre-solve
} ContactEvent;

// after the step (never during! — solver data is scratch):
void World3DispatchContacts(World3 *w) {
    for (c of contactEvents) {
        Rigid3 *a = ById(w, c.aId), *b = ById(w, c.bId);
        // gameplay mapping via user tags (spawn table pattern, Ch 5):
        if (Tagged(a, TAG_BALL) && Tagged(b, TAG_TOWER_BOX)
            && c.impactSpeed > 2.0f) {
            EventsEmit(EV_TOWER_HIT, FindObject(a), FindObject(b));
            SoundPlayAt3D(&g->sound, "sfx_knock", c.point, 2.0f + c.impactSpeed);
        }
        if (c.impactSpeed > 6.0f) {           // any hard hit
            FxBurst3D(FX_IMPACT3D, c.point, 8);
            VCamAddShake(&g->cam3d, fminf(c.impactSpeed * 0.3f, 4.0f));
        }
    }
    w->contactCount = 0;   // scratch cleared — listeners get copies
}`}
${tbl(['Listener rule', 'From which chapter'], [
  ['Dispatch AFTER the step, never mid-solve', 'Ch 6 buffered events'],
  ['Handlers never mutate bodies directly', 'request via events, apply next tick'],
  ['Impact threshold gates audio/FX spam', 'Ch 10 cooldown policy'],
  ['Id-based references, not pointers', 'Ch 6 generation law (bodies pooled)']
])}
${note(`Impact speed is sampled <b>before</b> the solver runs (the pre-solve relative velocity along
the normal). Post-solve velocities are already corrected — you would measure zero for every perfect
resolution and your sound design would go deaf.`)}
`) ;

S(14, 'Trigger Volumes — Sensors in 3D', `
${lead(`The score zone under the tower is a sensor: it reports overlap, participates in zero physics.
The Ch 6 trigger doctrine ports directly.`)}
${c`
typedef struct Trigger3 {
    BoundingBox box;          // world-space AABB
    int         tag;          // TAG_SCORE_ZONE…
    bool        wasInside;    // edge detection, Ch 8 splash law
    void       *userData;
} Trigger3;

void Trigger3Tick(World3 *w, Trigger3 *t) {
    bool inside = false;
    for (b of dynamic bodies) {
        if (!BodyIntersectsBox(b, t->box)) continue;
        inside = true;
        if (!t->wasInside)                     // ENTRY edge
            EventsEmit(EV_ENTER_TRIGGER, (void*)(long)t->tag,
                       (void*)(long)b->id);
    }
    if (!inside && t->wasInside)               // EXIT edge
        EventsEmit(EV_EXIT_TRIGGER, ...);
    t->wasInside = inside;
}

// Score zone handler — Ch 8 beat choreography, 3D edition:
static void OnEnterTrigger(...) {
    if (tag == TAG_SCORE_ZONE && Tagged(body, TAG_BALL)) {
        g->score += 100;
        FxBurst3D(FX_SPARKLES3D, BodyPos(b), 20);
        SoundPlay(&g->sound, "sfx_score");
        World3Despawn(g->phys, bodyId);        // consumed
        HudScorePunch();
    }
}`}
${tbl(['3D sensor rule', '2D ancestor'], [
  ['Edge events (enter/exit), not level events', 'Ch 6 triggers'],
  ['Never affect motion — no impulses', 'Ch 6 isTrigger'],
  ['Debug draw as wire boxes', 'Ch 11 physics overlay'],
  ['Bodies despawn via id, not pointer', 'Ch 12 generation law']
])}
${bp(`Draw triggers as <b>translucent wire boxes</b> in debug builds, always. An invisible score zone
that silently eats balls is the most confusing bug report a physics sandbox can generate.`)}
`) ;

S(14, 'Ray Casting Against Bodies', `
${lead(`Chapter 13&rsquo;s mouse ray gets physics powers: cannon aiming, hitscan, and character ground
checks all become <code class="inl">RaycastWorld</code> — one function against all bodies.`)}
${c`
// Broad-phase to spheres, exact where needed:
typedef struct RayHit { int bodyId; float dist; Vector3 point, normal; } RayHit;

bool RaycastWorld(World3 *w, Ray ray, float maxDist, RayHit *out) {
    float best = maxDist; bool hitAny = false;

    for (b of bodies) {
        if (b->type == BODY_KINEMATIC_SENSOR) continue;   // sensors invisible

        // cheap sphere reject (Ch 13 picking law):
        float radius = BoundRadius(b);    // box: |halfExtents| length
        RayCollision sc = RaySphere(ray, b->pos, radius);
        if (!sc.hit || sc.distance > best) continue;

        // exact per shape:
        float d; Vector3 n;
        if (b->shape == SHAPE_SPHERE)
            d = RaySphereExact(ray, b, &n);
        else
            d = RayAABB(ray, BoxBounds(b), &n);

        if (d > 0 && d < best) {
            best = d; *out = (RayHit){ b->id, d,
                Vector3Add(ray.position, Vector3Scale(ray.direction, d)), n };
            hitAny = true;
        }
    }
    return hitAny;
}

// CANNON: crosshair ray → spawn ball with impulse along it:
Ray aim = { .position = g->cannonPos,
            .direction = CrosshairDirection(g->cam3d) };
RayHit h;
if (RaycastWorld(&g->phys, aim, 200, &h)) {
    Rigid3 *ball = SpawnBall(h.point);       // small offset off surface
    ball->vel = Vector3Scale(aim.direction, 24.0f);   // muzzle velocity
    SoundPlay(&g->sound, "sfx_fire");
}`}
${tbl(['Ray use', 'Consumer', 'Note'], [
  ['Cannon aiming', 'finale input', 'Crosshair UI draws the ray&rsquo;s screen point'],
  ['Camera pullback', 'Ch 13 rig', 'Now tests bodies too, not just meshes'],
  ['Ground check', 'character controller', '<code class="inl">ray down, len 0.1</code> — grounded'],
  ['Hitscan weapons', 'future games', 'First hit + impact speed = damage']
])}
${pit(`Raycasts are <b>alloc-free, loop-heavy</b> — a per-frame character controller does 1–2; a
laser-scanner fantasy of 200 rays/frame needs batching or spatial acceleration. Budget rays like draw
calls.`)}
`) ;

S(14, 'Dynamic Shadows — The Shadow Map', `
${lead(`Shadows are a 2-pass render: draw depth from the light&rsquo;s eyes into a texture, then shade
the scene testing against it. All Ch 11 shader machinery, pointed at depth.`)}
${diag(
`  PASS 1 (light view):  render scene depth → shadowMap (FBO, no color)
  PASS 2 (camera view): fragment compares its light-space depth vs
                        shadowMap sample → in shadow? darken
  ────
  artifacts you will meet:
   acne (self-shadow stripes)      → bias / normal offset
   peter-panning (floaters)        → tighten light frustum
   shimmer when camera moves       → texel snapping (advanced)`, 'Shadow mapping: depth from the sun, compare from the eye')}
${c`
// Pass 1 — depth-only from the directional light:
BeginTextureMode(shadowFBO);           // RenderTexture, DEPTH_ONLY
    BeginMode3D(lightCam);             // ortho camera at the sun
        for (casters) DrawModelSimple(model, pos, scale);  // no materials!
    EndMode3D();
EndTextureMode();

// Pass 2 — normal render; light shader samples shadowFBO:
BeginMode3D(cam);
    SetShaderValueTexture(litShader, uShadowMap, shadowFBO.depth);
    SetShaderValue(litShader, uLightSpaceMat, &lightMatrix, MAT4);
    for (visible) DrawModel(model, pos, scale, WHITE);
EndMode3D();`}
${tbl(['Shadow knob', 'Default', 'Effect'], [
  ['Map resolution', '1024–2048', 'Sharpness vs VRAM/bandwidth'],
  ['Light ortho bounds', 'tight around play area', 'Resolution efficiency'],
  ['Depth bias', '0.0005–0.002', 'Acne vs peter-panning trade'],
  ['Soft shadows (PCF)', '3×3 kernel', 'Blurry edges — hides aliasing, +9 taps']
])}
${pit(`Shadow acne (stripes on lit surfaces) is the first artifact everyone meets — it is self-shadowing
from depth precision. Fix with a <b>depth bias</b> or normal-offset before touching anything else.
Cranking resolution does not fix acne; it makes it finer.`)}
`) ;

S(14, 'Assembling the Finale Scene', `
${lead(`Every system lands in one initialization + one update. Read this as the course&rsquo;s final
architecture exam — each line references a chapter.`)}
${c`
// src/scene3/Finale.c — build
void FinaleBuild(Game *g) {
    AssetsLoadAll(&g->assets);                        // Ch 4

    // camera rig (Ch 13): orbit + damped follow + ray pullback
    RigInit(&g->cam3d, (Vector3){0, 8, 26});

    // physics world (Ch 14): gravity, solver iters, grid broadphase
    World3Init(&g->phys, (Vector3){0, -18, 0}, /*iters*/ 6);

    // static world: ground plane + canyon walls (static boxes)
    SpawnStaticBox(&g->phys, (Vector3){0, -1, 0}, (Vector3){60, 2, 60});
    SpawnStaticBox(&g->phys, (Vector3){-30, 6, 0}, (Vector3){2, 14, 60});
    SpawnStaticBox(&g->phys, (Vector3){ 30, 6, 0}, (Vector3){2, 14, 60});

    // THE TOWER: 5×4 boxes, sleeping from birth
    for (int row = 0; row < 5; row++)
        for (int col = 0; col < 4; col++)
            SpawnTowerBox(&g->phys, (Vector3){
                -4.5f + col * 3.0f, 1.5f + row * 3.0f, 0}, /*sleep*/ true);

    // the bridge: 8 planks + 7 distance joints (Ch 14 constraints)
    BuildBridge(&g->phys, (Vector3){8, 10, -12}, /*planks*/ 8);

    // trigger: score zone behind the tower (sensor, Ch 14)
    AddTrigger3(&g->phys, (BoundingBox){
        .min = {12, 0, -6}, .max = {24, 8, 6}}, TAG_SCORE_ZONE);

    // shadows (Ch 14): one directional, ortho bounds around arena
    ShadowInit(&g->shadow, (Vector3){-20, 40, -12}, /*mapRes*/ 2048);

    // HUD (Ch 5): bodies, contacts/s, draw calls, ms — the observability law
    Hud3Init(&g->hud3);
}

void FinaleUpdate(Game *g, float dt) {                // FIXED TICK
    RigUpdate(&g->cam3d, g->focus, dt);               // Ch 13
    CannonInput(g, dt);                               // ray + spawn (Ch 14)
    World3Step(&g->phys, dt);                         // physics!
    World3DispatchContacts(&g->phys);                 // events (Ch 6 law)
    for (t of triggers) Trigger3Tick(&g->phys, t);
    ActionsUpdate(dt);                                // Ch 12 tweens
    Hud3Update(&g->hud3, g);
}

void FinaleDraw(Game *g, float alpha) {               // RENDER
    BeginDrawing();
      ClearBackground(SKYBLUE);
      ShadowPass(&g->shadow, &g->phys, &g->assets);   // pass 1
      BeginMode3D(g->cam3d.cam);                      // Ch 13
          DrawScene(&g->phys, &g->shadow, alpha);     // pass 2 (motion states!)
          if (g->debug) DrawPhysicsDebug3(&g->phys);  // wire boxes, contacts
      EndMode3D();
      Hud3Draw(&g->hud3, g);                          // screen space
    EndDrawing();
}`}
${bp(`Notice what is <b>absent</b>: no new architecture. Fixed tick, events, pools, data tables,
motion interpolation — Chapter 14 adds physics <i>content</i> to a structure you built by Chapter 8.
That is the course thesis, demonstrated.`)}
`) ;

S(14, 'Debug & Tuning the Simulation', `
${lead(`Physics sandboxes live or die on debuggability. The finale ships with the full overlay suite —
each toggle answers one class of &ldquo;why does it look wrong?&rdquo;`)}
${c`
void DrawPhysicsDebug3(World3 *w) {
    for (b of bodies) {
        Color col = b->asleep ? DARKBLUE
                  : b->type == BODY_STATIC ? GRAY
                  : b->type == BODY_KINEMATIC ? ORANGE : SKYBLUE;
        switch (b->shape) {
        case SHAPE_SPHERE:
            DrawSphereWires(b->pos, b->halfExtents.x, 12, 8, col); break;
        case SHAPE_BOX:
            DrawCubeWires(b->pos,
                b->halfExtents.x*2, b->halfExtents.y*2,
                b->halfExtents.z*2, col); break;
        default: break;
        }
        // velocity arrows (Ch 11 debug-draw law, 3D):
        DrawLine3D(b->pos, Vector3Add(b->pos,
            Vector3Scale(b->vel, 0.25f)), YELLOW);
    }
    for (c of contacts)   // contact points as red dots — the solver&rsquo;s eyes
        DrawSphere((Vector3)c.point, 0.08f, RED);
    for (j of joints) {   // joints as green lines
        DrawLine3D(WorldAnchor(j->a, j->localA),
                   WorldAnchor(j->b, j->localB), LIME);
    }
    for (t of triggers) DrawCubeWires(center, size, size, size, Fade(GOLD, 0.4f));
}`}
${tbl(['Toggle', 'Shows', 'Answers'], [
  [kbd('F1'), 'bodies + colors', '&ldquo;why is it not moving?&rdquo; (asleep!)'],
  [kbd('F2'), 'contact points', '&ldquo;why does it sink?&rdquo; (penetration distribution)'],
  [kbd('F3'), 'velocity arrows', 'tunneling risks (Ch 11 clinic)'],
  [kbd('F4'), 'joints + triggers', 'constraint stretch, sensor bounds'],
  [kbd('F5'), 'shadow map preview', 'acne/peter-pan diagnosis'],
  [kbd('F9'), 'slow-mo ×0.25', 'watch a single collision frame (Ch 3 timeScale)']
])}
${bp(`Ship the debug overlay in every physics build, forever. The five minutes it costs today saves the
evening when the tower explodes and the only witness is a YouTube bug report.`)}
`) ;

S(14, 'Determinism — Replays, Tests &amp; Trust', `
${lead(`A simulation is <b>deterministic</b> when the same inputs always produce the same states. The
finale loop was designed for it — here is the audit checklist that keeps it true.`)}
${tbl(['Determinism breaker', 'Where it hides', 'Fix'], [
  ['Floating-point per-frame variance', 'forces applied per render frame', 'fixed tick only (Ch 3/11 law)'],
  ['<code class="inl">rand()</code> in simulation', 'FX seeds inside World3Step', 'seeded PRNG stream (Ch 8 position-seed law)'],
  ['Iteration order of unordered structures', 'hash-map broadphase', 'stable arrays; sort pairs before solving'],
  ['Different math libs per platform', 'sinf/fmodf rounding differs (ARM vs x86)', 'lockstep netcode needs fixed-point or server authority'],
  ['Uninitialized memory', 'pooled bodies reused', 'zero on alloc (Ch 6 discipline)']
])}
${c`
// The seeded world RNG — deterministic because the SEQUENCE is fixed:
typedef struct Rng { unsigned long long state; } Rng;

unsigned long long RngNext(Rng *r) {        // xorshift64*
    r->state ^= r->state >> 12;
    r->state ^= r->state << 25;
    r->state ^= r->state >> 27;
    return r->state * 2685821657736338717ULL;
}
float RngRange(Rng *r, float lo, float hi) {
    return lo + (hi - lo) * (float)(RngNext(r) >> 40) / 16777216.0f;
}
// One instance in the World; FX/visual noise may use plain rand() —
// VISUAL randomness is exempt; SIMULATION randomness is not.

// Headless determinism test (CI!):
void Test_TowerFallsTheSameWay(void) {
    World3 a, b; World3InitSeeded(&a, 12345); World3InitSeeded(&b, 12345);
    ApplySameInputScript(&a); ApplySameInputScript(&b);
    for (int i = 0; i < 600; i++) {
        World3Step(&a, FIXED_DT);
        World3Step(&b, FIXED_DT);
    }
    assert(World3Hash(&a) == World3Hash(&b));   // state hash must match
}`}
${bp(`The <b>headless replay test</b> is the single best regression net for a physics engine: record
inputs, replay N steps, hash the state, compare against a golden hash in CI. Every solver regression
you will ever ship breaks this test before it breaks players.`)}
`);

S(14, 'Simulation Performance — Profiling the Step', `
${lead(`The Ch 5 perf HUD law, pointed at the solver: measure the <b>phases</b> of World3Step, watch
contact counts, and know your budget before the tower grows.`)}
${c`
// Instrument the phases (Ch 5 pass-timing pattern, 3D edition):
void World3StepProfiled(World3 *w, float dt) {
    double t0 = GetTime();
    Broadphase(w);
    double tBroad = GetTime() - t0;

    t0 = GetTime();
    for (int it = 0; it < w->solverIterations; it++)
        SolveContacts(w);
    double tSolve = GetTime() - t0;

    t0 = GetTime();
    IntegratePositions(w);
    double tInteg = GetTime() - t0;

    ProfPush(&w->prof, tBroad, tSolve, tInteg);
    // HUD (F1): "broad 0.04ms | solve 0.61ms | integ 0.02ms | contacts 84"
}
// Budget rule of thumb @60Hz tick: total physics <= 3ms desktop, <= 2ms mobile.
// contacts/sec trending up without gameplay reason = a solver regression.`}
${tbl(['Budget line', 'Healthy', 'Investigate when'], [
  ['Broadphase', '&lt;0.2ms', 'grows superlinearly with bodies (grid cells saturated)'],
  ['Solve', '&lt;1.5ms', 'contact count spikes; sleeping bodies waking repeatedly'],
  ['Integration', '&lt;0.2ms', 'never — if this grows, you are integrating asleep bodies'],
  ['Render (Ch 13)', '&lt;8ms', 'culling broke; draw calls climbed (HUD shows them)']
])}
${pit(`Profile <b>phases, not totals</b>: &ldquo;physics is slow&rdquo; is unfalsifiable, while
&ldquo;solve phase tripled after the joint bridge landed&rdquo; is a bug report. The Ch 5 instrumentation
pattern transfers wholesale — three doubles and a ring buffer.`)}
`);

S(14, 'Course Finale — What You Built', `
${lead(`300 slides ago this was a window and a purple circle. Today: a cross-platform, data-driven,
physics-simulating, shader-lit, animated, choreographed game engine — and the knowledge to rebuild it
from scratch.`)}
${tbl(['Capability', 'Chapters', 'Now you can…'], [
  ['Engine architecture', '1–3', 'Structure any game: fixed loop, ownership, screens'],
  ['Cross-platform delivery', '2', 'Ship desktop/mobile/web from one codebase'],
  ['Asset pipelines', '4', 'Atlas, async load, hot reload, validate, budget'],
  ['World building & HUD', '5', 'Tilemaps, parallax, responsive UI, perf HUDs'],
  ['Gameplay & feel', '6', 'AABB physics, events, coyote time, damage, game over'],
  ['UI systems', '7', 'Scene graphs, 9-patch, focus, persistence'],
  ['Juice & motion', '8, 12', 'Particles, easing, tween actions, sprite anim, squash'],
  ['Transitions & shaders', '9, 11', 'Wipes, dissolves, post-processing, lighting'],
  ['Audio engineering', '10', 'Buses, streams, ducking, spatial, procedural'],
  ['Physics (2D + 3D)', '11, 14', 'Bodies, impulses, constraints, triggers, shadows'],
  ['3D rendering', '13', 'Cameras, materials, culling, instancing, picking']
])}
${diag(
`   the transferable spine of EVERYTHING you built:
   fixed timestep  ·  data-driven systems  ·  event buses  ·
   object pools  ·  debug-first tooling  ·  feel through feedback
   ── these six laws outlive any engine, framework, or language.`, 'The course in six laws')}
${note(`Where to go next: port the input abstraction to gamepad-first console layouts; replace the 3D
solver with Bullet/Jolt for production scale; add a level editor on the finale scene (Ch 11 tooling
pattern); or ship Canyon Hopper — it is done. The README in the repo has stretch goals.`)}
${bp(`The last best practice is the first one restated: <b>build the small loop, then earn every system</b>.
You now know exactly how — go make something and keep the debug overlay on.`)}
`);

S(14, 'You Made It', `
${lead(`Go build something wonderful — and keep the debug overlay on.`)}
`, { type: 'finale', topics: ['330+ slides', '14 chapters', '250+ code blocks', '2 complete games', 'one architecture', 'zero dependencies'] });
