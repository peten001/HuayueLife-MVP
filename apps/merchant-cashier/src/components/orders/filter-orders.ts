import type { CashierOrderView } from '@/components/common/view-models';

export function filterOrders(
  source: CashierOrderView[],
  query: string,
  status: string,
) {
  const keyword = query.trim().toLocaleLowerCase();
  return source.filter((order) => {
    if (status !== 'ALL' && order.status !== status) return false;
    if (!keyword) return true;
    const itemNames = (order.items || [])
      .map((item) =>
        [item.productNameZhSnapshot, item.productNameViSnapshot, item.productNameEnSnapshot]
          .filter(Boolean)
          .join(' '),
      )
      .join(' ');
    const searchable = [
      order.orderNo,
      order.tableNoSnapshot,
      order.table?.tableNo,
      order.table?.tableName,
      order.contactName,
      order.contactPhone,
      itemNames,
    ]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase();
    return searchable.includes(keyword);
  });
}
