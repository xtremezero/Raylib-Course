/* Chapter 10 — Managing Music and Sound Effects */
defChapter(10, {
  tag: 'Audio',
  title: 'Managing Music and Sound Effects',
  sub: 'Low-latency SFX vs streamed music, the SoundManager, device access, procedural and retro audio, spatialization and mixing.',
  color: '#fb7185',
  topics: ['raylib audio architecture (raudio)', 'The SoundManager & SFX pool', 'Music streaming done right', 'Crossfades & ducking',
    'Device access & custom streams', 'Procedural generation & chiptunes', 'Spatial panning & mixing buses']
});

SEC(10);

S(10, 'Why Audio Is Architecture, Not Afterthought', `
${lead(`Players forgive mediocre graphics almost never forgive <b>broken audio</b>: stutters, volume
spikes, silence where feedback belongs. Audio quality is mostly <b>management</b> quality — that's this
chapter.`)}
${tbl(['Symptom players notice', 'Root cause (architecture)'], [
  ['Music stutters when things get busy', '<code class="inl">UpdateMusicStream</code> skipped during hitch (starved decoder)'],
  ['Coin sound machine-guns into noise', 'No voice limit / duplicate-instance policy'],
  ['Volume wildly different per sound', 'No normalization pass, no master bus'],
  ['&ldquo;Feels dead&rdquo;', 'Missing feedback mapping — Ch 6 events with no audio row'],
  ['Silence on web until click', 'Autoplay policy — device must unlock on first input'],
  ['Game paused, music keeps playing', 'No pause routing between screens and audio']
])}
${diag(
`   EVENTS (Ch 6 bus)                SoundManager (this chapter)
   EV_COIN_PICKED ─────▶ table ──▶ ┌────────────────────────┐
   EV_PLAYER_HIT   ────▶ sfx ────▶ │ voices: limit + steal  │
   EV_LEVEL_WIN    ────▶ music ──▶ │ buses: master/sfx/mus  │
                                   │ streams: UpdateX/frame │
                                   │ device: unlock/pause   │
                                   └────────────────────────┘`, 'Same event bus as FX — audio is just another listener')}
${bp(`Bind audio through the <b>event bus</b>, not scattered <code class="inl">PlaySound</code> calls.
Then &ldquo;the jump is silent&rdquo; is a missing table row (see slide 5's map), not a code hunt through 30
files.`)}
`);

S(10, 'raudio Architecture — Devices, Channels, Formats', `
${lead(`raylib's audio module wraps <b>miniaudio</b>: one default output device, an internal mixer, and
two consumption models you already know — buffered <code class="inl">Sound</code> and streamed
<code class="inl">Music</code>.`)}
${diag(
`  miniaudio device (48kHz stereo float, hardware-mixed)
   ▲
  raylib mixer (per-frame: mixes all playing Sounds + Music buffers)
   ▲                    ▲
  Sound (Sound)         Music (AudioStream behind the scenes)
  fully decoded PCM     decoder fills a ring buffer; you pump it
  in RAM                with UpdateMusicStream() EVERY frame`, 'You never touch the device; you feed two abstractions')}
${tbl(['Type', 'Load', 'Per frame', 'RAM', 'Formats (5.x)'], [
  ['<code class="inl">Sound</code>', '<code class="inl">LoadSound</code> (decode all)', '—', 'Raw PCM: 10s stereo ≈ 1.7MB', 'WAV, OGG, MP3, FLAC, QOA'],
  ['<code class="inl">Music</code>', '<code class="inl">LoadMusicStream</code>', '<code class="inl">UpdateMusicStream</code>', '~1MB ring buffer', '+ XM, MOD (trackers!)'],
  ['<code class="inl">AudioStream</code>', '<code class="inl">LoadAudioStream</code>', '<code class="inl">UpdateAudioStream</code> or callback', 'small', 'your raw PCM — procedural (slide 12)']
])}
${c`
InitAudioDevice();                    // after InitWindow (Ch 2 order!)
if (!IsAudioDeviceReady()) {          // always verify — headless CI, web blocks
    TraceLog(LOG_WARNING, "[AUDIO] no device — game runs silent");
}
// …
CloseAudioDevice();                   // BEFORE CloseWindow`}
${pit(`Forgetting <code class="inl">IsAudioDeviceReady()</code> = crashes on machines/browsers where the
device fails (Bluetooth mid-switch, CI). Audio must be <b>optional</b>: guard every play call behind the
manager, not hope.`)}
`);

S(10, 'SoundManager — Design', `
${lead(`One module owns every audio handle and every policy: what plays, how many at once, how loud, and
what happens on pause. Everything else calls two functions.`)}
${c`
// src/audio/SoundManager.h
#define MAX_SOUNDS 48
#define MAX_VOICES 16          // simultaneous one-shots playing

typedef struct SoundEntry {
    char  name[32];            // "sfx_jump"
    Sound snd;
    float baseVolume;          // normalized at import (slide 6)
    int   priority;            // steal low-priority voices first
    float cooldown;            // min seconds between triggers (anti-spam)
    float lastPlayed;
} SoundEntry;

typedef struct SoundManager {
    SoundEntry sounds[MAX_SOUNDS]; int soundCount;

    // buses — settings sliders bind here (Ch 7)
    float volMaster, volSfx, volMusic;
    bool  muted;

    Music  music[2];           // two slots → crossfade (slide 8)
    int    musicActive;        // 0/1
    float  musicFade;          // crossfade progress

    bool  deviceReady;
    unsigned framesSinceVoice; // for the debug meter
} SoundManager;

// The whole public API gameplay ever needs:
void   SoundInit(SoundManager *sm);
void   SoundPlay(SoundManager *sm, const char *name);       // auto volume/pitch/pan policy
void   SoundPlayV(SoundManager *sm, const char *name,       // …with overrides
                  float vol, float pitch, float pan);
void   SoundMusic(SoundManager *sm, const char *track, float fadeSec);
void   SoundTick(SoundManager *sm, float dt);               // streams+fades
void   SoundSetPaused(SoundManager *sm, bool paused);       // screens call this
void   SoundShutdown(SoundManager *sm);`}
${bp(`Policies live <b>inside</b> the manager: voice limits, cooldowns, priorities, random pitch
variance. Call sites stay one-liners; changing &ldquo;how the game sounds&rdquo; happens in one file designers
can actually read.`)}
`);

S(10, 'Playing SFX — Voices, Pitch & Variety', `
${lead(`The pro feel secret: <b>no sound plays identically twice</b>. Small pitch/volume variance +
a voice budget = rich mix that never machine-guns.`)}
${c`
// src/audio/SoundManager.c — the play path
void SoundPlayV(SoundManager *sm, const char *name,
                float vol, float pitch, float pan) {
    if (!sm->deviceReady || sm->muted) return;
    SoundEntry *e = SoundFind(sm, name);
    if (!e) { TraceLog(LOG_WARNING, "[SND] miss '%s'", name); return; }

    // 1) anti-spam cooldown: same sound can't retrigger faster than N ms
    double now = GetTime();
    if (now - e->lastPlayed < e->cooldown) return;
    e->lastPlayed = now;

    // 2) natural variance: ±6% pitch, ±10% volume (tunable per entry)
    float p = pitch * (1.0f + GetRandomValue(-6, 6) / 100.0f);
    float v = e->baseVolume * vol * sm->volMaster * sm->volSfx
            * (1.0f + GetRandomValue(-10, 10) / 200.0f);

    // 3) instance the Sound (aliases share the buffer — cheap!)
    Sound inst = LoadSoundAlias(e->snd);
    SetSoundVolume(inst, ClampF(v, 0, 1));
    SetSoundPitch(inst, p);
    SetSoundPan(inst, pan);
    PlaySound(inst);
    VoiceTrackPush(sm, inst, e->priority);   // auto-UnloadSoundAlias when done
}`}

${tbl(['Feel problem', 'Fix (manager policy)'], [
  ['Coin spam on streaks', 'Cooldown 40ms + pitch rises with streak (event carries combo)'],
  ['Every step identical', '±6% pitch variance, 3 step samples rotated'],
  ['Big explosion cuts music', 'Ducking: sfx bus momentary lowers mus bus (slide 8)'],
  ['Menu clicks too loud vs game', 'Per-entry <code class="inl">baseVolume</code> from normalization pass']
])}
${note(`<code class="inl">LoadSoundAlias</code> (raylib 4.5+) creates an independent voice sharing the
decoded buffer — exactly what a one-shot needs. Track aliases and free when <code class="inl">IsSoundPlaying</code>
goes false; alias count is the &ldquo;voices&rdquo; meter on the debug HUD.`)}
`);

S(10, 'The Audio Map — Events → Sound Design', `
${lead(`The one-page contract between gameplay and sound design. Fill it completely and the game sounds
finished; every &ldquo;dead&rdquo; moment in playtests is a missing row here.`)}
${tbl(['Event (Ch 6 bus)', 'Sound', 'Policy'], [
  ['<code class="inl">EV_JUMP</code>', '<code class="inl">sfx_jump</code>', '±6% pitch; softer when double-jump'],
  ['<code class="inl">EV_LAND_HARD</code>', '<code class="inl">sfx_land</code>', 'Volume ∝ impact speed'],
  ['<code class="inl">EV_COIN_PICKED</code>', '<code class="inl">sfx_coin</code>', 'Pitch +streak (C5→E5→G5), 40ms cooldown'],
  ['<code class="inl">EV_POWER_PICKED</code>', '<code class="inl">sfx_power</code>', 'One-shot; duck music 20% for 0.5s'],
  ['<code class="inl">EV_PLAYER_HIT</code>', '<code class="inl">sfx_hit</code>', 'Priority 2 — never stolen'],
  ['<code class="inl">EV_PLAYER_DIED</code>', '<code class="inl">sfx_die</code>', 'Priority 3; music fades out 1s'],
  ['<code class="inl">EV_LEVEL_WIN</code>', '<code class="inl">sfx_win</code> (sting)', 'Music ducked under sting'],
  ['<code class="inl">EV_SPLASH</code>', '<code class="inl">sfx_splash</code>', 'Volume ∝ entry speed'],
  ['UI focus / activate', '<code class="inl">sfx_ui_move</code> / <code class="inl">sfx_ui_ok</code>', 'Quiet (0.4 base), no pitch variance']
])}
${c`
// The map IS code — a table bound at boot:
static const struct { EventType ev; const char *sfx; int prio; } AUDIOMAP[] = {
    { EV_JUMP,        "sfx_jump",  1 }, { EV_COIN_PICKED, "sfx_coin", 1 },
    { EV_PLAYER_HIT,  "sfx_hit",   2 }, { EV_LEVEL_WIN,   "sfx_win",  3 },
    // …
};
void AudioBindGameplay(SoundManager *sm) {
    for (row of AUDIOMAP)
        EventsOn(row.ev, MakeSfxHandler(sm, row.sfx, row.prio));
}`}
${bp(`Keep the map in the repo README too. New teammate + this table = they know the whole audio design
in one screen — and QA can diff &ldquo;sounds missing&rdquo; against it row by row.`)}
`);

S(10, 'Import Hygiene — Normalization & Formats', `
${lead(`Loudness consistency is won at <b>import</b>, not by ear at runtime. One ffmpeg pass normalizes
the library; the pipeline (Ch 4) enforces it.`)}
${c`
# tools/build_assets.sh — audio stage:
# 1) SFX: normalize to -3 dBFS peak, resample 44.1k, mono→stereo, trim silence
for f in assets/src-audio/sfx/*.wav; do
  ffmpeg -y -i "$f" -ar 44100 -af "silenceremove=start_periods=1:start_threshold=-45dB,
    loudnorm=I=-18:TP=-3, aformat=channel_layouts=stereo" "assets/audio/$(basename "$f")"
done
# 2) Music: OGG q5, loudness-matched to -16 LUFS (streaming standard)
for f in assets/src-audio/music/*.flac; do
  ffmpeg -y -i "$f" -q:a 5 -af "loudnorm=I=-16:TP=-1.5" \
    "assets/audio/$(basename "$f" .flac).ogg"
done`}
${tbl(['Asset class', 'Target', 'Why'], [
  ['SFX peaks', '−3 dBFS / −18 LUFS', 'Headroom so stacks of 8 voices never clip'],
  ['Music', '−16 LUFS', 'Streaming-platform standard; sits under SFX'],
  ['UI sounds', '×0.4 <code class="inl">baseVolume</code>', 'Frequent = must be quiet'],
  ['Sample rate', '44.1kHz uniform', 'No per-sound resampling surprises on device']]
)}
${pit(`Mixed mp3 rips at 320kbps with baked loudness differences <b>cannot be fixed at runtime</b> — the
<code class="inl">baseVolume</code> table becomes guesswork. Fix the files once in the pipeline; runtime
mixing then actually works.`)}
${note(`<code class="inl">GetSoundsReady? no —</code> verify with a loudness scan in
<code class="inl">validate_assets</code> (Ch 4): any file outside ±2 LU of target fails the build.`)}
`);

S(10, 'Music Streaming — The Update Contract', `
${lead(`<code class="inl">Music</code> decodes ahead of playback into a ring buffer — and <b>you</b> are
the pump. One missing call per frame = stutter; two seconds of missing calls = silence forever.`)}
${c`
// The contract — inside SoundTick, called EVERY frame from GameDraw path:
void SoundTick(SoundManager *sm, float dt) {
    if (!sm->deviceReady) return;
    UpdateMusicStream(sm->music[sm->musicActive]);    // ← the pump
    // (crossfade: also update the fading-out slot — next slide)
    // fades, ducking, pausing handled here too
}

// Controls you will actually use:
void MusicPlay(SoundManager *sm, const char *track) {
    Music m = sm->music[sm->musicActive];
    if (IsMusicPlaying(m)) StopMusicStream(m);
    m = LoadMusicStream(track);          // manager owns & unloads old
    SetMusicVolume(m, sm->volMaster * sm->volMusic);
    PlayMusicStream(m);
    sm->music[sm->musicActive] = m;
}

// Sequencing helper: intro → main loop (two files, gapless-enough):
if (GetMusicTimePlayed(m) >= GetMusicTimeLength(m) - 0.05f) {
    SeekMusicStream(m, LOOP_START_SECONDS);   // seamless-ish restart
}`}
${tbl(['Call', 'What it does', 'When'], [
  ['<code class="inl">UpdateMusicStream</code>', 'Decodes next chunk into buffer', 'Every frame, no exceptions'],
  ['<code class="inl">PlayMusicStream</code>', 'Starts playback from buffer', 'On track start'],
  ['<code class="inl">SeekMusicStream</code>', 'Jumps decoder+playhead', 'Loop points, chapter skip'],
  ['<code class="inl">GetMusicTimePlayed</code>', 'Seconds played', 'Loop logic, sync (slide 12)']
])}
${pit(`The &ldquo;music stops after loading screen&rdquo; bug: loading screens that don't call
<code class="inl">SoundTick</code> starve the pump. Rule: <b>one place</b> in the frame calls all audio
updates — the main loop — and loading loops either delegate to it or accept silence.`)}
`);

S(10, 'Crossfades & Music Transitions', `
${lead(`Two music slots + per-frame gain math = crossfades, fade-outs on death, and menu/game music
handoffs that feel like radio edits, not switch flips.`)}
${c`
// src/audio/MusicCross.c — two-slot crossfade
void SoundMusic(SoundManager *sm, const char *track, float fadeSec) {
    int in = 1 - sm->musicActive;                    // the free slot
    sm->music[in] = LoadMusicStream(track);
    SetMusicVolume(sm->music[in], 0.0f);             // starts silent
    PlayMusicStream(sm->music[in]);
    sm->musicActive = in;
    sm->musicFadeT = 0; sm->musicFadeDur = fadeSec;
    sm->musicFadingOut = sm->music[1 - in];          // old slot fades & unloads
}

void MusicFadeTick(SoundManager *sm, float dt) {
    UpdateMusicStream(sm->music[sm->musicActive]);   // pump BOTH slots
    if (sm->musicFadingOut.frameCount > 0)
        UpdateMusicStream(sm->musicFadingOut);

    if (sm->musicFadeDur <= 0) return;
    sm->musicFadeT += dt;
    float k = ClampF(sm->musicFadeT / sm->musicFadeDur, 0, 1);
    float v = sm->volMaster * sm->volMusic;
    SetMusicVolume(sm->music[sm->musicActive],    v * k);        // in
    if (sm->musicFadingOut.frameCount > 0)
        SetMusicVolume(sm->musicFadingOut,        v * (1 - k));  // out

    if (k >= 1 && sm->musicFadingOut.frameCount > 0) {
        StopMusicStream(sm->musicFadingOut);
        UnloadMusicStream(sm->musicFadingOut);       // free after fade
        sm->musicFadingOut = (Music){0};
    }
}`}

${tbl(['Musical moment', 'Implementation'], [
  ['Menu ↔ gameplay', '1.8s crossfade, different tracks'],
  ['Death', 'Fade out 1.2s + lowpass-feel via pitch 0.96'],
  ['Level win', 'Duck to 30%, sting, then resume/crossfade'],
  ['Cave area', 'Crossfade to ambient variant (same tempo!)'],
  ['Tension zone', 'Layer IN a percussion track slot (3rd stream)']
])}
${bp(`Crossfades sound best when tracks share <b>tempo and key</b> — plan the music as variants of one
suite, and layering/crossfading reads as arrangement, not as two songs fighting.`)}
`);

S(10, 'Ducking & Sidechain Feel', `
${lead(`Ducking = automatically lowering music when important SFX play. It's the podcast trick, and it
makes impacts feel twice as heavy for zero new sounds.`)}
${c`
// src/audio/Duck.c
typedef struct Duck {
    float amount;      // how deep: 0.3 = dip to 30% music
    float t, attack, release;   // timing curve
    bool  active;
} Duck;

void DuckTrigger(SoundManager *sm, float depth, float attack, float release) {
    Duck *d = &sm->duck;
    d->amount = fmaxf(d->amount, depth);   // keep the deepest request
    d->attack = attack; d->release = release;
    d->active = true; d->t = 0;
}

void DuckTick(SoundManager *sm, float dt) {
    Duck *d = &sm->duck;
    if (!d->active) return;
    d->t += dt;
    float k;                                 // envelope: fast in, slow out
    if (d->t < d->attack) k = d->t / d->attack;
    else {
        k = 1.0f - (d->t - d->attack) / d->release;
        if (k <= 0) { d->active = false; d->amount = 0; k = 0; }
    }
    float musicV = sm->volMaster * sm->volMusic
                 * (1.0f - d->amount * k);
    SetMusicVolume(sm->music[sm->musicActive], musicV);
}

// Wire: EV_PLAYER_HIT → DuckTrigger(sm, 0.4f, 0.05f, 0.8f);  // punchy
//       EV_LEVEL_WIN → DuckTrigger(sm, 0.7f, 0.1f, 2.0f);    // sting space`}
${diag(
`  music gain
  1.0 ─────┐
           ╲  ← attack 50ms        "the world steps aside
  0.6 ──────╲──────────╲            for the impact"
                    ╲   ╲ ← release 800ms
  0.3       ───────────╲─────
                        ╲
  1.0 …──────────────────┴─────────  (recovers, unnoticed)`, 'The duck envelope — felt, never seen')}
${pit(`Duck <b>release</b> too fast (≤200ms) sounds like the music glitching — the ear tracks the &ldquo;hole&rdquo;
closing. Keep release 0.6–1.2s; players should never consciously notice the dip.`)}
`);

S(10, 'Pause, Focus & Lifecycle Routing', `
${lead(`Screens already own lifecycle hooks (Ch 7); audio subscribes to them once. Get this right and
&ldquo;alt-tab&rd; music&rdquo; bugs cannot exist.`)}
${c`
// src/audio/SoundLifecycle.c
void SoundSetPaused(SoundManager *sm, bool paused) {
    if (!sm->deviceReady || sm->paused == paused) return;
    sm->paused = paused;
    Music m = sm->music[sm->musicActive];
    if (paused) PauseMusicStream(m);
    else        ResumeMusicStream(m);
    // one-shot Sounds stop naturally; ambient loops pause too:
    for (ambient loops) paused ? PauseSound(s) : ResumeSound(s);
}

// Wire into screen hooks (Ch 7) — ONE place, all routing:
//   ScreenGame.pause   → SoundSetPaused(sm, true)
//   ScreenGame.resume  → SoundSetPaused(sm, false)
//   ScreenGameOver.enter → MusicFadeOut(sm, 1.2f)

// Window focus (desktop/web): OS may not mute for you — do it politely
if (IsWindowMinimized() || (IsWindowState(FLAG_WINDOW_UNFOCUSED)
                            && !IsWindowState(FLAG_WINDOW_ALWAYS_RUN))) {
    SoundSetPaused(&g->sound, true);
} else if (!g->screensPaused) {
    SoundSetPaused(&g->sound, false);
}`}
${tbl(['Moment', 'Desired audio', 'Routed by'], [
  ['Pause menu open', 'Music pauses softly (not hard-stop)', '<code class="inl">ScreenGame.pause</code>'],
  ['Settings volume slider', 'Instant, live preview', 'slider binds <code class="inl">volMusic</code>'],
  ['App minimized', 'Mute (mobile courtesy; often required)', 'focus watcher above'],
  ['Game over', 'Music fades, sting plays, silence under overlay', '<code class="inl">ScreenGameOver.enter</code>'],
  ['Boot splash', 'Silent until menu (autoplay! next slide)', 'SPLASH screen policy']
])}
${pit(`<b>Hard-stopping</b> music on pause (<code class="inl">StopMusicStream</code>) loses the position on
some backends; use <code class="inl">PauseMusicStream</code> — resume continues sample-accurate.`)}
`);

S(10, 'Web & Platform Realities', `
${lead(`Browsers block audio until a user gesture; mobile OS suspends your process at will. Both are
solved <b>once</b>, in the platform layer (Ch 2 pattern).`)}
${c`
// Web: unlock on first input — the standard ritual
void AudioWebUnlockOnce(SoundManager *sm) {
#if defined(PLATFORM_WEB)
    static bool unlocked = false;
    if (unlocked || sm->deviceReady) return;
    if (IsMouseButtonPressed(MOUSE_BUTTON_LEFT)
        || IsKeyPressed(KEY_SPACE) || GetTouchX() >= 0) {
        InitAudioDevice();               // gesture context: allowed
        unlocked = IsAudioDeviceReady();
        if (unlocked) TraceLog(LOG_INFO, "[AUDIO] unlocked");
    }
#endif
}

// Mobile: the OS pauses/resumes you (Ch 2 lifecycle) — audio follows:
void OnAppPause(void) { SoundSetPaused(&g->sound, true);
                        SetMasterVolume(0.0f); }   // belt & suspenders
void OnAppResume(void) { SetMasterVolume(1.0f);
                         SoundSetPaused(&g->sound, false); }`}
${tbl(['Platform', 'Quirk', 'Mitigation'], [
  ['Web', 'No audio before first gesture', 'Unlock ritual; silent splash; visual hint'],
  ['Web', 'Streams need <code class="inl">UpdateMusicStream</code> despite throttling', 'Hidden tab: pause music on <code class="inl">IsWindowMinimized</code>'],
  ['Android', 'Focus loss (call, other app)', '<code class="inl">OnAppPause</code> route above'],
  ['iOS', 'Silent switch kills game audio', 'Detect + one-time toast (&ldquo;flip switch for sound&rdquo;)'],
  ['Desktop', 'Device gone mid-game (BT off)', '<code class="inl">IsAudioDeviceReady</code> poll at low frequency → safe shutdown']
])}
${bp(`Design <b>audio-optional from day one</b> (the manager's <code class="inl">deviceReady</code> guard).
The same guard then covers CI tests, screenshots bots, and the &ldquo;no speakers&rdquo; kiosk — three failures
prevented by one if.`)}
`);

S(10, 'Direct Device Access — Volume, Panels & CD Quality', `
${lead(`Below the manager sits the device layer: master volume, buffer sizing (latency knob), and
querying what the hardware actually is — read-only facts every settings menu should show.`)}
${c`
// Master bus — the ONE true mute/volume everyone respects:
SetMasterVolume(sm->volMaster * (sm->muted ? 0.0f : 1.0f));
float current = GetMasterVolume();          // read back (5.x)

// Latency tuning BEFORE InitAudioDevice: smaller buffers = less lag,
// higher risk of glitches on slow devices:
SetAudioStreamBufferSizeDefault(2048);      // default-ish; 1024 for rhythm games

// What are we even playing on? (diagnostics screen / bug reports)
TraceLog(LOG_INFO, "[AUDIO] device=%s", GetAudioDeviceName?.()); // if available
// + ma_context info via miniaudio directly when vendored (next slide)

// Counting what's live (your audio debug HUD):
int playing = 0;
for (each alias voice) if (IsSoundPlaying(v)) playing++;
DrawText(TextFormat("voices %d/%d  mus %.1fdB", playing, MAX_VOICES,
         20.0f*log10f(sm->volMusic + 1e-4f)), 12, 96, 16, LIME);`}
${tbl(['Setting', 'Range', 'Where it lives'], [
  ['Master volume', '0–1', 'Settings + hardware mute honor'],
  ['SFX / Music buses', '0–1', 'Settings sliders (Ch 7 bind)'],
  ['Stream buffer', '512–8192 frames', 'Platform build config — not user-facing'],
  ['Voice limit', '8–24', 'Manager constant by platform tier']
])}
${pit(`Master volume multiplies <b>everything</b> — including your carefully normalized buses. Respect the
user's OS volume; never set master &gt; 1.0 to &ldquo;be louder&rdquo; (clipping, distortion, angry reviews).`)}
`);

S(10, 'Custom Audio Streams — The Procedural Pump', `
${lead(`<code class="inl">AudioStream</code> = you generate raw samples and push them. This is the door to
procedural audio, real-time DSP, and (next slide) recording — the lowest-level public API raylib
exposes.`)}
${c`
// A live sine-beep synth — the minimal working pump
typedef struct Synth {
    AudioStream stream;
    float freq, phase;
    bool  on;
} Synth;

void SynthInit(Synth *s) {
    // format: 44100 Hz, 16-bit, mono — must match what we push!
    s->stream = LoadAudioStream(44100, 16, 1);
    SetAudioStreamCallback(s->stream, SynthCallback);  // device pulls US
    s->callbackCtx = s;                                // wire context
    PlayAudioStream(s->stream);
}

// The device calls this when it needs samples (audio thread!):
void SynthCallback(void *buffer, unsigned int frames) {
    Synth *s = ctx;
    short *out = (short *)buffer;
    for (unsigned i = 0; i < frames; i++) {
        s->phase += s->freq / 44100.0f;
        if (s->phase >= 1.0f) s->phase -= 1.0f;
        float v = s->on ? sinf(s->phase * 2*PI) * 0.25f : 0.0f; // -12 dB
        out[i] = (short)(v * 32767);
    }
    // ⚠ audio thread: no malloc, no locks, no raylib calls — math only
}`}

${diag(
`  game thread                    audio thread (device pull!)
  ───────────                    ─────────────────────────
  set freq/on flags  ──atomics──▶ SynthCallback generates N frames
  (never lock here)               → buffer → DAC → speakers
  PULL model: the device asks; you answer. Never push from game
  thread unless using UpdateAudioStream with your own ring buffer.`, 'Callback discipline: lock-free or dead')}
${pit(`The callback runs on the <b>audio thread</b>: raylib calls, <code class="inl">malloc</code>,
<code class="inl">printf</code>, and mutexes are all off-limits (priority-inversion → glitch city).
Communicate via atomics or SPSC ring buffers. This is the strictest threading rule in the whole
course.`)}
`);

S(10, 'Recording & Microphone Input', `
${lead(`raylib's public API doesn't expose capture — but raudio is built on <b>miniaudio</b>, the
industry's capture king. Vendor miniaudio once (single header) and recording is ~40 lines.`)}
${c`
// Vendor miniaudio (Ch 1 dependency tiers) — capture only:
#define MINIAUDIO_IMPLEMENTATION
#include "miniaudio.h"

typedef struct Mic {
    ma_device device;
    AudioStream out;         // monitor: play what we hear
    short ring[44100];       // 1s ring at 44.1k mono s16
    int head, tail;
} Mic;

static void MicDataCB(ma_device *dev, void *out, const void *in,
                      ma_uint32 frames) {
    Mic *m = dev->pUserData;
    const short *samples = in;
    for (ma_uint32 i = 0; i < frames; i++)     // push to ring
        m->ring[m->head++ % 44100] = samples[i];
    (void)out;                                  // no monitor for now
}

bool MicStart(Mic *m) {
    ma_device_config cfg = ma_device_config_init(ma_device_type_capture);
    cfg.capture.format = ma_format_s16;
    cfg.capture.channels = 1;
    cfg.sampleRate = 44100;
    cfg.dataCallback = MicDataCB;
    cfg.pUserData = m;
    return ma_device_init(NULL, &cfg, &m->device) == MA_SUCCESS
        && ma_device_start(&m->device) == MA_SUCCESS;
}

// Gameplay uses: microphone loudness → canyon wind gusts!
float MicLevel(const Mic *m) {                  // RMS over recent window
    double sum = 0; int n = 0;
    for (int i = m->tail; i != m->head; i++, n++)
        sum += (double)m->ring[i % 44100] * m->ring[i % 44100];
    return (float)sqrt(sum / (n ? n : 1)) / 32768.0f;
}`}
${tbl(['Use case', 'Mechanic'], [
  ['Loudness gate', 'Blow to spin pinwheels / clear dust'],
  ['Rhythm feed', 'Mic on-beat detection → bonus (careful: latency)'],
  ['Voice markup', 'Record annotations in the level editor (Ch 11 tools)'],
  ['Accessibility', 'Blow/clap as an alternative action input']
])}
${pit(`Always gate capture behind <b>explicit user consent + platform permission flow</b> (web prompts,
Android runtime permission). Request lazily at the feature, never at boot — a microphone permission
popup at launch is a trust-destroyer and a store-review flag.`)}
`);

S(10, 'Procedural SFX — Synthesis & rFXGen', `
${lead(`Retro SFX are <b>math</b>, not files: envelopes + oscillators + noise baked to WAV at build time.
raylib's companion tool <b>rFXGen</b> does it with a GUI; the classics (sfxr family) are 80 lines of C.`)}
${c`
// tools/gensfx.c — the sfxr "coin" recipe, condensed to essentials
typedef struct { float attack, sustain, decay, punch; } Env;
typedef struct {
    int   wave;            // 0 square 1 saw 2 sine 3 noise
    float fStart, fMin, fSlide;     // pitch sweep
    Env   env;             // amplitude envelope
    float dur;
} SfxRecipe;

short *SfxRender(SfxRecipe r, int *outSamples) {
    int n = (int)(r.dur * 44100);
    short *buf = malloc(n * sizeof(short));
    double phase = 0;
    for (int i = 0; i < n; i++) {
        float t = (float)i / n;
        // pitch slides toward fMin
        float f = Lerp(r.fStart, r.fMin, EaseOutQuad(t)) + r.fSlide * t;
        phase += f / 44100.0;
        // envelope: instant attack, exponential decay, punch on start
        float env = powf(1.0f - t, 2.0f) * r.env.punch;
        float v = 0;
        switch (r.wave) {
        case 0: v = fmodf(phase,1) > .5f ? 1 : -1; break;   // square
        case 1: v = 2*fmodf(phase,1) - 1;          break;   // saw
        case 3: v = ((float)rand()/RAND_MAX)*2-1;  break;   // noise
        }
        buf[i] = (short)(v * env * 0.5f * 32767);
    }
    *outSamples = n; return buf;
}

// The three Canyon Hopper recipes (baked at build → WAV → atlas'd by Ch 4):
SfxRecipe COIN = { .wave=0, .fStart=990, .fMin=1320, .env.punch=1, .dur=.18f };
SfxRecipe JUMP = { .wave=1, .fStart=330, .fMin=880,  .env.punch=1, .dur=.22f };
SfxRecipe HIT  = { .wave=3, .fStart=220, .fMin=40,   .env.punch=1, .dur=.30f };`}
${note(`<b>rFXGen</b> (companion tool) exports exactly this as WAVs with a parameter UI + randomizer
&ldquo;mutate&rdquo; button — the 1980s arcade sound-design workflow, alive and shipping today. Generate →
normalize (slide 6) → manifest.`)}
${bp(`Procedural SFX give <b>infinite variants at zero runtime cost</b>: bake 3 coin pitches and the
manager rotates them (slide 4). File size: ~5KB total for the whole SFX kit.`)}
`);

S(10, 'Chiptune & Tracker Music — XM/MOD', `
${lead(`raylib streams tracker formats natively — sample-based music that is <b>50–500KB</b> for a full
looping theme. The authentic retro soundtrack, no codec needed.`)}
${c`
// It's just Music:
Music chiptune = LoadMusicStream("assets/audio/mus_canyon.xm");
PlayMusicStream(chiptune);
// pumps through the same UpdateMusicStream contract

// Why trackers still win for retro games:
//  · .xm file = patterns + tiny samples → whole OST < 2MB
//  · loop points are native (pattern 0 → forever)
//  · tempo is data: you can read/sync to it (see beat sync below)
//  · FOSS tools: MilkyTracker, Furnace, FastTracker II (in the browser!)

// Beat sync — gameplay pulses with the music (free from the format):
double beatHz = 0.5 * chiptune.bpm / 60.0;      // .xm exposes bpm? if not,
// fallback: track beats by time:
float beatPhase = fmodf(GetMusicTimePlayed(chiptune) *
                        beatsPerSecond, 1.0f);
HudPulse(1.0f - beatPhase * 0.3f);              // logo breathes on beat
FxEmberRate(12 + 40 * powf(1.0f - beatPhase, 3)); // embers pump`}
${tbl(['Music approach', 'Size (3-min loop)', 'Loop quality', 'Best for'], [
  ['Tracker (.xm/.mod)', '50–500KB', 'Sample-accurate, native', '<b>Retro aesthetics</b>, tiny builds'],
  ['OGG stream', '~3MB', 'Small gap on some backends', 'Recorded/orchestrated music'],
  ['Layered streams', '~10MB', 'Crossfade-blend', 'Adaptive intensity (menu/cave)']
])}
${pit(`Tracker looping relies on the file's own loop markers — verify <code class="inl">GetMusicTimePlayed</code>
wraps cleanly per backend; if a backend gaps, fall back to the manual <code class="inl">SeekMusicStream</code>
loop from slide 7.`)}
`);

S(10, 'Spatial Audio for 2D — Panning & Attenuation', `
${lead(`No 3D engine needed: stereo pan = where it is horizontally; attenuation = how far. One function
maps world position → the two knobs you already have.`)}
${c`
// src/audio/Spatial.c
typedef struct AudioListener { Vector2 pos; float range; } AudioListener;

void SoundPlayAt(SoundManager *sm, const char *name,
                 AudioListener L, Vector2 at) {
    float dx = at.x - L.pos.x, dy = at.y - L.pos.y;
    float dist = sqrtf(dx*dx + dy*dy);

    // 1) attenuation: linear falloff to silence at range (feel > accuracy)
    float vol = ClampF(1.0f - dist / L.range, 0.0f, 1.0f);
    if (vol <= 0.01f) return;                  // culled: don't even play

    // 2) pan: -1 (left) .. +1 (right), shaped so mid-screen is neutral
    float pan = ClampF(dx / (L.range * 0.5f), -1.0f, 1.0f);
    pan = powf(pan, 1.5f) * 0.8f;              // soften extremes

    SoundPlayV(sm, name, vol, 1.0f, pan);      // variance still applies!
}

// Listener = camera center each tick (porcupines rattle from their side):
g->listener.pos = g->world.camRef->cam.target;
SoundPlayAt(&g->sound, "sfx_rattle", g->listener, porcupine->tf.pos);`}
${diag(
`  range circle around listener (camera center)
        ╲    dist↑ vol↓    ╱
   L ◀───────◉ listener ───────▶ R
   pan=-1   world point    pan=+1
   coin left = left ear; far = quiet. That's the whole 2D model.`, 'Two knobs, one function — 90% of perceived space')}
${bp(`Attenuate <b>before</b> playing (early-out above) — the voice budget stays for sounds players hear.
And never pan the UI: interface sounds are mono-centered <b>by law</b> of every good mix.`)}
`);

S(10, 'Mixing Buses & The Debug Meter', `
${lead(`Final architecture: sounds route through buses (sfx/music), buses through master. Seeing levels
live turns mixing from guesswork into engineering.`)}
${diag(
`  sfx_jump ─┐                                  ┌─ SFX bus ──┐
  sfx_coin ─┼─ per-entry baseVol ── variance ──▶│  (slider)  │
  sfx_hit  ─┘        (policy, slide 4)         └──────┬──────┘
                                                   ┌──▼───┐
  music[active] ── crossfade ── duck ────────────▶ │master │──▶ device
  ambient loops ──────────────────────────────────▶│(mute) │
                                                   └──────┘`, 'Signal flow: every gain decision has one home')}
${c`
// The debug meter — 3 bars, worth their weight in gold:
void SoundDebugDraw(SoundManager *sm) {
    float sfxDb  = 20*log10f(BusPeak(sm, BUS_SFX) + 1e-5);
    float musDb  = 20*log10f(BusPeak(sm, BUS_MUS) + 1e-5);
    float mixDb  = 20*log10f(BusPeak(sm, BUS_MASTER) + 1e-5);
    // BusPeak = running max updated per frame from a probe callback
    DrawMeter(12, 120, sfxDb, "SFX");
    DrawMeter(12, 150, musDb, "MUS");
    DrawMeter(12, 180, mixDb, "MIX");   // red above -1 dB → clipping!
}`}
${tbl(['Mix check', 'Healthy reading'], [
  ['Gameplay idle', 'MIX ≈ MUS level, SFX silent'],
  ['Coin streak', 'SFX peak ≤ −6 dB; MUX dips only if ducking'],
  ['Big explosion', 'MIX may kiss −1 dB; NEVER positive (clip)'],
  ['Settings slider', 'Corresponding bus moves instantly']
])}
${pit(`Clipping (<b>positive dB</b>) must be impossible by construction: normalization at import (−18 LUFS)
+ headroom in buses + <code class="inl">ClampF</code> on every gain. If the meter ever goes red, fix the
<i>source</i>, not the master.`)}
`);

S(10, 'Mobile & Performance Notes', `
${lead(`Audio is the most platform-hostile subsystem after input. These are the rules that keep it boring
— in the best way — on phones and web.`)}
${tbl(['Rule', 'Rationale'], [
  ['SFX ≤ 1–2s, total SFX RAM ≤ 8MB', 'Mobile kills apps at memory ceilings; decoded PCM is RAM'],
  ['Max 1–2 streams + pump every frame', 'Each stream = decoder + buffer; 3+ streams stutter on low tier'],
  ['Ogg over WAV for anything >2s', 'WAV of 3min = 30MB; OGG ≈ 3MB streamed'],
  ['Voice limit by tier (24/16/8)', 'Weakest phones mix audio on CPU'],
  ['No audio in the first frame', 'Unlock ritual (web) + device init cost — start silent, fade in'],
  ['<code class="inl">UpdateMusicStream</code> exactly once per frame', 'Twice = double decode; skipped = starve; profile verifies both']
])}
${c`
// Tier table (PlatformInfo from Ch 2 decides):
static const struct { int voices; float musicVol; bool allowAmbient; }
AUDIO_TIER[3] = {
    /* desktop */ { 24, 1.0f, true  },
    /* mobile  */ { 12, 1.0f, true  },
    /* web-low  */ {  8, 0.9f, false },
};
// applied at SoundInit — settings sliders multiply on top`}
${bp(`Measure audio <b>time</b> too: wrap <code class="inl">SoundTick</code> in the Ch 5 pass profiler.
If audio ever exceeds ~1.5ms/frame, you have too many voices/streams — the meter tells you which before
players do.`)}
`) ;

S(10, 'Testing Audio — The QA Pass', `
${lead(`Audio bugs hide in flows and configurations. This pass finds them systematically — headphones
AND speakers, because panning lies on mono output.`)}
${ul(`
<li>Full playthrough with eyes closed: every action audible? feedback ≤100ms? nothing annoying?</li>
<li>Coin streak at max speed: no machine-gun aliasing, pitch ladder musical not random.</li>
<li>Pause during music: soft pause, resume continues at the right spot (not restart).</li>
<li>Volume sliders at 0: true silence (no dither-y hiss); at 1: no clipping on the busiest moment.</li>
<li>Alt-tab / minimize mid-game: music mutes politely; returns on focus.</li>
<li>Web cold boot: silent splash → first click unlocks → menu music fades in.</li>
<li>Device removed mid-session (unplug USB headphones): game continues muted, no crash.</li>
<li>Level-win duck: music dips under sting and recovers — ask 3 people &ldquo;did anything sound odd?&rdquo;</li>
<li>Tracker loop: 10 consecutive loops, no gap, no pitch drift.</li>`)}
${tbl(['Automatable check', 'How'], [
  ['No clipped buffers', 'Build-time scan: peak ≤ −3 dBFS per file'],
  ['Manifest ↔ files match', '<code class="inl">validate_assets</code> (Ch 4) rows'],
  ['Event map complete', 'CI diff: every <code class="inl">EV_</code> has an audio row or explicit &ldquo;silent&rdquo;'],
  ['Frame calls exact', 'Profiler: <code class="inl">UpdateMusicStream</code> count == frames']
])}
${bp(`The <b>eyes-closed</b> run is the single highest-value audio test: with visuals gone, pacing, mix,
and missing feedback become glaring. Ten minutes, once per milestone.`)}
`);

S(10, 'Chapter 10 Summary — Key Takeaways', `
${lead(`Canyon Hopper now sounds like a game — mixed, routed, and resilient on every platform.`)}
<ul class="check">
  <li>Two consumption models: <b>Sound</b> (RAM, instant) vs <b>Music</b> (stream, pumped every frame).</li>
  <li>SoundManager owns policy: voice limits, cooldowns, ±variance, priorities, aliases.</li>
  <li>Event → sound map = the audio design doc; missing rows are the &ldquo;dead&rdquo; moments.</li>
  <li>Loudness fixed at <b>import</b> (−18/−16 LUFS), buses (master/sfx/music) at runtime; never clip.</li>
  <li>Crossfades via two slots; ducking via attack/release envelope under important SFX.</li>
  <li>Lifecycle routed through screen hooks: pause soft, minimize mutes, focus returns.</li>
  <li>Web unlock ritual; audio-optional guard everywhere (<code class="inl">IsAudioDeviceReady</code>).</li>
  <li>AudioStream callback = audio-thread discipline (atomics only); miniaudio for capture.</li>
  <li>Procedural SFX (sfxr recipes / rFXGen) and tracker music (XM: tiny, native loops, beat-synced juice).</li>
  <li>2D spatialization = attenuation + pan around the camera listener; UI never pans.</li>
</ul>
<h3>Carrying forward</h3>
<p>Chapters 11–12 are the deep-end fortnight: <b>2D physics, shaders, alternative inputs</b>, then the
full <b>animation systems</b>.</p>
${bp(`Checkpoint: eyes-closed playthrough passes; debug meters show no red; web build unlocks on first
click; alt-tab mutes and resumes; the whole audio RAM budget fits in 10MB.`)}
`);
