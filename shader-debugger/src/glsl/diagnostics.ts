import type { LineMap } from './linemap';

export interface ShaderDiagnostic {
  /** 1-based source line, or null when it can't be tied to a line. */
  line: number | null;
  /** 0-based column range within the line, when we could locate the token. */
  from?: number;
  to?: number;
  message: string;
  severity: 'error' | 'warning';
  origin: 'gpu' | 'parser' | 'link';
}

// e.g. "ERROR: 0:12: 'foo' : undeclared identifier" (ANGLE, Firefox, Safari)
const LOG_LINE = /^(ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/;
// e.g. "'foo' : undeclared identifier"
const TOKEN_PREFIX = /^'([^']*)'\s*:\s*(.*)$/;
const NOISE = [/compilation terminated/i, /^\d+ compilation errors?/i];

/**
 * Parse a WebGL shader info log into diagnostics on the learner's lines.
 * `source` is the learner's text (not the generated code); it's used to find
 * the column of the offending token.
 */
export function parseInfoLog(log: string, map: LineMap, source: string): ShaderDiagnostic[] {
  const sourceLines = source.split('\n');
  const out: ShaderDiagnostic[] = [];

  for (const raw of log.split('\n')) {
    const text = raw.replace(/\0/g, '').trim();
    if (!text || NOISE.some((re) => re.test(text))) continue;

    const m = LOG_LINE.exec(text);
    if (!m) {
      out.push({ line: null, message: text, severity: 'error', origin: 'gpu' });
      continue;
    }

    const severity = m[1] === 'WARNING' ? 'warning' : 'error';
    const generatedLine = Number(m[2]);
    const line = generatedLine > 0 ? map.toSource(generatedLine) : null;
    const body = m[3].trim();
    if (NOISE.some((re) => re.test(body))) continue;

    const tok = TOKEN_PREFIX.exec(body);
    const token = tok?.[1] ?? '';
    const message = tok ? (token ? `${tok[2]} '${token}'` : tok[2]) : body;

    const diag: ShaderDiagnostic = { line, message, severity, origin: 'gpu' };
    if (line !== null && token) {
      const range = findToken(sourceLines[line - 1] ?? '', token);
      if (range) [diag.from, diag.to] = range;
    }
    out.push(diag);
  }

  return dedupe(out);
}

function findToken(lineText: string, token: string): [number, number] | null {
  const isWord = /^\w+$/.test(token);
  const idx = isWord
    ? lineText.search(new RegExp(`\\b${token}\\b`))
    : lineText.indexOf(token);
  return idx >= 0 ? [idx, idx + token.length] : null;
}

function dedupe(diags: ShaderDiagnostic[]): ShaderDiagnostic[] {
  const seen = new Set<string>();
  return diags.filter((d) => {
    const key = `${d.line}|${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
