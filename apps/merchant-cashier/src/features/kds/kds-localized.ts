import type { Locale } from '@/i18n';

type Translations = Readonly<Record<string, readonly [string, string]>>;
const stations: Translations = {
  热厨: ['Bếp nóng', 'Hot kitchen'], 烧烤档: ['Quầy nướng', 'Grill'],
  粉面档: ['Quầy bún mì', 'Noodles'], 吧台: ['Quầy bar', 'Bar'],
};
const units: Translations = {
  份: ['phần', 'servings'], 串: ['xiên', 'skewers'], 碗: ['tô', 'bowls'],
  杯: ['ly', 'cups'], 瓶: ['chai', 'bottles'], 盘: ['đĩa', 'plates'],
  个: ['cái', 'pcs'], 只: ['con', 'pcs'], 盒: ['hộp', 'boxes'],
  包: ['gói', 'packs'], 套: ['bộ', 'sets'], 锅: ['nồi', 'pots'],
};
const systemMessages: Translations = {
  '订单数量调整': ['Điều chỉnh số lượng đơn', 'Order quantity adjusted'],
  '传菜已关闭，已制作菜品直接出餐': ['Đã tắt chuyển món; món đã làm được xuất bếp ngay', 'Serving disabled; prepared dishes released directly'],
  'KDS 停用期间按收银交付流程完成': ['Đã giao qua thu ngân khi KDS tắt', 'Completed through cashier while KDS was disabled'],
  '当前门店未开启传菜': ['Quán chưa bật chuyển món', 'Serving is disabled for this store'],
  '份数必须为正整数': ['Số lượng phải là số nguyên dương', 'Quantity must be a positive integer'],
  '本次划菜超过待完成份数，请刷新': ['Số lượng vượt quá món chưa xong; hãy làm mới', 'Quantity exceeds remaining portions; refresh'],
  '本次传菜超过已做好的份数，请刷新': ['Số lượng chuyển vượt quá món đã làm; hãy làm mới', 'Serving quantity exceeds prepared portions; refresh'],
  '厨房任务已变化，请刷新重试': ['Món bếp đã thay đổi; hãy làm mới và thử lại', 'Kitchen tasks changed; refresh and retry'],
  '档口名称不能为空或重复，分类必须关联已有档口': ['Tên quầy không được trống hoặc trùng; danh mục phải thuộc quầy hiện có', 'Station names must be unique and nonempty; categories must use existing stations'],
  '每个分类只能关联一个档口': ['Mỗi danh mục chỉ được gán một quầy', 'Each category can use only one station'],
  '菜品分类不属于当前门店': ['Danh mục món không thuộc quán này', 'The category does not belong to this store'],
  '同一任务不能重复提交': ['Không được gửi trùng cùng một món', 'The same task cannot be submitted twice'],
  '厨房任务不存在': ['Không tìm thấy món bếp', 'Kitchen task not found'],
  '菜品数量或进度已变化，请刷新后重新选择': ['Số lượng hoặc tiến độ đã đổi; hãy làm mới rồi chọn lại', 'Dish quantity or progress changed; refresh and select again'],
  '订单已退菜或作废': ['Đơn đã trả món hoặc bị hủy', 'The order was returned or voided'],
  '订单已进入交付阶段，不能修改制作进度': ['Đơn đã sang bước giao nhận; không thể sửa tiến độ bếp', 'The order is in handoff; preparation progress cannot change'],
  '菜品已经做好': ['Món đã làm xong', 'The dish is already prepared'],
  '请完成菜品、餐具和备注核对': ['Hãy kiểm tra món, dụng cụ và ghi chú', 'Check dishes, utensils and notes'],
  '订单不存在': ['Không tìm thấy đơn', 'Order not found'],
  '当前订单不能打包': ['Không thể đóng gói đơn này', 'This order cannot be packed'],
  '所有档口菜品尚未齐全，不能确认打包': ['Các quầy chưa đủ món; chưa thể xác nhận đóng gói', 'Some stations are still pending; packing cannot be confirmed'],
  '该订单已经打包，请刷新': ['Đơn đã đóng gói; hãy làm mới', 'The order is already packed; refresh'],
  '该操作不能撤销': ['Không thể hoàn tác thao tác này', 'This action cannot be undone'],
  '菜品已有后续操作或已交付，不能直接撤销': ['Món đã có thao tác tiếp theo hoặc đã giao; không thể hoàn tác', 'The dish has later actions or was handed off; it cannot be undone'],
  '请先由店主或经理开启 KDS': ['Chủ quán hoặc quản lý cần bật KDS trước', 'An owner or manager must enable KDS first'],
  '当前商家已停用': ['Quán đã bị vô hiệu hóa', 'This merchant is disabled'],
  '厨房任务已由其他设备更新，请刷新': ['Thiết bị khác đã cập nhật món; hãy làm mới', 'Another device updated the kitchen task; refresh'],
  '请求编号已用于其他操作': ['Mã yêu cầu đã được dùng cho thao tác khác', 'This request ID was used for another action'],
};

function translated(locale: Locale, value: string, dictionary: Translations) {
  if (locale === 'zh') return value;
  return Object.prototype.hasOwnProperty.call(dictionary, value) ? dictionary[value]![locale === 'vi' ? 0 : 1] : value;
}
/** Display labels never replace the persisted station key used by tasks and routes. */
export function kdsStationLabel(locale: Locale, value: string, siblings: readonly string[] = []) {
  const label = translated(locale, value, stations);
  // A custom name such as "Grill" may coexist with the built-in 烧烤档.
  return label !== value && siblings.some(other => other !== value && translated(locale, other, stations) === label)
    ? `${label} (${value})` : label;
}
export function kdsStationInput(locale: Locale, value: string, original: readonly string[]) {
  return value.split(/[,，]/).map(part => {
    const name = part.trim();
    return original.find(station => station === name || kdsStationLabel(locale, station, original) === name) ?? name;
  }).join(', ');
}
export function kdsUnitLabel(locale: Locale, value?: string) { return translated(locale, value?.trim() || '份', units); }
/** Only known system text is translated; merchant/customer free text stays intact. */
export function kdsSystemMessage(locale: Locale, value: string) { return translated(locale, value, systemMessages); }
export function kdsKnownSystemMessage(locale: Locale, value: string) {
  return Object.prototype.hasOwnProperty.call(systemMessages, value) ? translated(locale, value, systemMessages) : null;
}
