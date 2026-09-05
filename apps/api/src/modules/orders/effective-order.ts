import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** One effective object set for merchant history, financial facts and product sales. */
export function effectiveOrderWhere(where: Prisma.OrderWhereInput = {}): Prisma.OrderWhereInput {
  const and = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  return { ...where, AND: [...and, { voidedAt: null }, {
    OR: [{ tableSessionId: null }, { tableSession: { is: { voidedAt: null } } }],
  }] };
}

export function isEffectiveOrder(order: {
  voidedAt?: Date | null;
  tableSession?: { voidedAt?: Date | null } | null;
}): boolean {
  return !order.voidedAt && !order.tableSession?.voidedAt;
}

/** Must run inside the caller's transaction, before any print-job write.
 * Matches historical order mutation order: session -> order. Never locks a table
 * after a session, and never touches the table's current/open session.
 * Locking reads are deliberate: MySQL snapshot reads can predate a concurrent void.
 */
export async function lockEffectivePrintTarget(
  tx: Prisma.TransactionClient,
  merchantId: bigint,
  target: { orderId?: bigint | null; tableSessionId?: bigint | null },
): Promise<void> {
  const refs = target.orderId ? await tx.$queryRaw<Array<{ table_session_id: bigint | null }>>`
    SELECT table_session_id FROM orders WHERE id = ${target.orderId} AND merchant_id = ${merchantId}` : [];
  const ref = refs[0] ? { tableSessionId: refs[0].table_session_id } : null;
  if (target.orderId && !ref) throw new NotFoundException('Order not found');
  const sessionId = target.tableSessionId ?? ref?.tableSessionId;
  if (target.tableSessionId && ref?.tableSessionId && ref.tableSessionId !== target.tableSessionId) {
    throw new ConflictException({ code: 'VOID_SCOPE_CONFLICT', message: 'Order and session do not match' });
  }
  if (sessionId) {
    const rows = await tx.$queryRaw<Array<{ voided_at: Date | null }>>`
      SELECT voided_at FROM table_sessions WHERE id = ${sessionId} AND merchant_id = ${merchantId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('Table session not found');
    assertNotVoided(rows[0]!.voided_at);
  }
  if (target.orderId) {
    const rows = await tx.$queryRaw<Array<{ voided_at: Date | null; table_session_id: bigint | null }>>`
      SELECT voided_at, table_session_id FROM orders WHERE id = ${target.orderId} AND merchant_id = ${merchantId} FOR UPDATE`;
    if (!rows.length) throw new NotFoundException('Order not found');
    assertNotVoided(rows[0]!.voided_at);
    if (rows[0]!.table_session_id !== (ref?.tableSessionId ?? null)) {
      throw new ConflictException({ code: 'VOID_SCOPE_CONFLICT', message: 'Order scope changed; refresh and retry' });
    }
  }
}

export function assertNotVoided(voidedAt: Date | null | undefined): void {
  if (voidedAt) throw new ConflictException({ code: 'ORDER_VOIDED', message: 'Order has been voided; no business or print action is allowed' });
}
