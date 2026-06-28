import { Injectable } from '@nestjs/common';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp = require('sharp');
import type { DailyReportLanguage } from './merchant-reports.constants';

type DailyReportSummary = {
  orderCount: number;
  totalAmount: string;
  averageOrderAmount: string;
  orderCountComparison: string;
  orderCountComparisonTrend: 'up' | 'down' | 'flat';
  totalAmountComparison: string;
  totalAmountComparisonTrend: 'up' | 'down' | 'flat';
  dineInCount: number;
  pickupCount: number;
  deliveryCount: number;
  statusCounts: Record<string, number>;
  topProducts: Array<{
    name: string;
    quantity: number;
  }>;
  peakHour: string;
  peakHourOrderCount: number;
  suggestions: string[];
};

type RenderDailyReportInput = {
  merchantId: string;
  merchantName: string;
  reportDate: string;
  language: DailyReportLanguage;
  summary: DailyReportSummary;
};

const REPORTS_DIR = join(process.cwd(), 'public', 'reports', 'daily');
const IMAGE_WIDTH = 1080;
const CARD_X = 60;
const CARD_WIDTH = 960;
const REPORT_FONT_FAMILY =
  '"Noto Sans CJK SC", "Noto Sans CJK", "Noto Sans SC", "Microsoft YaHei", "PingFang SC", "Arial Unicode MS", "DejaVu Sans", sans-serif';

@Injectable()
export class DailyReportImageService {
  async renderDailyReport(input: RenderDailyReportInput) {
    await mkdir(REPORTS_DIR, { recursive: true });
    const fileName = `${input.merchantId}-${input.reportDate}-${input.language}.png`;
    const filePath = join(REPORTS_DIR, fileName);
    const imageUrl = `/reports/daily/${fileName}`;
    const svg = buildDailyReportSvg(input);
    await sharp(Buffer.from(svg)).png().toFile(filePath);
    return {
      filePath,
      imageUrl,
    };
  }
}

function buildDailyReportSvg(input: RenderDailyReportInput) {
  const displayMerchantName = input.merchantName.trim() || (input.language === 'vi' ? 'Cửa hàng' : '商家');
  const merchantNameLines = wrapTextLines(displayMerchantName, input.language === 'vi' ? 28 : 16, 2);
  const merchantNameFontSize = input.language === 'vi' ? 38 : 42;
  const merchantNameLineHeight = input.language === 'vi' ? 42 : 46;
  const subtitle = input.language === 'vi' ? 'Báo cáo kinh doanh hằng ngày' : '每日营业日报';
  const totalAmount = formatMoney(input.summary.totalAmount);
  const averageOrderAmount = formatMoney(input.summary.averageOrderAmount);
  const stats = [
    {
      label: input.language === 'vi' ? 'Đơn hôm nay' : '今日订单',
      value: formatOrderCountDisplay(input.summary.orderCount, input.language),
      comparison: input.summary.orderCountComparison,
      trend: input.summary.orderCountComparisonTrend,
    },
    {
      label: input.language === 'vi' ? 'Doanh thu hôm nay' : '今日营业额',
      value: totalAmount,
      comparison: input.summary.totalAmountComparison,
      trend: input.summary.totalAmountComparisonTrend,
      accent: '#16A34A',
    },
    {
      label: input.language === 'vi' ? 'Giá trị TB' : '平均客单价',
      value: averageOrderAmount,
    },
  ];
  const orderTypes = [
    {
      label: input.language === 'vi' ? 'Ăn tại chỗ' : '堂食',
      value: input.summary.dineInCount,
      color: '#16A34A',
    },
    {
      label: input.language === 'vi' ? 'Mang đi' : '自取',
      value: input.summary.pickupCount,
      color: '#3B82F6',
    },
    {
      label: input.language === 'vi' ? 'Giao hàng' : '商家配送',
      value: input.summary.deliveryCount,
      color: '#F97316',
    },
  ];
  const statusCards = [
    {
      key: ['PENDING_ACCEPTANCE', 'PENDING'],
      label: input.language === 'vi' ? 'Chờ nhận' : '待接单',
      color: '#F59E0B',
    },
    {
      key: ['PREPARING'],
      label: input.language === 'vi' ? 'Đang làm' : '制作中',
      color: '#2563EB',
    },
    {
      key: ['COMPLETED'],
      label: input.language === 'vi' ? 'Hoàn thành' : '已完成',
      color: '#16A34A',
    },
    {
      key: ['CANCELLED'],
      label: input.language === 'vi' ? 'Đã hủy' : '已取消',
      color: '#EF4444',
    },
  ];
  const suggestionRows = input.summary.suggestions.slice(0, 3);
  const topProducts = input.summary.topProducts.slice(0, 5);
  const productCardHeight = topProducts.length > 0 ? Math.max(212, 154 + topProducts.length * 66) : 210;
  const suggestionCardHeight =
    suggestionRows.length > 0 ? Math.max(168, 142 + suggestionRows.length * 56) : 152;
  const coreStatCardY = 278;
  const coreStatCardHeight = 194;
  const orderSourceCardY = coreStatCardY + coreStatCardHeight + 26;
  const orderSourceCardHeight = 236;
  const statusCardY = orderSourceCardY + orderSourceCardHeight + 26;
  const statusCardHeight = 196;
  const productCardY = statusCardY + statusCardHeight + 26;
  const peakCardY = productCardY + productCardHeight + 26;
  const peakCardHeight = 194;
  const suggestionCardY = peakCardY + peakCardHeight + 26;
  const footerY = suggestionCardY + suggestionCardHeight + 42;
  const height = footerY + 52;

  const coreStatBlocks = stats
    .map((item, index) => {
      const x = CARD_X + index * 320;
      const accent = item.accent ?? ['#16A34A', '#2563EB', '#7C3AED'][index] ?? '#16A34A';
      const trendColor =
        item.trend === 'up' ? '#16A34A' : item.trend === 'down' ? '#EF4444' : '#6B7280';
      const iconKind = index === 0 ? 'orders' : index === 1 ? 'revenue' : 'avg';
      return `
        <g transform="translate(${x}, ${coreStatCardY})">
          <rect width="300" height="${coreStatCardHeight}" rx="28" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="1.5" />
          <rect x="18" y="18" width="264" height="6" rx="3" fill="${accent}" opacity="0.16" />
          ${renderIconCircle({
            cx: 150,
            cy: 64,
            radius: 34,
            fill: accent,
            opacity: 0.18,
            icon: renderMetricIcon(iconKind, accent, 150, 64),
          })}
          <text x="150" y="116" text-anchor="middle" fill="#6B7280" font-size="23" class="report-text">${escapeXml(item.label)}</text>
          ${renderMetricValue({
            x: 150,
            y: 156,
            value: item.value,
            language: input.language,
            accent: index === 1 ? '#047857' : '#111827',
            isRevenue: index === 1,
          })}
          ${
            item.comparison
              ? `<text x="150" y="180" text-anchor="middle" fill="${trendColor}" font-size="17" font-weight="700" class="report-text">${escapeXml(
                  item.comparison,
                )}</text>`
              : ''
          }
        </g>
      `;
    })
    .join('');

  const orderTypeBlocks = input.summary.orderCount > 0
    ? orderTypes
        .map((item, index) => {
          const iconCx = 30;
          const iconCy = 19;
          const labelX = 74;
          const barX = 224;
          const barWidth = 488;
          const countX = 824;
          const width = Math.max(16, Math.round((item.value / Math.max(1, input.summary.orderCount)) * barWidth));
          return `
            <g transform="translate(0, ${82 + index * 46})">
              ${renderIconCircle({
                cx: iconCx,
                cy: iconCy,
                radius: 20,
                fill: item.color,
                opacity: 0.18,
                icon: renderOrderSourceIcon(item.label, item.color, iconCx, iconCy),
              })}
              <text x="${labelX}" y="24" fill="#374151" font-size="22" font-weight="700" class="report-text">${escapeXml(
                item.label,
              )}</text>
              <rect x="${barX}" y="7" width="${barWidth}" height="14" rx="7" fill="#E5E7EB" />
              <rect x="${barX}" y="7" width="${width}" height="14" rx="7" fill="${item.color}" />
              <text x="${countX}" y="24" text-anchor="end" fill="#111827" font-size="22" font-weight="700" class="report-text">${item.value}</text>
            </g>
          `;
        })
        .join('')
    : `
        <g transform="translate(0, 92)">
          <rect width="860" height="76" rx="22" fill="#F9FAFB" stroke="#E5E7EB" />
          <text x="430" y="46" text-anchor="middle" fill="#6B7280" font-size="23" class="report-text">${escapeXml(
            input.language === 'vi' ? 'Hôm nay chưa có dữ liệu đơn hàng' : '今日暂无订单数据',
          )}</text>
        </g>
      `;

  const statusBlocks = statusCards
    .map((item, index) => {
      const value = resolveStatusCount(input.summary.statusCounts, item.key);
      const x = (index % 2) * 400;
      const y = Math.floor(index / 2) * 86;
      return `
        <g transform="translate(${x}, ${y})">
          <rect width="388" height="76" rx="22" fill="#FAFBFC" stroke="#E5E7EB" />
          ${renderIconCircle({
            cx: 44,
            cy: 38,
            radius: 22,
            fill: item.color,
            opacity: 0.18,
            icon: renderStatusIcon(item.label, item.color, 44, 38),
          })}
          <text x="80" y="44" fill="#374151" font-size="23" font-weight="700" class="report-text">${escapeXml(item.label)}</text>
          <text x="346" y="44" text-anchor="end" fill="#111827" font-size="25" font-weight="700" class="report-text">${value}</text>
        </g>
      `;
    })
    .join('');

  const maxProductQuantity = Math.max(1, ...topProducts.map((item) => item.quantity));
  const productBlocks = topProducts.length > 0
    ? topProducts
        .map((item, index) => {
          const width = Math.max(12, Math.round((item.quantity / maxProductQuantity) * 468));
          const name = truncateText(item.name, input.language === 'vi' ? 24 : 20);
          const y = 82 + index * 66;
          const rankBg = index === 0 ? '#DCFCE7' : index === 1 ? '#DBEAFE' : index === 2 ? '#E9D5FF' : '#FEF3C7';
          const rankText = index === 0 ? '#047857' : index === 1 ? '#2563EB' : index === 2 ? '#7C3AED' : '#B45309';
          return `
            <g transform="translate(0, ${y})">
              <rect x="0" y="0" width="44" height="44" rx="16" fill="${rankBg}" />
              <text x="22" y="28" text-anchor="middle" fill="${rankText}" font-size="18" font-weight="700" class="report-text">${index + 1}</text>
              <text x="62" y="22" fill="#111827" font-size="22" font-weight="700" class="report-text">${escapeXml(name)}</text>
              <text x="820" y="22" text-anchor="end" fill="#111827" font-size="22" font-weight="700" class="report-text">${item.quantity} ${input.language === 'vi' ? 'phần' : '份'}</text>
              <rect x="62" y="34" width="680" height="14" rx="7" fill="#E5E7EB" />
              <rect x="62" y="34" width="${width}" height="14" rx="7" fill="#16A34A" />
            </g>
          `;
        })
        .join('')
    : `
        <g transform="translate(0, 108)">
          <rect width="860" height="86" rx="20" fill="#F9FAFB" stroke="#E5E7EB" />
          <text x="430" y="52" text-anchor="middle" fill="#6B7280" font-size="25" class="report-text">${escapeXml(
            input.language === 'vi' ? 'Hôm nay chưa có món bán chạy' : '今日暂无热销菜品',
          )}</text>
        </g>
      `;

  const suggestionBlocks = suggestionRows.length > 0
    ? suggestionRows
        .map((item, index) => {
          const y = 74 + index * 54;
          const bg = index % 2 === 0 ? '#F0FDF4' : '#FFFBEB';
          const stroke = index % 2 === 0 ? '#D1FAE5' : '#FDE68A';
          const bullet = index % 2 === 0 ? '#16A34A' : '#F59E0B';
          const lines = wrapTextLines(item, input.language === 'vi' ? 50 : 42, 2);
          return `
            <g transform="translate(0, ${y})">
              <rect width="${CARD_WIDTH}" height="46" rx="15" fill="${bg}" stroke="${stroke}" />
              <circle cx="24" cy="23" r="5" fill="${bullet}" />
              ${renderTextLines({
                x: 40,
                y: 18,
                lines,
                fontSize: 19,
                lineHeight: 16,
                fill: '#374151',
              })}
            </g>
          `;
        })
        .join('')
    : `
        <g transform="translate(0, 80)">
          <rect width="${CARD_WIDTH}" height="46" rx="15" fill="#F9FAFB" stroke="#E5E7EB" />
          <text x="24" y="30" fill="#6B7280" font-size="22" class="report-text">${escapeXml(
            input.language === 'vi' ? 'Chưa có gợi ý cho hôm nay' : '今日暂无经营建议',
          )}</text>
        </g>
      `;

  const headerTitleY = merchantNameLines.length > 1 ? 78 : 90;
  const headerSubtitleY = merchantNameLines.length > 1 ? 160 : 132;
  const headerDateY = merchantNameLines.length > 1 ? 192 : 164;
  const headerHeight = merchantNameLines.length > 1 ? 228 : 184;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${IMAGE_WIDTH}" height="${height}" viewBox="0 0 ${IMAGE_WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      text {
        font-family: ${REPORT_FONT_FAMILY};
      }
      .report-text {
        font-family: ${REPORT_FONT_FAMILY};
      }
    </style>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F6F8F7"/>
      <stop offset="100%" stop-color="#EEF7F2"/>
    </linearGradient>
    <linearGradient id="headerBg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#047857"/>
      <stop offset="100%" stop-color="#16A34A"/>
    </linearGradient>
  </defs>
  <rect width="${IMAGE_WIDTH}" height="${height}" fill="url(#bg)" />
  <rect x="40" y="36" width="1000" height="${height - 72}" rx="36" fill="#FFFFFF" opacity="0.96" />
  <g transform="translate(${CARD_X}, 56)">
    <rect width="${CARD_WIDTH}" height="${headerHeight}" rx="30" fill="url(#headerBg)" />
    <circle cx="880" cy="46" r="84" fill="#FFFFFF" opacity="0.08" />
    <circle cx="940" cy="110" r="58" fill="#FFFFFF" opacity="0.08" />
    <text x="28" y="${headerTitleY}" fill="#FFFFFF" font-size="${merchantNameFontSize}" font-weight="700" class="report-text">${escapeXml(
      merchantNameLines[0],
    )}</text>
    ${
      merchantNameLines[1]
        ? `<text x="28" y="${headerTitleY + merchantNameLineHeight}" fill="#FFFFFF" font-size="${merchantNameFontSize - 4}" font-weight="700" class="report-text">${escapeXml(
            merchantNameLines[1],
          )}</text>`
        : ''
    }
    <text x="28" y="${headerSubtitleY}" fill="#D1FAE5" font-size="28" class="report-text">${escapeXml(subtitle)}</text>
    <text x="28" y="${headerDateY}" fill="#DCFCE7" font-size="22" class="report-text">${escapeXml(
      `${input.language === 'vi' ? 'Ngày' : '日期'}：${input.reportDate}`,
    )}</text>
  </g>
  ${coreStatBlocks}
  <g transform="translate(${CARD_X}, ${orderSourceCardY})">
    <rect width="${CARD_WIDTH}" height="210" rx="28" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="1.5" />
    <text x="28" y="40" fill="#111827" font-size="30" font-weight="700" class="report-text">${escapeXml(
      input.language === 'vi' ? 'Cơ cấu đơn hàng' : '订单来源',
    )}</text>
    ${orderTypeBlocks}
  </g>
  <g transform="translate(${CARD_X}, ${statusCardY})">
    <rect width="${CARD_WIDTH}" height="${statusCardHeight}" rx="28" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="1.5" />
    <text x="28" y="40" fill="#111827" font-size="30" font-weight="700" class="report-text">${escapeXml(
      input.language === 'vi' ? 'Trạng thái đơn hàng' : '订单状态',
    )}</text>
    ${statusBlocks}
  </g>
  <g transform="translate(${CARD_X}, ${productCardY})">
    <rect width="${CARD_WIDTH}" height="${productCardHeight}" rx="28" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="1.5" />
    <text x="28" y="40" fill="#111827" font-size="30" font-weight="700" class="report-text">${escapeXml(
      input.language === 'vi' ? 'Top món bán chạy' : '热门菜品 Top 5',
    )}</text>
    ${productBlocks}
  </g>
  <g transform="translate(${CARD_X}, ${peakCardY})">
    <rect width="${CARD_WIDTH}" height="${peakCardHeight}" rx="28" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="1.5" />
    <rect x="18" y="18" width="924" height="158" rx="24" fill="#ECFDF5" />
    ${renderIconCircle({
      cx: 72,
      cy: 88,
      radius: 34,
      fill: '#16A34A',
      opacity: 0.18,
      icon: renderPeakIcon(72, 88, '#047857'),
    })}
    <text x="122" y="56" fill="#111827" font-size="30" font-weight="700" class="report-text">${escapeXml(
      input.language === 'vi' ? 'Khung giờ cao điểm' : '高峰时段',
    )}</text>
    <text x="122" y="96" fill="#047857" font-size="38" font-weight="700" class="report-text">${escapeXml(
      input.summary.peakHour,
    )}</text>
    <text x="122" y="132" fill="#6B7280" font-size="24" class="report-text">${escapeXml(
      input.summary.peakHourOrderCount > 0
        ? `${input.summary.peakHourOrderCount} ${input.language === 'vi' ? 'đơn' : '单'}`
        : input.language === 'vi'
          ? 'Hôm nay chưa có khung giờ cao điểm rõ ràng'
          : '今日暂无明显高峰时段',
    )}</text>
    <rect x="726" y="67" width="186" height="44" rx="22" fill="#16A34A" />
    <text x="819" y="96" text-anchor="middle" fill="#FFFFFF" font-size="22" font-weight="700" class="report-text">${escapeXml(
      input.language === 'vi' ? 'Điểm nóng' : '高峰提醒',
    )}</text>
  </g>
  <g transform="translate(${CARD_X}, ${suggestionCardY})">
    <rect width="${CARD_WIDTH}" height="${suggestionCardHeight}" rx="28" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="1.5" />
    <text x="28" y="42" fill="#111827" font-size="30" font-weight="700" class="report-text">${escapeXml(
      input.language === 'vi' ? 'Gợi ý vận hành' : '经营建议',
    )}</text>
    ${suggestionBlocks}
  </g>
  <text x="${CARD_X}" y="${footerY}" fill="#6B7280" font-size="22" class="report-text">${escapeXml(
    input.language === 'vi'
      ? 'Báo cáo được tạo tự động, chỉ dùng để tham khảo kinh doanh.'
      : '本日报由系统自动生成，数据仅供商家经营参考。',
  )}</text>
</svg>`;
}

function formatMoney(value: string) {
  const amount = Number(value ?? 0);
  return `${amount.toLocaleString('en-US')} VND`;
}

function formatOrderCountDisplay(value: number, language: DailyReportLanguage) {
  return `${value} ${language === 'vi' ? 'đơn' : '单'}`;
}

function renderIconCircle(input: {
  cx: number;
  cy: number;
  radius: number;
  fill: string;
  opacity: number;
  icon: string;
}) {
  return `
    <circle cx="${input.cx}" cy="${input.cy}" r="${input.radius + 6}" fill="${input.fill}" opacity="0.08" />
    <circle cx="${input.cx}" cy="${input.cy}" r="${input.radius}" fill="${input.fill}" opacity="${input.opacity}" />
    <circle cx="${input.cx}" cy="${input.cy}" r="${Math.max(12, input.radius - 5)}" fill="${input.fill}" opacity="0.96" />
    ${input.icon}
  `;
}

function renderMetricValue(input: {
  x: number;
  y: number;
  value: string;
  language: DailyReportLanguage;
  accent: string;
  isRevenue: boolean;
}) {
  if (!input.isRevenue && (input.value.endsWith(' 单') || input.value.endsWith(' đơn'))) {
    const [numberPart, unitPart] = input.value.split(' ');
    return `
      <text x="${input.x}" y="${input.y}" text-anchor="middle" fill="${input.accent}" class="report-text">
        <tspan font-size="38" font-weight="700">${escapeXml(numberPart)}</tspan>
        <tspan dx="8" font-size="24" font-weight="700">${escapeXml(unitPart)}</tspan>
      </text>
    `;
  }

  return `<text x="${input.x}" y="${input.y}" text-anchor="middle" fill="${input.accent}" font-size="${input.isRevenue ? 37 : 35}" font-weight="700" class="report-text">${escapeXml(
    input.value,
  )}</text>`;
}

function renderMetricIcon(kind: 'orders' | 'revenue' | 'avg', accent: string, cx: number, cy: number) {
  const fill = '#FFFFFF';
  if (kind === 'orders') {
    return `
      <g transform="translate(${cx - 18}, ${cy - 18})" data-accent="${accent}" fill="none" stroke="${fill}" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 5h18v24H9z" stroke-width="3.4" rx="5" />
        <path d="M14 5.5c0-2.8 2.2-4.5 4-4.5h0c1.8 0 4 1.7 4 4.5" stroke-width="3.4" />
        <path d="M14 14h8" stroke-width="3.2" />
        <path d="M14 20h8" stroke-width="3.2" />
        <path d="M14 26h5" stroke-width="3.2" />
      </g>
    `;
  }

  if (kind === 'revenue') {
    return `
      <g transform="translate(${cx - 18}, ${cy - 18})" data-accent="${accent}" fill="none" stroke="${fill}" stroke-linecap="round" stroke-linejoin="round">
        <path d="M7 11c0-3.5 3.2-6 11-6 5.5 0 8 2.1 8 5.2 0 2-1.1 3.5-3.1 4.4 1.9 0.9 3.1 2.5 3.1 4.7 0 3.8-3.2 6.7-8.6 6.7-7.7 0-10.4-2.2-10.4-5.7" stroke-width="3.2"/>
        <path d="M18 2v28" stroke-width="3.2"/>
        <path d="M12 9h11" stroke-width="3"/>
        <path d="M11 21h12" stroke-width="3"/>
      </g>
    `;
  }

  return `
    <g transform="translate(${cx - 18}, ${cy - 18})" data-accent="${accent}" fill="none" stroke="${fill}" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="18" cy="12" r="7.5" stroke-width="3.2" />
      <path d="M7 29c2.8-6.8 7.2-10.2 11-10.2s8.2 3.4 11 10.2" stroke-width="3.4" />
    </g>
  `;
}

function renderOrderSourceIcon(label: string, color: string, cx: number, cy: number) {
  const lower = label.toLowerCase();
  if (lower.includes('堂食') || lower.includes('tại chỗ') || lower.includes('ăn tại')) {
    return `
      <g transform="translate(${cx - 14}, ${cy - 14})" data-color="${color}" fill="none" stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 3v12" stroke-width="3" />
        <path d="M5 3v7" stroke-width="2.6" />
        <path d="M11 3v7" stroke-width="2.6" />
        <path d="M20 3v8c0 2-1.4 3.2-3.2 3.2H15" stroke-width="3" />
        <path d="M8 15v10" stroke-width="3" />
        <path d="M16 14v11" stroke-width="3" />
      </g>
    `;
  }

  if (lower.includes('自取') || lower.includes('mang đi') || lower.includes('mangdi')) {
    return `
      <g transform="translate(${cx - 14}, ${cy - 14})" data-color="${color}" fill="none" stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 10h18v12H5z" stroke-width="3" />
        <path d="M9 10V8c0-2.2 1.8-4 4-4h2c2.2 0 4 1.8 4 4v2" stroke-width="3" />
        <path d="M5 14h18" stroke-width="2.8" />
      </g>
    `;
  }

  return `
    <g transform="translate(${cx - 14}, ${cy - 14})" data-color="${color}" fill="none" stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 11h12v8H3z" stroke-width="3" />
      <path d="M15 13h4l4 4v2h-8" stroke-width="3" />
      <circle cx="8" cy="22" r="2.4" fill="#FFFFFF" stroke="none" />
      <circle cx="19" cy="22" r="2.4" fill="#FFFFFF" stroke="none" />
    </g>
  `;
}

function renderStatusIcon(label: string, color: string, cx: number, cy: number) {
  const lower = label.toLowerCase();
  if (lower.includes('待') || lower.includes('chờ')) {
    return `
      <g transform="translate(${cx - 13}, ${cy - 13})" data-color="${color}" fill="none" stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="13" cy="13" r="8.5" stroke-width="3.2" />
        <path d="M13 8v5l3.8 2.6" stroke-width="3.2" />
      </g>
    `;
  }

  if (lower.includes('制作') || lower.includes('đang')) {
    return `
      <g transform="translate(${cx - 13}, ${cy - 13})" data-color="${color}" fill="none" stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 20h14" stroke-width="3.2" />
        <path d="M8 20c0-5 2.6-8.7 5-11.3" stroke-width="3.2" />
        <path d="M13 20c0-4.4 2.4-8 5-10.4" stroke-width="3.2" />
      </g>
    `;
  }

  if (lower.includes('完成') || lower.includes('hoàn')) {
    return `
      <g transform="translate(${cx - 13}, ${cy - 13})" data-color="${color}" fill="none" stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="13" cy="13" r="8.5" stroke-width="3.2" />
        <path d="M8.5 13.5l3 3 6-6" stroke-width="3.2" />
      </g>
    `;
  }

  return `
    <g transform="translate(${cx - 13}, ${cy - 13})" data-color="${color}" fill="none" stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="13" cy="13" r="8.5" stroke-width="3.2" />
      <path d="M9 9l8 8" stroke-width="3.2" />
      <path d="M17 9l-8 8" stroke-width="3.2" />
    </g>
  `;
}

function renderPeakIcon(cx: number, cy: number, color: string) {
  return `
    <g transform="translate(${cx - 15}, ${cy - 15})" data-color="${color}" fill="none" stroke="#FFFFFF" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 24h22" stroke-width="3.2" />
      <path d="M7 18l6-6 5 4 7-9" stroke-width="3.4" />
      <path d="M21 7h4v4" stroke-width="3.2" />
      <circle cx="7" cy="18" r="2" fill="#FFFFFF" stroke="none" />
      <circle cx="13" cy="12" r="2" fill="#FFFFFF" stroke="none" />
      <circle cx="18" cy="16" r="2" fill="#FFFFFF" stroke="none" />
      <circle cx="25" cy="7" r="2" fill="#FFFFFF" stroke="none" />
    </g>
  `;
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function truncateMultiline(value: string, maxLength: number) {
  return truncateText(value.replace(/\s+/g, ' ').trim(), maxLength);
}

function fitText(value: string, maxLength: number) {
  return truncateText(value.replace(/\s+/g, ' ').trim(), maxLength);
}

function wrapTextLines(value: string, maxCharsPerLine: number, maxLines: number) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return [''];

  const lines: string[] = [];
  let current = '';
  const words = normalized.includes(' ') ? normalized.split(' ') : [normalized];

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
    }

    if (word.length > maxCharsPerLine) {
      const chunks = chunkText(word, maxCharsPerLine);
      while (chunks.length > 1 && lines.length < maxLines - 1) {
        lines.push(chunks.shift() ?? '');
      }
      current = chunks[0] ?? '';
    } else {
      current = word;
    }

    if (lines.length >= maxLines) {
      return lines.slice(0, maxLines);
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  return lines.slice(0, maxLines);
}

function chunkText(value: string, chunkSize: number) {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize));
  }
  return chunks;
}

function renderTextLines(input: {
  x: number;
  y: number;
  lines: string[];
  fontSize: number;
  lineHeight: number;
  fill: string;
}) {
  return `
    <text x="${input.x}" y="${input.y}" fill="${input.fill}" font-size="${input.fontSize}" class="report-text">
      ${input.lines
        .map((line, index) => `<tspan x="${input.x}" dy="${index === 0 ? 0 : input.lineHeight}">${escapeXml(line)}</tspan>`)
        .join('')}
    </text>
  `;
}

function resolveStatusCount(counts: Record<string, number>, keys: string[]) {
  return keys.reduce((sum, key) => sum + (counts[key] ?? 0), 0);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
