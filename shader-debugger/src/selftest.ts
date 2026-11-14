import { ShaderRunner } from './render/runner';
import { parseGlsl } from './glsl/parse';
import { traceFragment } from './interp/interpreter';
import { crossCheck } from './debugger/crossCheck';
import { CORPUS } from './interp/corpus';
import { convertStyle } from './dialects/convert';

/** Every corpus shader as written (ES 3.00), and again as p5 (ES 1.00) and Shadertoy code, which reach the GPU through conversion. */
const SHADERS = CORPUS.flatMap(({ name, source }) => {
  const out = [{ name, source }];
  for (const [style, label] of [['es100', 'p5 style'], ['shadertoy', 'Shadertoy']] as const) {
    const converted = convertStyle(source, style);
    if (converted && converted !== source) out.push({ name: `${name} (${label})`, source: converted });
  }
  return out;
});

const W = 320;
const H = 240;
const GRID = [8, 6];

export interface SelfTestRow {
  name: string;
  pixels: number;
  passed: number;
  maxDiff: number;
  notes: string[];
}

function run(): SelfTestRow[] {
  const runner = new ShaderRunner(document.getElementById('c') as HTMLCanvasElement, [W, H]);
  const rows: SelfTestRow[] = [];
  for (const { name, source } of SHADERS) {
    const row: SelfTestRow = { name, pixels: 0, passed: 0, maxDiff: 0, notes: [] };
    rows.push(row);
    const compiled = runner.compile(source);
    const parsed = parseGlsl(source);
    if (!compiled.ok || !parsed.ok) {
      row.notes.push(compiled.ok ? 'parse failed' : `GPU: ${compiled.diagnostics[0]?.message}`);
      continue;
    }
    for (let gy = 0; gy < GRID[1]; gy++) {
      for (let gx = 0; gx < GRID[0]; gx++) {
        const px = Math.floor(((gx + 0.5) / GRID[0]) * W);
        const py = Math.floor(((gy + 0.5) / GRID[1]) * H);
        const uniforms = { resolution: [W, H] as [number, number], time: 1.25, mouse: [W * 0.3, H * 0.6] as [number, number] };
        const trace = traceFragment(parsed.ast, {
          pixel: [px, py],
          uniforms: { u_resolution: uniforms.resolution, u_time: uniforms.time, u_mouse: uniforms.mouse },
        });
        const check = crossCheck(trace, runner.readOutputAt(px, py, uniforms));
        row.pixels++;
        if (check.status === 'match') row.passed++;
        else if (row.notes.length < 3) {
          row.notes.push(`(${px},${py}) ${trace.error?.message ?? `cpu ${fmt(check.cpu)} gpu ${fmt(check.gpu)}`}`);
        }
        if (Number.isFinite(check.maxDiff)) row.maxDiff = Math.max(row.maxDiff, check.maxDiff);
      }
    }
  }
  return rows;
}

const fmt = (v: number[] | null) => (v ? `(${v.map((x) => x.toFixed(4)).join(', ')})` : '–');

const rows = run();
const tbody = document.querySelector('#results tbody')!;
for (const r of rows) {
  const tr = document.createElement('tr');
  const cls = r.passed === r.pixels && r.pixels > 0 ? 'ok' : 'bad';
  tr.innerHTML = `<td>${r.name}</td><td>${r.pixels}</td><td class="${cls}">${r.passed}/${r.pixels}</td><td>${r.maxDiff.toExponential(1)}</td><td class="warn">${r.notes.join('<br>')}</td>`;
  tbody.append(tr);
}
const total = rows.reduce((a, r) => a + r.pixels, 0);
const passed = rows.reduce((a, r) => a + r.passed, 0);
document.getElementById('summary')!.innerHTML = `<p class="${passed === total ? 'ok' : 'bad'}">${passed}/${total} pixels agree across ${rows.length} shaders</p>`;
(window as unknown as { __selfTest: SelfTestRow[] }).__selfTest = rows;
