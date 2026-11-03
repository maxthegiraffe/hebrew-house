/* Tof · תוף, a live music video for hebrew.house.
   The screen is a drumhead covered in glowing sand. The track vibrates it: the sand runs to the still lines
   of each vibration (cymatics), leaps on every kick, and settles into Hebrew letters when the chant comes.
   Tof.create(canvas, opts) loads the analysis; engine.frame(t, dt) draws the moment t seconds in. WebGL2. */
(function () {
'use strict';
const LET = [...'אבגדהוזחטיכלמנסעפצקרשתךםןףץ'];   // the 22 and the five finals
const ID = Object.fromEntries(LET.map((c, i) => [c, i]));
const C = 128, COLS = 6, ROWS = 5, SPREAD = 22, BOX = C - 2 * (SPREAD + 4);
const NSUB = 20;

// ---------- letters as a signed distance field ----------
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - f[v[k]] - v[k] * v[k]) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = (f[q] + q * q - f[v[k]] - v[k] * v[k]) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  for (let q = 0, j = 0; q < n; q++) { while (z[j + 1] < q) j++; const r = q - v[j]; d[q] = r * r + f[v[j]]; }
}
function edt(g, w, h) {
  const n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) g[y * w + x] = d[x]; }
}
function buildAtlas(font) {
  const W = C * COLS, H = C * ROWS;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d', {willReadFrequently: true});
  c.font = `800 100px ${font}`;
  const m = LET.map(l => c.measureText(l));
  const ext = Math.max(...m.map(t => Math.max(t.actualBoundingBoxLeft + t.actualBoundingBoxRight, t.actualBoundingBoxAscent + t.actualBoundingBoxDescent)));
  const fs = 100 * BOX / ext;
  c.font = `800 ${fs}px ${font}`; c.fillStyle = '#fff'; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  const metrics = LET.map((l, i) => {
    const t = c.measureText(l), L = t.actualBoundingBoxLeft, R = t.actualBoundingBoxRight, A = t.actualBoundingBoxAscent, Dn = t.actualBoundingBoxDescent;
    c.fillText(l, (i % COLS + 0.5) * C - (R - L) / 2, (Math.floor(i / COLS) + 0.5) * C + (A - Dn) / 2);
    return {adv: t.width / fs, bx: (R - L) / 2 / fs, by: (A - Dn) / 2 / fs};
  });
  const sp = c.measureText(' ').width / fs;
  const a = c.getImageData(0, 0, W, H).data, N = W * H;
  const out = new Float64Array(N), inn = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const al = a[i * 4 + 3] / 255;
    if (al >= 1) { out[i] = 0; inn[i] = 1e20; } else if (al <= 0) { out[i] = 1e20; inn[i] = 0; }
    else { const e = 0.5 - al; out[i] = e > 0 ? e * e : 0; inn[i] = e < 0 ? e * e : 0; }
  }
  edt(out, W, H); edt(inn, W, H);
  const px = new Uint8Array(N);
  for (let i = 0; i < N; i++) px[i] = Math.max(0, Math.min(255, Math.round(255 * (0.5 - (Math.sqrt(out[i]) - Math.sqrt(inn[i])) / (2 * SPREAD)))));
  return {px, W, H, metrics, cellEm: C / fs, space: sp};
}

// ---------- shaders ----------
const QUAD = '#version 300 es\nin vec2 aP;out vec2 vUv;void main(){vUv=aP*.5+.5;gl_Position=vec4(aP,0.,1.);}';
const LIB = `
const float PI = 3.14159265;
const float SPR = ${(2 * SPREAD / C).toFixed(5)};
uniform sampler2D uAtlas;
uniform vec4 uMode;      // type (0 drum, 1 plate, 2 letters), m, n, turn
uniform vec4 uL[4];      // sand letters: x, y, cell size, id (-1 none)
uniform float uR;        // drumhead radius
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float glyph(vec2 q, float id) {
  vec2 o = max(abs(q) - .5, 0.);
  vec2 k = clamp(q, -.5, .5);
  id = floor(id + .5);
  float row = floor(id / 6. + .01), col = id - row * 6.;
  float v = texture(uAtlas, (vec2(col, row) + vec2(k.x + .5, .5 - k.y)) / vec2(6., 5.)).r;
  return (.5 - v) * SPR + length(o);
}
float letters(vec2 p) {   // distance to the sand letters, scene units
  float d = 9.;
  for (int i = 0; i < 4; i++) { vec4 l = uL[i]; if (l.w > -.5) d = min(d, glyph((p - l.xy) / l.z, l.w) * l.z); }
  return d;
}
float wave(vec2 p) {      // the drumhead's displacement, -1..1
  float c = cos(uMode.w), s = sin(uMode.w);
  p = mat2(c, s, -s, c) * p / uR;
  float m = uMode.y, n = uMode.z;
  if (uMode.x < .5) {     // a round drum: rings and spokes
    float r = length(p), a = atan(p.y, p.x);
    return cos(m * a) * cos((n - .5) * PI * r) * (m > .5 ? smoothstep(0., .035, r) : 1.);   // still at the rim, like a real head
  }
  if (uMode.x < 1.5) {    // a square plate: Chladni's figures
    vec2 q = p * .78;
    return cos(n * PI * q.x) * cos(m * PI * q.y) - cos(m * PI * q.x) * cos(n * PI * q.y);
  }
  float d = letters(p * uR);
  return clamp(d / .1, 0., 1.);
}`;
const SIM = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uState;
uniform float uDt, uFrame, uJit, uBounce, uKick, uKickN, uPerc, uPercN, uSwirl, uDrift, uBlow;
${LIB}
out vec4 o;
float amp(vec2 p) { return uMode.x > 1.5 ? wave(p) : abs(wave(p)); }
void main() {
  vec4 s = texture(uState, vUv);
  vec2 p = s.xy, v = s.zw;
  float e = .006;
  float a = amp(p);
  vec2 g = vec2(amp(p + vec2(e, 0.)) - amp(p - vec2(e, 0.)), amp(p + vec2(0., e)) - amp(p - vec2(0., e))) / (2. * e);
  float h1 = hash(vUv * 917.3 + uFrame * .137), h2 = hash(vUv * 413.7 - uFrame * .291);
  vec2 rnd = vec2(cos(6.2831 * h1), sin(6.2831 * h1)) * sqrt(h2);
  if (uMode.x > 1.5) {    // letters: fall inward, and from far away head for the nearest letter
    float best = 9.; vec2 to = vec2(0.);
    for (int i = 0; i < 4; i++) { vec4 l = uL[i]; if (l.w > -.5) { float dd = length(l.xy - p); if (dd < best) { best = dd; to = l.xy - p; } } }
    v += normalize(to + 1e-5) * uDrift * 1.6 * smoothstep(.0, .6, a) * uDt;
    v -= g * uDrift * .35 * uDt;
  } else v -= g * a * uDrift * uDt;
  v += rnd * (uJit + uBounce * a + uKick * (1.5 + 4. * a)) * sqrt(uDt);   // sand bounces where the skin moves, rests where it's still
  // a conga hit somewhere on the skin throws a ring of sand
  vec2 hp = (vec2(hash(vec2(uPercN, 1.7)), hash(vec2(uPercN, 9.1))) - .5) * uR * 1.2;
  vec2 dh = p - hp; float dl = length(dh);
  v += dh / (dl + .02) * uPerc * exp(-dl * 5.) * 3.5 * uDt;
  v += vec2(-p.y, p.x) * uSwirl * uDt;                 // builds: the sand starts to spin
  v += p * uBlow * uDt;                               // the end: it blows off the drum
  v *= exp(-uDt * 7.);
  p += v * uDt;
  float r = length(p);
  if (r > uR && uBlow < .01) { vec2 n = p / r; p = n * uR * .998; v = reflect(v, n) * .4; }
  o = vec4(p, v);
}`;
const PTS_VS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform int uSide;
uniform vec2 uRes, uCenter;
uniform float uZoom, uSize, uHue, uHat, uHatN, uGlitter, uSat, uGold;
uniform vec4 uPal;
out vec3 vCol;
float hash1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
vec3 pal(float t) { return uPal.x + uPal.y * cos(6.2831 * (t + vec3(0., .33, .67) * uPal.z + uPal.w)); }
void main() {
  ivec2 ij = ivec2(gl_VertexID % uSide, gl_VertexID / uSide);
  vec4 s = texelFetch(uState, ij, 0);
  float id = float(gl_VertexID);
  gl_Position = vec4((uCenter * 2. - 1.) + vec2(s.x * uRes.y / uRes.x, s.y) * uZoom, 0., 1.);
  float sp = length(s.zw), h = hash1(id * .0137);
  gl_PointSize = uSize * (1. + min(sp * 2., 1.2));
  vec3 gold = mix(vec3(1., .78, .42), vec3(1., .93, .8), h);
  vec3 sand = mix(pal(atan(s.y, s.x) * .3183 + length(s.xy) * .7 + uHue + h * .08) * 1.25, gold, uGold);   // resting: a coloured mandala
  vec3 run = mix(vec3(1., .96, .9), pal(uHue + .5 + h * .3), .35) * 1.2;                                   // flying: white hot
  vec3 c = mix(sand, run, clamp(sp * 1.4 + uSat, 0., 1.));
  float tw = step(1. - uGlitter, hash1(id * .71 + floor(uHatN) * 3.17)) * uHat;               // hats: glitter
  vCol = c * (.55 + .45 * h) + vec3(1.) * tw * 1.5;
}`;
const PTS_FS = `#version 300 es
precision highp float;
in vec3 vCol;
uniform float uGain;
out vec4 o;
void main() { vec2 d = gl_PointCoord - .5; float a = smoothstep(.5, .1, length(d)); o = vec4(vCol * a * uGain, 1.); }`;
const FADE_FS = '#version 300 es\nprecision highp float;out vec4 o;void main(){o=vec4(0.);}';
const SHOW = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uLight;
uniform vec2 uRes, uCenter;
uniform float uZoom, uAA, uT, uKick, uFlash, uFade, uExp, uField, uHue, uRim, uKA, uKS;
uniform vec4 uPal;
uniform vec4 uSub;           // amount
uniform vec4 uW[${NSUB}];
${LIB}
out vec4 o;
vec3 pal(float t) { return uPal.x + uPal.y * cos(6.2831 * (t + vec3(0., .33, .67) * uPal.z + uPal.w)); }
float sglyph(vec2 q, float id) { return glyph(q, id); }
void main() {
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  vec2 p = (vUv - uCenter) * asp * 2. / uZoom;
  float r = length(p);
  vec3 light = texture(uLight, vUv).rgb;
  float L = max(max(light.r, light.g), light.b);
  vec3 c = light * (1. - exp(-L * uExp)) / max(L, 1e-4);   // keeps the sand's colour where it piles up
  c += vec3(1.) * smoothstep(1.2, 4., L * uExp) * .35;
  // under the sand: the standing wave itself, faint interference colours
  float w;
  if (uMode.x > 1.5) { float dl = letters(p); w = sin(dl * 42. - uT * 5.) * smoothstep(.16, .03, dl) * .8 + cos(r * 18. - uT * 2.) * .25; }
  else w = wave(p);
  float inside = smoothstep(uR + .004, uR - .004, r);
  vec3 bg = pal(w * 1.4 + uHue + r * .5 - uT * .05) * (.12 + .22 * uField + .25 * uKick) * (.3 + .7 * abs(w));
  float shock = exp(-abs(r - uKA * 2.4) * 45.) * uKS * exp(-uKA * 3.5);
  bg += pal(uHue + .5 + r) * shock * .55;
  bg += vec3(.03, .02, .06) * (1. - r / uR);
  c += bg * inside * (1. - c);
  // the rim of the drum
  float rim = exp(-abs(r - uR) * 140.) * (.45 + 1.6 * uKick) * uRim;
  float ang = atan(p.y, p.x);
  float ticks = smoothstep(.85, 1., cos(ang * 22.)) * exp(-abs(r - uR - .03) * 90.) * .6 * uRim;
  c += pal(uHue + ang * .159) * (rim + ticks);
  c *= mix(.35, 1., inside) + (1. - inside) * .0;
  // subtitles
  if (uSub.x > .001) {
    float d = 9.;
    for (int i = 0; i < ${NSUB}; i++) { vec4 l = uW[i]; if (l.w > -.5) d = min(d, sglyph((p - l.xy) / l.z, l.w) * l.z); }
    c = mix(c, c * .12, smoothstep(.05, 0., d) * uSub.x * .85);
    c = mix(c, vec3(1., .96, .88), smoothstep(uAA, -uAA, d) * uSub.x);
  }
  vec2 e = (vUv - uCenter) * asp;
  c *= 1. - .3 * smoothstep(.3, 1.4, dot(e, e));
  c = mix(c, vec3(1., .97, .9), uFlash * (inside * .9 + .1));
  c += (fract(sin(dot(vUv * uRes + fract(uT) * 91., vec2(12.9898, 78.233))) * 43758.5453) - .5) * .03;
  o = vec4(c * uFade, 1.);
}`;

// ---------- the choreography ----------
// bars (125 BPM, 1.92 s): intro 0-6, kickless 7, verse A 8-22 (23 kickless), groove 24-38 (39 dropped), verse B 40-54 (55),
// verse A 56-71, groove 72-86 (87), verse C 88-102 (103), verse B 104-118 (119), outro 120-123, the last hit 124.
const KICKLESS = new Set([7, 23, 39, 55, 87, 103, 119]);
const DRUM = [[0, 2], [2, 3], [4, 3], [6, 4], [3, 5], [8, 4], [5, 6], [10, 5], [7, 7], [12, 6]];
const PLATE = [[1, 3], [2, 5], [3, 7], [4, 5], [1, 6], [5, 9], [3, 8], [2, 7], [6, 9], [4, 11]];
// palettes for the moving sand: offset, amplitude, spread, phase
const PALS = [[.55, .45, 1, 0], [.5, .5, 1, .55], [.6, .4, .6, .15], [.5, .5, 1.4, .8]];

function create(canvas, opts = {}) {
  const font = opts.font || '"Rubik", "Arial Hebrew", sans-serif';
  const gl = canvas.getContext('webgl2', {antialias: false, alpha: false, depth: false, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance'});
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
  const eng = {ok: false, dur: 0, scale: opts.scale || 1, center: [0.5, 0.5], zoom: 1, sub: null, subs: true, fadeIn: true};
  const prog = (vs, fs) => {
    const p = gl.createProgram();
    [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(([t, s]) => {
      const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    });
    gl.bindAttribLocation(p, 0, 'aP'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, a.name); }
    return {p, u};
  };
  const sim = prog(QUAD, SIM), pts = prog(PTS_VS, PTS_FS), show = prog(QUAD, SHOW), fade = prog(QUAD, FADE_FS);
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = (w, h, ifmt, fmt, type, data, lin) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data);
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, lin ? gl.LINEAR : gl.NEAREST));
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
    return t;
  };
  const fb = t => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f; };
  const R = 0.9;
  const side = opts.side || (Math.min(screen.width, screen.height) < 600 ? 256 : 512);
  let state = [], sfb = [], cur = 0, frameN = 0;
  {   // sand scattered evenly over the drum
    const n = side * side, a = new Float32Array(n * 4);
    let s = 12345; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) { const r = R * Math.sqrt(rnd()), th = rnd() * Math.PI * 2; a[i * 4] = r * Math.cos(th); a[i * 4 + 1] = r * Math.sin(th); }
    state = [0, 1].map(k => tex(side, side, gl.RGBA32F, gl.RGBA, gl.FLOAT, k ? null : a, false));
    sfb = state.map(fb);
  }
  let light = null, lfb = null, lw = 0, lh = 0;
  function targets() {
    const w = Math.max(2, Math.round(canvas.clientWidth * eng.scale)), h = Math.max(2, Math.round(canvas.clientHeight * eng.scale));
    if (opts.size) [canvas.width, canvas.height] = opts.size; else if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (lw === canvas.width && lh === canvas.height) return;
    lw = canvas.width; lh = canvas.height;
    if (light) { gl.deleteTexture(light); gl.deleteFramebuffer(lfb); }
    light = tex(lw, lh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null, true); lfb = fb(light);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  let atlas = null, metrics = null, cellEm = 1, space = 0.3, D = null;
  const b64 = s => { const r = atob(s), a = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; };
  const unpack = e => { let acc = 0; return {t: Float64Array.from(e.d, d => (acc += d) / 100), v: e.v.map(x => x / 9)}; };
  const lastLE = (arr, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) lo = m + 1; else hi = m; } return lo - 1; };
  const sm = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
  function layout(words) {   // RTL words -> letter centres (em), with the time each word lands
    const out = []; let pen = 0;
    for (let k = words.length - 1; k >= 0; k--) {   // visual order is right to left: lay out from the last word
      const [tw, w] = words[k];
      [...w].reverse().forEach(ch => { if (!(ch in ID)) return; const m = metrics[ID[ch]]; out.push({id: ID[ch], x: pen + m.bx, y: m.by, t: tw}); pen += m.adv; });
      if (k) pen += space;
    }
    out.forEach(o => { o.x -= pen / 2; o.y -= 0.3; });
    return {letters: out, w: pen};
  }

  // ---- per frame: what the drum does at time t ----
  function drive(t, idle) {
    const st = {gold: 0.6, kick: 0, kickN: 0, ka: 9, ks: 0, perc: 0, percN: 0, hat: 0, hatN: 0, flash: 0, fade: 1, swirl: 0, blow: 0, field: 0.4, sat: 0, jit: 0.2, drift: 6, hue: t * 0.02, pal: PALS[0], rim: 1, glitter: 0.006};
    if (idle) {
      const k = Math.floor(t / 6) % DRUM.length;
      Object.assign(st, {mode: [0, DRUM[k][0], DRUM[k][1], t * 0.05], letters: null, jit: 0.5, bounce: 2.4, kick: 0.15 + 0.1 * Math.sin(t * 1.3)});
      return st;
    }
    const bf = (t - D.t0) / D.p, bar = Math.max(0, bf / 4), B = Math.floor(bar), ph = bar - B;
    const n = Math.floor(bf);
    if (n >= 0 && n < D.kick.length) { st.ks = D.kick[n] / 255; st.ka = t - (D.t0 + n * D.p); st.kick = st.ks * Math.exp(-st.ka / 0.09); st.kickN = n; }
    let k = lastLE(D.hat.t, t);
    if (k >= 0) { st.hat = D.hat.v[k] * Math.exp(-(t - D.hat.t[k]) / 0.06); st.hatN = k; }
    k = lastLE(D.perc.t, t);
    if (k >= 0) { st.perc = D.perc.v[k] * Math.exp(-(t - D.perc.t[k]) / 0.08); st.percN = k; }
    const fi = Math.max(0, t * D.fps), i0 = Math.min(D.frames - 2, Math.floor(fi)), fr = Math.min(1, fi - i0);
    const band = b => (D.bands[i0 * 6 + b] * (1 - fr) + D.bands[(i0 + 1) * 6 + b] * fr) / 255;
    const bass = sm(0.3, 0.85, band(1)), air = sm(0.3, 0.8, band(5));
    const sec = B < 8 ? 0 : B < 24 ? 1 : B < 40 ? 2 : B < 56 ? 3 : B < 72 ? 1 : B < 88 ? 2 : B < 104 ? 4 : B < 120 ? 3 : 5;
    st.pal = PALS[[0, 0, 1, 2, 3, 3][sec]];
    st.gold = [0.75, 0.25, 0.45, 0.15, 0.0, 0.5][sec];
    st.field = 0.3 + 0.4 * air;
    // the pattern: drum modes, plate figures, or letters
    const turn = t * 0.04 + bass * 0.15;
    if (sec === 0) { const d = DRUM[Math.floor(B / 2) % DRUM.length]; st.mode = [0, d[0], d[1], turn]; }
    else if (sec === 1 || sec === 4) { const d = PLATE[(B + sec) % PLATE.length]; st.mode = [1, d[0], d[1], turn * 0.5]; }
    else if (sec === 3) { const d = DRUM[(B + 3) % DRUM.length]; st.mode = [0, d[0], d[1], turn + B * 0.4]; }
    else if (sec === 2) {   // the groove: the sand leaps into the next letter every two beats
      const j = Math.floor(bf / 2);
      st.word = [LET[(j * 5) % 22]]; st.sat = 0.15;
    } else { const d = DRUM[(B * 3) % DRUM.length]; st.mode = [0, d[0], d[1], turn]; }
    // the chant: "תוף, תוף" writes תוף in the sand
    const L = D.lines;
    k = lastLE(D.lt, t);
    if (k >= 0 && L[k][1][0][1] === 'תוף' && t - L[k][0] < 2.6) st.word = ['ת', 'ו', 'ף'];
    if (st.word) { st.mode = [2, 0, 0, 0]; st.jit = 0.25; st.bounce = 1.5; st.drift = 7; } else { st.jit = 0.55; st.bounce = 2.6; st.drift = 2.5; }
    // builds: the kickless bars spin the sand up; the downbeat after flashes
    if (KICKLESS.has(B)) { st.swirl = 4 * ph * ph; st.jit += 1.6 * ph; st.sat = ph; }
    const drops = [8, 24, 40, 56, 88, 104, 120].map(b => t - (D.t0 + b * 4 * D.p)).filter(x => x >= 0);
    if (drops.length) st.flash = 0.7 * Math.exp(-Math.min(...drops) / 0.2);
    if (sec >= 2 && sec <= 4) st.sat = Math.max(st.sat, 0.1 + 0.25 * air);
    st.hue = t * 0.025 + sec * 0.17;
    if (B >= 124) {   // the last hit: תוף one more time, then the sand blows away
      const e = t - (D.t0 + 124 * 4 * D.p);
      st.word = ['ת', 'ו', 'ף']; st.mode = [2, 0, 0, 0];
      st.flash = Math.exp(-e / 0.25); st.kick = Math.exp(-e / 0.3);
      st.blow = sm(1.2, 3, e) * 2.5; st.fade = 1 - sm(1.6, D.dur - (D.t0 + 124 * 4 * D.p) - 0.1, e); st.rim = 1 - sm(0.5, 2.5, e);
    }
    if (eng.fadeIn) st.fade *= sm(0, 1.0, t);
    // subtitles
    st.line = null;
    k = lastLE(D.lt, t);
    if (k >= 0) {
      const [t0, words] = L[k], nx = L[k + 1], end = Math.min(words[words.length - 1][0] + 1.6, nx ? nx[0] - 0.05 : 1e9);
      if (t < end) st.line = {words, amt: sm(t0 - 0.02, t0 + 0.06, t) * (1 - sm(end - 0.3, end, t))};
    }
    return st;
  }

  const SUBW = new Float32Array(NSUB * 4), LW = new Float32Array(16);
  function frame(t, dt, o = {}) {
    if (!eng.ok) return;
    targets();
    const st = drive(t, o.idle);
    const zoom = eng.zoom, [cx, cy] = eng.center;
    // sand letters
    LW.fill(0); for (let i = 0; i < 4; i++) LW[i * 4 + 3] = -1;
    if (st.word) {
      const lay = layout([[0, st.word.join('')]]), size = Math.min(0.62, 1.55 / Math.max(1, lay.w));
      lay.letters.forEach((l, i) => { LW[i * 4] = l.x * size; LW[i * 4 + 1] = l.y * size + 0.1 * (st.word.length === 1 ? 1 : 0); LW[i * 4 + 2] = cellEm * size * (st.word.length === 1 ? 1.45 : 1); LW[i * 4 + 3] = l.id; });
      if (st.word.length === 1) { LW[0] = 0; LW[1] = 0; }
    }
    // simulate in steps of at most 1/60 s
    const steps = dt > 0 ? Math.min(4, Math.ceil(dt * 60 - 0.01)) : 0, h = steps ? dt / steps : 0;
    gl.disable(gl.BLEND);
    gl.useProgram(sim.p); let u = sim.u;
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlas); gl.uniform1i(u.uAtlas, 1);
    gl.uniform4f(u.uMode, ...st.mode); gl.uniform4fv(u.uL, LW); gl.uniform1f(u.uR, R);
    gl.uniform1f(u.uJit, st.jit); gl.uniform1f(u.uBounce, st.bounce); gl.uniform1f(u.uKick, st.kick); gl.uniform1f(u.uPerc, st.perc); gl.uniform1f(u.uPercN, st.percN);
    gl.uniform1f(u.uSwirl, st.swirl); gl.uniform1f(u.uDrift, st.drift); gl.uniform1f(u.uBlow, st.blow);
    gl.viewport(0, 0, side, side);
    for (let s = 0; s < steps; s++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, sfb[cur ^ 1]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, state[cur]); gl.uniform1i(u.uState, 0);
      gl.uniform1f(u.uDt, h); gl.uniform1f(u.uFrame, frameN++ % 100000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      cur ^= 1;
    }
    // light: fade the trails, then pour the sand on
    gl.bindFramebuffer(gl.FRAMEBUFFER, lfb); gl.viewport(0, 0, lw, lh);
    gl.enable(gl.BLEND);
    gl.useProgram(fade.p); gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
    gl.blendColor(0, 0, 0, dt > 0 ? Math.pow(0.5, dt * 30) : 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (dt > 0 || o.force) {
      gl.useProgram(pts.p); u = pts.u; gl.blendFunc(gl.ONE, gl.ONE);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, state[cur]); gl.uniform1i(u.uState, 0);
      gl.uniform1i(u.uSide, side); gl.uniform2f(u.uRes, lw, lh); gl.uniform2f(u.uCenter, cx, cy); gl.uniform1f(u.uZoom, zoom);
      const px = lh * zoom / 1080;
      gl.uniform1f(u.uSize, Math.max(1, 2.2 * px * Math.sqrt(262144 / (side * side)) ** 0.5));
      gl.uniform1f(u.uGain, 0.15 * (262144 / (side * side)) ** 0.6 * (dt > 0 ? Math.min(1, dt * 30) : 1));
      gl.uniform1f(u.uHue, st.hue); gl.uniform1f(u.uHat, st.hat); gl.uniform1f(u.uHatN, st.hatN); gl.uniform1f(u.uGlitter, st.glitter); gl.uniform1f(u.uSat, st.sat); gl.uniform1f(u.uGold, st.gold);
      gl.uniform4f(u.uPal, ...st.pal);
      gl.drawArrays(gl.POINTS, 0, side * side);
    }
    gl.disable(gl.BLEND);
    // show
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(show.p); u = show.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, light); gl.uniform1i(u.uLight, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlas); gl.uniform1i(u.uAtlas, 1);
    gl.uniform2f(u.uRes, canvas.width, canvas.height); gl.uniform2f(u.uCenter, cx, cy); gl.uniform1f(u.uZoom, zoom); gl.uniform1f(u.uAA, 2 / (canvas.height * zoom));
    gl.uniform1f(u.uT, t); gl.uniform1f(u.uKick, st.kick); gl.uniform1f(u.uFlash, (opts.reduce ? 0.25 : 1) * st.flash); gl.uniform1f(u.uFade, st.fade);
    gl.uniform1f(u.uExp, 2.1); gl.uniform1f(u.uKA, st.ka); gl.uniform1f(u.uKS, st.ks); gl.uniform1f(u.uField, st.field); gl.uniform1f(u.uHue, st.hue); gl.uniform1f(u.uRim, st.rim);
    gl.uniform4f(u.uPal, ...st.pal); gl.uniform4f(u.uMode, ...st.mode); gl.uniform4fv(u.uL, LW); gl.uniform1f(u.uR, R);
    SUBW.fill(0); for (let i = 0; i < NSUB; i++) SUBW[i * 4 + 3] = -1;
    let amt = 0;
    if (st.line && eng.subs) {
      const lay = layout(st.line.words), box = eng.sub || {x: 0, y: -0.86 / zoom + 0.04, span: 2 * (lw / lh) / zoom * 0.8};
      const size = Math.min(0.12, box.span / Math.max(1, lay.w));
      lay.letters.slice(0, NSUB).forEach((l, i) => { SUBW[i * 4] = box.x + l.x * size; SUBW[i * 4 + 1] = (box.y || 0) + l.y * size; SUBW[i * 4 + 2] = cellEm * size; SUBW[i * 4 + 3] = t >= l.t - 0.03 ? l.id : -1; });
      amt = st.line.amt;
    }
    gl.uniform4fv(u.uW, SUBW); gl.uniform4f(u.uSub, amt, 0, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    eng.last = st;
  }

  eng.frame = frame;
  eng.levels = t => eng.ok ? drive(t, false) : null;
  eng.band = (t, b) => { const fi = Math.max(0, t * D.fps), i0 = Math.min(D.frames - 2, Math.floor(fi)), fr = Math.min(1, fi - i0); return (D.bands[i0 * 6 + b] * (1 - fr) + D.bands[(i0 + 1) * 6 + b] * fr) / 255; };
  eng.reset = () => { lw = 0; };
  eng.ready = (async () => {
    const [d] = await Promise.all([
      fetch(opts.data || 'tof/tof.json').then(r => r.json()),
      document.fonts ? document.fonts.load(`800 100px ${font}`, 'אבגתוףךםןץ').catch(() => null) : null,
    ]);
    D = d; D.bands = b64(d.bands); D.frames = D.bands.length / 6; D.kick = b64(d.kick);
    D.hat = unpack(d.hat); D.perc = unpack(d.perc); D.lt = d.lines.map(l => l[0]);
    eng.dur = d.dur; eng.t0 = d.t0; eng.p = d.p;
    const A = buildAtlas(font); metrics = A.metrics; cellEm = A.cellEm; space = A.space;
    atlas = tex(A.W, A.H, gl.R8, gl.RED, gl.UNSIGNED_BYTE, A.px, true);
    eng.ok = true;
    return eng;
  })();
  return eng;
}
window.Tof = {create};
})();
