/* Otiyot · אותיות: the letters as white fire on black, one scene per letter.
   A heat field is simulated on the GPU: each letter burns as fuel, the flames rise, swirl and cool;
   then the scene turns psychedelic (colour, spiral, spin, expansion) on the music.
   Otiyot.create(canvas, opts) loads a track's analysis; engine.frame(t, dt) draws the moment t seconds in. WebGL2. */
(function () {
'use strict';
const LET = [...'אבגדהוזחטיכלמנסעפצקרשת'];
const C = 128, COLS = 6, ROWS = 4, SPREAD = 20, BOX = C - 2 * (SPREAD + 4);
const NE = 32;   // burning letters at once

// ---------- the aleph-bet as a distance field ----------
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
  c.font = `500 100px ${font}`;
  const ext = Math.max(...LET.map(l => { const t = c.measureText(l); return Math.max(t.actualBoundingBoxLeft + t.actualBoundingBoxRight, t.actualBoundingBoxAscent + t.actualBoundingBoxDescent); }));
  const fs = 100 * BOX / ext;
  c.font = `500 ${fs}px ${font}`; c.fillStyle = '#fff'; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
  LET.forEach((l, i) => {
    const t = c.measureText(l), L = t.actualBoundingBoxLeft, R = t.actualBoundingBoxRight, A = t.actualBoundingBoxAscent, Dn = t.actualBoundingBoxDescent;
    c.fillText(l, (i % COLS + 0.5) * C - (R - L) / 2, (Math.floor(i / COLS) + 0.5) * C + (A - Dn) / 2);
  });
  const a = c.getImageData(0, 0, W, H).data, N = W * H, out = new Float64Array(N), inn = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const al = a[i * 4 + 3] / 255;
    if (al >= 1) { out[i] = 0; inn[i] = 1e20; } else if (al <= 0) { out[i] = 1e20; inn[i] = 0; }
    else { const e = 0.5 - al; out[i] = e > 0 ? e * e : 0; inn[i] = e < 0 ? e * e : 0; }
  }
  edt(out, W, H); edt(inn, W, H);
  const px = new Uint8Array(N);
  for (let i = 0; i < N; i++) px[i] = Math.max(0, Math.min(255, Math.round(255 * (0.5 - (Math.sqrt(out[i]) - Math.sqrt(inn[i])) / (2 * SPREAD)))));
  return {px, W, H};
}

// ---------- shaders ----------
const QUAD = '#version 300 es\nin vec2 aP;out vec2 vUv;void main(){vUv=aP*.5+.5;gl_Position=vec4(aP,0.,1.);}';
const LIB = `
const float SPR = ${(2 * SPREAD / C).toFixed(5)};
uniform sampler2D uAtlas;
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= .5; } return s; }
float glyph(vec2 q, float id) {
  vec2 o = max(abs(q) - .5, 0.), k = clamp(q, -.5, .5);
  id = floor(id + .5);
  float row = floor(id / 6. + .01), col = id - row * 6.;
  return (.5 - texture(uAtlas, (vec2(col, row) + vec2(k.x + .5, .5 - k.y)) / vec2(6., 4.)).r) * SPR + length(o);
}
uniform vec4 uCut;   // a letter's own pieces (letter + 32 * piece): the cut's normal, offset and half width
float letterD(vec2 q, float id) {
  float pt = floor((id + .5) / 32.), d = glyph(q, id - pt * 32.);
  if (pt < .5) return d;
  float sd = dot(q, uCut.xy) - uCut.z;
  return max(d, pt < 1.5 ? uCut.w - sd : pt < 2.5 ? abs(sd) - uCut.w : sd + uCut.w);
}`;
const SIM = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uHeat;
uniform vec2 uRes, uCenter;
uniform float uZoom, uT, uDt, uLetter, uCool;
uniform vec4 uE[${NE}];      // burning letters: x, y, size, turn
uniform vec4 uE2[${NE}];     // and: heat, letter, width (negative mirrors it), crisp core
uniform vec2 uWind;
uniform vec4 uEmit;          // heat, reveal (0 nothing .. 1 whole letter), flicker, -
uniform vec4 uFlow;          // rise, turbulence, swirl, expansion
uniform vec4 uSpark[6];      // embers: x, y, amount, -
${LIB}
out vec4 o;
vec2 curl(vec2 p) {
  float e = .05, n1 = fbm(p + vec2(0, e)), n2 = fbm(p - vec2(0, e)), n3 = fbm(p + vec2(e, 0)), n4 = fbm(p - vec2(e, 0));
  return vec2(n1 - n2, n4 - n3) / (2. * e);
}
void main() {
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  vec2 p = (vUv - uCenter) * asp * 2. / uZoom;
  vec2 u = vec2(0., uFlow.x) + uWind + uFlow.y * curl(p * 2.4 + vec2(0., -uT * .7)) * .35 + uFlow.z * vec2(-p.y, p.x) + uFlow.w * p;
  vec2 b = p - u * uDt;
  float h = texture(uHeat, uCenter + b * uZoom * .5 / asp).r;
  float cool = uCool * (.35 + 1.3 * fbm(p * 3.2 + vec2(0., -uT * 1.6)));   // patchy cooling carves the tongues
  h = max(h * exp(-cool * uDt) - .015 * uDt, 0.);
  float thr = mix(-.03, .002, uEmit.y);                                       // reveal grows the fire out from the spine of the letter
  float n = fbm(p * 7. + vec2(0., -uT * 3.5)), em = 0.;
  for (int i = 0; i < ${NE}; i++) {
    vec4 e = uE[i], f = uE2[i];
    if (e.z <= 0. || f.x <= 0.) continue;
    vec2 q = rot(-e.w) * (p - e.xy) / e.z; q.x /= f.z;
    float d = letterD(q, f.y) * e.z / max(e.z, .2);
    em = max(em, smoothstep(thr + .014, thr - .01, d) * f.x);   // soft enough that a moving letter leaves a flame, not a comb
  }
  em *= uEmit.x * (.8 + .45 * (n - .5) * uEmit.z);
  for (int i = 0; i < 6; i++) { vec4 s = uSpark[i]; vec2 q = p - s.xy; em = max(em, s.z * exp(-dot(q, q) * 9000.)); }
  o = vec4(max(h, em), 0., 0., 1.);
}`;
const SHOW = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uHeat;
uniform vec2 uRes, uCenter;
uniform float uZoom, uT, uPsy, uHue, uKal, uSeg, uFlash, uFade, uKick, uBass, uPx, uLetter, uReveal;
uniform vec3 uTint;
uniform vec4 uE[${NE}];
uniform vec4 uE2[${NE}];
${LIB}
out vec4 o;
vec3 pal(float t) { return .5 + .5 * cos(6.2831 * (t + vec3(0., .33, .67))); }
vec3 white(float h) {   // white fire: black, a cold violet fringe, silver, white
  vec3 c = mix(vec3(0.), vec3(.09, .08, .16), smoothstep(.02, .16, h));
  c = mix(c, vec3(.55, .6, .88), smoothstep(.12, .38, h));
  c = mix(c, vec3(.8, .85, 1.), smoothstep(.3, .65, h));
  return mix(c, vec3(1.05), smoothstep(.75, 1.05, h));
}
vec2 kal(vec2 uv) {     // fold the picture into a mandala
  vec2 asp = vec2(uRes.x / uRes.y, 1.), p = (uv - uCenter) * asp;
  float r = length(p), a = atan(p.y, p.x), seg = 6.2831 / uSeg;
  float af = abs(mod(a + seg * .5, seg) - seg * .5);
  vec2 q = r * vec2(cos(af + 1.5708 - seg * .5), sin(af + 1.5708 - seg * .5));
  return uCenter + mix(p, q, uKal) / asp;
}
void main() {
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  vec2 uv = uCenter + (vUv - uCenter) * (1. - .04 * uKick);
  uv = kal(uv);
  float h = texture(uHeat, uv).r;
  float g = 0.;   // glow: the heat around, blurred
  for (int i = 0; i < 12; i++) { float a = float(i) * 2.399, r = uPx * (6. + 3. * float(i)); g += texture(uHeat, uv + vec2(cos(a), sin(a)) * r / asp * .5).r; }
  g /= 12.;
  vec2 p = (uv - uCenter) * asp * 2. / uZoom;
  float d = 9.;   // the letters: made of fire all the way through, the heat inside them white hot and licked by moving silver
  for (int i = 0; i < ${NE}; i++) {
    vec4 e = uE[i], f = uE2[i];
    if (e.z <= 0. || f.w <= 0.) continue;
    vec2 q = rot(-e.w) * (p - e.xy) / e.z; q.x /= f.z;
    d = min(d, letterD(q, f.y) * e.z / max(e.z, .2) + (1. - f.w) * .08);
  }
  float thr = mix(-.03, 0., uReveal), aa = fwidth(d) * .8 + 1e-4;
  float f1 = fbm(vec2(p.x * 6., p.y * 3. - uT * 2.4)), f2 = fbm(vec2(p.x * 13., p.y * 5. - uT * 4.6));   // flames running up through it
  float body = smoothstep(thr + aa + .006, thr - aa - .014, d + (f1 - .45) * .05);
  h = mix(h, max(h * .7, .28 + .85 * f2 + .3 * f1), body);
  vec3 c = white(h) * mix(vec3(1.), uTint, smoothstep(.95, .2, h)) + vec3(.5, .55, 1.) * uTint * g * .35;
  vec3 psy = pal(h * 1.7 + uHue + atan(p.y, p.x) * .159 + length(p) * .35) * smoothstep(.03, .45, h) * 1.25;
  psy = mix(psy, vec3(1.1), smoothstep(.75, 1., h)) + pal(uHue + .4 + length(p) * .5) * g * .5;
  c = mix(c, psy, uPsy * (1. - .8 * body));   // the colour is in the flames; the letters stay white fire, so they always read
  vec2 e = (vUv - uCenter) * asp;
  c *= 1. - .35 * smoothstep(.3, 1.3, dot(e, e));
  c *= .92 + .16 * uBass;   // the bass itself, as the song plays it
  c = mix(c, vec3(1.), uFlash);
  c += (fract(sin(dot(vUv * uRes + fract(uT) * 91., vec2(12.9898, 78.233))) * 43758.5453) - .5) * .025;
  o = vec4(c * uFade, 1.);
}`;

// ---------- the scenes ----------
const sm = (a, b, x) => { x = Math.min(1, Math.max(0, (x - a) / (b - a))); return x * x * (3 - 2 * x); };
// Aleph, over Pera'i's opening: the percussion-only intro lights it, the riser spins it, the drop makes it psychedelic.
// The same scene at any length: start/end are track seconds, the rest are the beats of the scene in seconds.
function makeAlef(o) {
  const {start, end, ignite, grow, riser, kalIn, kalOut, gather: gat} = o;
  return function alef(t, m) {
    const s = {letter: 0, heat: 0.82, reveal: sm(start + ignite[0], start + ignite[1], t), flicker: 1, cool: 2.9 - 1.1 * sm(grow[0], grow[1], t),
      rise: 0.5, turb: 0.5, swirl: 0, expand: 0, psy: 0, hue: 0, kal: 0, flash: 0, fade: sm(start, start + (o.fadeIn || 0.01), t), E: []};
    const drop = m.drop, b = (t - m.t0) / m.p;   // beats
    s.rise = 0.45 + 0.25 * sm(grow[0], grow[1], t) + 0.35 * m.perc;
    s.turb = 0.45 + 0.3 * sm((grow[0] + grow[1]) / 2, grow[1], t) + 0.6 * m.perc;
    const size = 1.85 * (1 + 0.035 * Math.sin(t * 1.4) * sm((grow[0] + grow[1]) / 2, grow[1], t));
    // the riser: it starts to turn, faster and faster, and the fire swirls with it
    const rs = sm(drop - riser, drop, t), turn = 7 * rs * rs * rs;
    s.swirl = 2.2 * rs * rs;
    s.heat = 0.82 + 0.25 * rs;
    if (t < drop) { s.E.push([0, 0, size, turn]); return s; }
    // the drop: colour, a spiral of burning alephs, a kick that pushes everything out
    const e = t - drop;
    s.flash = 0.9 * Math.exp(-e / 0.25);
    s.psy = sm(0, 0.5, e) * (1 - 0.7 * sm(end - gat[0] + 1, end - gat[1] + 0.2, t));
    s.hue = t * 0.12 + Math.floor(b) * 0.09;
    s.expand = 3.2 * m.kick; s.swirl = 0.9 + 0.5 * Math.sin(e * 0.4);
    s.cool = 1.9; s.rise = 0.25 + 0.25 * m.perc; s.turb = 0.8;
    s.kal = sm(drop + kalIn[0], drop + kalIn[1], t) * (1 - sm(end - kalOut[0], end - kalOut[1], t));
    const gather = sm(end - gat[0], end - gat[1], t);   // at the end it all folds back into one aleph
    s.E.push([0, 0, 1.0 * (1 + 0.08 * m.kick), e * 0.9 + turn]);
    for (let arm = 0; arm < 2; arm++) for (let k = 0; k < 11; k++) {
      const f = (k + (e * 0.55) % 1) / 11, r = (0.5 + 1.3 * f * f) * (1 - gather), a = arm * Math.PI + f * 5.2 + e * 0.7;
      s.E.push([r * Math.cos(a), r * Math.sin(a), (0.16 + 0.42 * f) * (1 - gather) * sm(0, 0.6, e), a + Math.PI / 2]);
    }
    s.fade *= 1 - sm(end - (o.fadeOut || 1.2), end, t);
    return s;
  };
}
const alef = makeAlef({start: 0, end: 54, ignite: [0.8, 7.5], grow: [10, 36], riser: 3.8, kalIn: [7.7, 9.6], kalOut: [4, 2], gather: [4, 1.2]});
// 18 seconds from bar 14 of Pera'i: a new move on every bar before the drop, then the psychedelic half
const alef18post = makeAlef({start: 26.902, end: 44.902, fadeIn: 0.25, ignite: [0.1, 2.2], grow: [28, 37.5], riser: 2.4, kalIn: [2.6, 3.4], kalOut: [2.4, 1.5], gather: [2.3, 0.7], fadeOut: 0.8});
const AL = 0, VAV = 5, YOD = 9;
function alef18(t, m) {
  const s = alef18post(t, m);
  if (t >= m.drop) return s;
  const BAR = 4 * m.p, tau = t - 26.902, k = Math.max(0, Math.min(5, Math.floor(tau / BAR))), f = tau / BAR - k, big = 1.85;
  const rs = sm(m.drop - 2.4, m.drop, t), spin = 7 * rs * rs * rs;
  s.E = [];
  s.tint = [[1, 1, 1], [.85, .93, 1.15], [1.12, 1, .82], [1.02, .88, 1.15], [.9, 1.06, 1.1], [1, 1, 1]][k];
  const echoes = (turn, flip) => m.recent.forEach(([age, v]) => {   // every conga hit throws a ghost of the letter outward
    if (age < 0.9 && v > 0.35) s.E.push([0, 0, big * (1 + age * 0.9), turn, 0.6 * v * (1 - age / 0.9), AL, flip, 0]);
  });
  if (k === 0) { s.E.push([0, 0, big, 0]); return s; }                       // it catches fire
  if (k === 1) { s.zoom = 1 + 0.28 * sm(0, 1, f); s.E.push([0, 0, big, 0]); echoes(0, 1); return s; }   // the camera leans in, the fire echoes
  if (k === 2) {                                                             // it turns over like a coin, the wind catches the flames
    const flip = Math.cos(Math.PI * 2 * sm(0.05, 0.85, f)), fl = Math.sign(flip || 1) * Math.max(0.03, Math.abs(flip));
    s.zoom = 1.28 - 0.28 * sm(0, 0.6, f); s.wind = [1.1 * Math.sin(Math.PI * f), 0];
    s.E.push([0, 0, big, 0, 1, AL, fl, 1]); echoes(0, fl); return s;
  }
  // it comes apart into what an aleph is made of, yod, vav, yod, and they circle and come back
  const g = k === 3 ? sm(0.05, 0.6, f) : 1 - sm(0, 0.6, f);
  const whole = k === 3 ? 1 - sm(0, 0.25, f) : sm(0.5, 0.8, f), parts = 1 - whole;
  const turn = g * Math.PI * 0.5 + (k === 5 ? spin : 0), sep = 1 + 1.2 * g, cs = Math.cos(turn), sn = Math.sin(turn);
  const at = (x, y) => [(x * cs - y * sn) * big * sep, (x * sn + y * cs) * big * sep];
  if (k >= 3 && parts > 0.01) {
    s.E.push([...at(0.15, 0.16), big, turn + g * 2.5, parts, YOD, 1, parts]);
    s.E.push([...at(-0.15, -0.16), big, turn + Math.PI - g * 2.5, parts, YOD, 1, parts]);
    s.E.push([...at(0, 0), big * 0.92, turn + 0.72 + g * 1.2, parts, VAV, 1, parts]);
  }
  s.E.push([0, 0, big, k === 5 ? spin : turn, whole, AL, 1, whole]);
  if (k >= 4) {   // then a ring of alephs gathers round it, and the riser spins it all into the drop
    const ring = k === 4 ? sm(0.55, 1, f) : 1, rr = 0.95 - 0.5 * rs, ra = t * 0.6 + spin * 0.6;
    for (let j = 0; j < 6; j++) { const a = ra + j * Math.PI / 3; s.E.push([rr * Math.cos(a), rr * Math.sin(a), 0.6, a - Math.PI / 2, ring, AL, 1, ring]); }
    s.zoom = 1 - 0.1 * sm(0, 1, k === 4 ? f : 1);
  }
  return s;
}

// ---------- any set: the music as hebrew.house already measures it (kicks, six bands at 5 fps) ----------
const lastLE = (arr, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= t) lo = m + 1; else hi = m; } return lo - 1; };
const hashStr = str => { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const SWELL = 0.08;   // seconds: the fire takes this long to swell, so its push starts that much before the kick and peaks on it
const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
function readViz(v, tempo) {
  const raw = atob(v.bands), q = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) q[i] = raw.charCodeAt(i);
  let acc = 0, K = Array.from(v.beats, d => (acc += d) / 100), bpm = v.bpm;
  if (tempo && bpm > tempo * 1.3) { const gap = 0.8 * 60 / tempo; let prev = -9; K = K.filter(t => t - prev >= gap && (prev = t, true)); bpm = tempo; }   // slow sets: keep only real kicks
  else if (tempo && bpm < tempo * 0.7) bpm *= 2;   // a tracker that heard half time: the kicks are right, the beat is twice as fast
  const nf = q.length / 3, fps = v.fps, P = 60 / bpm;
  const at = (j, b) => j < 0 || j >= nf ? 0 : (b & 1 ? q[j * 3 + (b >> 1)] & 15 : q[j * 3 + (b >> 1)] >> 4) / 15;
  const band = (t, b) => { const f = t * fps - 0.5, i = Math.floor(f), r = f - i; return at(i, b) * (1 - r) + at(i + 1, b) * r; };   // frame i is the sound around (i + .5) / fps
  // the song itself (hh_hits.py): every hit, kicks and bass notes, how hard it lands, and the bass level at 60 fps
  const H = [], HV = []; if (v.hits) { let a = 0; v.hits.forEach((d, i) => { a += d; H.push(a / 1000); HV.push(v.hv[i] / 9); }); }
  const lo = v.lo ? Uint8Array.from(atob(v.lo), ch => ch.charCodeAt(0)) : null, lofps = v.lofps || 60;
  const bass = t => { if (!lo) return band(t, 0); const f = Math.max(0, t * lofps), i = Math.floor(f), r = f - i; return ((lo[i] || 0) * (1 - r) + (lo[i + 1] || 0) * r) / 255; };
  // the grid: every kick, and through the breaks the same pulse carried on, landing on the kick that comes back
  const G = [], R = [];
  if (K.length) for (let x = K[0] - P; x > 0; x -= P) { G.unshift(x); R.unshift(0); }
  K.forEach((k, i) => {
    G.push(k); R.push(1);
    const next = i + 1 < K.length, g = (next ? K[i + 1] : v.len) - k, n = next ? Math.round(g / P) : Math.floor(g / P);
    for (let j = 1; j < n; j++) { G.push(k + (next ? g / n : P) * j); R.push(0); }
  });
  // bars of four, counted again from every kick that comes back after a break (that kick is a downbeat)
  const bars = []; let pos = 0;
  G.forEach((t, i) => {
    const drop = R[i] && i >= 8 && !R.slice(i - 7, i).some(Boolean);
    if (drop) pos = 0;
    if (pos % 4 === 0) bars.push({t, kicks: 0, beats: 0, drop});
    const b = bars[bars.length - 1]; b.kicks += R[i]; b.beats++; pos++;
  });
  bars.forEach((b, i) => {
    const t1 = i + 1 < bars.length ? bars[i + 1].t : v.len; let e = 0, n = 0;
    for (let x = b.t; x < t1; x += 0.2, n++) for (let k = 0; k < 6; k++) e += band(x, k) / 6;
    b.e = n ? e / n : 0; b.groove = b.kicks >= 0.45 * b.beats;   // a kick on every other beat (the tracker can hear half time) is still a groove
  });
  for (let i = 1; i + 1 < bars.length; i++) if (bars[i - 1].groove === bars[i + 1].groove) bars[i].groove = bars[i - 1].groove;   // one odd bar is not a section
  const es = bars.filter(b => b.groove).map(b => b.e).sort((a, b) => a - b);
  return {G, K, P, H, HV, bass, len: v.len, band, bars, barT: bars.map(b => b.t), med: es[es.length >> 1] || 0.5};
}
function vmusic(V, t) {   // what the set is doing at t
  const gi = Math.max(0, lastLE(V.G, t)), p = gi + 1 < V.G.length ? V.G[gi + 1] - V.G[gi] : V.P;
  const bi = Math.max(0, lastLE(V.barT, t)), b1 = bi + 1 < V.barT.length ? V.barT[bi + 1] : V.len;
  const ki = lastLE(V.K, t), kicks = [];
  for (let j = 0; j < 6 && ki - j >= 0; j++) kicks.push(t - V.K[ki - j]);
  const bands = [0, 1, 2, 3, 4, 5].map(b => V.band(t, b)), energy = bands.reduce((a, b) => a + b) / 6;
  const kickAt = V.H.length ? x => {   // the bump: every real hit, as hard as it lands
    let k = 0;
    for (let i = lastLE(V.H, x), j = 0; i >= 0 && j < 4; i--, j++) { const a = x - V.H[i]; if (a > 0.6) break; k = Math.max(k, Math.exp(-a / 0.1) * (0.3 + 0.7 * V.HV[i])); }
    return k;
  } : x => { const i = lastLE(V.K, x); return i >= 0 && x - V.K[i] < 1 ? Math.exp(-(x - V.K[i]) / 0.12) * (0.6 + 0.4 * V.band(V.K[i], 0)) : 0; };
  const kick = kickAt(t), kickA = kickAt(t + SWELL);   // kick: what you see at once; kickA: the push the flames answer a little later
  const groove = V.bars[bi].groove, beatF = Math.min(1, (t - V.G[gi]) / p), sparks = [];
  for (let i = 0, n = gi * 2 + (beatF >= 0.5 ? 1 : 0); i < 6 && n - i >= 0; i++) {   // embers on the eighths, more of them when the air band is full
    const x = n - i, te = V.G[x >> 1] + (x & 1) * p / 2;
    sparks.push([x, t - te, groove ? 0.3 + 0.8 * bands[5] : 0.15 * bands[5]]);
  }
  return {t, p, beatI: gi, beatF, barI: bi, barF: Math.min(1, (t - V.barT[bi]) / (b1 - V.barT[bi])), kick, kicks, bands, energy, level: energy / V.med, groove, sparks, kickA, bass: V.bass(t)};
}
// the set as chapters of four bars: the breaks get the calm moves and build into the kick, the drops turn psychedelic,
// and through a long groove white fire and colour take turns. Planned once from the whole set, so any second can be drawn.
function plan(V, P, seed) {
  const B = V.bars, C = [], rnd = rng(seed);
  let run = [false, 0];
  const seen = [], wt = k => (P.weight && P.weight[k]) || 1, pick = pool => {   // never one of the last two moves again; a letter's own moves come up more
    const o = pool.filter(k => !seen.includes(k)), tot = o.reduce((a, k) => a + wt(k), 0);
    let x = rnd() * tot, k = o.length ? o.find(k => (x -= wt(k)) < 0) || o[o.length - 1] : pool[0];
    seen.push(k); if (seen.length > 2) seen.shift(); return k;
  };
  const chunks = (a, b) => { const out = []; for (let i = a; i < b; i += 4) out.push([i, Math.min(b, i + 4)]); if (out.length > 1 && out[out.length - 1][1] - out[out.length - 1][0] < 2) { const z = out.pop(); out[out.length - 1][1] = z[1]; } return out; };
  const push = (a, b, kind, mood, flash) => C.push({a, b, bars: b - a, t0: B[a].t, t1: b < B.length ? B[b].t : V.len, kind, mood, psy: mood === 'psy', flash: !!flash, r: [rnd(), rnd(), rnd(), rnd()]});
  for (let i = 0; i < B.length;) {
    let j = i; while (j < B.length && B[j].groove === B[i].groove) j++;
    if (!B[i].groove) {
      const build = j < B.length ? Math.min(2, j - i - 1) : 0;
      chunks(i, j - build).forEach(([a, b]) => push(a, b, pick(P.calm), 'calm'));
      if (build > 0) push(j - build, j, 'rise', 'rise');
      run = [false, 0];
    } else chunks(i, j).forEach(([a, b], n) => {
      let e = 0; for (let x = a; x < b; x++) e += B[x].e / (b - a);
      const lv = e / V.med, drop = n === 0 && i > 0;
      const psy = drop || (run[0] ? run[1] < (lv > 1.12 ? 3 : 2) : run[1] >= 2 || lv > 1.02 + (rnd() - 0.5) * 0.16);
      if (psy && !run[0] && !drop && C.length) C[C.length - 1].riseOut = true;   // a white chapter spins up into the colour
      push(a, b, drop ? (seen.push(P.drop), seen.length > 2 && seen.shift(), P.drop) : pick(psy ? P.psy : P.groove), psy ? 'psy' : 'groove', drop || (psy && !run[0]));
      run = run[0] === psy ? [psy, run[1] + 1] : [psy, 1];
    });
    i = j;
  }
  return C;
}
const BASE = () => ({letter: 0, heat: 0.82, reveal: 1, flicker: 1, cool: 2.5, rise: 0.45, turb: 0.5, swirl: 0, expand: 0, psy: 0, hue: 0, kal: 0, seg: 8, flash: 0, fade: 1, zoom: 1, tint: [1, 1, 1], wind: [0, 0], E: []});
const lerp = (a, b, w) => a + (b - a) * w;
function blend(a, b, w) {   // chapter into chapter: every setting slides across, the outgoing letters burn down as the new ones catch
  const s = {...b};
  for (const k in b) if (typeof b[k] === 'number' && typeof a[k] === 'number') s[k] = lerp(a[k], b[k], w);
  s.tint = b.tint.map((x, i) => lerp(a.tint[i], x, w)); s.wind = b.wind.map((x, i) => lerp(a.wind[i], x, w));
  const fade = (e, k) => { const f = [...e]; f[4] = (f[4] ?? 1) * k; f[7] = (f[7] ?? 1) * k; return f; };
  s.E = [...a.E.map(e => fade(e, 1 - w)), ...b.E.map(e => fade(e, w))];
  return s;
}
function director(P, V, C = V.plan) {
  const T = C.map(c => c.t0);
  const look = s => { if (P.tint) s.tint = s.tint.map((x, i) => x * P.tint[i]); return s; };
  const draw = (c, t, m) => {
    const s = BASE(), L = Math.max(0, m.barI - c.a + m.barF);
    P.kinds[c.kind](s, m, c, Math.min(L, c.bars), (t - c.t0));
    s.rise += (s.psy ? 0.25 : 0.35) * (m.kickA ?? m.kick);
    return look(s);
  };
  return function (t, m) {
    if (m.idle) {   // nothing playing: the one letter, breathing
      const s = BASE(); P.kinds.breath(s, m, {r: [0.3, 0.5, 0.5, 0.5], mood: 'calm', bars: 4}, m.life / 2, m.life);
      s.reveal = sm(0.05, 2.2, m.life); return look(s);
    }
    const k = Math.max(0, lastLE(T, t)), c = C[k], prev = C[k - 1];
    let s = draw(c, t, m);
    const lit = t - m.life, kb = lastLE(V.barT, lit + 3), kEnd = kb + 1 < V.barT.length ? V.barT[kb + 1] : V.len;
    const X = c.flash ? 0.35 : (prev && prev.psy && !c.psy ? 4 : 2) * m.p;
    if (prev && t - c.t0 < X && c.t0 > kEnd) s = blend(draw(prev, t, m), s, sm(0, X, t - c.t0));   // never fade out of a chapter the first letter hid
    if (P.kinds.kindle && t < kEnd + 4 * m.p) {   // whenever it starts, one letter lights first, and the set joins on a bar line
      const kin = BASE(); P.kinds.kindle(kin, m, c, 0, m.life); kin.rise += 0.35 * (m.kickA ?? m.kick); look(kin);
      const XK = c.psy ? 0.35 : 2 * m.p;
      if (t < kEnd) s = kin;
      else if (t < kEnd + XK) s = blend(kin, s, sm(kEnd, kEnd + XK, t));
      if (c.psy && t >= kEnd) s.flash = Math.max(s.flash, 0.85 * Math.exp(-(t - kEnd) / 0.25));
    }
    if (c.riseOut) {   // the last bar before the colour: everything starts to turn, faster and faster
      const r = sm(c.t1 - 4 * m.p, c.t1, t), a = 7 * r * r * r * (c.r[0] < 0.5 ? 1 : -1), cs = Math.cos(a), sn = Math.sin(a);
      s.E = s.E.map(e => { const f = [...e]; f[0] = e[0] * cs - e[1] * sn; f[1] = e[0] * sn + e[1] * cs; f[3] = e[3] + a; return f; });
      s.swirl += 2.2 * r * r; s.heat += 0.25 * r;
    }
    if (c.flash) s.flash = Math.max(s.flash, 0.85 * Math.exp(-(t - c.t0) / 0.25));
    s.reveal = Math.min(s.reveal, sm(0.05, 2.2, m.life));   // lit from the spine whenever it starts
    return s;
  };
}

// ---------- the moves every letter can make ----------
// Every move is (s, m, c, L, e): L bars into the chapter, e seconds into it; c.r are the chapter's own dice.
const BIG = 1.85, BT = 1, GML = 2, DLT = 3, HE = 4, YD = 9, NUN = 13, RESH = 19, SHIN = 20, TAV = 21;
const put = (s, x, y, z, turn, heat = 1, letter = AL, width = 1, core = 1) => s.E.push([x, y, z, turn, heat, letter, width, core]);
const side = c => c.r[0] < 0.5 ? 1 : -1;
const psyOn = (s, m, c, e) => {
  s.psy = 1; s.hue = m.t * 0.12 + m.beatI * 0.09 + c.r[2]; s.expand = 3.2 * (m.kickA ?? m.kick); s.swirl = 0.9 + 0.5 * Math.sin(e * 0.4);
  s.cool = 1.9; s.rise = 0.25; s.turb = 0.8;
};
const ghosts = (s, m, LT, fl = 1, tw = 0) => m.kicks.forEach(a => { if (a < 0.9) put(s, 0, 0, BIG * (1 + a * 0.9), tw * a, 0.55 * (1 - a / 0.9), LT, fl, 0); });
const moves = LT => ({
  kindle(s, m, c, L, e) {   // lit from the spine: one letter catching, its fire growing
    const g = sm(0, 3, e); s.heat = 0.7 + 0.15 * g; s.rise = 0.35 + 0.15 * g; s.cool = 2.9 - 0.4 * g;
    put(s, 0, 0, BIG, 0, 1, LT);
  },
  breath(s, m, c, L) {   // it breathes, a breath every two bars; the fire low, the embers drifting
    const br = 0.5 - 0.5 * Math.cos(Math.PI * L);
    s.heat = 0.6 + 0.28 * br; s.rise = 0.3 + 0.15 * br; s.turb = 0.35; s.cool = 3.1 - 0.8 * br; s.zoom = 1 + 0.07 * br;
    s.tint = [0.88 + 0.12 * br, 0.94, 1.12];
    put(s, 0, 0, BIG * (0.96 + 0.06 * br), 0.06 * side(c) * Math.sin(L * 1.3), 1, LT);
  },
  coin(s, m, c, L) {   // it turns over like a coin, once a bar (once every two in a break), the wind catching the flames
    const per = c.mood === 'calm' ? 2 : 1, n = Math.floor(L / per), f = L / per - n, d = (n + (c.r[0] < 0.5 ? 0 : 1)) % 2 ? -1 : 1;
    const turns = c.r[1] < 0.3 && c.mood !== 'calm' ? 2 : 1;
    const flip = Math.cos(Math.PI * 2 * turns * sm(0.05, 0.85, f)), fl = Math.sign(flip || 1) * Math.max(0.03, Math.abs(flip));
    s.wind = [1.1 * d * Math.sin(Math.PI * f), 0]; s.zoom = 1 + 0.12 * Math.sin(Math.PI * f);
    put(s, 0, 0, BIG, 0, 1, LT, fl, 1);
    if (c.mood !== 'calm') ghosts(s, m, LT, fl);
  },
  ring(s, m, c, L) {   // a ring of its own letters gathers round it, turns, breathes on the kick, then falls into it
    const f = L / c.bars, d = side(c), N = 5 + Math.floor(c.r[1] * 4);
    const g = sm(0, 0.3, f), fall = sm(0.82, 1, f), rr = Math.min(0.95, 0.82 * Math.min(...m.view)) * (1 + 0.12 * m.kick) * (1 - 0.85 * fall);
    put(s, 0, 0, BIG * (1 - 0.22 * g * (1 - fall)), 0, 1, LT);
    for (let j = 0; j < N; j++) {
      const a = d * L * Math.PI / 4 + j * 2 * Math.PI / N, w = g * (1 - fall);
      if (w > 0.01) put(s, rr * Math.cos(a), rr * Math.sin(a), 0.6, a - Math.PI / 2, w, LT, 1, w);
    }
    s.tint = [1.1, 1, 0.84]; s.zoom = 1 - 0.08 * g;
  },
  echo(s, m, c, L) {   // the camera leans in and every kick throws a ghost of the letter outward
    const f = L / c.bars;
    s.zoom = 1 + 0.22 * sm(0, 0.5, f) - 0.22 * sm(0.75, 1, f); s.tint = [0.85, 0.93, 1.15];
    put(s, 0, 0, BIG, 0, 1, LT);
    ghosts(s, m, LT, 1, c.r[1] < 0.5 ? 0 : 0.35 * side(c));
  },
  rise(s, m, c, L) {   // the build: it spins faster and faster while the ring closes in
    const r = sm(0, 1, L / c.bars), d = side(c), spin = 7 * r * r * r * d;
    s.swirl = 2.2 * r * r; s.heat = 0.82 + 0.3 * r; s.rise = 0.5 + 0.4 * r; s.turb = 0.5 + 0.4 * r; s.zoom = 1 - 0.1 * r;
    put(s, 0, 0, BIG, spin, 1, LT);
    const rr = Math.min(0.95, 0.82 * Math.min(...m.view)) * (1 - 0.5 * r), w = sm(0, 0.3, r);
    for (let j = 0; j < 6; j++) { const a = spin * 0.6 + L * 0.8 * d + j * Math.PI / 3; put(s, rr * Math.cos(a), rr * Math.sin(a), 0.6, a - Math.PI / 2, w, LT, 1, w); }
  },
  spiral(s, m, c, L, e) {   // colour, and a spiral of burning letters pouring out of it
    psyOn(s, m, c, e); const d = side(c);
    put(s, 0, 0, 1.0 * (1 + 0.08 * m.kick), e * 0.9 * d, 1, LT);
    for (let arm = 0; arm < 2; arm++) for (let k = 0; k < 9; k++) {
      const f = (k + (e * 0.55) % 1) / 9, r = 0.5 + 1.3 * f * f, a = d * (arm * Math.PI + f * 5.2 + e * 0.7);
      put(s, r * Math.cos(a), r * Math.sin(a), 0.16 + 0.42 * f, a + Math.PI / 2, sm(0, 0.15, f) * sm(0, 0.6, e), LT);
    }
  },
  mandala(s, m, c, L, e) {   // the spiral folded into a mandala
    this.spiral(s, m, c, L, e);
    s.kal = 1; s.seg = [6, 8, 12][Math.floor(c.r[3] * 3)];
  },
  warp(s, m, c, L, e) {   // colour, and its letters flying out of it toward you, one step further on every beat
    psyOn(s, m, c, e); s.swirl = 0.25; s.expand = 0.9 * (m.kickA ?? m.kick);
    const d = side(c), N = 12, R = Math.hypot(...m.view), clock = (m.beatI + sm(0, 0.45, m.beatF)) * 0.12;
    put(s, 0, 0, 1.1 * (1 + 0.08 * m.kick), 0.15 * d * Math.sin(e * 0.8), 1, LT);
    for (let k = 0; k < N; k++) {
      const f = (k / N + clock) % 1, a = k * 2.39996 + d * f * 0.5, r = 0.3 + f * f * R * 1.05;
      const w = sm(0, 0.12, f) * sm(1, 0.85, f) * sm(0, 0.6, e), wc = sm(0, 0.12, f) * sm(1, 0.94, f);   // the white body stays almost to the edge
      if (w > 0.01) put(s, r * Math.cos(a), r * Math.sin(a), 0.22 + 0.75 * f * f, 0.2 * Math.sin(a), w, LT, 1, wc);
    }
  },
  field(s, m, c, L, e) {   // a lattice of the letter, upside down and right way up, turning over in a wave every bar
    psyOn(s, m, c, e); s.psy = 0.85; s.expand = 1.2 * (m.kickA ?? m.kick); s.swirl = 0; s.rise = 0.2;
    const [vx, vy] = m.view, sp = 0.62, cols = Math.max(2, Math.round(2 * vx / sp)), rows = Math.max(2, Math.round(2 * vy / sp));
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      if (s.E.length >= 20) break;
      const ph = L - (c.r[1] < 0.5 ? (i + j) / (cols + rows) : Math.hypot(i - (cols - 1) / 2, j - (rows - 1) / 2) / Math.hypot(cols / 2, rows / 2)) * 0.8;
      const fl = Math.cos(2 * Math.PI * sm(0, 0.6, ph - Math.floor(ph)));
      put(s, (i - (cols - 1) / 2) * sp, (j - (rows - 1) / 2) * sp, sp * 1.25 * (1 + 0.1 * m.kick), (i + j) % 2 ? Math.PI : 0, 1, LT, Math.sign(fl || 1) * Math.max(0.05, Math.abs(fl)), 1);
    }
  },
});

// ---------- Aleph · א: white fire, the one that is made of three ----------
const ALEF = {
  calm: ['breath', 'coin', 'split', 'ring'],
  groove: ['echo', 'coin', 'split', 'ring'],
  psy: ['spiral', 'mandala', 'warp', 'field'],
  drop: 'spiral',
  weight: {split: 2.5},
  // the aleph's diagonal (its vav) in glyph cell units, measured from the Frank Ruhl Libre atlas, and each piece's middle,
  // which way it slides out along the cut and how far it tumbles: the yod above, the vav, the yod below
  cut: [0.7771, 0.6293, -0.002, 0.043],
  pieces: [[0.0859, 0.1239, 1, 2.5], [-0.0042, 0.0019, 0, 1.2], [-0.1055, -0.1121, -1, -2.5]],
  kinds: {
    ...moves(AL),
    split(s, m, c, L) {   // it comes apart into what an aleph is made of, its own yod, vav and yod; they circle once and fit back together
      const f = L / c.bars, d = side(c), [nx, ny] = ALEF.cut;
      const g = sm(0.04, 0.3, f) * (1 - sm(0.72, 0.94, f)), turn = d * 2 * Math.PI * sm(0.12, 0.92, f), cs = Math.cos(turn), sn = Math.sin(turn);
      ALEF.pieces.forEach(([cx, cy, out, spin], k) => {
        const sep = (0.2 + 0.03 * m.kick) * g * out, tx = cx + nx * sep, ty = cy + ny * sep, Z = BIG * (1 - 0.15 * g);   // the piece's middle slides out along the cut
        const w = turn + d * spin * 0.6 * g, cw = Math.cos(w), sw = Math.sin(w);
        put(s, (tx * cs - ty * sn - (cx * cw - cy * sw)) * Z, (tx * sn + ty * cs - (cx * sw + cy * cw)) * Z, Z, w, 1, AL + 32 * (k + 1));
      });
      s.tint = [0.9, 1.02, 1.12];
    },
  },
};

// ---------- Bet · ב: gold fire, the house, the first letter of the Torah ----------
const BET = {
  calm: ['house', 'bereshit', 'twins', 'breath'],
  groove: ['door', 'house', 'twins', 'bereshit', 'echo'],
  psy: ['spiral', 'mandala', 'warp', 'field'],
  drop: 'warp',
  weight: {house: 2.5, bereshit: 2, door: 1.5},
  tint: [1.7, 1.15, 0.35],   // the white fire burns gold at its edges: a lit house
  // the bet as the atlas draws it, in glyph cell units: its ink box and the middle of its open room
  box: [-0.1523, -0.2227, 0.1523, 0.2383], hollow: [-0.0243, -0.0187],
  kinds: {
    ...moves(BT),
    house(s, m, c, L) {   // in through the open side of the house, to the house inside it, and the one inside that
      const [hx, hy] = BET.hollow, K = 0.38, ph = L / c.bars;
      s.heat = 0.75; s.rise = 0.35; s.turb = 0.4; s.cool = 2.8;
      for (let n = -1; n < 3; n++) {
        const q = n - ph, Z = BIG * Math.pow(K, q), w = sm(-1, -0.45, q) * sm(3, 2, q);
        if (w > 0.01 && Z < 9) put(s, -hx * Z, -hy * Z, Z, 0, w, BT, 1, w);
      }
    },
    twins(s, m, c, L) {   // two: the house and its mirror, apart, circling each other, then one again
      const f = L / c.bars, g = sm(0.05, 0.3, f) * (1 - sm(0.75, 0.95, f)), d = side(c), per = c.mood === 'calm' ? 2 : 1;
      const a = d * Math.PI * L / per, r = 0.5 * Math.min(...m.view) * g * (1 + 0.1 * m.kick), Z = BIG * (1 - 0.32 * g);
      put(s, r * Math.cos(a), r * Math.sin(a), Z, 0.15 * g * Math.sin(a), 1, BT);
      put(s, -r * Math.cos(a), -r * Math.sin(a), Z, -0.15 * g * Math.sin(a), g, BT, -1, g);
    },
    bereshit(s, m, c, L) {   // the first word of the Torah written out of the bet, a letter at a time, right to left, then gathered back into it
      const W = [BT, RESH, AL, SHIN, YD, TAV], n = W.length, beats = L * 4, B = c.bars * 4, per = c.mood === 'calm' ? 2 : 1;
      const sz = Math.min(0.8, 2 * m.view[0] * 0.9 / (n * 0.36)), gap = sz * 0.36, x0 = (n - 1) / 2 * gap;
      const tin = sm(0, 1, beats), tout = sm(B - 4, B - 1, beats);
      s.heat = 0.8; s.rise = 0.4;
      W.forEach((LT, k) => {
        const slot = x0 - k * gap, x = k ? slot * (1 - 0.8 * tout) : slot * tin * (1 - tout);
        const w = k ? sm(k * per, k * per + 0.8, beats) * (1 - sm(B - 4, B - 2.5, beats)) : 1;
        const z = k ? sz : lerp(lerp(BIG, sz, tin), BIG, tout);
        if (w > 0.01) put(s, x, 0, z, 0, w, LT, 1, w);
      });
    },
    door(s, m, c, L) {   // the house's door swings open on the bar and shuts on the next, on a hinge at its right edge
      const n = Math.floor(L), f = L - n, hx = BET.box[2];
      const op = n % 2 ? 1 - sm(0.05, 0.7, f) : sm(0.05, 0.7, f), wd = Math.cos(Math.PI * op), fl = Math.sign(wd || 1) * Math.max(0.03, Math.abs(wd));
      s.wind = [0.8 * Math.sin(Math.PI * op) * (n % 2 ? 1 : -1), 0]; s.zoom = 1 + 0.08 * Math.sin(Math.PI * op);
      put(s, BIG * hx * (1 - fl), 0, BIG, 0, 1, BT, fl, 1);
      ghosts(s, m, BT, fl);
    },
  },
};
// ---------- Gimel · ג: copper-green fire, the camel, the dreidel, the one who runs to give ----------
const GIMEL = {
  calm: ['caravan', 'dreidel', 'three', 'breath'],
  groove: ['dreidel', 'run', 'three', 'caravan', 'echo'],
  psy: ['whirl', 'mandala', 'warp', 'field'],
  drop: 'whirl',
  weight: {dreidel: 3, run: 2.5, caravan: 1.5},
  tint: [0.55, 1.4, 0.75],   // copper burns green
  kinds: {
    ...moves(GML),
    dreidel(s, m, c, L) {   // a dreidel of gimel: it spins fast, then slower, wobbling, and comes to rest facing you
      const f = L / c.bars, spins = c.mood === 'calm' ? 4 : 8, u = sm(0, 0.92, f), ang = Math.PI * spins * (1 - (1 - u) * (1 - u));
      const wd = Math.max(0.03, Math.abs(Math.cos(ang)));
      const tilt = 0.22 * Math.sin(Math.PI * u) * Math.sin(ang * 0.5);
      s.swirl = 0.5 * Math.sin(Math.PI * u); s.zoom = 1 + 0.06 * Math.sin(Math.PI * u);
      put(s, 0, 0, BIG * (1 + 0.04 * m.kick), tilt, 1, GML, wd, 1);
    },
    run(s, m, c, L) {   // gimel runs after dalet to give: it bounds across to the dalet a hop a bar, and they burn as one
      const [vx] = m.view, Z = BIG * 0.7, hops = Math.max(1, c.bars - 1), n = Math.floor(L), hf = L - n;
      const xD = -vx * 0.35, xEnd = xD + Z * 0.42, x0 = vx + 0.35, step = (x0 - xEnd) / hops;   // in from beyond the right edge
      const k = Math.min(hops, n + sm(0.05, 0.6, hf)), hop = n < hops ? Math.sin(Math.PI * sm(0.05, 0.6, hf)) : 0;
      const arrive = sm(hops, hops + 0.5, L);
      s.heat = 0.82 + 0.25 * arrive; s.rise = 0.45 + 0.3 * arrive;
      put(s, xD, 0, Z, 0, 0.8 + 0.3 * arrive, DLT);
      put(s, x0 - step * k, 0.42 * hop, Z, 0.22 * hop, 1, GML);
    },
    caravan(s, m, c, L, e) {   // a caravan, gimels walking the dunes, swaying on the beat, flames trailing in the wind
      const [vx, vy] = m.view, N = 6, span = 2 * vx + 0.9, gap = span / N, v = c.mood === 'calm' ? 0.16 : 0.28, y0 = -vy * 0.3;
      s.wind = [0.5, 0]; s.rise = 0.3; s.turb = 0.45; s.heat = 0.78;
      for (let k = 0; k < N; k++) {
        const x = span / 2 - ((k * gap + e * v) % span), w = sm(span / 2, span / 2 - 0.35, Math.abs(x));
        const sway = c.mood === 'calm' ? Math.sin(e * 2.4 + k) : Math.sin(Math.PI * (m.beatI + m.beatF + k * 0.5));
        if (w > 0.01) put(s, x, y0 + 0.05 * Math.abs(sway), 0.6, 0.08 * sway, w, GML, 1, w);
      }
      put(s, 0, vy * 0.32, BIG * 0.8, 0, 0.55, GML, 1, 0.4);   // and the big one rising over them, like the moon
    },
    three(s, m, c, L) {   // gimel is three: three of them in a triangle, and on every bar the next one turns over
      const f = L / c.bars, n = Math.floor(L), d = side(c), g = sm(0, 0.3, f) * (1 - sm(0.85, 1, f));
      const rot = d * 0.1 * L, r = 0.6 * Math.min(...m.view) * g * (1 + 0.06 * m.kick), Z = BIG * (1 - 0.5 * g);
      for (let j = 0; j < 3; j++) {
        const a = rot + j * 2 * Math.PI / 3 + Math.PI / 2, w = j ? g : 1, fl = n % 3 === j ? Math.cos(2 * Math.PI * sm(0.05, 0.7, L - n)) : 1;
        if (w > 0.01) put(s, r * Math.cos(a), r * Math.sin(a) - r * 0.2, Z, 0, w, GML, Math.sign(fl || 1) * Math.max(0.04, Math.abs(fl)), w);
      }
      s.tint = [0.95, 1.05, 1];
    },
    whirl(s, m, c, L, e) {   // colour, and a whirlwind of dreidels: three arms of spinning gimels pouring out of the one in the middle
      psyOn(s, m, c, e); const d = side(c);
      put(s, 0, 0, 1.0 * (1 + 0.08 * m.kick), 0, 1, GML, 0.35 + 0.65 * Math.abs(Math.cos(e * 3)));
      for (let arm = 0; arm < 3; arm++) for (let k = 0; k < 6; k++) {
        const f = (k + (e * 0.55) % 1) / 6, r = 0.45 + 1.3 * f * f, a = d * (arm * 2 * Math.PI / 3 + f * 4.5 + e * 0.8);
        put(s, r * Math.cos(a), r * Math.sin(a), 0.18 + 0.4 * f, a + Math.PI / 2, sm(0, 0.15, f) * sm(0, 0.6, e), GML, 0.4 + 0.6 * Math.abs(Math.cos(e * 3 + k * 1.3 + arm)));
      }
    },
    mandala(s, m, c, L, e) {   // the whirlwind folded into a mandala
      this.whirl(s, m, c, L, e);
      s.kal = 1; s.seg = [6, 12][Math.floor(c.r[3] * 2)];
    },
  },
};
// ---------- Dalet · ד: lapis fire, the door, the four corners, the humble one who receives ----------
const R2 = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const DALET = {
  calm: ['four', 'bow', 'receive', 'breath'],
  groove: ['four', 'steps', 'bow', 'receive', 'echo'],
  psy: ['compass', 'mandala', 'warp', 'field'],
  drop: 'compass',
  weight: {four: 3, steps: 2, bow: 1.5},
  tint: [0.6, 0.9, 1.7],   // lapis: the fire burns blue at its edges
  // the dalet as the atlas draws it, in glyph cell units: its ink box; its corner is the top right, its foot the bottom right
  box: [-0.1445, -0.2305, 0.1445, 0.2383],
  kinds: {
    ...moves(DLT),
    four(s, m, c, L) {   // four dalets, corner out, close into one square (dalet is four: the four corners of the world), and the square turns a quarter on the bar
      const f = L / c.bars, d = side(c), per = c.mood === 'calm' ? 2 : 1, n = Math.floor(L / per);
      const Z = BIG * 0.62, [, , cx, cy] = DALET.box, g = sm(0, 0.35, f) * (1 - sm(0.85, 1, f));
      const S = lerp(0.38 * Z + 0.42 * Math.min(...m.view), 0.38 * Z, g) * (1 + 0.05 * m.kick), turn = d * Math.PI / 2 * (n + sm(0.1, 0.6, L / per - n));
      for (let k = 0; k < 4; k++) {
        const a = turn + k * Math.PI / 2, w = k ? sm(0, 0.25, f) * (1 - sm(0.9, 1, f)) : 1, [x, y] = R2(S - cx * Z, S - cy * Z, a);
        if (w > 0.01) put(s, x, y, Z, a, w, DLT, 1, w);
      }
      s.zoom = 1 - 0.06 * g; s.tint = [0.95, 1, 1.1];
    },
    steps(s, m, c, L) {   // a stair of dalets going down, the next step lit on every beat: dalet lowers itself
      const [vx, vy] = m.view, N = 5, [x0, y0, x1, y1] = DALET.box;
      const Z = Math.min(BIG * 0.6, 1.5 * vx / ((x1 - x0) * (N - 1) + 0.4), 1.5 * vy / ((y1 - y0) * 0.75 * (N - 1) + 0.5));   // big, and the whole stair in view
      const dx = -(x1 - x0) * Z * 1.05, dy = -(y1 - y0) * Z * 0.75, beats = L * 4, per = (c.bars * 4 - 1) / N;
      const sx = -dx * (N - 1) / 2, sy = -dy * (N - 1) / 2;
      s.heat = 0.8; s.rise = 0.4;
      for (let k = 0; k < N; k++) {
        const on = sm(k * per, k * per + 0.4, beats) * (1 - sm(c.bars * 4 - 1, c.bars * 4, beats)), hit = Math.exp(-Math.max(0, beats - k * per) * 2.2);
        if (on > 0.01) put(s, sx + k * dx, sy + k * dy, Z * (1 + 0.12 * hit), 0, on, DLT, 1, on);
      }
      s.zoom = 1 + 0.04 * Math.sin(Math.PI * L / c.bars);
    },
    bow(s, m, c, L) {   // it bows on its foot, low, on the bar, and rises again
      const per = c.mood === 'calm' ? 2 : 1, n = Math.floor(L / per), f = L / per - n, [, y0, x1] = DALET.box;
      const a = 0.42 * Math.sin(Math.PI * sm(0.05, 0.75, f)), [fx, fy] = [x1 * BIG, y0 * BIG], [rx, ry] = R2(fx, fy, a);
      s.wind = [-0.5 * a, 0]; s.heat = 0.82 - 0.12 * a; s.zoom = 1 + 0.05 * a;
      put(s, fx - rx, fy - ry, BIG, a, 1, DLT);
      if (c.mood !== 'calm') ghosts(s, m, DLT, 1, 0.25 * a);
    },
    receive(s, m, c, L) {   // the gimel runs to it with something to give: it arrives, and the dalet burns brighter for it
      const [vx] = m.view, ZD = BIG * 0.85, ZG = BIG * 0.5, hops = Math.max(1, c.bars - 1), n = Math.floor(L), hf = L - n;
      const xD = -vx * 0.18, xEnd = xD + ZD * 0.33 + ZG * 0.2, x0 = vx + 0.3, step = (x0 - xEnd) / hops;
      const k = Math.min(hops, n + sm(0.05, 0.6, hf)), hop = n < hops ? Math.sin(Math.PI * sm(0.05, 0.6, hf)) : 0, got = sm(hops, hops + 0.5, L);
      s.heat = 0.78 + 0.3 * got; s.rise = 0.42 + 0.3 * got;
      put(s, xD, 0, ZD * (1 + 0.08 * got), 0, 0.85 + 0.3 * got, DLT);
      put(s, x0 - step * k, -ZD * 0.12 + 0.35 * hop, ZG, 0.2 * hop, 1 - 0.5 * got, GML);
    },
    compass(s, m, c, L, e) {   // colour, and four arms of dalets pouring out of it, one to each corner of the world
      psyOn(s, m, c, e); const d = side(c);
      put(s, 0, 0, 1.0 * (1 + 0.08 * m.kick), d * Math.PI / 2 * Math.floor(m.beatI / 4), 1, DLT);
      for (let arm = 0; arm < 4; arm++) for (let k = 0; k < 6; k++) {
        const f = (k + (e * 0.55) % 1) / 6, r = 0.45 + 1.3 * f * f, a = d * (arm * Math.PI / 2 + f * 4 + e * 0.6);
        put(s, r * Math.cos(a), r * Math.sin(a), 0.18 + 0.4 * f, a - Math.PI / 4, sm(0, 0.15, f) * sm(0, 0.6, e), DLT);
      }
    },
    mandala(s, m, c, L, e) {   // the compass folded into a mandala of four and eight
      this.compass(s, m, c, L, e);
      s.kal = 1; s.seg = [4, 8][Math.floor(c.r[3] * 2)];
    },
  },
};
// ---------- Heh · ה: rose fire, the breath, the window, the letter the world was made with ----------
const HEH = {
  calm: ['exhale', 'leg', 'five', 'breath'],
  groove: ['leg', 'five', 'exhale', 'echo', 'ring'],
  psy: ['bloom', 'mandala', 'warp', 'field'],
  drop: 'bloom',
  weight: {leg: 3, exhale: 2, five: 1.5},
  tint: [1.6, 0.75, 1.15],   // the fire burns rose at its edges
  // the heh as the atlas draws it, in glyph cell units: its loose left leg sits where dot(q, cut.xy) > cut.z
  // (the widest straight gap between it and the roof, measured by glyphs.mjs); the leg's middle
  cut: [-0.8192, -0.5736, 0.0627, 0], leg: [-0.1173, -0.1104],
  kinds: {
    ...moves(HE),
    leg(s, m, c, L) {   // its loose leg steps away from the roof on the bar and comes back: the opening a person can always return through
      const per = c.mood === 'calm' ? 2 : 1, n = Math.floor(L / per), f = L / per - n, d = n % 2 ? 1 : -1, [nx, ny] = HEH.cut, [lx, ly] = HEH.leg;
      const g = sm(0.03, 0.32, f) * (1 - sm(0.62, 0.92, f)), sep = (0.16 + 0.03 * m.kick) * g, w = d * 0.35 * g;
      const [rx, ry] = R2(lx * BIG, ly * BIG, w);
      put(s, 0, 0, BIG, 0, 1, HE + 96);   // the roof and the right leg
      put(s, lx * BIG - rx + nx * sep * BIG, ly * BIG - ry + ny * sep * BIG + 0.12 * Math.sin(Math.PI * g) * BIG * 0.2, BIG, w, 1, HE + 32);
      s.tint = [1, 0.96, 1.05]; s.zoom = 1 + 0.04 * g;
    },
    exhale(s, m, c, L) {   // it breathes out, a breath every two bars, and small hehs leave through its open floor and rise away on the fire
      const br = 0.5 - 0.5 * Math.cos(Math.PI * L), out = Math.max(0, Math.sin(Math.PI * L)), d = side(c), N = 9, [vx, vy] = m.view;
      s.heat = 0.62 + 0.25 * br; s.rise = 0.35 + 0.2 * out; s.turb = 0.35; s.cool = 3 - 0.7 * br; s.zoom = 1 + 0.06 * br;
      put(s, 0, 0, BIG * (0.95 + 0.07 * br), 0, 1, HE);
      for (let k = 0; k < N; k++) {
        const u = (L / 2 + k / N) % 1, sx = k % 2 ? 1 : -1, x = (0.02 + sx * 0.9 * vx * u * (0.5 + 0.5 * ((k * 0.37) % 1))) * 1, y = -0.42 * BIG - 0.5 * u + 1.9 * vy * u * u;
        const w = sm(0, 0.12, u) * sm(1, 0.7, u) * sm(0, 0.5, L);
        if (w > 0.01) put(s, x, y, 0.28 + 0.12 * (1 - u), d * sx * 0.6 * u, w, HE, 1, w);
      }
    },
    five(s, m, c, L) {   // heh is five: five of them round a circle, turning, and on every bar the next one turns over
      const f = L / c.bars, n = Math.floor(L), d = side(c), g = sm(0, 0.3, f) * (1 - sm(0.85, 1, f));
      const rot = d * 0.12 * L, r = 0.62 * Math.min(...m.view) * g * (1 + 0.06 * m.kick), Z = BIG * (1 - 0.6 * g);
      for (let j = 0; j < 5; j++) {
        const a = rot + j * 2 * Math.PI / 5 + Math.PI / 2, w = j ? g : 1, fl = n % 5 === j ? Math.cos(2 * Math.PI * sm(0.05, 0.7, L - n)) : 1;
        if (w > 0.01) put(s, r * Math.cos(a), r * Math.sin(a), Z, 0, w, HE, Math.sign(fl || 1) * Math.max(0.04, Math.abs(fl)), w);
      }
    },
    bloom(s, m, c, L, e) {   // colour, and a flower of five petals: arms of hehs opening out of the one in the middle
      psyOn(s, m, c, e); const d = side(c);
      put(s, 0, 0, 1.0 * (1 + 0.08 * m.kick), 0.12 * d * Math.sin(e * 0.7), 1, HE);
      for (let arm = 0; arm < 5; arm++) for (let k = 0; k < 5; k++) {
        const f = (k + (e * 0.5) % 1) / 5, r = 0.45 + 1.25 * f * f, a = d * (arm * 2 * Math.PI / 5 + f * 2.6 + e * 0.45);
        put(s, r * Math.cos(a), r * Math.sin(a), 0.2 + 0.4 * f, a - Math.PI / 2, sm(0, 0.15, f) * sm(0, 0.6, e), HE);
      }
    },
    mandala(s, m, c, L, e) {   // the flower folded into a mandala of five and ten
      this.bloom(s, m, c, L, e);
      s.kal = 1; s.seg = [5, 10][Math.floor(c.r[3] * 2)];
    },
  },
};
const PROGRAMS = {alef: ALEF, bet: BET, gimel: GIMEL, dalet: DALET, heh: HEH};

function create(canvas, opts = {}) {
  const font = opts.font || '"Frank Ruhl Libre", "Times New Roman", serif';
  const gl = canvas.getContext('webgl2', {antialias: false, alpha: false, depth: false, preserveDrawingBuffer: !!opts.preserve, powerPreference: 'high-performance'});
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
  const eng = {ok: false, cut: [0, 0, 0, 0], scale: opts.scale || 1, center: [0.5, 0.5], zoom: 1, scene: opts.scene || alef, end: opts.end || 54};
  const prog = fs => {
    const p = gl.createProgram();
    [[gl.VERTEX_SHADER, QUAD], [gl.FRAGMENT_SHADER, fs]].forEach(([t, s]) => {
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
  const sim = prog(SIM), show = prog(SHOW);
  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = (w, h, ifmt, fmt, type, data) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data);
    [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR));
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
    return t;
  };
  let heat = [], hfb = [], hw = 0, hh = 0, cur = 0, atlas = null, D = null;
  function targets() {
    const w = Math.max(2, Math.round(canvas.clientWidth * eng.scale)), h = Math.max(2, Math.round(canvas.clientHeight * eng.scale));
    if (opts.size) [canvas.width, canvas.height] = opts.size; else if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const sw = Math.round(canvas.width * 0.75), sh = Math.round(canvas.height * 0.75);
    if (sw === hw && sh === hh) return;
    hw = sw; hh = sh;
    heat.forEach(t => gl.deleteTexture(t));
    heat = [0, 1].map(() => tex(hw, hh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null));
    hfb = heat.map(t => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return f; });
  }
  const b64 = s => { const r = atob(s), a = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; };
  const unpack = e => { let acc = 0; return {t: Float64Array.from(e.d, d => (acc += d) / 100), v: e.v.map(x => x / 9)}; };
  function music(t) {   // what the track is doing at t
    const m = {t0: D.t0, p: D.p, kick: 0, perc: 0, hat: 0, hatN: -1, drop: D.drop, end: eng.end};
    const n = Math.floor((t - D.t0) / D.p);
    if (n >= 0 && n < D.kick.length) m.kick = D.kick[n] / 255 * Math.exp(-(t - (D.t0 + n * D.p)) / 0.12);
    let k = lastLE(D.perc.t, t); if (k >= 0) m.perc = D.perc.v[k] * Math.exp(-(t - D.perc.t[k]) / 0.12);
    m.recent = []; for (let j = 0; j < 6 && k - j >= 0; j++) m.recent.push([t - D.perc.t[k - j], D.perc.v[k - j]]);
    k = lastLE(D.hat.t, t); if (k >= 0) { m.hat = D.hat.v[k] * Math.exp(-(t - D.hat.t[k]) / 0.08); m.hatN = k; }
    m.sparks = []; for (let i = 0; i < 6 && k - i >= 0; i++) m.sparks.push([k - i, t - D.hat.t[k - i], D.hat.v[k - i]]);
    return m;
  }
  const EU = new Float32Array(NE * 4), EU2 = new Float32Array(NE * 4), SU = new Float32Array(24), EP = new Float32Array(NE * 4), EP2 = new Float32Array(NE * 4), EI = new Float32Array(NE * 4);
  function frame(t, dt) {
    if (!eng.ok || !D) return;
    targets();
    if (eng.lastT == null || Math.abs(t - eng.lastT - dt) > 0.5) eng.lit = t;   // a start or a seek lights it again
    eng.lastT = t;
    const fit = D.V ? Math.min(1, 0.35 + 0.48 * canvas.width / canvas.height) : 1, z0 = eng.zoom * fit;
    const m = D.V ? vmusic(D.V, t) : music(t);
    m.life = t - eng.lit; m.view = [canvas.width / canvas.height / z0, 1 / z0]; m.idle = !!eng.idle;
    const s = eng.scene(t, m);
    if (s.E.length > NE) s.E.sort((a, b) => (b[4] ?? 1) - (a[4] ?? 1));
    EU.fill(0); EU2.fill(0);
    s.E.slice(0, NE).forEach((e, i) => { EU.set(e.slice(0, 4), i * 4); EU2.set([e[4] ?? 1, e[5] ?? s.letter, e[6] || 1, e[7] ?? 1], i * 4); });
    SU.fill(0);   // embers thrown up on the hats, from somewhere on the letter
    m.sparks.slice(0, 6).forEach(([k, age, v], i) => {
      const h1 = Math.sin(k * 91.7) * 0.5 + 0.5, h2 = Math.sin(k * 37.3) * 0.5 + 0.5;
      SU.set([(h1 - 0.5) * 0.7, (h2 - 0.4) * 0.8 + age * 0.6, v * Math.exp(-age / 0.25) * 1.2 * s.reveal, 0], i * 4);
    });
    const zoom = z0 * (s.zoom || 1), [cx, cy] = eng.center;
    const steps = dt > 0 ? Math.min(6, Math.ceil(dt * 90 - 0.01)) : 0, h = steps ? dt / steps : 0;
    gl.useProgram(sim.p); let u = sim.u;
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlas); gl.uniform1i(u.uAtlas, 1);
    gl.uniform2f(u.uRes, hw, hh); gl.uniform2f(u.uCenter, cx, cy); gl.uniform1f(u.uZoom, zoom); gl.uniform1f(u.uT, t);
    gl.uniform1f(u.uLetter, s.letter); gl.uniform1f(u.uCool, s.cool); gl.uniform4f(u.uCut, ...eng.cut);
    gl.uniform4fv(u.uE, EU); gl.uniform4fv(u.uE2, EU2); gl.uniform2f(u.uWind, ...(s.wind || [0, 0])); gl.uniform4f(u.uEmit, s.heat, s.reveal, s.flicker, 0); gl.uniform4f(u.uFlow, s.rise, s.turb, s.swirl, s.expand);
    gl.uniform4fv(u.uSpark, SU);
    gl.viewport(0, 0, hw, hh);
    for (let i = 0; i < steps; i++) {
      if (eng.lit !== t) {   // between frames each letter moves along its path, so a fast one leaves a flame, not a comb
        const a = (i + 1) / steps;
        for (let k = 0; k < NE; k++) {
          const o = k * 4, same = EP[o + 2] > 0 && EU[o + 2] > 0 && EP2[o + 1] === EU2[o + 1] && Math.abs(EP[o] - EU[o]) + Math.abs(EP[o + 1] - EU[o + 1]) < 0.4 && Math.abs(EP[o + 3] - EU[o + 3]) < 0.8;
          for (let j = 0; j < 4; j++) EI[o + j] = same ? EP[o + j] + (EU[o + j] - EP[o + j]) * a : EU[o + j];
        }
        gl.uniform4fv(u.uE, EI);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, hfb[cur ^ 1]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, heat[cur]); gl.uniform1i(u.uHeat, 0);
      gl.uniform1f(u.uDt, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      cur ^= 1;
    }
    EP.set(EU); EP2.set(EU2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(show.p); u = show.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, heat[cur]); gl.uniform1i(u.uHeat, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, atlas); gl.uniform1i(u.uAtlas, 1);
    gl.uniform2f(u.uRes, canvas.width, canvas.height); gl.uniform2f(u.uCenter, cx, cy); gl.uniform1f(u.uZoom, zoom); gl.uniform1f(u.uT, t);
    gl.uniform1f(u.uPsy, s.psy); gl.uniform1f(u.uLetter, s.letter); gl.uniform4f(u.uCut, ...eng.cut); gl.uniform1f(u.uReveal, s.reveal); gl.uniform4fv(u.uE, EU); gl.uniform4fv(u.uE2, EU2); gl.uniform3f(u.uTint, ...(s.tint || [1, 1, 1])); gl.uniform1f(u.uHue, s.hue); gl.uniform1f(u.uKal, s.kal); gl.uniform1f(u.uSeg, s.seg || 8); gl.uniform1f(u.uFlash, (opts.reduce ? 0.25 : 1) * s.flash);
    gl.uniform1f(u.uFade, s.fade * (eng.fadeIn === false ? 1 : sm(0, 0.6, m.life))); gl.uniform1f(u.uKick, m.kick); gl.uniform1f(u.uBass, m.bass || 0); gl.uniform1f(u.uPx, 1 / canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    eng.last = s;
  }
  eng.frame = frame;
  // switch set or letter on the fly: each set's music is read once, each letter's plan of it made once
  const cacheD = {}, cacheV = {};
  eng.use = async o => {
    const key = o.viz, d = o.data || cacheD[key] || (cacheD[key] = await fetch(key).then(r => r.json()));
    const V = cacheV[key] || (cacheV[key] = readViz(d, o.tempo)), L = PROGRAMS[o.letter] ? o.letter : 'alef', P = PROGRAMS[L];
    const C = (V.plans = V.plans || {})[L] || (V.plans[L] = plan(V, P, hashStr(key)));
    D = {V}; eng.scene = director(P, V, C); eng.plan = C; eng.cut = P.cut || [0, 0, 0, 0]; eng.letter = L; eng.viz = key;
    eng.lastT = null;   // the new one lights from its spine
    return eng;
  };
  eng.ready = (async () => {
    const [d] = await Promise.all([
      fetch(opts.viz || opts.data || 'perai/perai.json').then(r => r.json()),
      document.fonts ? document.fonts.load(`500 100px ${font}`, 'אבג').catch(() => null) : null,
    ]);
    if (opts.viz) { cacheD[opts.viz] = d; await eng.use(opts); } else {
      D = d; D.kick = b64(d.kick); D.hat = unpack(d.hat); D.perc = unpack(d.perc);
      D.drop = d.t0 + 20 * 4 * d.p;   // Pera'i: the kick comes in on bar 20
    }
    const A = buildAtlas(font);
    atlas = tex(A.W, A.H, gl.R8, gl.RED, gl.UNSIGNED_BYTE, A.px);
    eng.ok = true; return eng;
  })();
  return eng;
}
window.Otiyot = {create, scenes: {alef, alef18}, programs: PROGRAMS};
})();
