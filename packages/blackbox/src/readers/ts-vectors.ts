import ts from "typescript";

// Behaviour vectors from a module's own tests, read, never run: every
// `assert.equal(fn(<literals>), <literal>)` (and strictEqual, deepEqual, and
// expect(fn(...)).toBe / toEqual) whose arguments and expected value are plain
// literals. Calls inside loops or with computed arguments are left out (the
// report counts them). Reading rather than running means no partner code
// executes on this machine.

export type Vector = { fn: string; in: unknown[]; out: unknown; line: number };

function literal(n: ts.Expression): { ok: true; value: unknown } | { ok: false } {
  if (ts.isParenthesizedExpression(n)) return literal(n.expression);
  if (ts.isNumericLiteral(n)) return { ok: true, value: Number(n.text) };
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return { ok: true, value: n.text };
  if (n.kind === ts.SyntaxKind.TrueKeyword) return { ok: true, value: true };
  if (n.kind === ts.SyntaxKind.FalseKeyword) return { ok: true, value: false };
  if (n.kind === ts.SyntaxKind.NullKeyword) return { ok: true, value: null };
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand))
    return { ok: true, value: -Number(n.operand.text) };
  if (ts.isArrayLiteralExpression(n)) {
    const items = n.elements.map((e) => literal(e as ts.Expression));
    return items.every((i) => i.ok) ? { ok: true, value: items.map((i) => (i as { value: unknown }).value) } : { ok: false };
  }
  if (ts.isObjectLiteralExpression(n)) {
    const out: Record<string, unknown> = {};
    for (const p of n.properties) {
      if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) return { ok: false };
      const v = literal(p.initializer);
      if (!v.ok) return { ok: false };
      out[p.name.text] = v.value;
    }
    return { ok: true, value: out };
  }
  return { ok: false };
}

const inLoop = (n: ts.Node): boolean => {
  for (let p = n.parent; p; p = p.parent)
    if (ts.isForStatement(p) || ts.isForOfStatement(p) || ts.isForInStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) return true;
  return false;
};

/** Literal vectors for `functions` found in a test file, and how many calls had to be left out. */
export function harvestVectors(source: string, functions: Set<string>, file = "test.ts"): { vectors: Vector[]; leftOut: number } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const vectors: Vector[] = [];
  let leftOut = 0;
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      let actual: ts.Expression | undefined;
      let expected: ts.Expression | undefined;
      const callee = n.expression;
      // assert.equal(actual, expected) and friends
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "assert" &&
        /^(equal|strictEqual|deepEqual|deepStrictEqual)$/.test(callee.name.text)
      ) {
        [actual, expected] = n.arguments;
      }
      // expect(actual).toBe(expected) / toEqual / toStrictEqual
      if (
        ts.isPropertyAccessExpression(callee) &&
        /^(toBe|toEqual|toStrictEqual)$/.test(callee.name.text) &&
        ts.isCallExpression(callee.expression) &&
        ts.isIdentifier(callee.expression.expression) &&
        callee.expression.expression.text === "expect"
      ) {
        actual = callee.expression.arguments[0];
        expected = n.arguments[0];
      }
      if (actual && expected && ts.isCallExpression(actual) && ts.isIdentifier(actual.expression) && functions.has(actual.expression.text)) {
        const args = actual.arguments.map(literal);
        const out = literal(expected);
        if (!inLoop(n) && args.every((a) => a.ok) && out.ok) {
          vectors.push({
            fn: actual.expression.text,
            in: args.map((a) => (a as { value: unknown }).value),
            out: out.value,
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          });
        } else leftOut++;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { vectors, leftOut };
}
