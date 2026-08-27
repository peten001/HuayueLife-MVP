import type {
  CashierMenuProduct,
  CashierOrderingDraftLine,
  OrderItem,
  TableSessionOrder,
} from '@/types';

type IdentityCarrier = Record<string, unknown>;

const FUTURE_IDENTITY_FIELDS = [
  'skuId',
  'variantId',
  'variantKey',
  'specificationId',
  'specification',
  'addonSignature',
  'addOns',
  'addons',
  'toppings',
  'options',
] as const;

export interface CanonicalCommittedEntry {
  item: OrderItem;
  order: TableSessionOrder;
}

export interface CanonicalTableBillLine {
  mergeKey: string;
  firstAddedAt: string;
  firstAddedSequence: number;
  firstAddedTieBreaker: string;
  firstAddedSource: 'committed' | 'pending';
  item?: OrderItem;
  order?: TableSessionOrder;
  product?: CashierMenuProduct;
  committedEntries: CanonicalCommittedEntry[];
  draftLines: CashierOrderingDraftLine[];
  committedQuantity: number;
  pendingQuantity: number;
  quantity: number;
  subtotalVnd: string;
  remark: string;
}

interface CanonicalFirstAddedAnchor {
  firstAddedAt: string;
  firstAddedAtMs: number;
  firstAddedSequence: number;
  firstAddedTieBreaker: string;
  firstAddedSource: 'committed' | 'pending';
}

function firstAddedAtMs(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function compareStableIdentity(left: string, right: string) {
  return left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' });
}

function compareFirstAddedAnchors(left: CanonicalFirstAddedAnchor, right: CanonicalFirstAddedAnchor) {
  if (left.firstAddedSource !== right.firstAddedSource) {
    return left.firstAddedSource === 'committed' ? -1 : 1;
  }
  if (left.firstAddedAtMs !== right.firstAddedAtMs) {
    return left.firstAddedAtMs - right.firstAddedAtMs;
  }
  if (
    left.firstAddedSource === 'pending'
    && left.firstAddedSequence !== right.firstAddedSequence
  ) {
    return left.firstAddedSequence - right.firstAddedSequence;
  }
  const identityOrder = compareStableIdentity(
    left.firstAddedTieBreaker,
    right.firstAddedTieBreaker,
  );
  return identityOrder || left.firstAddedSequence - right.firstAddedSequence;
}

function committedFirstAddedAnchor(
  order: TableSessionOrder,
  item: OrderItem,
  sequence: number,
): CanonicalFirstAddedAnchor {
  const firstAddedAt = order.createdAt || '';
  return {
    firstAddedAt,
    firstAddedAtMs: firstAddedAtMs(firstAddedAt),
    firstAddedSequence: sequence,
    firstAddedTieBreaker: `${order.id}:${item.id}`,
    firstAddedSource: 'committed',
  };
}

function pendingFirstAddedAnchor(
  draftLine: CashierOrderingDraftLine,
  mergeKey: string,
  sequence: number,
): CanonicalFirstAddedAnchor {
  const firstAddedAt = draftLine.firstAddedAt || '';
  return {
    firstAddedAt,
    firstAddedAtMs: firstAddedAtMs(firstAddedAt),
    firstAddedSequence: draftLine.firstAddedSequence ?? sequence,
    firstAddedTieBreaker: `${draftLine.lineId}:${mergeKey}`,
    firstAddedSource: 'pending',
  };
}

function applyEarlierFirstAddedAnchor(
  line: CanonicalTableBillLine,
  current: CanonicalFirstAddedAnchor,
  candidate: CanonicalFirstAddedAnchor,
) {
  if (compareFirstAddedAnchors(candidate, current) >= 0) return current;
  line.firstAddedAt = candidate.firstAddedAt;
  line.firstAddedSequence = candidate.firstAddedSequence;
  line.firstAddedTieBreaker = candidate.firstAddedTieBreaker;
  line.firstAddedSource = candidate.firstAddedSource;
  return candidate;
}

export function normalizeOrderLineRemark(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim().replace(/\s+/g, ' ')
    : '';
}

function normalizeIdentityValue(value: unknown): unknown {
  if (value == null) return undefined;
  if (typeof value === 'string') return normalizeOrderLineRemark(value) || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .map(normalizeIdentityValue)
      .filter((entry) => entry !== undefined)
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (typeof value === 'object') {
    const normalized = Object.entries(value as IdentityCarrier)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, entry]) => {
        const next = normalizeIdentityValue(entry);
        return next === undefined ? [] : [[key, next] as const];
      });
    return normalized.length ? Object.fromEntries(normalized) : undefined;
  }
  return String(value);
}

function futureIdentity(source: IdentityCarrier) {
  return Object.fromEntries(FUTURE_IDENTITY_FIELDS.flatMap((field) => {
    const value = normalizeIdentityValue(source[field]);
    return value === undefined ? [] : [[field, value]];
  }));
}

export function productDirectMergeKey(
  productId: string,
  remark = '',
  identitySource: IdentityCarrier = {},
) {
  return JSON.stringify({
    productId,
    remark: normalizeOrderLineRemark(remark),
    ...futureIdentity(identitySource),
  });
}

export function buildCanonicalItemMergeKey(item: OrderItem) {
  if (!item.productId) return `historical:${item.id}`;
  return productDirectMergeKey(
    item.productId,
    normalizeOrderLineRemark(item.remark),
    item as unknown as IdentityCarrier,
  );
}

export function buildCanonicalTableBillLines(
  orders: TableSessionOrder[],
  draftLines: CashierOrderingDraftLine[] = [],
) {
  const lines = new Map<string, CanonicalTableBillLine>();
  const anchors = new Map<string, CanonicalFirstAddedAnchor>();
  let sourceSequence = 0;

  for (const order of orders) {
    for (const sessionItem of order.items) {
      const item = sessionItem as OrderItem;
      const mergeKey = buildCanonicalItemMergeKey(item);
      const anchor = committedFirstAddedAnchor(order, item, sourceSequence++);
      const existing = lines.get(mergeKey);
      const committedQuantity = Number(item.quantity || 0);
      const committedSubtotal = BigInt(item.subtotalVnd || '0');
      if (existing) {
        anchors.set(
          mergeKey,
          applyEarlierFirstAddedAnchor(existing, anchors.get(mergeKey)!, anchor),
        );
        existing.item = item;
        existing.order = order;
        existing.committedEntries.push({ item, order });
        existing.committedQuantity += committedQuantity;
        existing.quantity += committedQuantity;
        existing.subtotalVnd = (BigInt(existing.subtotalVnd) + committedSubtotal).toString();
      } else {
        lines.set(mergeKey, {
          mergeKey,
          firstAddedAt: anchor.firstAddedAt,
          firstAddedSequence: anchor.firstAddedSequence,
          firstAddedTieBreaker: anchor.firstAddedTieBreaker,
          firstAddedSource: anchor.firstAddedSource,
          item,
          order,
          committedEntries: [{ item, order }],
          draftLines: [],
          committedQuantity,
          pendingQuantity: 0,
          quantity: committedQuantity,
          subtotalVnd: committedSubtotal.toString(),
          remark: normalizeOrderLineRemark(item.remark),
        });
        anchors.set(mergeKey, anchor);
      }
    }
  }

  for (const draftLine of draftLines) {
    const mergeKey = draftLine.mergeKey || productDirectMergeKey(
      draftLine.product.id,
      draftLine.remark,
      draftLine as unknown as IdentityCarrier,
    );
    const pendingSubtotal = BigInt(draftLine.product.priceVnd || '0') * BigInt(draftLine.quantity);
    const anchor = pendingFirstAddedAnchor(draftLine, mergeKey, sourceSequence++);
    const existing = lines.get(mergeKey);
    if (existing) {
      anchors.set(
        mergeKey,
        applyEarlierFirstAddedAnchor(existing, anchors.get(mergeKey)!, anchor),
      );
      existing.product ??= draftLine.product;
      existing.draftLines.push(draftLine);
      existing.pendingQuantity += draftLine.quantity;
      existing.quantity += draftLine.quantity;
      existing.subtotalVnd = (BigInt(existing.subtotalVnd) + pendingSubtotal).toString();
    } else {
      lines.set(mergeKey, {
        mergeKey,
        firstAddedAt: anchor.firstAddedAt,
        firstAddedSequence: anchor.firstAddedSequence,
        firstAddedTieBreaker: anchor.firstAddedTieBreaker,
        firstAddedSource: anchor.firstAddedSource,
        product: draftLine.product,
        committedEntries: [],
        draftLines: [draftLine],
        committedQuantity: 0,
        pendingQuantity: draftLine.quantity,
        quantity: draftLine.quantity,
        subtotalVnd: pendingSubtotal.toString(),
        remark: normalizeOrderLineRemark(draftLine.remark),
      });
      anchors.set(mergeKey, anchor);
    }
  }

  return [...lines.values()].sort((left, right) => compareFirstAddedAnchors(
    anchors.get(left.mergeKey)!,
    anchors.get(right.mergeKey)!,
  ));
}

export function stabilizeCanonicalTableBillLineOrder(
  lines: CanonicalTableBillLine[],
  previousMergeKeyOrder: readonly string[] = [],
) {
  const remaining = new Map(lines.map((line) => [line.mergeKey, line]));
  const stableLines: CanonicalTableBillLine[] = [];

  for (const mergeKey of previousMergeKeyOrder) {
    const line = remaining.get(mergeKey);
    if (!line) continue;
    stableLines.push(line);
    remaining.delete(mergeKey);
  }

  for (const line of lines) {
    if (!remaining.has(line.mergeKey)) continue;
    stableLines.push(line);
    remaining.delete(line.mergeKey);
  }

  return stableLines;
}
