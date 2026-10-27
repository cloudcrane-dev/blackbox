import ts from "typescript";

// Pure TypeScript rules as CEL. Reads a module with the TypeScript compiler's own
// parser and translates what's provably pure: exported literal constants, and
// functions whose body is a chain of `if (cond) return value;`, `const x = value;`
// and a final `return value;`, over parameters, constants and other functions
// in the same file, with comparisons, arithmetic, && || !, ?:, Math.max/min and
// null checks. `const { a, b } = opts;` reads fields of a parameter. Anything
// else (loops, mutation, I/O, other modules) isn't translated: it's reported, so
// a person (or a hint) supplies the rule instead.
//
// Each result carries the lines it came from, for provenance.

export type Translated = {
  consts: { name: string; value: number | string | boolean; lines: [number, number] }[];
  functions: { name: string; params: string[]; cel: string; lines: [number, number] }[];
  skipped: { name: string; why: string; lines: [number, number] }[];
};

class Untranslatable extends Error {}
const no = (why: string): never => {
  throw new Untranslatable(why);
};

const BINARY: Partial<Record<ts.SyntaxKind, string>> = {
  [ts.SyntaxKind.PlusToken]: "+",
  [ts.SyntaxKind.MinusToken]: "-",
  [ts.SyntaxKind.AsteriskToken]: "*",
  [ts.SyntaxKind.PercentToken]: "%",
  [ts.SyntaxKind.LessThanToken]: "<",
  [ts.SyntaxKind.LessThanEqualsToken]: "<=",
  [ts.SyntaxKind.GreaterThanToken]: ">",
  [ts.SyntaxKind.GreaterThanEqualsToken]: ">=",
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: "==",
  [ts.SyntaxKind.EqualsEqualsToken]: "==",
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "!=",
  [ts.SyntaxKind.ExclamationEqualsToken]: "!=",
  [ts.SyntaxKind.AmpersandAmpersandToken]: "&&",
  [ts.SyntaxKind.BarBarToken]: "||",
};

type Scope = { params: Set<string>; fields: Map<string, string>; locals: Set<string>; known: Set<string> };

function expr(n: ts.Expression, s: Scope): string {
  if (ts.isParenthesizedExpression(n)) return `(${expr(n.expression, s)})`;
  if (ts.isNumericLiteral(n)) return n.text;
  if (ts.isStringLiteral(n)) return JSON.stringify(n.text);
  if (n.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (n.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (n.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isIdentifier(n)) {
    if (n.text === "undefined") return "null";
    if (s.fields.has(n.text)) return s.fields.get(n.text)!;
    if (s.params.has(n.text) || s.locals.has(n.text) || s.known.has(n.text)) return n.text;
    return no(`uses ${n.text}, which isn't a parameter or something in this file`);
  }
  if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && s.params.has(n.expression.text)) return `${n.expression.text}.${n.name.text}`;
  if (ts.isPrefixUnaryExpression(n)) {
    if (n.operator === ts.SyntaxKind.ExclamationToken) return `!${expr(n.operand, s)}`;
    if (n.operator === ts.SyntaxKind.MinusToken) return `-${expr(n.operand, s)}`;
    return no("a ++ or -- changes a value");
  }
  if (ts.isBinaryExpression(n)) {
    if (n.operatorToken.kind === ts.SyntaxKind.SlashToken) return no("division: CEL divides whole numbers differently");
    const op = BINARY[n.operatorToken.kind];
    if (!op) return no(`the ${ts.tokenToString(n.operatorToken.kind) ?? "operator"} operator`);
    return `${expr(n.left, s)} ${op} ${expr(n.right, s)}`;
  }
  if (ts.isConditionalExpression(n)) return `${expr(n.condition, s)} ? ${expr(n.whenTrue, s)} : ${expr(n.whenFalse, s)}`;
  if (ts.isCallExpression(n)) {
    const args = n.arguments.map((a) => expr(a, s));
    const callee = n.expression;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Math") {
      const m = callee.name.text;
      if ((m === "max" || m === "min") && args.length === 2) {
        const [a, b] = args;
        return `(${a} ${m === "max" ? ">" : "<"} ${b} ? ${a} : ${b})`;
      }
      return no(`Math.${m}`);
    }
    if (ts.isIdentifier(callee) && s.known.has(callee.text)) return `${callee.text}(${args.join(", ")})`;
    return no(`calls ${callee.getText()}, which isn't in this file`);
  }
  return no(`a ${ts.SyntaxKind[n.kind]}`);
}

/** A function body as one CEL expression, built from its last statement back. */
function body(statements: readonly ts.Statement[], s: Scope): string {
  const [first, ...rest] = statements;
  if (!first) return no("it can end without returning");
  if (ts.isReturnStatement(first)) {
    if (!first.expression) return no("it returns nothing");
    return expr(first.expression, s);
  }
  if (ts.isIfStatement(first)) {
    const thenReturn = ts.isBlock(first.thenStatement) ? first.thenStatement.statements : [first.thenStatement];
    if (first.elseStatement) {
      const elseReturn = ts.isBlock(first.elseStatement) ? first.elseStatement.statements : [first.elseStatement];
      return `${expr(first.expression, s)} ? ${body(thenReturn, s)} : ${body([...elseReturn, ...rest], s)}`;
    }
    return `${expr(first.expression, s)} ? ${body(thenReturn, s)} : ${body(rest, s)}`;
  }
  if (ts.isVariableStatement(first) && first.declarationList.flags & ts.NodeFlags.Const) {
    const [d] = first.declarationList.declarations;
    if (!d || first.declarationList.declarations.length !== 1 || !d.initializer) return no("a declaration it can't follow");
    // const { a, b } = opts;  →  a and b read opts.a and opts.b
    if (ts.isObjectBindingPattern(d.name) && ts.isIdentifier(d.initializer) && s.params.has(d.initializer.text)) {
      for (const el of d.name.elements) {
        if (!ts.isIdentifier(el.name) || el.initializer || el.dotDotDotToken) return no("a destructuring it can't follow");
        const field = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
        s.fields.set(el.name.text, `${d.initializer.text}.${field}`);
      }
      return body(rest, s);
    }
    if (!ts.isIdentifier(d.name)) return no("a declaration it can't follow");
    const value = expr(d.initializer, s);
    s.locals.add(d.name.text);
    return `cel.bind(${d.name.text}, ${value}, ${body(rest, s)})`;
  }
  return no(`a ${ts.SyntaxKind[first.kind]} statement`);
}

const linesOf = (sf: ts.SourceFile, n: ts.Node): [number, number] => [
  sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
  sf.getLineAndCharacterOfPosition(n.getEnd()).line + 1,
];

/** The pure rules in a TypeScript module, as CEL, with what couldn't be translated and why. */
export function translateModule(source: string, file = "module.ts"): Translated {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Translated = { consts: [], functions: [], skipped: [] };
  const known = new Set<string>();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) known.add(st.name.text);
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) known.add(d.name.text);
  }
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st) && st.declarationList.flags & ts.NodeFlags.Const) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const i = d.initializer;
        const literal = ts.isNumericLiteral(i)
          ? Number(i.text)
          : ts.isStringLiteral(i)
            ? i.text
            : i.kind === ts.SyntaxKind.TrueKeyword
              ? true
              : i.kind === ts.SyntaxKind.FalseKeyword
                ? false
                : undefined;
        if (literal !== undefined) out.consts.push({ name: d.name.text, value: literal, lines: linesOf(sf, st) });
        else out.skipped.push({ name: d.name.text, why: "a constant that isn't a plain value", lines: linesOf(sf, st) });
      }
    }
    if (ts.isFunctionDeclaration(st) && st.name && st.body) {
      const name = st.name.text;
      try {
        if (st.asteriskToken || st.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) no("it's async or a generator");
        const params = st.parameters.map((p) =>
          ts.isIdentifier(p.name) && !p.initializer && !p.dotDotDotToken ? p.name.text : no("a parameter with a default, rest or pattern"),
        );
        const scope: Scope = { params: new Set(params), fields: new Map(), locals: new Set(), known };
        out.functions.push({ name, params, cel: body(st.body.statements, scope), lines: linesOf(sf, st) });
      } catch (e) {
        if (!(e instanceof Untranslatable)) throw e;
        out.skipped.push({ name, why: e.message, lines: linesOf(sf, st) });
      }
    }
  }
  return out;
}
