import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/BusinessAnalyticsPage.vue', import.meta.url), 'utf8');
const dashboardPage = await readFile(new URL('../src/pages/DashboardPage.vue', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/api/analytics.ts', import.meta.url), 'utf8');
const layout = await readFile(new URL('../src/layouts/MerchantLayout.vue', import.meta.url), 'utf8');
const trendChart = await readFile(new URL('../src/components/BusinessTrendChart.vue', import.meta.url), 'utf8');
const shareChart = await readFile(new URL('../src/components/BusinessTimeDistributionChart.vue', import.meta.url), 'utf8');
const settingsPage = await readFile(new URL('../src/pages/BusinessSettingsPage.vue', import.meta.url), 'utf8');
const staffPage = await readFile(new URL('../src/pages/StaffPage.vue', import.meta.url), 'utf8');
const printingShell = await readFile(new URL('../src/components/printing/PrintingCenterShell.vue', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');

for (const locale of ['zh:', 'vi:', 'en:']) {
  assert.match(page, new RegExp(`\\b${locale}`), `missing analytics copy for ${locale}`);
}

for (const field of ['generatedAt', 'revenueVnd', 'orderCount', 'averageOrderValueVnd', 'timeDistribution', 'topDishes']) {
  assert.match(api, new RegExp(`\\b${field}\\b`), `missing analytics response field ${field}`);
}
for (const field of ['grossAmountVnd', 'discountAmountVnd', 'roundingAmountVnd', 'netSettledAmountVnd', 'cashRevenueVnd', 'bankTransferRevenueVnd', 'unrecordedRevenueVnd']) {
  assert.match(api, new RegExp(`\\b${field}\\b`), `missing analytics funds field ${field}`);
}
assert.match(page, /data-analytics-panel="funds-overview"/, 'analytics must expose a funds overview panel');
for (const field of ['discount', 'rounding', 'net-revenue', 'cash', 'bank-transfer', 'unrecorded']) {
  assert.match(page, new RegExp(`data-analytics-field="${field}"`), `missing funds UI reconciliation marker ${field}`);
}
assert.match(page, /v-if="BigInt\(analytics\.overview\.funds\.unrecordedRevenueVnd\) > 0n"[\s\S]{0,140}data-analytics-field="unrecorded"/, 'unrecorded card must be removed from the DOM (not display-hidden) when its amount is zero');
assert.doesNotMatch(page, /visibility:\s*hidden[\s\S]{0,80}data-analytics-field="unrecorded"/, 'unrecorded must never rely on visibility:hidden placeholders');
assert.match(page, /fundsDescription: '按已完成订单最终结账金额统计'/, 'funds header must state the final-settled-amount basis');
assert.match(page, /fundsDescription: 'Theo tổng thanh toán cuối cùng của đơn đã hoàn tất'/, 'Vietnamese funds basis wording must exist');
assert.match(page, /fundsDescription: 'Based on final settled amounts of completed orders'/, 'English funds basis wording must exist');
assert.match(page, /analytics-funds-grid \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); gap: 6px; margin: 0; \}/, 'funds block must keep a three-column desktop composition');
assert.match(page, /@media \(max-width: 768px\)[\s\S]*\.analytics-funds-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 5px; \}/, 'mobile funds must collapse to a two-column grid');
assert.match(page, /shareDescription: '按下单时间统计营业额分布'/, 'time revenue share must describe creation-time attribution');
assert.match(page, /shareDescription: 'Theo thời gian đặt hàng'/, 'Vietnamese share description must use creation-time wording');
assert.match(page, /shareDescription: 'Based on order creation time'/, 'English share description must use creation-time wording');

assert.match(api, /return response\.data\.data/, 'analytics API should return the server payload without demo remapping');
assert.match(page, /activePreset === preset\[0\]/, 'period buttons should expose an active state');
assert.match(page, /analytics-brief-card \{ order: 1;/, 'mobile brief must appear before KPI cards');
assert.match(page, /analytics-kpi-section \{ order: 2;/, 'mobile KPI cards must appear after the brief');
assert.match(page, /data-analytics-card="year-over-year"/, 'mobile KPI grid must include year-over-year growth');
assert.match(page, /analytics-kpi-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, 'mobile KPI cards must keep a two-column composition');
assert.match(page, /analytics-share-panel \{ display: flex; order: 1;/, 'mobile time revenue share must stay visible before TOP5');
assert.match(page, /analytics-ranking-panel \{ order: 2;/, 'mobile TOP5 must follow the time revenue share card');
assert.match(page, /data-analytics-panel="time-analysis"[\s\S]*data-analytics-panel="top-five"[\s\S]*data-analytics-panel="time-revenue-share"/, 'analytics structure must keep time analysis and both secondary cards');
assert.match(page, /<BusinessTimeDistributionChart[^>]*:segments="timeSegments"/, 'mobile and desktop revenue share must reuse the shared Chart.js component');
assert.doesNotMatch(page, /analytics-share-panel \{ display: none;/, 'mobile revenue share must not be hidden');
assert.match(page, /@media \(max-width: 900px\)/, 'tablet analytics must have an independent responsive composition');
assert.match(page, /desktopTopDishes/, 'desktop ranking should expose a separate five-to-ten dish disclosure');
assert.match(page, /rankingExpanded = !rankingExpanded/, 'desktop ranking should expand inline without navigation');
assert.match(page, /mobileTopDishes/, 'mobile ranking should stay limited to TOP5');
assert.match(page, /nth-child\(n \+ 2\)/, 'mobile suggestions should keep the first recommendation visible');
assert.match(page, /analytics-heatmap-row/, 'mobile keeps the heatmap instead of replacing it with a list');
assert.match(page, /analytics-trend-panel \{ grid-template-columns: minmax\(0, 1fr\); overflow: hidden;/, 'trend panel should not preserve a desktop canvas min-content width on phones');
assert.match(trendChart, /max-width: 100% !important/, 'trend canvas should stay within its responsive card');
for (const field of ['revenue', 'order-count', 'average-order-value']) {
  assert.match(page, new RegExp(`data-analytics-field="${field}"`), `missing UI reconciliation marker ${field}`);
}
assert.doesNotMatch(page, /🤖/, 'AI brief should not depend on a platform emoji glyph');
assert.match(layout, /path: '\/business-analytics', label: 'businessAnalytics'/, 'mobile navigation must expose the analytics active tab');
assert.match(layout, /iconPaths\(tab\.icon\)/, 'mobile navigation should use the same line-icon family as desktop');
assert.match(layout, /@media \(max-width: 768px\)/, 'merchant shell should switch at the 768px mobile boundary');
assert.match(layout, /@media \(min-width: 769px\) and \(max-width: 900px\)[\s\S]*\.app-shell--analytics \.content \{\s*padding: 18px 18px 30px;/, 'analytics tablet padding must not override the 82px mobile bottom-nav clearance at exactly 768px');
assert.match(layout, /env\(safe-area-inset-bottom\)/, 'merchant shell should reserve the phone safe area');
assert.match(layout, /env\(safe-area-inset-top\)/, 'merchant shell should reserve the phone top safe area');
assert.match(indexHtml, /viewport-fit=cover/, 'viewport should opt into device safe-area coordinates');
assert.match(layout, /\.mobile-tab \{[\s\S]*?min-height: 58px/, 'mobile navigation targets should stay above the 44px touch floor');
assert.match(trendChart, /chart\.js\/auto/, 'trend chart must use the existing Chart.js dependency');
assert.match(trendChart, /borderDash: \[5, 4\]/, 'the second trend series must be distinguishable without color alone');
assert.match(trendChart, /dateParts\.length === 3 \? `\$\{dateParts\[1\]\}-\$\{dateParts\[2\]\}`/, 'desktop and mobile trend ticks should use short month-day labels');
assert.match(shareChart, /type: 'doughnut'/, 'time revenue share should use a Chart.js doughnut');
assert.match(page, /!Number\.isFinite\(value\)/, 'comparison display must guard against NaN and Infinity');
assert.match(page, /:title="formatMoney\(analytics\.overview\.revenueVnd\)"/, 'long mobile VND values should expose their full amount');
assert.match(shareChart, /:title="formatMoney\(totalRevenue\)"/, 'doughnut center should expose the full current-period amount');
assert.match(settingsPage, /@media\(max-width:768px\)/, 'store settings should have a 768px mobile composition');
assert.match(settingsPage, /@media\(max-width:1100px\) and \(min-width:769px\)/, 'business hours should use a final single-column tablet breakpoint');
assert.match(settingsPage, /repeat\(auto-fit,minmax\(260px,1fr\)\)/, 'business hour segments should size from available tablet width');
assert.match(settingsPage, /store-profile-grid\{grid-template-columns:minmax\(0,1fr\)/, 'store profile should collapse to one column');
assert.match(settingsPage, /grid-template-areas:'day switch' 'intervals intervals'/, 'business hours should become compact two-row day cards on mobile');
assert.match(settingsPage, /switch input:focus-visible\+i/, 'business-hours switches should retain a visible keyboard focus state');
assert.match(settingsPage, /mobile-interval-actions/, 'mobile interval actions should stay on the time row');
assert.match(settingsPage, /font-size:16px/, 'mobile settings inputs should avoid iOS focus zoom');
assert.match(printingShell, /printing-status-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, 'printing summary should become a two-by-two grid');
assert.match(printingShell, /printing-printer-row>\.printing-actions \{ display: grid/, 'printer row actions should wrap as a mobile grid');
assert.match(printingShell, /role="dialog" aria-modal="true"/, 'printing help should expose modal dialog semantics');
assert.match(printingShell, /event\.key === 'Escape'/, 'printing help should close with Escape');
assert.match(staffPage, /staff-desktop-table/, 'desktop staff table should remain explicit');
assert.match(staffPage, /staff-mobile-list/, 'staff management should expose mobile cards');
assert.match(staffPage, /staff-pills/, 'mobile staff cards should expose role and status pills together');
assert.match(staffPage, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, 'mobile staff actions should use two-column wrapping');
assert.doesNotMatch(page, /12[,.]?580[,.]?000|128\s*单|越南河粉|牛肉炒饭/, 'target-image demo values must not be embedded');
assert.doesNotMatch(page + trendChart + shareChart, /echarts|apexcharts|recharts|highcharts/i, 'analytics must not introduce a second chart library');
assert.match(dashboardPage, /getBusinessDaySummary\(\)/, 'dashboard revenue must use the canonical business-day summary');
assert.match(dashboardPage, /Promise\.allSettled/, 'live orders and the business-day summary must fail independently');
assert.match(dashboardPage, /businessDaySummary\.businessDate/, 'dashboard must display the resolved business date');
assert.match(dashboardPage, /businessDaySummaryLoading[\s\S]*?'—'/, 'unknown business-day totals must not render as a real zero');
assert.match(dashboardPage, /mobile-metric-green\{grid-column:1\/-1\}/, 'mobile revenue should reserve a full-width card for large VND amounts');

console.log('business analytics UI checks passed');
