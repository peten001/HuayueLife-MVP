import { Prisma } from '@prisma/client';
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
