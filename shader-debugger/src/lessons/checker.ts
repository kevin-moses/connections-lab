import { parseGlsl } from '../glsl/parse';
import { traceCall } from '../interp/interpreter';
import { formatValue } from '../interp/values';
import { DEFAULT_VARIANT, type Channel, type Exercise, type ImageCheck, type TestSpec, type Variant } from './types';

import { Lru } from '../../shared/lru';
import type { Image, Renderer, RenderResult } from '../render/types';

export type { Image, Renderer, RenderRequest, RenderResult } from '../render/types';

export interface CheckItem {
  kind: 'compile' | 'image' | TestSpec['type'];
  label: string;
  passed: boolean;
  detail?: string;
  /** For function tests: the call, so the UI can step into it. */
  call?: string;
  /** For a failed image check: what to show side by side. */
  images?: { yours: Image; target: Image; diff: Image; variant: string };
}

export interface CheckReport {
  passed: boolean;
  items: CheckItem[];
}

export function resolveVariant(ex: Exercise, v?: Variant): Required<Variant> {
  const base = { ...DEFAULT_VARIANT, ...(ex.config.variants?.[0] ?? {}) };
  return { ...base, ...(v ?? {}) };
}

export function describeVariant(v: Required<Variant>, all: Required<Variant>[]): string {
  const parts: string[] = [];
  const differs = (k: keyof Variant) => all.some((o) => JSON.stringify(o[k]) !== JSON.stringify(all[0][k]));
  if (differs('size')) parts.push(`on a ${v.size[0]}×${v.size[1]} canvas`);
  if (differs('time')) parts.push(`at u_time = ${v.time}`);
  if (differs('mouse')) parts.push(`with the mouse at (${v.mouse[0]}, ${v.mouse[1]})`);
  return parts.join(', ');
}

/** Run every check for an exercise against the learner's source. */
/**
 * Reference renders per renderer: the reference never changes, so it's drawn
 * once per exercise and variant instead of on every check (every edit).
 */
const referenceRenders = new WeakMap<Renderer, Lru<RenderResult>>();

export function checkExercise(ex: Exercise, source: string, render: Renderer): CheckReport {
  const cache = new Map<string, RenderResult>();
  let references = referenceRenders.get(render);
  if (!references) referenceRenders.set(render, (references = new Lru<RenderResult>(32)));
  const renderVariant = (src: string, v: Required<Variant>, keep: Lru<RenderResult> | Map<string, RenderResult> = cache) => {
    const key = `${src.length}:${hash(src)}|${v.size}|${v.time}|${v.mouse}`;
    let r = keep.get(key);
    if (!r) {
      r = render({
        source: src,
        width: v.size[0],
        height: v.size[1],
        time: v.time,
        mouse: [v.mouse[0] * v.size[0], v.mouse[1] * v.size[1]],
      });
      keep.set(key, r);
    }
    return r;
  };

  const items: CheckItem[] = [];
  const firstVariant = resolveVariant(ex);
  const mine = renderVariant(source, firstVariant);
  if (!mine.ok) {
    items.push({ kind: 'compile', label: 'Your shader compiles', passed: false, detail: mine.error });
    return { passed: false, items };
  }

  // Image diff against the reference, under every variant.
  if (ex.config.image !== false) {
    const opts: ImageCheck = typeof ex.config.image === 'object' ? ex.config.image : {};
    const variants = (ex.config.variants?.length ? ex.config.variants : [{}]).map((v) => resolveVariant(ex, v));
    let failed: CheckItem | null = null;
    let worst = 1;
    for (const v of variants) {
      const yours = renderVariant(source, v);
      const target = renderVariant(ex.reference, v, references);
      if (!yours.ok || !target.ok) {
        failed = { kind: 'image', label: 'Matches the target', passed: false, detail: yours.ok ? `Reference failed: ${(target as { error: string }).error}` : (yours as { error: string }).error };
        break;
      }
      const d = diffImages(yours.image, target.image, opts.tolerance ?? 0.02);
      worst = Math.min(worst, d.matchFraction);
      if (1 - d.matchFraction > (opts.maxMismatch ?? 0.01)) {
        const where = describeVariant(v, variants);
        failed = {
          kind: 'image',
          label: 'Matches the target',
          passed: false,
          detail: `${pct(d.matchFraction)} of pixels match${where ? ` ${where}` : ''}.`,
          images: { yours: yours.image, target: target.image, diff: d.diff, variant: where },
        };
        break;
      }
    }
    items.push(failed ?? { kind: 'image', label: 'Matches the target', passed: true, detail: `${pct(worst)} of pixels match.` });
  }

  // Unit tests.
  let ast: ReturnType<typeof parseGlsl> | null = null;
  for (const t of ex.config.tests ?? []) {
    if (t.type === 'call') {
      ast ??= parseGlsl(source);
      items.push(runCallTest(t, ast));
      continue;
    }
    const v = resolveVariant(ex, t.variant);
    const r = renderVariant(source, v);
    if (!r.ok) {
      items.push({ kind: t.type, label: t.label, passed: false, detail: r.error });
      continue;
    }
    items.push(runImageTest(t, r.image));
  }

  return { passed: items.every((i) => i.passed), items };
}

// ---------- image tests ----------

function sample(img: Image, u: number, v: number): number[] {
  const x = Math.min(img.width - 1, Math.max(0, Math.floor(u * img.width)));
  const y = Math.min(img.height - 1, Math.max(0, Math.floor(v * img.height)));
  const i = (y * img.width + x) * 4;
  return [0, 1, 2, 3].map((k) => img.data[i + k] / 255);
}

function channelOf(rgba: number[], c: Channel): number {
  if (c === 'luma') return 0.299 * rgba[0] + 0.587 * rgba[1] + 0.114 * rgba[2];
  return rgba['rgba'.indexOf(c)];
}

function runImageTest(t: Exclude<TestSpec, { type: 'call' }>, img: Image): CheckItem {
  switch (t.type) {
    case 'pixel': {
      const got = sample(img, t.at[0], t.at[1]);
      const tol = t.tol ?? 0.02;
      const ok = t.expect.every((e, i) => e === null || Math.abs(got[i] - e) <= tol);
      const shown = t.expect.map((e, i) => (e === null ? '·' : num(got[i])));
      return { kind: 'pixel', label: t.label, passed: ok, detail: ok ? undefined : `Got (${shown.join(', ')}), expected (${t.expect.map((e) => (e === null ? '·' : num(e))).join(', ')}).` };
    }
    case 'region': {
      const [x0, y0, x1, y1] = t.rect;
      let worst: { v: number; x: number; y: number } | null = null;
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const u = (x + 0.5) / img.width;
          const v = (y + 0.5) / img.height;
          if (u < x0 || u > x1 || v < y0 || v > y1) continue;
          const val = channelOf(sample(img, u, v), t.channel);
          const bad = (t.min !== undefined && val < t.min) || (t.max !== undefined && val > t.max);
          if (bad && (!worst || Math.abs(val - (t.min ?? t.max ?? 0)) > Math.abs(worst.v - (t.min ?? t.max ?? 0)))) worst = { v: val, x: u, y: v };
        }
      }
      return {
        kind: 'region',
        label: t.label,
        passed: !worst,
        detail: worst ? `${t.channel} is ${num(worst.v)} at uv (${num(worst.x)}, ${num(worst.y)}).` : undefined,
      };
    }
    case 'increasing': {
      const n = t.axis === 'x' ? img.width : img.height;
      let prev = -Infinity;
      let first = 0;
      let last = 0;
      for (let i = 0; i < n; i++) {
        const p = (i + 0.5) / n;
        const val = channelOf(t.axis === 'x' ? sample(img, p, t.at) : sample(img, t.at, p), t.channel);
        if (i === 0) first = val;
        last = val;
        if (val < prev - 1.5 / 255) {
          return { kind: 'increasing', label: t.label, passed: false, detail: `${t.channel} drops from ${num(prev)} to ${num(val)} at ${t.axis} = ${num(p)}.` };
        }
        prev = val;
      }
      const rise = t.rise ?? 0.5;
      const ok = last - first >= rise;
      return { kind: 'increasing', label: t.label, passed: ok, detail: ok ? undefined : `Only rises from ${num(first)} to ${num(last)}.` };
    }
  }
}

// ---------- function tests ----------

function runCallTest(t: Extract<TestSpec, { type: 'call' }>, parsed: ReturnType<typeof parseGlsl>): CheckItem {
  const base = { kind: 'call' as const, label: t.label, call: t.call };
  if (!parsed.ok) return { ...base, passed: false, detail: 'Fix the syntax error first.' };
  const r = traceCall(parsed.ast, t.call, { pixel: [0, 0], uniforms: {} }, { record: false });
  if (r.error || !r.output) return { ...base, passed: false, detail: r.error?.message ?? 'No value returned.' };
  const got = r.output.value.data;
  const expect = Array.isArray(t.expect) ? t.expect : [t.expect];
  const tol = t.tol ?? 1e-3;
  const ok = got.length === expect.length && got.every((g, i) => Math.abs(g - expect[i]) <= tol);
  return {
    ...base,
    passed: ok,
    detail: ok ? undefined : `${t.call} returned ${formatValue(r.output.value)}, expected ${expect.length === 1 ? num(expect[0]) : `(${expect.map(num).join(', ')})`}.`,
  };
}

// ---------- image diff ----------

export function diffImages(yours: Image, target: Image, tolerance: number) {
  const n = yours.width * yours.height;
  const diff = new Uint8ClampedArray(n * 4);
  const tol = tolerance * 255;
  let match = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    let worst = 0;
    for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(yours.data[o + c] - target.data[o + c]));
    if (worst <= tol) {
      match++;
      // matching pixels: dim grayscale of your image
      const g = (yours.data[o] * 0.3 + yours.data[o + 1] * 0.59 + yours.data[o + 2] * 0.11) * 0.35;
      diff[o] = diff[o + 1] = diff[o + 2] = g;
    } else {
      const k = 0.45 + 0.55 * Math.min(1, worst / 128);
      diff[o] = 255 * k;
      diff[o + 1] = 60 * k;
      diff[o + 2] = 70 * k;
    }
    diff[o + 3] = 255;
  }
  return { matchFraction: match / n, diff: { width: yours.width, height: yours.height, data: diff } satisfies Image };
}

const num = (x: number) => String(Number(x.toFixed(3)));
const pct = (f: number) => `${Math.floor(f * 1000) / 10}%`;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
