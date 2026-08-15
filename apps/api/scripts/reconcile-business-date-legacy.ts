/**
 * Read-only legacy businessDate reconciliation dry-run.
 *
 * Usage:
 *   pnpm --filter @huayue-life/api exec ts-node --transpile-only \
 *     scripts/reconcile-business-date-legacy.ts \
 *     --merchant-id 11 --date-from 2026-08-13 --date-to 2026-08-17 --dry-run
 *
 * This round is STRICTLY read-only. Passing --write is rejected; no UPDATE /
 * INSERT / DELETE is ever executed by this script.
 */
import { PrismaClient } from '@prisma/client';
import {
  addBusinessDays,
  businessDayWindow,
  instantForBusinessDateMinute,
  localBusinessDate,
  resolveBusinessDate,
} from '../src/common/utils/merchant-hours';

const prisma = new PrismaClient();

function parseArgs(argv: string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument.startsWith('--')) {
      const key = argument.slice(2);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        values.set(key, 'true');
      } else {
        values.set(key, value);
        index += 1;
      }
    }
  }
  return values;
}

function toLocal(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(value);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.get('write') === 'true') {
    console.error('BLOCKED: write mode is not allowed this round. Use --dry-run.');
    process.exit(2);
  }
  const dryRun = args.get('dry-run') !== 'false';
  const merchantId = args.get('merchant-id');
  const dateFrom = args.get('date-from');
  const dateTo = args.get('date-to');
  if (!merchantId || !dateFrom || !dateTo) {
    console.error(
      'USAGE: --merchant-id <id> --date-from <YYYY-MM-DD> --date-to <YYYY-MM-DD> --dry-run',
    );
    process.exit(2);
  }

  const merchant = await prisma.merchant.findUnique({
    where: { id: BigInt(merchantId) },
    select: { id: true, nameZh: true, businessHours: true },
  });
  if (!merchant) {
    console.error(`BLOCKED: merchant ${merchantId} not found`);
    process.exit(2);
  }

  const start = instantForBusinessDateMinute(addBusinessDays(dateFrom, -1), 0);
  const end = instantForBusinessDateMinute(addBusinessDays(dateTo, 2), 6 * 60);
  const orders = await prisma.order.findMany({
    where: {
      merchantId: merchant.id,
      businessDate: null,
      createdAt: { gte: start, lt: end },
    },
    select: {
      id: true,
      orderNo: true,
      status: true,
      createdAt: true,
      completedAt: true,
      tableSessionId: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const schedule = merchant.businessHours as never;
  console.log(`merchant\t${merchant.id}\t${merchant.nameZh}`);
  console.log(
    'orderId\torderNo\tstatus\tcreatedAtLocal\tcompletedAtLocal\tproposedBusinessDate\tevidence\tconfidence\tcurrent',
  );
  for (const order of orders) {
    const proposed = resolveBusinessDate(schedule, order.createdAt);
    const window = businessDayWindow(schedule, proposed);
    const inWindow = Boolean(
      window &&
        order.createdAt.getTime() >= window.start.getTime() &&
        order.createdAt.getTime() < window.end.getTime(),
    );
    const evidence = window
      ? `created ${toLocal(order.createdAt)} inside window ${toLocal(window.start)}..${toLocal(window.end)}`
      : `created ${toLocal(order.createdAt)}; no schedule window; natural date ${localBusinessDate(order.createdAt)}`;
    const confidence = inWindow
      ? 'HIGH'
      : 'MEDIUM (rest-period natural-day fallback)';
    console.log([
      order.id,
      order.orderNo,
      order.status,
      toLocal(order.createdAt),
      order.completedAt ? toLocal(order.completedAt) : 'NULL',
      proposed,
      evidence,
      confidence,
      'NULL',
    ].join('\t'));
  }

  const byDate = new Map<string, number>();
  for (const order of orders) {
    const proposed = resolveBusinessDate(schedule, order.createdAt);
    byDate.set(proposed, (byDate.get(proposed) ?? 0) + 1);
  }
  console.log('summary\tproposedBusinessDate\tlegacyOrderCount');
  for (const [date, count] of [...byDate.entries()].sort()) {
    console.log(`summary\t${date}\t${count}`);
  }
  console.log(
    `done\tdryRun=${dryRun}\torders=${orders.length}\twrites=0`,
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
