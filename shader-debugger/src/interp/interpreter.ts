import { generate, parser } from '@shaderfrog/glsl-parser';
import type { AstNode, FunctionNode, Program } from '@shaderfrog/glsl-parser/ast';
import { binary, compoundOperator, unary } from './ops';
import { callBuiltin, isBuiltin } from './builtins';
import {
  BOOL,
  FLOAT,
  GlslRuntimeError,
  VEC2,
  VEC4,
  clone,
  construct,
  convert,
  float,
  formatValue,
  indexValue,
  isArrayValue,
  isMatrix,
  isVector,
  make,
  parseTypeName,
  swizzle,
  swizzleIndices,
  truthy,
  type,
  typeName,
  valueTypeName,
  zero,
  zeroArray,
  type AnyValue,
  type ArrayValue,
  type Type,
  type Value,
} from './values';

// ---------- public types ----------

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

// ---------- internals ----------

interface Binding {
  value: AnyValue;
  isConst: boolean;
  kind: 'local' | 'param' | 'global' | 'uniform' | 'input' | 'output';
}

class Scope {
  readonly vars = new Map<string, Binding>();
  constructor(readonly parent: Scope | null) {}

  lookup(name: string): Binding | undefined {
    for (let s: Scope | null = this; s; s = s.parent) {
      const b = s.vars.get(name);
      if (b) return b;
    }
    return undefined;
  }
}

interface Frame {
  fn: string;
  root: Scope;
  scope: Scope;
  line: number;
  changed: Set<string>;
  builtins: BuiltinCall[];
  loopIters: number[];
}

interface Param {
  name: string;
  qualifier: 'in' | 'out' | 'inout';
  signature: string;
}

interface FnDef {
  name: string;
  node: FunctionNode;
  params: Param[];
  line: number;
}

type Completion = { kind: 'normal' } | { kind: 'break' } | { kind: 'continue' } | { kind: 'return'; value: AnyValue | null };

const NORMAL: Completion = { kind: 'normal' };

class DiscardSignal {}
class StepLimit {}

interface LValue {
  root: string;
  get(): AnyValue;
  set(v: AnyValue): void;
}

const DEFAULT_MAX_STEPS = 20000;
const DEFAULT_MAX_LOOP = 1000;

/** Run the fragment shader for one pixel on the CPU and record every step. */
export function traceFragment(ast: Program, inputs: TraceInputs, options: TraceOptions = {}): TraceResult {
  return new Interpreter(ast, inputs, options).run(null);
}

/**
 * Evaluate one expression (usually a call to the learner's function, e.g.
 * `rect(vec2(0.5), vec2(0.2), vec2(0.8))`) with the shader's globals set up,
 * recording every step inside it. `output` holds the expression's value.
 */
export function traceCall(ast: Program, expression: string, inputs: TraceInputs, options: TraceOptions = {}): TraceResult {
  let expr: AstNode;
  try {
    expr = parseExpression(expression);
  } catch {
    return { steps: [], output: null, discarded: false, error: { message: `Can't parse ${expression}`, line: null }, truncated: false, inputs: [] };
  }
  return new Interpreter(ast, inputs, options).run({ expr, text: expression });
}

/** Parse a standalone GLSL expression. */
export function parseExpression(expression: string): AstNode {
  const prog = parser.parse(`void __e() { __x = (${expression}); }`, { quiet: true });
  const fn = prog.program[0] as FunctionNode;
  const stmt = fn.body.statements[0] as unknown as { expression: { right: AstNode } };
  const group = stmt.expression.right as unknown as { expression: AstNode };
  return group.expression;
}

class Interpreter {
  private readonly steps: TraceStep[] = [];
  private readonly globals = new Scope(null);
  private readonly functions = new Map<string, FnDef[]>();
  private readonly macros = new Map<string, AstNode>();
  private readonly frames: Frame[] = [];
  private readonly maxSteps: number;
  private readonly maxLoop: number;
  private readonly record: boolean;
  private readonly finalExpression: string | null;
  private finalValue: AnyValue | null = null;
  private finalError: string | undefined;
  private stepCount = 0;
  private line = 0;
  private outputName: string | null = null;

  constructor(
    private readonly ast: Program,
    private readonly inputs: TraceInputs,
    options: TraceOptions,
  ) {
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.record = options.record ?? true;
    this.finalExpression = options.finalExpression ?? null;
    this.maxLoop = options.maxLoopIterations ?? DEFAULT_MAX_LOOP;
  }

  run(entry: { expr: AstNode; text: string } | null): TraceResult {
    const result: TraceResult = { steps: this.steps, output: null, discarded: false, error: null, truncated: false, inputs: [] };
    try {
      this.setupGlobals();
      result.inputs = [...this.globals.vars]
        .filter(([, b]) => b.kind === 'uniform' || b.kind === 'input')
        .map(([name, b]) => ({ name, value: clone(b.value) }));

      if (entry) {
        this.pushFrame('test', 0);
        const value = this.evaluate(entry.expr);
        if (!isArrayValue(value)) result.output = { name: entry.text, value: clone(value) };
        this.emit('end', this.steps.at(-1)?.line ?? 0, `${entry.text} = ${formatValue(value)}`);
        this.frames.pop();
        return result;
      }

      const main = this.functions.get('main')?.[0];
      if (!main) throw new GlslRuntimeError('No main() function.');
      this.invoke(main, [], main.line);
      const out = this.outputName ? this.globals.vars.get(this.outputName) : undefined;
      if (out && !isArrayValue(out.value)) result.output = { name: this.outputName!, value: clone(out.value) };
      if (this.finalExpression) {
        result.finalValue = this.finalValue;
        result.finalError = this.finalError;
      }
    } catch (e) {
      if (e instanceof DiscardSignal) {
        result.discarded = true;
      } else if (e instanceof StepLimit) {
        result.truncated = true;
        result.error = { message: `Stopped after ${this.maxSteps.toLocaleString()} steps.`, line: this.line || null };
      } else if (e instanceof GlslRuntimeError) {
        result.error = { message: e.message, line: e.line ?? (this.line || null) };
      } else {
        result.error = { message: `Interpreter error: ${(e as Error).message}`, line: this.line || null };
      }
    }
    return result;
  }

  // ---------- setup ----------

  private setupGlobals(): void {
    const [px, py] = this.inputs.pixel;
    const g = this.globals.vars;
    g.set('gl_FragCoord', { value: make(VEC4, [px + 0.5, py + 0.5, 0.5, 1]), isConst: true, kind: 'input' });
    g.set('gl_FrontFacing', { value: make(BOOL, [1]), isConst: true, kind: 'input' });
    g.set('gl_PointCoord', { value: make(VEC2, [0, 0]), isConst: true, kind: 'input' });

    this.pushFrame('<globals>', 1);
    for (const node of this.ast.program as AstNode[]) {
      if (node.type === 'function') {
        this.registerFunction(node as FunctionNode);
      } else if (node.type === 'preprocessor') {
        this.registerMacro(node);
      } else if (node.type === 'declaration_statement') {
        this.line = node.location?.start.line ?? this.line;
        const decl = (node as unknown as { declaration: AstNode }).declaration;
        if (decl.type === 'declarator_list') this.declareGlobal(decl);
      }
    }
    this.frames.pop();

    if (!this.outputName && !this.globals.vars.has('gl_FragColor')) {
      g.set('gl_FragColor', { value: zero(VEC4), isConst: false, kind: 'output' });
      this.outputName = 'gl_FragColor';
    }
  }

  private declareGlobal(list: AstNode): void {
    const l = list as unknown as {
      specified_type: { qualifiers?: { type: string; token?: string }[] | null; specifier: AstNode };
      declarations: AstNode[];
    };
    const quals = (l.specified_type.qualifiers ?? []).map((q) => q.token ?? q.type);
    const isUniform = quals.includes('uniform');
    const isOut = quals.includes('out');
    const isIn = quals.includes('in') || quals.includes('varying') || quals.includes('attribute');
    const isConst = quals.includes('const');

    for (const d of l.declarations) {
      const decl = d as unknown as { identifier: { identifier: string }; quantifier?: AstNode[] | null; initializer?: AstNode };
      const name = decl.identifier.identifier;
      const t = this.declType(l.specified_type.specifier, decl.quantifier);
      let value: AnyValue;
      if (isUniform) value = this.uniformValue(name, t);
      else if (decl.initializer) value = this.coerce(this.evaluate(decl.initializer), t);
      else value = this.zeroOf(t);
      const kind: Binding['kind'] = isUniform ? 'uniform' : isOut ? 'output' : isIn ? 'input' : 'global';
      this.globals.vars.set(name, { value, isConst: isConst || isUniform || isIn, kind });
      if (isOut && !this.outputName) this.outputName = name;
    }
  }

  private uniformValue(name: string, t: Type | ArrayDecl): AnyValue {
    const raw = this.inputs.uniforms[name];
    if ('length' in t) return zeroArray(t.elem, t.length);
    if (raw === undefined) return zero(t);
    const data = Array.isArray(raw) ? raw : [raw];
    return make(t, Array.from({ length: t.rows * t.cols }, (_, i) => data[i] ?? 0));
  }

  private registerFunction(fn: FunctionNode): void {
    if (!fn.body) return; // prototype only
    const name = fn.prototype.header.name.identifier;
    const params: Param[] = (fn.prototype.parameters ?? []).map((p) => {
      const pd = p as unknown as {
        qualifier?: { token: string }[];
        specifier: AstNode;
        identifier?: { identifier: string };
        quantifier?: AstNode[] | null;
      };
      const q = (pd.qualifier ?? []).map((k) => k.token);
      const qualifier = q.includes('inout') ? 'inout' : q.includes('out') ? 'out' : 'in';
      const t = this.declType(pd.specifier, pd.quantifier);
      return { name: pd.identifier?.identifier ?? '', qualifier, signature: signatureOf(t) };
    });
    // `void f(void)` has a single unnamed void parameter
    const realParams = params.filter((p) => p.signature !== 'void');
    const list = this.functions.get(name) ?? [];
    list.push({ name, node: fn, params: realParams, line: fn.location?.start.line ?? 0 });
    this.functions.set(name, list);
  }

  /** Object-like `#define NAME expr`. Function-like macros aren't supported. */
  private registerMacro(node: AstNode): void {
    const line = String((node as unknown as { line: string }).line ?? '');
    const m = /^#\s*define\s+([A-Za-z_]\w*)(\(?)\s*(.*)$/.exec(line.trim());
    if (!m || m[2] === '(') return;
    const body = m[3].replace(/\/\/.*$/, '').trim();
    if (!body) return;
    try {
      const prog = parser.parse(`void __m() { __x = (${body}); }`, { quiet: true });
      const fn = prog.program[0] as FunctionNode;
      const stmt = fn.body.statements[0] as unknown as { expression: { right: AstNode } };
      this.macros.set(m[1], stmt.expression.right);
    } catch {
      /* not an expression macro; leave it */
    }
  }

  // ---------- types ----------

  private declType(specifier: AstNode, nameQuantifier?: AstNode[] | null): Type | ArrayDecl {
    const spec = specifier as unknown as { specifier: { token?: string; identifier?: string; type: string }; quantifier?: AstNode[] | null };
    const inner = spec.specifier;
    const tname = inner.token ?? inner.identifier ?? '';
    if (tname === 'void') return VOID;
    if (/^[iu]?sampler/.test(tname)) return type('int'); // opaque; texture() reports it's unsupported
    const t = parseTypeName(tname);
    if (!t) {
      throw new GlslRuntimeError(inner.type === 'struct' || inner.identifier ? 'Structs aren\'t supported by the stepper yet.' : `The stepper can't handle type ${tname} yet.`);
    }
    const q = (nameQuantifier && nameQuantifier.length ? nameQuantifier : spec.quantifier) ?? null;
    if (q && q.length) {
      const sizeExpr = (q[0] as unknown as { expression?: AstNode }).expression;
      const length = sizeExpr ? (this.evaluate(sizeExpr) as Value).data[0] : 0;
      return { elem: t, length };
    }
    return t;
  }

  private zeroOf(t: Type | ArrayDecl): AnyValue {
    return 'length' in t ? zeroArray(t.elem, t.length) : zero(t);
  }

  private coerce(v: AnyValue, t: Type | ArrayDecl): AnyValue {
    if ('length' in t || isArrayValue(v)) return v;
    if (v.type.base === t.base && v.type.rows === t.rows && v.type.cols === t.cols) return v;
    if (v.data.length === t.rows * t.cols) return make(t, v.data.map((x) => convert(x, v.type.base, t.base)));
    return v;
  }

  // ---------- frames & steps ----------

  private get frame(): Frame {
    return this.frames[this.frames.length - 1];
  }

  private pushFrame(fn: string, line: number): Frame {
    const root = new Scope(this.globals);
    const frame: Frame = { fn, root, scope: root, line, changed: new Set(), builtins: [], loopIters: [] };
    this.frames.push(frame);
    return frame;
  }

  private emit(kind: StepKind, line: number, text: string): void {
    const frame = this.frame;
    if (++this.stepCount > this.maxSteps) throw new StepLimit();
    frame.line = line;
    if (!this.record) {
      frame.changed = new Set();
      frame.builtins = [];
      return;
    }

    // Locals: walk root → innermost so inner declarations shadow outer ones.
    const chain: Scope[] = [];
    for (let s: Scope | null = frame.scope; s && s !== this.globals; s = s.parent) chain.unshift(s);
    const locals = new Map<string, VarSnap>();
    for (const s of chain) for (const [name, b] of s.vars) locals.set(name, { name, value: clone(b.value) });

    const globals: VarSnap[] = [];
    for (const [name, b] of this.globals.vars) {
      if (b.kind === 'output' || b.kind === 'global') globals.push({ name, value: clone(b.value) });
    }

    this.steps.push({
      line,
      kind,
      text,
      depth: this.frames.length - 1,
      fn: frame.fn,
      stack: this.frames.map((f) => ({ fn: f.fn, line: f.line })),
      locals: [...locals.values()],
      globals,
      changed: [...frame.changed],
      builtins: frame.builtins,
      loopIter: frame.loopIters.length ? frame.loopIters[frame.loopIters.length - 1] : null,
    });
    frame.changed = new Set();
    frame.builtins = [];
  }

  private describeChanges(): string {
    const parts: string[] = [];
    for (const name of this.frame.changed) {
      const b = this.frame.scope.lookup(name);
      if (b) parts.push(`${name} = ${formatValue(b.value)}`);
    }
    return parts.join(', ');
  }

  // ---------- functions ----------

  private invoke(fn: FnDef, args: { value: AnyValue; lvalue: LValue | null }[], callLine: number): AnyValue | null {
    if (this.frames.length > 64) throw new GlslRuntimeError('Too many nested calls (GLSL has no recursion).');
    const callerLine = callLine;
    const frame = this.pushFrame(fn.name, fn.line);
    fn.params.forEach((p, i) => {
      const a = args[i];
      const value = p.qualifier === 'out' ? zeroLike(a.value) : clone(a.value);
      frame.root.vars.set(p.name, { value, isConst: false, kind: 'param' });
    });
    if (fn.name !== 'main' || this.frames.length > 1) {
      const sig = fn.params.map((p, i) => `${p.name} = ${formatValue(args[i].value)}`).join(', ');
      this.emit('call', fn.line, `${fn.name}(${sig})`);
    }

    let completion: Completion = NORMAL;
    try {
      completion = this.execBlock(fn.node.body.statements as AstNode[], frame.root);
      if (this.frames.length === 1 && this.finalExpression) {
        try {
          this.finalValue = clone(this.evaluate(parseExpression(this.finalExpression)));
        } catch (e) {
          this.finalError = (e as Error).message;
        }
      }
      if (this.frames.length === 1) {
        // Entry point finished: one last step showing the output.
        const out = this.outputName ? this.globals.vars.get(this.outputName) : undefined;
        const rb = (fn.node.body as unknown as { rb?: { location?: { start: { line: number } } } }).rb;
        const endLine = rb?.location?.start.line ?? fn.line;
        this.emit('end', endLine, out ? `${this.outputName} = ${formatValue(out.value)}` : 'done');
      }
    } finally {
      // copy out/inout parameters back to the caller's variables
      const outs = fn.params.map((p, i) => ({ p, a: args[i], v: frame.root.vars.get(p.name)!.value }));
      this.frames.pop();
      if (this.frames.length) {
        for (const { p, a, v } of outs) if (p.qualifier !== 'in' && a.lvalue) a.lvalue.set(v);
        this.line = callerLine;
      }
    }
    return completion.kind === 'return' ? completion.value : null;
  }

  private callUser(name: string, argNodes: AstNode[], line: number): AnyValue | null {
    const overloads = this.functions.get(name)!;
    const args = argNodes.map((n) => {
      const lv = isLValueNode(n) ? this.tryLValue(n) : null;
      return { value: lv ? lv.get() : this.evaluate(n), lvalue: lv };
    });
    const sig = args.map((a) => valueTypeName(a.value)).join(',');
    const fn =
      overloads.find((o) => o.params.map((p) => p.signature).join(',') === sig) ??
      overloads.find((o) => o.params.length === args.length);
    if (!fn) throw new GlslRuntimeError(`No ${name}() takes (${sig}).`, line);
    return this.invoke(fn, args, line);
  }

  // ---------- statements ----------

  private execBlock(statements: AstNode[], scope: Scope): Completion {
    const frame = this.frame;
    const saved = frame.scope;
    frame.scope = scope;
    try {
      for (const s of statements) {
        const c = this.exec(s);
        if (c.kind !== 'normal') return c;
      }
      return NORMAL;
    } finally {
      frame.scope = saved;
    }
  }

  private exec(node: AstNode): Completion {
    const line = node.location?.start.line ?? this.line;
    this.line = line;
    this.frame.line = line;

    switch (node.type) {
      case 'compound_statement':
        return this.execBlock((node as unknown as { statements: AstNode[] }).statements, new Scope(this.frame.scope));

      case 'declaration_statement': {
        const decl = (node as unknown as { declaration: AstNode }).declaration;
        if (decl.type === 'declarator_list') this.declareLocal(decl);
        this.emit('statement', line, this.describeChanges());
        return NORMAL;
      }

      case 'expression_statement': {
        const expr = (node as unknown as { expression: AstNode | null }).expression;
        if (expr) this.evaluate(expr);
        this.emit('statement', line, this.describeChanges());
        return NORMAL;
      }

      case 'if_statement': {
        const n = node as unknown as { condition: AstNode; body: AstNode; else: AstNode[] | null };
        const cond = truthy(this.evaluate(n.condition) as Value);
        this.emit('branch', line, `if (${exprText(n.condition)}) → ${cond}`);
        if (cond) return this.execScoped(n.body);
        const elseBody = n.else?.find((x) => x.type !== 'keyword');
        return elseBody ? this.execScoped(elseBody) : NORMAL;
      }

      case 'for_statement':
        return this.execFor(node, line);

      case 'while_statement': {
        const n = node as unknown as { condition: AstNode; body: AstNode };
        return this.loop(line, () => this.evaluate(n.condition) as Value, exprText(n.condition), n.body, null, false);
      }

      case 'do_statement': {
        const n = node as unknown as { expression: AstNode; body: AstNode };
        return this.loop(line, () => this.evaluate(n.expression) as Value, exprText(n.expression), n.body, null, true);
      }

      case 'return_statement': {
        const expr = (node as unknown as { expression: AstNode | null }).expression;
        const value = expr ? this.evaluate(expr) : null;
        this.emit('return', line, value ? `return ${formatValue(value)}` : 'return');
        return { kind: 'return', value };
      }

      case 'break_statement':
        this.emit('jump', line, 'break');
        return { kind: 'break' };

      case 'continue_statement':
        this.emit('jump', line, 'continue');
        return { kind: 'continue' };

      case 'discard_statement':
        this.emit('discard', line, 'discard: this pixel is thrown away');
        throw new DiscardSignal();

      case 'switch_statement':
        throw new GlslRuntimeError('switch isn\'t supported by the stepper yet.', line);

      case 'preprocessor':
        return NORMAL;

      default:
        throw new GlslRuntimeError(`The stepper can't run a ${node.type} yet.`, line);
    }
  }

  /** if/loop bodies get their own scope even without braces. */
  private execScoped(body: AstNode): Completion {
    if (body.type === 'compound_statement') return this.exec(body);
    return this.execBlock([body], new Scope(this.frame.scope));
  }

  private execFor(node: AstNode, line: number): Completion {
    const n = node as unknown as { init: AstNode | null; condition: AstNode | null; operation: AstNode | null; body: AstNode };
    const frame = this.frame;
    const saved = frame.scope;
    frame.scope = new Scope(saved);
    try {
      if (n.init) {
        if (n.init.type === 'declarator_list') this.declareLocal(n.init);
        else if (n.init.type === 'expression_statement') {
          const e = (n.init as unknown as { expression: AstNode | null }).expression;
          if (e) this.evaluate(e);
        } else this.evaluate(n.init);
        this.emit('statement', line, this.describeChanges());
      }
      const cond = n.condition ? conditionExpr(n.condition) : null;
      return this.loop(
        line,
        () => (cond ? (this.evaluate(cond) as Value) : make(BOOL, [1])),
        cond ? exprText(cond) : 'true',
        n.body,
        n.operation,
        false,
      );
    } finally {
      frame.scope = saved;
    }
  }

  private loop(
    line: number,
    test: () => Value,
    testText: string,
    body: AstNode,
    operation: AstNode | null,
    testAfter: boolean,
  ): Completion {
    const frame = this.frame;
    let pass = 0;
    frame.loopIters.push(0);
    try {
      for (;;) {
        if (!testAfter || pass > 0) {
          const ok = truthy(test());
          frame.loopIters[frame.loopIters.length - 1] = ok ? pass + 1 : pass;
          this.emit('loop', line, ok ? `${testText} → true · pass ${pass + 1}` : `${testText} → false · loop ends`);
          if (!ok) return NORMAL;
        }
        pass++;
        if (pass > this.maxLoop) {
          throw new GlslRuntimeError(`This loop ran more than ${this.maxLoop.toLocaleString()} times, so the stepper stopped it.`, line);
        }
        frame.loopIters[frame.loopIters.length - 1] = pass;
        const c = this.execScoped(body);
        if (c.kind === 'break') return NORMAL;
        if (c.kind === 'return') return c;
        if (operation) {
          this.line = line;
          this.evaluate(operation);
          this.emit('loop', line, this.describeChanges());
        }
      }
    } finally {
      frame.loopIters.pop();
    }
  }

  private declareLocal(list: AstNode): void {
    const l = list as unknown as {
      specified_type: { qualifiers?: { token?: string }[] | null; specifier: AstNode };
      declarations: AstNode[];
    };
    const isConst = (l.specified_type.qualifiers ?? []).some((q) => q.token === 'const');
    for (const d of l.declarations) {
      const decl = d as unknown as { identifier: { identifier: string }; quantifier?: AstNode[] | null; initializer?: AstNode };
      const name = decl.identifier.identifier;
      const t = this.declType(l.specified_type.specifier, decl.quantifier);
      const value = decl.initializer ? this.coerce(this.evaluate(decl.initializer), t) : this.zeroOf(t);
      this.frame.scope.vars.set(name, { value: clone(value), isConst, kind: 'local' });
      this.frame.changed.add(name);
    }
  }

  // ---------- expressions ----------

  private evaluate(node: AstNode): AnyValue {
    switch (node.type) {
      case 'float_constant':
        return float(parseFloat(String((node as unknown as { token: string }).token).replace(/[fF]$/, '')));
      case 'int_constant':
      case 'uint_constant':
        return parseIntLiteral(String((node as unknown as { token: string }).token));
      case 'bool_constant':
        return make(BOOL, [(node as unknown as { token: string }).token === 'true' ? 1 : 0]);

      case 'identifier': {
        const name = (node as unknown as { identifier: string }).identifier;
        const b = this.frame.scope.lookup(name);
        if (b) return b.value;
        const macro = this.macros.get(name);
        if (macro) return this.evaluate(macro);
        throw new GlslRuntimeError(`Unknown variable ${name}.`);
      }

      case 'group':
        return this.evaluate((node as unknown as { expression: AstNode }).expression);

      case 'binary': {
        const n = node as unknown as { operator: { literal: string }; left: AstNode; right: AstNode };
        const op = n.operator.literal;
        if (op === ',') {
          this.evaluate(n.left);
          return this.evaluate(n.right);
        }
        if (op === '&&' || op === '||') {
          const l = truthy(this.evaluate(n.left) as Value);
          if (op === '&&' && !l) return make(BOOL, [0]);
          if (op === '||' && l) return make(BOOL, [1]);
          return make(BOOL, [truthy(this.evaluate(n.right) as Value) ? 1 : 0]);
        }
        return binary(op, this.evaluate(n.left) as Value, this.evaluate(n.right) as Value);
      }

      case 'unary': {
        const n = node as unknown as { operator: { literal: string }; expression: AstNode };
        const op = n.operator.literal;
        if (op === '++' || op === '--') {
          const lv = this.lvalue(n.expression);
          const next = binary(op === '++' ? '+' : '-', lv.get() as Value, oneLike(lv.get() as Value));
          lv.set(next);
          return next;
        }
        return unary(op, this.evaluate(n.expression) as Value);
      }

      case 'ternary': {
        const n = node as unknown as { expression: AstNode; left: AstNode; right: AstNode };
        return truthy(this.evaluate(n.expression) as Value) ? this.evaluate(n.left) : this.evaluate(n.right);
      }

      case 'assignment': {
        const n = node as unknown as { left: AstNode; operator: { literal: string }; right: AstNode };
        const rhs = this.evaluate(n.right);
        const lv = this.lvalue(n.left);
        const op = compoundOperator(n.operator.literal);
        const value = op ? binary(op, lv.get() as Value, rhs as Value) : rhs;
        lv.set(clone(value));
        return value;
      }

      case 'postfix': {
        const { base, ops } = flattenPostfix(node);
        const last = ops[ops.length - 1];
        if (last.type === 'literal' && (last.literal === '++' || last.literal === '--')) {
          const lv = this.lvalueChain(base, ops.slice(0, -1));
          const before = lv.get() as Value;
          lv.set(binary(last.literal === '++' ? '+' : '-', before, oneLike(before)));
          return before;
        }
        let v = this.evaluate(base);
        for (const op of ops) v = this.applyPostfix(v, op);
        return v;
      }

      case 'function_call':
        return this.evaluateCall(node);

      default:
        throw new GlslRuntimeError(`The stepper can't evaluate a ${node.type} yet.`);
    }
  }

  private evaluateCall(node: AstNode): AnyValue {
    const n = node as unknown as { identifier: AstNode; args: AstNode[] };
    const args = (n.args ?? []).filter((a) => !(a.type === 'literal' && (a as unknown as { literal: string }).literal === ','));
    const id = n.identifier as unknown as {
      type: string;
      identifier?: string;
      specifier?: { token?: string; identifier?: string };
      quantifier?: AstNode[] | null;
    };

    // The parser can't tell `sq(1.0)` from a struct constructor, so user
    // function calls arrive as type_specifier(type_name). Route by name.
    const specName = id.type === 'type_specifier' ? id.specifier?.token ?? id.specifier?.identifier ?? '' : '';
    const isCall =
      id.type !== 'type_specifier' ||
      (!parseTypeName(specName) && !id.quantifier?.length && (this.functions.has(specName) || isBuiltin(specName)));

    // Constructors: vec3(...), float[3](...)
    if (!isCall) {
      const tname = specName;
      const t = parseTypeName(tname);
      if (!t) throw new GlslRuntimeError(tname ? `The stepper can't construct ${tname} yet (structs come later).` : 'Unknown constructor.');
      const values = args.map((a) => this.evaluate(a));
      if (id.quantifier && id.quantifier.length) {
        return { elem: t, items: values.map((v) => this.coerce(v, t) as Value) } satisfies ArrayValue;
      }
      return construct(t, values);
    }

    const name = id.type === 'type_specifier' ? specName : id.identifier ?? '';
    const line = this.line;
    if (this.functions.has(name)) {
      const result = this.callUser(name, args, line);
      if (!result) return zero(FLOAT); // void call used as a statement
      return result;
    }
    if (isBuiltin(name)) {
      const values = args.map((a) => this.evaluate(a) as Value);
      const result = callBuiltin(name, values);
      this.frame.builtins.push({ name, args: values.map(formatValue), result: formatValue(result) });
      return result;
    }
    const t = parseTypeName(name);
    if (t) return construct(t, args.map((a) => this.evaluate(a)));
    throw new GlslRuntimeError(`Unknown function ${name}().`);
  }

  private applyPostfix(v: AnyValue, op: PostOp): AnyValue {
    switch (op.type) {
      case 'field_selection': {
        const sel = op.selection?.identifier ?? op.selection?.literal ?? '';
        if (isArrayValue(v)) throw new GlslRuntimeError(`Arrays have no .${sel}.`);
        return swizzle(v, sel);
      }
      case 'quantifier':
        return indexAny(v, (this.evaluate(op.expression!) as Value).data[0]);
      case 'function_call':
        if (isArrayValue(v)) return make(type('int'), [v.items.length]); // array.length()
    }
    throw new GlslRuntimeError(`The stepper can't evaluate this ${op.type} yet.`);
  }

  // ---------- lvalues ----------

  /** `m[1].x = …`: wrap the base lvalue once per postfix operation. */
  private lvalueChain(baseNode: AstNode, ops: PostOp[]): LValue {
    let lv = this.lvalue(baseNode);
    for (const op of ops) lv = this.wrapLValue(lv, op);
    return lv;
  }

  private wrapLValue(base: LValue, op: PostOp): LValue {
    if (op.type === 'field_selection') {
      const sel = op.selection?.identifier ?? op.selection?.literal ?? '';
      const idx = swizzleIndices(sel);
      if (!idx) throw new GlslRuntimeError(`Can't assign to .${sel}.`);
      return {
        root: base.root,
        get: () => swizzle(base.get() as Value, sel),
        set: (v) => {
          const cur = clone(base.get() as Value);
          idx.forEach((component, k) => (cur.data[component] = (v as Value).data[k]));
          base.set(cur);
        },
      };
    }
    if (op.type === 'quantifier') {
      const i = (this.evaluate(op.expression!) as Value).data[0];
      return {
        root: base.root,
        get: () => indexAny(base.get(), i),
        set: (v) => {
          const cur = clone(base.get());
          if (isArrayValue(cur)) {
            if (i < 0 || i >= cur.items.length) throw new GlslRuntimeError(`Index ${i} is out of range.`);
            cur.items[i] = v as Value;
          } else if (isMatrix(cur.type)) {
            const rows = cur.type.rows;
            (v as Value).data.forEach((x, r) => (cur.data[i * rows + r] = x));
          } else if (isVector(cur.type)) {
            cur.data[i] = (v as Value).data[0];
          }
          base.set(cur);
        },
      };
    }
    throw new GlslRuntimeError('Can\'t assign to this expression.');
  }

  private tryLValue(node: AstNode): LValue | null {
    try {
      return this.lvalue(node);
    } catch {
      return null;
    }
  }

  private lvalue(node: AstNode): LValue {
    if (node.type === 'group') return this.lvalue((node as unknown as { expression: AstNode }).expression);

    if (node.type === 'identifier') {
      const name = (node as unknown as { identifier: string }).identifier;
      const binding = this.frame.scope.lookup(name);
      if (!binding) throw new GlslRuntimeError(`Unknown variable ${name}.`);
      return {
        root: name,
        get: () => binding.value,
        set: (v) => {
          if (binding.isConst) throw new GlslRuntimeError(`${name} is read-only.`);
          binding.value = v;
          this.frame.changed.add(name);
        },
      };
    }

    if (node.type === 'postfix') {
      const { base, ops } = flattenPostfix(node);
      return this.lvalueChain(base, ops);
    }

    throw new GlslRuntimeError('Can\'t assign to this expression.');
  }
}

// ---------- helpers ----------

interface ArrayDecl {
  elem: Type;
  length: number;
}

interface PostOp {
  type: string;
  literal?: string;
  selection?: { identifier?: string; literal?: string };
  expression?: AstNode;
}

/**
 * The parser nests postfix chains oddly: `m[1][1]` is
 * postfix(m, postfix([1], [1])). Flatten to a base plus ordered operations.
 */
function flattenPostfix(node: AstNode): { base: AstNode; ops: PostOp[] } {
  const n = node as unknown as { expression: AstNode; postfix: AstNode };
  const ops: PostOp[] = [];
  const collect = (p: AstNode) => {
    if (p.type === 'postfix') {
      const pp = p as unknown as { expression: AstNode; postfix: AstNode };
      collect(pp.expression);
      collect(pp.postfix);
    } else ops.push(p as unknown as PostOp);
  };
  collect(n.postfix);
  return { base: n.expression, ops };
}

const VOID = { elem: FLOAT, length: -1 } as unknown as Type;

function signatureOf(t: Type | ArrayDecl): string {
  if (t === VOID) return 'void';
  if ('length' in t) return `${typeName(t.elem)}[${t.length}]`;
  return typeName(t);
}

function parseIntLiteral(token: string): Value {
  const unsigned = /[uU]$/.test(token);
  const body = token.replace(/[uU]$/, '');
  let n: number;
  if (/^0[xX]/.test(body)) n = parseInt(body.slice(2), 16);
  else if (/^0\d/.test(body)) n = parseInt(body, 8);
  else n = parseInt(body, 10);
  return make(type(unsigned ? 'uint' : 'int'), [n]);
}

function indexAny(base: AnyValue, i: number): Value {
  if (isArrayValue(base)) {
    if (i < 0 || i >= base.items.length) throw new GlslRuntimeError(`Index ${i} is out of range for an array of ${base.items.length}.`);
    return base.items[i];
  }
  return indexValue(base, i);
}

function oneLike(v: Value): Value {
  return make(type(v.type.base), [1]);
}

function zeroLike(v: AnyValue): AnyValue {
  return isArrayValue(v) ? zeroArray(v.elem, v.items.length) : zero(v.type);
}

function isLValueNode(n: AstNode): boolean {
  return n.type === 'identifier' || n.type === 'postfix' || n.type === 'group';
}

/** The for-loop condition can be a `condition_expression` wrapper. */
function conditionExpr(node: AstNode): AstNode {
  const n = node as unknown as { type: string; expression?: AstNode };
  if (n.type === 'expression_statement' && n.expression) return n.expression;
  return node;
}

function exprText(node: AstNode): string {
  try {
    return generate(node).replace(/\s+/g, ' ').trim();
  } catch {
    return '…';
  }
}

export { BOOL, FLOAT };
