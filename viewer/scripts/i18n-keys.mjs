// Every interface string that can reach the translator, read from the source with the TypeScript parser:
// literal keys of t()/tr() calls (both branches of a conditional count), and the label tables translated
// at render time (actor/outcome labels, moves, tiers, behaviors, measurement verdicts, record types, story verbs).
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';

const sourceDir = new URL('../src/trajectory/', import.meta.url);
const TABLES = new Set(['labels', 'moveLabels', 'tierLabels', 'verbs', 'doing', 'connectionLabels']);

export function interfaceKeys() {
  const keys = new Set();
  const results = (node, out) => {
    if (!node) return;
    if (ts.isStringLiteralLike(node)) out.push(node.text);
    else if (ts.isConditionalExpression(node)) { results(node.whenTrue, out); results(node.whenFalse, out); }
    else if (ts.isParenthesizedExpression(node)) results(node.expression, out);
  };
  for (const name of readdirSync(sourceDir).filter(n => /\.tsx?$/.test(n))) {
    const ast = ts.createSourceFile(name, readFileSync(new URL(name, sourceDir), 'utf8'), ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node) => {
      // t('…') / tr('…') / translate(lang, '…')
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const fn = node.expression.text;
        const arg = fn === 'translate' ? node.arguments[1] : (fn === 't' || fn === 'tr') ? node.arguments[0] : null;
        if (arg) { const out = []; results(arg, out); out.forEach(k => keys.add(k)); }
      }
      // label tables translated at render: their values
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const init = node.initializer;
        if (TABLES.has(node.name.text) && ts.isObjectLiteralExpression(init))
          for (const p of init.properties) if (ts.isPropertyAssignment(p) && ts.isStringLiteralLike(p.initializer)) keys.add(p.initializer.text);
        if (node.name.text === 'behaviors') {
          const arr = ts.isAsExpression(init) ? init.expression : init;
          if (ts.isArrayLiteralExpression(arr)) arr.elements.forEach(e => ts.isStringLiteralLike(e) && keys.add(e.text));
        }
      }
      // { label: '…' } in the functions whose labels are shown through the translator
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'label' && ts.isStringLiteralLike(node.initializer)) {
        let f = node.parent; while (f && !ts.isFunctionDeclaration(f)) f = f.parent;
        if (f?.name && ['stateVisual', 'recordType'].includes(f.name.text)) keys.add(node.initializer.text);
      }
      // correctnessLabel's returns, and literal arrays mapped through the translator (suggested questions)
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'correctnessLabel') {
        const walk = n => { if (ts.isStringLiteralLike(n) && ts.isConditionalExpression(n.parent)) keys.add(n.text); ts.forEachChild(n, walk); }; walk(node);
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map' && ts.isArrayLiteralExpression(node.expression.expression)) {
        const cb = node.arguments[0];
        if (cb && ts.isArrowFunction(cb) && ts.isCallExpression(cb.body) && ts.isIdentifier(cb.body.expression) && ['t', 'tr'].includes(cb.body.expression.text))
          node.expression.expression.elements.forEach(e => ts.isStringLiteralLike(e) && keys.add(e.text));
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  keys.delete(''); keys.delete('$name');
  return [...keys].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(JSON.stringify(interfaceKeys(), null, 1));
