/* Chapter 7 — Menus and Options */
defChapter(7, {
  tag: 'UI & State',
  title: 'Menus and Options',
  sub: 'Screen management, scene graphs, theming, layered menu design, and settings that survive restarts.',
  color: '#a78bfa',
  topics: ['Game states & the Screen interface', 'The ScreenManager (stack machine)', 'Scene graphs & layout engines',
    'Skins, 9-patch & theming', 'Menus: backgrounds, branding, controls', 'Persistent settings & save states']
});

SEC(7);

S(7, 'Game States — The Flow Graph', `
${lead(`Before any menu art: enumerate every <b>screen</b> and legal transition. This diagram is the
contract the whole chapter implements.`)}
${diag(
`        ┌──────┐   any screen: ESC/P pauses
        ▼      │
  [SPLASH]──▶[MENU]──▶[SETTINGS]      (push/pop overlay)
              │  ▲        │
   transition │  │        └─▶[MENU]  (pop)
    (Ch 9!)   ▼  │ retry / win / lose
           [GAME]──────▶[GAMEOVER]──┐
              │        [WIN]        │
              ▼                     ▼
          [PAUSE] overlay      back to [MENU] / next level → [GAME]

  INVARIANTS
   · exactly one "root" screen active at a time
   · overlays (PAUSE, SETTINGS) STACK on top, own input focus
   · GAME owns exactly one World; MENU owns zero`, 'Screens are states; overlays are stack frames')}
${tbl(['Screen', 'Owns', 'Updates'], [
  ['SPLASH', 'Logo timer', 'Nothing (time only)'],
  ['MENU', 'Scene graph, selection state', 'Menu anims'],
  ['SETTINGS', 'Settings struct + widgets', 'Widgets'],
  ['GAME', 'The whole Ch 3–6 stack', 'World + HUD + FX'],
  ['PAUSE', 'Dim + buttons', 'Overlay anims only']
])}
${pit(`The state bug to fear: <b>two things think they own input</b> — menu reacts while the paused game
also reacts behind the dim. The screen manager (next slides) makes ownership structural, not
disciplined.`)}
`);

S(7, 'The Screen Interface — vtables in C', `
${lead(`No classes needed: a Screen is a struct of function pointers — a <b>vtable</b>. Different screens
plug different behaviors into one uniform shape the manager can drive.`)}
${c`
// src/ui/Screen.h
typedef struct ScreenManager ScreenManager;

typedef struct Screen {
    const char *name;                    // "MENU", "GAME"… (debug + tools)

    // lifecycle — all optional (NULL = no-op), all receive the manager
    void (*enter)(ScreenManager *sm);          // becoming active: load
    void (*exit) (ScreenManager *sm);          // leaving: unload
    void (*pause)(ScreenManager *sm);          // covered by overlay
    void (*resume)(ScreenManager *sm);         // overlay popped off us

    // per frame — only TOP of stack gets these
    void (*update)(ScreenManager *sm, float dt);
    void (*draw)  (ScreenManager *sm);
} Screen;

// Concrete screens are just… structs of functions:
extern Screen ScreenSplash, ScreenMenu, ScreenGame,
             ScreenSettings, ScreenPause, ScreenGameOver;
// e.g. ScreenGame.update = GameUpdate — Ch 3's functions slot in directly`}
${tbl(['vtable slot', 'Analogy (OOP)', 'Canyon Hopper'], [
  ['<code class="inl">enter/exit</code>', 'constructor/destructor', 'Load menu art / free level'],
  ['<code class="inl">pause/resume</code>', 'onPause/onResume', 'GAME under PAUSE: mute music, stop sim'],
  ['<code class="inl">update/draw</code>', 'virtual methods', 'Exactly like every chapter so far']
])}
${note(`This is precisely how libGDX's <code class="inl">Screen</code> interface (or XNA's
<code class="inl">GameState</code>) maps to C — the pattern is 30 years old and survives because it is
exactly right.`)}
`);

S(7, 'The ScreenManager — A Stack Machine', `
${lead(`One engine loop drives whichever screen is on <b>top</b>. Push/pop gives overlays; replace gives
transitions; the stack makes input & focus ownership automatic.`)}
${c`
// src/ui/ScreenManager.h
struct ScreenManager {
    Screen *stack[8];            // stack[0]=root … top = active
    int     top;
    Game   *game;                // shared context (Ch 3)
    // Ch 9 adds: Transition *pendingTransition
};

void ScreensPush(ScreenManager *sm, Screen *s) {      // overlay on top
    if (sm->top >= 7) return;
    if (ScreensTop(sm) && ScreensTop(sm)->pause)
        ScreensTop(sm)->pause(sm);                    // cover current
    sm->stack[++sm->top] = s;
    if (s->enter) s->enter(sm);
}

void ScreensPop(ScreenManager *sm) {                  // remove overlay
    if (sm->top <= 0) return;                         // root stays
    Screen *s = sm->stack[sm->top--];
    if (s->exit) s->exit(sm);
    Screen *under = ScreensTop(sm);
    if (under && under->resume) under->resume(sm);
}

void ScreensSet(ScreenManager *sm, Screen *s) {       // REPLACE root
    while (sm->top > 0) ScreensPop(sm);               // drop overlays
    Screen *old = sm->stack[sm->top];
    if (old->exit) old->exit(sm);
    sm->stack[sm->top] = s;
    if (s->enter) s->enter(sm);
}

// The WHOLE integration with Ch 3's loop — three lines:
void ScreensUpdate(ScreenManager *sm, float dt) {
    Screen *s = ScreensTop(sm);
    if (s->update) s->update(sm, dt);
}
void ScreensDraw(ScreenManager *sm) {
    for (int i = 0; i <= sm->top; i++)          // draw bottom-up:
        if (sm->stack[i]->draw)                 // GAME under dimmed PAUSE
            sm->stack[i]->draw(sm);
}}`}
${bp(`Drawing the full stack is what makes overlays beautiful: the paused game renders <b>behind</b> the
pause menu for free. Update only the top = input ownership by construction.`)}
${pit(`Never <code class="inl">Push</code> from inside <code class="inl">update</code> of the screen being
covered while also popping in the same frame — sequence it via the manager's event queue (Ch 6 pattern)
or a one-frame deferred action, or you mutate the stack mid-iteration.`)}
`);

S(7, 'Screen Implementations — Game & Pause', `
${lead(`Watch the whole architecture click: GAME is everything Chapters 3–6 built, wrapped in four
functions; PAUSE is 40 lines.`)}
${c`
// src/ui/ScreenGame.c
static void Enter(ScreenManager *sm) {
    Game *g = sm->game;
    if (!g->worldLoaded) {                    // (re)load level
        LevelLoad(&g->world, &g->assets, LevelPath(g->nextLevel));
        g->worldLoaded = true;
    }
    ResumeMusicStream(g->sound.mus);          // Ch 10 bridge
}
static void Pause(ScreenManager *sm) {        // PAUSE overlay pushed on us
    PauseMusicStream(sm->game->sound.mus);
    // World sim stops because OUR update stops running — free!
}
static void Update(ScreenManager *sm, float dt) {
    Game *g = sm->game;
    if (ActionPressed(ACT_PAUSE)) {
        ScreensPush(sm, &ScreenPause);        // overlay
        return;
    }
    GameUpdate(g, dt);                        // Ch 3 coordinator
    if (g->world.gameOver) ScreensSet(sm, &ScreenGameOver);
}
static void Draw(ScreenManager *sm) {
    GameDraw(sm->game, 1.0f);                 // world + HUD (Ch 5)
}
Screen ScreenGame = { "GAME", Enter, NULL, Pause, NULL, Update, Draw };`}
${c`
// src/ui/ScreenPause.c — the entire pause menu
static void Update(ScreenManager *sm, float dt) {
    if (ActionPressed(ACT_PAUSE)) { ScreensPop(sm); return; }
    switch (MenuNavigateVertical(3, &sel)) {  // next slides: scene graph UI
    case 0: ScreensPop(sm);                    break;   // resume
    case 1: ScreensPush(sm, &ScreenSettings);  break;   // options overlay
    case 2: ScreensSet(sm, &ScreenMenu);       break;   // quit to menu
    }
}
static void Draw(ScreenManager *sm) {
    sm->game; // world already drew beneath us (stack draw!)
    DrawRectangle(0,0,GetScreenWidth(),GetScreenHeight(),
                  Fade(BLACK, 0.6f));          // the dim
    DrawTextCentered("PAUSED", 200, 64, GOLD);
    DrawMenuItems((char*[]){"RESUME","OPTIONS","QUIT"}, 3, sel);
}`}
${bp(`Notice PAUSE never touches <code class="inl">Game.paused</code> or music state manually beyond the
pause hook — <b>structure replaced discipline</b>. When a screen can't run, its systems can't misbehave.`)}
`);

S(7, 'UI Approaches — Immediate vs Retained', `
${lead(`Two religions. Our HUD (Ch 5) was already immediate-style. Menus want <b>retained structure</b> —
and this course builds a small scene graph so you understand what raygui/Unity/UI toolkits do inside.`)}
${tbl(['Aspect', 'Immediate mode (raygui)', 'Retained mode (scene graph)'], [
  ['Where widgets live', 'Nowhere — re-declared every frame', 'In a tree that persists'],
  ['State sync', 'Impossible to desync (reads game state directly)', 'Must bind/refresh widgets ↔ data'],
  ['Animation', 'Manual (store your own timers)', 'Natural — nodes animate (Ch 12 loves this)'],
  ['Layout', 'Hand-placed rects', 'Containers, anchors, auto-layout'],
  ['Input routing', 'Whoever calls first', 'Graph hit-testing, focus chains'],
  ['Best for', 'Tools, debug panels, tiny games', 'Shipped menus, HUDs, complex UI']
])}
${c`
// Immediate (you know this from Ch 5):
if (GuiButton(rect, "PLAY")) StartGame();     // exists for ONE frame

// Retained: build ONCE at screen enter…
MenuNode *root = MenuBuilder()
    .Title("CANYON HOPPER")
    .Button("PLAY",     CB(GoGame))
    .Button("SETTINGS", CB(GoSettings))
    .Button("QUIT",     CB(QuitGame))
    .Build();
// …then per frame: SceneUpdate(root, dt); SceneDraw(root);   (both next)`}
${bp(`Hybrid is the pragmatic pro answer: retained graph for menus/screens, immediate for debug tools.
The rest of this chapter builds the retained side; you already have the other.`)}
`);

S(7, 'Scene Graph — Design', `
${lead(`A scene graph is a tree of <b>nodes</b>: each has a transform, size, and behavior; children
inherit parent transforms. Menus, HUDs, and even 2D worlds can hang off one — we scope it to UI.`)}
${diag(
`  SceneRoot (design 1280x720)
   ├── ImageNode   "bg_canyon"          (fills, parallax-drifts)
   ├── ColumnNode  "menu" (centered)
   │    ├── TextNode  "CANYON HOPPER"   (title, bob anim)
   │    ├── ButtonNode "PLAY"           ┐ focusable
   │    ├── ButtonNode "SETTINGS"       │ keyboard/gamepad moves
   │    └── ButtonNode "QUIT"           ┘ between siblings
   ├── PanelNode    "version tag" (anchored BR)
   └── ParticleNode "ember dust" (ambient, Ch 8!)

  EVERY node: transform(rect) + alpha + visible + children[]
  Some nodes: input handlers, draw callbacks, animations`, 'One tree, drawn parent→child; focus moves through ButtonNodes')}
${c`
// src/ui/Scene.h — the node, deliberately minimal
typedef struct SceneNode SceneNode;

typedef void (*NodeDrawFn  )(SceneNode *n);
typedef bool (*NodeInputFn )(SceneNode *n);   // returns true = consumed

struct SceneNode {
    const char  *name;
    SceneNode   *children[12]; int childCount;
    SceneNode   *parent;

    Rectangle   local;          // rect relative to parent
    Vector2     pos;            // animated offset (Ch 12 tweens)
    float       alpha;          // inherited down the tree
    float       scale;
    bool        visible, focusable, focused;

    NodeDrawFn   draw;          // NULL = pure container (layout only)
    NodeInputFn  input;
    void        *userData;      // widget-specific state
};`}
${note(`<b>Transform inheritance</b> is the killer feature: the whole menu slides off-screen by animating
ONE node's pos — children ride along. That one rule builds every menu animation in Chapter 12.`)}
`);

S(7, 'Scene Graph — Implementation', `
${lead(`Four functions run the entire tree: add, update (transform+alpha propagation), draw, and
hit-test. ~120 lines in the real codebase; the essentials fit one slide.`)}
${c`
// src/ui/Scene.c
SceneNode *SceneAdd(SceneNode *parent, SceneNode child) {
    SceneNode *n = pool_alloc();          // freelist pool: no malloc/frame
    *n = child; n->parent = parent; n->alpha = 1; n->scale = 1;
    if (parent) parent->children[parent->childCount++] = n;
    return n;
}

// 1) UPDATE: propagate world rect + alpha down the tree
void SceneUpdate(SceneNode *n, Rectangle parentRect, float parentAlpha) {
    if (!n->visible) return;
    // resolve local rect against parent (anchor semantics simplified)
    n->world = (Rectangle){
        parentRect.x + n->local.x + n->pos.x,
        parentRect.y + n->local.y + n->pos.y,
        n->local.width * n->scale, n->local.height * n->scale };
    n->worldAlpha = parentAlpha * n->alpha;
    for (int i = 0; i < n->childCount; i++)
        SceneUpdate(n->children[i], n->world, n->worldAlpha);
}

// 2) DRAW: pre-order walk; each node type draws itself
void SceneDraw(const SceneNode *n) {
    if (!n->visible) return;
    if (n->draw) n->draw((SceneNode *)n);       // uses n->world/worldAlpha
    for (int i = 0; i < n->childCount; i++)
        SceneDraw(n->children[i]);
}

// 3) INPUT: top-down; first consumer wins (panel blocks what's under)
bool SceneInput(SceneNode *n) {
    if (!n->visible) return false;
    if (n->input && n->input((SceneNode *)n)) return true;
    for (int i = 0; i < n->childCount; i++)
        if (SceneInput(n->children[i])) return true;
    return false;
}

// 4) FOCUS: find focusables in order — keyboard/gamepad navigation
void SceneCollectFocus(SceneNode *n, SceneNode **list, int *count) {
    if (n->focusable) list[(*count)++] = (SceneNode *)n;
    for (int i = 0; i < n->childCount; i++)
        SceneCollectFocus(n->children[i], list, count);
}`}
${pit(`Node capacity per parent (12 here) is a <b>pool discipline</b>, not a limit of the pattern — but
remember: update/draw walk EVERY visible node EVERY frame. Keep shipped menus under ~60 nodes; they are
not a dumping ground for the whole game.`)}
`);

S(7, 'Widgets — Buttons, Labels, Sliders', `
${lead(`Widget types are just nodes with draw/input callbacks plus a little userData. Three types carry
an entire game's UI.`)}
${c`
// src/ui/Widgets.c — ButtonNode
typedef struct { const char *label; void (*cb)(void *ctx); float hoverT; } BtnData;

static bool BtnInput(SceneNode *n) {              // returns true if consumed
    BtnData *b = n->userData;
    if (!n->focused) return false;                // focus-based (keyboard)
    if (ActionPressed(ACT_JUMP) || IsMouseButtonPressed(MOUSE_BUTTON_LEFT)
                                  && CheckCollisionPointRec(GetMousePosition(), n->world)) {
        SoundPlay(assets, "sfx_ui_click");
        if (b->cb) b->cb(menuCtx);                // wired at build (prev slide)
        return true;
    }
    return false;
}
static void BtnDraw(SceneNode *n) {
    BtnData *b = n->userData;
    b->hoverT = Approach(b->hoverT, n->focused ? 1.0f : 0.0f, dt*10); // Ch 8!
    // 9-patch plate (next slide) tinted by hover + focus glow
    Draw9Patch(assets, "ui_btn", n->world, n->worldAlpha,
               LerpColor(NORMAL, HOVER, b->hoverT));
    Vector2 ts = MeasureTextEx(font, b->label, 26, 2);
    DrawTextEx(font, b->label,
        (Vector2){ n->world.x + (n->world.width - ts.x)/2,
                   n->world.y + (n->world.height - ts.y)/2 },
        26, 2, Fade(BLACK, n->worldAlpha));
}

// Slider (settings live here): drag on the track, userData = {min,max,*value}
static bool SliderInput(SceneNode *n) {
    SliderData *s = n->userData;
    if (!n->focused) return false;
    float dir = 0; // left/right or drag position
    if (ActionDown(ACT_LEFT))  dir = -1;
    if (ActionDown(ACT_RIGHT)) dir = +1;
    if (dir) { *s->value += dir * s->step; *s->value = ClampF(*s->value, s->lo, s->hi); return true; }
    return false;
}`}
${tbl(['Widget', 'Input contract', 'State it owns'], [
  ['Button', 'activate on focus + jump/click', '<code class="inl">hoverT</code> anim'],
  ['Slider', 'left/right steps, mouse drag', 'min/max + bound <code class="inl">float*</code>'],
  ['Checkbox', 'toggle on activate', 'bound <code class="inl">bool*</code>'],
  ['Label', 'none', 'text (immutable)'],
  ['Panel', 'blocks input under it', 'dim amount']
])}
${bp(`Widgets bind to <b>pointers into Settings</b> (next slides): flip a checkbox → the value changes →
the audio system reads it next frame. No &ldquo;apply&rdquo; button, no sync bugs, instant feedback.`)}
`);

S(7, 'Skins & 9-Patch — UI That Scales', `
${lead(`A <b>9-patch</b> slices a small texture into corners/edges/center so it stretches to ANY size
without distortion. It is how every polished UI panel is built — and it is 20 lines in raylib.`)}
${diag(
`   source 64x64 button art        stretched to 260x90
  ┌─┬───────────┬─┐             ┌─┬───────────────┬─┐
  │A│  B (top)  │C│             │A│ B stretched    │C│  A,C corners:
  ├─┼───────────┼─┤   ──▶       ├─┼───────────────┼─┤  NEVER scaled
  │D│ E (center)│F│             │D│ E tiled/alpha │F│  B,F edges: 1-axis
  ├─┼───────────┼─┤             ├─┼───────────────┼─┤  E center: 2-axis
  │G│  H (bot)  │I│             │G│ H stretched   │I│
  └─┴───────────┴─┘             └─┴───────────────┴─┘`, '9 slices: corners pinned, edges stretched, center tiled')}
${c`
// src/ui/NinePatch.c
void Draw9Patch(AssetManager *a, const char *spr, Rectangle dst,
                float alpha, Color tint) {
    Rectangle s = AssetsRegion(a, spr);       // e.g. 64x64 source
    float cx = 20, cy = 20;                   // corner sizes (design!)
    Color t = Fade(tint, alpha);

    // corners — drawn at native size
    DrawTextureRec(a->atlas, (Rectangle){s.x,      s.y,      cx, cy},
                   (Vector2){dst.x, dst.y}, t);                          // A
    DrawTextureRec(a->atlas, (Rectangle){s.x+s.width-cx, s.y, cx, cy},
                   (Vector2){dst.x+dst.width-cx, dst.y}, t);             // C
    // ... G, I similarly
    // edges — stretched along ONE axis
    DrawTexturePro(a->atlas, (Rectangle){s.x+cx, s.y, s.width-2*cx, cy},
                   (Rectangle){dst.x+cx, dst.y, dst.width-2*cx, cy},
                   (Vector2){0,0}, 0, t);                                // B
    // ... D, F, H similarly
    // center — stretched both axes (with subtle alpha for glass panels)
    DrawTexturePro(a->atlas, (Rectangle){s.x+cx, s.y+cy, s.width-2*cx, s.height-2*cy},
                   (Rectangle){dst.x+cx, dst.y+cy, dst.width-2*cx, dst.height-2*cy},
                   (Vector2){0,0}, 0, Fade(tint, alpha * 0.6f));
}`}
${bp(`A <b>skin</b> = one atlas page of 9-patches + a colors/typography table. Reskinning the entire
game becomes swapping one page and one struct — exactly the theming system raygui exposes via
<code class="inl">GuiLoadStyle("theme_cyber.rgs")</code>.`)}
`);

S(7, 'raygui Deep Dive — The Immediate Contender', `
${lead(`For teams that skip a custom UI: raygui is genuinely shippable. Know its controls, its styling,
and where it stops being fun.`)}
${c`
#include "raygui.h"

void DrawSettingsPanelImmediate(Game *g) {
    Rectangle p = { 340, 140, 600, 440 };
    DrawRectangleRec((Rectangle){p.x-10,p.y-10,p.width+20,p.height+20},
                     Fade(BLACK, 0.75f));          // modal dim
    GuiPanel(p, "#100#Settings");                  // 9-patch panel w/ icon

    g->settings.musicVol = GuiSlider(
        (Rectangle){p.x+180, p.y+70, 340, 24}, "Music",
        TextFormat("%.0f%%", g->settings.musicVol*100),
        g->settings.musicVol, 0, 1);

    g->settings.fullscreen = GuiCheckBox(
        (Rectangle){p.x+180, p.y+120, 24, 24}, "Fullscreen",
        g->settings.fullscreen);

    int mode = GuiToggleGroup((Rectangle){p.x+180, p.y+170, 100, 28},
        "Small;Normal;Large", g->settings.uiScale == 1 ? 1 : 2);

    if (GuiButton((Rectangle){p.x+180, p.y+360, 160, 36}, "Back"))
        ScreensPop(sm);
    // raygui handles hover/press state INTERNALLY from mouse position
}`}
${tbl(['raygui strengths', 'Where you outgrow it'], [
  ['Zero retained state, tiny code', 'Complex focus/navigation for gamepads'],
  ['Built-in 9-patch styles, <code class="inl">GuiLoadStyle</code> theming', 'Custom animated widgets (Ch 12 wants nodes)'],
  ['Layout editor exists (rGuiLayout)', 'Deeply art-directed UIs'],
  ['Locked/dropdown/scrollbar/color-picker included', 'Controller-first console UI (TRC/ XR requirements)']
])}
${pit(`raygui reads the <b>mouse</b> by design — gamepad-only consoles need wrappers around
<code class="inl">GuiSetMousePosition</code> (drive a fake cursor from the stick). It works, but it is the
moment teams usually write the retained graph we just built.`)}
`);

S(7, 'Menu Screen — Composition & Backgrounds', `
${lead(`Now the art of it: a main menu is <b>background → decorations → brand → controls → footer</b>,
each a scene-graph layer with its own motion. We build it bottom-up.`)}
${c`
// src/ui/ScreenMenu.c — build once at enter
static void Enter(ScreenManager *sm) {
    Game *g = sm->game;
    SceneNode *root = SceneAdd(NULL, (SceneNode){ .name="menu" });

    // 1) BACKGROUND: the game world idles behind (attract mode!)
    //    → no image node: Draw() renders World with a slow auto-pan
    //    camera. Cheapest, prettiest menu bg there is.

    // 2) DECOR: drifting clouds + ember particles (Ch 8's systems!)
    SceneAdd(root, (SceneNode){ .name="embers",
        .draw = DrawMenuEmbers });                    // particle node

    // 3) BRAND: title + subtitle, animated by Ch 12 tweens
    SceneAdd(root, (SceneNode){ .name="title",
        .local = {0, 120, 1280, 90},
        .draw  = DrawMenuTitle });                    // bob + shine sweep

    // 4) CONTROLS: the focusable column (built via Widgets)
    g->menuRoot = root;
    BuildMenuButtons(root, g);     // PLAY/SETTINGS/QUIT + versions
}
static void Update(ScreenManager *sm, float dt) {
    MenuCameraDrift(sm->game, dt);        // slow pan of the world behind
    SceneUpdateTree(sm->game->menuRoot, dt);
    NavigateFocus(sm->game, dt);          // up/down + activate (slide 13)
}
static void Draw(ScreenManager *sm) {
    Game *g = sm->game;
    DrawWorldAttractMode(g);              // dim world, cinematic camera
    SceneDrawTree(g->menuRoot);           // menu on top
}`}
${bp(`The <b>attract-mode background</b> (live world, no HUD, slow camera drift) is a professional
signature move: it reuses your renderer, costs nothing extra, and makes the menu feel part of the game
rather than a web page in front of it.`)}
`);

S(7, 'Branding & Focus Navigation', `
${lead(`Two details separate &ldquo;functional&rdquo; from &ldquo;shipped&rdquo;: the title treatment and how
keyboard/gamepad users move through buttons.`)}
${c`
// Focus navigation: focusables collected in tree order (slide 10)
void NavigateFocus(Game *g, float dt) {
    SceneNode *list[32]; int n = 0;
    SceneCollectFocus(g->menuRoot, list, &n);
    if (n == 0) return;

    if (ActionPressed(ACT_DOWN) || GetGamepadAxisPressed(AXIS_LY) > 0)
        g->focusIdx = (g->focusIdx + 1) % n;
    if (ActionPressed(ACT_UP)   || GetGamepadAxisPressed(AXIS_LY) < 0)
        g->focusIdx = (g->focusIdx - 1 + n) % n;

    for (int i = 0; i < n; i++) list[i]->focused = (i == g->focusIdx);
    if (ActionPressed(ACT_JUMP)) list[g->focusIdx]->input(list[g->focusIdx]);

    // mouse moves focus too (hybrid input): hover = focus
    Vector2 m = GetMousePosition();
    for (int i = 0; i < n; i++)
        if (CheckCollisionPointRec(m, list[i]->world)) g->focusIdx = i;
}

// Title treatment: layered text — shadow, fill, shine sweep
static void DrawMenuTitle(SceneNode *n) {
    const char *t = "CANYON HOPPER";
    float bob = sinf(GetTime() * 1.6f) * 5.0f;        // gentle float
    Vector2 c = { n->world.x + n->world.width/2, n->world.y + bob };
    // shadow → outline → fill: 3 draws, reads at any size
    DrawTextCenteredShadow(fontBig, t, c, 72, 3, (Color){20,16,8,255});
    DrawTextCenteredEx(fontBig, t, c, 72, 2, (Color){90,60,20,255});
    DrawTextCenteredEx(fontBig, t, c, 72, 2, GOLD);
    // shine: moving additive gradient clipped to text bounds (Ch 12 tweens it)
}`}
${tbl(['Platform reality', 'Requirement'], [
  ['Consoles (cert)', 'Full navigation without mouse — focus chains mandatory'],
  ['PC', 'Hybrid: mouse hover sets focus, keys move it'],
  ['Web', 'Same hybrid; also Tab-order for accessibility (focus ring!)']
])}
${pit(`Rotate-and-wrap focus (<code class="inl">%</code> modulo) but <b>never</b> let focus land on an
invisible/disabled node — collect focusables fresh each time visibility changes, and show the focus ring
on EVERY focusable (accessibility minimum).`)}
`);

S(7, 'The Settings Screen — Wiring It Up', `
${lead(`Settings bind widgets to the live <code class="inl">Settings</code> struct; systems read the struct
each frame. Build the panel as a pushed overlay screen over anything.`)}
${c`
// src/ui/ScreenSettings.c
typedef struct Settings {
    float musicVol, sfxVol;        // 0..1 — SoundManager reads (Ch 10)
    bool  fullscreen;
    float uiScale;                 // 1.0 / 1.25 (Ch 5 HUD)
    bool  showFps;
    bool  reducedFx;               // Ch 8/9 honor it (accessibility)
    int   keyBind[ACT_COUNT];      // rebindable! (Ch 2 InputMap)
} Settings;

static void Enter(ScreenManager *sm) {
    Settings *s = &sm->game->settings;    // binds live — no Apply button
    SceneAdd(root, SliderW ("Music",      &s->musicVol, 0, 1, .05f));
    SceneAdd(root, SliderW ("Sound FX",   &s->sfxVol,   0, 1, .05f));
    SceneAdd(root, CheckW ("Fullscreen",  &s->fullscreen));
    SceneAdd(root, CheckW ("Show FPS",    &s->showFps));
    SceneAdd(root, CycleW ("UI Size", (int*)&s->uiScale,
                           (int[]){100, 125}, 2));
    SceneAdd(root, CheckW ("Reduce effects", &s->reducedFx));
}

// systems consume settings continuously — three examples already shipped:
SetMusicVolume(mus, g->settings.musicVol);   // Ch 10 manager does this
g->hud.uiScale = g->settings.uiScale;        // Ch 5 responsive HUD
fx.maxParticles = s->reducedFx ? 128 : 512;  // Ch 8 budget`}
${tbl(['Setting', 'Type', 'Applied by'], [
  ['Volumes', 'slider 0–1', 'SoundManager every frame'],
  ['Fullscreen', 'toggle', '<code class="inl">ToggleFullscreen()</code> on change event'],
  ['UI size', 'cycle', 'HUD <code class="inl">uiScale</code>'],
  ['Reduce effects', 'toggle', 'particle budget + transition style (Ch 9)'],
  ['Key binds', 'capture', 'Ch 2 <code class="inl">InputMap</code> table']
])}
${bp(`Change-vs-apply UX: apply <b>immediately</b> for reversible settings (volume), require
restart/prompt only when unavoidable (resolution on some platforms). A settings screen that previews
live builds trust; one hiding behind Apply buttons feels like a form.`)}
`);

S(7, 'Persisting Settings — Serialization', `
${lead(`Settings survive restarts via one binary struct written to the Ch 2 save path — plus a version
guard so tomorrow's fields don't corrupt today's files.`)}
${c`
// src/core/Settings.c
#define SETTINGS_VERSION 3

typedef struct SettingsFile {        // on-disk layout: versioned POD
    int   version;                   // FIRST field, always
    float musicVol, sfxVol;
    int   fullscreen, showFps, reducedFx;
    float uiScale;
} SettingsFile;                      // no pointers — memcpy-able!

void SettingsSave(const Settings *s) {
    SettingsFile f = { SETTINGS_VERSION, s->musicVol, s->sfxVol,
                       s->fullscreen, s->showFps, s->reducedFx, s->uiScale };
    char path[512];
    snprintf(path, sizeof path, "%s/settings.bin",
             PlatformSavePath("CanyonHopper").dir);
    SaveFileData(path, &f, sizeof f);          // Ch 2 atomic wrapper in prod
}

bool SettingsLoad(Settings *s) {
    char path[512];
    snprintf(path, sizeof path, "%s/settings.bin",
             PlatformSavePath("CanyonHopper").dir);
    SettingsFile f;
    int bytes;
    if (!LoadFileData(path, (void *)&f, &bytes) || bytes < sizeof(int))
        return false;                          // missing/corrupt → defaults

    if (f.version != SETTINGS_VERSION) {
        TraceLog(LOG_WARNING, "[SET] v%d → v%d: migrating", f.version,
                 SETTINGS_VERSION);
        SettingsMigrate(&f);                    // field-wise, default new ones
    }
    s->musicVol = f.musicVol;  s->sfxVol = f.sfxVol;      // copy known fields
    s->fullscreen = f.fullscreen;  s->uiScale = f.uiScale;
    return true;
}`}
${tbl(['Format choice', 'Verdict'], [
  ['Binary POD struct (above)', '<b>Course choice</b> — instant, version-guarded, private'],
  ['JSON (cJSON)', 'When users hand-edit configs — desktop modding culture'],
  ['raylib storage value slots', 'Fine for ≤10 ints; unreadable at 30 fields']
])}
${pit(`The struct-on-disk must contain <b>only fixed-size types</b> — no pointers, no
<code class="inl">Vector2</code> surprises (it IS POD, fine) but never a <code class="inl">char*</code>.
A pointer written to disk is a leak of a memory address that means nothing on next run.`)}
`);

S(7, 'Save States — Progress Slots', `
${lead(`Settings are global; <b>progress</b> is per-playthrough: furthest level, score, collectibles.
Same machinery, different file — plus slot UI.`)}
${c`
// src/core/Progress.c
typedef struct ProgressFile {
    int  version;
    int  unlockedLevel;              // highest reachable
    int  lastLevel;                  // where Continue resumes
    long bestScore;
    int  coinsCollected[8];          // per-level collectible counts
    long playTimeSeconds;
} ProgressFile;

void ProgressOnLevelWin(const Event *e, World *w) {   // Ch 6 bus!
    g->progress.unlockedLevel = Imax(g->progress.unlockedLevel,
                                     w->levelIndex + 1);
    g->progress.lastLevel     = w->levelIndex + 1;
    g->progress.bestScore     = Imax(g->progress.bestScore, w->score);
    g->progress.coinsCollected[w->levelIndex] = w->coinsThisLevel;
    ProgressSave(&g->progress);      // save on EVENT, not on exit (Ch 2)
}

// "CONTINUE" on the main menu = lastLevel > 0 — one bool changes the menu
static void Enter(ScreenManager *sm) {
    if (sm->game->progress.lastLevel > 0)
        InsertMenuButton(root, 0, "CONTINUE", CB(GoContinue));
    // …PLAY starts fresh, CONTINUE resumes — menu builds from STATE`}
${tbl(['Anti-pattern', 'Fix'], [
  ['Save only on quit', 'Save on events: win, checkpoint, settings change'],
  ['One global slot', 'Slots (1–3) are cheap: files <code class="inl">slot_1.bin</code>…'],
  ['Trust the file', 'Checksum/CRC the payload; corrupt → defaults + warn'],
  ['Write mid-frame', 'Write on the loading screen or between ticks — disk I/O hitches frames']
])}
${bp(`Write saves <b>atomically</b>: save to <code class="inl">slot_1.tmp</code>, then rename over
<code class="inl">slot_1.bin</code>. A crash mid-write then loses nothing — rename is atomic on every OS we
ship to (Ch 2's platform layer exposes it).`)}
`);

S(7, 'Splash & First-Run Flow', `
${lead(`The opening seconds are a screen like any other: SPLASH → (first run? tutorial hint) → MENU.
Compose it with what the chapter already built.`)}
${c`
// src/ui/ScreenSplash.c — logo in, hold, out; skippable ALWAYS
static void Update(ScreenManager *sm, float dt) {
    Game *g = sm->game; g->splashT += dt;

    // ANY input skips — respect the player's time, always
    if (AnyKeyPressed() || IsMouseButtonPressed(MOUSE_BUTTON_LEFT))
        g->splashT = FADE_OUT_AT;

    if (g->splashT > TOTAL)
        ScreensSet(sm, &ScreenMenu);           // Ch 9 wraps this in a fade!
}
static void Draw(ScreenManager *sm) {
    Game *g = sm->game;
    float t = g->splashT;
    float a = t < 0.5f ? t/0.5f                       // fade in
            : t > FADE_OUT_AT ? 1-(t-FADE_OUT_AT)/0.5f // fade out
            : 1.0f;
    DrawTexturePro(g->assets.logo, …, Fade(WHITE, a));
    DrawText("press any key", …, Fade(GRAY, 0.5f + 0.5f*sinf(t*4))); // hint
}

// First-run: one flag in settings decides an extra hints overlay
if (!g->settings.hasPlayedBefore) {
    ScreensPush(sm, &ScreenFirstRunHints);
    g->settings.hasPlayedBefore = true;  // + save — one-time dialogs are state
}`}
${pit(`Unskippable logos/stories on EVERY run are the most-hated UI pattern in games. Legal splash
requirements (engine/store credits) still allow input-buffered skips: hold-any-key to pre-skip, or skip
after first viewing (persisted flag — you already know how).`)}
`);

S(7, 'Input Flow Across Screens — The Focus Map', `
${lead(`End-to-end test of the stack: one input vocabulary, different meanings per screen — captured as
a table every team should write once.`)}
${tbl(['Action', 'SPLASH', 'MENU', 'SETTINGS', 'GAME', 'PAUSE'], [
  ['<code class="inl">ACT_JUMP</code>', 'skip', 'activate', 'activate', 'jump', 'activate'],
  ['<code class="inl">ACT_UP/DOWN</code>', '—', 'move focus', 'move focus', 'aim/look', 'move focus'],
  ['<code class="inl">ACT_LEFT/RIGHT</code>', '—', '—', 'adjust slider', 'run', 'adjust slider'],
  ['<code class="inl">ACT_PAUSE</code>', '—', '—', '—', 'push PAUSE', 'pop (resume)'],
  ['<code class="inl">Mouse</code>', 'skip', 'hover+click', 'drag sliders', 'gameplay', 'hover+click'],
  ['<code class="inl">Back (ESC/pad B)</code>', '—', 'exit prompt', 'pop', 'pause', 'pop']
])}
${c`
// The manager routes this with ONE rule — top of stack handles input:
void ScreensHandleInput(ScreenManager *sm) {
    SceneNode *list[32]; int n = 0;
    SceneCollectFocus(ScreensTop(sm)->sceneRoot, list, &n);
    NavigateFocus(sm->game, dt);           // shared navigator (slide 13)
    // BACK is universal — the manager itself owns it:
    if (ActionPressed(ACT_BACK) && sm->top > 0) ScreensPop(sm);
}`}
${bp(`Write the table <b>before</b> wiring widgets: mismatches (&ldquo;B backs out here but not there&rdquo;)
are the #1 polish complaint in playtests — and they are table-review bugs, not code bugs.`)}
${note(`Universal BACK owned by the <b>manager</b> (not each screen) is a small architectural decision
players feel: overlays always dismiss the same way, on every screen, forever.`)}
`);

S(7, 'Game UI Aesthetics — Typography & Rhythm', `
${lead(`A menu is typography plus rhythm. Three rules carry 90% of game UI craft — all applicable to our
scene graph tomorrow.`)}
${tbl(['Rule', 'Practice', 'In Canyon Hopper'], [
  ['<b>Hierarchy by size/weight</b>', '3 levels max: display / label / meta', '72 title / 26 buttons / 14 version'],
  ['<b>Rhythm by consistent spacing</b>', 'One grid unit; everything = N units', '8px grid: buttons 48, gaps 16/24'],
  ['<b>One accent color</b>', 'Interactions/highlights only', 'GOLD focus; everything else neutrals']
])}
${c`
// Spacing as code, not vibes — layout helpers build the rhythm in:
SceneNode *col = ColumnAdd(root, (Vector2){540, 300}, 24 /*gap*/);
for (each item) SceneAdd(col, ButtonW(label, cb));  // auto-stacked

// Typography trio loaded once, reused everywhere:
fonts.display = LoadFontEx("font_pixel.ttf",    72, 0, 250);
fonts.label   = LoadFontEx("font_pixel.ttf",    26, 0, 250);
fonts.meta    = LoadFontEx("font_body.ttf",     14, 0, 250);
// same family, 3 roles → coherent without a designer on call`}
${diag(
`  ┌────────────────────────────────┐
  │        CANYON HOPPER     72    │  display
  │                                │
  │         ▸ PLAY          26     │  label + focus accent
  │         ▸ SETTINGS      26     │
  │         ▸ QUIT          26     │
  │                                │
  │  v1.0        © 2026 Us    14   │  meta, corners
  └────────────────────────────────┘
  (8px grid: 24px between buttons, 48 around blocks)`, 'Three sizes, one accent, one grid — that is the whole style guide')}
${pit(`Outline-everything and drop-shadow-everything are the two classic over-corrections. Shadow alone
for readability over busy backgrounds; outlines only on the display font. Pick readability tricks
deliberately, not fearfully.`)}
`);

S(7, 'Menus QA & Accessibility Pass', `
${lead(`Menu bugs hide in flows, not widgets. Run this pass — half the lines are accessibility, and every
one of them is also just better design.`)}
${ul(`
<li>Navigate the ENTIRE menu with keyboard only — then gamepad only — then mouse only. All three reach everything.</li>
<li>Focus ring visible on every focusable, on every input method, at both UI sizes.</li>
<li>Pause during: jump mid-air, hazard overlap, level-win fade → no soft-locks, no double-transition.</li>
<li>Settings persist across hard kill (kill the process, relaunch): volumes, UI scale, binds intact.</li>
<li>Corrupt the settings file by hand (truncate/flip bytes) → defaults load, game runs, one log line.</li>
<li>Save slot full / read-only dir on some platform → game still boots to menu with a toast.</li>
<li>Contrast check: button text vs plate ≥ 4.5:1 (squint test at uiScale 1.0 and 1.25).</li>
<li>Full flow timing: boot → playing in under 10s with skip; under 25s watching everything once.</li>`)}
${tbl(['Accessibility feature', 'Where we built it'], [
  ['Full key/pad navigation', 'Focus map + navigator'],
  ['UI scale', '<code class="inl">uiScale</code> (Ch 5 + settings)'],
  ['Reduced effects', 'settings flag → particle/transition budgets (Ch 8–9 honor it)'],
  ['Skippable everything', 'SPLASH rule: any input skips'],
  ['Readable type', '3-size system, contrast-checked']
])}
${bp(`Play the <b>&ldquo;one hand on the phone&rdquo;</b> test: everything reachable, readable, unhurried.
Features built for accessibility reliably turn out to be features everyone quietly appreciates.`)}
`);

S(7, 'Chapter 7 Summary — Key Takeaways', `
${lead(`The shell around the game is real: state machine, scene graph, theming, persistence.`)}
<ul class="check">
  <li>Screens = states; manager = <b>stack machine</b>; overlays push/pop; update top only, draw the whole stack.</li>
  <li><code class="inl">Screen</code> in C = function-pointer vtable: enter/exit/pause/resume/update/draw.</li>
  <li>GAME screen wrapped Chapters 3–6 with zero rewrites — architecture dividend.</li>
  <li>Scene graph: transform/alpha <b>inheritance</b>, focus collection, input top-down; pools, not mallocs.</li>
  <li>9-patch makes scalable panels; a skin is one page + one table; raygui for tools, graph for shipped UI.</li>
  <li>Menus: attract-mode background, branded title, focus navigation; input table per screen.</li>
  <li>Settings bind live to widgets; version-guarded binary files; atomic writes; save on events.</li>
  <li>Progress = slots with CRC; CONTINUE button is just state read at build time.</li>
</ul>
<h3>Carrying forward</h3>
<p>The structure is complete — time to make it <b>feel</b> expensive. Chapter 8: particles, parallax,
easing, and water physics. Juice week begins.</p>
${bp(`Checkpoint: full loop — boot → splash → menu → play → pause → settings (live-apply) → game over →
menu → CONTINUE — using keyboard only, twice: once fresh install, once with corrupted settings.`)}
`);
