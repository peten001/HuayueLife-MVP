type RoutingEntry = {
  printerId: string;
  newOrderAutoPrint: boolean;
  categoryIds: string[];
};

type RoutingState = {
  configured: boolean;
  checkoutDefaultPrinterId: string | null;
  defaultKitchenPrinterId: string | null;
  frontDeskPrinters: RoutingEntry[];
  kitchenPrinters: RoutingEntry[];
};

export function sanitizePrintingRouting<T extends RoutingState>(
  routing: T,
  currentPrinterIds: Iterable<string>,
): T {
  const validIds = new Set(currentPrinterIds);
  return {
    ...routing,
    checkoutDefaultPrinterId:
      routing.checkoutDefaultPrinterId &&
      validIds.has(routing.checkoutDefaultPrinterId)
        ? routing.checkoutDefaultPrinterId
        : null,
    defaultKitchenPrinterId:
      routing.defaultKitchenPrinterId &&
      validIds.has(routing.defaultKitchenPrinterId)
        ? routing.defaultKitchenPrinterId
        : null,
    frontDeskPrinters: routing.frontDeskPrinters
      .filter((entry) => validIds.has(entry.printerId))
      .map((entry) => ({ ...entry, categoryIds: [] })),
    kitchenPrinters: routing.kitchenPrinters
      .filter((entry) => validIds.has(entry.printerId))
      .map((entry) => ({ ...entry, categoryIds: [...entry.categoryIds] })),
  };
}

export function buildPrintingRoutingPayload(
  routing: RoutingState,
  currentPrinterIds: Iterable<string>,
) {
  const sanitized = sanitizePrintingRouting(routing, currentPrinterIds);
  return {
    checkoutDefaultPrinterId: sanitized.checkoutDefaultPrinterId,
    defaultKitchenPrinterId: sanitized.defaultKitchenPrinterId,
    frontDeskPrinters: sanitized.frontDeskPrinters.map((entry) => ({
      ...entry,
      categoryIds: [],
    })),
    kitchenPrinters: sanitized.kitchenPrinters,
  };
}
