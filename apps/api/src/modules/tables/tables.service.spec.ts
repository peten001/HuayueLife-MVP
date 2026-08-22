import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp = require('sharp');
import { TablesService } from './tables.service';

describe('TablesService standard table QR', () => {
  const table = {
    id: 18n,
    merchantId: 4n,
    tableNo: '大厅01号桌',
    tableName: '靠窗长桌名称'.repeat(8),
    qrToken: 'a'.repeat(64),
    qrVersion: 7,
    status: 'ACTIVE',
  };
  const findFirst = jest.fn();
  const update = jest.fn();
  const config = new Map<string, string>();
  const configService = {
    get: jest.fn((key: string) => config.get(key)),
  };
  const prisma = {
    diningTable: {
      findFirst,
      update,
    },
  };

  let service: TablesService;

  beforeEach(() => {
    jest.clearAllMocks();
    config.clear();
    config.set('MINIAPP_QR_ENTRY_URL', 'https://api.huayueyouxuan.com/t');
    findFirst.mockResolvedValue({ ...table });
    service = new TablesService(
      prisma as never,
      configService as unknown as ConfigService,
    );
  });

  it('builds the canonical HTTPS payload and safely handles a trailing slash', () => {
    expect(service.buildPublicQrPayload(table)).toBe(
      `https://api.huayueyouxuan.com/t/${table.qrToken}`,
    );

    config.set('MINIAPP_QR_ENTRY_URL', 'https://api.huayueyouxuan.com/t///');
    expect(service.buildPublicQrPayload(table)).toBe(
      `https://api.huayueyouxuan.com/t/${table.qrToken}`,
    );
  });

  it('rejects missing, malformed, query-bearing, and direct resolver bases', () => {
    config.delete('MINIAPP_QR_ENTRY_URL');
    expect(() => service.buildPublicQrPayload(table)).toThrow(BadGatewayException);

    config.set('MINIAPP_QR_ENTRY_URL', 'not-a-url');
    expect(() => service.buildPublicQrPayload(table)).toThrow(BadGatewayException);

    config.set('MINIAPP_QR_ENTRY_URL', 'https://api.huayueyouxuan.com/t?source=qr');
    expect(() => service.buildPublicQrPayload(table)).toThrow(BadGatewayException);

    config.set(
      'MINIAPP_QR_ENTRY_URL',
      'https://api.huayueyouxuan.com/api/v1/qr/resolve',
    );
    expect(() => service.buildPublicQrPayload(table)).toThrow(BadGatewayException);
  });

  it('returns a pure 1024px PNG without calling WeChat or mutating QR identity', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    try {
      const result = await service.qrImage(table.merchantId, table.id);
      const metadata = await sharp(result.image).metadata();

      expect(metadata.format).toBe('png');
      expect(metadata.width).toBe(1024);
      expect(metadata.height).toBe(1024);
      const { data, info } = await sharp(result.image)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const channelValues = new Set<number>();
      let hasNonGrayscalePixel = false;
      for (let index = 0; index < data.length; index += info.channels) {
        channelValues.add(data[index]);
        if (data[index + 1] !== data[index] || data[index + 2] !== data[index]) {
          hasNonGrayscalePixel = true;
          break;
        }
      }
      expect(hasNonGrayscalePixel).toBe(false);
      expect([...channelValues].sort((left, right) => left - right)).toEqual([0, 255]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(result.table.qrToken).toBe(table.qrToken);
      expect(result.table.qrVersion).toBe(table.qrVersion);
      expect(service.buildScene(result.table)).toBe('t18v7');
    } finally {
      global.fetch = originalFetch;
    }
  });
});
