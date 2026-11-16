/* ============================================================
 * framework.js — deck engine + authoring helpers
 * Self-contained: no external dependencies, works offline
 * (file:// safe). Data files (ch01..ch14) only use the helpers
 * exported here, so the deck can also be validated headlessly
 * with Node (see check.js).
 * ============================================================ */
(function (root) {
  'use strict';

  /* ================= data containers ================= */

  var DECK = root.DECK = { slides: [], chapters: [], chapterByNum: {} };

  function defChapter(num, meta) {
    meta.num = num;
    DECK.chapters.push(meta);
    DECK.chapterByNum[num] = meta;
  }
  root.defChapter = defChapter;

  /* ================= authoring helpers ================= */

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var CODE_STORE = root.__CODE = [];   // raw sources for copy buttons

  function codeBlock(lang, src, file) {
    var id = CODE_STORE.push(src) - 1;
    var head =
      '<div class="code-head">' +
      '<span class="lang">' + esc(lang) + '</span>' +
      (file ? '<span class="file">' + esc(file) + '</span>' : '') +
      '<button class="copy-btn" data-code="' + id + '" title="Copy to clipboard">Copy</button>' +
      '</div>';
    return '<div class="code">' + head + '<pre><code>' + highlight(src, lang) + '</code></pre></div>';
  }

  /* Tagged-template code helpers:  ${c`int main(){...}`}  — raw strings,
     so C/GLSL backslashes and quotes never need escaping. */
  function joinRaw(strings, vals) {
    var out = '';
    for (var i = 0; i < strings.length; i++) {
      out += strings.raw[i];
      if (i < vals.length) out += String(vals[i]);
    }
    return out;
  }
  function makeTag(lang) {
    return function (strings) { return codeBlock(lang, joinRaw(strings, [].slice.call(arguments, 1))); };
  }
  root.c    = makeTag('C');
  root.cpp  = makeTag('C++');
  root.glsl = makeTag('GLSL');
  root.sh   = makeTag('Shell');
  root.json = makeTag('JSON');
  root.js   = makeTag('JS');
  root.txt  = makeTag('Text');

  /* Slide pushers */
  root.S = function (ch, title, body, opts) {
    DECK.slides.push(Object.assign({ ch: ch, title: title, body: body || '', type: 'content' }, opts || {}));
  };
  root.SEC = function (ch) {   // chapter divider slide (auto-numbered in flow)
    DECK.slides.push({ ch: ch, title: '', body: '', type: 'section' });
  };

  /* Callouts */
  function callout(cls, ic, label, html) {
    return '<div class="callout ' + cls + '"><div class="co-ic">' + ic + '</div><div>' +
      '<div class="co-t">' + label + '</div>' + html + '</div></div>';
  }
  root.bp   = function (t) { return callout('best', '✓', 'Best Practice', t); };
  root.pit  = function (t) { return callout('pit',  '⚠', 'Common Pitfall', t); };
  root.note = function (t) { return callout('note', 'ℹ', 'Note', t); };

  /* Layout helpers */
  root.cols = function (a, b, extra) {
    return '<div class="cols' + (extra ? ' ' + extra : '') + '"><div class="col">' + a + '</div><div class="col">' + b + '</div></div>';
  };
  root.diag = function (t, cap) {
    return '<div class="diagram">' + (cap ? '<div class="d-cap">' + esc(cap) + '</div>' : '') +
      '<pre>' + esc(t) + '</pre></div>';
  };
  root.tbl = function (head, rows) {
    var h = '<tr>' + head.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '</tr>';
    var b = rows.map(function (r) {
      return '<tr>' + r.map(function (x) { return '<td>' + x + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<table class="dt"><thead>' + h + '</thead><tbody>' + b + '</tbody></table>';
  };
  root.kbd  = function (k) { return '<kbd>' + esc(k) + '</kbd>'; };
  root.chip = function (t) { return '<span class="chip">' + t + '</span>'; };
  root.lead = function (t) { return '<p class="lead">' + t + '</p>'; };
  root.ul   = function (inner) { return '<ul class="tight">' + inner + '</ul>'; };

  /* ================= syntax highlighter ================= */

  var KW_C = set('if else for while do switch case default break continue return goto struct union enum typedef ' +
    'static const extern inline volatile register sizeof NULL true false auto restrict _Bool');
  var TY_C = set('void char short int long float double unsigned signed bool size_t ptrdiff_t Vector2 Vector3 ' +
    'Vector4 Quaternion Matrix Rectangle Color Image Texture Texture2D TextureCubemap RenderTexture2D Shader ' +
    'Camera Camera2D Camera3D Ray RayCollision BoundingBox Mesh Material MaterialMapIndex Model ModelAnimation ' +
    'Sound Music AudioStream Font GlyphInfo VrDeviceInfo FilePathList NPatchInfo PhysicsBody PhysicsShape ' +
    'TraceLogLevel ConfigFlags KeyboardKey MouseButton GamepadButton GamepadAxis Gesture unsigned');
  var KW_GL = set('if else for while do switch case default break continue return struct const discard uniform ' +
    'attribute varying in out layout precision highp mediump lowp flat patch centroid');
  var TY_GL = set('void bool int uint float double vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 mat2 mat3 ' +
    'mat4 sampler1D sampler2D sampler3D samplerCube float2 float3 float4 float4x4 int2 int3 uint2');
  var KW_JS = set('var let const function return if else for while do switch case default break continue new ' +
    'class extends typeof instanceof this null true false undefined of in throw try catch finally async await');
  var TY_JS = set('Array Object String Number Boolean Math JSON console window document Promise Map Set');

  function set(s) { var o = {}; s.split(/\s+/).forEach(function (w) { o[w] = 1; }); return o; }

  function span(cls, txt) { return '<span class="sy-' + cls + '">' + esc(txt) + '</span>'; }

  function hlPlain(seg, kw, ty) {
    var out = '', last = 0, m;
    var re = /(0[xX][0-9a-fA-F]+[uUlL]*|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?[fFuUlL]*)|([A-Za-z_]\w*)/g;
    while ((m = re.exec(seg)) !== null) {
      out += esc(seg.slice(last, m.index));
      var tok = m[0], cls = null;
      if (m[1]) cls = 'num';
      else if (kw[tok]) cls = 'kw';
      else if (ty[tok]) cls = 'ty';
      else if (/^[A-Z][A-Z0-9_]{2,}$/.test(tok)) cls = 'cst';
      else if (/^\s*\(/.test(seg.slice(m.index + tok.length))) cls = 'fn';
      out += cls ? span(cls, tok) : esc(tok);
      last = m.index + tok.length;
    }
    out += esc(seg.slice(last));
    return out;
  }

  function hlCLike(src, lang) {
    var kw = lang === 'GLSL' ? KW_GL : (lang === 'JS' ? KW_JS : KW_C);
    var ty = lang === 'GLSL' ? TY_GL : (lang === 'JS' ? TY_JS : TY_C);
    var out = '', last = 0, m;
    var re = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(^[ \t]*#[^\n]*)/gm;
    while ((m = re.exec(src)) !== null) {
      if (m.index > last) out += hlPlain(src.slice(last, m.index), kw, ty);
      if (m[1]) out += span('com', m[1]);
      else if (m[2]) out += span('str', m[2]);
      else out += span('pre', m[3]);
      last = m.index + m[0].length;
    }
    out += hlPlain(src.slice(last), kw, ty);
    return out;
  }

  function hlJson(src) {
    var out = '', last = 0, m;
    var re = /("(?:[^"\\\n]|\\.)*")(\s*:)?|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g;
    while ((m = re.exec(src)) !== null) {
      out += esc(src.slice(last, m.index));
      if (m[1]) out += m[2] ? span('cst', m[1]) + esc(m[2]) : span('str', m[1]);
      else if (m[3]) out += span('kw', m[3]);
      else out += span('num', m[4]);
      last = m.index + m[0].length;
    }
    return out + esc(src.slice(last));
  }

  function hlShell(src) {
    var out = '', last = 0, m;
    var re = /(#[^\n]*)|("(?:[^"\\]|\\.)*"|'[^'\n]*')|(\$\w+)/g;
    while ((m = re.exec(src)) !== null) {
      out += esc(src.slice(last, m.index));
      if (m[1]) out += span('com', m[1]);
      else if (m[2]) out += span('str', m[2]);
      else out += span('cst', m[3]);
      last = m.index + m[0].length;
    }
    return out + esc(src.slice(last));
  }

  function highlight(src, lang) {
    lang = (lang || '').toLowerCase();
    if (lang === 'c' || lang === 'c++') return hlCLike(src, lang === 'c' ? 'C' : 'C++');
    if (lang === 'glsl') return hlCLike(src, 'GLSL');
    if (lang === 'js') return hlCLike(src, 'JS');
    if (lang === 'json') return hlJson(src);
    if (lang === 'shell') return hlShell(src);
    return esc(src);
  }
  root.highlight = highlight;

  /* ================= engine (DOM; only after boot) ================= */

  var el = {};            // dom refs
  var cur = -1;
  var fwd = true;         // navigation direction
  var SLIDE_MS = 320;

  function total() { return DECK.slides.length; }
  function pad3(n) { return String(n).padStart(3, '0'); }
  function chMeta(n) { return DECK.chapterByNum[DECK.slides[n].ch]; }

  function hexA(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function accVars(m) {
    return '--acc:' + m.color + ';--acc-soft:' + hexA(m.color, 0.13) + ';';
  }

  /* ---- slide renderers ---- */
  function renderSlide(n) {
    var sl = DECK.slides[n], m = chMeta(n);
    var vars = 'style="' + accVars(m) + '"';
    var foot =
      '<div class="s-foot"><span class="brand">Game Development with raylib</span>' +
      '<span class="num">Chapter ' + m.num + ' · Slide ' + pad3(n + 1) + ' / ' + total() + '</span></div>';

    if (sl.type === 'title') {
      return '<section class="slide st-title" ' + vars + '>' +
        '<div class="t-kicker">The Complete Course · raylib 5.x · C99</div>' +
        '<h1 class="t-main">Game Development<br>with raylib</h1>' +
        '<p class="t-sub">' + sl.body + '</p>' +
        '<div class="t-badges">' +
        '<span class="chip">300+ slides</span><span class="chip">14 chapters</span>' +
        '<span class="chip">260+ code blocks</span><span class="chip">Offline · zero dependencies</span></div>' +
        '<p class="t-hint">Navigate with ' + kbd('→') + kbd('←') + ' · press ' + kbd('S') +
        ' for the slide index · ' + kbd('O') + ' for overview · ' + kbd('?') + ' for help</p>' + foot + '</section>';
    }
    if (sl.type === 'section') {
      return '<section class="slide st-section" ' + vars + '>' +
        '<div class="sec-num">' + String(m.num).padStart(2, '0') + '</div>' +
        '<div class="sec-kicker">Chapter ' + m.num + ' of ' + DECK.chapters.length + '</div>' +
        '<h1 class="sec-title">' + m.title + '</h1>' +
        (m.sub ? '<p class="sec-sub">' + m.sub + '</p>' : '') +
        '<ul class="sec-topics">' + (m.topics || []).map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' +
        foot + '</section>';
    }
    if (sl.type === 'finale') {
      return '<section class="slide st-finale" ' + vars + '>' +
        '<div class="f-main">' + sl.title + '</div><p class="f-sub">' + sl.body + '</p>' +
        '<div class="t-badges">' + (sl.topics || m.topics || []).map(function (t) { return '<span class="chip">' + t + '</span>'; }).join('') + '</div>' +
        foot + '</section>';
    }
    /* content slide */
    return '<section class="slide st-content" ' + vars + '>' +
      '<div class="s-head"><div class="s-kicker">Chapter ' + m.num + ' · ' + esc(m.tag) + '</div>' +
      '<h2 class="s-title">' + sl.title + '</h2></div>' +
      '<div class="s-body">' + sl.body + '</div>' + foot + '</section>';
  }

  /* ---- chrome ---- */
  function buildChrome() {
    document.getElementById('app').insertAdjacentHTML('beforeend',
      '<div id="topbar"><span class="logo-dot"></span><span id="crumb"></span>' +
      '<div class="tb-btns">' +
      '<button class="tb-btn" id="bIdx"  title="Slide index (S)">☰ Index</button>' +
      '<button class="tb-btn" id="bOvl"  title="Overview (O)">▦ Overview</button>' +
      '<button class="tb-btn" id="bFull" title="Fullscreen (F)">⛶ Fullscreen</button>' +
      '<button class="tb-btn" id="bHelp" title="Help (?)">? Help</button>' +
      '</div></div>' +
      '<div id="viewport"><div id="stage"></div></div>' +
      '<div id="bottombar">' +
      '<button class="nav-btn" id="bPrev">← Prev</button>' +
      '<div id="prog"><div id="progFill"></div></div>' +
      '<span id="cnt"></span><span id="chl"></span>' +
      '<button class="nav-btn" id="bNext">Next →</button></div>' +
      '<aside id="idx"><div class="ix-head"><h2>Slide Index</h2>' +
      '<input id="idxSearch" type="text" placeholder="Search slides & code…" autocomplete="off"></div>' +
      '<div class="ix-body" id="idxBody"></div></aside>' +
      '<div id="ovl"><h2>Slide Overview</h2><div class="ov-sub">Click any card to jump · Esc to close</div>' +
      '<div class="ov-grid" id="ovGrid"></div></div>' +
      '<div id="help"><div class="help-card"><h2>Keyboard Shortcuts</h2><table>' +
      '<tr><td>' + kbd('→') + kbd('↓') + kbd('Space') + ' / ' + kbd('PgDn') + '</td><td>Next slide</td></tr>' +
      '<tr><td>' + kbd('←') + kbd('↑') + kbd('PgUp') + '</td><td>Previous slide</td></tr>' +
      '<tr><td>' + kbd('Home') + ' / ' + kbd('End') + '</td><td>First / last slide</td></tr>' +
      '<tr><td>' + kbd('S') + '</td><td>Toggle slide index (searchable)</td></tr>' +
      '<tr><td>' + kbd('O') + '</td><td>Toggle overview grid</td></tr>' +
      '<tr><td>' + kbd('F') + '</td><td>Toggle fullscreen</td></tr>' +
      '<tr><td>' + kbd('Esc') + '</td><td>Close panels / overlays</td></tr>' +
      '</table><div class="dim">' + total() + ' slides · ' + DECK.chapters.length + ' chapters · Copy buttons on every code block · URL hash deep-links (#123)</div>' +
      '</div></div>');

    ['viewport', 'stage', 'crumb', 'cnt', 'chl', 'progFill', 'idxBody', 'ovGrid',
      'idx', 'ovl', 'help', 'idxSearch', 'bPrev', 'bNext'].forEach(function (id) {
      el[id] = document.getElementById(id);
    });

    el.bPrev.onclick = function () { nav(-1); };
    el.bNext.onclick = function () { nav(1); };
    document.getElementById('bIdx').onclick = toggleIdx;
    document.getElementById('bOvl').onclick = function () { toggleOvl(); };
    document.getElementById('bFull').onclick = toggleFull;
    document.getElementById('bHelp').onclick = toggleHelp;
    el.idxSearch.addEventListener('input', filterIdx);
    el.idxSearch.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var first = el.idxBody.querySelector('.ix-row:not(.hidden)');
        if (first) { show(+first.dataset.n); }
      }
      e.stopPropagation();
    });
    el.idxBody.addEventListener('click', function (e) {
      var r = e.target.closest('.ix-row');
      if (r) { show(+r.dataset.n); toggleIdx(false); }
    });
    el.ovGrid.addEventListener('click', function (e) {
      var c = e.target.closest('.ov-card');
      if (c) { show(+c.dataset.n); toggleOvl(false); }
    });
    el.viewport.addEventListener('touchstart', function (e) {
      touchX = e.changedTouches[0].clientX; touchY = e.changedTouches[0].clientY;
    }, { passive: true });
    el.viewport.addEventListener('touchend', function (e) {
      var dx = e.changedTouches[0].clientX - touchX, dy = e.changedTouches[0].clientY - touchY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) nav(dx < 0 ? 1 : -1);
    }, { passive: true });

    document.addEventListener('click', function (e) {
      var b = e.target.closest('.copy-btn');
      if (!b) return;
      copyText(root.__CODE[+b.dataset.code], b);
    });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', layout);
    window.addEventListener('hashchange', function () {
      var n = parseHash(); if (n !== cur) { fwd = n > cur; show(n); }
    });
  }

  var touchX = 0, touchY = 0;

  function copyText(text, btn) {
    function ok() {
      btn.classList.add('ok'); btn.textContent = '✓ Copied';
      setTimeout(function () { btn.classList.remove('ok'); btn.textContent = 'Copy'; }, 1300);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, function () { fallback(); });
    } else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { /* ignore */ }
      ta.remove();
    }
  }

  function parseHash() {
    var n = parseInt((location.hash || '').replace('#', ''), 10);
    if (isNaN(n)) n = 1;
    return Math.max(1, Math.min(total(), n)) - 1;
  }

  function show(n, instant) {
    n = Math.max(0, Math.min(total() - 1, n));
    var stage = el.stage;
    var old = stage.querySelector('.slide');
    var wrap = document.createElement('div');
    wrap.innerHTML = renderSlide(n);
    var sec = wrap.firstElementChild;
    if (old) {
      if (instant) old.remove();
      else {
        old.classList.remove('in', 'inB');
        old.classList.add(fwd ? 'out' : 'outB');
        setTimeout(function () { if (old.parentNode) old.remove(); }, SLIDE_MS + 40);
      }
    }
    if (!instant) sec.classList.add(fwd ? 'in' : 'inB');
    stage.appendChild(sec);
    cur = n;
    try { history.replaceState(null, '', '#' + (n + 1)); } catch (e) { }
    updateChrome();
  }

  function nav(d) {
    if (d === 0) return;
    fwd = d > 0;
    if ((fwd && cur >= total() - 1) || (!fwd && cur <= 0)) return;
    show(cur + d);
  }

  function updateChrome() {
    var m = chMeta(cur);
    el.cnt.textContent = (cur + 1) + ' / ' + total();
    el.chl.textContent = 'Chapter ' + m.num + ' — ' + m.title;
    el.progFill.style.width = ((cur + 1) / total() * 100).toFixed(2) + '%';
    el.progFill.style.background = 'linear-gradient(90deg,' + m.color + ',#a78bfa)';
    document.getElementById('crumb').innerHTML =
      '<b>Game Development with raylib</b><span class="sep">›</span>' +
      'Ch ' + m.num + ' · ' + esc(m.tag) + '<span class="sep">›</span>' + esc(DECK.slides[cur].title);
    document.getElementById('bPrev').disabled = cur === 0;
    document.getElementById('bNext').disabled = cur === total() - 1;
    var row = el.idxBody.querySelector('.ix-row.cur');
    if (row) row.classList.remove('cur');
    row = el.idxBody.querySelector('.ix-row[data-n="' + cur + '"]');
    if (row) {
      row.classList.add('cur');
      if (el.idx.classList.contains('open')) row.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ---- index & overview ---- */
  function slideQuery(sl) {
    if (!sl._q) {
      sl._q = (sl.title + ' ' + String(sl.body).replace(/<[^>]*>/g, ' ')).toLowerCase().replace(/\s+/g, ' ');
    }
    return sl._q;
  }

  function buildIdx() {
    var html = '';
    DECK.chapters.forEach(function (m) {
      html += '<div class="ix-ch" style="' + accVars(m) + '"><span class="dot"></span>Chapter ' +
        m.num + ' · ' + esc(m.tag) + '</div>';
      DECK.slides.forEach(function (sl, i) {
        if (sl.ch !== m.num) return;
        var t = sl.type === 'section' ? '◈ ' + m.title : (sl.type === 'title' ? '★ Course Title' : sl.title);
        html += '<div class="ix-row" data-n="' + i + '"><span class="ix-n">' + pad3(i + 1) + '</span><span>' + esc(t) + '</span></div>';
      });
    });
    el.idxBody.innerHTML = html;
  }

  function filterIdx() {
    var q = el.idxSearch.value.trim().toLowerCase();
    DECK.slides.forEach(function (sl, i) {
      var row = el.idxBody.querySelector('.ix-row[data-n="' + i + '"]');
      if (!row) return;
      row.classList.toggle('hidden', !!q && slideQuery(sl).indexOf(q) === -1);
    });
  }

  function buildOverview() {
    var html = '';
    DECK.slides.forEach(function (sl, i) {
      var m = DECK.chapterByNum[sl.ch];
      var t = sl.type === 'section' ? m.title : sl.title;
      html += '<button class="ov-card' + (sl.type === 'section' ? ' sec' : '') +
        '" data-n="' + i + '" style="' + accVars(m) + '"><span class="ov-n">' + pad3(i + 1) +
        ' · CH' + m.num + '</span><span>' + esc(t) + '</span></button>';
    });
    el.ovGrid.innerHTML = html;
  }

  /* ---- overlays ---- */
  function toggleIdx(force) {
    var open = typeof force === 'boolean' ? force : !el.idx.classList.contains('open');
    el.idx.classList.toggle('open', open);
    if (open) { el.idxSearch.focus(); var r = el.idxBody.querySelector('.ix-row.cur'); if (r) r.scrollIntoView({ block: 'center' }); }
  }
  function toggleOvl(force) {
    var open = typeof force === 'boolean' ? force : !document.getElementById('ovl').classList.contains('open');
    if (open && !el.ovGrid.childElementCount) buildOverview();
    document.getElementById('ovl').classList.toggle('open', open);
  }
  function toggleHelp(force) {
    var h = document.getElementById('help');
    var open = typeof force === 'boolean' ? force : !h.classList.contains('open');
    h.classList.toggle('open', open);
  }
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  }

  function onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'n': case 'N':
        e.preventDefault(); nav(1); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'p': case 'P':
        e.preventDefault(); nav(-1); break;
      case 'Home': e.preventDefault(); fwd = false; show(0); break;
      case 'End': e.preventDefault(); fwd = true; show(total() - 1); break;
      case 's': case 'S': toggleIdx(); break;
      case 'o': case 'O': toggleOvl(); break;
      case 'f': case 'F': toggleFull(); break;
      case '?': case 'h': case 'H': toggleHelp(); break;
      case 'Escape': toggleIdx(false); toggleOvl(false); toggleHelp(false); break;
    }
  }

  function layout() {
    var vp = el.viewport;
    var s = Math.min(vp.clientWidth / 1300, vp.clientHeight / 745);
    el.stage.style.transform = 'translate(-50%,-50%) scale(' + s.toFixed(4) + ')';
  }

  /* ---- boot ---- */
  DECK.boot = function () {
    buildChrome();
    buildIdx();
    fwd = true;
    show(parseHash(), true);
    layout();
    setTimeout(layout, 50);
  };

})(typeof window !== 'undefined' ? window : globalThis);
