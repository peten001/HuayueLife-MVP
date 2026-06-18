import { ref, watchEffect } from 'vue';
import type { Locale } from '@/utils/storage';
import { getLocale, setLocale as saveLocale } from '@/utils/storage';

export type TranslationKey = keyof typeof zh;

export const locale = ref<Locale>(getLocale());

const zh = {
  appName: '华越优选',
  language: '语言',
  chinese: '中文',
  vietnamese: 'Tiếng Việt',
  english: 'English',
  switchLanguage: '切换语言',
  homeTab: '首页',
  ordersTab: '订单',
  profileTab: '我的',
  homeTitle: '华越优选',
  ordersTitle: '我的订单',
  profileTitle: '我的',
  profileEditTitle: '资料完善',
  profileEditIntroTitle: '完善资料',
  profileEditIntroDesc: '这里可以选择头像、昵称和手机号，不影响正常点餐。',
  profileEditHint: '头像会先保存在本机；昵称和手机号可在这里同步更新。',
  profileEditNicknameRequired: '请填写昵称',
  locationSelectionFailed: '定位失败，请重新选择配送位置',
  merchantDetailTitle: '商家详情',
  menuTitle: '餐厅菜单',
  productDetailTitle: '菜品详情',
  scanTitle: '扫码点餐',
  cartTitle: '购物车',
  checkoutTitle: '确认订单',
  orderDetailTitle: '订单详情',
  nearbyMerchants: '附近商家',
  homeSearchPlaceholder: '搜索餐厅或地址',
  homeBannerKicker: '今日好味',
  homeBannerTitle: '附近好味，轻松点餐',
  homeBannerSubtitle: '发现北宁、北江值得尝试的华人餐厅',
  homeBannerAction: '查看附近的好店',
  homeTableOrderTitle: '桌边点餐',
  homeTableOrderHint: '请使用微信扫一扫桌牌二维码',
  homeTableOrderModal: '堂食点餐请打开微信扫一扫，扫描桌牌上的二维码进入对应餐厅和桌台。',
  gotIt: '知道了',
  homeFoodCategories: '美食分类',
  homeCategoryCaption: '今天想吃什么',
  homeCategoryPopular: '热门美食',
  homeCategoryChinese: '中式正餐',
  homeCategoryNoodles: '粉面小吃',
  homeCategoryDrinks: '茶饮甜品',
  homeNearbyRestaurants: '附近餐厅',
  homeEmptyHint: '更多好味正在陆续入驻',
  homeSearchEmpty: '没有找到相关餐厅',
  homeSearchEmptyHint: '换个关键词试试',
  scanOrder: '扫码点餐',
  scanSubtitle: '扫描桌面二维码进入餐厅菜单',
  locationByDistance: '按距离排序',
  locationByCity: '按城市展示',
  relocate: '重新定位',
  currentCity: '当前城市',
  loading: '加载中...',
  noMerchants: '当前区域暂无可用餐厅',
  locationPermissionRequired: '需要开启定位才能查看附近好店',
  deliveryLocationRequired: '请选择配送地址后再继续',
  noOrders: '暂无订单',
  ordersSubtitle: '随时查看点餐进度',
  ordersEmptyHint: '去附近餐厅看看吧',
  orderNow: '去点餐',
  paidAmount: '实付',
  viewDetails: '查看详情',
  noLocation: '未获得定位，已按所选城市展示餐厅',
  currentByCity: '当前按{city}展示',
  retryScan: '返回重试',
  openNearby: '附近商家',
  openMenu: '查看菜单',
  restaurant: '餐厅',
  dineIn: '堂食',
  pickup: '到店自取',
  delivery: '商家配送',
  browseMenu: '浏览菜单',
  merchantOpen: '营业中',
  merchantClosed: '休息中',
  phone: '手机号',
  serviceArea: '服务区域',
  paymentMethod: '付款方式',
  offlinePayment: '线下向商家付款',
  aboutTitle: '关于华越优选',
  aboutLine1: '面向北宁、北江华人餐厅的扫码点餐服务。',
  aboutLine2: '平台暂不提供在线支付和骑手配送。',
  myOrders: '我的订单',
  editProfile: '编辑资料',
  profileQuickActions: '快捷入口',
  profilePreferences: '偏好与服务',
  profileOrdersHint: '查看点餐记录和订单进度',
  profileEditHintShort: '修改头像、昵称和手机号',
  meNicknameFallback: '微信用户',
  mePhoneFallback: '暂未绑定手机号，点击绑定',
  profilePhoneInvalid: '请输入正确的手机号',
  wechatProfileTitle: '微信资料',
  chooseAvatar: '选择微信头像',
  nickname: '昵称',
  nicknamePlaceholder: '请输入昵称',
  saveProfile: '保存资料',
  wechatProfileSaved: '资料已保存',
  wechatProfileSavedLocal: '资料已保存到本机',
  wechatAvatarLocalHint: '头像先保存在本机，后续可再同步',
  completeProfile: '完善资料',
  wechatNicknameAuth: '授权微信昵称',
  wechatNicknameAuthDesc: '用于在“我的”页面显示微信昵称',
  wechatNicknameAuthSuccess: '已授权微信昵称',
  wechatNicknameAuthFailedSimple: '微信昵称授权失败，请重试',
  wechatNicknameAuthFailed: '微信昵称授权失败：{detail}',
  wechatNicknameUnsupported: '当前环境不支持微信昵称授权',
  wechatNicknameEmpty: '未获取到微信昵称',
  menuLoadFailed: '菜单加载失败',
  cartContextSwitchFailed: '切换购物车上下文失败',
  cartContextSwitchError: '切换购物车上下文失败，请重试',
  merchantLoadFailed: '商家加载失败',
  productLoadFailed: '菜品加载失败',
  orderLoadFailed: '订单加载失败',
  cancelFailed: '取消失败',
  confirmReceivedFailed: '确认收货失败',
  addToCartSuccess: '已加入购物车',
  addToCartFailed: '添加失败',
  updateFailed: '修改失败',
  clearCart: '清空',
  cartEmpty: '购物车为空',
  cartTotal: '合计 {amount} ₫',
  viewCart: '查看购物车',
  delete: '删除',
  checkout: '去确认订单',
  emptyCartTitle: '清空购物车',
  emptyCartConfirm: '确认清空当前购物车？',
  switchSceneTitle: '切换点餐场景',
  switchSceneContent: '切换商家、桌台或订单类型会清空当前购物车，是否继续？',
  switchSceneConfirm: '确认',
  switchSceneCancel: '取消',
  cartContextSwitchCancelled: '已取消切换，继续查看当前内容',
  contextDineIn: '堂食 · {table}',
  contextPickup: '到店自取',
  contextDelivery: '商家配送',
  merchantName: '商家名称',
  tableNo: '桌号',
  tableLabel: '桌号：{table}',
  currentTable: '当前桌号',
  tableOrderingActive: '当前桌号：{table}',
  browseOnly: '浏览菜单',
  category: '分类',
  dishCount: '{count} 道菜',
  noDishes: '暂无菜品',
  tryAgainLater: '请稍后再试',
  product: '菜品',
  description: '描述',
  productDescriptionFallback: '餐厅菜品',
  noProductDescription: '暂无菜品描述',
  imagePlaceholder: '暂无图片',
  soldOut: '已售罄',
  soldOutCurrent: '当前已售罄',
  addToCart: '加入购物车',
  cartSelected: '已选 {count} 件',
  checkoutShort: '去结算',
  selectItems: '请选择商品',
  quantity: '数量',
  contact: '联系人',
  contactPhone: '联系电话',
  deliveryAddress: '配送地址',
  orderRemark: '订单备注',
  orderRemarkPlaceholder: '口味、餐具等备注',
  contactPlaceholder: '请输入联系人',
  phonePlaceholder: '请输入手机号',
  deliveryRangeExceeded: '当前地址可能超出商家配送范围，商家确认后可能无法配送',
  deliveryAddressPlaceholder: '请输入详细配送地址',
  contactCacheHint: '已自动带入上次填写信息，可直接修改',
  useCurrentLocation: '可选：使用当前位置',
  locationConfirmed: '已获取定位，可校验配送范围',
  locationUnconfirmed: '未使用定位，将由商家电话确认地址',
  orderRecheck: '重新校验订单',
  orderChecking: '校验中...',
  orderValidationFailed: '订单校验失败',
  subtotal: '菜品金额',
  deliveryFee: '配送费',
  totalAmount: '合计',
  deliveryRangeWarning: '地址不完整时，商家会电话联系你确认',
  submitting: '提交中...',
  submitOrder: '提交订单',
  orderSubmitted: '订单已提交',
  orderNumber: '订单号：{orderNo}',
  waitingMerchantAccept: '请等待商家接单',
  payOfflineHint: '请按商家线下方式付款',
  orderSuccessTitle: '订单已提交',
  selectLocation: '可选：使用当前位置',
  currentLanguage: '当前语言',
  all: '全部',
  active: '进行中',
  completed: '已完成',
  cancelled: '已取消',
  pendingAcceptance: '待接单',
  accepted: '已接单',
  preparing: '制作中',
  ready: '制作完成',
  delivering: '配送中',
  orderStatus: '状态',
  orderType: '订单类型',
  orderNo: '订单号',
  orderItemsCount: '{count} 项',
  orderItemsMore: '等 {count} 项',
  orderLoadError: '订单加载失败',
  missingOrderNo: '缺少订单编号',
  cancelOrder: '取消订单',
  cancelOrderTitle: '取消订单',
  cancelOrderConfirm: '仅待商家接单的订单可以取消，确认取消？',
  orderCancelled: '订单已取消',
  confirmReceived: '确认收货',
  confirmReceivedTitle: '确认收货',
  confirmReceivedContent: '确认已经收到商家配送的餐品？',
  orderCompleted: '订单已完成',
  orderStatusUpdated: '订单状态每 5 秒自动更新',
  orderDetailsAutoRefresh: '订单状态每 5 秒自动更新',
  orderInfo: '订单信息',
  diningInfo: '用餐信息',
  orderTime: '下单时间',
  orderNote: '订单备注',
  cancelReason: '取消原因',
  itemDetails: '菜品明细',
  price: '价格',
  amount: '金额',
  settlement: '收款',
  settled: '商家已标记收款',
  unsettled: '请按商家线下方式付款',
  statusRecord: '状态记录',
  state: '状态',
  goBackRetry: '返回重试',
  qrMissingToken: '二维码缺少桌台凭证',
  qrMissingTableInfo: '二维码缺少桌台信息，请重新打印桌牌',
  qrParseFailed: '二维码解析失败',
  scanUseWechatCamera: '请使用微信扫一扫桌牌二维码',
  enterOrderFailed: '无法进入点餐',
  navigationFailed: '页面跳转失败，请重试',
  scanning: '正在识别桌台...',
  scanOrderTitle: '扫码点餐',
  qrIdentified: '已识别 {merchant} · {table}',
  merchantNotFound: '商家加载失败',
  networkRequestFailed: '网络请求失败',
  requestFailed: '请求失败',
  checkNetworkRetry: '请检查网络后重试',
  wechatLoginNoCode: '微信登录未返回 code',
  wechatLoginFailed: '微信登录失败：{detail}',
  missingCartContext: '缺少购物车上下文',
  productUnpaid: '请按商家线下方式付款',
  cityBacNinh: '北宁',
  cityBacGiang: '北江',
  cityBacNinhEn: 'Bac Ninh',
  cityBacGiangEn: 'Bac Giang',
  cityBacNinhVi: 'Bắc Ninh',
  cityBacGiangVi: 'Bắc Giang',
  lineBreak: '\n',
  unsupported: '',
};

const vi: typeof zh = {
  ...zh,
  appName: 'Huayue Life',
  language: 'Ngôn ngữ',
  chinese: '中文',
  vietnamese: 'Tiếng Việt',
  english: 'English',
  switchLanguage: 'Đổi ngôn ngữ',
  homeTab: 'Trang chủ',
  ordersTab: 'Đơn hàng',
  profileTab: 'Tôi',
  homeTitle: 'Huayue Life',
  ordersTitle: 'Đơn hàng của tôi',
  profileTitle: 'Tôi',
  profileEditTitle: 'Hoàn thiện hồ sơ',
  profileEditIntroTitle: 'Hoàn thiện hồ sơ',
  profileEditIntroDesc: 'Bạn có thể chọn ảnh đại diện, biệt danh và số điện thoại mà không ảnh hưởng đến việc đặt món.',
  profileEditHint: 'Ảnh đại diện sẽ được lưu trên máy này trước; biệt danh và số điện thoại có thể được cập nhật tại đây.',
  profileEditNicknameRequired: 'Vui lòng nhập biệt danh',
  merchantDetailTitle: 'Chi tiết cửa hàng',
  menuTitle: 'Thực đơn',
  productDetailTitle: 'Chi tiết món ăn',
  scanTitle: 'Quét mã đặt món',
  cartTitle: 'Giỏ hàng',
  checkoutTitle: 'Xác nhận đơn hàng',
  orderDetailTitle: 'Chi tiết đơn hàng',
  nearbyMerchants: 'Cửa hàng gần đây',
  homeSearchPlaceholder: 'Tìm nhà hàng hoặc địa chỉ',
  homeBannerKicker: 'Món ngon hôm nay',
  homeBannerTitle: 'Món ngon gần bạn, đặt thật dễ',
  homeBannerSubtitle: 'Khám phá các nhà hàng Hoa đáng thử tại Bắc Ninh và Bắc Giang',
  homeBannerAction: 'Xem quán gần đây',
  homeTableOrderTitle: 'Gọi món tại bàn',
  homeTableOrderHint: 'Dùng WeChat quét mã QR trên bảng bàn',
  homeTableOrderModal: 'Để gọi món tại bàn, hãy mở tính năng Quét của WeChat và quét mã QR trên bảng bàn.',
  gotIt: 'Đã hiểu',
  homeFoodCategories: 'Danh mục món ăn',
  homeCategoryCaption: 'Hôm nay ăn gì?',
  homeCategoryPopular: 'Món phổ biến',
  homeCategoryChinese: 'Món Hoa',
  homeCategoryNoodles: 'Bún mì & ăn vặt',
  homeCategoryDrinks: 'Trà & tráng miệng',
  homeNearbyRestaurants: 'Nhà hàng gần đây',
  homeEmptyHint: 'Nhiều quán ngon khác đang sắp ra mắt',
  homeSearchEmpty: 'Không tìm thấy nhà hàng phù hợp',
  homeSearchEmptyHint: 'Hãy thử một từ khóa khác',
  scanOrder: 'Quét mã đặt món',
  scanSubtitle: 'Quét mã QR trên bàn để vào thực đơn',
  locationByDistance: 'Sắp xếp theo khoảng cách',
  locationByCity: 'Hiển thị theo thành phố',
  relocate: 'Định vị lại',
  currentCity: 'Thành phố hiện tại',
  loading: 'Đang tải...',
  noMerchants: 'Khu vực này hiện chưa có nhà hàng khả dụng',
  locationPermissionRequired: 'Cần bật định vị để xem các quán gần bạn',
  deliveryLocationRequired: 'Vui lòng chọn địa chỉ giao hàng trước khi tiếp tục',
  noOrders: 'Chưa có đơn hàng',
  ordersSubtitle: 'Theo dõi tiến độ gọi món bất cứ lúc nào',
  ordersEmptyHint: 'Khám phá nhà hàng gần bạn',
  orderNow: 'Gọi món',
  paidAmount: 'Đã trả',
  viewDetails: 'Xem chi tiết',
  noLocation: 'Không lấy được vị trí, đã hiển thị theo thành phố đã chọn',
  currentByCity: 'Đang hiển thị theo {city}',
  retryScan: 'Quay lại thử lại',
  openNearby: 'Cửa hàng gần đây',
  openMenu: 'Xem thực đơn',
  restaurant: 'Nhà hàng',
  dineIn: 'Ăn tại chỗ',
  pickup: 'Tự lấy',
  delivery: 'Giao bởi quán',
  browseMenu: 'Xem thực đơn',
  merchantOpen: 'Đang mở cửa',
  merchantClosed: 'Đang nghỉ',
  phone: 'Điện thoại',
  serviceArea: 'Khu vực phục vụ',
  paymentMethod: 'Phương thức thanh toán',
  offlinePayment: 'Thanh toán trực tiếp cho cửa hàng',
  aboutTitle: 'Giới thiệu Huayue Life',
  aboutLine1: 'Dịch vụ đặt món bằng QR cho nhà hàng người Hoa tại Bắc Ninh và Bắc Giang.',
  aboutLine2: 'Nền tảng hiện chưa hỗ trợ thanh toán online và giao hàng bởi tài xế.',
  myOrders: 'Đơn hàng của tôi',
  editProfile: 'Chỉnh sửa hồ sơ',
  profileQuickActions: 'Truy cập nhanh',
  profilePreferences: 'Tùy chọn và dịch vụ',
  profileOrdersHint: 'Xem lịch sử và tiến độ đơn hàng',
  profileEditHintShort: 'Đổi ảnh đại diện, biệt danh và số điện thoại',
  meNicknameFallback: 'Người dùng WeChat',
  mePhoneFallback: 'Chưa liên kết số điện thoại, chạm để liên kết',
  profilePhoneInvalid: 'Vui lòng nhập số điện thoại hợp lệ',
  locationSelectionFailed: 'Định vị thất bại, vui lòng chọn lại vị trí giao hàng',
  wechatProfileTitle: 'Thông tin WeChat',
  chooseAvatar: 'Chọn ảnh đại diện WeChat',
  nickname: 'Biệt danh',
  nicknamePlaceholder: 'Vui lòng nhập biệt danh',
  saveProfile: 'Lưu thông tin',
  wechatProfileSaved: 'Đã lưu thông tin',
  wechatProfileSavedLocal: 'Thông tin đã được lưu trên máy này',
  wechatAvatarLocalHint: 'Ảnh đại diện hiện lưu trên máy này, có thể đồng bộ sau',
  completeProfile: 'Hoàn thiện hồ sơ',
  wechatNicknameAuth: 'Cấp quyền biệt danh WeChat',
  wechatNicknameAuthDesc: 'Dùng để hiển thị biệt danh WeChat ở trang “Tôi”',
  wechatNicknameAuthSuccess: 'Đã cấp quyền biệt danh WeChat',
  wechatNicknameAuthFailedSimple: 'Cấp quyền biệt danh WeChat thất bại, vui lòng thử lại',
  wechatNicknameAuthFailed: 'Cấp quyền biệt danh WeChat thất bại: {detail}',
  wechatNicknameUnsupported: 'Môi trường hiện tại không hỗ trợ cấp quyền biệt danh WeChat',
  wechatNicknameEmpty: 'Không lấy được biệt danh WeChat',
  menuLoadFailed: 'Không tải được thực đơn',
  cartContextSwitchFailed: 'Không thể đổi ngữ cảnh giỏ hàng',
  cartContextSwitchError: 'Không thể đổi ngữ cảnh giỏ hàng, vui lòng thử lại',
  merchantLoadFailed: 'Không tải được cửa hàng',
  productLoadFailed: 'Không tải được món ăn',
  orderLoadFailed: 'Không tải được đơn hàng',
  cancelFailed: 'Hủy thất bại',
  confirmReceivedFailed: 'Xác nhận nhận hàng thất bại',
  addToCartSuccess: 'Đã thêm vào giỏ hàng',
  addToCartFailed: 'Thêm thất bại',
  updateFailed: 'Cập nhật thất bại',
  clearCart: 'Xóa trống',
  cartEmpty: 'Giỏ hàng trống',
  cartTotal: 'Tổng {amount} ₫',
  viewCart: 'Xem giỏ hàng',
  delete: 'Xóa',
  checkout: 'Đến xác nhận đơn',
  emptyCartTitle: 'Xóa giỏ hàng',
  emptyCartConfirm: 'Xác nhận xóa toàn bộ giỏ hàng hiện tại?',
  switchSceneTitle: 'Đổi ngữ cảnh đặt món',
  switchSceneContent: 'Đổi cửa hàng, bàn hoặc loại đơn sẽ xóa giỏ hàng hiện tại. Tiếp tục không?',
  switchSceneConfirm: 'OK',
  switchSceneCancel: 'Hủy',
  cartContextSwitchCancelled: 'Đã hủy chuyển đổi, tiếp tục xem nội dung hiện tại',
  contextDineIn: 'Ăn tại chỗ · {table}',
  contextPickup: 'Tự lấy',
  contextDelivery: 'Giao bởi quán',
  merchantName: 'Tên cửa hàng',
  tableNo: 'Số bàn',
  tableLabel: 'Bàn: {table}',
  currentTable: 'Bàn hiện tại',
  tableOrderingActive: 'Bàn hiện tại: {table}',
  browseOnly: 'Xem thực đơn',
  category: 'Danh mục',
  dishCount: '{count} món',
  noDishes: 'Chưa có món',
  tryAgainLater: 'Vui lòng thử lại sau',
  product: 'Món ăn',
  description: 'Mô tả',
  productDescriptionFallback: 'Món ăn của nhà hàng',
  noProductDescription: 'Chưa có mô tả món ăn',
  imagePlaceholder: 'Chưa có ảnh',
  soldOut: 'Hết món',
  soldOutCurrent: 'Hiện đã hết món',
  addToCart: 'Thêm vào giỏ hàng',
  cartSelected: 'Đã chọn {count} món',
  checkoutShort: 'Thanh toán',
  selectItems: 'Chọn món',
  quantity: 'Số lượng',
  contact: 'Người liên hệ',
  contactPhone: 'Số điện thoại',
  deliveryAddress: 'Địa chỉ giao hàng',
  orderRemark: 'Ghi chú đơn hàng',
  orderRemarkPlaceholder: 'Ghi chú về khẩu vị, dụng cụ...',
  contactPlaceholder: 'Nhập người liên hệ',
  phonePlaceholder: 'Nhập số điện thoại',
  deliveryRangeExceeded: 'Địa chỉ hiện tại có thể nằm ngoài phạm vi giao hàng của cửa hàng, cửa hàng có thể không giao được sau khi xác nhận',
  deliveryAddressPlaceholder: 'Nhập địa chỉ giao hàng chi tiết',
  contactCacheHint: 'Đã tự động điền thông tin đã nhập gần nhất, có thể sửa trực tiếp',
  useCurrentLocation: 'Tùy chọn: dùng vị trí hiện tại',
  locationConfirmed: 'Đã lấy vị trí, có thể kiểm tra phạm vi giao hàng',
  locationUnconfirmed: 'Không dùng vị trí, cửa hàng sẽ xác nhận địa chỉ qua điện thoại',
  orderRecheck: 'Kiểm tra lại đơn',
  orderChecking: 'Đang kiểm tra...',
  orderValidationFailed: 'Kiểm tra đơn thất bại',
  subtotal: 'Tiền món ăn',
  deliveryFee: 'Phí giao hàng',
  totalAmount: 'Tổng cộng',
  deliveryRangeWarning: 'Địa chỉ chưa đầy đủ, cửa hàng sẽ gọi điện xác nhận',
  submitting: 'Đang gửi...',
  submitOrder: 'Gửi đơn hàng',
  orderSubmitted: 'Đơn hàng đã được gửi',
  orderNumber: 'Mã đơn: {orderNo}',
  waitingMerchantAccept: 'Vui lòng chờ cửa hàng nhận đơn',
  payOfflineHint: 'Vui lòng thanh toán trực tiếp theo hướng dẫn của cửa hàng',
  orderSuccessTitle: 'Đơn hàng đã được gửi',
  selectLocation: 'Tùy chọn: dùng vị trí hiện tại',
  currentLanguage: 'Ngôn ngữ hiện tại',
  all: 'Tất cả',
  active: 'Đang xử lý',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
  pendingAcceptance: 'Chờ nhận đơn',
  accepted: 'Đã nhận đơn',
  preparing: 'Đang chuẩn bị',
  ready: 'Đã chuẩn bị xong',
  delivering: 'Đang giao',
  orderStatus: 'Trạng thái',
  orderType: 'Loại đơn',
  orderNo: 'Mã đơn',
  orderItemsCount: '{count} món',
  orderItemsMore: 'và {count} món khác',
  orderLoadError: 'Không tải được đơn hàng',
  missingOrderNo: 'Thiếu mã đơn hàng',
  cancelOrder: 'Hủy đơn hàng',
  cancelOrderTitle: 'Hủy đơn hàng',
  cancelOrderConfirm: 'Chỉ đơn chờ cửa hàng nhận mới có thể hủy. Xác nhận hủy?',
  orderCancelled: 'Đơn hàng đã hủy',
  confirmReceived: 'Xác nhận đã nhận',
  confirmReceivedTitle: 'Xác nhận đã nhận',
  confirmReceivedContent: 'Xác nhận đã nhận món từ cửa hàng giao?',
  orderCompleted: 'Đơn hàng đã hoàn thành',
  orderStatusUpdated: 'Trạng thái đơn cập nhật mỗi 5 giây',
  orderDetailsAutoRefresh: 'Trạng thái đơn cập nhật mỗi 5 giây',
  orderInfo: 'Thông tin đơn hàng',
  diningInfo: 'Thông tin phục vụ',
  orderTime: 'Thời gian đặt',
  orderNote: 'Ghi chú đơn hàng',
  cancelReason: 'Lý do hủy',
  itemDetails: 'Chi tiết món ăn',
  price: 'Giá',
  amount: 'Số tiền',
  settlement: 'Thanh toán',
  settled: 'Đã đánh dấu đã thu tiền',
  unsettled: 'Vui lòng thanh toán trực tiếp cho cửa hàng',
  statusRecord: 'Lịch sử trạng thái',
  state: 'Trạng thái',
  goBackRetry: 'Quay lại thử lại',
  qrMissingToken: 'Mã QR thiếu chứng thực bàn',
  qrMissingTableInfo: 'Mã QR thiếu thông tin bàn, vui lòng in lại bảng bàn',
  qrParseFailed: 'Phân tích mã QR thất bại',
  scanUseWechatCamera: 'Vui lòng dùng WeChat để quét mã bàn',
  enterOrderFailed: 'Không thể vào đặt món',
  navigationFailed: 'Không thể chuyển trang, vui lòng thử lại',
  scanning: 'Đang nhận diện bàn...',
  scanOrderTitle: 'Quét mã đặt món',
  qrIdentified: 'Đã nhận diện {merchant} · {table}',
  merchantNotFound: 'Không tải được cửa hàng',
  networkRequestFailed: 'Lỗi kết nối mạng',
  requestFailed: 'Yêu cầu thất bại',
  checkNetworkRetry: 'Vui lòng kiểm tra mạng rồi thử lại',
  wechatLoginNoCode: 'Đăng nhập WeChat không trả về code',
  wechatLoginFailed: 'Đăng nhập WeChat thất bại: {detail}',
  missingCartContext: 'Thiếu ngữ cảnh giỏ hàng',
  productUnpaid: 'Vui lòng thanh toán trực tiếp cho cửa hàng',
  cityBacNinh: 'Bắc Ninh',
  cityBacGiang: 'Bắc Giang',
  cityBacNinhEn: 'Bac Ninh',
  cityBacGiangEn: 'Bac Giang',
  cityBacNinhVi: 'Bắc Ninh',
  cityBacGiangVi: 'Bắc Giang',
};

const en: typeof zh = {
  ...zh,
  appName: 'Huayue Life',
  language: 'Language',
  chinese: '中文',
  vietnamese: 'Tiếng Việt',
  english: 'English',
  switchLanguage: 'Switch Language',
  homeTab: 'Home',
  ordersTab: 'Orders',
  profileTab: 'Me',
  homeTitle: 'Huayue Life',
  ordersTitle: 'My Orders',
  profileTitle: 'Me',
  profileEditTitle: 'Complete Profile',
  profileEditIntroTitle: 'Complete Your Profile',
  profileEditIntroDesc: 'You can choose an avatar, nickname, and phone number without affecting ordering.',
  profileEditHint: 'The avatar is saved locally first; the nickname and phone number can be updated here.',
  profileEditNicknameRequired: 'Please enter a nickname',
  merchantDetailTitle: 'Merchant Details',
  menuTitle: 'Menu',
  productDetailTitle: 'Product Details',
  scanTitle: 'Scan to Order',
  cartTitle: 'Cart',
  checkoutTitle: 'Confirm Order',
  orderDetailTitle: 'Order Details',
  nearbyMerchants: 'Nearby Merchants',
  homeSearchPlaceholder: 'Search restaurants or addresses',
  homeBannerKicker: "Today's picks",
  homeBannerTitle: 'Good food nearby, easy ordering',
  homeBannerSubtitle: 'Discover Chinese restaurants worth trying in Bac Ninh and Bac Giang',
  homeBannerAction: 'Explore nearby',
  homeTableOrderTitle: 'Order at your table',
  homeTableOrderHint: 'Use WeChat Scan on the table QR code',
  homeTableOrderModal: 'For dine-in ordering, open WeChat Scan and scan the QR code on the table sign.',
  gotIt: 'Got it',
  homeFoodCategories: 'Food categories',
  homeCategoryCaption: 'What are you craving?',
  homeCategoryPopular: 'Popular',
  homeCategoryChinese: 'Chinese meals',
  homeCategoryNoodles: 'Noodles & snacks',
  homeCategoryDrinks: 'Drinks & dessert',
  homeNearbyRestaurants: 'Nearby restaurants',
  homeEmptyHint: 'More good restaurants are joining soon',
  homeSearchEmpty: 'No matching restaurants found',
  homeSearchEmptyHint: 'Try another keyword',
  scanOrder: 'Scan to Order',
  scanSubtitle: 'Scan the QR code on the table to open the menu',
  locationByDistance: 'Sorted by distance',
  locationByCity: 'Shown by city',
  relocate: 'Relocate',
  currentCity: 'Current city',
  loading: 'Loading...',
  noMerchants: 'No available restaurants in this area',
  locationPermissionRequired: 'Please enable location to view nearby restaurants',
  deliveryLocationRequired: 'Please choose a delivery address before continuing',
  noOrders: 'No orders yet',
  ordersSubtitle: 'Track your food orders anytime',
  ordersEmptyHint: 'Explore nearby restaurants',
  orderNow: 'Order now',
  paidAmount: 'Paid',
  viewDetails: 'View details',
  noLocation: 'Location unavailable, showing restaurants by the selected city',
  currentByCity: 'Showing for {city}',
  retryScan: 'Go back and try again',
  openNearby: 'Nearby Merchants',
  openMenu: 'Open Menu',
  restaurant: 'Restaurant',
  dineIn: 'Dine In',
  pickup: 'Pickup',
  delivery: 'Merchant Delivery',
  browseMenu: 'Browse Menu',
  merchantOpen: 'Open',
  merchantClosed: 'Closed',
  phone: 'Phone',
  serviceArea: 'Service Area',
  paymentMethod: 'Payment Method',
  offlinePayment: 'Pay the merchant offline',
  aboutTitle: 'About Huayue Life',
  aboutLine1: 'QR ordering for Chinese restaurants in Bac Ninh and Bac Giang.',
  aboutLine2: 'The platform does not provide online payment or rider delivery yet.',
  myOrders: 'My Orders',
  editProfile: 'Edit Profile',
  profileQuickActions: 'Quick actions',
  profilePreferences: 'Preferences and services',
  profileOrdersHint: 'View order history and progress',
  profileEditHintShort: 'Update avatar, nickname, and phone',
  meNicknameFallback: 'WeChat User',
  mePhoneFallback: 'Phone not linked yet, tap to bind',
  profilePhoneInvalid: 'Please enter a valid phone number',
  locationSelectionFailed: 'Location failed. Please choose the delivery location again.',
  wechatProfileTitle: 'WeChat Profile',
  chooseAvatar: 'Choose WeChat Avatar',
  nickname: 'Nickname',
  nicknamePlaceholder: 'Please enter nickname',
  saveProfile: 'Save Profile',
  wechatProfileSaved: 'Profile saved',
  wechatProfileSavedLocal: 'Profile saved locally',
  wechatAvatarLocalHint: 'Avatar is stored locally for now and can be synced later',
  completeProfile: 'Complete Profile',
  wechatNicknameAuth: 'Authorize WeChat Nickname',
  wechatNicknameAuthDesc: 'Used to display your WeChat nickname on the Me page',
  wechatNicknameAuthSuccess: 'WeChat nickname authorized',
  wechatNicknameAuthFailedSimple: 'Failed to authorize WeChat nickname, please try again',
  wechatNicknameAuthFailed: 'Failed to authorize WeChat nickname: {detail}',
  wechatNicknameUnsupported: 'Current environment does not support WeChat nickname authorization',
  wechatNicknameEmpty: 'Could not get WeChat nickname',
  menuLoadFailed: 'Failed to load menu',
  cartContextSwitchFailed: 'Failed to switch cart context',
  cartContextSwitchError: 'Failed to switch cart context, please try again',
  merchantLoadFailed: 'Failed to load merchant',
  productLoadFailed: 'Failed to load product',
  orderLoadFailed: 'Failed to load order',
  cancelFailed: 'Cancel failed',
  confirmReceivedFailed: 'Confirm receipt failed',
  addToCartSuccess: 'Added to cart',
  addToCartFailed: 'Failed to add',
  updateFailed: 'Update failed',
  clearCart: 'Clear',
  cartEmpty: 'Cart is empty',
  cartTotal: 'Total {amount} ₫',
  viewCart: 'View Cart',
  delete: 'Delete',
  checkout: 'Go to confirm order',
  emptyCartTitle: 'Clear Cart',
  emptyCartConfirm: 'Clear the current cart?',
  switchSceneTitle: 'Switch Ordering Context',
  switchSceneContent: 'Switching merchant, table, or order type will clear the current cart. Continue?',
  switchSceneConfirm: 'OK',
  switchSceneCancel: 'Cancel',
  cartContextSwitchCancelled: 'Switch cancelled, continue viewing the current content',
  contextDineIn: 'Dine In · {table}',
  contextPickup: 'Pickup',
  contextDelivery: 'Merchant Delivery',
  merchantName: 'Merchant Name',
  tableNo: 'Table No.',
  tableLabel: 'Table: {table}',
  currentTable: 'Current table',
  tableOrderingActive: 'Current table: {table}',
  browseOnly: 'Browse Menu',
  category: 'Category',
  dishCount: '{count} dishes',
  noDishes: 'No dishes available',
  tryAgainLater: 'Please try again later',
  product: 'Product',
  description: 'Description',
  productDescriptionFallback: 'Restaurant dish',
  noProductDescription: 'No product description yet',
  imagePlaceholder: 'No image',
  soldOut: 'Sold Out',
  soldOutCurrent: 'Currently sold out',
  addToCart: 'Add to Cart',
  cartSelected: '{count} selected',
  checkoutShort: 'Checkout',
  selectItems: 'Select items',
  quantity: 'Quantity',
  contact: 'Contact',
  contactPhone: 'Phone',
  deliveryAddress: 'Delivery Address',
  orderRemark: 'Order Note',
  orderRemarkPlaceholder: 'Notes for taste, utensils, etc.',
  contactPlaceholder: 'Enter contact name',
  phonePlaceholder: 'Enter phone number',
  deliveryRangeExceeded: 'The current address may be outside the merchant delivery range. The merchant may not be able to deliver after confirmation.',
  deliveryAddressPlaceholder: 'Enter detailed delivery address',
  contactCacheHint: 'Previously entered info has been auto-filled and can be edited',
  useCurrentLocation: 'Optional: use current location',
  locationConfirmed: 'Location captured, delivery range can be checked',
  locationUnconfirmed: 'Location not used, the merchant will confirm by phone',
  orderRecheck: 'Re-check Order',
  orderChecking: 'Checking...',
  orderValidationFailed: 'Order validation failed',
  subtotal: 'Item Amount',
  deliveryFee: 'Delivery Fee',
  totalAmount: 'Total',
  deliveryRangeWarning: 'Address is incomplete, the merchant will confirm by phone',
  submitting: 'Submitting...',
  submitOrder: 'Submit Order',
  orderSubmitted: 'Order submitted',
  orderNumber: 'Order No: {orderNo}',
  waitingMerchantAccept: 'Please wait for the merchant to accept',
  payOfflineHint: 'Please pay the merchant offline',
  orderSuccessTitle: 'Order Submitted',
  selectLocation: 'Optional: use current location',
  currentLanguage: 'Current language',
  all: 'All',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
  pendingAcceptance: 'Pending',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  delivering: 'Delivering',
  orderStatus: 'Status',
  orderType: 'Order Type',
  orderNo: 'Order No',
  orderItemsCount: '{count} items',
  orderItemsMore: 'and {count} more',
  orderLoadError: 'Failed to load order',
  missingOrderNo: 'Missing order number',
  cancelOrder: 'Cancel Order',
  cancelOrderTitle: 'Cancel Order',
  cancelOrderConfirm: 'Only orders awaiting acceptance can be cancelled. Continue?',
  orderCancelled: 'Order cancelled',
  confirmReceived: 'Confirm Receipt',
  confirmReceivedTitle: 'Confirm Receipt',
  confirmReceivedContent: 'Confirm you have received the food from the merchant?',
  orderCompleted: 'Order completed',
  orderStatusUpdated: 'Order status refreshes every 5 seconds',
  orderDetailsAutoRefresh: 'Order status refreshes every 5 seconds',
  orderInfo: 'Order Information',
  diningInfo: 'Dining Info',
  orderTime: 'Order Time',
  orderNote: 'Order Note',
  cancelReason: 'Cancel Reason',
  itemDetails: 'Item Details',
  price: 'Price',
  amount: 'Amount',
  settlement: 'Payment',
  settled: 'Marked as paid',
  unsettled: 'Please pay the merchant offline',
  statusRecord: 'Status History',
  state: 'State',
  goBackRetry: 'Go back and retry',
  qrMissingToken: 'QR code is missing table token',
  qrMissingTableInfo: 'QR code is missing table info, please reprint the table card',
  qrParseFailed: 'Failed to parse QR code',
  scanUseWechatCamera: 'Please use WeChat camera to scan the table code',
  enterOrderFailed: 'Unable to enter ordering',
  navigationFailed: 'Navigation failed, please try again',
  scanning: 'Recognizing the table...',
  scanOrderTitle: 'Scan to Order',
  qrIdentified: 'Identified {merchant} · {table}',
  merchantNotFound: 'Failed to load merchant',
  networkRequestFailed: 'Network request failed',
  requestFailed: 'Request failed',
  checkNetworkRetry: 'Please check your network and try again',
  wechatLoginNoCode: 'WeChat login did not return a code',
  wechatLoginFailed: 'WeChat login failed: {detail}',
  missingCartContext: 'Missing cart context',
  productUnpaid: 'Please pay the merchant offline',
  cityBacNinh: 'Bac Ninh',
  cityBacGiang: 'Bac Giang',
  cityBacNinhEn: 'Bac Ninh',
  cityBacGiangEn: 'Bac Giang',
  cityBacNinhVi: 'Bắc Ninh',
  cityBacGiangVi: 'Bắc Giang',
};

const dictionaries = { zh, vi, en } as const;

function applyParams(
  text: string,
  params: Record<string, string | number> = {},
) {
  return Object.entries(params).reduce(
    (result, [name, value]) => result.split(`{${name}}`).join(String(value)),
    text,
  );
}

export function getCurrentLocale() {
  return locale.value;
}

export function setCurrentLocale(next: Locale) {
  locale.value = next;
  saveLocale(next);
  syncTabBar();
}

export function useI18n() {
  function t(
    key: TranslationKey,
    params: Record<string, string | number> = {},
  ) {
    return applyParams(dictionaries[locale.value][key], params);
  }

  return {
    locale,
    setLocale: setCurrentLocale,
    t,
  };
}

export function usePageTitle(titleGetter: () => string) {
  watchEffect(() => {
    uni.setNavigationBarTitle({ title: titleGetter() });
  });
}

export function syncTabBar() {
  const { t } = useI18n();
  const items = [
    ['homeTab', 0],
    ['ordersTab', 1],
    ['profileTab', 2],
  ] as const;

  for (const [key, index] of items) {
    try {
      uni.setTabBarItem({ index, text: t(key) });
    } catch {
      // no-op for environments without a tab bar
    }
  }
}

export function localeLabel(current = locale.value) {
  return current === 'vi' ? 'Tiếng Việt' : current === 'en' ? 'English' : '中文';
}

export function cityOptions(current = locale.value) {
  const cities = [
    {
      value: 'Bac Ninh',
      label:
        current === 'vi'
          ? vi.cityBacNinhVi
          : current === 'en'
            ? en.cityBacNinhEn
            : zh.cityBacNinh,
    },
    {
      value: 'Bac Giang',
      label:
        current === 'vi'
          ? vi.cityBacGiangVi
          : current === 'en'
            ? en.cityBacGiangEn
            : zh.cityBacGiang,
    },
  ];
  return cities;
}

export function merchantName(
  item: { nameZh: string; nameVi?: string },
  current = locale.value,
) {
  if (current === 'vi') return item.nameVi || item.nameZh;
  return item.nameZh;
}

export function categoryName(
  item: { nameZh: string; nameVi?: string },
  current = locale.value,
) {
  return merchantName(item, current);
}

export function productName(
  item: { nameZh: string; nameVi?: string },
  current = locale.value,
) {
  return merchantName(item, current);
}

export function orderTypeLabel(
  type: 'DINE_IN' | 'PICKUP' | 'DELIVERY',
  current = locale.value,
) {
  const map = {
    DINE_IN: current === 'vi' ? vi.dineIn : current === 'en' ? en.dineIn : zh.dineIn,
    PICKUP: current === 'vi' ? vi.pickup : current === 'en' ? en.pickup : zh.pickup,
    DELIVERY:
      current === 'vi'
        ? vi.delivery
        : current === 'en'
          ? en.delivery
          : zh.delivery,
  } as const;
  return map[type];
}

export function orderStatusLabel(
  status:
    | 'PENDING_ACCEPTANCE'
    | 'ACCEPTED'
    | 'PREPARING'
    | 'READY'
    | 'DELIVERING'
    | 'COMPLETED'
    | 'CANCELLED',
  current = locale.value,
) {
  const map = {
    PENDING_ACCEPTANCE:
      current === 'vi'
        ? vi.pendingAcceptance
        : current === 'en'
          ? en.pendingAcceptance
          : zh.pendingAcceptance,
    ACCEPTED:
      current === 'vi'
        ? vi.accepted
        : current === 'en'
          ? en.accepted
          : zh.accepted,
    PREPARING:
      current === 'vi'
        ? vi.preparing
        : current === 'en'
          ? en.preparing
          : zh.preparing,
    READY:
      current === 'vi'
        ? vi.ready
        : current === 'en'
          ? en.ready
          : zh.ready,
    DELIVERING:
      current === 'vi'
        ? vi.delivering
        : current === 'en'
          ? en.delivering
          : zh.delivering,
    COMPLETED:
      current === 'vi'
        ? vi.completed
        : current === 'en'
          ? en.completed
          : zh.completed,
    CANCELLED:
      current === 'vi'
        ? vi.cancelled
        : current === 'en'
          ? en.cancelled
          : zh.cancelled,
  } as const;
  return map[status];
}

export function settlementLabel(
  status: 'UNSETTLED' | 'SETTLED',
  current = locale.value,
) {
  if (status === 'SETTLED') {
    return current === 'vi'
      ? 'Đã thu tiền'
      : current === 'en'
        ? 'Settled'
        : '已收款';
  }
  return current === 'vi'
    ? 'Chưa thu tiền'
    : current === 'en'
      ? 'Unsettled'
      : '未收款';
}

export function productStatusLabel(status: 'ON_SALE' | 'SOLD_OUT', current = locale.value) {
  if (status === 'SOLD_OUT') {
    return current === 'vi'
      ? vi.soldOut
      : current === 'en'
        ? en.soldOut
        : zh.soldOut;
  }
  return current === 'vi' ? 'Đang bán' : current === 'en' ? 'On Sale' : '上架';
}

export function operatorLabel(
  type: 'USER' | 'MERCHANT_STAFF' | 'SYSTEM',
  current = locale.value,
) {
  if (type === 'USER') {
    return current === 'vi' ? 'Khách hàng' : current === 'en' ? 'Customer' : '用户';
  }
  if (type === 'MERCHANT_STAFF') {
    return current === 'vi'
      ? 'Nhân viên cửa hàng'
      : current === 'en'
        ? 'Merchant Staff'
        : '商家员工';
  }
  return current === 'vi' ? 'Hệ thống' : current === 'en' ? 'System' : '系统';
}

export function formatNumberCurrency(value: number | string) {
  return `${Number(value).toLocaleString()} ₫`;
}

export function translateApiError(raw: unknown) {
  const { t } = useI18n();
  if (typeof raw !== 'string') {
    return t('requestFailed');
  }
  if (raw.includes('Network Error')) return t('networkRequestFailed');
  if (raw.includes('网络请求失败')) return t('networkRequestFailed');
  if (raw.includes('请检查网络后重试')) return t('checkNetworkRetry');
  if (raw.includes('微信登录未返回 code')) return t('wechatLoginNoCode');
  if (raw.includes('微信登录失败')) return raw.replace(
    '微信登录失败',
    t('wechatLoginFailed').split(':')[0],
  );
  if (
    raw.includes('deliveryLatitude must be a number') ||
    raw.includes('deliveryLongitude must be a number') ||
    raw.includes('must be a number conforming to the specified constraints') ||
    raw.includes('配送经纬度必须同时提供')
  ) {
    return '地址不完整时，商家会电话联系你确认';
  }
  if (raw.includes('请填写配送地址')) return '地址不完整时，商家会电话联系你确认';
  if (raw.includes('配送地址超出商家配送范围')) {
    return '当前位置可能超出商家配送范围，商家确认后可能无法配送';
  }
  if (raw.includes('缺少购物车上下文')) return t('missingCartContext');
  if (raw.includes('菜单加载失败')) return t('menuLoadFailed');
  if (raw.includes('商家加载失败')) return t('merchantLoadFailed');
  if (raw.includes('菜品加载失败')) return t('productLoadFailed');
  if (raw.includes('订单加载失败')) return t('orderLoadFailed');
  if (raw.includes('取消失败')) return t('cancelFailed');
  if (raw.includes('确认收货失败')) return t('confirmReceivedFailed');
  return raw;
}
