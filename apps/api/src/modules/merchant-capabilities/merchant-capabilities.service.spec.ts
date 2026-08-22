import { MerchantCapabilitiesService } from './merchant-capabilities.service';

describe('MerchantCapabilitiesService', () => {
  it('prefers capability delivery flag over legacy merchant boolean', () => {
    const service = new MerchantCapabilitiesService({} as never);

    expect(
      service.resolveCapabilitiesFromMerchant({
        deliveryEnabled: false,
        pickupEnabled: false,
        capabilities: [{ isEnabled: true, capability: { code: 'deliveryEnabled' } }],
      }),
    ).toEqual({
      pickupEnabled: false,
      deliveryEnabled: true,
    });
  });

  it('falls back per capability when a specific capability record is missing', () => {
    const service = new MerchantCapabilitiesService({} as never);

    expect(
      service.resolveCapabilitiesFromMerchant({
        deliveryEnabled: true,
        pickupEnabled: false,
        capabilities: [{ isEnabled: true, capability: { code: 'qrOrderEnabled' } }],
      }),
    ).toEqual({
      pickupEnabled: false,
      deliveryEnabled: true,
    });
  });

  it('uses explicit disabled capability over legacy enabled merchant boolean', () => {
    const service = new MerchantCapabilitiesService({} as never);

    expect(
      service.resolveCapabilitiesFromMerchant({
        deliveryEnabled: true,
        pickupEnabled: true,
        capabilities: [
          { isEnabled: false, capability: { code: 'deliveryEnabled' } },
          { isEnabled: true, capability: { code: 'pickupEnabled' } },
        ],
      }),
    ).toEqual({
      pickupEnabled: true,
      deliveryEnabled: false,
    });
  });

  it('uses the legacy dine-in flag only when no capability records exist', () => {
    const service = new MerchantCapabilitiesService({} as never);

    expect(service.resolveQrTableOrderingCapabilities({ dineInEnabled: true })).toEqual({
      dineInEnabled: true,
      qrOrderEnabled: true,
      tableManagementEnabled: true,
    });
    expect(
      service.resolveQrTableOrderingCapabilities({
        dineInEnabled: true,
        capabilities: [{ isEnabled: true, capability: { code: 'pickupEnabled' } }],
      }),
    ).toEqual({
      dineInEnabled: true,
      qrOrderEnabled: false,
      tableManagementEnabled: false,
    });
  });

  it('requires dine-in, QR ordering, and table management for public table ordering', () => {
    const service = new MerchantCapabilitiesService({} as never);
    const merchant = {
      dineInEnabled: true,
      capabilities: [
        { isEnabled: true, capability: { code: 'qrOrderEnabled' } },
        { isEnabled: true, capability: { code: 'tableManagementEnabled' } },
      ],
    };

    expect(service.qrTableOrderingBlockReason(merchant)).toBeNull();
    expect(service.qrTableOrderingBlockReason({ ...merchant, dineInEnabled: false }))
      .toBe('商家当前未开启堂食');
    expect(service.qrTableOrderingBlockReason({
      ...merchant,
      capabilities: [
        { isEnabled: false, capability: { code: 'qrOrderEnabled' } },
        { isEnabled: true, capability: { code: 'tableManagementEnabled' } },
      ],
    })).toBe('商家当前未开启扫码点餐');
    expect(service.qrTableOrderingBlockReason({
      ...merchant,
      capabilities: [
        { isEnabled: true, capability: { code: 'qrOrderEnabled' } },
        { isEnabled: false, capability: { code: 'tableManagementEnabled' } },
      ],
    })).toBe('商家当前未开启桌台管理');
  });
});
