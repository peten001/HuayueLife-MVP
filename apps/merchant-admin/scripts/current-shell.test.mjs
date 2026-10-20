import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/router/index.ts', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('router.ts', source, ts.ScriptTarget.Latest, true);
const property = (node, key) => node.properties?.find(p => p.name?.getText(syntax) === key)?.initializer;
let routes;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(syntax) === 'createRouter') routes = property(node.arguments[0], 'routes');
  ts.forEachChild(node, visit);
}
visit(syntax);
assert(routes && ts.isArrayLiteralExpression(routes));
const merchant = routes.elements.find(node => property(node, 'path')?.text === '/');
assert.equal(property(merchant, 'component')?.getText(syntax), 'MerchantLayout');
const children = property(merchant, 'children');
assert(children && ts.isArrayLiteralExpression(children));
assert(children.elements.some(node => property(node, 'path')?.text === 'forbidden'), 'permission screens must share the current merchant shell');
for (const route of routes.elements) {
  const path = property(route, 'path')?.text;
  assert(path === '/' || path === '/login' || path.startsWith('/platform') || path === '/:pathMatch(.*)*', `merchant route escapes the current shell: ${path}`);
}
const printers = children.elements.find(node => property(node, 'path')?.text === 'merchant/printers');
assert.equal(property(printers, 'redirect')?.text, '/printing-center/printers');
assert.doesNotMatch(source, /legacyPrintingRoute|MerchantProfilePage/);
for (const name of ['DashboardPage', 'OrdersPage', 'MerchantProfilePage', 'PrintersPage', 'CategoriesPage', 'ReportSettingsPage', 'MerchantChangePasswordPage', 'printing/PrintingTerminalsPage']) {
  await assert.rejects(access(new URL(`../src/pages/${name}.vue`, import.meta.url)), { code: 'ENOENT' }, `retired page must be removed: ${name}`);
}
const home = await readFile(new URL('../src/pages/MerchantHomePage.vue', import.meta.url), 'utf8');
assert.match(home, /BusinessAnalyticsPage/);
assert.match(home, /canAnalyze/);
assert.match(home, /MerchantMorePage v-else/);
console.log('Current merchant shell: all merchant routes enclosed, permission fallback preserved, 8 retired pages removed');
