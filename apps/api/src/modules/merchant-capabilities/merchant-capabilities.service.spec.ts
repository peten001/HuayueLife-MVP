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
});
