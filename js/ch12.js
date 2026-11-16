/* Chapter 12 — Animations */
defChapter(12, {
  tag: 'Animation',
  title: 'Animations',
  sub: 'Declarative tween actions, sprite-sheet animation states, play modes, and animating every layer of Canyon Hopper.',
  color: '#2dd4bf',
  topics: ['Declarative animation actions (tween engine)', 'Movement, alpha & scale interpolations', 'Sequence & parallel execution',
    'Animating menus, collectibles & UI buttons', 'Frame-by-frame sprite sheets & packed regions', 'Play modes: loop, ping-pong, reverse',
    'Player state machines & game-screen animation']
});

SEC(12);

S(12, 'Animation = Values Changing Over Time', `
${lead(`Strip the glamour: animation is <b>interpolated values</b> driving rendering. Position, alpha,
scale, rotation, frame index — the same tween engine powers all of them.`)}
${tbl(['What animates', 'Value driven', 'Where we already did it by hand'], [
  ['Menu entrance', 'pos.y + alpha', 'Ch 8 (staggered OutBack)'],
  ['Camera zoom punch', 'zoom', 'Ch 8 (CamPunch)'],
  ['Coin bob', 'pos.y offset', 'Ch 6 (sine, position-seeded)'],
  ['Door opening', 'scale or rect', '—'],
  ['Sprite walk cycle', 'atlas region index', '— (this chapter!)'],
  ['Score roll', 'displayed number', 'Ch 8 (damped)']
])}
${diag(
`  HAND-ROLLED (every system so far)      TWEEN ENGINE (this chapter)
  ───────────────────────────────       ───────────────────────────
  each system owns its own timers       one Action describes ONE change
  each system owns its own easing       easing chosen per action
  code paths multiply per effect        composable: seq / parallel
  start/stop logic ad hoc               start/cancel/finish uniform`, 'From ad-hoc motion to a declarative motion system')}
${bp(`The payoff of a tween engine is not fewer lines on day one — it is that <b>every future animation
becomes data plus one call</b>, and complex choreography (sequenced, parallel, chained) composes without
new code.`)}
`);

S(12, 'The Action Model — One Struct', `
${lead(`An action is a <b>promise</b>: take this value from A to B over this duration with this easing,
then maybe do something. Everything else is bookkeeping the engine owns.`)}
${c`
// src/fx/Action.h — the whole tween data model
typedef enum {
    AT_FLOAT,     // generic float (custom targets)
    AT_VEC2,      // position-ish
    AT_COLOR,     // alpha fades, tints
    AT_FRAME      // sprite frame INDEX (driven separately, see sheets)
} ActionType;

typedef void (*ActionDone)(void *ctx);     // fired at completion

typedef struct Action {
    bool     active;
    float    t, dur;               // elapsed / duration (seconds)
    EaseFn   ease;                 // Ch 8 catalog
    float    delay;                // stagger helper
    // targets — union keeps it small; userData pattern from Ch 7 nodes
    float   *fTarget;  float fFrom, fTo;
    Vector2 *vTarget;  Vector2 vFrom, vTo;
    Color   *cTarget;  Color  cFrom, cTo;
    ActionDone onDone;  void *ctx;
    bool     killOwner;            // despawn entity when done
} Action;

#define MAX_ACTIONS 256           // pooled, like particles (Ch 8)`}
${tbl(['Field', 'Purpose', 'Example'], [
  ['<code class="inl">t / dur / ease</code>', 'The clock and its shape', '<code class="inl">EaseOutBack</code> for menu pops'],
  ['<code class="inl">delay</code>', 'Cascades without extra actions', '<code class="inl">index * 0.07f</code>'],
  ['<code class="inl">onDone + ctx</code>', 'Chaining hook', 'Spawn sparkle when door opens'],
  ['<code class="inl">killOwner</code>', 'Auto-despawn', 'Floating score text']
])}
${note(`Pointers into live objects (<code class="inl">fTarget</code> etc.) mean actions die with their
owner: when an entity is culled (Ch 6), the engine must drop its actions. Ownership rules again — the
action pool checks a generation/alive flag each tick.`)}
`);

S(12, 'The Tween Engine — Tick & Fire', `
${lead(`The engine is one loop: advance t, evaluate ease, write the target, fire completion. ~40 lines
total, reused by every system in the game from now on.`)}
${c`
// src/fx/Action.c
static Action g_actions[MAX_ACTIONS];

Action *ActionFloat(float *target, float to, float dur, EaseFn ease, float delay) {
    for (int i = 0; i < MAX_ACTIONS; i++) {
        Action *a = &g_actions[i];
        if (a->active) continue;
        *a = (Action){ .active = true, .t = 0, .dur = dur,
                       .ease = ease ? ease : EaseOutQuad, .delay = delay,
                       .fTarget = target, .fFrom = *target, .fTo = to };
        return a;
    }
    return NULL;    // pool full: budget hit (Ch 8 discipline)
}
// ActionVec2 / ActionColor: same shape, Vector2Lerp / LerpColor bodies

void ActionsUpdate(float dt) {
    for (int i = 0; i < MAX_ACTIONS; i++) {
        Action *a = &g_actions[i];
        if (!a->active) continue;

        if (a->delay > 0) { a->delay -= dt; continue; }   // stagger phase
        a->t += dt;
        float k = a->ease(ClampF(a->t / a->dur, 0, 1));   // eased 0..1

        if (a->fTarget)  *a->fTarget = Lerp(a->fFrom, a->fTo, k);
        if (a->vTarget)  *a->vTarget = Vector2Lerp(a->vFrom, a->vTo, k);
        if (a->cTarget)  *a->cTarget = LerpColor(a->cFrom, a->cTo, k);

        if (a->t >= a->dur) {                    // completion
            a->active = false;
            if (a->onDone) a->onDone(a->ctx);
            if (a->killOwner) /* owner->alive = false via ctx */;
        }
    }
}`}
${pit(`Actions hold <b>raw pointers</b> into game state — if the target object is freed mid-tween, the
next tick writes through a dangling pointer. Pool everything (entities, nodes, actions) and clear an
owner&rsquo;s actions on despawn. This is the one crash class the engine must design away.`)}
`);

S(12, 'Sequences & Parallel Groups', `
${lead(`Real choreography is <b>steps</b> (door opens, THEN player enters, THEN camera pans) and
<b>simultaneity</b> (rise + spin + shine at once). Two tiny composite types deliver both.`)}
${c`
// SEQUENCE: actions chained via onDone — a tiny coroutine of tweens
typedef struct SeqStep { ActionSpec spec; } SeqStep;
typedef struct Sequence {
    SeqStep  steps[8];  int count, current;
    ActionDone onAllDone; void *ctx;
} Sequence;

void SequenceStart(Sequence *s)        // fires step[0]
    { s->current = 0; SeqFireStep(s, 0); }

static void SeqAdvance(void *ctx) {    // onDone of each step
    Sequence *s = ctx;
    s->current++;
    if (s->current >= s->count) { if (s->onAllDone) s->onAllDone(s->ctx); }
    else SeqFireStep(s, s->current);
}
// building one — the "fluent" call reads like the animation it makes:
SEQ_START(&seq)
  SEQ(ActionFloat(&door->openT, 1.0f, 0.5f, EaseInOutQuad, 0))
  SEQ(ActionFloat(&player->pos.y, entryY, 0.8f, EaseOutQuad, 0))
  SEQ(ActionColor(&fadeCol, BLACK, 0.4f, EaseInOutQuad, 0))
SEQ_END(ctx, OnSequenceDone);

// PARALLEL is trivial — start N actions with the same delay:
void Parallel(const ActionSpec *specs, int n) {
    for (int i = 0; i < n; i++) SpawnAction(&specs[i]);   // same frame
}`}
${diag(
`  timeline ──────────────────────────────────────────────▶
  SEQ:   [door 0.5s]──[walk 0.8s]──────[fade 0.4s]── done()
  PAR:   [rise ──────────]             three tweens share
         [spin ────────]               one clock, one done()
         [shine ──────────]`, 'Sequence = serial · Parallel = same-delay group')}
${bp(`Sequences cost nothing until used — most animation stays a single tween. Reach for SEQ/PAR when a
cutscene or multi-beat effect appears, and resist nesting deeper than two levels: readable choreography
is flat choreography.`)}
`);

S(12, 'Alpha Fades, Slides & Pops — The Vocabulary', `
${lead(`Ninety percent of UI and gameplay animation is three motions: <b>fade</b> (alpha), <b>slide</b>
(position), <b>pop</b> (scale with overshoot). Here they are as one-liners over the engine.`)}
${c`
// FADE IN — node alpha 0→1 (Ch 7 nodes expose alpha directly)
ActionColor(&btn->alpha? as float: &btn->alpha, 1.0f, 0.3f, EaseOutQuad, delay);

// SLIDE IN — from offscreen to rest (pos carries the offset)
Vector2 from = Vector2Add(rest, (Vector2){ 0, -40 });
ActionVec2(&node->pos, rest, 0.45f, EaseOutCubic, delay);

// POP — scale with overshoot (OutBack nails it)
ActionFloat(&node->scale, 1.0f, 0.35f, EaseOutBack, delay);

// The canonical UI entrance combines all three, staggered:
static void UiEnter(SceneNode *n, int index) {
    float d = index * 0.07f;                  // cascade (Ch 8 law)
    n->alpha = 0; n->pos.y = -30; n->scale = 0.85f;
    ActionFloat(&n->alpha, 1.0f, 0.3f, EaseOutQuad,  d);
    ActionVec2 (&n->pos,  n->rest, 0.45f, EaseOutCubic, d);
    ActionFloat(&n->scale, 1.0f, 0.35f, EaseOutBack,  d);
}

// Button press feedback: scale down then spring back (PAR)
static void BtnPressPulse(SceneNode *n) {
    ActionFloat(&n->scale, 0.92f, 0.06f, EaseOutQuad, 0);       // squish
    ActionFloat(&n->scale, 1.0f, 0.25f, EaseOutBack, 0.06f);    // spring
}`}
${tbl(['Motion', 'Value + Ease', 'Feels like'], [
  ['Fade', 'alpha, OutQuad', 'Professional, quiet'],
  ['Slide', 'pos, OutCubic', 'Deliberate entrance'],
  ['Pop', 'scale, OutBack', 'Playful, bouncy (our house style)'],
  ['Squish+spring', 'scale down→back', 'Tactile button press'],
  ['Shake', 'pos jitter loop', 'Alarm, wrong-answer (Ch 3 shake)'],
  ['Pulse', 'scale loop 1↔1.05', 'Attention hint (idle CTA)']
])}
${note(`House style (consistent personality): OutBack pops for entrances, 0.25–0.45s durations,
0.07s stagger. Players feel coherence without knowing why — one style table, every screen.`)}
`);

S(12, 'Frame-by-Frame Sprite Animation — The Sheet', `
${lead(`Sprite animation = <b>flipping through atlas regions</b> on a timer. The sheet is packed frames
in a row (or grid); the clip is region list + frame time. Chapter 12&rsquo;s core data structure.`)}
${c`
// src/gfx/Anim.h
#define ANIM_MAX_FRAMES 16

typedef struct AnimClip {
    const char *name;             // "player_run"
    Rectangle   frames[ANIM_MAX_FRAMES];  // atlas regions (packed row!)
    int         frameCount;
    float       frameTime;        // seconds PER FRAME (e.g. 0.09)
    uint8_t     mode;             // ANIM_NORMAL / LOOP / PINGPONG / REVERSE
} AnimClip;

typedef struct AnimPlayer {
    const AnimClip *clip;
    float   t;                    // clock inside the clip
    int     frame;                // current index (mode-transformed)
    bool    finished;             // non-looping clips set this
    float   speed;                // 1.0 = normal (events can slow-mo)
} AnimPlayer;

// region extraction: a packed row of N frames, each w wide:
void ClipFromRow(AnimClip *c, const char *name, AtlasMap *map,
                 const char *region0, int count, float frameTime,
                 uint8_t mode) {
    Rectangle r0 = AtlasFind(map, region0);     // "player_run_0"
    float w = r0.width;
    for (int i = 0; i < count && i < ANIM_MAX_FRAMES; i++)
        c->frames[i] = (Rectangle){ r0.x + i * (w + 2),   // +2 gutter (Ch 4!)
                                    r0.y, w, r0.height };
    snprintf(c->name, 32, "%s", name);
    c->frameCount = count; c->frameTime = frameTime; c->mode = mode;
}`}
${diag(
`  atlas row "player_run_0..5" (packed, gutters preserved)
  ┌────┬─┬────┬─┬────┬─┬────┬─┬────┬─┬────┐
  │ f0 │ │ f1 │ │ f2 │ │ f3 │ │ f4 │ │ f5 │   w+2 stride
  └────┴─┴────┴─┴────┴─┴────┴─┴────┴─┴────┘
  clip: frameTime=0.09 LOOP → 5.5 steps/second run cycle`, 'One row = one clip; regions come from the atlas map')}
${bp(`Gutters matter twice for animation: pack-time separation (Ch 4) prevents <b>frame bleeding</b> —
the classic ghost-edge from a neighbor frame leaking in during point-filtered sampling at non-integer
positions.`)}
`);

S(12, 'The Animation Player — Tick & Modes', `
${lead(`One function advances any clip under any play mode. Modes are pure index math — the heart of
this chapter.`)}
${c`
// src/gfx/Anim.c — THE tick. Read mode cases slowly; this is exam material.
void AnimUpdate(AnimPlayer *p, float dt) {
    const AnimClip *c = p->clip;
    if (!c || c->frameCount == 0) return;
    p->t += dt * p->speed;

    // how many whole frames have elapsed?
    int elapsed = (int)(p->t / c->frameTime);
    int last = c->frameCount - 1;

    switch (c->mode) {
    case ANIM_NORMAL:                       // play once, hold last frame
        p->frame = Imin(elapsed, last);
        p->finished = (elapsed >= last);
        break;
    case ANIM_LOOP:                          // 0,1,2,0,1,2…
        p->frame = elapsed % c->frameCount;
        break;
    case ANIM_REVERSE:                       // 2,1,0 hold (or loop reversed)
        p->frame = Imin(elapsed, last);
        p->frame = last - p->frame;
        p->finished = (elapsed >= last);
        break;
    case ANIM_PINGPONG: {                    // 0,1,2,1,0,1,2… never pops
        int span = last * 2;                 // forward+back length
        int m = elapsed % span;
        p->frame = (m <= last) ? m : span - m;
        break;
    }
    }
}

// RENDER: the player picks the region; the renderer stays generic:
Rectangle AnimRegion(const AnimPlayer *p) {
    return p->clip->frames[p->frame];
}`} 
${tbl(['Mode', 'Index walk (3 frames)', 'Use'], [
  ['NORMAL', '0 1 2 (hold 2)', 'Explosions, one-shot effects'],
  ['LOOP', '0 1 2 0 1 2', 'Run cycles, water, torches'],
  ['REVERSE', '2 1 0 (hold 0)', 'UndoPlayback of a NORMAL clip!'],
  ['PINGPONG', '0 1 2 1 0 1 2', 'Idle breathing, hovering pickups — no pop']
])}
${pit(`<code class="inl">(int)(t / frameTime)</code> with <b>t never reset</b> is the whole trick — do NOT
advance a frame counter with <code class="inl">if (t >= frameTime) { frame++; t = 0; }</code>: that
drifts at low FPS and drops frames. Elapsed-frames-from-clock is exact and speed-scaling is one
multiplier (<code class="inl">speed</code>).`)}
`);

S(12, 'Clips as Data — Loading Animations from JSON', `
${lead(`Clips are content: designers add/retune them without code. The atlas map (Ch 4) already has
regions; the clip table just references them.`)}
${json`
{ "clips": [
  { "name": "player_run",  "mode": "loop",
    "frameTime": 0.09, "frames": ["player_run_0","player_run_1",
      "player_run_2","player_run_3","player_run_4","player_run_5"] },
  { "name": "player_idle", "mode": "pingpong",
    "frameTime": 0.25, "frames": ["player_idle_0","player_idle_1","player_idle_2"] },
  { "name": "coin_spin",   "mode": "loop",
    "frameTime": 0.12, "frames": ["coin_0","coin_1","coin_2","coin_3",
      "coin_4","coin_5","coin_6","coin_7"] },
  { "name": "rock_break",  "mode": "normal",
    "frameTime": 0.05, "frames": ["rock_brk_0","rock_brk_1",
      "rock_brk_2","rock_brk_3"] }
]}`}
${c`
// Loader: cJSON walk → clip table (validate: every frame name resolves!)
bool AnimLoadTable(AssetManager *a, const char *path) {
    // per clip: resolve each frame name via AtlasFind →
    //   missing frame = LOG_ERROR + assert (debug) — never silent
    // build region rect from region0 with stride (prev slide)
    return true;
}
// F5 hot reload (Ch 4) re-reads table: designers iterate at 60fps`}
${tbl(['Clip', 'Mode', 'Frame time', 'Why'], [
  ['player_run', 'LOOP', '0.09s', '~6.7 fps cycle = classic run cadence'],
  ['player_idle', 'PINGPONG', '0.25s', 'Breathing without pop'],
  ['coin_spin', 'LOOP', '0.12s', '8-frame spin = smooth rotation illusion'],
  ['rock_break', 'NORMAL', '0.05s', 'Fast one-shot, holds on rubble']
])}
${bp(`Frame-time tuning is the cheap art upgrade: a run cycle at 0.09 vs 0.12 feels like two different
games. The JSON table makes that a hot-reload experiment, not a code session.`)}
`);

S(12, 'Wiring Animations into GameObjects', `
${lead(`The GameObject gains an AnimPlayer; the spawn table declares clips; systems switch clips on
state. Three small diffs, animated world.`)}
${c`
// 1) object gains a player:
typedef struct GameObject {
    // …existing fields…
    AnimPlayer anim;
} GameObject;

// 2) spawn table declares the default clip:
static void SpawnCoin(GameObject *g, const GameObjectDef *d, AssetManager *a) {
    g->ren.atlasRegion = AssetsRegion(a, "coin_0");
    AnimPlay(&g->anim, AnimFind("coin_spin"));     // LOOP, from table
}

// 3) RENDER reads the animated region (renderer unchanged in shape!):
Rectangle src = g->anim.clip ? AnimRegion(&g->anim)
                             : g->ren.atlasRegion;   // static fallback

// Clip switching with guards — never restart a running clip:
void AnimPlayIfNew(AnimPlayer *p, const AnimClip *c) {
    if (p->clip == c) return;                 // already playing
    p->clip = c; p->t = 0; p->frame = 0; p->finished = false;
}`}
${pit(`Restarting the same clip every state check = the <b>flashing first frame</b> bug (character
vibrates at frame 0). Always guard: switch only when the clip pointer differs. The
<code class="inl">AnimPlayIfNew</code> wrapper makes the correct behavior the lazy one.`)}
`);

S(12, 'The Player Animation State Machine', `
${lead(`Character animation is a <b>state machine</b> (Ch 7 pattern, tiny scale): ground/air/action
states map to clips; transitions follow gameplay truth, never guess it.`)}
${diag(
`            ┌──────────── idle (LOOP/pingpong) ◀────────┐
            │  move input                    no input   │
            ▼                                           │
        run (LOOP) ──── jump pressed ──▶ jump (NORMAL)  │
            ▲                              │  hold?      │
            │ lands                        ▼             │
            └──────────────────── fall (LOOP slow) ──────┘
                     hit → hurt (NORMAL, iframes) → back
                     die → death (NORMAL + onDone → Ch 6 flow)`, 'Player anim FSM — driven by the SAME states the controller already computes')}
${c`
// src/actors/PlayerAnim.c — derive state, pick clip. No timers here!
void PlayerAnimUpdate(GameObject *p, float dt) {
    const AnimClip *want;
    if (p->gp.hurtT > 0)          want = AnimFind("player_hurt");
    else if (!p->gp.grounded)
        want = (p->tf.vel.y < 0) ? AnimFind("player_jump")
                                 : AnimFind("player_fall");
    else if (fabsf(p->tf.vel.x) > 10)
        want = AnimFind("player_run");
    else                          want = AnimFind("player_idle");

    AnimPlayIfNew(&p->anim, want);

    // speed-scaled run: animation rate matches ground speed (juice!)
    if (want == AnimFind("player_run"))
        p->anim.speed = ClampF(fabsf(p->tf.vel.x) / 320.0f, 0.7f, 1.3f);
    else p->anim.speed = 1.0f;
}`}
${tbl(['Rule', 'Why'], [
  ['Derive state from gameplay (vel, grounded)', 'Animation can never lie about the world'],
  ['Priority order: hurt > air > run > idle', 'Interrupts read correctly'],
  ['Scale run speed by velocity', 'Footfalls sync with motion — huge feel win'],
  ['Air clips: NORMAL (jump), LOOP (fall)', 'Jump is a one-shot arc; falling is a cycle']
])}
${bp(`The jump/fall split by <b>sign of vel.y</b> is the professional tell: rise = stretched anticipation
clip, fall = tucked loop. Two cheap frames of art sell weight better than any physics constant.`)}
`);

S(12, 'Squash & Stretch — The Juice Multiplier', `
${lead(`One scale pair transforms character feel: <b>stretch</b> along motion when accelerating,
<b>squash</b> against it on impact. Pure tween + restore.`)}
${c`
// anchored at the FEET (pivot!) — scale from the ground up:
// DrawTexturePro(..., pivot = { dst.width/2, dst.height }, ...)

static void PlayerSquashStretch(GameObject *p, float dt) {
    // decay toward 1 (Ch 8 damp — frame-rate safe)
    p->sx = DampF(p->sx, 1.0f, 10.0f, dt);
    p->sy = DampF(p->sy, 1.0f, 10.0f, dt);
}

// EVENTS drive the impulses (Ch 6 bus again):
static void OnJumped(const Event *e, World *w) {
    e->a->sx = 0.75f; e->a->sy = 1.30f;      // vertical stretch
    e->a->ren.pivot.y = 1.0f;                 // feet pivot
}
static void OnLanded(const Event *e, World *w) {
    float impact = ClampF(fabsf(e->a->tf.vel.y) / 900.0f, 0, 1);
    e->a->sx = 1.0f + 0.35f * impact;         // horizontal splat
    e->a->sy = 1.0f - 0.30f * impact;
    VCamAddShake(w->camRef, 2.0f * impact);   // proportional (Ch 8)
    FxBurst(FX_DUST, landingPoint, 4 + (int)(6*impact));
}`}
${diag(
`    jump:   ●            land:   ●
           /│\  stretch          \‾‾/  squash
          (tall, thin)          (short, wide)
    decay both back to 1× over ~0.3s via damp`, 'Squash & stretch: the oldest animation rule, one struct field')}
${pit(`Scale with the <b>pivot at the feet</b> or the bunny sinks into the floor when squashed.
<code class="inl">DrawTexturePro</code> origin parameter is your friend: <code class="inl">{w/2, h}</code>.
Center-pivot squash looks like the character is bouncing through the ground — classic first attempt bug.`)}
`);

S(12, 'Collectible Animation — The Coin, Fully Juiced', `
${lead(`The coin demonstrates the whole chapter in one object: looping spin, bob idle, magnet wobble on
approach, burst + fly-up + fade on collect.`)}
${c`
// Per-tick coin animation stack (each layer independent — composable!):
void CoinAnimate(GameObject *coin, World *w, float dt) {
    AnimUpdate(&coin->anim, dt);                  // 1) spin (LOOP)

    float t = w->levelTime;
    // 2) bob: position-seeded sine (Ch 6/8 law — deterministic)
    coin->bobOffset = sinf(t * 3.0f + coin->tf.pos.x * 0.05f) * 4.0f;

    // 3) magnet wobble when player is CLOSE (anticipation!)
    float d = Vector2Distance(coin->tf.pos, w->player->tf.pos);
    if (d < 90.0f) {
        float pull = 1.0f - d / 90.0f;
        coin->ren.scale = 1.0f + pull * 0.15f * sinf(t * 12.0f);
    } else coin->ren.scale = DampF(coin->ren.scale, 1.0f, 8, dt);
}

// COLLECT — the Ch 6 event handler now animates the goodbye:
static void OnCoinPicked(const Event *e, World *w) {
    GameObject *coin = e->b;
    coin->gp.collecting = true;               // stop being solid/trigger
    coin->tf.vel = (Vector2){ 0, -180 };      // fly UP

    // tween alpha out + pop scale over 0.35s, then despawn (killOwner!)
    ActionFloat(&coin->ren.alpha, 0.0f, 0.35f, EaseOutQuad, 0.0f);
    ActionFloat(&coin->ren.scale, 1.6f, 0.35f, EaseOutQuad, 0.0f)
        ->killOwner = true;                    // auto-cull (engine-owned)

    FxBurst(FX_SPARKLES, coin->tf.pos, 14);    // Ch 8 layer
    HudScorePunch();                            // Ch 5 HUD reacts
}`}
${tbl(['Layer', 'Mechanism', 'Chapter DNA'], [
  ['Spin', 'AnimClip LOOP', 'this chapter'],
  ['Bob', 'seeded sine', 'Ch 6/8'],
  ['Magnet wobble', 'distance-driven scale', 'this + Ch 6'],
  ['Collect fly+fade', 'velocity + tween, killOwner', 'this + Ch 6 event'],
  ['Sparkle burst', 'FX pool', 'Ch 8'],
  ['Score punch', 'HUD event reaction', 'Ch 5']
])}
${note(`<code class="inl">killOwner</code> closes the despawn loop: gameplay sets <code class="inl">collecting</code>
(excluded from collisions), tweens handle the visual goodbye, the engine removes the object when the
fade completes. No timers sprinkled in gameplay code.`)}
`);

S(12, 'UI Button Animation — The Full Treatment', `
${lead(`A shipped-feeling button animates four moments: entrance, hover/focus, press, and result. All
four are tweens you already own.`)}
${c`
// src/ui/WidgetsAnim.c — the four moments of a button
static void BtnOnFocus(SceneNode *n, bool focused) {   // hover/focus
    BtnData *b = n->userData;
    ActionFloat(&b->hoverT, focused ? 1.0f : 0.0f,
                0.15f, EaseOutQuad, 0);            // tint + nudge
    if (focused) ActionVec2(&n->pos,
                Vector2Add(n->rest, (Vector2){ 12, 0 }),   // slide right
                0.15f, EaseOutCubic, 0);
    else         ActionVec2(&n->pos, n->rest, 0.15f, EaseOutCubic, 0);
}

static void BtnOnPress(SceneNode *n) {                 // press
    BtnData *b = n->userData;
    ActionFloat(&n->scale, 0.94f, 0.05f, EaseOutQuad, 0);      // squish
    ActionFloat(&n->scale, 1.0f, 0.22f, EaseOutBack, 0.05f);   // spring
}

static void BtnOnResult(SceneNode *n, bool ok) {       // after action
    if (ok) {   // accepted: brief green flash + settle
        ActionColor(&n->tint, (Color){120,255,150,255}, 0.12f, EaseOutQuad, 0);
        ActionColor(&n->tint, WHITE, 0.3f, EaseInOutQuad, 0.12f);
    } else {    // rejected: horizontal shake (wrong password feel)
        for (int i = 0; i < 4; i++) {
            float off = (i % 2 == 0) ? 6.0f : -6.0f;
            ActionVec2(&n->pos, Vector2Add(n->rest, (Vector2){ off, 0 }),
                       0.05f, EaseOutQuad, i * 0.05f);
        }
        ActionVec2(&n->pos, n->rest, 0.05f, EaseOutQuad, 0.2f);
    }
}`}
${tbl(['Moment', 'Tween(s)', 'Latency rule'], [
  ['Entrance', 'alpha + pos + scale, staggered', 'done by the time user reaches it'],
  ['Focus', 'hoverT tint + 12px slide', '≤150ms — must feel instant'],
  ['Press', 'squish 0.05s + spring', 'immediate; audio same frame (Ch 10)'],
  ['Result', 'color flash or shake', 'shake total ≤ 0.25s']
])}
${bp(`Press feedback is <b>same-frame</b>: squish + click sound the instant the press registers, never
after the action completes. Players read responsiveness from that 1-frame delta more than from any
load-time optimization.`)}
`);

S(12, 'Animating Menu Screens — Full Sequences', `
${lead(`Screen-level animation = sequences over the whole scene graph: entrance cascade, exit sweep, and
the pause-menu dim that breathes.`)}
${c`
// MENU ENTRANCE: world fades from black, title pops, buttons cascade
static void MenuEnter(ScreenManager *sm) {
    SceneNode *root = sm->game->menuRoot;

    // 0) start fully hidden
    SceneSetAlpha(root, 0);
    SceneSetScale(root, 0.95f);

    // 1) fade the whole graph in (PAR root tween)
    ActionFloat(&root->alpha, 1.0f, 0.4f, EaseOutQuad, 0);

    // 2) title pops (delay 0.15)
    SceneNode *title = SceneFind(root, "title");
    ActionFloat(&title->scale, 1.0f, 0.4f, EaseOutBack, 0.15f);

    // 3) buttons cascade (delay per index — the Ch 8 law)
    SceneNode *btns[8]; int n;
    SceneFindAll(root, "button", btns, &n);
    for (int i = 0; i < n; i++)
        UiEnter(btns[i], i);       // slide 5 helper: +0.07s each
}

// MENU EXIT: reverse cascade, FASTER (0.07s steps, 60% duration)
static void MenuExit(ScreenManager *sm, void (*then)(void)) {
    SceneNode *btns[8]; int n;
    SceneFindAll(sm->game->menuRoot, "button", btns, &n);
    for (int i = 0; i < n; i++) {         // reversed order, quick
        ActionFloat(&btns[i]->alpha, 0.0f, 0.18f, EaseInQuad,
                    (n - 1 - i) * 0.045f);
    }
    ActionFloat(&sm->game->menuRoot->alpha, 0.0f, 0.3f,
                EaseInQuad, (float)n * 0.045f + 0.05f)
        ->onDone = then;                  // chain → screen switch (Ch 9)
}`}
${tbl(['Sequence', 'Shape', 'Duration budget'], [
  ['Menu entrance', 'fade → title pop → button cascade', '≤ 0.8s total'],
  ['Menu exit', 'reverse cascade + fade, chained to Ch 9', '≤ 0.5s'],
  ['Pause overlay', 'dim fade + panel slide-down', '≤ 0.3s (get back fast!)'],
  ['Settings open', 'panel slide + content stagger', '≤ 0.4s'],
  ['Game-over reveal', 'dim → title → stats → buttons', '0.5s beats (drama OK here)']
])}
${bp(`Exit animations run <b>faster</b> than entrances (about 60%) and chain into the transition (Ch 9
<code class="inl">onDone → GoTo</code>). Leaving should feel brisk; arriving can savor. The chained
<code class="inl">onDone</code> hook replaces the old hard swap — same three-beat transition, now
preceded by choreography.`)}
`);

S(12, 'Tweening Game Entities — Floating Score', `
${lead(`The floating &ldquo;+10&rdquo; is the archetype of gameplay-side tweens: spawn, rise, fade, die —
fully engine-owned, zero per-entity code at call sites.`)}
${c`
// src/fx/FloatText.c — pooled text sprites (like particles, with glyphs)
typedef struct FloatText {
    char     text[16];
    Vector2  pos;
    float    alpha, rise;
    float    scale;
    bool     alive;
    int      gen;              // generation guard (Ch 6 pooling law)
} FloatText;
static FloatText g_floats[32];

void FxScoreFloat(Vector2 at, int value) {
    FloatText *f = FloatAlloc();            // round-robin pool
    if (!f) return;
    snprintf(f->text, 16, "+%d", value);
    f->pos = at; f->alpha = 1; f->scale = 1.2f; f->alive = true;

    ActionFloat(&f->pos.y, f->pos.y - 40, 0.7f, EaseOutCubic, 0);   // rise
    ActionFloat(&f->alpha, 0.0f, 0.5f, EaseInQuad, 0.2f)            // fade late
        ->killOwner = true;
    ActionFloat(&f->scale, 1.0f, 0.15f, EaseOutQuad, 0);            // settle
}

// call sites stay one-liners (Ch 6 event handlers):
OnCoinPicked: FxScoreFloat(coin->tf.pos, coin->gp.value);`}
${diag(
`  t=0.0   "+10" pops at coin (scale 1.2 → 1.0)
  t=0.0   rises 40px over 0.7s (OutCubic — decelerating rise)
  t=0.2   alpha starts fading (InQuad — accelerating vanish)
  t=0.7   killOwner fires → slot freed
  ───── pool round-robins; 20 coins in one second all work`, 'One archetype: spawn → animate → auto-free')}
${pit(`Generation guards (the <code class="inl">gen</code> field) prevent the classic pool bug: an action
captured a slot&rsquo;s pointer, the slot was reused by a NEW float, and the old tween animates the new
text. Actions in the pool carry the generation; mismatch = ignore.`)}
`);

S(12, 'Game-Screen Animation Orchestration', `
${lead(`Now compose: a level-start sequence touches world, camera, HUD, and audio as one choreographed
beat sheet — all through actions and the event bus.`)}
${c`
// LEVEL START — the beat sheet (delays are the design!)
static void LevelIntroSequence(World *w) {
    // 0.0  camera: pan from goal flag to player (Ch 3 camera, tweened)
    VCamLock(w->camRef);
    ActionVec2(&w->camRef->cam.target, w->player->tf.pos,
               1.2f, EaseInOutCubic, 0.2f)
        ->onDone = UnlockCameraAndGo;      // hands back control (Ch 3 lock)

    // 0.0  banner: level name (Ch 5 HUD) slides in
    HudBannerShow(w->level.name, /*delay*/ 0.0f);

    // 0.6  player: drop-in from above with squash on land (event-driven)
    w->player->tf.pos.y -= 120;
    w->player->gp.frozen = true;           // Ch 6 control freeze

    // input unlocks when: camera tween done AND player grounded
    //   → OnLanded event clears gp.frozen (single source of truth)
}

// WIN SEQUENCE (extends Ch 8 slide with real tweens):
static void OnLevelWin(const Event *e, World *w) {
    w->player->gp.frozen = true;
    ActionFloat(&w->player->anim.speed, 0.0f, 0.4f, EaseOutQuad, 0); // freeze anim
    FxBurst(FX_SPARKLES, e->b->tf.pos, 30);
    ActionFloat(&w->camRef->cam.zoom, 0.92f, 1.4f, EaseInOutQuad, 0.3f); // pull back
    HudBannerShow("LEVEL CLEAR!", 0.6f);
    // Ch 9: GoTo fires behind a wipe after 2.2s (timer lives in World tick)
}`}
${tbl(['Beat', 'Delay', 'Systems touched'], [
  ['Camera pan goal→player', '0.2s', 'Ch 3 VCam (tweened target)'],
  ['Banner in', '0.0s', 'Ch 5 HUD'],
  ['Player drop-in', '0.6s', 'Ch 6 spawn + squash event'],
  ['Control unlock', 'on landed', 'Ch 6 event, single truth'],
  ['Win: freeze/pull/banner', '0–0.6s', 'Ch 8 stack + this chapter']
])}
${bp(`Sequencing rule that survives contact with players: <b>each beat unlocks the next via events, not
fixed total time</b> (control returns on LANDED, not at t=1.4s). Choreography that waits for gameplay
truth never desyncs when a frame hitches.`)}
`);

S(12, 'Ping-Pong in Practice — Idle & Hover', `
${lead(`PINGPONG is the quiet hero of game feel: it makes idle states breathe without art overhead.
Here is where Canyon Hopper uses each mode — a style sheet to steal.`)}
${tbl(['Object', 'Mode', 'Frame time', 'Notes'], [
  ['Player idle', 'PINGPONG', '0.25s', 'Breathing — no pop between frames'],
  ['Player run', 'LOOP', '0.09s', 'Cycle must wrap seamlessly (art law)'],
  ['Feather hover', 'PINGPONG', '0.4s', 'Floats gently; + sine bob (Ch 8)'],
  ['Goal flag wave', 'LOOP', '0.15s', 'Never stops — world is alive'],
  ['Porcupine walk', 'LOOP', '0.12s', 'Speed-scaled by patrol velocity'],
  ['Rock crack (warning)', 'NORMAL', '0.2s', 'Holds on cracked frame = telegraph'],
  ['Respawn burst', 'REVERSE (of gather)', '0.06s', 'Play materialization backwards!']
])}
${c`
// REVERSE trick: one art set, two effects — gather vs respawn:
//   "player_gather" (NORMAL): whole → pieces falling
//   respawn plays the SAME clip ANIM_REVERSE: pieces → whole
p->anim.clip = AnimFind("player_gather");
p->anim.mode = ANIM_REVERSE;      // materialize!
p->anim.speed = 1.6f;             // slightly fast: feels energetic`}
${pit(`PINGPONG on a 2-frame clip is just a toggle (fine); on an ODD frame count, the turnaround
<b>repeats the middle frame</b> (0,1,2,1,0 — frame 1 twice per edge). Art should avoid a dramatic
middle frame, or accept the double-beat as a heartbeat — know which your clip does.`)}
`);

S(12, 'Animation Events — Firing on Frames', `
${lead(`Some effects must fire at a <b>specific frame</b>: footstep dust on the contact frame, punch
impact at the swing&rsquo;s apex. Frame events = clip data + a check in the tick.`)}
${c`
// Extend clip with named events at frame indices:
typedef struct AnimEvent { int frame; const char *name; } AnimEvent;
typedef struct AnimClip {
    // …existing…
    AnimEvent events[4]; int eventCount;
} AnimClip;
// JSON: { "events": [ {"frame": 2, "name": "step"}, {"frame": 4, "name": "step"} ] }

// Tick detects crossings (works at ANY speed — the elapsed-frame law):
void AnimUpdate(AnimPlayer *p, float dt, World *w) {
    int prevFrame = p->frame;
    // …advance as before…

    for (int i = 0; i < p->clip->eventCount; i++) {
        int f = p->clip->events[i].frame;
        if (CrossedFrame(prevFrame, p->frame, f))
            EventsEmit(EV_ANIM_FRAME, p->owner,
                       p->clip->events[i].name);
    }
}
bool CrossedFrame(int prev, int cur, int target) {
    // handles loop wrap: prev 5 → cur 0 crossed frames 0..(cur)
    if (cur >= prev) return target > prev && target <= cur;
    return target > prev || target <= cur;   // wrapped
}

// Gameplay listens like any event (Ch 6 bus):
static void OnAnimFrame(const Event *e, World *w) {
    if (strcmp(e->userData, "step") == 0 && e->a == w->player) {
        FxBurst(FX_DUST, footPoint(e->a), 3);          // contact dust
        SoundPlayV(&w->sound, "sfx_step", 0.5f, 1.0f, 0); // soft steps
    }
}`}
${bp(`Frame events through the <b>event bus</b> (not callbacks in the anim tick) keep the animation
system pure — it reports, gameplay decides. Same architecture law as Ch 6: report early, act after.`)}
`);

S(12, 'Playback Control — Speed, Pause, Scrub', `
${lead(`Animation systems die without runtime control: hit-stop freezing the world, cutscenes scrubbing
clips, slow-mo the Ch 3 debug already wants. The AnimPlayer API is four functions.`)}
${c`
// 1) SPEED — world slow-mo already flows through (Ch 3 timeScale):
//    ActionsUpdate(dt * g->timeScale); AnimUpdate(..., dt * g->timeScale);
//    player death slow-mo: g->timeScale = 0.25 for 0.6s → tween back

// 2) PAUSE an individual player (cutscene subjects move, world holds):
void AnimPause(AnimPlayer *p, bool paused) { p->paused = paused; }
// tick: if (p->paused) return;   — one branch

// 3) SCRUB — set exact position (cutscenes, replays, editor):
void AnimSeek(AnimPlayer *p, float seconds) {
    p->t = seconds;
    // recompute frame via the mode math (extracted to AnimComputeFrame)
    p->frame = AnimComputeFrame(p->clip, p->t, &p->finished);
}

// 4) HIT-STOP — the fighting-game trick, one global:
void HitStop(float seconds) {
    g_hitstop = seconds;                     // world fully frozen…
}
// main loop: if (g_hitstop > 0) { g_hitstop -= rawDt;
//     draw everything; continue;  }          // …but keeps rendering`}
${tbl(['Control', 'Use case', 'Implementation home'], [
  ['<code class="inl">timeScale</code>', 'Slow-mo deaths (F2 debug; dramatic kills)', 'Ch 3 loop (whole world)'],
  ['<code class="inl">AnimPause</code>', 'Freeze subject, world moves', 'AnimPlayer'],
  ['<code class="inl">AnimSeek</code>', 'Cutscene scrub, replay, F6 gallery', 'AnimPlayer'],
  ['<code class="inl">HitStop</code>', '60–90ms freeze on big hits — weight', 'Global, above timeScale']
])}
${note(`Hit-stop is the cheapest &ldquo;game feel&rdquo; upgrade in existence: a 70ms full-freeze on a heavy
hit makes the same collision read 2× more impactful. Ship it on EV_PLAYER_HIT with big impact velocity —
and make sure audio ducks during it (Ch 10 duck = the freeze heard correctly).`)}
`);

S(12, 'Performance — Animating Cheaply', `
${lead(`Animation systems can silently become the frame&rsquo;s biggest cost. These rules keep the whole
chapter under a millisecond.`)}
${tbl(['Cost', 'Rule', 'Check'], [
  ['Tween tick', 'Actions only update ACTIVE slots; pool compacts', 'Debug: active count HUD'],
  ['Anim tick', 'Skip offscreen objects before AnimUpdate', 'Cull-first ordering'],
  ['Region lookup', 'Frames are precomputed rects — never AtlasFind in tick', 'grep: no string cmp in loops'],
  ['Draw batching', 'All sprites from ONE atlas → 1 batch regardless of anims', 'Ch 5 batch budget'],
  ['Text floats', 'Pool + generation, max 32', 'Ch 8 budget law']
])}
${c`
// The one perf trap to audit: string comparisons per frame
void BAD_Update(GameObject *g) {
    if (strcmp(g->animName, "player_run") == 0)   // every entity, every tick!
        g->anim.speed = …;
}
// GOOD: pointers ARE identity (slide on state machine):
if (g->anim.clip == AnimFind("player_run"))  …   // pointer compare, or better:
static const AnimClip *RUN;   // cache at boot; direct pointer equals`}
${pit(`<code class="inl">AnimFind("name")</code> per tick scans a table with <code class="inl">strcmp</code>
— fine at boot, wasteful in loops. Resolve clips to <code class="inl">const AnimClip*</code> once
(statics at init) and compare pointers. Identity beats names at runtime.`)}
`) ;

S(12, 'Chapter 12 Summary — Key Takeaways', `
${lead(`Motion is now declarative, composable, and data-driven across every layer of the game.`)}
<ul class="tight">
<li><b>Action = value + duration + ease + completion hook</b>; pooled like particles; generation-guarded.</li>
<li>Floats, Vector2s, colors, frame indices — one engine drives all; SEQ serializes, PAR groups.</li>
<li>The daily vocabulary: fade (alpha), slide (pos), pop (scale, OutBack), squish+spring (press), stagger (0.07s).</li>
<li>Sprite animation = <b>clip (regions + frameTime + mode)</b> + player (t, frame, speed); elapsed-frames-from-clock, never drifting counters.</li>
<li>Play modes: NORMAL one-shot, LOOP cycles, REVERSE free playback of art, PINGPONG seamless idles.</li>
<li>Player anim = state machine derived from gameplay truth; run speed scaled by velocity.</li>
<li>Squash & stretch with <b>feet pivot</b>; jump stretch, impact squash, damped recovery.</li>
<li>Frame events through the event bus; playback control = speed/pause/seek/hit-stop.</li>
<li>Screen choreography: entrance cascades, faster exits chained into Ch 9 transitions.</li>
<li>Performance: cull-first, pointer identity, one atlas, active-only updates.</li>
</ul>
<h3>Carrying forward</h3>
<p>2D is complete. Chapter 13 opens the third dimension: <b>cameras, meshes, materials, frustum culling,
ray picking</b> — the same architecture laws, new coordinate w.</p>
${bp(`Checkpoint: menus cascade in and sweep out; buttons squish on press; coins spin-bob-wobble and
die by tween; the player FSM never flashes frame 0; run speed matches ground speed; hit-stop makes hits
feel heavy — all hot-reloadable from JSON.`)}
`);
