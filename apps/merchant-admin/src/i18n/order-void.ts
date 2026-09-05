import { computed } from 'vue';
import { useI18n } from './index';

const zh = {
  record: '订单 / 桌账',
  businessDayConflict: '该跨营业日桌账的优惠分摊与结账金额不一致。请先核对营业汇总口径，暂不能作废。',
  more: '更多', action: '删除（作废）', title: '作废这笔记录？', confirm: '确认作废', back: '返回', close: '关闭',
  loading: '正在核对记录…', submitting: '正在作废…', retry: '重新核对',
  archive: '已作废', effective: '正常订单', archiveHint: '保留原始记录，仅用于审计，不计入有效营业额。',
  empty: '没有符合条件的作废记录', search: '原订单号 / ID', query: '查询', prev: '上一页', next: '下一页',
  reason: '作废原因', choose: '请选择原因', note: '补充说明', required: '选择“其他”时，请填写具体原因。',
  MISTAKE: '误操作', DUPLICATE: '重复记录', TEST: '测试单', OTHER: '其他',
  warning: '将同步撤销对应营业额及收款统计，原始记录保留在“已作废”中。',
  noRefund: '只更正系统记录，不会自动退还现金或银行转账，也不会恢复库存。',
  originalDate: '原统计营业日', originalTime: '原结账时间', table: '桌台', scope: '关联原单', scopeHint: '包含同一桌账内的已取消原单。', settlementCount: '结账笔数',
  original: '原金额', discount: '折扣', rounding: '抹零', net: '原应收金额', payment: '付款方式',
  CASH: '现金', BANK_TRANSFER: '银行转账', UNRECORDED: '未登记', DINE_IN: '堂食', PICKUP: '自取', DELIVERY: '配送',
  impacts: '原单营业汇总减少', settlementImpact: '结账统计减少', noImpact: '已取消记录，收入减少 0 VND。',
  cash: '现金减少', bank: '转账减少', unrecorded: '未登记减少', amount: '净额减少', count: '原单数',
  actor: '操作者', at: '作废时间', details: '查看记录', success: '已作废，原记录和打印证据已保留。',
  stale: '预览后数据已变化。请重新核对金额，再确认作废。', print: '打印尚未结束或结果不明。请先在打印中心处理该任务，再重试。',
  owner: '只有已启用的商家主账号可查看或作废。请检查当前账号权限。',
  active: '该记录仍属于进行中的订单或桌账。请先完成现有业务流程。',
  conflict: '原单、桌账或金额证据不一致。请核对历史记录，不能直接作废。',
};
type Copy = Record<keyof typeof zh, string>;
const vi: Copy = {
  record: 'Đơn / Phiên bàn',
  businessDayConflict: 'Phân bổ giảm giá giữa các ngày không khớp với thanh toán. Cần kiểm tra tổng hợp trước khi vô hiệu.',
  more: 'Thêm', action: 'Xóa (vô hiệu)', title: 'Vô hiệu hóa phiếu này?', confirm: 'Xác nhận', back: 'Quay lại', close: 'Đóng',
  loading: 'Đang kiểm tra…', submitting: 'Đang xử lý…', retry: 'Kiểm tra lại',
  archive: 'Đã vô hiệu', effective: 'Đơn hiệu lực', archiveHint: 'Giữ nguyên chứng từ để kiểm tra, không tính vào doanh thu hiệu lực.',
  empty: 'Không có phiếu phù hợp', search: 'Mã đơn gốc / ID', query: 'Tìm', prev: 'Trang trước', next: 'Trang sau',
  reason: 'Lý do', choose: 'Chọn lý do', note: 'Ghi chú', required: 'Vui lòng nêu lý do cụ thể khi chọn “Khác”.',
  MISTAKE: 'Thao tác nhầm', DUPLICATE: 'Ghi trùng', TEST: 'Đơn thử', OTHER: 'Khác',
  warning: 'Đồng thời loại khỏi doanh thu và thống kê thu tiền. Chứng từ gốc được giữ trong “Đã vô hiệu”.',
  noRefund: 'Chỉ điều chỉnh dữ liệu hệ thống, không tự hoàn tiền mặt, chuyển khoản hoặc nhập lại tồn kho.',
  originalDate: 'Ngày kinh doanh gốc', originalTime: 'Giờ thanh toán gốc', table: 'Bàn', scope: 'Đơn liên quan', scopeHint: 'Gồm các đơn đã hủy trong cùng phiên bàn.', settlementCount: 'Số phiếu',
  original: 'Số tiền gốc', discount: 'Giảm giá', rounding: 'Làm tròn', net: 'Phải thu ban đầu', payment: 'Phương thức',
  CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản', UNRECORDED: 'Chưa ghi nhận', DINE_IN: 'Tại bàn', PICKUP: 'Mang đi', DELIVERY: 'Giao hàng',
  impacts: 'Giảm tổng hợp theo ngày của đơn', settlementImpact: 'Giảm thống kê thanh toán', noImpact: 'Đơn đã hủy, doanh thu giảm 0 VND.',
  cash: 'Giảm tiền mặt', bank: 'Giảm chuyển khoản', unrecorded: 'Giảm chưa ghi nhận', amount: 'Giảm ròng', count: 'Số đơn gốc',
  actor: 'Người thao tác', at: 'Thời điểm vô hiệu', details: 'Xem chứng từ', success: 'Đã vô hiệu. Giữ nguyên chứng từ và bằng chứng in.',
  stale: 'Dữ liệu đã thay đổi. Kiểm tra lại số tiền trước khi xác nhận.', print: 'Tác vụ in chưa kết thúc hoặc chưa rõ kết quả. Xử lý trong trung tâm in rồi thử lại.',
  owner: 'Chỉ tài khoản chủ quán đang hoạt động được xem hoặc vô hiệu. Vui lòng kiểm tra quyền.',
  active: 'Đơn hoặc phiên bàn vẫn đang hoạt động. Vui lòng hoàn tất quy trình hiện có.',
  conflict: 'Chứng từ, phiên bàn hoặc số tiền không khớp. Cần kiểm tra trước khi vô hiệu.',
};
const en: Copy = {
  record: 'Order / Table bill',
  businessDayConflict: 'Cross-business-day adjustments do not reconcile with the settlement. Review the accounting totals before voiding.',
  more: 'More', action: 'Delete (void)', title: 'Void this record?', confirm: 'Confirm void', back: 'Back', close: 'Close',
  loading: 'Checking records…', submitting: 'Voiding…', retry: 'Refresh preview',
  archive: 'Voided', effective: 'Active records', archiveHint: 'Original records are retained for audit and excluded from effective revenue.',
  empty: 'No matching voided records', search: 'Original order number / ID', query: 'Search', prev: 'Previous', next: 'Next',
  reason: 'Reason', choose: 'Select a reason', note: 'Additional details', required: 'Please give a specific reason when selecting “Other”.',
  MISTAKE: 'Mistake', DUPLICATE: 'Duplicate', TEST: 'Test order', OTHER: 'Other',
  warning: 'Removes the contribution to revenue and payment statistics. Original records remain under “Voided”.',
  noRefund: 'Corrects system records only. Does not refund cash, reverse a bank transfer or restore stock.',
  originalDate: 'Original business date', originalTime: 'Original settlement time', table: 'Table', scope: 'Related orders', scopeHint: 'Includes cancelled orders in the same table session.', settlementCount: 'Settlements',
  original: 'Original amount', discount: 'Discount', rounding: 'Rounding', net: 'Original receivable', payment: 'Payment method',
  CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', UNRECORDED: 'Unrecorded', DINE_IN: 'Dine-in', PICKUP: 'Pickup', DELIVERY: 'Delivery',
  impacts: 'Order business-day reductions', settlementImpact: 'Settlement reduction', noImpact: 'Cancelled record: revenue reduction is 0 VND.',
  cash: 'Cash reduction', bank: 'Transfer reduction', unrecorded: 'Unrecorded reduction', amount: 'Net reduction', count: 'Source orders',
  actor: 'Operator', at: 'Voided at', details: 'View record', success: 'Voided. Original records and print evidence are retained.',
  stale: 'Records changed after preview. Refresh the amounts before confirming.', print: 'Printing is unfinished or its outcome is unknown. Resolve the task in Print Center before retrying.',
  owner: 'Only an active owner account can view or void records. Check your account permissions.',
  active: 'The order or table session is still active. Complete the existing workflow first.',
  conflict: 'Order, session or amount evidence does not match. Review the original records before voiding.',
};
export function useOrderVoidText() {
  const { locale } = useI18n();
  return computed(() => ({ zh, vi, en })[locale.value]);
}
