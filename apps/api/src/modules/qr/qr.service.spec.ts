import { GoneException } from '@nestjs/common';
import { AppConfigService } from '../app-config/app-config.service';
import { MerchantCapabilitiesService } from '../merchant-capabilities/merchant-capabilities.service';
import { QrService } from './qr.service';

describe('QrService legacy and standard QR compatibility', () => {
  const findUnique = jest.fn();
  const appConfig = {
    assertOrderingEnabled: jest.fn(),
  };
  const merchantCapabilities = new MerchantCapabilitiesService({} as never);
  const token = 'a'.repeat(64);
  const activeTable = {
    id: 18n,
    merchantId: 4n,
    tableNo: 'A01',
    tableName: '靠窗桌',
    qrToken: token,
    qrVersion: 7,
    status: 'ACTIVE',
    merchant: {
      id: 4n,
      nameZh: '测试餐厅',
      nameVi: 'Nha hang thu nghiem',
      status: 'ACTIVE',
      merchantType: 'RESTAURANT',
      dineInEnabled: true,
      capabilities: [],
    },
  };

  let service: QrService;

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue(structuredClone(activeTable));
    service = new QrService(
      { diningTable: { findUnique } } as never,
      appConfig as unknown as AppConfigService,
      merchantCapabilities,
    );
  });

  it('resolves both the current token and the unchanged legacy scene contract', async () => {
    await expect(service.resolve({ token })).resolves.toMatchObject({
      orderType: 'DINE_IN',
      tableToken: token,
      merchant: { id: 4n },
      table: { id: 18n, tableNo: 'A01' },
    });
    await expect(service.resolve({ scene: 't18v7' })).resolves.toMatchObject({
      orderType: 'DINE_IN',
      tableToken: token,
      table: { id: 18n },
    });
  });

  it('keeps old-scene version invalidation and rejects invalid tokens', async () => {
    findUnique.mockResolvedValueOnce({ ...structuredClone(activeTable), qrVersion: 8 });
    await expect(service.resolve({ scene: 't18v7' })).rejects.toThrow(
      '二维码已失效，请重新打印',
    );
    await expect(service.resolve({ token: 'invalid' })).rejects.toThrow(
      '二维码缺少参数',
    );
  });

  it('blocks disabled tables and the platform-wide off state', async () => {
    findUnique.mockResolvedValueOnce({ ...structuredClone(activeTable), status: 'DISABLED' });
    await expect(service.resolve({ token })).rejects.toThrow('该桌台已停用');

    appConfig.assertOrderingEnabled.mockImplementationOnce(() => {
      throw new GoneException('平台经营能力总开关已关闭');
    });
    await expect(service.resolve({ token })).rejects.toThrow('平台经营能力总开关已关闭');
  });

  it.each([
    {
      label: 'dine-in disabled',
      dineInEnabled: false,
      capabilities: [],
      message: '商家当前未开启堂食',
    },
    {
      label: 'QR ordering disabled',
      dineInEnabled: true,
      capabilities: [
        { isEnabled: false, capability: { code: 'qrOrderEnabled' } },
        { isEnabled: true, capability: { code: 'tableManagementEnabled' } },
      ],
      message: '商家当前未开启扫码点餐',
    },
    {
      label: 'table management disabled',
      dineInEnabled: true,
      capabilities: [
        { isEnabled: true, capability: { code: 'qrOrderEnabled' } },
        { isEnabled: false, capability: { code: 'tableManagementEnabled' } },
      ],
      message: '商家当前未开启桌台管理',
    },
  ])('blocks $label without weakening the resolver gate', async ({
    dineInEnabled,
    capabilities,
    message,
  }) => {
    findUnique.mockResolvedValueOnce({
      ...structuredClone(activeTable),
      merchant: {
        ...structuredClone(activeTable.merchant),
        dineInEnabled,
        capabilities,
      },
    });

    await expect(service.resolve({ token })).rejects.toThrow(message);
  });
});
