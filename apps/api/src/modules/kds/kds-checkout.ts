import { ConflictException } from '@nestjs/common';
import { KdsSetting, Prisma } from '@prisma/client';
import { DEFAULT_KDS_STATIONS } from './kds-sync';

/** Establish a settings-row mutex even for a previously unconfigured merchant. */
export async function lockKdsSettings(tx: Prisma.TransactionClient, merchantId: bigint) {
  if (!tx.kdsSetting) return; // Narrow legacy transaction doubles do not model KDS.
  // A merchant-row exclusive lock would invert the existing table/order -> FK
  // checks used by printing. A no-op duplicate insert locks only this setting,
  // preserves all explicit values, and serializes first-time configuration.
  await tx.$executeRaw`
    INSERT INTO kds_settings (merchant_id, enabled, serving_enabled, timeout_minutes, stations, category_routes, updated_at)
    VALUES (${merchantId}, false, false, 15, ${JSON.stringify(DEFAULT_KDS_STATIONS)}, '[]', CURRENT_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE merchant_id = ${merchantId}
  `;
  await tx.$queryRaw`SELECT merchant_id FROM kds_settings WHERE merchant_id = ${merchantId} FOR UPDATE`;
}

export async function assertKdsCheckoutComplete(
  tx: Prisma.TransactionClient, merchantId: bigint, orderIds: bigint[], settings: KdsSetting | null,
) {
  if (!settings?.enabled || !orderIds.length) return;
  // The caller holds settings and order locks. Current reads include unreported
  // portions and every station, and never dispatch or manufacture completion.
  const rows = await tx.$queryRaw<Array<{
    quantity: number; kitchen_quantity: number | null; made_quantity: number | null; served_quantity: number | null;
  }>>(Prisma.sql`
    SELECT oi.quantity, kt.quantity AS kitchen_quantity, kt.made_quantity, kt.served_quantity
    FROM order_items oi
    INNER JOIN orders o ON o.id = oi.order_id
    LEFT JOIN kds_tasks kt ON kt.order_item_id = oi.id AND kt.merchant_id = ${merchantId}
    WHERE o.merchant_id = ${merchantId} AND o.id IN (${Prisma.join(orderIds)}) AND oi.quantity > 0
    FOR UPDATE
  `);
  if (rows.some(row => row.kitchen_quantity !== row.quantity || (row.made_quantity ?? 0) < row.quantity)) {
    throw new ConflictException({ code: 'KDS_CHECKOUT_MAKING_REQUIRED', message: '请先通知厨房并在 KDS 划完全部菜品后再结账' });
  }
  if (settings.servingEnabled && rows.some(row => (row.served_quantity ?? 0) < row.quantity)) {
    throw new ConflictException({ code: 'KDS_CHECKOUT_SERVING_REQUIRED', message: '请先在 KDS 传完全部菜品后再结账' });
  }
}
