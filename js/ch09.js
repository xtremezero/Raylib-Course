/* Chapter 9 — Screen Transitions */
defChapter(9, {
  tag: 'Polish',
  title: 'Screen Transitions',
  sub: 'An extensible transition framework, interpolation and easing for motion, and custom effects: fades, slides, wipes, shaders.',
  color: '#e879f9',
  topics: ['The transition framework', 'Progress, easing & hooks', 'Fade, slide & wipe effects', 'Shader-based wipes', 'RenderTexture post-processing', 'Choreography & accessibility']
});

SEC(9);

S(9, 'Why Transitions Matter', `
${lead(`A hard cut between screens says &ldquo;software&rdquo;; a transition says &ldquo;place&rdquo;. Transitions are also
<b>load-cover</b>: the most expensive frame in a game is the first frame of a new screen — hide it
behind motion.`)}
${tbl(['Screen change', 'Without transition', 'With transition'], [
  ['Menu → Game', '1-frame flash of unloaded world', 'Wipe conceals level load hitch'],
  ['Level → Level', 'Jarring teleport', 'Morph: continuity of journey'],
  ['Game Over → Menu', 'Sudden tonal shift', 'Fade: emotional release'],
  ['Any → Loading', 'Frozen frame = &ldquo;crashed?&rdquo;', 'Animated progress = alive']
])}
${diag(
`  hard cut:   [SCREEN A][SCREEN B]        ← instant, cheap, cold
  transition: [SCREEN A]═▶ blend/wipe ═▶[SCREEN B]
                      0.3–0.6s, one framework, every screen pair`, 'One framework, every seam in the game')}
${bp(`Transitions are <b>infrastructure, not per-screen code</b>. Build the framework once (this chapter);
adding a new effect later = one file + one registry entry — never a rewritten screen.`)}
${pit(`The failure that looks like a bug but is design: input <b>bleed-through</b> — player mashing JUMP
during a fade skips the intro or double-triggers the new screen. The framework must own input gating
(slide 4), or every transition ships with a minigame of chance.`)}
`);

S(9, 'The Framework — Concepts & State Machine', `
${lead(`Every transition is the same three-beat dance: <b>out</b> (cover), <b>swap</b> (change screens
under the cover), <b>in</b> (reveal). The framework sequences beats; effects only draw.`)}
${diag(
`  IDLE ──start(effect, targetScreen)──▶ OUT
   ▲                                     │ t: 0→1 (ease!)  world still runs
   │                                     ▼
   └── t:1 ── IN ◀── SWAP (ScreensSet,  t: 0→1 (ease)     input GATED
        done      load, music crossfade)                    until t≥1 → IDLE`, 'Three beats, two easings, one gate')}
${c`
// src/fx/Transition.h
typedef enum {
    TR_NONE, TR_FADE, TR_SLIDE_L, TR_SLIDE_U,
    TR_WIPE_CIRCLE, TR_WIPE_DIAGONAL, TR_SHADER_DISSOLVE,
    TR_SHADER_PIXELATE, TR_COUNT
} TransitionKind;

typedef struct Transition {
    TransitionKind kind;
    float t;                  // 0..1 within CURRENT beat
    float dur;                // per beat (out & in symmetric)
    bool   phaseIn;           // false=out(covering), true=in(revealing)
    Screen *target;           // screen to swap to at midpoint
    float  ease(float t);     // fn ptr — Ch 8 catalog
    // shader effects only:
    Shader  shader;           // loaded lazily
    int     uProgress;
} Transition;`}
${tbl(['Framework owns', 'Effect owns'], [
  ['Beats, timing, easing', 'What the cover LOOKS like'],
  ['Screen swap at covered moment', 'Drawing during out/in'],
  ['Input gating + skip rules', '—'],
  ['Shader lifetime, uniforms (progress)', '—']
])}
${note(`The midpoint (fully covered) is where <code class="inl">ScreensSet</code> fires — the new screen's
<code class="inl">enter()</code>, level load, everything expensive hides behind the effect's climax. That's
the load-cover trick in one sentence.`)}
`);

S(9, 'The Framework — Core Loop', `
${lead(`The manager integration is ~60 lines: update advances <code class="inl">t</code>, fires the swap,
draws the effect <b>over</b> everything (last layer of the frame).`)}
${c`
// src/fx/Transition.c
static Transition g_tr = { .kind = TR_NONE };

void TransitionStart(TransitionKind kind, Screen *target, float dur) {
    if (g_tr.kind != TR_NONE) return;      // never double-start
    g_tr = (Transition){ .kind = kind, .target = target,
                         .dur = dur, .phaseIn = false };
    if (KindUsesShader(kind)) TransitionLoadShader(&g_tr);
}

void TransitionUpdate(ScreenManager *sm, float dt) {
    if (g_tr.kind == TR_NONE) return;
    g_tr.t += dt / g_tr.dur;

    if (g_tr.t >= 1.0f && !g_tr.phaseIn) {      // OUT complete → SWAP
        ScreensSet(sm, g_tr.target);            // expensive, hidden
        g_tr.phaseIn = true; g_tr.t = 0;
    } else if (g_tr.t >= 1.0f) {                // IN complete → IDLE
        g_tr = (Transition){ .kind = TR_NONE };
    }
}

void TransitionDraw(void) {                     // called LAST in frame
    if (g_tr.kind == TR_NONE) return;
    float k = g_tr.ease(ClampF(g_tr.t, 0, 1));  // eased progress
    switch (g_tr.kind) {
        case TR_FADE:         DrawFade(k, g_tr.phaseIn);          break;
        case TR_SLIDE_L:      DrawSlideL(k, g_tr.phaseIn);       break;
        case TR_WIPE_CIRCLE:  DrawWipeCircle(k, g_tr.phaseIn);   break;
        case TR_SHADER_DISSOLVE: DrawShaderWipe(&g_tr, k);       break;
        // … each effect: one function, this beat direction
        default: break;
    }
}`}

// Integration — 3 lines in the manager (Ch 7):
//   ScreensUpdate:  TransitionUpdate(sm, dt);   ← before draw
//   ScreensDraw:    …stack draws… TransitionDraw(); ← absolute last
${bp(`Draw order law for transitions: <b>absolutely last</b> — over HUD, over debug (except F1), over
everything. A wipe that lets the old HUD peek through for one frame reads as broken glass.`)}
`) ;

S(9, 'Input Gating & The Skip Contract', `
${lead(`Transitions must be <b>safe</b>: no input reaches screens mid-transition, and (for long ones)
mashing skip does something sensible. Both are one function.`)}
${c`
// 1) GATE: manager consults the transition before dispatching input
bool ScreensInputAllowed(const ScreenManager *sm) {
    return g_tr.kind == TR_NONE               // fully idle
        || (g_tr.phaseIn && g_tr.t > 0.15f);  // reveal almost done
}
// ScreensHandleInput():  if (!ScreensInputAllowed(sm)) return;

// 2) SKIP: any press during OUT fast-forwards to the swap instantly
void TransitionSkipIfRequested(void) {
    if (g_tr.kind == TR_NONE) return;
    if (AnyInputPressed()) {                    // Ch 7 helper
        if (!g_tr.phaseIn) { g_tr.t = 1.0f; }   // jump to swap
        else               { g_tr.t = 1.0f; }   // jump to done
        // …but NEVER skip the swap itself — only the animation
    }
}`}

${tbl(['Rule', 'Why'], [
  ['Block input until reveal ≥85%', 'Old screen can&rsquo;t act on &ldquo;future&rdquo; presses; new screen can&rsquo;t be double-entered'],
  ['Skip = jump animation, not swap', 'The swap MUST happen — skipping may only shorten the show'],
  ['First 0.15s of reveal still gated', 'Menu focus settles before hands land'],
  ['ESC during OUT never cancels target', 'Transitions are commitments; cancel = state bugs']
])}
${pit(`The subtlest bleed: a screen's <code class="inl">enter()</code> reading input state
(<code class="inl">IsKeyPressed</code> is edge-based — the edge may belong to the PREVIOUS screen's last
frame). Gate at the manager, and never poll input inside <code class="inl">enter()</code>.`)}
`);

S(9, 'Easing & Progress — Choreography Basics', `
${lead(`The same effect changes personality with its easing. Choosing ease per beat is the cheapest
&ldquo;art direction&rdquo; in the chapter — here is the standard pairing vocabulary.`)}
${tbl(['Effect', 'OUT ease', 'IN ease', 'Personality'], [
  ['Fade', 'InOutQuad', 'InOutQuad', 'Neutral, cinematic, safe default'],
  ['Slide', 'InOutCubic', 'OutBack (subtle)', 'Playful, energetic menus'],
  ['Wipe circle', 'InQuad', 'OutQuad', 'Iris — dramatic reveals'],
  ['Diagonal wipe', 'InOutQuint', 'InOutQuint', 'Stylish, editorial'],
  ['Shader dissolve', 'Linear', 'OutQuad', 'Organic, magical'],
  ['Pixelate', 'InQuad', 'OutBounce? no — OutQuad', 'Retro systems boot']
])}
${c`
// Duration defaults — short enough to respect, long enough to register:
//   fades/wipes: 0.45s per beat     slides: 0.55s     shaders: 0.6s
// death/level-win: slower OUT (0.7s) — emotional beats get time

// Per-effect (kind, easeIn, easeOut, dur) table — data, like FX presets:
static const struct { TransitionKind k; EaseFn out, in; float dur; }
TR_STYLE[TR_COUNT] = {
    [TR_FADE]        = { TR_FADE,        EaseInOutQuad, EaseInOutQuad, .45f },
    [TR_SLIDE_L]     = { TR_SLIDE_L,     EaseInOutCubic,EaseOutBack,   .55f },
    [TR_WIPE_CIRCLE] = { TR_WIPE_CIRCLE, EaseInQuad,    EaseOutQuad,   .50f },
};`}
${bp(`Symmetry rule of thumb: <b>OUT and IN are mirror personalities</b> — cover gently, reveal
decisively (or vice versa), but keep the pair in one family. Mixing OutElastic cover with Linear reveal
feels like two different designers shipped half a transition each.`)}
`) ;

S(9, 'Effect: Fade — The Workhorse', `
${lead(`The fade: one rectangle, one alpha. 90% of transitions in shipped games are this — done well.`)}
${c`
// src/fx/TransFade.c
void DrawFade(float k, bool phaseIn) {
    // OUT: alpha 0→1 (covering)      IN: alpha 1→0 (revealing)
    float a = phaseIn ? (1.0f - k) : k;

    // 1) plain black fade — the classic
    DrawRectangle(0, 0, GetScreenWidth(), GetScreenHeight(),
                  Fade(BLACK, a));

    // 2) the classy variant: fade THROUGH the destination's palette
    //    (cover to deep purple → reveal): color eases too
    Color cover = LerpColor(BLACK, (Color){24,16,40,255}, a);
    DrawRectangle(0, 0, GetScreenWidth(), GetScreenHeight(),
                  Fade(cover, a));
}`}

${tbl(['Fade variant', 'Feel', 'Effort'], [
  ['Black', 'Neutral', '0 lines beyond default'],
  ['Palette color', 'Branded, warm', '1 LerpColor'],
  ['White flash', 'Impact/damage, dream', 'same code, WHITE'],
  ['Two-stage (game→dark→menu)', 'Emotional separation', 'framework does it free']
])}
${pit(`Fade-to-black over a <b>dark scene</b> (night level) is invisible — the screen just&hellip; sits there.
Fade through a slightly lifted color, or use the white variant there. A transition nobody perceives is
a stall the player feels.`)}
`) ;

S(9, 'Effect: Slide — Directional Motion', `
${lead(`Slides keep both screens visible, in motion — the strongest &ldquo;journey&rdquo; feeling. Implemented
without render textures by sliding <b>cover panels</b>; the real-thing version (both scenes moving) needs
two render targets — slide 15 shows that upgrade.`)}
${c`
// src/fx/TransSlide.c — panel-slide variant (cheap, no RTs)
void DrawSlideL(float k, bool phaseIn) {
    int W = GetScreenWidth(), H = GetScreenHeight();
    float x = phaseIn ? -(k * W)  // panel exits left (revealing)
                      : ((1-k) * -W); // panel enters from right? no:

    // recompute per beat, single source of truth:
    float panelX = phaseIn ? Lerp(0, -W, k)      // IN: slide out L
                           : Lerp(W, 0, k);      // OUT: slide in from R
    DrawRectangle((int)panelX, 0, W, H, (Color){18,14,30,255});

    // style: a bright edge-line rides the panel's leading edge
    DrawRectangle((int)panelX + W - 6, 0, 6, H, GOLD);

    // style 2: two staggered panels (gap trails) = layered, less "curtain"
    DrawRectangle((int)(panelX + 40), 0, W, H,
                  (Color){30,24,50,200});   // under-panel, 40px behind
}`}

${diag(
`  OUT beat (cover):                 IN beat (reveal):
  ┌────┬───────────────┐            ┌───────────────┬────┐
  │ ▓▓▶│   old screen  │            │  new screen   │◀▓▓ │
  └────┴───────────────┘            └───────────────┴────┘
   panel slides in from right        panel exits left
   (gold edge = the "wipe line")     world swaps while covered`, 'Direction vocabulary: L/R/U/D + diagonals = 8 feels')}
${bp(`Pick ONE horizontal direction per flow-pair and keep it: menu→game slides LEFT, game→menu slides
RIGHT — back-tracks mirror forward-tracks. Players build a spatial map of your UI; random directions
burn it.`)}
`) ;

S(9, 'Effect: Wipes — Linear, Diagonal, Iris', `
${lead(`Wipes reveal along a <b>shape</b>: straight edge, diagonal, growing circle (iris). The circle
case needs a hole in the cover — masked drawing, three ways to do it.`)}
${c`
// src/fx/TransWipe.c
void DrawWipeDiagonal(float k, bool phaseIn) {
    // cover edge = diagonal line sweeping across the screen
    float cover = phaseIn ? 1.0f - k : k;         // 0..1 covered amount
    int W = GetScreenWidth(), H = GetScreenHeight();
    // triangle fan along the diagonal: simplest = 2 big triangles
    Vector2 tip = { cover * (W + H), 0 };
    DrawTriangle((Vector2){0,0}, tip,
                 (Vector2){tip.x - H, H}, DARKCOVER);
    DrawTriangle((Vector2){0,0}, (Vector2){tip.x - H, H},
                 (Vector2){0, H}, DARKCOVER);
}

void DrawWipeCircle(float k, bool phaseIn) {
    float cover = phaseIn ? 1.0f - k : k;
    float maxR = Vector2Length((Vector2){
        GetScreenWidth()/2.0f, GetScreenHeight()/2.0f});
    float r = maxR * cover;

    // IRIS: cover everywhere EXCEPT a circle — negative space.
    // Option A (4 rects around circle) — seams visible, avoid.
    // Option B (blend-mode trick): additive cannot darken…
    // Option C (the pro way): a tiny custom shader mask → slide 14.
    // For pure-shape builds: draw the ring growing as a thick outline
    // and accept full-cover at k=1 (most iris wipes do exactly this):
    DrawCircleLines(GetScreenWidth()/2, GetScreenHeight()/2,
                    (int)r, 3, GOLD);   // leading edge sparkle
    if (cover >= 1.0f) DrawRectangle(0,0,W,H,DARKCOVER);
}`}

${tbl(['Wipe shape', 'Reads as', 'Best for'], [
  ['Straight L→R', 'Turn of a page', 'Level → next level'],
  ['Diagonal ↘', 'Stylish comic panel', 'Menu ↔ game'],
  ['Iris (circle)', 'Classic cartoon/theater', 'Death respawn, level intro'],
  ['Keyhole (vertical bar)', 'Slot machine / sci-fi scan', 'Minigames, shops']
])}
${pit(`<code class="inl">DrawCircleLines</code> at growing radius on the OUT beat is fine, but the
<i>reveal</i> iris (hole shrinking? growing?) must match: decide whether the CIRCLE is the reveal or the
cover and keep both beats mirrored — flip-flopping mid-transition is the #1 &ldquo;cheap wipe&rdquo; tell.`)}
`) ;

S(9, 'Shaders 101 — The Two-File Mental Model', `
${lead(`raylib shader effects need exactly: load (<code class="inl">LoadShader</code>), feed
(<code class="inl">SetShaderValue</code>), wrap (<code class="inl">BeginShaderMode</code>). The full
authoring deep-dive is Chapter 11 — today, the transitions-specific minimum.`)}
${c`
// Transitions use ONE uniform: progress (0..1). Write it once, reuse.
static Shader g_wipeShader;
static int g_uProgress;

void TransitionLoadShader(Transition *tr) {
    if (g_wipeShader.id == 0) {                     // lazy, once
        g_wipeShader = LoadShader(NULL,             // no vertex stage
            "assets/shaders/wipe_dissolve.fs");
        g_uProgress = GetShaderLocation(g_wipeShader, "progress");
    }
    tr->shader = g_wipeShader;
    tr->uProgress = g_uProgress;
}

// At draw: the shader is applied to a FULLSCREEN QUAD covering the screen:
void DrawShaderWipe(Transition *tr, float k) {
    BeginShaderMode(tr->shader);
        SetShaderValue(tr->shader, tr->uProgress, &k, SHADER_UNIFORM_FLOAT);
        // the quad: raylib's default white texture stretched to screen
        Rectangle src = {0,0,1,1};
        Rectangle dst = {0,0,(float)GetScreenWidth(),(float)GetScreenHeight()};
        Vector2 pivot = {0,0};
        DrawTexturePro(GetWhiteTexture(), src, dst, pivot, 0.0f, WHITE);
    EndShaderMode();
}`}
${glsl`
// assets/shaders/wipe_dissolve.fs  — GLSL 120 (works on GL 2.1 → WebGL1+)
#version 120
uniform float progress;      // driven from C every frame

float hash(vec2 p) {         // cheap per-pixel noise
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
void main() {
    float n = hash(gl_FragCoord.xy / 8.0);   // chunky noise
    // pixel covered if its noise threshold beats progress:
    float cover = step(n, progress);         // 1 = covered, 0 = show
    gl_FragColor = vec4(0.05, 0.04, 0.09, cover);
}`}
${note(`The fragment shader runs <b>per pixel</b> of one fullscreen quad — that is why transition shaders
are cheap: 0.5s × 2 beats of a trivial kernel. Post-processing full games (Ch 11) is the same machinery
with heavier math.`)}
`) ;

S(9, 'Shader Transition I — Dissolve / Burn', `
${lead(`The flagship custom wipe: pixels of the old world burn away to reveal the new. One texture
mask (noise), an edge glow, and the progress uniform doing all the work.`)}
${glsl`
// assets/shaders/wipe_dissolve.fs — v2: burning edge
#version 120
uniform float progress;             // 0 = old screen, 1 = new screen

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
void main() {
    float n = hash(gl_FragCoord.xy / 6.0);
    float edge = 0.08;                       // glow band width

    // covered? (noise threshold swept by progress)
    float d = n - progress;                  // >0 → burned away
    float cover = step(0.0, d);

    // edge glow: near the burn frontier (|d| < edge)
    float glow = (1.0 - smoothstep(0.0, edge, abs(d)))
               * step(-edge, d);             // only on the burning side
    vec3 glowCol = vec3(1.0, 0.55, 0.15);    // ember orange

    vec4 coverCol = vec4(0.03, 0.02, 0.05, 1.0);
    gl_FragColor = mix(coverCol, vec4(glowCol, 1.0), glow);
    gl_FragColor.a = max(cover, glow);       // transparent where burned
}`}
${tbl(['Tweak knob', 'Effect'], [
  ['hash scale (÷6 vs ÷16)', 'Fine sizzle vs chunky burn'],
  ['edge width', 'Thin laser line vs wildfire front'],
  ['glowCol', 'Ember / ice / void / hot pink — the theme color'],
  ['progress easing (C side!)', 'Linear = even burn; InQuad = accelerating fire']
])}
${bp(`The glow band is what makes it &ldquo;burn&rdquo; instead of &ldquo;static&rdquo;. Same trick powers dissolve
deaths (Ch 11 applies it to sprites) — master this one shader and you have a house style.`)}
`) ;

S(9, 'Shader Transition II — Pixelate Morph', `
${lead(`Retro personality: the old screen pixelates into blocks, blocks resolve into the new screen.
All in the pixel's own coordinate math — quantize by a factor that peaks at progress 0.5.`)}
${glsl`
// assets/shaders/wipe_pixelate.fs
#version 120
uniform float progress;         // 0 → 0.5 → 1: blockiness bell curve
uniform vec2  resolution;       // screen size (C sets each frame)

void main() {
    // blockiness: 0 at both ends, max at the middle of the transition
    float bell   = sin(progress * 3.14159265);       // 0..1..0
    float blocks = mix(1.0, 64.0, bell);             // 1px → 64px blocks

    // quantize our coordinate: snap to block grid
    vec2 grid = floor((gl_FragCoord.xy * blocks) / resolution)
              * (resolution / blocks);

    // sample-style flicker: each block picks ONE of 4 hues randomly
    float r = fract(sin(dot(floor(gl_FragCoord.xy / blocks),
                            vec2(12.9898, 78.233))) * 43758.5453);
    vec3 shade = mix(vec3(0.9), vec3(0.6), step(0.5, r));

    // the cover: solid blocks at full bell, gone at the ends
    float a = smoothstep(0.0, 0.15, bell);           // ramp in/out
    gl_FragColor = vec4(vec3(0.06, 0.05, 0.10) * shade, a);
}`}
${c`
// resolution uniform — size changes must propagate (resize mid-transition!):
int uRes = GetShaderLocation(shader, "resolution");
Vector2 res = { (float)GetScreenWidth(), (float)GetScreenHeight() };
SetShaderValue(shader, uRes, &res, SHADER_UNIFORM_VEC2);`}
${pit(`The pixelate bell needs the <b>swap at exactly progress 0.5</b> — pixel-blockiness peak hides the
screen change. Framework rule from slide 3 fires the swap at covered peak; for this effect the framework
uses <code class="inl">bell</code> visibility, not linear t, to decide &ldquo;fully covered&rdquo;. Generalize: each
effect can report its own "peak" moment.`)}
`) ;

S(9, 'RenderTexture — Capturing Both Worlds', `
${lead(`The A/B slide and pixelate covered the screen with a panel/shader. The deluxe tier captures the
<b>real scenes</b> into two render textures and literally slides/morphs both — cameras, HUD and all.`)}
${c`
// src/fx/TransitionRT.c — true dual-scene slide
static RenderTexture2D rtA, rtB;    // lazily sized, resized with window

void DrawTrueSlide(ScreenManager *sm, float k, bool phaseIn) {
    // 1) render CURRENT (top) screen into rtA
    BeginTextureMode(rtA);
        ClearBackground(BLACK);
        sm->stack[sm->top]->draw(sm);       // the real scene, real camera
    EndTextureMode();

    // 2) target screen into rtB (its enter() already ran at swap)
    BeginTextureMode(rtB);
        ClearBackground(BLACK);
        sm->stack[sm->top]->draw(sm);       // after swap, top == target
    EndTextureMode();

    // 3) slide both: old exits left while new enters from right
    int W = GetScreenWidth();
    float xA = phaseIn ? Lerp(0, -W, k) : 0;
    float xB = phaseIn ? W : Lerp(W, 0, k);
    Rectangle src = { 0, 0, (float)rtA.texture.width,
                           -(float)rtA.texture.height };  // GL flip!
    DrawTexturePro(rtA.texture, src, (Rectangle){ xA, 0,
        (float)W, (float)GetScreenHeight() }, (Vector2){0,0}, 0, WHITE);
    DrawTexturePro(rtB.texture, src, (Rectangle){ xB, 0,
        (float)W, (float)GetScreenHeight() }, (Vector2){0,0}, 0, WHITE);
}`}
${tbl(['Tier', 'Looks like', 'Cost'], [
  ['Panel cover (slides so far)', 'Scene A exits behind a panel', 'Free'],
  ['Dual RT slide (above)', 'Both scenes really move', '+2 fullscreen renders during transition only'],
  ['RT + shader morph', 'A pixel-melts into B', '+2 RTs + shader pass']
])}
${bp(`Allocate render textures <b>once</b> (lazy at first transition) and resize on window change —
creating GPU textures mid-transition is exactly the hitch you are hiding. The GL <b>Y-flip</b> on source
rects strikes again: -height, always.`)}
`) ;

S(9, 'Transition Registry & Screen Integration', `
${lead(`Effects registered in a table (like FX presets); screens request transitions by intent, not by
name — the manager picks the pair-appropriate one.`)}
${c`
// src/fx/TransitionRegistry.c
typedef struct { TransitionKind kind; float dur; EaseFn out, in; }
    TrStyle;
static const TrStyle STYLES[TR_COUNT] = { /* slide 5 table */ };

// Screens call INTENT; style table decides the look:
void GoTo(ScreenManager *sm, Screen *target, TrIntent intent) {
    switch (intent) {
    case TR_INTENT_MENU_TO_GAME:   // stylish: diagonal or dissolve
        TransitionStart(TR_WIPE_DIAGONAL, target, STYLES[TR_WIPE_DIAGONAL].dur);
        break;
    case TR_INTENT_LEVEL_FLOW:     // journey: slide
        TransitionStart(TR_SLIDE_L, target, STYLES[TR_SLIDE_L].dur);
        break;
    case TR_INTENT_DEATH:          // emotional: slow fade through dark
        TransitionStart(TR_FADE, target, 0.7f);
        break;
    case TR_INTENT_FAST:           // settings pop — near-instant
        TransitionStart(TR_FADE, target, 0.18f);
        break;
    }
}`}

${tbl(['Intent', 'Effect', 'Duration'], [
  ['Menu ↔ game', 'Diagonal wipe / dissolve', '0.5s'],
  ['Level → level', 'Slide (direction fixed)', '0.55s'],
  ['Death / respawn', 'Fade to dark (slow)', '0.7s'],
  ['Overlay push/pop', 'Quick fade', '0.18s'],
  ['First boot → menu', 'Iris from logo', '0.6s']
])}
${note(`<b>Intent-based requests</b> future-proof: redesign all transitions later (new theme!) by editing
the style table — zero screen-code changes. Same data-driven law as FX library and spawn tables.`)}
`) ;

S(9, 'Choreography — Transitions as Scene Beats', `
${lead(`Stack transitions with the Ch 8 sequencing instinct: a level-win is fade <b>out of gameplay
elements first</b>, then the wipe. Two-layer choreography in the framework's beat hooks.`)}
${c`
// Extend TransitionStart with optional beat hooks (fn pointers):
typedef void (*TrHook)(void);         // runs at beat boundaries

void TransitionStartEx(TransitionKind kind, Screen *target, float dur,
                       TrHook onCovered, TrHook onRevealed);

// Level-win: before the wipe covers, play the exit choreography
static void OnLevelWin(const Event *e, World *w) {
    // Ch 8 stack runs (sparkles, zoom, banner)…
    TransitionStartEx(TR_WIPE_CIRCLE, &ScreenGame, 0.6f,
        /*onCovered*/ LoadNextLevel,          // at peak: load hidden
        /*onRevealed*/ HudBannerLevelIntro);  // new level greets
}`}

${diag(
`  t=0.0   gameplay freezes (win) — Ch 8 effects play
  t=0.4   iris OUT begins (EaseInQuad accelerating close)
  t=0.9   FULLY COVERED ──▶ onCovered: next level loads (hitch hidden!)
  t=0.9   iris IN begins (EaseOutQuad decelerating open)
  t=1.4   revealed ──▶ onRevealed: banner, music sting resumes
  ─────── total 1.4s, of which the player never sees a load frame`, 'The beat hooks are where expensive work hides')}
${bp(`Anything costing &gt;8ms (level parse, atlas swap, GC of entities) belongs in
<code class="inl">onCovered</code>. The transition is a <b>curtain</b>; use the dark to move furniture.`)}
`) ;

S(9, 'Accessibility & Options', `
${lead(`For some players, full-screen motion is pain, not polish. Ship motion settings — they are three
lines thanks to the intent table.`)}
${c`
// Settings (Ch 7) gains one field:
typedef struct Settings {
    // …
    int motionLevel;        // 0=full, 1=reduced, 2=minimal
} Settings;

// The intent dispatcher honors it:
void GoTo(ScreenManager *sm, Screen *target, TrIntent intent) {
    switch (sm->game->settings.motionLevel) {
    case 1:  TransitionStart(TR_FADE, target, 0.30f); break; // plain+fast
    case 2:  TransitionStart(TR_FADE, target, 0.12f); break; // near-instant
    default: /* full style table as before */ break;
    }
}`}
${tbl(['Level', 'Behavior', 'Who it serves'], [
  ['Full', 'All effects, 0.45–0.7s', 'Default; most players'],
  ['Reduced', 'Fades only, ≤0.3s, no slides/pixelate', 'Motion sensitivity'],
  ['Minimal', '0.12s cuts', 'Vestibular disorders; also speedrunners!']
])}
${note(`Also honor <code class="inl">prefers-reduced-motion</code> on web builds: query once via
EM_ASM at boot and default <code class="inl">motionLevel</code> from it — platform courtesy with zero UI.`)}
${pit(`Never map reduced-motion to &ldquo;no transition at all&rdquo; — the swap must still pass through the
covered state or the load hitch returns (and input gating changes). Fast fade, always.`)}
`) ;

S(9, 'Performance — Fullscreen Pass Economics', `
${lead(`Transition costs are bounded and predictable — but know the three price tags so 30fps phones
don't surprise you at the finish line.`)}
${tbl(['Effect tier', 'Per-frame cost', 'Mobile note'], [
  ['Shape covers (fade/slide/wipe)', 'A few rects = trivial', 'Free everywhere'],
  ['Shader single-pass (dissolve/pixelate)', '1 fullscreen pixel pass', 'Fine; keep hash math cheap'],
  ['Dual RT + shader', '3 fullscreen passes (2 render + 1 composite)', 'The expensive one — skip on low tier'],
  ['Any + Ch 5 letterbox target', '+1 blit', 'Already budgeted']
])}
${c`
// Cheap guards, one-time checks:
// 1) shader compiled OK? (context loss on web!)
if (g_wipeShader.id == 0) { TraceLog(LOG_WARNING,
    "[TR] shader missing → fallback to fade");
    tr->kind = TR_FADE; }

// 2) low tier auto-downgrade (platform capability, Ch 2):
if (!platform.capableShaderFX) tr->kind = TR_FADE;

// 3) RTs allocated once and reused (slide 15) — no per-transition alloc`}
${pit(`WebGL <b>context loss</b> (user switches tabs, GPU driver resets) invalidates shaders and render
textures mid-game. Handle raylib's <code class="inl">IsWindowReady()</code>/<code class="inl">IsShaderValid</code>
paths and fall back to fades — a game that transitions to black forever because the driver hiccupped is
a support ticket factory.`)}
`) ;

S(9, 'Debug & Testing Transitions', `
${lead(`Transitions break in flows, not in isolation. Ship a debug carousel that cycles every effect
across every screen pair — it finds the seams.`)}
${c`
// Debug: T cycles transitions, G cycles target screens
void TransitionDebugHotkeys(Game *g) {
    if (IsKeyPressed(KEY_T)) {                    // next effect
        g->dbgTrKind = (g->dbgTrKind + 1) % TR_COUNT;
        TraceLog(LOG_INFO, "[TR] effect #%d", g->dbgTrKind);
    }
    if (IsKeyPressed(KEY_G)) {                    // next screen pair
        g->dbgTrTarget = (g->dbgTrTarget + 1) % SCREEN_KINDS;
    }
    if (IsKeyPressed(KEY_H)) {                    // fire it!
        GoToDebug(&g->screens, g->dbgTrKind, g->dbgTrTarget);
    }
}`}

${tbl(['QA line', 'Catches'], [
  ['Cycle every effect × every screen pair', 'Wrong draw-order peek-throughs'],
  ['Mash keys during OUT and IN', 'Input bleed (slide 4 gating)'],
  ['Resize window mid-pixelate', 'Stale resolution uniform'],
  ['Transition during Ch 6 game-over', 'Double-swap / lost input focus'],
  ['Trigger two transitions back-to-back', 'Double-start guard'],
  ['Web: context-loss test (tab switch spam)', 'Shader fallback path']
])}
${bp(`The back-to-back trigger test matters most at <b>ship</b>: players find a coin, hit goal, and mash
menu within 0.3 seconds — exactly the interleaving QA never does deliberately. The
<code class="inl">TR_NONE</code> guard plus input gating makes it boring. Boring is the goal.`)}
`) ;

S(9, 'Chapter 9 Summary — Key Takeaways', `
${lead(`Every seam in Canyon Hopper is now choreographed — and the seams conceal the load.`)}
<ul class="check">
  <li>Three-beat model: <b>OUT → swap(covered) → IN</b>; the covered midpoint hides all expensive work.</li>
  <li>Framework owns timing, easing, swap, input gating, skip; effects only draw.</li>
  <li>Input gated until reveal ≈85%; skip shortens the show, never skips the swap.</li>
  <li>Shape tier (fade/slide/wipe) is free; shader tier = one <code class="inl">progress</code> uniform + fullscreen quad.</li>
  <li>Dissolve (hash + threshold + edge glow) and pixelate (bell curve) are the two master patterns.</li>
  <li>Dual render textures give true scene-morphs; allocate once, Y-flip sources.</li>
  <li>Intent-based requests + style table = re-theme all transitions without touching screens.</li>
  <li>Motion accessibility (full/reduced/minimal) is three lines via the intent dispatcher.</li>
  <li>Beat hooks are the curtains where furniture moves (loads, unloads, crossfades).</li>
</ul>
<h3>Carrying forward</h3>
<p>The game looks complete — it doesn't <b>sound</b> complete. Chapter 10: the audio architecture,
SFX manager, music streaming, and procedural retro sound.</p>
${bp(`Checkpoint: every screen pair transitions; debug carousel (T/G/H) cycles all effects; mashing
through a level-win cannot double-swap; reduced-motion mode demonstrably shortens everything; and the
pixelate swap happens exactly at the bell's peak.`)}
`);
