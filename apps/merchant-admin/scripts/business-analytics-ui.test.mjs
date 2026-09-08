import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../src/pages/BusinessAnalyticsPage.vue', import.meta.url), 'utf8');
const dashboardPage = await readFile(new URL('../src/pages/DashboardPage.vue', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/api/analytics.ts', import.meta.url), 'utf8');
const layout = await readFile(new URL('../src/layouts/MerchantLayout.vue', import.meta.url), 'utf8');
const navigation = await readFile(new URL('../src/composables/useMerchantNavigation.ts', import.meta.url), 'utf8');
const workbenchStyles = await readFile(new URL('../src/styles/merchant-workbench.css', import.meta.url), 'utf8');
const trendChart = await readFile(new URL('../src/components/BusinessTrendChart.vue', import.meta.url), 'utf8');
const shareChart = await readFile(new URL('../src/components/BusinessTimeDistributionChart.vue', import.meta.url), 'utf8');
const settingsPage = await readFile(new URL('../src/pages/BusinessSettingsPage.vue', import.meta.url), 'utf8');
const staffPage = await readFile(new URL('../src/pages/StaffPage.vue', import.meta.url), 'utf8');
const printingShell = await readFile(new URL('../src/components/printing/PrintingCenterShell.vue', import.meta.url), 'utf8');
const pageStyles = await readFile(new URL('../src/styles/merchant-pages.css', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');

for (const locale of ['zh:', 'vi:', 'en:']) {
  assert.match(page, new RegExp(`\\b${locale}`), `missing analytics copy for ${locale}`);
}
assert.doesNotMatch(page, /<header class="analytics-page-header">/, 'homepage must not repeat the analytics title and subtitle');
assert.doesNotMatch(page, /class="analytics-date-button"/, 'homepage must not expose the removed duplicate date button');
assert.match(page, /\['custom', copy\.custom\]/, 'custom date selection remains available in the period controls');

for (const field of ['generatedAt', 'revenueVnd', 'settlementCount', 'averageOrderValueVnd', 'timeDistribution', 'topDishes']) {
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
assert.match(page, /fundsDescription: '已完成订单净额：堂食按开台营业日，自取\/配送按下单营业日'/, 'funds header must state opening/order business-date attribution');
assert.match(page, /fundsDescription: 'Doanh thu ròng của đơn hoàn tất: theo ngày kinh doanh mở bàn; mang đi\/giao hàng theo ngày kinh doanh đặt đơn'/, 'Vietnamese funds basis wording must exist');
assert.match(page, /fundsDescription: 'Completed-order net amounts: dine-in by table-opening business date; pickup\/delivery by order business date'/, 'English funds basis wording must exist');
assert.match(page, /analytics-funds-grid \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); gap: 6px; margin: 0; \}/, 'funds block must keep a three-column desktop composition');
assert.match(page, /@media \(max-width: 768px\)[\s\S]*\.analytics-funds-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 5px; \}/, 'mobile funds must collapse to a two-column grid');
for (const [className, order] of [
  ['funds-item--discount', 1],
  ['funds-item--rounding', 2],
  ['funds-item--bank', 3],
  ['funds-item--cash', 4],
  ['funds-item--unrecorded', 5],
  ['funds-item--net', 6],
]) {
  assert.match(page, new RegExp(`\\.${className} \\{ order: ${order}; \\}`), `mobile funds order must place ${className} at ${order}`);
}
assert.match(page, /shareDescription: '按开台 \/ 下单时间归属'/, 'time revenue share must describe opening/order-time attribution');
assert.match(page, /shareDescription: 'Theo giờ mở bàn \/ đặt đơn'/, 'Vietnamese share description must use opening/order-time wording');
assert.match(page, /shareDescription: 'Based on table-opening \/ order time'/, 'English share description must use opening/order-time wording');
assert.doesNotMatch(page, /按结账时间|结账高峰热力图|Based on settlement time|Theo thời gian thanh toán/, 'no stale checkout-time basis may remain');

assert.match(api, /return response\.data\.data/, 'analytics API should return the server payload without demo remapping');
assert.match(page, /preset === 'today'\) return loadAnalytics\(true\)/, 'Today must use the server-resolved current business date');
assert.match(page, /preset === 'yesterday' \? addDays\(today, -1\) : today/, 'Yesterday must query the previous business date');
assert.match(page, /preset === 'yesterday' \? filters\.dateTo : addDays\(today, -6\)/, 'Last 7 days must query the current business date plus six preceding days');
assert.match(page, /\['today', copy\.today\], \['yesterday', copy\.yesterday\], \['sevenDays', copy\.sevenDays\], \['custom', copy\.custom\]/, 'analytics presets must be Today, Yesterday, Last 7 days, and Custom');
assert.doesNotMatch(page, /thirtyDays|近30天|Last 30 days/, 'the retired 30-day preset must not remain');
assert.match(page, /:disabled="loading"/, 'period switches must wait for the server-resolved business date before issuing another range');
assert.match(page, /currentBusinessDay \? \{\} : \{ dateFrom:/, 'initial/current-day request must omit natural-date overrides');
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
for (const field of ['revenue', 'settlement-count', 'average-order-value']) {
  assert.match(page, new RegExp(`data-analytics-field="${field}"`), `missing UI reconciliation marker ${field}`);
}
assert.doesNotMatch(page, /🤖/, 'AI brief should not depend on a platform emoji glyph');
assert.match(navigation, /path: '\/dashboard', icon: 'home'/, 'mobile navigation must expose the analytics home tab');
assert.match(navigation, /\['\/dashboard', '\/business-analytics'\]\.includes\(route\.path\)/, 'the formal analytics route and home route must share the active tab');
assert.match(layout, /<MerchantIcon :name="entry\.icon"/, 'mobile and desktop navigation should use the same line-icon family');
assert.match(workbenchStyles, /@media \(max-width: 768px\)/, 'merchant shell should switch at the 768px mobile boundary');
assert.match(workbenchStyles, /\.m-main--analytics[\s\S]*var\(--m-bottom-nav-h\)[\s\S]*env\(safe-area-inset-bottom\)/, 'analytics content must retain mobile bottom-nav clearance');
assert.match(workbenchStyles, /env\(safe-area-inset-bottom\)/, 'merchant shell should reserve the phone safe area');
assert.match(workbenchStyles, /env\(safe-area-inset-top\)/, 'merchant shell should reserve the phone top safe area');
assert.match(workbenchStyles, /-webkit-tap-highlight-color:\s*transparent/, 'merchant interactions must suppress the browser blue tap highlight');
assert.match(indexHtml, /viewport-fit=cover/, 'viewport should opt into device safe-area coordinates');
assert.match(workbenchStyles, /\.m-bottom-nav a \{[\s\S]*?min-height: var\(--m-bottom-nav-h\)/, 'mobile navigation targets should stay above the 44px touch floor');
assert.match(trendChart, /chart\.js\/auto/, 'trend chart must use the existing Chart.js dependency');
assert.match(trendChart, /borderDash: \[5, 4\]/, 'the second trend series must be distinguishable without color alone');
assert.match(trendChart, /dateParts\.length === 3 \? `\$\{dateParts\[1\]\}-\$\{dateParts\[2\]\}`/, 'desktop and mobile trend ticks should use short month-day labels');
assert.match(trendChart, /touchstart[\s\S]*updateTouchTooltip/, 'touchstart must show the nearest trend tooltip');
assert.match(trendChart, /touchmove[\s\S]*updateTouchTooltip/, 'touchmove must update the active trend point');
assert.match(trendChart, /touchend[\s\S]*hideTouchTooltip/, 'touchend must immediately clear the trend tooltip');
assert.match(trendChart, /touchcancel[\s\S]*hideTouchTooltip/, 'touchcancel must immediately clear the trend tooltip');
assert.match(trendChart, /chart\.setActiveElements\(\[\]\)/, 'touch release must clear active chart points');
assert.match(trendChart, /chart\.tooltip\?\.setActiveElements\(\[\], \{ x: 0, y: 0 \}\)/, 'touch release must clear the Chart.js tooltip state');
assert.match(trendChart, /events: \['mousemove', 'mouseout', 'touchstart', 'touchmove'\]/, 'desktop hover and touch tracking must remain while synthetic click selection stays disabled');
assert.match(shareChart, /type: 'doughnut'/, 'time revenue share should use a Chart.js doughnut');
assert.match(page, /!Number\.isFinite\(value\)/, 'comparison display must guard against NaN and Infinity');
assert.match(page, /:title="formatMoney\(analytics\.overview\.revenueVnd\)"/, 'long mobile VND values should expose their full amount');
assert.match(shareChart, /:title="formatMoney\(totalRevenue\)"/, 'doughnut center should expose the full current-period amount');
assert.match(pageStyles, /@media \(max-width: 768px\)/, 'store settings should have a 768px mobile composition');
assert.match(pageStyles, /@media \(max-width: 960px\)[\s\S]*\.mx-settings-layout/, 'store settings should have a compact tablet breakpoint');
assert.match(pageStyles, /\.intervals \{ display: flex; flex-wrap: wrap;/, 'business hour segments should wrap within the available width');
assert.match(pageStyles, /\.mx-store-profile \{ grid-template-columns: minmax\(0,1fr\); \}/, 'store profile should collapse to one column');
assert.match(pageStyles, /\.hours-row \{ grid-template-columns: minmax\(0,1fr\) 44px; \}[\s\S]*\.hours-row \.intervals,[\s\S]*grid-column: 1 \/ -1;/, 'business hours should become compact two-row day records on mobile');
assert.match(workbenchStyles, /:is\(button, a, input, select, textarea\):focus-visible/, 'business-hours controls should retain a visible keyboard focus state');
assert.match(settingsPage, /class="interval-remove"/, 'mobile interval actions must remain available on each time row');
assert.match(workbenchStyles, /:is\(input, select, textarea\) \{ min-height: 44px; font-size: 16px; \}/, 'mobile settings inputs should avoid iOS focus zoom');
assert.match(printingShell, /printing-status-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, 'printing summary should become a two-by-two grid');
assert.match(printingShell, /printing-printer-row>\.printing-actions \{ display: grid/, 'printer row actions should wrap as a mobile grid');
assert.doesNotMatch(printingShell, /printing-center__download|printing-center__help|printing-help/, 'printing center header should not expose download or help controls');
assert.match(staffPage, /mx-team-directory/, 'staff management should expose a dedicated team directory');
assert.match(staffPage, /mx-team-row/, 'staff management should expose responsive team records');
assert.match(staffPage, /mx-dot-status/, 'staff records should expose role and status together');
assert.match(staffPage, /mx-team-meta[\s\S]*mx-team-dates[\s\S]*mx-team-actions/, 'staff actions should share the same information band as the date metadata');
assert.match(staffPage, /document\.addEventListener\('pointerdown', onDocumentPointerDown\)/, 'staff action menus should close when the user presses outside the menu');
assert.match(pageStyles, /\.mx-team-directory \{ padding: 0; overflow: visible; \}/, 'staff action menus should not be clipped by the directory card');
assert.match(pageStyles, /\.mx-team-row \{ grid-template-columns: minmax\(0,1fr\) auto;/, 'mobile staff records should collapse without horizontal scrolling');
assert.doesNotMatch(page, /12[,.]?580[,.]?000|128\s*单|越南河粉|牛肉炒饭/, 'target-image demo values must not be embedded');
assert.doesNotMatch(page + trendChart + shareChart, /echarts|apexcharts|recharts|highcharts/i, 'analytics must not introduce a second chart library');
assert.match(dashboardPage, /getBusinessDaySummary\(\)/, 'dashboard revenue must use the canonical business-day summary');
assert.match(dashboardPage, /Promise\.allSettled/, 'live orders and the business-day summary must fail independently');
assert.match(dashboardPage, /businessDaySummary\.businessDate/, 'dashboard must display the resolved business date');
assert.match(dashboardPage, /businessDaySummaryLoading[\s\S]*?'—'/, 'unknown business-day totals must not render as a real zero');
assert.match(dashboardPage, /mobileRevenue: '本日营额'/, 'mobile dashboard must use the approved compact revenue label');
assert.match(dashboardPage, /mobileOrders: '结账笔数'/, 'mobile dashboard must use the approved compact settlement label');
assert.match(dashboardPage, /\.mobile-metric-grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/, 'mobile dashboard metrics must keep a two-column grid');
assert.doesNotMatch(dashboardPage, /mobile-metric-green\s*\{\s*grid-column:\s*1\s*\/\s*-1/, 'mobile revenue must not span both metric columns');

console.log('business analytics UI checks passed');
