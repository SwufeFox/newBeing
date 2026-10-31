import type { Candle } from "./types.js";
/** Source location for a parse or validation error. */
export interface FactorError {
    code: "syntax"|"validation";
    message: string;
    offset: number;
    line: number;
    column: number;
}
export interface FactorResult {
    ok: boolean;
    values: (number|null)[]|null;
    errors: FactorError[];
}
export const FACTOR_LIMITS = {
    expressionLength: 8192,
    astDepth: 64,
    window: 10000,
    computation: 10000000,
} as const;
type Node={
    k: string;
    v?: string|number|undefined;
    a?: Node;
    b?: Node;
    c?: Node;
    args?: Node[];
    defs?: [string, Node][];
    pos: number;
};
class ParseFailure extends Error {
    constructor(public pos: number, message: string, public code: "syntax"|"validation"="syntax") { super(message); }
}
class Parser {
    s: string;
    i=0;
    depth=0;
    names=new Set<string>();
    fields=new Set(["open", "high", "low", "close", "volume"]);
    defs: [
        string,
        Node
    ][]=[];
    constructor(s: string) { this.s=s; }
    ws() {
        while (/\s/.test(this.s[this.i]??"")&&this.i<this.s.length)
            this.i++;
    }
    take(x: string) {
        this.ws(); if (this.s.startsWith(x, this.i)) {
            this.i+=x.length;
            return true;
        } return false;
    }
    fail(m: string, p=this.i, c: "syntax"|"validation"="syntax"): never { throw new ParseFailure(p, m, c); }
    ident() {
        this.ws(); const m=/^[A-Za-z_][A-Za-z0-9_]*/.exec(this.s.slice(this.i)); if (!m)
            return null; const p=this.i; this.i+=m[0].length; return { s: m[0], p };
    }
    parse(): Node {
        while (true) {
            this.ws();
            const save=this.i, id=this.ident();
            if (!id) {
                this.i=save;
                break;
            }
            this.ws();
            if (this.s[this.i]==="="&&this.s[this.i+1]!=="=") {
                this.i++;
            }
            else {
                this.i=save;
                break;
            }
            if (this.fields.has(id.s))
                this.fail(`Cannot assign to candle field '${id.s}'`, id.p, "validation");
            if (this.names.has(id.s))
                this.fail(`Duplicate variable '${id.s}'`, id.p, "validation");
            const n=this.expr();
            this.names.add(id.s);
            this.defs.push([id.s, n]);
            if (!this.take(";"))
                this.fail("Expected ';' after assignment");
        }
        const n=this.expr();
        this.take(";");
        this.ws();
        if (this.i!==this.s.length)
            this.fail("Unexpected token");
        n.defs=this.defs;
        return n;
    }
    expr(min=0): Node {
        if (++this.depth>FACTOR_LIMITS.astDepth)
            this.fail("AST depth limit exceeded", this.i, "validation"); let n=this.prefix(); while (true) {
                this.ws();
                if (min===0&&this.take("?")) {
                    const condition=n;
                    const p=condition.pos;
                    const whenTrue=this.expr();
                    if (!this.take(":"))
                        this.fail("Expected ':' in conditional");
                    const whenFalse=this.expr();
                    n={ k: "cond", a: condition, b: whenTrue, c: whenFalse, pos: p };
                    continue;
                }
                const ops=["||", "&&", "==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/"];
                const op=ops.find(x => this.s.startsWith(x, this.i));
                if (!op)
                    break;
                const prec: {
                    [k: string]: number;
                }={ "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 3, ">": 3, "<=": 3, ">=": 3, "+": 4, "-": 4, "*": 5, "/": 5 };
                if (prec[op]!<min)
                    break;
                const p=this.i;
                this.i+=op.length;
                const b=this.expr(prec[op]!+1);
                n={ k: "bin", v: op, a: n, b, pos: p };
            } this.depth--; return n;
    }
    prefix(): Node {
        this.ws(); const p=this.i; if (["+", "-", "!"].some(o => this.s.startsWith(o, this.i))) {
            const op=this.s[this.i++];
            return { k: "un", v: op, a: this.expr(6), pos: p };
        } if (this.take("(")) {
            const n=this.expr();
            if (!this.take(")"))
                this.fail("Expected ')'");
            return n;
        } this.ws(); const num=/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(this.s.slice(this.i)); if (num) {
            this.i+=num[0].length;
            return { k: "num", v: Number(num[0]), pos: p };
        } const id=this.ident(); if (!id)
            this.fail("Expected expression"); if (this.take("(")) {
                const args: Node[]=[];
                if (!this.take(")")) {
                    do {
                        args.push(this.expr());
                    } while (this.take(","));
                    if (!this.take(")"))
                        this.fail("Expected ')'");
                }
                const panel=["rank", "zscore", "scale", "group_rank", "group_neutralize", "group_scale", "group_mean", "group_sum"];
                if (panel.includes(id.s))
                    this.fail(`'${id.s}' requires panel data and is unsupported`, id.p, "validation");
                if (!["ts_delay", "ts_delta", "ts_sum", "ts_mean", "ts_std_dev", "ts_min", "ts_max", "ts_rank"].includes(id.s))
                    this.fail(`Unsupported function '${id.s}'`, id.p, "validation");
                if (args.length!==2)
                    this.fail(`${id.s} expects 2 arguments`, id.p, "validation");
                return { k: "call", v: id.s, args, pos: id.p };
            } if (this.fields.has(id.s))
            return { k: "field", v: id.s, pos: id.p }; if (!this.names.has(id.s))
            this.fail(`Unknown or forward variable '${id.s}'`, id.p, "validation"); return { k: "var", v: id.s, pos: id.p };
    }
}
function loc(s: string, p: number) {
    const before = s.slice(0, p);
    const line = before.split("\n").length;
    return {
        offset: p,
        line,
        column: p - (before.lastIndexOf("\n") + 1) + 1,
    };
}
function children(n: Node): Node[] {
    return [
        ...(n.a ? [n.a] : []),
        ...(n.b ? [n.b] : []),
        ...(n.c ? [n.c] : []),
        ...(n.args ?? []),
    ];
}
function validate(n: Node) {
    if (n.k==="call") {
        const d=n.args![1]!;
        if (d.k!=="num")
            throw new ParseFailure(d.pos, "Window must be a numeric integer literal", "validation");
        if (!Number.isInteger(d.v as number)||(d.v as number)<1||(d.v as number)>FACTOR_LIMITS.window)
            throw new ParseFailure(d.pos, `Window must be an integer from 1 to ${FACTOR_LIMITS.window}`, "validation");
    } for (const child of children(n))
        validate(child);
}
/**
 * Evaluates a single-symbol time-series factor expression for each candle.
 * The supported candle fields are the single-symbol OHLCV subset: open, high,
 * low, close, and volume. Cross-sectional and panel functions are unsupported.
 *
 * `ts_delay(x, d)` reads `x[t-d]`. Rolling windows include the current candle.
 * Results are `null` during warm-up and whenever a required input is invalid;
 * rolling functions also return `null` if any value in their window is invalid.
 * `ts_std_dev` uses population standard deviation. `ts_rank` uses the average
 * rank for ties and divides that rank by the window size.
 *
 * @example
 * evaluateFactor("ts_mean(close, 5)", candles)
 */
export interface CompiledFactorPlan {
    evaluate(candles: readonly Candle[]): FactorResult;
}
export interface CompiledFactorResult {
    ok: boolean;
    plan: CompiledFactorPlan|null;
    errors: FactorError[];
}

interface EvaluationWorkspace {
    values: Float64Array;
    valid: Uint8Array;
}
const REUSABLE_WORKSPACE_CELL_LIMIT = 1_000_000;

function allocateWorkspace(cells: number): EvaluationWorkspace {
    return { values: new Float64Array(cells), valid: new Uint8Array(cells) };
}

/** Parse and validate once, then reuse the plan for independent series. */
export function compileFactor(expression: string): CompiledFactorResult {
    try {
        if (expression.length>FACTOR_LIMITS.expressionLength)
            throw new ParseFailure(FACTOR_LIMITS.expressionLength, "Expression length limit exceeded", "validation");
        const root=new Parser(expression).parse();
        const defs=new Map(root.defs ?? []);
        for (const n of defs.values()) validate(n);
        validate(root);
        const ordered: Node[]=[];
        const slotByNode=new Map<Node, number>();
        const visiting=new Set<Node>();
        const visit=(n: Node): number => {
            const known=slotByNode.get(n);
            if (known!==undefined) return known;
            // Assignment references alias their definition slot; copying a full series is unnecessary.
            if (n.k==="var") {
                const definition=defs.get(n.v as string);
                if (!definition) throw new ParseFailure(n.pos, `Unknown variable '${n.v}'`, "validation");
                const slot=visit(definition);
                slotByNode.set(n,slot);
                return slot;
            }
            if (visiting.has(n)) throw new ParseFailure(n.pos, "Cyclic variable definition", "validation");
            visiting.add(n);
            // The validated numeric window is compile-time metadata, not an evaluation node.
            if (n.k==="call") visit(n.args![0]!);
            else for (const child of children(n)) visit(child);
            visiting.delete(n);
            const slot=ordered.length;
            ordered.push(n);
            slotByNode.set(n,slot);
            return slot;
        };
        const rootSlot=visit(root);
        const inputSlots=ordered.map(n => n.k==="call" ? slotByNode.get(n.args![0]!)! : -1);
        const leftSlots=ordered.map(n => n.k==="bin" || n.k==="un" || n.k==="cond" ? slotByNode.get(n.a!)! : -1);
        const rightSlots=ordered.map(n => n.k==="bin" || n.k==="cond" ? slotByNode.get(n.b!)! : -1);
        const alternateSlots=ordered.map(n => n.k==="cond" ? slotByNode.get(n.c!)! : -1);
        const sharedWorkspace: EvaluationWorkspace = { values: new Float64Array(0), valid: new Uint8Array(0) };
        let sharedWorkspaceInUse = false;
        return {
            ok: true,
            errors: [],
            plan: {
                evaluate: candles => {
                    const cells = ordered.length * candles.length;
                    const canReuse = !sharedWorkspaceInUse && cells <= REUSABLE_WORKSPACE_CELL_LIMIT;
                    let workspace: EvaluationWorkspace;
                    if (canReuse) {
                        if (sharedWorkspace.values.length < cells) {
                            sharedWorkspace.values = new Float64Array(cells);
                            sharedWorkspace.valid = new Uint8Array(cells);
                        }
                        sharedWorkspaceInUse = true;
                        workspace = sharedWorkspace;
                    } else {
                        workspace = allocateWorkspace(cells);
                    }
                    try {
                        return evaluateParsed(expression, root, rootSlot, candles, ordered, inputSlots, leftSlots, rightSlots, alternateSlots, workspace);
                    } finally {
                        if (canReuse) sharedWorkspaceInUse = false;
                    }
                },
            },
        };
    } catch (e) {
        const x=e instanceof ParseFailure? e:new ParseFailure(0, String(e));
        return { ok: false, plan: null, errors: [{ code: x.code, message: x.message, ...loc(expression, x.pos) }] };
    }
}

/** Evaluate one plan across independent series, parsing and validating once. */
export function evaluateFactorBatch(expression: string, series: readonly (readonly Candle[])[]): FactorResult[] {
    const compiled=compileFactor(expression);
    if (!compiled.ok || !compiled.plan)
        return series.map(() => ({ ok: false, values: null, errors: compiled.errors }));
    return series.map(candles => compiled.plan!.evaluate(candles));
}

export function evaluateFactor(expression: string, candles: readonly Candle[]): FactorResult {
    const compiled=compileFactor(expression);
    return compiled.ok && compiled.plan ? compiled.plan.evaluate(candles) : { ok: false, values: null, errors: compiled.errors };
}

function evaluateParsed(expression: string, root: Node, rootSlot: number, candles: readonly Candle[], ordered: readonly Node[], inputSlots: readonly number[], leftSlots: readonly number[], rightSlots: readonly number[], alternateSlots: readonly number[], workspace: EvaluationWorkspace): FactorResult {
    try {
        const cap=FACTOR_LIMITS.computation+1;
        let work=0;
        for (const n of ordered) {
            let nodeWork=1;
            if (n.k==="call") {
                const fn=n.v as string, w=n.args![1]!.v as number;
                nodeWork=fn==="ts_delay" ? 1 : fn==="ts_delta" ? 2 : fn==="ts_std_dev" ? 2*w : w;
            }
            work=Math.min(cap, work+nodeWork);
        }
        if (Math.min(cap, work*candles.length)>FACTOR_LIMITS.computation)
            throw new ParseFailure(root.pos, `Estimated computation exceeds limit of ${FACTOR_LIMITS.computation}`, "validation");

        const length=candles.length, nodeCount=ordered.length;
        const cells=nodeCount*length;
        workspace.valid.fill(0,0,cells);
        const values=workspace.values, valid=workspace.valid;
        const rootOffset=rootSlot*length;
        for (let slot=0;slot<nodeCount;slot++) {
            const n=ordered[slot]!, outputOffset=slot*length;
            switch(n.k) {
                case "num": {
                    if(Number.isFinite(n.v)) {
                        values.fill(n.v as number,outputOffset,outputOffset+length);
                        valid.fill(1,outputOffset,outputOffset+length);
                    }
                    break;
                }
                case "field": {
                    const field=n.v as keyof Candle;
                    for(let t=0;t<length;t++) {
                        const value=candles[t]?.[field] as number;
                        if(Number.isFinite(value)) {values[outputOffset+t]=value;valid[outputOffset+t]=1;}
                    }
                    break;
                }
                case "un": {
                    const inputOffset=leftSlots[slot]!*length;
                    for(let t=0;t<length;t++) {
                        const inputIndex=inputOffset+t;
                        if(!valid[inputIndex])continue;
                        const x=values[inputIndex]!;
                        const result=n.v==="-"?-x:n.v==="!"?(x?0:1):x;
                        if(Number.isFinite(result)){values[outputOffset+t]=result;valid[outputOffset+t]=1;}
                    }
                    break;
                }
                case "cond": {
                    const conditionOffset=leftSlots[slot]!*length;
                    const trueOffset=rightSlots[slot]!*length;
                    const falseOffset=alternateSlots[slot]!*length;
                    for(let t=0;t<length;t++) {
                        const conditionIndex=conditionOffset+t;
                        if(!valid[conditionIndex])continue;
                        const source=(values[conditionIndex]!==0?trueOffset:falseOffset)+t;
                        if(valid[source]){values[outputOffset+t]=values[source]!;valid[outputOffset+t]=1;}
                    }
                    break;
                }
                case "bin": {
                    const leftOffset=leftSlots[slot]!*length,rightOffset=rightSlots[slot]!*length;
                    for(let t=0;t<length;t++) {
                        const leftIndex=leftOffset+t;
                        if(!valid[leftIndex])continue;
                        const x=values[leftIndex]!;
                        if(n.v==="&&"&&x===0){values[outputOffset+t]=0;valid[outputOffset+t]=1;continue;}
                        if(n.v==="||"&&x!==0){values[outputOffset+t]=1;valid[outputOffset+t]=1;continue;}
                        const rightIndex=rightOffset+t;
                        if(!valid[rightIndex])continue;
                        const y=values[rightIndex]!;
                        let result:number;
                        switch(n.v){case "+":result=x+y;break;case "-":result=x-y;break;case "*":result=x*y;break;case "/":result=y===0?NaN:x/y;break;case "<":result=+(x<y);break;case ">":result=+(x>y);break;case "<=":result=+(x<=y);break;case ">=":result=+(x>=y);break;case "==":result=+(x===y);break;case "!=":result=+(x!==y);break;case "&&":result=+(x!==0&&y!==0);break;default:result=+(x!==0||y!==0);}
                        if(Number.isFinite(result)){values[outputOffset+t]=result;valid[outputOffset+t]=1;}
                    }
                    break;
                }
                case "call": {
                    const fn=n.v as string,w=n.args![1]!.v as number,inputOffset=inputSlots[slot]!*length;
                    if(fn==="ts_delay") {
                        for(let t=w;t<length;t++) {
                            const source=inputOffset+t-w,destination=outputOffset+t;
                            if(valid[source]){values[destination]=values[source]!;valid[destination]=1;}
                        }
                        break;
                    }
                    if(fn==="ts_delta") {
                        for(let t=w;t<length;t++) {
                            const current=inputOffset+t,previous=inputOffset+t-w,destination=outputOffset+t;
                            if(valid[current]&&valid[previous]) {
                                const result=values[current]!-values[previous]!;
                                if(Number.isFinite(result)){values[destination]=result;valid[destination]=1;}
                            }
                        }
                        break;
                    }
                    for(let t=w-1;t<length;t++) {
                        const start=inputOffset+t-w+1,end=inputOffset+t,destination=outputOffset+t;
                        let ok=true;
                        if(fn==="ts_sum"||fn==="ts_mean") {
                            let sum=0;
                            if(w===5) {
                                if(!valid[start]||!valid[start+1]||!valid[start+2]||!valid[start+3]||!valid[start+4])continue;
                                sum+=values[start]!;
                                sum+=values[start+1]!;
                                sum+=values[start+2]!;
                                sum+=values[start+3]!;
                                sum+=values[start+4]!;
                            } else {
                                for(let index=start;index<=end;index++) {if(!valid[index]){ok=false;break;}sum+=values[index]!;}
                                if(!ok)continue;
                            }
                            const result=fn==="ts_mean"?sum/w:sum;
                            if(Number.isFinite(result)){values[destination]=result;valid[destination]=1;}
                            continue;
                        }
                        if(fn==="ts_min"||fn==="ts_max") {
                            let extreme=fn==="ts_min"?Infinity:-Infinity;
                            for(let index=start;index<=end;index++) {
                                if(!valid[index]){ok=false;break;}
                                const value=values[index]!;
                                extreme=fn==="ts_min"?Math.min(extreme,value):Math.max(extreme,value);
                            }
                            if(ok){values[destination]=extreme;valid[destination]=1;}
                            continue;
                        }
                        if(fn==="ts_std_dev") {
                            let sum=0;
                            for(let index=start;index<=end;index++) {if(!valid[index]){ok=false;break;}sum+=values[index]!;}
                            if(!ok)continue;
                            const mean=sum/w;
                            let squared=0;
                            for(let index=start;index<=end;index++) {if(!valid[index]){ok=false;break;}squared+=(values[index]!-mean)**2;}
                            if(ok) {
                                const result=Math.sqrt(squared/w);
                                if(Number.isFinite(result)){values[destination]=result;valid[destination]=1;}
                            }
                            continue;
                        }
                        if(fn==="ts_rank") {
                            const currentIndex=inputOffset+t;
                            if(!valid[currentIndex])continue;
                            const current=values[currentIndex]!;
                            let less=0,equal=0;
                            for(let index=start;index<=end;index++) {
                                if(!valid[index]){ok=false;break;}
                                const value=values[index]!;
                                if(value<current)less++;
                                if(value===current)equal++;
                            }
                            if(ok){const result=(less+(equal+1)/2)/w;if(Number.isFinite(result)){values[destination]=result;valid[destination]=1;}}
                        }
                    }
                    break;
                }
            }
        }
        const result=new Array<number|null>(length);
        for(let t=0;t<length;t++) {
            const index=rootOffset+t;
            result[t]=valid[index]?values[index]!:null;
        }
        return {ok:true,values:result,errors:[]};
    } catch(e) {
        const x=e instanceof ParseFailure?e:new ParseFailure(0,String(e));
        return {ok:false,values:null,errors:[{code:x.code,message:x.message,...loc(expression,x.pos)}]};
    }
}
