import { ReceiptDocument } from '../types/receipt-document';

const DISHES = [
  ['西红柿炖牛腩家庭分享特大份长菜名完整换行测试', 'Thịt bò hầm cà chua phần lớn dành cho gia đình và bạn bè trong buổi tối cuối tuần'],
  ['招牌酸菜鱼特大份家庭分享装', 'Cá dưa đặc biệt phần lớn dành cho gia đình và bạn bè'],
  ['越式香茅烤鸡', 'Gà nướng sả kiểu Việt Nam'],
  ['蒜蓉炒红薯叶', 'Rau lang xào tỏi thơm ngon kiểu quê nhà'],
  ['鲜虾炒饭', 'Cơm chiên tôm tươi'],
  ['牛肉粉', 'Phở bò'],
  ['酸辣海鲜汤', 'Canh hải sản chua cay'],
  ['脆皮烧肉', 'Heo quay da giòn'],
  ['豉汁肉丸', 'Thịt viên sốt cà chua'],
  ['椰奶南瓜羹', 'Chè bí đỏ nước cốt dừa'],
  ['凉拌木瓜丝', 'Gỏi đu đủ xanh'],
  ['香煎海鲈鱼', 'Cá vược áp chảo'],
  ['家庭拼盘', 'Món thập cẩm gia đình'],
  ['芒果糯米饭', 'Xôi xoài'],
] as const;

export function canonicalTableBillGoldenFixture(): ReceiptDocument {
  return {
    schemaVersion: 1,
    receiptType: 'TABLE_BILL',
    generatedAt: '2026-08-24T12:18:00.000Z',
    merchant: {
      id: '999',
      name: '云桥示例家庭餐厅旗舰店',
      nameVi: 'Nhà hàng gia đình mẫu YunQiao tại Việt Nam',
      address: '65V3-2VQ Tiên Phong, Bắc Giang, Việt Nam khu nhà mẫu tầng hai',
      phone: '0333-6247-000',
    },
    tableSession: {
      id: '888',
      sessionNo: 'TS-ANON-20260824-LAYOUT-V2',
      tableName: 'A01',
      openedAt: '2026-08-24T10:05:00.000Z',
      closedAt: '2026-08-24T12:15:00.000Z',
      orderNos: [
        'HY-ANON-20260824-000000000001',
        'HY-ANON-20260824-000000000002',
        'HY-ANON-20260824-000000000003',
      ],
    },
    items: DISHES.map(([name, nameVi], index) => ({
      name,
      nameVi,
      quantity: index % 3 + 1,
      unitPrice: 48_000 + index * 11_000,
      lineTotal: (48_000 + index * 11_000) * (index % 3 + 1),
      ...(index === 0 ? { note: '少辣，分盘上桌 / Ít cay, chia ra hai đĩa' } : {}),
    })),
    totals: {
      subtotal: 2_888_000,
      originalAmount: 2_888_000,
      commercialDiscountAmount: 88_000,
      roundingAmount: 1_000,
      receivedAmount: 2_799_000,
      total: 2_799_000,
      currency: 'VND',
    },
    footer: {
      zh: '谢谢惠顾，欢迎再次光临云桥示例家庭餐厅',
      vi: 'Cảm ơn quý khách, hẹn gặp lại tại YunQiao',
    },
  };
}
