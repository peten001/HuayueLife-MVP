export type ArrivalKind = 'PICKUP' | 'DINE_IN';
export type ArrivalStatus = 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SEATED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export interface ArrivalReservation {
  id: string;
  kind: ArrivalKind;
  reservationNo: string;
  status: ArrivalStatus;
  scheduledFor: string | null;
  proposedScheduledFor?: string | null;
  guestCount: number | null;
  contactName?: string;
  contactPhone?: string;
  customerRemark?: string;
  cancelReason?: string | null;
  createdAt: string;
  itemAmountVnd: string;
  orderId?: string | null;
  tableSessionId?: string | null;
  items: Array<{
    productId?: string;
    productNameZhSnapshot: string;
    productNameViSnapshot?: string | null;
    productNameEnSnapshot?: string | null;
    imageUrlSnapshot?: string | null;
    quantity: number;
    unitPriceVnd: string;
    subtotalVnd: string;
    remark?: string;
  }>;
  merchant: { id: string; nameZh: string; nameVi?: string | null; nameEn?: string | null;
    contactPhone?: string; addressDetail?: string; addressZh?: string | null;
    addressVi?: string | null; addressEn?: string | null; latitude?: string; longitude?: string };
  table?: { id: string; tableNo: string; tableName?: string | null; qrToken?: string } | null;
}

const copy = {
  arrival: ['预约到店', 'Đặt trước tại cửa hàng', 'Reserve a visit'],
  pickup: ['打包自取', 'Đặt món mang về', 'Pickup'],
  dineIn: ['到店用餐', 'Đặt bàn', 'Dine in'],
  pickupHint: ['提前点好，到店带走', 'Đặt món trước, đến lấy mang về', 'Order ahead, collect at the store'],
  dineInHint: ['预约时间，轻松入座', 'Hẹn giờ đến, cửa hàng xác nhận chỗ', 'Choose a time, the store confirms your seats'],
  chooseWay: ['选择到店方式', 'Chọn hình thức', 'How would you like to visit?'],
  confirmReservation: ['确认预约', 'Xác nhận đặt trước', 'Review reservation'],
  submit: ['提交预约', 'Gửi yêu cầu', 'Request reservation'],
  submitting: ['正在提交…', 'Đang gửi…', 'Submitting…'],
  uncertain: ['提交结果尚未确认，请重试提交，系统会核对原预约，避免重复创建。', 'Chưa xác định được kết quả. Gửi lại để kiểm tra yêu cầu cũ, không tạo trùng.', 'The result is unconfirmed. Retry to check the original request without creating a duplicate.'],
  pendingHint: ['预约需商家确认后生效', 'Yêu cầu chỉ có hiệu lực sau khi cửa hàng xác nhận', 'Your reservation takes effect after the store confirms'],
  pendingDetail: ['已收到预约申请，请等待商家确认', 'Đã nhận yêu cầu, vui lòng chờ cửa hàng xác nhận', 'Request received. Waiting for the store to confirm'],
  confirmedDetail: ['商家已确认，请按约定时间到店', 'Cửa hàng đã xác nhận. Vui lòng đến đúng giờ', 'Confirmed by the store. Please arrive at the agreed time'],
  pickupTime: ['取餐时间', 'Giờ lấy món', 'Pickup time'],
  arrivalTime: ['到店时间', 'Giờ đến', 'Arrival time'],
  asap: ['尽快取餐', 'Lấy sớm nhất', 'As soon as possible'],
  asapHint: ['备餐时间由商家确认', 'Cửa hàng sẽ xác nhận thời gian chuẩn bị', 'The store will confirm the preparation time'],
  scheduled: ['预约时间', 'Chọn giờ', 'Choose a time'],
  vietnamTime: ['以上均为越南时间', 'Tất cả thời gian theo giờ Việt Nam', 'All times are in Vietnam time'],
  date: ['日期', 'Ngày', 'Date'],
  time: ['时间', 'Giờ', 'Time'],
  guests: ['用餐人数', 'Số khách', 'Guests'],
  people: ['人', 'người', 'guests'],
  contactName: ['联系人', 'Tên liên hệ', 'Contact name'],
  contactPhone: ['联系电话', 'Số điện thoại', 'Phone number'],
  contactPlaceholder: ['方便商家联系的姓名', 'Tên để cửa hàng liên hệ', 'Name the store can contact'],
  phonePlaceholder: ['请输入联系电话', 'Nhập số điện thoại', 'Enter your phone number'],
  remark: ['备注', 'Ghi chú', 'Notes'],
  remarkPlaceholder: ['口味、座位需求等，可选填', 'Khẩu vị, yêu cầu chỗ ngồi… (không bắt buộc)', 'Dietary or seating requests (optional)'],
  preselected: ['预选餐品', 'Món đã chọn trước', 'Preselected dishes'],
  selectDishes: ['提前选菜', 'Chọn món trước', 'Choose dishes ahead'],
  editDishes: ['修改餐品', 'Sửa món đã chọn', 'Edit dishes'],
  seatsOnly: ['仅预约座位，到店后扫码点餐', 'Chỉ đặt bàn, quét mã gọi món khi đến', 'Reserve seats, scan the table code to order on arrival'],
  cookOnArrival: ['预选餐品将在到店确认后安排制作', 'Món chọn trước được chế biến sau khi bạn đến và xác nhận', 'Preselected dishes are prepared after you arrive and confirm'],
  payAtStore: ['到店线下付款', 'Thanh toán tại cửa hàng', 'Pay at the store'],
  payAfterMeal: ['用餐后统一结账', 'Thanh toán chung sau bữa ăn', 'One bill after your meal'],
  amount: ['餐品金额', 'Tiền món', 'Food total'],
  details: ['预约详情', 'Chi tiết đặt trước', 'Reservation details'],
  mine: ['我的预约', 'Đặt trước của tôi', 'My reservations'],
  orders: ['餐饮订单', 'Đơn món ăn', 'Food orders'],
  all: ['全部', 'Tất cả', 'All'],
  active: ['待处理', 'Cần xử lý', 'To handle'],
  history: ['已结束', 'Đã kết thúc', 'Finished'],
  empty: ['还没有预约', 'Chưa có đặt trước', 'No reservations yet'],
  emptyHint: ['找一家喜欢的餐厅，安排下一次到店', 'Chọn nhà hàng bạn thích và hẹn lần ghé tới', 'Find a restaurant and plan your next visit'],
  loading: ['正在加载预约…', 'Đang tải đặt trước…', 'Loading reservations…'],
  retry: ['重新加载', 'Tải lại', 'Try again'],
  loadError: ['预约加载失败，请重试', 'Không tải được đặt trước. Vui lòng thử lại', 'Unable to load reservations. Please try again'],
  nameRequired: ['请填写联系人姓名', 'Vui lòng nhập tên liên hệ', 'Enter a contact name'],
  phoneInvalid: ['请填写正确的联系电话', 'Vui lòng nhập số điện thoại hợp lệ', 'Enter a valid phone number'],
  guestsInvalid: ['请填写有效的用餐人数', 'Vui lòng nhập số khách hợp lệ', 'Enter a valid guest count'],
  timeInvalid: ['请选择未来的预约时间（越南时间）', 'Vui lòng chọn thời gian trong tương lai (giờ Việt Nam)', 'Choose a future time in Vietnam time'],
  unavailable: ['商家暂未开启此预约服务', 'Cửa hàng chưa mở dịch vụ đặt trước này', 'This reservation service is unavailable'],
  cancel: ['取消预约', 'Hủy đặt trước', 'Cancel reservation'],
  cancelConfirm: ['确定取消本次预约？', 'Bạn muốn hủy đặt trước này?', 'Cancel this reservation?'],
  contactStore: ['联系商家', 'Gọi cửa hàng', 'Contact store'],
  navigate: ['导航到店', 'Chỉ đường', 'Directions'],
  continueOrder: ['继续点餐', 'Gọi thêm món', 'Continue ordering'],
  viewOrder: ['查看自取订单', 'Xem đơn mang về', 'View pickup order'],
  viewTableBill: ['查看桌账', 'Xem hóa đơn bàn', 'View table bill'],
  backToList: ['返回预约列表', 'Quay lại danh sách', 'Back to reservations'],
  changeProposed: ['商家建议调整时间', 'Cửa hàng đề nghị đổi giờ', 'The store has proposed a new time'],
  changeHint: ['同意后生效，当前预约时间仍保留', 'Giờ hiện tại được giữ đến khi bạn đồng ý', 'Your current time stays in place until you accept'],
  acceptTime: ['同意新时间', 'Đồng ý giờ mới', 'Accept new time'],
  keepTime: ['保留原时间', 'Giữ giờ cũ', 'Keep current time'],
  merchantTitle: ['到店预约', 'Lịch đặt trước', 'Reservations'],
  merchantHint: ['按到店时间安排接待与备餐', 'Sắp xếp đón khách và chuẩn bị món theo giờ hẹn', 'Plan seating and preparation by arrival time'],
  confirm: ['确认预约', 'Xác nhận', 'Confirm'],
  reject: ['拒绝预约', 'Từ chối', 'Decline'],
  seat: ['确认入座', 'Xác nhận vào bàn', 'Seat guests'],
  seatHint: ['确认预选菜并安排空闲桌台；餐品将加入同一桌账', 'Xác nhận món đã chọn và bàn trống. Món sẽ vào cùng hóa đơn bàn', 'Confirm the selected dishes and an available table. Dishes join the table bill'],
  selectTable: ['请选择桌台', 'Chọn bàn', 'Choose a table'],
  noShow: ['标记未到店', 'Đánh dấu không đến', 'Mark as no-show'],
  reschedule: ['建议改约时间', 'Đề nghị đổi giờ', 'Propose a new time'],
  reason: ['处理原因（选填）', 'Lý do (không bắt buộc)', 'Reason (optional)'],
  close: ['关闭', 'Đóng', 'Close'],
  save: ['确认操作', 'Xác nhận thao tác', 'Confirm action'],
  due: ['该开始备餐了', 'Đến lúc chuẩn bị món', 'Time to start preparing'],
  newReservation: ['有新的用餐预约待确认', 'Có yêu cầu đặt bàn mới', 'New dine-in reservation awaiting confirmation'],
  changed: ['预约已更新', 'Đã cập nhật đặt trước', 'Reservation updated'],
  preparingHint: ['商家正在准备餐品，请留意取餐状态', 'Cửa hàng đang chuẩn bị món, vui lòng theo dõi trạng thái', 'The store is preparing your food. Check back for pickup status'],
  readyHint: ['餐品已备好，请到店核对取餐码', 'Món đã sẵn sàng. Đến cửa hàng và cung cấp mã lấy món', 'Your food is ready. Show your pickup code at the store'],
  originalTime: ['当前预约', 'Giờ hẹn hiện tại', 'Current reservation'],
  cancelContact: ['如需改时或取消，请联系商家', 'Liên hệ cửa hàng để đổi giờ hoặc hủy', 'Contact the store to reschedule or cancel'],
  PENDING: ['待商家确认', 'Chờ cửa hàng xác nhận', 'Awaiting confirmation'],
  CONFIRMED: ['预约已确认', 'Đã xác nhận', 'Confirmed'],
  PREPARING: ['备餐中', 'Đang chuẩn bị', 'Preparing'],
  READY: ['待取餐', 'Chờ lấy món', 'Ready for pickup'],
  SEATED: ['已入座', 'Đã vào bàn', 'Seated'],
  COMPLETED: ['已完成', 'Hoàn tất', 'Completed'],
  CANCELLED: ['已取消', 'Đã hủy', 'Cancelled'],
  NO_SHOW: ['未到店', 'Không đến', 'No-show'],
} as const;

export type ReservationTextKey = keyof typeof copy;
export function reservationText(key: ReservationTextKey, locale: string = 'zh') {
  return copy[key][locale === 'vi' ? 1 : locale === 'en' ? 2 : 0];
}
export function vietnamDateTimeParts(now = Date.now()) {
  const value = new Date(now + 7 * 60 * 60_000).toISOString();
  return { date: value.slice(0, 10), time: value.slice(11, 16) };
}
export function reservationTimestamp(date: string, time: string) {
  return new Date(`${date}T${time}:00+07:00`).toISOString();
}
export function formatReservationTime(value: string | null | undefined, locale = 'zh') {
  if (!value) return reservationText('asap', locale);
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '—';
  const p = vietnamDateTimeParts(timestamp);
  return `${p.date} ${p.time}`;
}

const errorCopy: Record<string, readonly [string, string]> = {
  '请填写联系人姓名': ['Vui lòng nhập tên liên hệ', 'Enter a contact name'],
  '商家当前未开启预约到店': ['Cửa hàng chưa mở dịch vụ đặt trước', 'Reservations are unavailable at this store'],
  '请选择未来的预约时间（越南时间）': ['Vui lòng chọn thời gian trong tương lai (giờ Việt Nam)', 'Choose a future time in Vietnam time'],
  '商家当前未开启预约到店用餐': ['Cửa hàng chưa mở dịch vụ đặt bàn', 'Dine-in reservations are disabled'],
  '商家当前未开启预约打包自取': ['Cửa hàng chưa mở dịch vụ đặt món mang về', 'Pickup reservations are disabled'],
  '预选菜购物车已失效，请重新选菜': ['Giỏ món chọn trước đã hết hạn. Vui lòng chọn lại', 'Your preselected cart expired. Please choose dishes again'],
  '预选菜购物车为空，请重新选菜': ['Giỏ món chọn trước trống. Vui lòng chọn lại', 'Your preselected cart is empty. Please choose dishes again'],
  '预选菜已售罄或下架，请重新选菜': ['Món chọn trước đã hết hoặc ngừng bán. Vui lòng chọn lại', 'A preselected dish is unavailable. Please choose again'],
  '预选菜价格已变化，请刷新后重新确认': ['Giá món đã thay đổi. Tải lại và xác nhận', 'Dish prices changed. Refresh and confirm again'],
  '餐品价格已变化，请刷新后重新确认': ['Giá món đã thay đổi. Tải lại và xác nhận', 'Dish prices changed. Refresh and confirm again'],
  '预约不存在': ['Không tìm thấy đặt trước', 'Reservation not found'],
  '预约已确认，如需取消请联系商家': ['Đặt trước đã xác nhận. Liên hệ cửa hàng để hủy', 'Already confirmed. Contact the store to cancel'],
  '预约状态已变化，请刷新后重试': ['Trạng thái đã thay đổi. Tải lại và thử lại', 'Reservation status changed. Refresh and try again'],
  '预约时间尚未到，不能标记未到店': ['Chưa đến giờ hẹn, không thể đánh dấu không đến', 'The appointment time has not arrived yet'],
  '请选择新的预约时间': ['Vui lòng chọn giờ hẹn mới', 'Choose a new appointment time'],
  '订单已开始制作，不能调整预约时间': ['Đơn đã bắt đầu chế biến, không thể đổi giờ', 'Preparation started. The appointment time cannot be changed'],
  '请选择入座桌台': ['Vui lòng chọn bàn', 'Choose a table for the guests'],
  '请先确认预约，再安排入座': ['Xác nhận đặt trước trước khi xếp bàn', 'Confirm the reservation before seating guests'],
  '预约时间变更待用户确认，请先联系用户处理': ['Đang chờ khách đồng ý đổi giờ. Vui lòng liên hệ khách', 'The time change awaits customer consent. Contact the customer first'],
  '桌台不存在或已停用': ['Bàn không tồn tại hoặc đã tắt', 'The table is unavailable or disabled'],
  '预选菜价格或供应状态已变化，请与顾客重新确认后预约': ['Giá hoặc tình trạng món đã thay đổi. Xác nhận lại với khách trước khi đặt lại', 'Preselected dishes changed. Reconfirm with the customer before rebooking'],
  '该桌已有用餐桌账，请选择空闲桌台': ['Bàn đang có khách. Vui lòng chọn bàn trống', 'This table already has an active bill. Choose an available table'],
  '预约变更已更新，请刷新后重新确认': ['Yêu cầu đổi giờ đã cập nhật. Tải lại và xác nhận', 'The proposed change was updated. Refresh and confirm again'],
};
export function reservationErrorText(message: string, locale = 'zh') {
  const translated = errorCopy[message];
  return locale === 'zh' || !translated ? message : translated[locale === 'vi' ? 0 : 1];
}
