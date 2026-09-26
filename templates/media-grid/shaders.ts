// Shaders for media-grid.
//
// Cell: one quad per cell, a little larger than the cell so the rounded-rect SDF can antialias its
// own edge (1 px wide at any zoom via fwidth). The media covers the cell (cover crop + focus).
// Images are sRGB textures (decoded by the GPU); video frames arrive undecoded, so they are
// decoded here (uDecode). Output goes through colorspace_fragment like every custom material.
//
// Composite: the cells are drawn into a transparent render target (premultiplied by the blending)
// and composited over the background with a short camera motion blur — the grid is one flat plane,
// so every pixel's motion is known exactly from the camera a fraction of a frame either side of t:
// the pass averages the scene along that segment. With the camera still the taps collapse onto
// one texel and the output is the sharp render. The caption's scrim darkens the grid here, before
// it is laid over the background: only cells passing under the type dim, never the background.

export const cellVertex = /* glsl */ `
  varying vec2 vPos; // world units from the cell centre
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const cellFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uSize; // cell size (world units)
  uniform float uRadius; // world units
  uniform vec2 uUvScale;
  uniform vec2 uUvOffset;
  uniform float uDecode; // 1 for video frames (uploaded sRGB-encoded)
  uniform float uReady; // 0 until a video has a frame
  uniform vec3 uPlaceholder; // linear
  uniform float uBleed; // 1 with no gap: edges grow a pixel so neighbours meet without a seam
  varying vec2 vPos;

  float roundedBox(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    float d = roundedBox(vPos, uSize * 0.5, uRadius);
    float aa = max(fwidth(d), 1e-4);
    d -= uBleed * aa;
    float alpha = clamp(0.5 - d / aa, 0.0, 1.0);
    if (alpha <= 0.0) discard;
    vec2 uv = clamp(vPos / uSize + 0.5, 0.0, 1.0) * uUvScale + uUvOffset;
    vec4 texel = texture2D(uMap, uv);
    if (uDecode > 0.5) texel = sRGBTransferEOTF(texel);
    vec3 color = mix(uPlaceholder, texel.rgb, uReady);
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`

export const compositeVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

// uNow / uFrom / uTo: camera (centre.xy, half extents.zw) at t and at the shutter's ends.
// uRt: render-target pixels = frame pixels + 2 × uPad on each axis.
// uScrimBand: frame px from the top — the scrim eases in from x to y, holds, eases out from z to
// w (see caption.ts); uScrimAlpha 0 turns it off.
export const compositeFragment = /* glsl */ `
  #define TAPS 24
  uniform sampler2D uScene;
  uniform vec4 uNow;
  uniform vec4 uFrom;
  uniform vec4 uTo;
  uniform vec2 uFrame; // frame size (px)
  uniform vec2 uPad; // overscan (px)
  uniform vec4 uScrimBand;
  uniform float uScrimAlpha;
  uniform vec3 uScrimTint; // sRGB
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
    // Scrim, mixed in sRGB like the canvas gradient it replaces.
    if (uScrimAlpha > 0.0) {
      float y = (1.0 - vUv.y) * uFrame.y;
      float mask = smoothstep(uScrimBand.x, uScrimBand.y, y) *
        (1.0 - smoothstep(uScrimBand.z, uScrimBand.w, y));
      vec3 encoded = sRGBTransferOETF(vec4(color, 1.0)).rgb;
      encoded = mix(encoded, uScrimTint, uScrimAlpha * mask);
      color = sRGBTransferEOTF(vec4(encoded, 1.0)).rgb;
    }
    gl_FragColor = vec4(color, sum.a);
    #include <colorspace_fragment>
  }
`
