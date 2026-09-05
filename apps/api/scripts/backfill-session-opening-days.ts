import { PrismaClient } from '@prisma/client';
import { resolveBusinessDate } from '../src/common/utils/merchant-hours';

/** Explicit, resumable legacy snapshot backfill; existing snapshots and all
 * historical order/checkout timestamps and amounts remain unchanged. */
export async function backfillSessionOpeningDays(
  prisma: PrismaClient,
  merchantId: bigint | undefined,
  apply = false,
) {
  let cursor = 0n;
  let examined = 0;
  let updated = 0;
  for (;;) {
    const rows = await prisma.tableSession.findMany({
      where: { merchantId, id: { gt: cursor }, openedBusinessDate: null },
      select: { id: true, merchantId: true, openedAt: true, merchant: { select: { businessHours: true } } },
      orderBy: { id: 'asc' }, take: 200,
    });
    if (!rows.length) break;
    for (const row of rows) {
      // Validate even during dry-run. No writes or locks in dry-run mode.
      resolveBusinessDate(row.merchant.businessHours, row.openedAt);
      examined += 1;
      if (apply) updated += await prisma.$transaction(async tx => {
        // Freeze using one consistent configuration; serialize with hours edits.
        await tx.$queryRaw`SELECT id FROM merchants WHERE id = ${row.merchantId} FOR UPDATE`;
        const current = await tx.tableSession.findFirst({
          where: { id: row.id, merchantId: row.merchantId, openedBusinessDate: null },
          select: { openedAt: true, merchant: { select: { businessHours: true } } },
        });
        if (!current) return 0;
        const date = resolveBusinessDate(current.merchant.businessHours, current.openedAt);
        // Do not change updated_at: this is a metadata snapshot, not a new
        // checkout or a cashier revision. The exact row/null guard is retry-safe.
        return tx.$executeRaw`UPDATE table_sessions SET opened_business_date = ${date}
          WHERE id = ${row.id} AND merchant_id = ${row.merchantId}
            AND opened_business_date IS NULL AND opened_at = ${current.openedAt}`;
      });
    }
    cursor = rows[rows.length - 1]!.id;
  }
  const remaining = await prisma.tableSession.count({ where: { merchantId, openedBusinessDate: null } });
  return { mode: apply ? 'APPLY' : 'DRY_RUN', examined, updated, remaining };
}

async function main() {
  const args = process.argv.slice(2);
  const match = args.find(value => value.startsWith('--merchant-id='));
  if ((!match && !args.includes('--all-merchants')) || (match && args.includes('--all-merchants'))
    || (match && !/^--merchant-id=[1-9]\d*$/.test(match))
    || args.some(value => value !== '--apply' && value !== '--all-merchants' && value !== match)) {
    throw new Error('Choose --merchant-id=<id> OR --all-merchants. Dry-run by default; --apply explicitly writes null opening snapshots.');
  }
  const prisma = new PrismaClient();
  try {
    const result = await backfillSessionOpeningDays(prisma, match ? BigInt(match.split('=')[1]!) : undefined, args.includes('--apply'));
    console.log(JSON.stringify(result));
    if (args.includes('--apply') && result.remaining) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) main().catch(() => {
  console.error('Opening-day backfill failed. Check the explicit scope and migration; no credentials are logged.');
  process.exitCode = 1;
});
