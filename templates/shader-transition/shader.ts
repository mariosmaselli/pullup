// Fragment shader for the shader-transition template.
//
// One fullscreen pass composites the outgoing (uFrom) and incoming (uTo) media with the selected
// transition, then the caption and grain.
//
// Motion blur (180° shutter), done like a compositor: every transition is a stack of layers —
// outgoing media, an optional accent layer, incoming media — separated by hard, anti-aliased edges.
// Each edge's coverage over the shutter is integrated analytically (the edge moves linearly within
// one frame's shutter), so fast edges blur smoothly with no sampling noise. The media themselves
// move much less and are averaged over a few samples along their motion path.
//
// Colour: image textures are sampled as linear light (video samples are decoded here, see
// uFromVideo); media are mixed in linear, the caption and grain are
// composited in sRGB (matching how the canvas draws type), and the shader ends with
// #include <colorspace_fragment> so the output is sRGB again.

export const MAX_LINES = 8
export const MAX_SAMPLES = 16

export const STYLE_INDEX: Record<string, number> = {
  Liquid: 0,
  Displace: 1,
  Dissolve: 2,
  Slice: 3,
}

// Slice timing, shared with the sample-count estimate in index.ts.
export const SLICE_STAGGER = 0.4

export const fragment = /* glsl */ `
  precision highp float;
  precision highp int;

  #define MAX_LINES ${MAX_LINES}
  #define MAX_SAMPLES ${MAX_SAMPLES}
  #define SLICE_STAGGER ${SLICE_STAGGER.toFixed(3)}
  #define PI 3.14159265359

  uniform sampler2D uFrom;
  uniform sampler2D uTo;
  // Where each media sits in screen uv: rect = (centre.xy, size.xy) — the whole frame when full
  // bleed, a contained rect when framed. During a transition the window morphs from the outgoing
  // rect to the incoming one and both media cover-fit it.
  uniform vec4 uFromRect;
  uniform vec4 uToRect;
  uniform float uFromAspect; // media width / height
  uniform float uToAspect;
  uniform float uFromZoom;   // includes Scale when the media is bigger than the part that shows
  uniform float uToZoom;
  // The media's centre relative to the window's centre, in window sizes (uv, y up): Position, when
  // the media is bigger than the window (scaled up, or cropped by the frame / the caption's room).
  uniform vec2 uFromShift;
  uniform vec2 uToShift;
  uniform float uToLod;      // whole mip level where the incoming media is ~64–128 px wide (Displace map)
  // 1 when the media is a video: three.js uploads video frames as plain RGBA8 (its built-in
  // materials decode them in their shader), so video samples are still sRGB-encoded here.
  uniform float uFromVideo;
  uniform float uToVideo;

  uniform int uStyle;        // -1 hold (show uFrom only), 0 liquid, 1 displace, 2 dissolve, 3 slice
  uniform float uS0;         // linear transition progress at shutter open
  uniform float uS1;         // ... at shutter close
  uniform int uSamples;      // media samples along their motion path
  uniform float uMotion;     // px the media move over this frame's shutter (from index.ts)
  uniform float uWinMotion;  // ... of which the window morph (between differently framed media)
  uniform float uSeed;       // per transition
  uniform float uFlip;       // ±1, alternates per transition

  uniform vec2 uRes;         // canvas pixels
  uniform float uScale;      // canvas pixels per design pixel
  uniform float uBands;      // Slice: bands for this transition (fixed while the window morphs)
  uniform vec3 uAccent;      // linear
  uniform float uEdge;       // accent layer on/off
  uniform vec3 uBackground;  // linear
  uniform float uGrain;
  uniform float uNoise;      // per-frame grain seed

  // Caption: every line is drawn into its own row of an atlas; each line rises out of its own mask.
  uniform sampler2D uCaption;
  uniform vec2 uCaptionSize; // atlas pixels
  uniform float uCaptionLeft;
  uniform float uRow;        // atlas row height (px)
  uniform int uLines;
  uniform float uLineTop[MAX_LINES];    // screen px (top-left origin) of each row's top
  uniform float uLineOffset[MAX_LINES]; // px the line sits below its resting place (mask reveal)
  uniform vec3 uCaptionColor; // sRGB: white over full-bleed media, contrasting ink on the ground
  uniform float uDim;        // darkening behind the caption (0..1, animated)
  uniform float uDimTop;     // uv.y where the darkening has faded out (well clear of the caption)…
  uniform float uDimFull;    // …and where it reaches full strength (just past the caption's edge)
  uniform vec2 uDimFar;      // Middle: the same pair on the caption's other side; (-2, -1) = none

  varying vec2 vUv;

  // Texture-space gradients of the undisplaced uv (see sampleFrom) and the sample jitter.
  vec2 gxA, gyA, gxB, gyB;
  float gJitter;
  // Mip softening while things move (1 = none; see main()).
  float gSoften;

  // ── helpers ──────────────────────────────────────────────────────────────────────────────

  vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

  // 2D simplex noise (Ashima Arts / Ian McEwan, MIT). Range about [-1, 1].
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  uint pcg(uint v) {
    uint state = v * 747796405u + 2891336453u;
    uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
  }

  // Stable per-cell hash in [0, 1).
  float hash(vec2 cell, float k) {
    uvec2 q = uvec2(ivec2(cell) + 32768);
    return float(pcg(q.x + pcg(q.y + pcg(uint(k))))) / 4294967296.0;
  }

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  vec3 toSRGB(vec3 c) {
    c = max(c, 0.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  vec3 toLinear(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }

  // GSAP eases, by their GSAP names (keep MOTION / windowEase in index.ts in step).
  float power3InOut(float x) { return x < 0.5 ? 8.0 * x * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 4.0) * 0.5; }
  float expoInOut(float x) {
    if (x <= 0.0) return 0.0;
    if (x >= 1.0) return 1.0;
    return x < 0.5 ? pow(2.0, 20.0 * x - 10.0) * 0.5 : (2.0 - pow(2.0, -20.0 * x + 10.0)) * 0.5;
  }
  float sineInOut(float x) { return 0.5 - 0.5 * cos(PI * x); }

  // Antiderivative of the anti-aliasing ramp clamp((d + w) / 2w, 0, 1).
  float rampIntegral(float d, float w) {
    if (d <= -w) return 0.0;
    if (d >= w) return d;
    return (d + w) * (d + w) / (4.0 * w);
  }

  // Share of the shutter during which d > 0, with d moving linearly from d0 to d1 and a ±w ramp:
  // an exact box-filtered, motion-blurred hard edge.
  float coverage(float d0, float d1, float w) {
    float dd = d1 - d0;
    if (abs(dd) < w * 0.02) return clamp((0.5 * (d0 + d1) + w) / (2.0 * w), 0.0, 1.0);
    return clamp((rampIntegral(d1, w) - rampIntegral(d0, w)) / dd, 0.0, 1.0);
  }

  // ── media ────────────────────────────────────────────────────────────────────────────────

  // The window both media are shown in (screen uv centre/size), its pixel size, and the cover
  // scales that fit each media into it.
  vec4 gWin;
  vec2 gWinPx;
  vec2 gCoverA, gCoverB;

  vec2 coverScale(float source, vec2 px) {
    float target = px.x / px.y;
    return source > target ? vec2(target / source, 1.0) : vec2(1.0, source / target);
  }

  // Screen uv → texture uv for a media covering the window, zoomed and shifted.
  vec2 mediaUv(vec2 uv, vec2 cover, float zoom, vec2 shift) {
    return ((uv - gWin.xy) / gWin.zw - shift) * cover / zoom + 0.5;
  }

  // Signed distance (px) outside a rect (centre, size) in screen uv; negative inside.
  float boxOutside(vec2 uv, vec4 rect) {
    vec2 d = (abs(uv - rect.xy) - rect.zw * 0.5) * uRes;
    return max(d.x, d.y);
  }

  // Sampled with gradients from the undisplaced uv, so displacement discontinuities (band and
  // noise edges) don't pick a blurry mip level along the seam. Mirrored wrap covers overshoot.
  vec3 sampleFrom(vec2 uv, float zoomMul) {
    float z = uFromZoom * zoomMul / gSoften;
    vec3 c = textureGrad(uFrom, mediaUv(uv, gCoverA, uFromZoom * zoomMul, uFromShift), gxA / z, gyA / z).rgb;
    return uFromVideo > 0.5 ? toLinear(c) : c;
  }
  vec3 sampleTo(vec2 uv, float zoomMul) {
    float z = uToZoom * zoomMul / gSoften;
    vec3 c = textureGrad(uTo, mediaUv(uv, gCoverB, uToZoom * zoomMul, uToShift), gxB / z, gyB / z).rgb;
    return uToVideo > 0.5 ? toLinear(c) : c;
  }

  // Media averaged along a straight motion path (uv and zoom at shutter open → close).
  vec3 blurFrom(vec2 uv0, vec2 uv1, float z0, float z1) {
    vec3 c = vec3(0.0);
    for (int i = 0; i < MAX_SAMPLES; i++) {
      if (i >= uSamples) break;
      float f = (float(i) + gJitter) / float(uSamples);
      c += sampleFrom(mix(uv0, uv1, f), mix(z0, z1, f));
    }
    return c / float(uSamples);
  }
  vec3 blurTo(vec2 uv0, vec2 uv1, float z0, float z1) {
    vec3 c = vec3(0.0);
    for (int i = 0; i < MAX_SAMPLES; i++) {
      if (i >= uSamples) break;
      float f = (float(i) + gJitter) / float(uSamples);
      c += sampleTo(mix(uv0, uv1, f), mix(z0, z1, f));
    }
    return c / float(uSamples);
  }

  // Cubic B-spline sample of a mip level from four bilinear taps: smooth values and smooth
  // gradients (a bilinear low mip has piecewise-constant gradients, which warp in facets).
  vec3 bicubicLod(sampler2D tex, vec2 uv, float lod) {
    vec2 size = vec2(textureSize(tex, int(lod)));
    vec2 p = uv * size - 0.5;
    vec2 i = floor(p);
    vec2 f = p - i;
    vec2 f2 = f * f;
    vec2 f3 = f2 * f;
    vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
    vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
    vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
    vec2 w3 = f3 / 6.0;
    vec2 g0 = w0 + w1;
    vec2 g1 = w2 + w3;
    vec2 h0 = (i - 0.5 + w1 / g0) / size;
    vec2 h1 = (i + 1.5 + w3 / g1) / size;
    float l = floor(lod);
    return g0.y * (g0.x * textureLod(tex, vec2(h0.x, h0.y), l).rgb + g1.x * textureLod(tex, vec2(h1.x, h0.y), l).rgb)
         + g1.y * (g0.x * textureLod(tex, vec2(h0.x, h1.y), l).rgb + g1.x * textureLod(tex, vec2(h1.x, h1.y), l).rgb);
  }

  // Blurred luminance of the incoming media (a low mip, B-spline filtered), perceptual 0..1.
  float toMap(vec2 uv) {
    vec3 c = bicubicLod(uTo, mediaUv(uv, gCoverB, uToZoom, uToShift), uToLod);
    float l = luma(uToVideo > 0.5 ? toLinear(c) : c);
    return pow(clamp(l, 0.0, 1.0), 1.0 / 2.2);
  }

  // Layer stack: outgoing, accent (between cL and cB), incoming on top.
  vec3 stack(vec3 a, vec3 accent, vec3 b, float cL, float cB) {
    cL = max(cL, cB);
    return a * (1.0 - cL) + accent * (cL - cB) + b * cB;
  }

  // Screen-uv offset rounded to whole pixels.
  vec2 snapPx(vec2 o) { return floor(o * uRes + 0.5) / uRes; }

  // Mip softening matched to motion blur: detail finer than the blur is gone anyway, and letting
  // it shimmer as it moves costs the encoder dearly. 1 (none) when still, at most two mip levels.
  float motionSoften(float px) { return clamp(px / 3.0, 1.0, 4.0); }

  // Sweeps run in the window's local 0..1 coordinates, so they cross it edge to edge in time.
  vec2 winLocal(vec2 uv) { return (uv - gWin.xy) / gWin.zw + 0.5; }

  // ── Liquid: a noise-displaced edge sweeps up; an accent layer rides just ahead of it ───────

  struct Wave { float d; float layer; float e; float swell; };

  Wave liquidEdge(vec2 lp, float s) {
    float e = sineInOut(s);
    float x = lp.x * gWinPx.x / gWinPx.y;
    float amp = 0.1;
    // Domain-warped swell + ripples, drifting as the sweep advances.
    float xw = x + snoise(vec2(x * 1.7 - uSeed, s * 1.3 + uSeed)) * 0.09;
    float wave = snoise(vec2(xw * 1.4 + uSeed, s * 1.2 + uSeed * 1.7)) * 0.68
               + snoise(vec2(xw * 3.6 - uSeed, s * 2.0 - uSeed)) * 0.26
               + snoise(vec2(xw * 7.5 + uSeed * 3.1, s * 2.8)) * 0.06;
    float swell = sin(PI * e);
    // Thickest mid-sweep, breathing along the edge.
    float layer = uEdge * swell * 0.03 * (0.55 + 0.45 * snoise(vec2(xw * 2.6 + 9.0, s * 1.7 + uSeed)));
    // Just far enough past the span that the calm (start/end) edge is out of view.
    float margin = amp * 0.3 + 4.0 / gWinPx.y;
    float front = mix(-margin, 1.0 + margin + 0.03 * uEdge, e);
    Wave w;
    w.d = front + wave * amp * (0.3 + 0.7 * swell) - lp.y; // > 0 below the edge: incoming
    w.layer = max(layer, 0.0);
    w.e = e;
    w.swell = swell;
    return w;
  }

  vec3 liquid(vec2 uv, float s0, float s1) {
    vec2 lp = winLocal(uv);
    vec2 unit = gWin.zw; // window-local → screen uv
    Wave w0 = liquidEdge(lp, s0);
    Wave w1 = liquidEdge(lp, s1);
    float aa = 0.75 / gWinPx.y;
    float cB = coverage(w0.d, w1.d, aa);
    float cL = coverage(w0.d + w0.layer, w1.d + w1.layer, aa);

    // Incoming rises from below with the edge and is pulled up into it (a meniscus).
    float pull0 = exp(-max(w0.d, 0.0) / 0.05) * w0.swell;
    float pull1 = exp(-max(w1.d, 0.0) / 0.05) * w1.swell;
    vec3 b = blurTo(
      uv + vec2(0.0, ((1.0 - w0.e) * 0.16 - pull0 * 0.02) * unit.y),
      uv + vec2(0.0, ((1.0 - w1.e) * 0.16 - pull1 * 0.02) * unit.y),
      1.0 + 0.10 * (1.0 - w0.e), 1.0 + 0.10 * (1.0 - w1.e));

    // Outgoing drifts up and falls into shadow just above the edge.
    vec2 uvA0 = uv - vec2(0.0, w0.e * 0.08 * unit.y);
    vec2 uvA1 = uv - vec2(0.0, w1.e * 0.08 * unit.y);
    vec3 a = blurFrom(uvA0, uvA1, 1.0 + 0.04 * w0.e, 1.0 + 0.04 * w1.e);
    float dl = 0.5 * (w0.d + w0.layer + w1.d + w1.layer);
    float swell = 0.5 * (w0.swell + w1.swell);
    a *= 1.0 - 0.45 * exp(-max(-dl, 0.0) / 0.03) * swell;

    // The accent layer is lit at its leading edge.
    vec3 accent = uAccent * (0.84 + 0.16 * exp(-max(dl, 0.0) / 0.006));
    return stack(a, accent, b, cL, cB);
  }

  // ── Displace: both images flow along the incoming image's luminance; bright forms lead ─────

  float gMap;
  vec2 gGrad;

  // When each pixel of the incoming image arrives (0..1): its bright forms first, spread along
  // the push direction and broken up by soft noise so the key never collapses into a few frames
  // however the image's luminance happens to be distributed.
  float gArrive;

  float displaceKey(float e) {
    float w = 0.24;
    float k = clamp((e * (1.0 + w) - gArrive * (1.0 - w) - w * 0.5) / w, 0.0, 1.0);
    return smoothstep(0.0, 1.0, k);
  }

  vec3 displace(vec2 uv, float s0, float s1) {
    float e0 = sineInOut(s0);
    float e1 = sineInOut(s1);
    vec2 lp = winLocal(uv);
    float along = uFlip > 0.0 ? lp.y : 1.0 - lp.y;
    float soft = 0.5 + 0.5 * snoise(vec2(lp.x * gWinPx.x / gWinPx.y, lp.y) * 1.6 + uSeed);
    gArrive = clamp(0.45 * (1.0 - gMap) + 0.35 * along + 0.2 * soft, 0.0, 1.0);

    vec2 flow = vec2(0.0, uFlip) * (gMap - 0.2) * 0.45 + gGrad * 1.3;
    // Soften by this pixel's own flow speed.
    gSoften = max(gSoften, motionSoften(abs(e1 - e0) * length(flow) * 0.5 * gWinPx.y));
    vec3 a = blurFrom(uv + flow * e0 * 0.5, uv + flow * e1 * 0.5, 1.0 + 0.06 * e0, 1.0 + 0.06 * e1);
    vec3 b = blurTo(uv - flow * (1.0 - e0) * 0.5, uv - flow * (1.0 - e1) * 0.5,
                    1.0 + 0.06 * (1.0 - e0), 1.0 + 0.06 * (1.0 - e1));
    float k = (displaceKey(e0) + 2.0 * displaceKey(0.5 * (e0 + e1)) + displaceKey(e1)) * 0.25;
    return mix(a, b, k);
  }

  // ── Dissolve: a coarse grain threshold over soft clouds ─────────────────────────────────

  vec3 dissolve(vec2 uv, float s0, float s1) {
    float e0 = sineInOut(s0);
    float e1 = sineInOut(s1);
    vec2 q = vec2(uv.x * uRes.x / uRes.y, uv.y);
    // Threshold field: soft clouds broken up by a four-design-pixel grain at their fronts.
    float cell = max(1.0, floor(4.0 * uScale + 0.5));
    float g = hash(floor(gl_FragCoord.xy / cell), floor(uSeed * 1000.0));
    float cloud = 0.5 + 0.5 * (snoise(q * 2.2 + uSeed) * 0.72 + snoise(q * 5.5 - uSeed) * 0.28);
    float th = clamp((cloud * 0.82 + g * 0.18 - 0.1) / 0.8, 0.0, 1.0);
    float f0 = mix(-0.06, 1.06, e0) - th;
    float f1 = mix(-0.06, 1.06, e1) - th;
    float cB = coverage(f0, f1, 0.002);
    // Grains just turned carry the accent, like ink catching light.
    float fresh = cB * (1.0 - smoothstep(0.0, 0.05, 0.5 * (f0 + f1)));

    vec3 a = blurFrom(uv, uv, 1.0 + 0.035 * e0, 1.0 + 0.035 * e1);
    vec3 b = blurTo(uv, uv, 1.0 + 0.035 * (1.0 - e0), 1.0 + 0.035 * (1.0 - e1));
    return mix(mix(a, b, cB), uAccent, fresh * uEdge * 0.6);
  }

  // ── Slice: bands cut across one after another, each led by a thin accent strip ─────────────

  vec3 slice(vec2 uv, float s0, float s1) {
    vec2 lp = winLocal(uv);
    vec2 unit = gWin.zw;
    float bands = uBands;
    float row = clamp(floor((1.0 - lp.y) * bands), 0.0, bands - 1.0); // 0 = top band
    float offset = row / max(bands - 1.0, 1.0) * SLICE_STAGGER;
    float l0 = clamp((s0 - offset) / (1.0 - SLICE_STAGGER), 0.0, 1.0);
    float l1 = clamp((s1 - offset) / (1.0 - SLICE_STAGGER), 0.0, 1.0);
    float e0 = expoInOut(l0);
    float e1 = expoInOut(l1);
    // Each band moves on its own schedule: soften by this band's own motion.
    gSoften = motionSoften(max(uWinMotion, abs(e1 - e0) * 0.22 * gWinPx.x));

    // Direction-normalised x: the incoming band enters from the right (or the left).
    float x = uFlip > 0.0 ? lp.x : 1.0 - lp.x;
    float px = 1.0 / gWinPx.x;
    float strip = 0.045 * uEdge;
    float d0 = x - mix(1.0 + 2.0 * px, -2.0 * px - strip, e0); // > 0: incoming
    float d1 = x - mix(1.0 + 2.0 * px, -2.0 * px - strip, e1);
    float w0 = strip * sin(PI * e0);
    float w1 = strip * sin(PI * e1);
    float cB = coverage(d0, d1, 0.75 * px);
    float cL = coverage(d0 + w0, d1 + w1, 0.75 * px);

    // Offsets snap to whole pixels: in the long expo tail a band would otherwise creep by
    // fractions of a pixel for many frames, resampling (and re-encoding) all its detail.
    vec2 dirB = vec2(uFlip * 0.22 * unit.x, 0.0);
    vec2 dirA = vec2(uFlip * 0.12 * unit.x, 0.0);
    vec3 b = blurTo(uv - snapPx(dirB * (1.0 - e0)), uv - snapPx(dirB * (1.0 - e1)), 1.0, 1.0);
    vec3 a = blurFrom(uv + snapPx(dirA * e0), uv + snapPx(dirA * e1), 1.0, 1.0);
    a *= 1.0 - 0.2 * (e0 + e1); // pushed back into shadow as it's covered
    return stack(a, uAccent, b, cL, cB);
  }

  vec3 transition(vec2 uv, float s0, float s1) {
    if (uStyle == 0) return liquid(uv, s0, s1);
    if (uStyle == 1) return displace(uv, s0, s1);
    if (uStyle == 2) return dissolve(uv, s0, s1);
    return slice(uv, s0, s1);
  }

  // ── main ─────────────────────────────────────────────────────────────────────────────────

  // The window at transition progress s (power3.inOut from the outgoing rect to the incoming one).
  vec4 windowAt(float s) {
    return uStyle < 0 ? uFromRect : mix(uFromRect, uToRect, power3InOut(s));
  }

  void main() {
    vec2 uv = vUv;

    // Window: sampled mid-shutter; its moving edge is motion-blurred analytically.
    vec4 w0 = windowAt(uS0);
    vec4 w1 = windowAt(uS1);
    gWin = windowAt(0.5 * (uS0 + uS1));
    gWinPx = gWin.zw * uRes;
    float onWindow = coverage(-boxOutside(uv, w0), -boxOutside(uv, w1), 0.5);
    gCoverA = coverScale(uFromAspect, gWinPx);
    gCoverB = coverScale(uToAspect, gWinPx);
    gSoften = uStyle < 0 ? 1.0 : motionSoften(uMotion);
    gxA = dFdx(uv) / gWin.zw * gCoverA;
    gyA = dFdy(uv) / gWin.zw * gCoverA;
    gxB = dFdx(uv) / gWin.zw * gCoverB;
    gyB = dFdy(uv) / gWin.zw * gCoverB;
    // Static per-pixel jitter: a handful of media samples blur without banding.
    gJitter = uSamples > 1 ? hash(gl_FragCoord.xy, 17.0) : 0.5;

    vec3 color;
    if (uStyle < 0) {
      color = sampleFrom(uv, 1.0);
    } else {
      if (uStyle == 1) {
        gMap = toMap(uv);
        vec2 o = vec2(0.02, 0.0);
        gGrad = vec2(toMap(uv + o.xy) - toMap(uv - o.xy), toMap(uv + o.yx) - toMap(uv - o.yx));
      }
      color = transition(uv, uS0, uS1);
    }
    color = mix(uBackground, color, onWindow);

    // Caption and grain in sRGB, like type drawn on a canvas.
    vec3 c = toSRGB(color);
    float dim = uDim;
    if (uDimFar.x > -1.5) dim *= smoothstep(uDimFar.x, uDimFar.y, uv.y); // Middle: the far side
    c *= 1.0 - dim * smoothstep(uDimTop, uDimFull, uv.y);

    if (uLines > 0) {
      vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y); // top-left origin, pixel centres
      float a = 0.0;
      for (int i = 0; i < MAX_LINES; i++) {
        if (i >= uLines) break;
        vec2 local = vec2(frag.x - uCaptionLeft, frag.y - uLineTop[i]);
        if (local.x < 0.0 || local.x > uCaptionSize.x || local.y < 0.0 || local.y > uRow) continue;
        float y = local.y - uLineOffset[i];
        if (y < 0.0 || y > uRow) continue;
        vec2 at = vec2(local.x, float(i) * uRow + y) / uCaptionSize;
        a = max(a, textureLod(uCaption, vec2(at.x, 1.0 - at.y), 0.0).a);
      }
      c = mix(c, uCaptionColor, a);
    }

    if (uGrain > 0.0) c += (hash(gl_FragCoord.xy, uNoise) - 0.5) * uGrain;

    gl_FragColor = vec4(toLinear(c), 1.0);
    #include <colorspace_fragment>
  }
`
