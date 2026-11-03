/* Pera'i · פראי, a live music video for hebrew.house.
   Every shape is one of the 22 letters, drawn as a distance field and folded through WebGL.
   Perai.create(canvas, opts) loads the track's analysis; engine.frame(t, dt) draws the moment t seconds in. */
(function () {
'use strict';
const LET = [...'אבגדהוזחטיכלמנסעפצקרשת'];
const ID = Object.fromEntries(LET.map((c, i) => [c, i]));
const C = 160, COLS = 6, ROWS = 4, SPREAD = 24, BOX = C - 2 * (SPREAD + 4);   // atlas cell, SDF range, glyph box (px)
const TAU = Math.PI * 2;

// ---------- the aleph-bet as a signed distance field ----------
function edt1d(f, n, d, v, z) {   // Felzenszwalb & Huttenlocher, squared distance in 1D
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
  c.font = `900 100px ${font}`;
  const m = LET.map(l => c.measureText(l));
  const ext = Math.max(...m.map(t => Math.max(t.actualBoundingBoxLeft + t.actualBoundingBoxRight, t.actualBoundingBoxAscent + t.actualBoundingBoxDescent)));
  const fs = 100 * BOX / ext;
  c.font = `900 ${fs}px ${font}`; c.fillStyle = '#fff'; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  const metrics = LET.map((l, i) => {
    const t = c.measureText(l), L = t.actualBoundingBoxLeft, R = t.actualBoundingBoxRight, A = t.actualBoundingBoxAscent, Dn = t.actualBoundingBoxDescent;
    const cx = (i % COLS + 0.5) * C, cy = (Math.floor(i / COLS) + 0.5) * C;
    c.fillText(l, cx - (R - L) / 2, cy + (A - Dn) / 2);
    return {adv: t.width / fs, bx: (R - L) / 2 / fs, by: (A - Dn) / 2 / fs};   // em units, y up
  });
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
  return {px, W, H, metrics, cellEm: C / fs};
}

// ---------- shaders ----------
const VS = 'attribute vec2 aP;varying vec2 vUv;void main(){vUv=aP*.5+.5;gl_Position=vec4(aP,0.,1.);}';
const SCENE = `precision highp float;
varying vec2 vUv;
uniform sampler2D uAtlas, uPrev;
uniform vec2 uRes, uCenter;
uniform float uZoom, uT, uBeat, uKick, uBass, uHat, uHatN, uBuild, uEnergy, uAA, uSpin, uRun;
uniform vec4 uMode, uLook, uPal, uLet, uFb, uWord;
uniform vec4 uW[6];
const float TAU = 6.2831853;
const float SPR = ${(2 * SPREAD / C).toFixed(5)};
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float glyph(vec2 q, float id) {   // q: cell coords, centre 0, edges +-.5, y up -> distance in cells, + outside
  vec2 o = max(abs(q) - .5, 0.);
  vec2 k = clamp(q, -.5, .5);
  id = floor(id + .5);
  float row = floor(id / 6. + .01), col = id - row * 6.;
  float v = texture2D(uAtlas, (vec2(col, row) + vec2(k.x + .5, .5 - k.y)) / vec2(6., 4.)).r;
  return (.5 - v) * SPR + length(o);
}
vec3 cospal(float t, vec3 a, vec3 b, vec3 c, vec3 d) { return a + b * cos(TAU * (c * t + d)); }
vec3 palN(float t, float n) {
  if (n < .5) return cospal(t, vec3(.55, .32, .32), vec3(.5, .42, .45), vec3(1.), vec3(0., .15, .32));       // ember
  if (n < 1.5) return cospal(t, vec3(.5), vec3(.5), vec3(1.), vec3(0., .33, .67));                          // rainbow
  if (n < 2.5) return cospal(t, vec3(.5), vec3(.5), vec3(2., 1., 0.), vec3(.5, .2, .25));                  // acid
  if (n < 3.5) return cospal(t, vec3(.5), vec3(.5), vec3(1., 1., .5), vec3(.8, .9, .3));                    // violet gold
  return cospal(t, vec3(.32, .26, .42), vec3(.38, .3, .36), vec3(1.), vec3(.6, .55, .75));                 // night
}
vec3 pal(float t) { return mix(palN(t, uPal.x), palN(t, uPal.y), uPal.z); }
vec3 ink(float d, float h, float aa) {   // a letter: striped body, white-hot rim, an aura of contour lines
  float fill = smoothstep(aa, -aa, d);
  float rim = smoothstep(.03 + aa, 0., abs(d));
  float iso = smoothstep(.25, .75, .5 + .5 * cos(d * uPal.w - uT * 5.));
  float aura = exp(-max(d, 0.) * 7.) * iso;
  vec3 body = pal(h + d * 2.5) * (.7 + .45 * cos(d * uPal.w * 1.4 + uT * 3.));
  return body * fill + pal(h + .5 + d * 1.5) * aura * (1. - fill) * .85 + vec3(1., .94, .82) * rim * .7;
}
float centre(vec2 p, float s) { return (mix(glyph(p / s, uLet.x), glyph(p / s, uLet.y), uLet.z) - .045 * sin(3.14159 * uLet.z)) * s; }
float smax(float a, float b, float k) { float h = max(k - abs(a - b), 0.) / k; return max(a, b) + h * h * k * .25; }

vec3 mLiquid(vec2 p) {   // one giant letter breathing, the whole screen its contour lines
  vec2 q = rot(sin(uT * .21) * .25 + uSpin * .2) * p;
  q += .07 * vec2(sin(q.y * 3.7 + uT), cos(q.x * 3.1 - uT * 1.2)) * (.3 + uBass);
  float s = 1.45 + .1 * sin(uT * .5);
  float d = smax(centre(q, s), length(q) - .3 * s, .06 * s);
  float iso = smoothstep(.3, .7, .5 + .5 * cos(d * 30. - uT * 4. - uKick * 2.));
  float fill = smoothstep(uAA, -uAA, d);
  vec3 c = pal(d * 1.3 + uLook.z) * iso * (.25 + .75 * exp(-max(d, 0.) * 1.6));
  c = mix(c, (pal(uLook.z + .5 + d * 5.) * .85 + .3) * (1. + .3 * cos(d * 70. + uT * 6.)), fill);
  return c + vec3(1., .95, .85) * smoothstep(.012 + uAA, 0., abs(d));
}
vec3 mMandala(vec2 p) {   // a kaleidoscope: rings of mirrored letters, one readable letter at the heart
  float r = length(p), a = atan(p.y, p.x) + uSpin;
  float seg = TAU / uMode.w;
  a = mod(a, seg); a = abs(a - .5 * seg);
  vec2 q = r * vec2(cos(a), sin(a));
  float rw = .34;
  float u = q.x / rw - uRun * .5;
  float ri = floor(u);
  float id = mod(ri * 5. + floor(uBeat / 4.) * 3. + 44., 22.);
  float d = glyph(vec2(q.y / rw, fract(u) - .5) * 1.2, id);
  float on = uLet.w < 0. ? 1. : step(id, uLet.w + .5) * .8;
  vec3 c = ink(d, ri * .09 + uLook.z, uAA * 1.2 / rw) * on * smoothstep(.12, .45, r);
  float dc = centre(rot(-uSpin * .5) * p, .9);
  float back = smoothstep(.18, 0., dc);
  c = mix(c, vec3(0.), back * .85);
  return c + ink(dc, uLook.z + .35, uAA / .9) * smoothstep(.12, 0., dc);
}
vec3 mTunnel(vec2 p) {   // log-polar: rings of letters rushing out of the centre (twist makes it a vortex)
  float r = max(length(p), 1e-4), a = atan(p.y, p.x) + uSpin * .6;
  float N = uMode.w, k = N / TAU;
  float u = log(r) * k - uRun;
  float v = a * k + u * uLook.x;
  vec2 cid = floor(vec2(u, v));
  vec2 f = fract(vec2(u, v)) - .5;
  float col = mod(cid.y, N);
  if (mod(col, 2.) > .5) f.x = -f.x;
  float id = mod(cid.x * 3. + col * 7. + floor(uBeat / 2.) + 88., 22.);
  float d = glyph(vec2(f.x, f.y) * 1.25, id);
  vec3 c = ink(d, cid.x * .11 + col * .02 + uLook.z, uAA * 1.25 * k / r);
  c *= smoothstep(.02, .3, r);
  return c + pal(uLook.z + .2) * (.06 + .25 * uKick) / (r * 6. + .15);
}
vec3 mField(vec2 p) {   // a wall of letters morphing in a wave, figure and ground swapping like op-art
  float z = 2.4 - .6 * uBuild;
  vec2 g = rot(uSpin * .35) * p * z;
  g += .22 * vec2(sin(g.y * 1.3 + uT * .7), cos(g.x * 1.1 - uT * .6)) * (.4 + uBass);
  vec2 id = floor(g), f = fract(g) - .5;
  float ph = uBeat * .25 + id.x * .31 + id.y * .17;
  float m = smoothstep(.15, .85, fract(ph));
  float base = floor(ph) + id.x * 3. + id.y * 5. + 220.;
  float d = mix(glyph(f * 1.15, mod(base, 22.)), glyph(f * 1.15, mod(base + 1., 22.)), m);
  float inv = mod(id.x + id.y, 2.);
  vec3 c = ink(d, (id.x + id.y) * .07 + uLook.z, uAA * 1.15 * z);
  vec3 ground = pal(uLook.z + .5 + (id.x - id.y) * .05) * (.35 + .25 * cos(d * uPal.w * .7 - uT * 3.));
  return mix(c, ground * smoothstep(-.01, .02, d) + c * smoothstep(.02, -.01, d) * .4 + vec3(.02), inv * .9);
}
vec3 modeCol(float m, vec2 p) {
  if (m < .5) return mLiquid(p);
  if (m < 1.5) return mMandala(p);
  if (m < 2.5) return mTunnel(p);
  return mField(p);
}
vec3 sparkle(vec2 p) {   // the hats: stars thrown up on every hit
  vec2 g = p * 6.5, id = floor(g), f = fract(g) - .5;
  float h = hash(id + floor(uHatN) * 1.618);
  vec2 o = (vec2(hash(id + 3.1), hash(id + 7.7)) - .5) * .5;
  vec2 d = abs(f - o);
  float s = max(0., 1. - length(f - o) * 10.) + max(0., 1. - d.x * 50.) * max(0., 1. - d.y * 5.) + max(0., 1. - d.y * 50.) * max(0., 1. - d.x * 5.);
  return pal(h * 3. + uT * .2) * s * step(.84, h) * uHat * 1.3;
}
vec3 hueShift(vec3 c, float a) { const vec3 k = vec3(.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1. - ca); }
void main() {
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  vec2 p0 = (vUv - uCenter) * asp * 2. / uZoom;
  vec2 p = p0 * (1. - .07 * uKick);
  p += uBass * .045 * vec2(sin(p.y * 3. + uT * 1.3), sin(p.x * 2.6 - uT * 1.1));
  vec3 c = modeCol(uMode.x, p);
  if (uMode.z > .001) c = mix(c, modeCol(uMode.y, p), uMode.z);
  float l = dot(c, vec3(.299, .587, .114));
  c = mix(vec3(l), c, uLook.w);
  c *= .5 + .5 * uEnergy + .45 * uKick * uEnergy;
  c += sparkle(p0);
  if (uWord.x > .001) {   // the sung word, readable over everything
    vec2 wp = p0 * (1. - .03 * uKick);
    float d = 9.;
    for (int i = 0; i < 6; i++) { vec4 w = uW[i]; if (w.w > -.5) d = min(d, glyph((wp - w.xy) / w.z, w.w) * w.z); }
    float fill = smoothstep(uAA, -uAA, d);
    c = max(c, pal(uWord.y + d * 8. + uT) * fill * uWord.x);
    c += pal(uWord.y + .3) * exp(-max(d, 0.) * 25.) * uWord.z * uWord.x;
  }
  vec2 fd = rot(uFb.y) * ((vUv - uCenter) * asp) * uFb.x;
  vec3 prev = texture2D(uPrev, uCenter + fd / asp).rgb;
  prev = max(hueShift(prev, uFb.w) * uFb.z - .004, 0.);
  gl_FragColor = vec4(max(clamp(c, 0., 1.), prev), 1.);
}`;
const SHOW = `precision highp float;
varying vec2 vUv;
uniform sampler2D uTex, uAtlas;
uniform vec2 uRes, uCenter;
uniform float uKick, uFlash, uFade, uT, uZoom, uAA;
uniform vec4 uWord;
uniform vec4 uW[6];
const float SPR = ${(2 * SPREAD / C).toFixed(5)};
float glyph(vec2 q, float id) {
  vec2 o = max(abs(q) - .5, 0.);
  vec2 k = clamp(q, -.5, .5);
  id = floor(id + .5);
  float row = floor(id / 6. + .01), col = id - row * 6.;
  float v = texture2D(uAtlas, (vec2(col, row) + vec2(k.x + .5, .5 - k.y)) / vec2(6., 4.)).r;
  return (.5 - v) * SPR + length(o);
}
void main() {
  vec2 d = vUv - uCenter;
  float ca = .003 + .012 * uKick;
  vec3 c = vec3(texture2D(uTex, vUv + d * ca).r, texture2D(uTex, vUv).g, texture2D(uTex, vUv - d * ca).b);
  if (uWord.x > .001) {
    vec2 wp = d * vec2(uRes.x / uRes.y, 1.) * 2. / uZoom * (1. - .03 * uKick);
    float wd = 9.;
    for (int i = 0; i < 6; i++) { vec4 w = uW[i]; if (w.w > -.5) wd = min(wd, glyph((wp - w.xy) / w.z, w.w) * w.z); }
    c = mix(c, c * .1, smoothstep(.06, 0., wd) * uWord.x * .85);
    c = mix(c, vec3(1., .96, .88), smoothstep(uAA, -uAA, wd) * uWord.x);
  }
  vec2 e = d * vec2(uRes.x / uRes.y, 1.);
  c *= 1. - .38 * smoothstep(.2, 1.2, dot(e, e));
  c = mix(c, vec3(1., .97, .9), uFlash);
  c += (fract(sin(dot(vUv * uRes + fract(uT) * 91., vec2(12.9898, 78.233))) * 43758.5453) - .5) * .035;
  gl_FragColor = vec4(c * uFade, 1.);
}`;

// ---------- the choreography, bar by bar ----------
// mode: 0 liquid, 1 mandala, 2 tunnel, 3 field · palette: 0 ember, 1 rainbow, 2 acid, 3 violet gold, 4 night
// [first bar, mode, palette, segments, twist, run speed]
const BLOCKS = [
  [0, 0, 4, 6, 0, 0.2],      // intro: the letters arrive one by one
  [12, 1, 4, 8, 0, 0.35],    // they multiply into a mandala
  [17, 2, 3, 12, 0, 0.9],    // riser: the tunnel opens
  [20, 2, 0, 11, 0, 1.4],    // the kick drops
  [28, 2, 2, 7, 0.7, 1.1],   // verse: רוח פראית, a vortex of wind
  [36, 3, 1, 0, 0, 0],       // the field
  [44, 1, 2, 12, 0, 0.6],
  [48, 0, 3, 6, 0, 0.2],     // breakdown: one letter melts into the next
  [52, 1, 0, 16, 0, 0.8],    // verse two
  [60, 2, 1, 22, 0, 1.6],    // hook: פראי, פראי
  [68, 1, 1, 22, 0, 1.0],
  [76, 3, 2, 0, 0, 0],
  [84, 2, 0, 9, 0.9, 1.2],
  [92, 1, 3, 9, 0, 0.7],     // verse three
  [100, 2, 1, 22, 0.35, 1.8],// hook again, everything at once
  [108, 1, 1, 22, 0, 1.1],
  [116, 3, 0, 0, 0, 0],      // outro
  [124, 2, 0, 22, 0, 0.25],  // the last hit
];
const BUILDS = new Set([19, 51, 67, 91, 99, 115]);
const HOOKS = [[60, 76], [100, 116]];
const FB = [[0.992, 0.004, 0.93, 0.02], [1.0, 0.006, 0.9, 0.015], [0.965, 0, 0.86, 0.03], [1.012, -0.003, 0.82, 0.02]];   // zoom, rot, decay, hue per mode

function create(canvas, opts = {}) {
  const font = opts.font || '"Frank Ruhl Libre", "Times New Roman", serif';
  const gl = canvas.getContext('webgl', {antialias: false, alpha: false, depth: false, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance'});
  if (!gl) return null;
  const eng = {ok: false, dur: 0, scale: opts.scale || 1, center: [0.5, 0.5], zoom: 1, word: null, fadeIn: true};   // word: {x, span} in scene units, to keep lyrics clear of page copy
  const prog = fs => {
    const p = gl.createProgram();
    [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]].forEach(([t, s]) => {
      const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(p, sh);
    });
    gl.bindAttribLocation(p, 0, 'aP'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i), k = a.name.replace(/\[0\]$/, ''); u[k] = gl.getUniformLocation(p, a.name); }
    return {p, u};
  };
  const scene = prog(SCENE), show = prog(SHOW);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = (w, h, fmt, data, lin = true) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, fmt, gl.UNSIGNED_BYTE, data);
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, lin ? gl.LINEAR : gl.NEAREST));
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
    return t;
  };
  let atlas = null, metrics = null, cellEm = 1, D = null;
  let fbo = [], ftex = [], fw = 0, fh = 0, ping = 0;
  function targets() {
    const w = Math.max(2, Math.round(canvas.clientWidth * eng.scale)), h = Math.max(2, Math.round(canvas.clientHeight * eng.scale));
    if (opts.size) [canvas.width, canvas.height] = opts.size; else if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (fw === canvas.width && fh === canvas.height) return;
    fw = canvas.width; fh = canvas.height;
    ftex.forEach(t => gl.deleteTexture(t)); fbo.forEach(f => gl.deleteFramebuffer(f));
    ftex = [0, 1].map(() => tex(fw, fh, gl.RGBA, null));
    fbo = ftex.map(t => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return f; });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- analysis ----
  const b64 = s => { const r = atob(s), a = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; };
  const unpack = e => { let acc = 0; return {t: Float64Array.from(e.d, d => (acc += d) / 100), v: e.v.map(x => x / 9)}; };
  const lastLE = (arr, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) lo = m + 1; else hi = m; } return lo - 1; };
  const sm = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
  function layout(word) {   // RTL word -> letter centres in em, centred
    const vis = [...word].reverse().filter(ch => ch in ID);
    let pen = 0; const out = vis.map(ch => { const m = metrics[ID[ch]], o = {id: ID[ch], x: pen + m.bx, y: m.by}; pen += m.adv; return o; });
    out.forEach(o => { o.x -= pen / 2; o.y -= 0.3; });
    return {letters: out, w: pen};
  }

  // ---- per frame: everything the shader needs, from the music at time t ----
  const U = {W: new Float32Array(24)};
  function drive(t, idle) {
    const bf = (t - D.t0) / D.p, bar = bf / 4, B = Math.floor(bar), ph = bar - B;
    const st = {kick: 0, bass: 0.3, hat: 0, hatN: 0, energy: 0.6, build: 0, flash: 0, fade: 1};
    if (idle) {
      const s = t * 0.5;
      Object.assign(st, {mode: [1, 0, 0, 8], twist: 0, pal: [4, 0, sm(0, 1, 0.5 + 0.5 * Math.sin(t * 0.07))], run: t * 0.12, spin: t * 0.05, hue: t * 0.02,
        let: [Math.floor(s) % 22, (Math.floor(s) + 1) % 22, sm(0.55, 1, s % 1), -1], fb: FB[1], energy: 0.55, bass: 0.25 + 0.1 * Math.sin(t)});
      st.beat = s * 2; return st;
    }
    // kick on the grid, with its measured strength
    const n = Math.floor(bf);
    if (n >= 0 && n < D.kick.length) st.kick = D.kick[n] / 255 * Math.exp(-(t - (D.t0 + n * D.p)) / 0.13);
    // bands
    const fi = Math.max(0, t * D.fps), i0 = Math.min(D.frames - 2, Math.floor(fi)), fr = Math.min(1, fi - i0);
    const band = b => (D.bands[i0 * 6 + b] * (1 - fr) + D.bands[(i0 + 1) * 6 + b] * fr) / 255;
    st.bass = sm(0.35, 0.85, band(1) * 0.6 + band(0) * 0.4);
    const hi = sm(0.3, 0.75, (band(4) + band(5)) / 2);
    let k = lastLE(D.hat.t, t);
    if (k >= 0) { st.hat = D.hat.v[k] * Math.exp(-(t - D.hat.t[k]) / 0.07); st.hatN = k; }
    k = lastLE(D.perc.t, t);
    const perc = k >= 0 ? D.perc.v[k] * Math.exp(-(t - D.perc.t[k]) / 0.1) : 0;
    // the block we're in, and the one we're crossing into
    let bi = 0; while (bi + 1 < BLOCKS.length && BLOCKS[bi + 1][0] <= B) bi++;
    const cur = BLOCKS[bi], nxt = BLOCKS[bi + 1], prv = BLOCKS[bi - 1] || cur;
    const xf = nxt ? sm(nxt[0] * 4 - 1, nxt[0] * 4, bf) : 0;
    const palIn = sm(cur[0] * 4, cur[0] * 4 + 4, bf);
    st.mode = [cur[1], nxt ? nxt[1] : cur[1], xf, cur[3] || 8];
    if (xf > 0.5 && nxt) st.mode = [nxt[1], cur[1], 1 - xf, nxt[3] || 8];
    st.pal = [prv[2], cur[2], palIn];
    st.twist = cur[4];
    const hook = HOOKS.some(([a, b]) => B >= a && B < b);
    // builds: the bar before a drop winds up, the downbeat flashes
    if (BUILDS.has(B) || (B >= 17 && B < 20)) st.build = BUILDS.has(B) ? ph : (bar - 17) / 3 * 0.7;
    const sinceDrop = [20, 52, 68, 92, 100, 116].map(b => t - (D.t0 + b * 4 * D.p)).filter(x => x >= 0);
    if (sinceDrop.length) st.flash = Math.max(st.flash, 0.85 * Math.exp(-Math.min(...sinceDrop) / 0.22));
    st.energy = B < 20 ? 0.35 + 0.35 * sm(0, 20, bar) + 0.5 * perc : (B >= 48 && B < 52 ? 0.55 : 0.8 + 0.2 * hi);
    if (hook) st.energy = 1;
    st.run = t * cur[5] + st.build * st.build * 3;
    st.spin = t * (0.06 + 0.04 * hi) + 0.3 * Math.sin(t * 0.11) + st.build * st.build * 2.5;
    st.hue = t * 0.03 + (hook ? Math.floor(bf) * 0.137 : 0) + bi * 0.21;
    st.beat = bf;
    // the centre letter: one per bar in the intro (the aleph-bet arriving), then jumping about
    let L, Lp, m, rev = -1;
    if (B < 12) { L = Math.max(0, B); Lp = Math.max(0, L - 1); m = sm(0, 0.35, ph); rev = L; }
    else if (B < 17) { const s = (bf - 48) / 2; L = Math.min(21, 12 + Math.floor(s)); Lp = Math.max(0, L - 1); m = sm(0, 0.5, s % 1); rev = L; }
    else if (B >= 124) { L = ID['פ']; Lp = L; m = 1; }
    else { const per = hook ? 2 : 4, s = bf / per; L = Math.floor(s) * 7 % 22; Lp = (Math.floor(s) - 1) * 7 % 22; m = sm(0, 0.45, s % 1); }
    st.let = [(Lp + 22) % 22, L, m, rev];
    const f = FB[st.mode[0]];
    st.fb = [f[0] - st.build * 0.03 - st.kick * 0.012, f[1] * (1 + st.build * 4), f[2] + st.build * 0.06, f[3] * (hook ? 2 : 1)];
    if (B >= 124) { const e = t - (D.t0 + 124 * 4 * D.p); st.flash = Math.max(st.flash, Math.exp(-e / 0.3)); st.fade = 1 - sm(0.6, D.dur - (D.t0 + 124 * 4 * D.p) - 0.1, e); st.kick = Math.exp(-e / 0.25); }
    if (eng.fadeIn) st.fade *= sm(0, 1.2, t);
    // the sung words
    st.word = null;
    k = lastLE(D.wt, t);
    if (k >= 0 || B >= 124) {
      let w, tw, life;
      if (B >= 124) { w = 'פראי'; tw = D.t0 + 124 * 4 * D.p; life = 9; }
      else { w = D.words[k][1]; tw = D.wt[k]; const nx = D.wt[k + 1]; life = Math.min(w.startsWith('פרא') || w === 'עכשיו' ? 1.5 : 1.0, nx ? nx - tw : 9); }
      const e = t - tw;
      if (e < life) {
        const big = w.startsWith('פרא') || w === 'עכשיו';
        const amt = sm(0, 0.05, e) * (1 - sm(life - 0.25, life, e));
        if (amt > 0) st.word = {w, e, amt, big};
        if (w === 'עכשיו') st.flash = Math.max(st.flash, 0.5 * Math.exp(-e / 0.15));
      }
    }
    return st;
  }

  function frame(t, dt, o = {}) {
    if (!eng.ok) return;
    targets();
    const st = drive(t, o.idle);
    const reduce = opts.reduce;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[ping]); gl.viewport(0, 0, fw, fh);
    gl.useProgram(scene.p); const u = scene.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlas); gl.uniform1i(u.uAtlas, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ftex[ping ^ 1]); gl.uniform1i(u.uPrev, 1);
    const [cx, cy] = eng.center, zoom = eng.zoom;
    gl.uniform2f(u.uRes, fw, fh); gl.uniform2f(u.uCenter, cx, cy);
    gl.uniform1f(u.uZoom, zoom); gl.uniform1f(u.uAA, 2 / (fh * zoom));
    gl.uniform1f(u.uT, t); gl.uniform1f(u.uBeat, st.beat); gl.uniform1f(u.uKick, st.kick); gl.uniform1f(u.uBass, st.bass);
    gl.uniform1f(u.uHat, reduce ? st.hat * 0.4 : st.hat); gl.uniform1f(u.uHatN, st.hatN); gl.uniform1f(u.uBuild, st.build); gl.uniform1f(u.uEnergy, st.energy);
    gl.uniform1f(u.uSpin, st.spin); gl.uniform1f(u.uRun, st.run);
    gl.uniform4f(u.uMode, ...st.mode); gl.uniform4f(u.uLook, st.twist, 0, st.hue, 1.25 + 0.35 * st.energy);
    gl.uniform4f(u.uPal, ...st.pal, 26 + 10 * st.build); gl.uniform4fv(u.uLet, st.let);
    const fr = Math.min(3, dt * 60);   // feedback tuned at 60 fps, kept the same at any frame rate
    gl.uniform4f(u.uFb, Math.pow(st.fb[0], fr), st.fb[1] * fr, Math.pow(Math.min(0.985, st.fb[2]), fr), st.fb[3] * fr);
    const W = U.W; W.fill(0); for (let i = 0; i < 6; i++) W[i * 4 + 3] = -1;
    if (st.word) {
      const {w, e, amt, big} = st.word, L = layout(w);
      const span = eng.word ? eng.word.span : 2 * (fw / fh) / zoom * 0.84, size = Math.min(big ? 0.62 : 0.4, span / Math.max(1, L.w), eng.word && eng.word.h ? eng.word.h / 1.2 : 9), wx = eng.word ? eng.word.x : 0, wy = eng.word && eng.word.y || 0;
      L.letters.slice(0, 6).forEach((l, i) => {
        const j = L.letters.length - 1 - i;   // right to left, the way it's read
        const pop = 1 + 0.18 * Math.exp(-Math.max(0, e - j * 0.035) / 0.1);
        W[i * 4] = wx + l.x * size * pop; W[i * 4 + 1] = wy + l.y * size * pop + (big ? 0 : -0.05); W[i * 4 + 2] = cellEm * size * pop; W[i * 4 + 3] = e >= j * 0.035 ? l.id : -1;
      });
      gl.uniform4f(u.uWord, amt, st.hue + 0.5, big ? 0.9 : 0.5, 0);
    } else gl.uniform4f(u.uWord, 0, 0, 0, 0);
    gl.uniform4fv(u.uW, W);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(show.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ftex[ping]); gl.uniform1i(show.u.uTex, 0);
    gl.uniform2f(show.u.uRes, canvas.width, canvas.height); gl.uniform2f(show.u.uCenter, cx, cy);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlas); gl.uniform1i(show.u.uAtlas, 1);
    gl.uniform1f(show.u.uZoom, zoom); gl.uniform1f(show.u.uAA, 2 / (fh * zoom)); gl.uniform4fv(show.u.uW, W);
    gl.uniform4f(show.u.uWord, st.word ? st.word.amt : 0, 0, 0, 0);
    gl.uniform1f(show.u.uKick, st.kick); gl.uniform1f(show.u.uFlash, (reduce ? 0.25 : 1) * st.flash); gl.uniform1f(show.u.uFade, st.fade); gl.uniform1f(show.u.uT, t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ping ^= 1;
    eng.last = st;
  }

  eng.frame = frame;
  eng.levels = t => eng.ok ? drive(t, false) : null;
  eng.band = (t, b) => { const fi = Math.max(0, t * D.fps), i0 = Math.min(D.frames - 2, Math.floor(fi)), fr = Math.min(1, fi - i0); return (D.bands[i0 * 6 + b] * (1 - fr) + D.bands[(i0 + 1) * 6 + b] * fr) / 255; };
  eng.reset = () => { fw = 0; };
  eng.ready = (async () => {
    const [d] = await Promise.all([
      fetch(opts.data || 'perai/perai.json').then(r => r.json()),
      document.fonts ? document.fonts.load(`900 100px ${font}`, 'אבגדפראי').catch(() => null) : null,
    ]);
    D = d; D.bands = b64(d.bands); D.frames = D.bands.length / 6; D.kick = b64(d.kick);
    D.hat = unpack(d.hat); D.perc = unpack(d.perc); D.wt = d.words.map(w => w[0]);
    eng.dur = d.dur; eng.t0 = d.t0; eng.p = d.p;
    const A = buildAtlas(font); metrics = A.metrics; cellEm = A.cellEm;
    atlas = tex(A.W, A.H, gl.LUMINANCE, A.px);
    eng.ok = true;
    return eng;
  })();
  return eng;
}
window.Perai = {create, LET};
})();
