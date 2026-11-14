import { StreamLanguage } from '@codemirror/language';
import { clike } from '@codemirror/legacy-modes/mode/clike';

const words = (s: string): Record<string, true> =>
  Object.fromEntries(s.split(/\s+/).filter(Boolean).map((w) => [w, true]));

/**
 * GLSL ES 3.00 highlighting. CodeMirror's bundled `shader` mode targets
 * desktop GLSL 1.x and misses ES 3.00 keywords (precision, highp, texture…),
 * so we define our own on top of the same C-like tokenizer.
 */
export const glsl = StreamLanguage.define(
  clike({
    name: 'glsl',
    keywords: words(`
      const uniform in out inout centroid flat smooth invariant layout
      attribute varying precision highp mediump lowp
      break continue discard return for while do if else switch case default struct`),
    types: words(`
      void bool int uint float
      vec2 vec3 vec4 bvec2 bvec3 bvec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4
      mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4
      sampler2D sampler3D samplerCube sampler2DShadow sampler2DArray
      isampler2D usampler2D`),
    blockKeywords: words('for while do if else switch struct'),
    builtin: words(`
      radians degrees sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh
      pow exp log exp2 log2 sqrt inversesqrt
      abs sign floor trunc round roundEven ceil fract mod modf min max clamp mix step smoothstep
      isnan isinf floatBitsToInt intBitsToFloat
      length distance dot cross normalize faceforward reflect refract
      matrixCompMult outerProduct transpose determinant inverse
      lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not
      texture textureProj textureLod textureOffset texelFetch textureSize textureGrad
      texture2D textureCube
      dFdx dFdy fwidth`),
    atoms: words(`
      true false
      gl_FragCoord gl_FrontFacing gl_PointCoord gl_FragDepth gl_FragColor
      gl_Position gl_PointSize gl_VertexID gl_InstanceID
      u_resolution u_time u_mouse vTexCoord vUv
      iResolution iTime iTimeDelta iFrameRate iFrame iMouse iDate iSampleRate
      iChannel0 iChannel1 iChannel2 iChannel3 iChannelTime iChannelResolution`),
    indentSwitch: false,
    hooks: {
      '#': (stream: { skipToEnd(): void }) => {
        stream.skipToEnd();
        return 'meta';
      },
    },
  }),
);
