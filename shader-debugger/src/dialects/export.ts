import { detectStyle, stripComments } from '../glsl/prepare';
import { convert } from './convert';

/** p5 release the exported sketch loads (2.x; the sketch also runs on 1.x). */
export const P5_VERSION = '2.4.0';
export const P5_CDN = `https://cdn.jsdelivr.net/npm/p5@${P5_VERSION}/lib/p5.min.js`;

/**
 * Vertex shaders for a full-canvas `plane(width, height)`, in each GLSL
 * version (p5 links a pair of the same version). They pass `vTexCoord`
 * (0..1, origin top-left), like the app does.
 */
const VERT_ES100 = `precision highp float;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;

void main() {
  vTexCoord = aTexCoord;
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}`;

const VERT_ES300 = `#version 300 es
precision highp float;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
in vec3 aPosition;
in vec2 aTexCoord;
out vec2 vTexCoord;

void main() {
  vTexCoord = aTexCoord;
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}`;

export type P5Export =
  | {
      ok: true;
      /** The sketch on its own, e.g. to paste into editor.p5js.org's sketch.js. */
      sketchJs: string;
      /** A complete page that runs the sketch (loads p5 from a CDN). */
      html: string;
    }
  | { ok: false; reason: string };

/**
 * A runnable p5 sketch for a fragment shader, in whichever style it's written.
 * p5 adds nothing to shaders and sets no time/resolution/mouse uniforms, so
 * the sketch supplies the same ones the app does, in the same units.
 */
export function exportP5(source: string, opts: { width: number; height: number; title: string }): P5Export {
  // p5 has no mainImage: a Shadertoy shader goes over as ES 3.00.
  if (detectStyle(source) === 'shadertoy') {
    const r = convert(source, 'es300');
    if (!r.ok) return r;
    source = r.code;
  }
  const style = detectStyle(source);
  let frag = source.trim();
  if (!/^\s*precision\s/m.test(stripComments(frag))) frag = `precision highp float;\n${frag}`;
  if (style === 'es300' && !/^\s*#\s*version/.test(stripComments(frag))) frag = `#version 300 es\n${frag}`;
  const vert = style === 'es300' ? VERT_ES300 : VERT_ES100;
  // Shadertoy inputs that came along from a Shadertoy shader.
  const code = stripComments(frag);
  const extras = [
    ['iFrame', 'frameCount'],
    ['iTimeDelta', 'deltaTime / 1000'],
    ['iFrameRate', 'frameRate()'],
    ['iDate', '[0, 0, 0, millis() / 1000]'],
  ]
    .filter(([name]) => new RegExp(`\\b${name}\\b`).test(code))
    .map(([name, value]) => `\n  myShader.setUniform('${name}', ${value});`)
    .join('');

  const sketchJs = `// Exported from Shader Debugger. Runs on p5 ${P5_VERSION} (and 1.x).

// Covers the canvas and hands the fragment shader vTexCoord (0..1, origin top-left).
const vert = \`${templateSafe(vert)}\`;

// Your fragment shader.
const frag = \`${templateSafe(frag)}\`;

let myShader;

function setup() {
  createCanvas(${opts.width}, ${opts.height}, WEBGL);
  myShader = createShader(vert, frag);
  noStroke();
}

function draw() {
  shader(myShader);
  // p5 doesn't set these for you. gl_FragCoord counts physical pixels, so
  // scale by pixelDensity(), and flip mouseY: the shader's y points up.
  const d = pixelDensity();
  myShader.setUniform('u_resolution', [width * d, height * d]);
  myShader.setUniform('u_time', millis() / 1000);
  myShader.setUniform('u_mouse', [mouseX * d, (height - mouseY) * d]);${extras}
  plane(width, height);
}
`;

  const html = page(opts.title, `<script src="${P5_CDN}"></script>`, '<script>', sketchJs);
  return { ok: true, sketchJs, html };
}

/** three.js release the exported page loads. */
export const THREE_VERSION = '0.187.0';
export const THREE_CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.js`;

/**
 * Written in ES 1.00 style: ShaderMaterial #defines `varying`/`attribute` in
 * both GLSL modes. Hands the fragment shader three's `vUv` (origin
 * bottom-left) and p5's `vTexCoord` (origin top-left), like the app does.
 */
const VERT_THREE = `varying vec2 vUv;
varying vec2 vTexCoord;

void main() {
  vUv = uv;
  vTexCoord = vec2(uv.x, 1.0 - uv.y);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export type ThreeExport = { ok: true; mainJs: string; html: string } | { ok: false; reason: string };

/**
 * A page that runs the shader full-screen in three.js: a PlaneGeometry(2, 2)
 * with a ShaderMaterial. three prepends `#version`, precision and the ES 1.00
 * #defines itself, so ES 1.00 (p5-style) code runs as written and ES 3.00
 * code runs with `glslVersion: THREE.GLSL3`.
 */
export function exportThree(source: string, opts: { width: number; height: number; title: string }): ThreeExport {
  if (detectStyle(source) === 'shadertoy') {
    const r = convert(source, 'es300');
    if (!r.ok) return r;
    source = r.code;
  }
  const style = detectStyle(source);
  // three writes its own #version line.
  const frag = source.replace(/^[ \t]*#[ \t]*version[^\n]*\n?/m, '').trim();
  const code = stripComments(frag);
  const extras = [
    ['iFrame', '0', 'frame'],
    ['iTimeDelta', '1 / 60', 'delta'],
    ['iFrameRate', '60', '1 / Math.max(delta, 1e-6)'],
    ['iDate', 'new THREE.Vector4()', null],
  ].filter(([name]) => new RegExp(`\\b${name}\\b`).test(code));
  const extraUniforms = extras.map(([name, init]) => `\n  ${name}: { value: ${init} },`).join('');
  const extraUpdates = extras
    .map(([name, , update]) => (update ? `\n  uniforms.${name}.value = ${update};` : `\n  uniforms.${name}.value.set(0, 0, 0, time);`))
    .join('');

  const mainJs = `// Exported from Shader Debugger. Runs on three.js r${THREE_VERSION.split('.')[1]}.
import * as THREE from 'three';

// Covers the canvas and hands the fragment shader vUv (0..1, origin
// bottom-left, three's usual) and vTexCoord (0..1, origin top-left, p5's).
const vertexShader = \`${templateSafe(VERT_THREE)}\`;

// Your fragment shader.
const fragmentShader = \`${templateSafe(frag)}\`;

const renderer = new THREE.WebGLRenderer();
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(${opts.width}, ${opts.height});
document.body.appendChild(renderer.domElement);

// three.js doesn't set these for you. gl_FragCoord counts physical pixels,
// and the shader's y points up.
const uniforms = {
  u_resolution: { value: renderer.getDrawingBufferSize(new THREE.Vector2()) },
  u_time: { value: 0 },
  u_mouse: { value: new THREE.Vector2() },${extraUniforms}
};
const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms${style === 'es300' ? ', glslVersion: THREE.GLSL3' : ''} });

const scene = new THREE.Scene();
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

renderer.domElement.addEventListener('pointermove', (e) => {
  const r = renderer.domElement.getBoundingClientRect();
  const d = renderer.getPixelRatio();
  uniforms.u_mouse.value.set((e.clientX - r.left) * d, (r.bottom - e.clientY) * d);
});

const start = performance.now();
let last = start;
let frame = 0;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const time = (now - start) / 1000;
  const delta = (now - last) / 1000;
  last = now;
  uniforms.u_time.value = time;${extraUpdates}
  renderer.render(scene, camera);
  frame++;
});
`;
  const importMap = `<script type="importmap">{ "imports": { "three": "${THREE_CDN}" } }</script>`;
  return { ok: true, mainJs, html: page(opts.title, importMap, '<script type="module">', mainJs) };
}

/** A standalone page around a script. */
function page(title: string, head: string, scriptTag: string, script: string): string {
  const body = script
    .trimEnd()
    .split('\n')
    .map((l) => (l ? `    ${l}` : l))
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  ${head}
  <style>
    html, body { margin: 0; height: 100%; background: #111; }
    body { display: grid; place-items: center; }
  </style>
</head>
<body>
  ${scriptTag}
${body}
  </script>
</body>
</html>
`;
}

/** Make text safe inside a JS template literal (and a <script> element). */
function templateSafe(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/<\/script/gi, '<\\/script');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
