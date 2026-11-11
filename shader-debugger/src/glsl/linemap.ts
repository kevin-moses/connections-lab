/**
 * Maps line numbers in the code we hand to the GPU ("generated") back to the
 * lines the learner actually sees in the editor ("source").
 *
 * Every diagnostic, inline value and gutter marker must go through a LineMap,
 * because the tool injects lines (a `#version` header today, dialect
 * boilerplate later) that the learner never wrote.
 *
 * All line numbers are 1-based.
 */
export class LineMap {
  /** genToSrc[i] = source line for generated line i+1, or null if injected. */
  private readonly genToSrc: readonly (number | null)[];
  private readonly srcToGen: ReadonlyMap<number, number>;

  constructor(genToSrc: (number | null)[]) {
    this.genToSrc = genToSrc;
    const back = new Map<number, number>();
    genToSrc.forEach((src, i) => {
      if (src !== null && !back.has(src)) back.set(src, i + 1);
    });
    this.srcToGen = back;
  }

  /** Source and generated code are identical. */
  static identity(lineCount: number): LineMap {
    return new LineMap(Array.from({ length: lineCount }, (_, i) => i + 1));
  }

  /** `prefixLines` injected lines, followed by the untouched source. */
  static withPrefix(prefixLines: number, sourceLineCount: number): LineMap {
    const injected: (number | null)[] = Array(prefixLines).fill(null);
    return new LineMap(injected.concat(LineMap.identity(sourceLineCount).genToSrc));
  }

  /** Source line for a generated line, or null if the tool injected it. */
  toSource(generatedLine: number): number | null {
    return this.genToSrc[generatedLine - 1] ?? null;
  }

  /** Generated line for a source line, or null if it was dropped. */
  toGenerated(sourceLine: number): number | null {
    return this.srcToGen.get(sourceLine) ?? null;
  }
}

export function countLines(text: string): number {
  return text.split('\n').length;
}
