import type { AnyValue, Value } from './values';

/**
 * What a trace looks like: the interpreter's output, read by the Debugger,
 * the checker, predictions and the tutor snapshot.
 */

export interface TraceInputs {
  /** Pixel coordinates (integers, origin bottom-left); gl_FragCoord gets +0.5. */
  pixel: [number, number];
  /** Uniform values by name. Missing uniforms are 0, like the GPU's default. */
  uniforms: Record<string, number | number[]>;
}

export interface TraceOptions {
  /** Stop recording after this many steps. */
  maxSteps?: number;
  /**
   * Record a snapshot per step (default true). Turn off when only the final
   * output matters, e.g. rendering a whole image on the CPU.
   */
  record?: boolean;
  /**
   * Evaluate this expression in main()'s scope just before it returns
   * (e.g. `uv.x` or `mix(a, b, 0.25).r`). Result lands in `finalValue`.
   */
  finalExpression?: string;
  /** Stop a single loop after this many passes. */
  maxLoopIterations?: number;
}

export interface VarSnap {
  name: string;
  value: AnyValue;
}

export interface BuiltinCall {
  name: string;
  args: string[];
  result: string;
}

export type StepKind = 'statement' | 'branch' | 'loop' | 'call' | 'return' | 'jump' | 'discard' | 'end';

export interface StackEntry {
  fn: string;
  line: number;
}

export interface TraceStep {
  line: number;
  kind: StepKind;
  /** Short human description, e.g. `d = -0.421` or `i < 3 → true`. */
  text: string;
  /** Call depth: 0 = main. */
  depth: number;
  fn: string;
  stack: StackEntry[];
  /** Visible locals in the current function, after this step. */
  locals: VarSnap[];
  /** Writable globals (outputs, globals you declared), after this step. */
  globals: VarSnap[];
  /** Variables written during this step. */
  changed: string[];
  /** Built-in calls evaluated during this step, inputs → output. */
  builtins: BuiltinCall[];
  /** 1-based pass of the innermost loop, if inside one. */
  loopIter: number | null;
}

export interface TraceResult {
  steps: TraceStep[];
  /** Final value of the shader's output (`out vec4`, or gl_FragColor). */
  output: { name: string; value: Value } | null;
  discarded: boolean;
  error: { message: string; line: number | null } | null;
  /** True when the step cap stopped the run. */
  truncated: boolean;
  /** Uniforms and built-in inputs, for display. */
  inputs: VarSnap[];
  /** Value of `options.finalExpression`, if asked for. */
  finalValue?: AnyValue | null;
  finalError?: string;
}
