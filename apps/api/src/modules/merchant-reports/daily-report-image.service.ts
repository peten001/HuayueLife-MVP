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
  const productCardHeight = topProducts.length > 0 ? Math.max(180, 153 + (topProducts.length - 1) * 68) : 204;
  const suggestionCardHeight =
    suggestionRows.length > 0 ? Math.max(176, 152 + (suggestionRows.length - 1) * 60) : 160;
  const orderSourceCardY = 480;
  const orderSourceCardHeight = 210;
  const statusCardY = orderSourceCardY + orderSourceCardHeight + 26;
  const statusCardHeight = 176;
  const productCardY = statusCardY + statusCardHeight + 26;
  const peakCardY = productCardY + productCardHeight + 26;
  const peakCardHeight = 176;
  const suggestionCardY = peakCardY + peakCardHeight + 26;
  const footerY = suggestionCardY + suggestionCardHeight + 40;
  const height = footerY + 48;

  const coreStatBlocks = stats
    .map((item, index) => {
      const x = CARD_X + index * 320;
      const accent = item.accent ?? ['#16A34A', '#2563EB', '#7C3AED'][index] ?? '#16A34A';
      const trendColor =
        item.trend === 'up' ? '#16A34A' : item.trend === 'down' ? '#EF4444' : '#6B7280';
      return `
        <g transform="translate(${x}, 282)">
          <rect width="300" height="154" rx="24" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="1.5" />
          <rect x="18" y="18" width="264" height="6" rx="3" fill="${accent}" opacity="0.18" />
          <circle cx="40" cy="50" r="17" fill="${accent}" opacity="0.12" />
          <text x="70" y="45" fill="#6B7280" font-size="25" class="report-text">${escapeXml(item.label)}</text>
          <text x="28" y="99" fill="${index === 1 ? '#047857' : '#111827'}" font-size="${index === 1 ? 39 : 37}" font-weight="700" class="report-text">${escapeXml(
            item.value,
          )}</text>
          ${
            item.comparison
              ? `<text x="28" y="129" fill="${trendColor}" font-size="20" class="report-text">${escapeXml(
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
          const ratio = item.value / Math.max(1, input.summary.orderCount);
          const width = Math.max(16, Math.round(ratio * 560));
          const barColor = item.color;
          return `
            <g transform="translate(0, ${74 + index * 42})">
              <text x="0" y="21" fill="#374151" font-size="23" class="report-text">${escapeXml(
                item.label,
              )}</text>
              <rect x="172" y="2" width="560" height="18" rx="9" fill="#E5E7EB" />
              <rect x="172" y="2" width="${width}" height="18" rx="9" fill="${barColor}" />
              <text x="780" y="20" text-anchor="end" fill="#111827" font-size="23" font-weight="700" class="report-text">${item.value}</text>
            </g>
          `;
        })
        .join('')
    : `
        <g transform="translate(0, 80)">
          <rect width="860" height="68" rx="18" fill="#F9FAFB" stroke="#E5E7EB" />
          <text x="24" y="42" fill="#6B7280" font-size="23" class="report-text">${escapeXml(
            input.language === 'vi' ? 'Hôm nay chưa có dữ liệu đơn hàng' : '今日暂无订单数据',
          )}</text>
        </g>
      `;

  const statusBlocks = statusCards
    .map((item, index) => {
      const value = resolveStatusCount(input.summary.statusCounts, item.key);
      const x = (index % 2) * 400;
      const y = Math.floor(index / 2) * 74;
      return `
        <g transform="translate(${x}, ${y})">
          <rect width="388" height="58" rx="18" fill="#F9FAFB" stroke="#E5E7EB" />
          <circle cx="28" cy="33" r="7" fill="${item.color}" />
          <text x="46" y="36" fill="#374151" font-size="23" class="report-text">${escapeXml(item.label)}</text>
          <text x="372" y="37" text-anchor="end" fill="#111827" font-size="23" font-weight="700" class="report-text">${value}</text>
        </g>
      `;
    })
    .join('');

  const maxProductQuantity = Math.max(1, ...topProducts.map((item) => item.quantity));
  const productBlocks = topProducts.length > 0
    ? topProducts
        .map((item, index) => {
          const width = Math.max(12, Math.round((item.quantity / maxProductQuantity) * 470));
          const name = truncateText(item.name, input.language === 'vi' ? 24 : 20);
          const y = 78 + index * 68;
          return `
            <g transform="translate(0, ${y})">
              <circle cx="20" cy="18" r="15" fill="${index === 0 ? '#16A34A' : index === 1 ? '#2563EB' : index === 2 ? '#7C3AED' : '#F59E0B'}" opacity="0.12" />
              <text x="20" y="23" text-anchor="middle" fill="${index === 0 ? '#047857' : '#374151'}" font-size="17" font-weight="700" class="report-text">${index + 1}</text>
              <text x="52" y="20" fill="#111827" font-size="23" font-weight="700" class="report-text">${escapeXml(name)}</text>
              <text x="810" y="20" text-anchor="end" fill="#111827" font-size="23" font-weight="700" class="report-text">${item.quantity} ${input.language === 'vi' ? 'phần' : '份'}</text>
              <rect x="52" y="31" width="690" height="16" rx="8" fill="#E5E7EB" />
              <rect x="52" y="31" width="${width}" height="16" rx="8" fill="#16A34A" />
            </g>
          `;
        })
        .join('')
    : `
        <g transform="translate(0, 108)">
          <rect width="860" height="84" rx="20" fill="#F9FAFB" stroke="#E5E7EB" />
          <text x="430" y="50" text-anchor="middle" fill="#6B7280" font-size="25" class="report-text">${escapeXml(
            input.language === 'vi' ? 'Hôm nay chưa có món bán chạy' : '今日暂无热销菜品',
          )}</text>
        </g>
      `;

  const suggestionBlocks = suggestionRows.length > 0
    ? suggestionRows
        .map((item, index) => {
          const y = 78 + index * 60;
          const bg = index % 2 === 0 ? '#F0FDF4' : '#FFFBEB';
          const stroke = index % 2 === 0 ? '#BBF7D0' : '#FDE68A';
          const bullet = index % 2 === 0 ? '#16A34A' : '#F59E0B';
          const lines = wrapTextLines(item, input.language === 'vi' ? 50 : 42, 2);
          return `
            <g transform="translate(0, ${y})">
              <rect width="${CARD_WIDTH}" height="50" rx="16" fill="${bg}" stroke="${stroke}" />
              <circle cx="24" cy="24" r="6" fill="${bullet}" />
              ${renderTextLines({
                x: 40,
                y: 20,
                lines,
                fontSize: 21,
                lineHeight: 18,
                fill: '#374151',
              })}
            </g>
          `;
        })
        .join('')
    : `
        <g transform="translate(0, 80)">
          <rect width="${CARD_WIDTH}" height="50" rx="16" fill="#F9FAFB" stroke="#E5E7EB" />
          <text x="24" y="32" fill="#6B7280" font-size="23" class="report-text">${escapeXml(
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
    <rect width="${CARD_WIDTH}" height="176" rx="28" fill="#FFFFFF" stroke="#E5E7EB" stroke-width="1.5" />
    <rect x="18" y="18" width="924" height="140" rx="22" fill="#ECFDF5" />
    <text x="28" y="42" fill="#111827" font-size="30" font-weight="700" class="report-text">${escapeXml(
      input.language === 'vi' ? 'Khung giờ cao điểm' : '高峰时段',
    )}</text>
    <text x="28" y="84" fill="#047857" font-size="38" font-weight="700" class="report-text">${escapeXml(
      input.summary.peakHour,
    )}</text>
    <rect x="740" y="34" width="176" height="40" rx="20" fill="#16A34A" />
    <text x="828" y="61" text-anchor="middle" fill="#FFFFFF" font-size="22" font-weight="700" class="report-text">${escapeXml(
      input.language === 'vi' ? 'Điểm nóng' : '高峰提醒',
    )}</text>
    <text x="28" y="118" fill="#6B7280" font-size="24" class="report-text">${escapeXml(
      input.summary.peakHourOrderCount > 0
        ? `${input.summary.peakHourOrderCount} ${input.language === 'vi' ? 'đơn' : '单'}`
        : input.language === 'vi'
          ? 'Hôm nay chưa có khung giờ cao điểm rõ ràng'
          : '今日暂无明显高峰时段',
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
