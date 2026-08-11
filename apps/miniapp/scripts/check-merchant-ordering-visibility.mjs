import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMerchantOrderingVisibility } from '../src/utils/merchant-ordering-visibility.ts';

function claimedMerchant(overrides = {}) {
  return {
    merchantMode: 'MANAGED',
    claimStatus: 'CLAIMED',
    isOpen: false,
    platformOrderingEnabled: true,
    hasCapabilityRecords: true,
    pickupEnabled: false,
    deliveryEnabled: false,
    dineInEnabled: false,
    qrOrderEnabled: false,
    enabledCapabilityCodes: new Set(),
    supportedOrderTypes: [],
    ...overrides,
  };
}

test('closed claimed merchant still exposes enabled pickup as a service facility', () => {
  const result = resolveMerchantOrderingVisibility(claimedMerchant({ pickupEnabled: true }));

  assert.equal(result.pickupFacilityVisible, true);
  assert.equal(result.pickupCtaVisible, false);
});

test('closed claimed merchant still exposes enabled delivery as a service facility', () => {
  const result = resolveMerchantOrderingVisibility(claimedMerchant({ deliveryEnabled: true }));

  assert.equal(result.deliveryFacilityVisible, true);
  assert.equal(result.deliveryCtaVisible, false);
});

test('bottom order CTAs retain the existing supported-order-type gate', () => {
  const unavailable = resolveMerchantOrderingVisibility(
    claimedMerchant({ pickupEnabled: true, deliveryEnabled: true }),
  );
  const available = resolveMerchantOrderingVisibility(
    claimedMerchant({
      pickupEnabled: true,
      deliveryEnabled: true,
      supportedOrderTypes: ['PICKUP', 'DELIVERY'],
    }),
  );

  assert.deepEqual(
    [unavailable.pickupCtaVisible, unavailable.deliveryCtaVisible],
    [false, false],
  );
  assert.deepEqual([available.pickupCtaVisible, available.deliveryCtaVisible], [true, true]);
});

test('display merchant never exposes ordering facilities or CTAs', () => {
  const result = resolveMerchantOrderingVisibility({
    ...claimedMerchant({
      merchantMode: 'DISPLAY',
      claimStatus: 'UNCLAIMED',
      pickupEnabled: true,
      deliveryEnabled: true,
      dineInEnabled: true,
      qrOrderEnabled: true,
      enabledCapabilityCodes: new Set([
        'pickupEnabled',
        'deliveryEnabled',
        'qrOrderEnabled',
      ]),
      supportedOrderTypes: ['DINE_IN', 'PICKUP', 'DELIVERY'],
    }),
  });

  assert.deepEqual(result, {
    pickupFacilityVisible: false,
    deliveryFacilityVisible: false,
    qrFacilityVisible: false,
    pickupCtaVisible: false,
    deliveryCtaVisible: false,
  });
});

test('effective QR capability only adds the service facility', () => {
  const result = resolveMerchantOrderingVisibility(
    claimedMerchant({
      dineInEnabled: true,
      qrOrderEnabled: true,
      supportedOrderTypes: ['DINE_IN'],
    }),
  );

  assert.equal(result.qrFacilityVisible, true);
  assert.equal('qrCtaVisible' in result, false);
  assert.equal('tableToken' in result, false);
});

test('QR facility requires both dine-in and QR prerequisites', () => {
  const dineInDisabled = resolveMerchantOrderingVisibility(
    claimedMerchant({ qrOrderEnabled: true, supportedOrderTypes: ['DINE_IN'] }),
  );
  const qrDisabled = resolveMerchantOrderingVisibility(
    claimedMerchant({ dineInEnabled: true, supportedOrderTypes: ['DINE_IN'] }),
  );

  assert.equal(dineInDisabled.qrFacilityVisible, false);
  assert.equal(qrDisabled.qrFacilityVisible, false);
});

test('global ordering gate hides every ordering facility and CTA', () => {
  const result = resolveMerchantOrderingVisibility(
    claimedMerchant({
      platformOrderingEnabled: false,
      pickupEnabled: true,
      deliveryEnabled: true,
      dineInEnabled: true,
      qrOrderEnabled: true,
      supportedOrderTypes: ['DINE_IN', 'PICKUP', 'DELIVERY'],
    }),
  );

  assert.deepEqual(result, {
    pickupFacilityVisible: false,
    deliveryFacilityVisible: false,
    qrFacilityVisible: false,
    pickupCtaVisible: false,
    deliveryCtaVisible: false,
  });
});
