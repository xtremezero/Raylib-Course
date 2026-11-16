/* Chapter 13 — Basic 3D Programming */
defChapter(13, {
  tag: '3D Graphics',
  title: 'Basic 3D Programming',
  sub: 'The 3D pipeline, cameras and materials, model loading, frustum culling, and ray picking — 2D instincts, one more axis.',
  color: '#818cf8',
  topics: ['The 3D graphics pipeline & lighting model', 'Perspective/orthographic cameras', 'Meshes, materials & instanced rendering',
    'Loading FBX / GLTF / OBJ models', 'Frustum culling & optimization', 'Ray casting & 3D picking']
});

SEC(13);

S(13, 'From 2D to 3D — What Actually Changes', `
${lead(`Your architecture survives intact: fixed ticks, assets, events, tweens. What changes is the
<b>rendering model</b> — sprites become meshes, layers become depth, the camera becomes a frustum.`)}
${tbl(['2D (Ch 1–12)', '3D (Ch 13–14)', 'Unchanged'], [
  ['Atlas region per sprite', 'Mesh + material per model', 'Fixed-step loop'],
  ['Draw order = layers', 'Depth buffer + draw distance', 'Event bus, actions'],
  ['Camera2D target/zoom', 'Camera3D position/target/FOV', 'AssetManager pattern'],
  ['AABB collisions', 'Physics world (Ch 14)', 'Screens & state machines'],
  ['Point filtering, pixel art', 'Linear filtering, mipmaps, normals', 'JSON data-driven tuning']
])}
${diag(
`   2D frame                    3D frame
   ─────────                   ─────────────────────────────
   clear                       clear + depth clear
   BeginMode2D                 BeginMode3D (camera frustum)
   atlas quads                 draw meshes (vertex+index buffers)
   EndMode2D                   EndMode3D
   HUD in screen space         HUD in screen space (same!)`, 'The renderer swaps; everything around it holds')}
${bp(`3D is not a different course — it is Chapter 5&rsquo;s renderer lesson (layers, batching, culling) in a
new coordinate space. Trust your 2D instincts; they are the transferable part.`)}
`);

S(13, 'The 3D Pipeline — Vertices to Pixels', `
${lead(`Every triangle you will ever draw takes the same journey. Know the five stations and every 3D
bug becomes diagnosable.`)}
${diag(
`  MODEL space ──world──▶ VIEW space ──projection──▶ CLIP ──▶ SCREEN
  (vertices as            (camera at                  (x,y,z    (2D pixels
   authored)               origin)                      in NDC)    + depth)
     │Model matrix          │View matrix   │Proj matrix
     └──────────── mvp = P · V · M ────────────┘
  then: rasterizer → fragment shader → depth test → framebuffer`, 'The classic transform chain — every 3D API on earth')}
${tbl(['Station', 'Question answered', 'raylib type'], [
  ['Model matrix', 'Where is this object, how rotated/scaled?', '<code class="inl">model.transform</code>'],
  ['View matrix', 'Where is the camera looking from?', '<code class="inl">Camera3D</code> internal'],
  ['Projection', 'FOV + near/far clip', '<code class="inl">Camera3D.fovy</code>, <code class="inl">projection</code>'],
  ['Depth test', 'What is in front?', 'z-buffer (automatic)'],
  ['Rasterize + shade', 'Final pixel color', 'material shader']
])}
${pit(`The near plane exists — geometry between camera and near clip <b>vanishes</b>. The classic bug:
third-person camera clipping through a wall the player hugs. Fix with camera collision (slide 13) or a
smaller near value (0.01 costs depth precision — 0.1 is the sane default).`)}
`);

S(13, 'Hello 3D — The Minimal Scene', `
${lead(`raylib&rsquo;s 3D API is famously small. This program is the Chapter-1 loop of 3D — commit it to
memory before anything fancier.`)}
${c`
#include "raylib.h"

int main(void) {
    InitWindow(1280, 720, "hello 3D");
    SetTargetFPS(60);

    Camera3D cam = {
        .position   = (Vector3){ 8.0f, 6.0f, 8.0f },  // eye
        .target     = (Vector3){ 0.0f, 0.0f, 0.0f },  // look at
        .up         = (Vector3){ 0.0f, 1.0f, 0.0f },  // +Y is UP
        .fovy       = 45.0f,                          // vertical FOV degrees
        .projection = CAMERA_PERSPECTIVE
    };

    while (!WindowShouldClose()) {
        UpdateCamera(&cam, CAMERA_ORBITAL);       // free orbit cam

        BeginDrawing();
            ClearBackground(RAYWHITE);

            BeginMode3D(cam);                     // ── world space ──
                DrawGrid(20, 1.0f);               // ground reference
                DrawCube((Vector3){0,1,0}, 2,2,2, MAROON);
                DrawCubeWires((Vector3){0,1,0}, 2,2,2, BLACK);
            EndMode3D();                          // ─────────────────

            DrawText("Orbit with mouse", 12, 12, 20, DARKGRAY);
            DrawFPS(GetScreenWidth()-90, 12);     // HUD: screen space!
        EndDrawing();
    }
    CloseWindow();
    return 0;
}`}
${tbl(['Camera3D field', 'Meaning', 'Gotcha'], [
  ['<code class="inl">position</code>', 'Eye point in world', 'Keep above ground (or flip &ldquo;up&rdquo;)'],
  ['<code class="inl">target</code>', 'Point looked at', 'position ≠ target (that IS the view dir)'],
  ['<code class="inl">up</code>', 'Usually <code class="inl">{0,1,0}</code>', 'Must not parallel view direction'],
  ['<code class="inl">fovy</code>', 'Vertical FOV', '40–60 normal; 90+ = fisheye; ortho uses zoom'],
  ['<code class="inl">projection</code>', 'PERSPECTIVE / ORTHOGRAPHIC', 'ortho = no depth foreshortening']
])}
${note(`<code class="inl">UpdateCamera</code> modes: ORBITAL (spin around target), FREE (fly),
FIRST_PERSON, THIRD_PERSON, CUSTOM. Prototypes ship with ORBITAL/FREE before you write a real camera
controller.`)}
`);

S(13, 'Perspective vs Orthographic — Choosing', `
${lead(`The single biggest 3D &ldquo;look&rdquo; decision: perspective mimics eyes; orthographic is the
isometric blueprint view. Games live on a spectrum.`)}
${diag(
`  PERSPECTIVE (fovy=45)          ORTHOGRAPHIC
   far objects small              far objects SAME size
   convergence to vanishing pt    parallel lines stay parallel
   immersive, action              readable, tactical
   ─────────────────              ─────────────────────────
   Canyon 3D (action)             puzzle/tabletop view
   FPS/third-person               city builders, chess, dioramas`, 'Foreshortening is the whole difference')}
${c`
// Same scene, two projections — one field:
cam.projection = CAMERA_PERSPECTIVE;  cam.fovy = 45.0f;
// vs:
cam.projection = CAMERA_ORTHOGRAPHIC;
cam.zoom = 1.0f;   // ortho: zoom is a SCALE (fovy is ignored)

// FOV feel cheat-sheet:
//   30–40  telephoto: cinematic,compressed (third-person adventures)
//   45–55  default sweet spot
//   70–90  wide: FPS, speed sensation (more world visible = more work!)`}
${tbl(['If your game is…', 'Pick', 'Why'], [
  ['Platformer (3D)', 'Perspective 45–55', 'Depth sells the jump'],
  ['Puzzle / builder', 'Orthographic', 'Grids read true; no misleading foreshortening'],
  ['Racing / FPS', 'Perspective 70+', 'Speed + situational awareness'],
  ['Tactics (XCOM-ish)', 'Perspective 30 <i>or</i> ortho', 'Angles feel dramatic but readable']
])}
${bp(`Performance note: wide FOV and long draw distance show the GPU <b>more world per frame</b>. A 90°
FOV at 300m draw distance can cost 4× the fill of a 45°/100m scene — same game, 4× the pixels.`)}
`);

S(13, 'Meshes & Models — The Data', `
${lead(`A <b>mesh</b> is raw geometry (positions, normals, UVs, indices); a <b>model</b> is mesh(es) +
materials + transform hierarchy. raylib hands you both as plain structs.`)}
${c`
// The structs (simplified from raylib.h):
typedef struct Mesh {
    int vertexCount, triangleCount;
    float *vertices;      // xyz per vertex   (local/model space)
    float *normals;       // xyz — used by LIGHTING
    float *texcoords;     // uv — samples the diffuse map
    unsigned short *indices;    // triangle winding
    unsigned int vaoId, vboId;  // GPU handles (uploaded on Load)
} Mesh;

typedef struct Material {
    Shader shader;                       // per-material program
    MaterialMap maps[MATERIAL_MAP_COUNT];  // diffuse, normal, metal, rough…
    float params[4];                     // material sliders
} Material;

typedef struct Model {
    Matrix transform;          // LOCAL → WORLD (position/rotation/scale)
    Mesh *meshes;  int meshCount;
    Material *materials;  int materialCount;
    int *meshMaterial;         // which material each mesh uses
    // + bones/animations (LoadModelAnim(s))
} Model;`}
${tbl(['Concept', '2D equivalent', 'Note'], [
  ['<code class="inl">vertices/normals/uv</code>', 'Sprite quad corners', 'Thousands vs 4!'],
  ['<code class="inl">normals</code>', '—', 'Feed lighting; wrong normals = black faces'],
  ['<code class="inl">indices</code>', '—', 'Winding order: counter-clockwise = front face'],
  ['<code class="inl">transform</code>', 'dst rect position', 'Compose: T·R·S order matters'],
  ['<code class="inl">maps[]</code>', 'atlas texture', 'MATERIAL_MAP_ALBEDO is the diffuse']
])}
${note(`Black faces usually mean <b>inverted normals</b> (or an unlit shader). In Blender: Recalculate
Outside before export; at runtime: <code class="inl">mesh.normals</code> all-zero = flat black under any
lighting.`)}
`);

S(13, 'Model Loading — FBX, GLTF, OBJ', `
${lead(`raylib loads what its bundled asset importer supports — and the format you pick decides your
whole art pipeline. GLTF/GLB is the modern default.`)}
${tbl(['Format', 'Strengths', 'Weaknesses', 'Use'], [
  ['<b>GLTF / GLB</b>', 'PBR materials, skeleton anims, nodes scene graph, industry standard', 'Exporter quality varies', '<b>Default choice</b> — Blender native'],
  ['<b>OBJ</b>', 'Dead simple text, universal', 'No anims, one material per file, huge', 'Static props, quick tests'],
  ['<b>FBX</b>', 'Studio standard (Max/Maya)', 'Closed format; importer support varies', 'When the source is FBX']
])}
${c`
Model LoadAndPrep(const char *path) {
    Model m = LoadModel(path);              // GLB/GLTF/OBJ by extension

    // 1) materials: swap in OUR shared shader + textures (atlas law!)
    for (int i = 0; i < m.materialCount; i++) {
        m.materials[i].shader = g_litShader;             // shared program
        SetMaterialTexture(&m.materials[i], MATERIAL_MAP_ALBEDO,
                           AssetsTexture("tex_checker"));
    }
    // 2) bind a per-model uniform slot (e.g. tint):
    m.transform = MatrixIdentity();
    return m;
}

// Ground rule from Ch 4 applies verbatim: the AssetManager owns every
// Model; call sites request by name. Never LoadModel in gameplay.`}
${pit(`FBX export settings hide landmines: <b>Y-up vs Z-up</b> (Blender exports Z-up by default — your
hero lies face-down), baked scale (100× from Max), and tangents missing for normal maps. One Blender
export preset saved as a .py kills all three forever.`)}
`);

S(13, 'Transforms — Position, Rotation, Scale', `
${lead(`The model transform composes translate·rotate·scale. raymath gives you the pieces; the ORDER
of multiplication is the whole lesson.`)}
${c`
// Compose TRS: translate, THEN rotate, THEN scale (scale first in code)
Vector3 pos = { 0, 1, 0 };
Quaternion q = QuaternionFromEuler(0.0f, 45.0f*DEG2RAD, 0.0f);
Vector3 scale = { 1, 1, 1 };

Matrix T = MatrixTranslate(pos.x, pos.y, pos.z);
Matrix R = QuaternionToMatrix(q);
Matrix S = MatrixScale(scale.x, scale.y, scale.z);

model.transform = MatrixMultiply(MatrixMultiply(S, R), T);  // T·R·S
// draw uses model.transform internally:
DrawModel(model, pos, 1.0f, WHITE);   // 2nd arg adds ANOTHER translate!

// Rotation that survives arbitrary axes — quaternions, not Euler:
q = QuaternionMultiply(q, QuaternionFromAxisAngle(
        (Vector3){0,1,0}, 90.0f*DEG2RAD * dt));   // spin on Y each tick`}
${tbl(['Mistake', 'Symptom', 'Fix'], [
  ['Scale after translate in matrix order', 'Position scales too (object flies away)', 'T·R·S composition as above'],
  ['Euler composition for 3+ axes', 'Axis flips at 90° (gimbal lock)', 'Quaternions or MatrixRotateXYZ'],
  ['DrawModel position AND transform', 'Double offset', 'Pick one source of truth for position'],
  ['Degrees into quaternion functions', 'Teleporting rotation', 'DEG2RAD — always']
])}
${bp(`One source of truth per object: store pos/quaternion/scale as plain fields, compose the matrix
<b>once per tick</b> for rendering. Never mutate <code class="inl">model.transform</code> and a separate
pos field simultaneously — drift is guaranteed.`)}
`);

S(13, 'Lighting — The Standard Material Model', `
${lead(`3D lighting is material + light sources. raylib ships a physically-plausible default shader
(<code class="inl">models/resources/shaders/lighting</code>) — wire up to four lights and tune.`)}
${diag(
`  AMBIENT  ── flat base level (skylight bounce)      ┐
  DIRECTIONAL ── sun: direction only, no position     ├── per-pixel
  POINT ── bulb: position + radius falloff             │  in the
  SPOT ── flashlight: position + cone                  ┘  lighting shader

  surface color = albedo × (ambient + Σ light contributions)
                  + specular highlights (metalness/roughness)`, 'The PBR-ish recipe raylib gives you for free')}
${c`
// Create the lit shader + lights (once, in renderer init):
Shader lightShader = LoadShader(
    "assets/shaders/lighting.vs",
    "assets/shaders/lighting.fs");
lightShader.locs[SHADER_LOC_VECTOR_VIEW]
    = GetShaderLocation(lightShader, "lightDir");   // per-frame refresh!

// Light struct from the example — 4 slots max in the standard shader:
Light sun = CreateLight(LIGHT_DIRECTIONAL,
    (Vector3){ -6, 10, -4 }, (Vector3){ 0,0,0 },
    (Vector3){ 1.0f, 0.95f, 0.85f },   // warm white
    lightShader);
UpdateLightValues(lightShader, sun);    // push position/type/color

// Every lit model must use lightShader (slide 6 loop does this)`}
${tbl(['Light', 'Params that matter', 'Canyon 3D use'], [
  ['Directional (sun)', 'direction, color, intensity', 'The one must-have'],
  ['Ambient', 'a color multiplier (uniform)', 'Lift shadows; tint by sky'],
  ['Point', 'position, radius', 'Lava glow, pickup beacons'],
  ['Spot', 'cone angles', 'Flashlight levels']
])}
${pit(`<code class="inl">SHADER_LOC_VECTOR_VIEW</code> must be refreshed with the <b>camera position
every frame</b> for specular to work — the classic &ldquo;highlights are stuck&rdquo; bug. One
<code class="inl">SetShaderValue</code> in the render loop, per lit shader.`)}
`);

S(13, 'Materials & Textures — Albedo, Normal, Emissive', `
${lead(`The material map slots are your art direction surface. Four of them cover stylized games
completely.`)}
${tbl(['Map', 'Feeds', 'When to author it'], [
  ['ALBEDO (diffuse)', 'base color texture', 'Always'],
  ['NORMAL', 'surface bumps via lighting', 'Brick, fabric, rocky cliffs'],
  ['EMISSIVE', 'self-glow (ignores light)', 'Lava cracks, magic runes, windows'],
  ['METALNESS/ROUGHNESS', 'PBR response', 'Only if you ship PBR pipelines']
])}
${c`
// Assign maps (textures owned by AssetManager!):
SetMaterialTexture(&mat, MATERIAL_MAP_ALBEDO,   AssetsTexture("rock_alb"));
SetMaterialTexture(&mat, MATERIAL_MAP_NORMAL,   AssetsTexture("rock_nrm"));
SetMaterialTexture(&mat, MATERIAL_MAP_EMISSIVE, AssetsTexture("rock_emi"));
mat.maps[MATERIAL_MAP_EMISSIVE].color = ORANGE;   // tint the glow

// Emissive + Ch 8 soul: bloom via the post pipeline (Ch 11!) makes
// emissive surfaces actually GLOW — material says "bright",
// the fullscreen pass says "halo".

// Stylized games often skip normal maps entirely: albedo + strong
// directional + baked AO in the albedo = 90% of the look at 1/3 cost.`}
${bp(`Texture discipline from Ch 4 applies: one atlas-style material set shared by all level geometry
(material switches = draw call breaks). Per-model unique textures are for heroes only — the player,
not the 200 crates.`)}
`);

S(13, 'Batching & Instancing — Draw Less', `
${lead(`Same batching law, 3D edition: every material/shader switch costs a draw call. For armies of
identical objects, <b>instancing</b> draws N objects in one call.`)}
${c`
// NAIVE: 200 crates = 200 draw calls (200 material binds)
for (int i = 0; i < 200; i++)
    DrawModel(crates[i].model, crates[i].pos, 1.0f, WHITE);

// INSTANCED: one mesh, one material, ONE call:
Matrix transforms[200];
for (int i = 0; i < 200; i++)
    transforms[i] = CrateMatrix(&crates[i]);     // T·R·S composed

DrawMeshInstanced(cratesMesh, cratesMaterial, transforms, 200);
// 1 draw call, GPU repeats the mesh per matrix. 200× less CPU.`}
${tbl(['Scenario', 'Strategy', 'Calls'], [
  ['200 identical crates', '<code class="inl">DrawMeshInstanced</code>', '1'],
  ['30 unique hero models', 'plain <code class="inl">DrawModel</code>', '≤30 (fine!)'],
  ['Level geometry (one material)', 'merge meshes at export or load', '1'],
  ['Mixed everything', 'sort draw list by material, then draw', '≈ material count']
])}
${bp(`The 3D draw-call budget is the same shape as Ch 5&rsquo;s batch budget: sort by material, merge
static geometry, instance repeats. On desktop you can afford sloppiness; on mobile web/ARM you cannot.`)}
`);

S(13, 'The 3D Camera Controller', `
${lead(`Canyon 3D needs an orbit-plus-follow camera: chase the player, orbit on drag, zoom on wheel,
and never clip through terrain. The Camera2D lessons (damping, clamping) return verbatim.`)}
${c`
// src/gfx/CameraRig.c
typedef struct CameraRig {
    Camera3D cam;
    float yaw, pitch;           // orbit angles
    float dist;                 // orbit radius
    Vector3 focus;              // damped follow target (Ch 3 Damp!)
    float minPitch, maxPitch;   // clamp (Camera2D bounds law)
    bool  dragging;
} CameraRig;

void RigUpdate(CameraRig *r, Vector3 playerPos, float dt) {
    // input: right-drag orbits, wheel zooms (Ch 2 unified input)
    if (IsMouseButtonDown(MOUSE_BUTTON_RIGHT)) {
        Vector2 d = GetMouseDelta();
        r->yaw   += d.x * 0.005f;
        r->pitch += d.y * 0.005f;
    }
    r->pitch = ClampF(r->pitch, 0.15f, 1.35f);        // poles clamp
    r->dist  = DampF(r->dist, r->distTarget, 8, dt);  // smooth zoom

    // DAMPED focus follow — the Ch 3 law, Vector3 flavor:
    r->focus = Vector3Damp(r->focus, playerPos, 6.0f, dt);

    // spherical offset from angles:
    r->cam.target = r->focus;
    r->cam.position = Vector3Add(r->focus, (Vector3){
        r->dist * cosf(r->pitch) * sinf(r->yaw),
        r->dist * sinf(r->pitch),
        r->dist * cosf(r->pitch) * cosf(r->yaw) });
    r->cam.up = (Vector3){ 0, 1, 0 };
}`}
${tbl(['2D lesson → 3D translation', 'Same function'], [
  ['Follow damping λ=6', '<code class="inl">Vector3Damp</code>'],
  ['Bounds clamp', 'pitch clamp + terrain collision (below)'],
  ['Zoom smoothing', 'damped <code class="inl">dist</code>'],
  ['Screen-shake', 'offset <code class="inl">cam.position</code> post-compute']
])}
${pit(`Pitch clamps exist to stop the camera flipping through the poles (up-vector degeneracy at
±90°). Clamp to ±75° in practice; letting players look straight down/up is a quease factory and a
math edge case in one.`)}
`);

S(13, 'Camera vs World — The No-Clip Pass', `
${lead(`The third-person camera must not enter geometry. The classic fix: raycast from focus toward the
desired eye, pull the camera to just before the hit.`)}
${c`
// After computing the desired eye position (prev slide):
Vector3 dir = Vector3Subtract(r->cam.position, r->focus);
float len   = Vector3Length(dir);
dir = Vector3Normalize(dir);

Ray ray = { .position = r->focus, .direction = dir };
RayCollision hit = GetRayCollisionMesh? or scene-level:
// test vs terrain meshes + walls (your collision world, Ch 14 bodies!)
RayCollision c = CastRayVsScene(ray, len);

if (c.hit) {
    float d = fmaxf(c.distance - 0.4f, 1.2f);   // margin, min zoom
    r->cam.position = Vector3Add(r->focus,
                        Vector3Scale(dir, d));   // pull IN before the wall
    // + fade the player slightly when very close (classic trick):
    playerAlpha = Remap(d, 1.2f, 2.5f, 0.35f, 1.0f);
}`}
${diag(
`   focus ●──────────────────▶ ✕ wall
          ╲  ray (desired dist 8)
           ╲ hit at 3.2 → camera pulled to 2.8 (margin 0.4)
   camera never enters geometry; player fades when hugged`, 'Ray-based camera collision — the industry standard approach')}
${bp(`Include a <b>margin</b> (0.4) so the near plane never kisses a wall, and a <b>minimum distance</b>
(1.2) so the camera can never collapse into the player&rsquo;s head. Both are one <code class="inl">fmaxf</code>
each — skip them and every tight corridor becomes a glitch showcase.`)}
`);

S(13, 'Frustum Culling — Only Draw What the Camera Sees', `
${lead(`The 3D version of Ch 5&rsquo;s visible-tile window: test each object&rsquo;s bounding volume against
the camera frustum and skip the rest. 10,000 props → 200 draws.`)}
${diag(
`        ╱─────────────╲   frustum = camera's view volume
       ╱   VISIBLE     ╲
      ╱   ◉   ◉    ◉    ╲    drawn: 3
     ╱ ───────────────────╲
    ╱   ◉      ◉        ◉  ╲   culled: 3 (behind, outside, off-frustum)
   ╱─────────────────────── ╲`, 'If the bounding sphere misses the frustum, the mesh cannot be seen')}
${c`
// Per-object: bounding SPHERE test vs frustum (raylib: Frustum extras or manual)
bool FrustumContainsSphere(Camera3D cam, Vector3 center, float radius) {
    // 1) behind the camera? (dot with forward)
    Vector3 fwd = Vector3Normalize(
        Vector3Subtract(cam.target, cam.position));
    Vector3 rel = Vector3Subtract(center, cam.position);
    float depth = Vector3DotProduct(rel, fwd);
    if (depth + radius < cam.near? 0.1f) return false;
    if (depth - radius > DRAW_DISTANCE) return false;   // far plane

    // 2) horizontal FOV test (fast cone approximation):
    float halfFov = (cam.fovy * DEG2RAD) * 0.5f
                  * ((float)GetScreenWidth()/GetScreenHeight());
    float angle = acosf(Vector3DotProduct(fwd,
                        Vector3Normalize(rel)));
    return angle - asinf(radius/fmaxf(depth, 0.001f))
         < halfFov * 1.1f;     // +10% margin: cheap conservative pass
}

// Draw loop with culling FIRST (the check is ~20 ops vs a mesh draw):
for (prop in visible list)
    if (FrustumContainsSphere(cam, prop->center, prop->boundRadius))
        DrawModel(prop->model, prop->pos, 1, WHITE);`}
${bp(`Sphere tests are <b>conservative</b> — objects slightly outside the view still draw (cheap false
positives). That is correct: false negatives would pop objects visibly. Margin, not precision, is the
goal.`)}
`);

S(13, '3D Optimization Clinic', `
${lead(`3D frame budgets die by a thousand paper cuts. The clinic table, ranked by how often each kills
indie 3D projects.`)}
${tbl(['Killer', 'Symptom', 'Fix'], [
  ['No culling', 'FPS drops with world size, camera direction irrelevant', 'Prev slide; also sort near→far (early-Z)'],
  ['Draw-call flood', 'CPU-bound: fast CPU, bored GPU', 'Instance/merge; one material set for level'],
  ['Oversized textures', 'Long loads, VRAM churn', 'Mipmaps on; 2048 max for props'],
  ['Shadow map overkill', 'Big GPU spike per frame', 'One directional, 1024–2048 map, tight bounds'],
  ['Transparent sort chaos', 'Flickering glass/water', 'Draw back→front; few transparent surfaces'],
  ['Per-frame shader reloads', 'Spikes on new objects', 'Shader cache at load (Ch 11 law)']
])}
${c`
// Draw order that composes everything taught:
BeginDrawing();
  ClearBackground(SKYBLUE);
  BeginMode3D(cam);
    DrawSkybox();                       // cheapest thing first
    for (sorted near→far, opaque)
        if (frustum ok) DrawModel(...); // instanced where possible
    for (transparent, sorted back→front)
        DrawModel(...);                 // water, glass — LAST
  EndMode3D();
  HudDraw(...);                         // screen space, above all
EndDrawing();`}
${pit(`<b>Transparent surfaces</b> cannot depth-write safely — sorting them back-to-front is not
optional polish, it is correctness. A water plane drawn before a rock behind it will render the rock
<i>in front of</i> the water. Sort, or restrict transparency to one flat plane (our water!).`)}
`);

S(13, 'Ray Casting — The 3D Mouse', `
${lead(`Clicking a 3D world = unproject the mouse into a ray, then intersect with the scene. This is
picking, camera collision (slide 10), and hitscan weapons — one primitive, three features.`)}
${c`
// 1) Build the ray (raylib does the unprojection math):
Ray mouseRay = GetScreenRay(GetMousePosition(), cam);
//    origin = camera position, direction = through that pixel

// 2) Intersect — three flavors:
// a) vs ONE model's mesh (exact, slower — good for picking):
RayCollision hit = GetRayCollisionModel? Use GetRayCollisionBox fast pass:
    RayCollision boxHit = GetRayCollisionBox(mouseRay, modelBB);
    if (boxHit.hit) /* then optionally exact mesh test */;

// b) vs a PLANE (ground picking — move markers, place buildings):
RayCollision g = GetRayCollisionQuad? Plane version:
    RayCollision p = GetRayCollisionTriangle(ray,
        (Vector3){-50,0,-50}, (Vector3){50,0,-50},
        (Vector3){0,0,50});
    Vector3 groundPt = p.position;      // where the click lands on Y=0

// c) vs your physics world (Ch 14) — raycast against bodies`}

${tbl(['Target', 'Test', 'Cost', 'Use'], [
  ['Bounding box first', '<code class="inl">GetRayCollisionBox</code>', '~12 ops', 'Broad phase for picking'],
  ['Mesh exact', '<code class="inl">GetRayCollisionMesh</code>', 'per-triangle', 'Final answer for pickables'],
  ['Ground plane', 'triangle/quad test', 'trivial', 'Ground clicks, placement ghosts'],
  ['Physics bodies', 'engine raycast (Ch 14)', 'broadphase', 'Hitscan, camera']
])}
${bp(`Two-phase picking: <b>bounding box reject</b> for the whole scene, then exact mesh test on the
closest hit. Ten thousand mesh-exact tests per click will tank the frame; ten thousand box tests will
not.`)}
`);

S(13, 'Picking in Practice — Select Units & Hover Ghosts', `
${lead(`Picking becomes gameplay the same way Ch 6 triggers did: broad phase → exact test → event. Two
canonical uses: click-select and placement previews.`)}
${c`
// Unit selection (RTS-ish): nearest hit wins
GameObject *PickUnit(Camera3D cam, Vector2 mouse) {
    Ray ray = GetScreenRay(mouse, cam);
    GameObject *best = NULL; float bestDist = FLT_MAX;

    for (unit in units) {
        BoundingBox bb = UnitBox(unit);       // cached at spawn!
        RayCollision c = GetRayCollisionBox(ray, bb);
        if (c.hit && c.distance < bestDist) {
            best = unit; bestDist = c.distance;
        }
    }
    return best;   // caller: EventsEmit(EV_UNIT_SELECTED, best, NULL);
}

// Placement ghost (building preview follows the ground cursor):
void UpdatePlacementGhost(Camera3D cam, Model ghost) {
    Ray ray = GetScreenRay(GetMousePosition(), cam);
    RayCollision g = GroundHit(ray);              // plane test
    if (!g.hit) return;
    Vector3 snapped = SnapToGrid(g.position, 2.0f);  // 2-unit grid
    ghost.transform = MatrixTranslate(snapped.x, 0, snapped.z);
    // green when valid spot, red when colliding (bounds test vs blockers)
}`}
${diag(
`  mouse ──▶ ray ──▶ [bbox tests] ──▶ nearest ──▶ EV_UNIT_SELECTED
                 └─▶ [ground plane] ──▶ snapped point ──▶ ghost transform`, 'Picking pipeline: same event-driven shape as every system')}
${note(`Cache <code class="inl">BoundingBox</code> per object at spawn (compute once from mesh bounds
via <code class="inl">GetMeshBoundingBox</code>) — recomputing it per click is the picking equivalent of
the per-frame AtlasFind sin.`)}
`);

S(13, 'Sky, Ground & Composition Basics', `
${lead(`3D scenes die from emptiness. The cheapest composition tricks: a skybox, a ground grid you
actually draw on purpose, and fog for depth.`)}
${c`
// SKYBOX: giant inverted sphere/cube with a sky texture
Texture2D skyTex = LoadTexture("assets/sky_canyon.png");
skyTex = LoadTextureCubemap(skyTex, CUBEMAP_LAYOUT_AUTO_DETECT);
Model sky = LoadModelFromMesh(GenMeshSphere(1, 32, 32));  // tiny radius!
SetMaterialTexture(&sky.materials[0], MATERIAL_MAP_ALBEDO, skyTex);
// draw FIRST, huge scale, depth test OFF:
rlDisableDepthTest? or:
    DrawModel(sky, cam.position, 600.0f, WHITE);   // centered on camera

// FOG: the instant depth cue — distance fades to sky color
rlSet? via shader uniforms (lighting shader has fogColor/density):
SetShaderValue(lightShader, uFogColor, &skyColor, SHADER_UNIFORM_VEC3);

// COMPOSITION anchors:
//   foreground silhouette props, mid-ground action space,
//   background layered terrain + fog = the Ch 8 parallax instinct,
//   now literal geometry.`}
${tbl(['Trick', 'Cost', 'Effect'], [
  ['Skybox centered on camera', '1 draw', 'Horizon; hides world edge'],
  ['Fog matched to sky color', '1 uniform', 'Depth reading; hides pop-in'],
  ['Ground grid (dev) / terrain mesh (ship)', '1 draw', 'Spatial reference'],
  ['Silhouette props at edges', 'few draws', 'Frames the view (Ch 8 parallax law in 3D)']
])}
${bp(`Match <b>fog color to your skybox horizon</b> — distant geometry melting into the horizon color
reads as atmosphere. Fog that fades to gray while the sky is blue looks like a driver bug, not depth.`)}
`);

S(13, 'Chapter 13 Summary — Key Takeaways', `
${lead(`The third axis is tamed: pipeline, camera, materials, culling, picking.`)}
<ul class="tight">
<li>Transform chain: model → view → projection → clip → screen; mvp = P·V·M.</li>
<li>Camera3D: position/target/up/fovy; perspective for action, ortho for tactics; FOV 45–55 default.</li>
<li>Mesh = geometry; model = mesh + materials + transform; GLTF/GLB is the pipeline default.</li>
<li>Compose T·R·S once per tick; quaternions for rotation; one source of truth per object.</li>
<li>Lighting: ambient + directional + up to 4 slots; refresh <code class="inl">SHADER_LOC_VECTOR_VIEW</code> per frame.</li>
<li>Material maps: albedo always; normal/emissive as art direction demands.</li>
<li>Instance repeats; merge static geometry; sort by material — the Ch 5 budget law in 3D.</li>
<li>Camera rig: damped focus (λ=6 law), pitch clamps, ray-pullback vs walls, player fade.</li>
<li>Frustum culling with sphere tests + margin; draw sky first, transparent last, sorted.</li>
<li>Picking: <code class="inl">GetScreenRay</code> → bbox broad phase → exact test → events; ghosts follow snapped ground hits.</li>
</ul>
<h3>Carrying forward</h3>
<p>Pretty 3D with no physics yet — Chapter 14 completes the course: <b>rigid body dynamics in 3D</b>,
constraints, contact events, raycasts against bodies, and a full stacked-tower playground.</p>
${bp(`Checkpoint: orbit camera damps and clamps; crate rows instance into one draw; frustum culling
survives a 10,000-prop stress scene at 60fps; clicking selects the right crate in front of others;
fog matches sky.`)}
`);
