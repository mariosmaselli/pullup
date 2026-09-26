// Shaders for media-grid.
//
// Cell: one quad per cell, a little larger than the cell so the rounded-rect SDF can antialias its
// own edge (1 px wide at any zoom via fwidth). The media sits in the cell by the Media size
// settings (_lib/layout.ts mediaRect: Fill covers the cell, Fit shows it whole; scale; position);
// the rounded rect is the part of the cell the media covers. Images are sRGB textures (decoded by
// the GPU); video frames arrive undecoded, so they are decoded here (uDecode). Output goes through
// colorspace_fragment like every custom material.
//
// The legibility scrim (_lib/base.ts bands) is applied here, per cell: only cells behind the type
// darken — a cell fades into it as it slides under the type's ink box (uReach px of overlap, or
// half the ink: a cell under half a label is fully in) — so the scrim follows the cards, never a
// band across the frame, and the background is never touched. Mixed in sRGB like the base layer's
// canvas gradient, and stronger where the content stands out from the tint (uCompress): a light
// page's big black display type would otherwise still cross the caption on a mid-grey card, so
// light content recedes further while dark content (a dark UI, a night shot) keeps its tone.
//
// Composite: the cells are drawn into a transparent render target (premultiplied by the blending)
// and composited over the background with a short camera motion blur — the grid is one flat plane,
// so every pixel's motion is known exactly from the camera a fraction of a frame either side of t:
// the pass averages the scene along that segment. With the camera still the taps collapse onto
// one texel and the output is the sharp render.

// Scrim bands (caption, top labels, bottom labels), and the pieces of type each is for (the
// caption and the two labels on its edge): a cell under either label of a row darkens.
export const SCRIMS = 3
export const INKS = 3

export const cellVertex = /* glsl */ `
  varying vec2 vPos; // world units from the cell centre
  varying vec2 vCentre; // the cell centre (world)
  void main() {
    vPos = position.xy;
    vCentre = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const cellFragment = /* glsl */ `
  #define SCRIMS ${SCRIMS}
  #define INKS ${INKS}
  uniform sampler2D uMap;
  uniform vec4 uBox; // the visible part of the cell: centre xy, half size zw (world units from the cell centre, y up)
  uniform vec4 uMedia; // the media's rect: left, bottom, width, height (same units)
  uniform float uRadius; // world units
  uniform float uDecode; // 1 for video frames (uploaded sRGB-encoded)
  uniform float uReady; // 0 until a video has a frame
  uniform vec3 uPlaceholder; // linear
  uniform float uBleed; // 1 with no gap: edges grow a pixel so neighbours meet without a seam
  // Scrim: the camera (centre xy, half extents zw, world units) maps world to frame px.
  uniform vec4 uCam;
  uniform vec2 uFrame; // frame size (px)
  uniform vec4 uBands[SCRIMS]; // frame px from the top: in from x to y, out from z to w
  uniform vec4 uInks[SCRIMS * INKS]; // band i's type, piece by piece: left, top, right, bottom (frame px; unused: all 0)
  uniform float uStrength[SCRIMS]; // 0 = off
  uniform float uReach; // frame px of overlap with the ink over which a cell fades into its band (at most half the ink)
  uniform vec3 uTint; // sRGB
  uniform float uCompress; // extra pull toward the tint for content that stands out from it (0 = a plain mix)
  varying vec2 vPos;
  varying vec2 vCentre;

  float roundedBox(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  // World → frame px (y down).
  vec2 toFrame(vec2 world) {
    vec2 ndc = (world - uCam.xy) / uCam.zw;
    return vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5) * uFrame;
  }

  float ramp(float a, float b, float x) {
    return b > a ? smoothstep(a, b, x) : step(a, x);
  }

  // How far the cell (lo–hi, frame px) is in under a piece of type: full once it spans half the
  // ink (or uReach of it: a cell half under a caption line); 0 for an unused (empty) ink.
  float coverOf(vec4 ink, vec2 lo, vec2 hi) {
    float ox = min(hi.x, ink.z) - max(lo.x, ink.x);
    float oy = min(hi.y, ink.w) - max(lo.y, ink.y);
    return smoothstep(0.0, max(1.0, min(uReach, 0.5 * (ink.z - ink.x))), ox) *
      smoothstep(0.0, max(1.0, min(uReach, 0.5 * (ink.w - ink.y))), oy);
  }

  void main() {
    float d = roundedBox(vPos - uBox.xy, uBox.zw, uRadius);
    float aa = max(fwidth(d), 1e-4);
    d -= uBleed * aa;
    float alpha = clamp(0.5 - d / aa, 0.0, 1.0);
    if (alpha <= 0.0) discard;
    vec2 uv = clamp((vPos - uMedia.xy) / uMedia.zw, 0.0, 1.0);
    vec4 texel = texture2D(uMap, uv);
    if (uDecode > 0.5) texel = sRGBTransferEOTF(texel);
    vec3 color = mix(uPlaceholder, texel.rgb, uReady);

    if (uStrength[0] + uStrength[1] + uStrength[2] > 0.0) {
      vec2 lo = toFrame(vCentre + uBox.xy + vec2(-uBox.z, uBox.w)); // the cell's top-left
      vec2 hi = toFrame(vCentre + uBox.xy + vec2(uBox.z, -uBox.w)); // bottom-right
      float y = toFrame(vCentre + vPos).y;
      vec3 encoded = sRGBTransferOETF(vec4(color, 1.0)).rgb;
      const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
      float lt = dot(uTint, LUMA);
      for (int i = 0; i < SCRIMS; i++) {
        if (uStrength[i] <= 0.0) continue;
        float cover = 0.0;
        for (int j = 0; j < INKS; j++) cover = max(cover, coverOf(uInks[i * INKS + j], lo, hi));
        vec4 b = uBands[i];
        float mask = ramp(b.x, b.y, y) * (1.0 - ramp(b.z, b.w, y));
        float k = uStrength[i] * cover * mask;
        // How far this pixel stands out from the tint, away from it (0–1): brighter than a dark
        // tint, darker than a light one. The pull toward the tint is k where it doesn't, and
        // grows with it — 1 - (1 - k) / (1 + c·k·d): none at k = 0, all at k = 1, and the
        // result stays in order (a lighter pixel never ends up darker than a darker one).
        float l = dot(encoded, LUMA);
        float d = lt < 0.5 ? max(0.0, l - lt) / max(1e-3, 1.0 - lt) : max(0.0, lt - l) / max(1e-3, lt);
        encoded = mix(encoded, uTint, 1.0 - (1.0 - k) / (1.0 + uCompress * k * d));
      }
      color = sRGBTransferEOTF(vec4(encoded, 1.0)).rgb;
    }
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`

// uNow / uFrom / uTo: camera (centre.xy, half extents.zw) at t and at the shutter's ends.
// uRt: render-target pixels = frame pixels + 2 × uPad on each axis.
export const compositeFragment = /* glsl */ `
  #define TAPS 24
  uniform sampler2D uScene;
  uniform vec4 uNow;
  uniform vec4 uFrom;
  uniform vec4 uTo;
  uniform vec2 uFrame; // frame size (px)
  uniform vec2 uPad; // overscan (px)
  varying vec2 vUv;

  vec2 toRt(vec2 ndc) {
    return (uPad + (ndc * 0.5 + 0.5) * uFrame) / (uFrame + 2.0 * uPad);
  }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    // Where the world point under this pixel at the shutter's ends sits in the frame at t.
    vec2 a = toRt((uFrom.xy + p * uFrom.zw - uNow.xy) / uNow.zw);
    vec2 b = toRt((uTo.xy + p * uTo.zw - uNow.xy) / uNow.zw);
    // Tent-weighted shutter: a box one draws high-contrast edges twice (ghosting); the tent
    // fades the streak out at both ends like a film camera's.
    vec4 sum = vec4(0.0);
    float total = 0.0;
    for (int i = 0; i < TAPS; i++) {
      float k = (float(i) + 0.5) / float(TAPS);
      float w = 1.0 - abs(2.0 * k - 1.0);
      sum += w * texture2D(uScene, mix(a, b, k));
      total += w;
    }
    sum /= total;
    // Premultiplied (the cells were blended onto transparent black) → straight alpha.
    vec3 color = sum.a > 0.0 ? sum.rgb / sum.a : vec3(0.0);
    gl_FragColor = vec4(color, sum.a);
    #include <colorspace_fragment>
  }
`
