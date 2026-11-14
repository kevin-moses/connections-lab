/**
 * Hand-written reference for GLSL ES 3.00 built-ins and the app's inputs.
 * Feeds editor completion and hover docs (browser) and grounds the tutor's
 * answers (server). `genType` means float, vec2, vec3 or vec4.
 */

export interface GlslEntry {
  name: string;
  kind: 'function' | 'variable';
  signatures: string[];
  /** One sentence, in plain words. */
  oneLiner: string;
  /** A typical use. */
  example?: string;
  /** False when the Debugger's CPU interpreter can't run it yet. */
  debuggable?: boolean;
}

const fn = (name: string, signatures: string[], oneLiner: string, example?: string, debuggable = true): GlslEntry => ({
  name,
  kind: 'function',
  signatures,
  oneLiner,
  example,
  debuggable,
});
const v = (name: string, type: string, oneLiner: string, example?: string): GlslEntry => ({
  name,
  kind: 'variable',
  signatures: [type],
  oneLiner,
  example,
});
const g1 = (name: string) => [`genType ${name}(genType x)`];
const g2 = (name: string, a = 'x', b = 'y') => [`genType ${name}(genType ${a}, genType ${b})`];

export const GLSL_REFERENCE: GlslEntry[] = [
  // Inputs and outputs in this app
  v('gl_FragCoord', 'vec4', "This pixel's position in pixels, origin bottom-left, centers at .5 (e.g. (0.5, 0.5) is the bottom-left pixel).", 'float fromBottom = gl_FragCoord.y; // in pixels'),
  v('u_resolution', 'uniform vec2', 'Canvas size in pixels (width, height).', 'vec2 center = u_resolution * 0.5; // in pixels'),
  v('u_time', 'uniform float', 'Seconds since the shader started (pauses with the Play button).', 'float t = u_time * 2.0; // twice as fast'),
  v('u_mouse', 'uniform vec2', 'Mouse position in pixels, origin bottom-left.', 'float near = distance(gl_FragCoord.xy, u_mouse);'),
  v('fragColor', 'out vec4', 'The color this pixel ends up with: (r, g, b, a), each 0 to 1.', 'fragColor = vec4(0.2, 0.6, 1.0, 1.0); // sky blue'),
  v('gl_FragColor', 'vec4', "p5 style (GLSL ES 1.00): the color this pixel ends up with. It's built in, so you don't declare it; ES 3.00 uses your own `out vec4` instead."),
  v('vUv', 'varying vec2', "three.js's 0..1 position on the canvas, origin bottom-left (like gl_FragCoord). Declare it: `varying vec2 vUv;`."),
  v('iResolution', 'uniform vec3', 'Shadertoy: canvas size in pixels (.xy); .z is the pixel aspect, 1.0.', 'vec2 center = 0.5 * iResolution.xy;'),
  v('iTime', 'uniform float', 'Shadertoy: seconds since the shader started.'),
  v('iMouse', 'uniform vec4', 'Shadertoy: mouse position in pixels (.xy). On shadertoy.com .zw hold the click; here they stay 0.'),
  v('iFrame', 'uniform int', 'Shadertoy: frames since the start (here: u_time × 60).'),
  v('iTimeDelta', 'uniform float', 'Shadertoy: seconds per frame (here a fixed 1/60).'),
  v('iChannel0', 'uniform sampler2D', "Shadertoy: an input texture. Textures aren't supported yet, so it reads black."),
  v('vTexCoord', 'varying vec2', "p5's 0..1 position on the canvas, origin top-left, y down (unlike gl_FragCoord). Declare it: `varying vec2 vTexCoord;`.", 'float fromTop = vTexCoord.y;'),

  // Angles and trigonometry
  fn('radians', g1('radians').map((s) => s.replace('x', 'degrees')), 'Degrees to radians (× π/180).', 'float a = radians(90.0); // 1.5708'),
  fn('degrees', g1('degrees').map((s) => s.replace('x', 'radians')), 'Radians to degrees (× 180/π).'),
  fn('sin', g1('sin'), 'Sine of an angle in radians; swings between -1 and 1.', 'float wave = sin(p.x * 10.0);'),
  fn('cos', g1('cos'), 'Cosine of an angle in radians; like sin shifted by a quarter turn.', 'vec2 p = vec2(cos(a), sin(a));'),
  fn('tan', g1('tan'), 'Tangent of an angle in radians (sin / cos).'),
  fn('asin', g1('asin'), 'Inverse sine: the angle (-π/2 to π/2) whose sine is x.'),
  fn('acos', g1('acos'), 'Inverse cosine: the angle (0 to π) whose cosine is x.'),
  fn('atan', ['genType atan(genType y, genType x)', 'genType atan(genType y_over_x)'], 'Inverse tangent. With two arguments: the angle of the point (x, y), from -π to π.', 'float angle = atan(p.y, p.x);'),
  fn('sinh', g1('sinh'), 'Hyperbolic sine.'),
  fn('cosh', g1('cosh'), 'Hyperbolic cosine.'),
  fn('tanh', g1('tanh'), 'Hyperbolic tangent; squashes any value into -1..1.'),
  fn('asinh', g1('asinh'), 'Inverse hyperbolic sine.'),
  fn('acosh', g1('acosh'), 'Inverse hyperbolic cosine.'),
  fn('atanh', g1('atanh'), 'Inverse hyperbolic tangent.'),

  // Exponentials
  fn('pow', g2('pow'), 'x raised to the power y. Undefined for x < 0.', 'float curve = pow(t, 2.0);'),
  fn('exp', g1('exp'), 'e raised to the power x.'),
  fn('log', g1('log'), 'Natural logarithm (inverse of exp). Undefined for x ≤ 0.'),
  fn('exp2', g1('exp2'), '2 raised to the power x.'),
  fn('log2', g1('log2'), 'Base-2 logarithm. Undefined for x ≤ 0.'),
  fn('sqrt', g1('sqrt'), 'Square root. Undefined for x < 0.'),
  fn('inversesqrt', g1('inversesqrt'), '1 / sqrt(x).'),

  // Common
  fn('abs', g1('abs'), 'Absolute value: drops the minus sign.', 'float off = abs(p.x - 0.5); // distance from the middle'),
  fn('sign', g1('sign'), '-1, 0 or 1 depending on whether x is negative, zero or positive.'),
  fn('floor', g1('floor'), 'Rounds down to the whole number below.', 'vec2 cell = floor(p * 8.0);'),
  fn('ceil', g1('ceil'), 'Rounds up to the whole number above.'),
  fn('trunc', g1('trunc'), 'Drops the fractional part (rounds toward zero).'),
  fn('round', g1('round'), 'Rounds to the nearest whole number.'),
  fn('roundEven', g1('roundEven'), 'Rounds to the nearest whole number; halves go to the even one.'),
  fn('fract', g1('fract'), 'The fractional part: x - floor(x), always 0 to <1. Repeats a pattern.', 'vec2 tile = fract(p * 4.0);'),
  fn('mod', ['genType mod(genType x, genType y)', 'genType mod(genType x, float y)'], 'x - y * floor(x / y): wraps x into 0..y.', 'float stripe = mod(gl_FragCoord.x, 20.0);'),
  fn('modf', ['genType modf(genType x, out genType i)'], 'Splits x into a whole part (written to i) and the fractional part (returned).', undefined, false),
  fn('min', ['genType min(genType x, genType y)', 'genType min(genType x, float y)'], 'The smaller of two values (per component). On 0/1 masks it acts like AND.'),
  fn('max', ['genType max(genType x, genType y)', 'genType max(genType x, float y)'], 'The larger of two values (per component). On 0/1 masks it acts like OR.'),
  fn('clamp', ['genType clamp(genType x, genType lo, genType hi)', 'genType clamp(genType x, float lo, float hi)'], 'Limits x to the range lo..hi.', 'float c = clamp(v, 0.0, 1.0);'),
  fn('mix', ['genType mix(genType a, genType b, genType t)', 'genType mix(genType a, genType b, float t)'], 'Blends from a (t = 0) to b (t = 1): a * (1 - t) + b * t.', 'vec3 c = mix(dark, light, 0.25); // a quarter of the way'),
  fn('step', ['genType step(genType edge, genType x)', 'genType step(float edge, genType x)'], '0.0 when x < edge, 1.0 otherwise: a hard edge.', 'float big = step(10.0, size);'),
  fn(
    'smoothstep',
    ['genType smoothstep(genType edge0, genType edge1, genType x)', 'genType smoothstep(float edge0, float edge1, genType x)'],
    'A smooth 0 → 1 ramp as x goes from edge0 to edge1 (0 before, 1 after).',
    'float fade = smoothstep(0.0, 2.0, t);',
  ),
  fn('isnan', ['bvecN isnan(genType x)'], 'True where x is not a number (e.g. 0.0 / 0.0).'),
  fn('isinf', ['bvecN isinf(genType x)'], 'True where x is infinite.'),

  // Geometry
  fn('length', ['float length(genType x)'], 'Length of a vector: the distance from the origin.', 'float r = length(p); // distance from (0, 0)'),
  fn('distance', ['float distance(genType a, genType b)'], 'Distance between two points: length(a - b).', 'float d = distance(p, q);'),
  fn('dot', ['float dot(genType a, genType b)'], 'Sum of the component products. 1 for same direction, 0 at right angles, -1 opposite (unit vectors).'),
  fn('cross', ['vec3 cross(vec3 a, vec3 b)'], 'A vector at right angles to both a and b.'),
  fn('normalize', g1('normalize'), 'The same direction with length 1.', 'vec2 dir = normalize(v);'),
  fn('faceforward', ['genType faceforward(genType N, genType I, genType Nref)'], 'N if dot(Nref, I) < 0, otherwise -N.'),
  fn('reflect', ['genType reflect(genType I, genType N)'], 'Mirrors direction I off a surface with unit normal N.'),
  fn('refract', ['genType refract(genType I, genType N, float eta)'], 'Bends direction I through a surface with unit normal N and index ratio eta.'),

  // Matrices
  fn('matrixCompMult', ['mat matrixCompMult(mat a, mat b)'], 'Multiplies two matrices component by component (not a matrix product).'),
  fn('outerProduct', ['mat outerProduct(vec c, vec r)'], 'The matrix c × rᵀ.'),
  fn('transpose', ['mat transpose(mat m)'], 'Swaps rows and columns.'),
  fn('determinant', ['float determinant(mat m)'], 'The determinant of a square matrix.'),
  fn('inverse', ['mat inverse(mat m)'], 'The inverse of a square matrix.'),

  // Vector comparison
  fn('lessThan', ['bvecN lessThan(vecN a, vecN b)'], 'Per-component a < b.'),
  fn('lessThanEqual', ['bvecN lessThanEqual(vecN a, vecN b)'], 'Per-component a ≤ b.'),
  fn('greaterThan', ['bvecN greaterThan(vecN a, vecN b)'], 'Per-component a > b.'),
  fn('greaterThanEqual', ['bvecN greaterThanEqual(vecN a, vecN b)'], 'Per-component a ≥ b.'),
  fn('equal', ['bvecN equal(vecN a, vecN b)'], 'Per-component a == b.'),
  fn('notEqual', ['bvecN notEqual(vecN a, vecN b)'], 'Per-component a != b.'),
  fn('any', ['bool any(bvecN b)'], 'True if any component is true.'),
  fn('all', ['bool all(bvecN b)'], 'True if every component is true.'),
  fn('not', ['bvecN not(bvecN b)'], 'Flips each component.'),

  // Textures and derivatives (GPU only for now)
  fn('texture', ['vec4 texture(sampler2D s, vec2 uv)'], 'Reads a texture at uv (0..1).', undefined, false),
  fn('texture2D', ['vec4 texture2D(sampler2D s, vec2 uv)'], 'p5 style (GLSL ES 1.00) name for texture(): reads a texture at uv (0..1).', undefined, false),
  fn('texelFetch', ['vec4 texelFetch(sampler2D s, ivec2 p, int lod)'], 'Reads one texel by integer coordinates.', undefined, false),
  fn('textureSize', ['ivec2 textureSize(sampler2D s, int lod)'], "A texture's size in texels.", undefined, false),
  fn('dFdx', g1('dFdx').map((s) => s.replace('x)', 'p)')), 'How much p changes to the next pixel on the right.', undefined, false),
  fn('dFdy', g1('dFdy').map((s) => s.replace('x)', 'p)')), 'How much p changes to the next pixel up.', undefined, false),
  fn('fwidth', g1('fwidth').map((s) => s.replace('x)', 'p)')), 'abs(dFdx(p)) + abs(dFdy(p)): how fast p changes per pixel (for anti-aliasing).', 'float aa = fwidth(d);', false),
];

const BY_NAME = new Map(GLSL_REFERENCE.map((e) => [e.name, e]));

export function lookupGlsl(name: string): GlslEntry | undefined {
  return BY_NAME.get(name);
}

/** Khronos reference page for a built-in function. */
export function specUrl(name: string): string {
  return `https://registry.khronos.org/OpenGL-Refpages/es3.0/html/${name}.xhtml`;
}

/** Built-in functions called in `code`, in order of first use (at most `limit`). */
export function builtinsUsedIn(code: string, limit = 10): GlslEntry[] {
  const seen = new Set<string>();
  const out: GlslEntry[] = [];
  for (const m of code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ' ').matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const e = BY_NAME.get(m[1]);
    if (!e || e.kind !== 'function' || seen.has(e.name)) continue;
    seen.add(e.name);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}
