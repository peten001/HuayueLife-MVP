import { Injectable } from '@nestjs/common';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import sharp = require('sharp');
import type { DailyReportLanguage } from './merchant-reports.constants';

type DailyReportSummary = {
  orderCount: number;
  totalAmount: string;
  averageOrderAmount: string;
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
  const title =
    input.language === 'vi'
      ? 'HuaYue YouXuan · Báo cáo kinh doanh hằng ngày'
      : '华越优选 · 每日营业日报';
  const subtitle =
    input.language === 'vi'
      ? `Cửa hàng: ${input.merchantName}`
      : `商家：${input.merchantName}`;
  const totalAmount = formatMoney(input.summary.totalAmount);
  const averageOrderAmount = formatMoney(input.summary.averageOrderAmount);
  const stats = [
    {
      label: input.language === 'vi' ? 'Đơn hôm nay' : '今日订单',
      value: String(input.summary.orderCount),
    },
    {
      label: input.language === 'vi' ? 'Doanh thu hôm nay' : '今日营业额',
      value: totalAmount,
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
    { key: 'PENDING_ACCEPTANCE', label: input.language === 'vi' ? 'Chờ nhận' : '待接单' },
    { key: 'PREPARING', label: input.language === 'vi' ? 'Đang chuẩn bị' : '制作中' },
    { key: 'COMPLETED', label: input.language === 'vi' ? 'Hoàn tất' : '已完成' },
    { key: 'CANCELLED', label: input.language === 'vi' ? 'Đã hủy' : '已取消' },
  ];
  const statusTotal = Math.max(
    1,
    statusCards.reduce((sum, item) => sum + (input.summary.statusCounts[item.key] ?? 0), 0),
  );
  const suggestionRows = input.summary.suggestions.slice(0, 3);
  const topProducts = input.summary.topProducts.slice(0, 5);
  const height = 2220 + Math.max(0, suggestionRows.length - 1) * 32;

  const coreStatBlocks = stats
    .map(
      (item, index) => `
        <g transform="translate(${CARD_X + index * 320}, 240)">
          <rect width="300" height="150" rx="24" fill="#FFFFFF" stroke="#D1FAE5" stroke-width="2" />
          <text x="24" y="42" fill="#6B7280" font-size="28" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
            item.label,
          )}</text>
          <text x="24" y="98" fill="#111827" font-size="44" font-weight="700" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
            item.value,
          )}</text>
        </g>
      `,
    )
    .join('');

  const orderTypeBlocks = orderTypes
    .map((item, index) => {
      const width = Math.max(0, Math.round((item.value / Math.max(1, input.summary.orderCount)) * 520));
      return `
        <g transform="translate(0, ${60 + index * 56})">
          <text x="0" y="24" fill="#374151" font-size="26" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
            item.label,
          )}</text>
          <rect x="170" y="4" width="520" height="26" rx="13" fill="#E5E7EB" />
          <rect x="170" y="4" width="${Math.max(16, width)}" height="26" rx="13" fill="${item.color}" />
          <text x="710" y="25" fill="#111827" font-size="24" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${item.value}</text>
        </g>
      `;
    })
    .join('');

  const statusBlocks = statusCards
    .map((item, index) => {
      const value = input.summary.statusCounts[item.key] ?? 0;
      const width = Math.max(0, Math.round((value / statusTotal) * 220));
      return `
        <g transform="translate(${(index % 2) * 480}, ${70 + Math.floor(index / 2) * 78})">
          <rect width="450" height="62" rx="18" fill="#F9FAFB" stroke="#E5E7EB" />
          <text x="22" y="38" fill="#374151" font-size="24" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(item.label)}</text>
          <rect x="220" y="20" width="220" height="22" rx="11" fill="#E5E7EB" />
          <rect x="220" y="20" width="${Math.max(8, width)}" height="22" rx="11" fill="#16A34A" />
          <text x="410" y="38" text-anchor="end" fill="#111827" font-size="24" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${value}</text>
        </g>
      `;
    })
    .join('');

  const productBlocks = topProducts
    .map((item, index) => {
      const width = Math.max(10, Math.round((item.quantity / Math.max(1, topProducts[0]?.quantity ?? 1)) * 560));
      const y = 70 + index * 78;
      return `
        <g transform="translate(0, ${y})">
          <text x="0" y="24" fill="#374151" font-size="24" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
            truncateText(item.name, 18),
          )}</text>
          <rect x="220" y="4" width="560" height="26" rx="13" fill="#E5E7EB" />
          <rect x="220" y="4" width="${width}" height="26" rx="13" fill="#16A34A" />
          <text x="810" y="25" fill="#111827" font-size="24" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${item.quantity} ${input.language === 'vi' ? 'món' : '份'}</text>
        </g>
      `;
    })
    .join('');

  const suggestionBlocks = suggestionRows
    .map(
      (item, index) => `
        <g transform="translate(0, ${70 + index * 92})">
          <rect width="${CARD_WIDTH}" height="74" rx="20" fill="${index % 2 === 0 ? '#F0FDF4' : '#FEFCE8'}" stroke="${index % 2 === 0 ? '#BBF7D0' : '#FDE68A'}" />
          <text x="28" y="46" fill="#374151" font-size="26" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
            truncateMultiline(item, 42),
          )}</text>
        </g>
      `,
    )
    .join('');

  const suggestionEmptyBlock =
    suggestionRows.length === 0
      ? `
        <g transform="translate(0, 70)">
          <rect width="${CARD_WIDTH}" height="74" rx="20" fill="#F9FAFB" stroke="#E5E7EB" />
          <text x="28" y="46" fill="#6B7280" font-size="26" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
            input.language === 'vi' ? 'Chưa có gợi ý cho hôm nay' : '今日暂无经营建议',
          )}</text>
        </g>
      `
      : '';

  const footerY = 2140 + Math.max(0, suggestionRows.length - 1) * 32;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${IMAGE_WIDTH}" height="${height}" viewBox="0 0 ${IMAGE_WIDTH} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#EAF8EF"/>
      <stop offset="100%" stop-color="#F8FFFB"/>
    </linearGradient>
  </defs>
  <rect width="${IMAGE_WIDTH}" height="${height}" fill="url(#bg)" />
  <rect x="40" y="40" width="1000" height="${height - 80}" rx="36" fill="#FFFFFF" opacity="0.9" />
  <text x="${CARD_X}" y="130" fill="#16A34A" font-size="44" font-weight="700" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
    title,
  )}</text>
  <text x="${CARD_X}" y="180" fill="#374151" font-size="30" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
    subtitle,
  )}</text>
  <text x="${CARD_X}" y="214" fill="#6B7280" font-size="24" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
    `${input.language === 'vi' ? 'Ngày' : '日期'}：${input.reportDate}`,
  )}</text>
  ${coreStatBlocks}
  <g transform="translate(${CARD_X}, 420)">
    <rect width="${CARD_WIDTH}" height="190" rx="28" fill="#FFFFFF" stroke="#D1FAE5" stroke-width="2" />
    <text x="28" y="40" fill="#111827" font-size="30" font-weight="700" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
      input.language === 'vi' ? 'Cơ cấu đơn hàng' : '订单类型',
    )}</text>
    ${orderTypeBlocks}
  </g>
  <g transform="translate(${CARD_X}, 640)">
    <rect width="${CARD_WIDTH}" height="360" rx="28" fill="#FFFFFF" stroke="#D1FAE5" stroke-width="2" />
    <text x="28" y="40" fill="#111827" font-size="30" font-weight="700" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
      input.language === 'vi' ? 'Trạng thái đơn hàng' : '订单状态',
    )}</text>
    ${statusBlocks}
  </g>
  <g transform="translate(${CARD_X}, 1040)">
    <rect width="${CARD_WIDTH}" height="480" rx="28" fill="#FFFFFF" stroke="#D1FAE5" stroke-width="2" />
    <text x="28" y="40" fill="#111827" font-size="30" font-weight="700" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
      input.language === 'vi' ? 'Top món bán chạy' : '热门菜品 Top 5',
    )}</text>
    ${productBlocks}
  </g>
  <g transform="translate(${CARD_X}, 1560)">
    <rect width="${CARD_WIDTH}" height="150" rx="28" fill="#FFFFFF" stroke="#D1FAE5" stroke-width="2" />
    <text x="28" y="42" fill="#111827" font-size="30" font-weight="700" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
      input.language === 'vi' ? 'Khung giờ cao điểm' : '高峰时段',
    )}</text>
    <text x="28" y="92" fill="#16A34A" font-size="38" font-weight="700" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
      input.summary.peakHour,
    )}</text>
    <text x="340" y="92" fill="#6B7280" font-size="24" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
      input.summary.peakHourOrderCount > 0
        ? `${input.summary.peakHourOrderCount} ${input.language === 'vi' ? 'đơn' : '单'}`
        : input.language === 'vi'
          ? 'Chưa xác định'
          : '暂无明显高峰',
    )}</text>
  </g>
  <g transform="translate(${CARD_X}, ${1740})">
    <rect width="${CARD_WIDTH}" height="340" rx="28" fill="#FFFFFF" stroke="#D1FAE5" stroke-width="2" />
    <text x="28" y="42" fill="#111827" font-size="30" font-weight="700" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
      input.language === 'vi' ? 'Gợi ý vận hành' : '经营建议',
    )}</text>
    ${suggestionBlocks}
    ${suggestionEmptyBlock}
  </g>
  <text x="${CARD_X}" y="${footerY}" fill="#6B7280" font-size="22" font-family="PingFang SC, Microsoft YaHei, Arial, sans-serif">${escapeXml(
    input.language === 'vi'
      ? 'Báo cáo được HuaYue YouXuan tạo tự động, chỉ dùng để tham khảo kinh doanh.'
      : '本日报由华越优选自动生成，数据仅供商家经营参考。',
  )}</text>
</svg>`;
}

function formatMoney(value: string) {
  const amount = Number(value ?? 0);
  return `${amount.toLocaleString('en-US')} ₫`;
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function truncateMultiline(value: string, maxLength: number) {
  return truncateText(value.replace(/\s+/g, ' ').trim(), maxLength);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
