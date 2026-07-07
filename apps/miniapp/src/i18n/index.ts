import { ref, watchEffect } from 'vue';
import type { LocalizedFields, LocalizedTranslationMap } from '@/types/api';
import type { Locale } from '@/utils/storage';
import { getLocale, setLocale as saveLocale } from '@/utils/storage';

export type TranslationKey = keyof typeof zh;

export const locale = ref<Locale>(getLocale());

const zh = {
  appName: '云桥 Life',
  language: '语言',
  chinese: '中文',
  vietnamese: 'Tiếng Việt',
  english: 'English',
  switchLanguage: '切换语言',
  homeTab: '首页',
  favoritesTab: '收藏',
  messagesTab: '消息',
  profileTab: '我的',
  favoritesPageSubtitle: '收藏喜欢的商家，方便下次查看',
  noFavoritesTitle: '暂无收藏',
  noFavoritesHint: '收藏喜欢的商家，方便下次查看',
  saveFavorite: '收藏',
  saved: '已收藏',
  favoriteSavedToast: '已收藏',
  favoriteRemovedToast: '已取消收藏',
  homeTitle: '云桥 Life',
  messagesTitle: '消息',
  ordersTitle: '我的订单',
  profileTitle: '我的',
  profileEditTitle: '资料完善',
  profileEditIntroTitle: '完善资料',
  profileEditIntroDesc: '这里可以选择头像和昵称，用于完善个人资料。',
  profileEditHint: '头像会先保存在本机；昵称可在这里同步更新。',
  profileEditNicknameRequired: '请填写昵称',
  locationSelectionFailed: '定位失败，请重新选择配送位置',
  merchantDetailTitle: '商家详情',
  menuTitle: '餐厅菜单',
  productDetailTitle: '菜品详情',
  scanTitle: '扫码点餐',
  cartTitle: '购物车',
  checkoutTitle: '确认订单',
  orderDetailTitle: '订单详情',
  contactMerchant: '联系商家',
  orderChat: '订单聊天',
  chatHistory: '聊天记录',
  loadingMessages: '加载聊天记录中...',
  chatRefreshing: '正在同步最新消息...',
  noMessages: '暂无聊天消息',
  messagePlaceholder: '请输入文字消息',
  sending: '发送中...',
  sendMessage: '发送',
  chatClosedHint: '订单已完成或已取消，只能查看历史消息',
  read: '已读',
  unread: '未读',
  merchant: '商家',
  me: '我',
  close: '关闭',
  nearbyMerchants: '附近商家',
  homeSearchPlaceholder: '搜索商家或地址',
  homeBannerKicker: '本地好店',
  homeBannerTitle: '发现身边好店',
  homeBannerSubtitle: '精选北宁、北江本地商家与到店服务',
  homeBannerAction: '查看附近好店',
  homeTableOrderTitle: '扫码服务',
  homeTableOrderHint: '使用微信扫一扫店内二维码查看服务',
  homeTableOrderModal: '请使用微信扫一扫店内二维码，进入对应商家服务页面。',
  gotIt: '知道了',
  homeFoodCategories: '服务分类',
  homeCategoryCaption: '今天想找什么服务',
  homeCategoryPopular: '热门美食',
  homeCategoryChinese: '中式正餐',
  homeCategoryNoodles: '粉面小吃',
  homeCategoryDrinks: '咖啡奶茶',
  homeCategoryFlowers: '鲜花礼品',
  homeCategoryFresh: '水果生鲜',
  homeCategoryConvenience: '便利超市',
  homeCategoryVietnamese: '特色越餐',
  homeNearbyRestaurants: '附近好店',
  homeEmptyHint: '商家陆续入驻中，更多服务即将开放。',
  homeProvinceEmptyTitle: '当前省份暂无商家',
  homeNearbyProvinceEmptyTitle: '当前省份暂无附近商家',
  homeProvinceEmptyHint: '请切换到其他省份，或稍后再试。',
  homeNearbyProvinceSelectionRequired: '请选择北江或北宁查看附近商家',
  homeNearbyUnsupportedTitle: '当前城市暂无门店',
  homeNearbyLocationPermissionRequired: '无法获取当前位置，请开启定位权限后重试',
  homeNearbyLocationFailed: '无法获取当前位置，请稍后重试',
  homeSearchEmpty: '没有找到相关商家',
  homeSearchEmptyHint: '换个关键词试试',
  homeCategoryJoinSoon: '该分类商家正在入驻中',
  allMerchants: '全部商家',
  scanOrder: '扫码点餐',
  inStoreScanOrder: '到店扫码点餐',
  inStoreScanOrderDialogContent: '本店支持到店扫码点餐。\n到店入座后，请扫描桌台二维码进行点餐。\n如需打包带走，请选择“到店自取”。',
  scanSubtitle: '扫描桌面二维码进入餐厅菜单',
  locationByDistance: '按距离排序',
  locationByCity: '按城市展示',
  relocate: '重新定位',
  currentCity: '当前城市',
  loading: '加载中...',
  noMerchants: '商家陆续入驻中',
  noMerchantsHint: '云桥 Life 正在接入北宁、北江本地商家，更多服务即将开放。',
  locationPermissionRequired: '需要开启定位才能查看附近好店',
  deliveryLocationRequired: '请选择配送地址后再继续',
  noOrders: '暂无订单',
  ordersSubtitle: '随时查看点餐进度',
  ordersEmptyHint: '去附近餐厅看看吧',
  orderNow: '去点餐',
  paidAmount: '应付',
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
  mapNavigation: '导航',
  navigationRecommendationTitle: '导航提示',
  navigationRecommendationContent:
    '为保证定位准确，建议在地图选择页面中选择 Google Maps 导航。',
  continueNavigation: '继续导航',
  merchantLocationMissing: '暂无商家定位信息',
  miniappMapOpenFailed: '无法打开地图，请稍后重试',
  callMerchant: '拨打',
  merchantPhoneMissing: '商家暂未提供联系电话',
  merchantPhoneCallFailed: '无法拨打电话，请稍后重试',
  phone: '手机号',
  serviceArea: '服务区域',
  myFavorites: '我的收藏',
  browsingHistory: '浏览记录',
  aboutTitle: '关于云桥 Life',
  aboutLine1: '云桥 Life 是面向本地生活信息展示工具。',
  aboutLine2: '你可以查看本地商家资料、地址、联系方式和营业信息，方便了解周边生活服务。',
  editProfile: '编辑资料',
  profileQuickActions: '快捷入口',
  profilePreferences: '偏好与服务',
  profileFavoritesHint: '查看已收藏的商家',
  profileBrowsingHistoryHint: '查看最近浏览过的商家',
  profileEditHintShort: '修改头像和昵称',
  profileWelcomeTitle: '欢迎使用云桥 Life',
  profileWelcomeDesc: '登录后可同步收藏、浏览记录和商家通知。',
  wechatOneTapLogin: '微信一键登录',
  loggingIn: '登录中...',
  loginPrivacyPrefix: '登录即代表你已阅读并同意',
  privacyProtectionGuide: '用户隐私保护指引',
  guestBrowseHint: '不登录也可以浏览商家信息。',
  favoritesLoginTitle: '登录后查看收藏',
  favoritesLoginContent: '登录后可以同步你收藏的商家，方便下次快速找到。',
  favoritesLoginHint: '不登录也可以继续浏览商家信息。',
  wechatUser: '微信用户',
  phoneNotLinked: '未绑定手机号',
  logout: '退出登录',
  loggedOut: '已退出登录',
  loggedIn: '已登录',
  bindPhone: '绑定手机号',
  phoneLinked: '手机号已绑定',
  phoneBindFailed: '手机号绑定失败，请稍后再试',
  phoneAuthorizationCanceled: '你已取消手机号授权',
  phoneAuthorizationInfoInvalidRetry: '手机号授权信息异常，请稍后再试',
  phoneAuthorizationInfoInvalidUpgrade: '手机号授权信息异常，请升级微信后重试',
  phonePrivacyAuthorizationRequired: '需要同意隐私保护指引后才能绑定手机号',
  phoneLinkingServiceNotReady: '手机号绑定服务暂未完成，请稍后再试',
  wechatLoginSuccess: '登录成功',
  wechatLoginFailedSimple: '登录失败，请稍后再试',
  signInServiceNotReady: '登录服务暂未完成，请稍后再试',
  privacyAuthorizationRequired: '需要同意隐私保护指引后才能登录',
  privacyContractOpenFailed: '隐私保护指引打开失败',
  privacyContractUnavailable: '当前环境暂不支持打开隐私保护指引',
  notNowLogin: '暂不登录',
  loginFavoriteTitle: '登录后可收藏商家',
  loginFavoriteContent: '登录后可保存你感兴趣的商家，方便下次查看。',
  loginMerchantNoticeTitle: '登录后查看商家通知',
  loginMerchantNoticeContent: '登录后可查看与你相关的商家服务通知和沟通记录。',
  loginProfileEditTitle: '请先登录',
  loginProfileEditContent: '登录后可以编辑头像、昵称和个人资料。',
  browsingHistoryEmptyTitle: '暂无浏览记录',
  browsingHistoryEmptyHint: '你查看过的商家会显示在这里。',
  browsingHistoryGoHome: '去首页看看',
  today: '今天',
  yesterday: '昨天',
  earlier: '更早',
  viewedAt: '最近浏览',
  viewCount: '浏览 {count} 次',
  messagesSubtitle: '查看商家通知和系统通知',
  merchantNoticesTab: '商家通知',
  systemNoticesTab: '系统通知',
  merchantNoticesDescription: '查看商家服务信息和通知',
  systemNoticesDescription: '查看平台通知和系统提醒',
  merchantServiceRecords: '商家服务记录',
  openConversation: '进入沟通',
  viewConversation: '查看沟通记录',
  merchantConversationAvailable: '可继续查看和沟通服务记录',
  completedViewRecordOnly: '已完成，仅可查看记录',
  noMerchantNoticesTitle: '暂无商家通知',
  noMerchantNoticesHint: '商家服务信息和通知会显示在这里。',
  noSystemNoticesTitle: '暂无系统通知',
  noSystemNoticesHint: '平台通知会显示在这里。',
  meNicknameFallback: '微信用户',
  mePhoneFallback: '暂未绑定手机号，点击绑定',
  profilePhoneInvalid: '请输入正确的手机号',
  wechatProfileTitle: '微信资料',
  chooseAvatar: '选择头像',
  nickname: '昵称',
  nicknamePlaceholder: '请输入昵称',
  saveProfile: '保存资料',
  wechatProfileSaved: '资料已保存',
  profileSaveFailed: '保存失败，请稍后再试',
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
  cancel: '取消',
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
  merchantUnavailable: '该商家已下架或不可见',
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
  appName: '云桥 Life',
  language: 'Ngôn ngữ',
  chinese: '中文',
  vietnamese: 'Tiếng Việt',
  english: 'English',
  switchLanguage: 'Đổi ngôn ngữ',
  homeTab: 'Trang chủ',
  favoritesTab: 'Đã lưu',
  messagesTab: 'Tin nhắn',
  profileTab: 'Tôi',
  favoritesPageSubtitle: 'Lưu cửa hàng bạn thích để xem nhanh lần sau',
  noFavoritesTitle: 'Chưa có mục đã lưu',
  noFavoritesHint: 'Lưu cửa hàng bạn thích để xem nhanh lần sau',
  saveFavorite: 'Lưu',
  saved: 'Đã lưu',
  favoriteSavedToast: 'Đã lưu',
  favoriteRemovedToast: 'Đã bỏ lưu',
  homeTitle: '云桥 Life',
  messagesTitle: 'Tin nhắn',
  ordersTitle: 'Đơn hàng của tôi',
  profileTitle: 'Tôi',
  profileEditTitle: 'Hoàn thiện hồ sơ',
  profileEditIntroTitle: 'Hoàn thiện hồ sơ',
  profileEditIntroDesc: 'Bạn có thể chọn ảnh đại diện và biệt danh để hoàn thiện hồ sơ.',
  profileEditHint: 'Ảnh đại diện sẽ được lưu trên máy này trước; biệt danh có thể được cập nhật tại đây.',
  profileEditNicknameRequired: 'Vui lòng nhập biệt danh',
  merchantDetailTitle: 'Chi tiết cửa hàng',
  menuTitle: 'Thực đơn',
  productDetailTitle: 'Chi tiết món ăn',
  scanTitle: 'Quét mã đặt món',
  cartTitle: 'Giỏ hàng',
  checkoutTitle: 'Xác nhận đơn hàng',
  orderDetailTitle: 'Chi tiết đơn hàng',
  contactMerchant: 'Liên hệ cửa hàng',
  orderChat: 'Trò chuyện đơn hàng',
  chatHistory: 'Lịch sử chat',
  loadingMessages: 'Đang tải tin nhắn...',
  chatRefreshing: 'Đang đồng bộ tin nhắn mới...',
  noMessages: 'Chưa có tin nhắn',
  messagePlaceholder: 'Nhập tin nhắn văn bản',
  sending: 'Đang gửi...',
  sendMessage: 'Gửi',
  chatClosedHint: 'Đơn đã hoàn thành hoặc đã hủy chỉ được xem lịch sử.',
  read: 'Đã đọc',
  unread: 'Chưa đọc',
  merchant: 'Nhà hàng',
  me: 'Tôi',
  close: 'Đóng',
  nearbyMerchants: 'Cửa hàng gần đây',
  homeSearchPlaceholder: 'Tìm cửa hàng hoặc địa chỉ',
  homeBannerKicker: 'Cửa hàng địa phương',
  homeBannerTitle: 'Khám phá cửa hàng gần bạn',
  homeBannerSubtitle: 'Các cửa hàng địa phương và dịch vụ tại cửa hàng ở Bắc Ninh, Bắc Giang',
  homeBannerAction: 'Xem cửa hàng gần bạn',
  homeTableOrderTitle: 'Quét mã dịch vụ',
  homeTableOrderHint: 'Quét mã QR tại cửa hàng bằng WeChat để xem dịch vụ',
  homeTableOrderModal: 'Dùng WeChat quét mã QR tại cửa hàng để vào trang dịch vụ tương ứng.',
  gotIt: 'Đã hiểu',
  homeFoodCategories: 'Danh mục dịch vụ',
  homeCategoryCaption: 'Hôm nay cần dịch vụ gì?',
  homeCategoryPopular: 'Ẩm thực phổ biến',
  homeCategoryChinese: 'Món Trung Quốc',
  homeCategoryNoodles: 'Mì & đồ ăn nhẹ',
  homeCategoryDrinks: 'Cà phê & trà sữa',
  homeCategoryFlowers: 'Hoa & quà tặng',
  homeCategoryFresh: 'Trái cây tươi',
  homeCategoryConvenience: 'Cửa hàng tiện lợi',
  homeCategoryVietnamese: 'Món Việt đặc sắc',
  homeNearbyRestaurants: 'Cửa hàng gần bạn',
  homeEmptyHint: 'Các cửa hàng đang tham gia, nhiều dịch vụ sẽ sớm được mở.',
  homeProvinceEmptyTitle: 'Hiện chưa có cửa hàng tại tỉnh này',
  homeNearbyProvinceEmptyTitle: 'Hiện chưa có cửa hàng gần bạn tại tỉnh này',
  homeProvinceEmptyHint: 'Vui lòng chuyển sang tỉnh khác hoặc thử lại sau.',
  homeNearbyProvinceSelectionRequired: 'Vui lòng chọn Bắc Giang hoặc Bắc Ninh để xem cửa hàng gần bạn',
  homeNearbyUnsupportedTitle: 'Hiện chưa có cửa hàng tại thành phố này',
  homeNearbyLocationPermissionRequired: 'Không thể xác định vị trí hiện tại. Vui lòng bật quyền vị trí và thử lại',
  homeNearbyLocationFailed: 'Không thể xác định vị trí hiện tại. Vui lòng thử lại sau',
  homeSearchEmpty: 'Không tìm thấy cửa hàng phù hợp',
  homeSearchEmptyHint: 'Hãy thử một từ khóa khác',
  homeCategoryJoinSoon: 'Các cửa hàng trong danh mục này đang tham gia',
  allMerchants: 'Tất cả cửa hàng',
  scanOrder: 'Quét mã đặt món',
  inStoreScanOrder: 'Quét mã gọi món tại quán',
  inStoreScanOrderDialogContent: 'Nhà hàng hỗ trợ gọi món bằng mã QR tại quán.\nSau khi ngồi vào bàn, vui lòng quét mã QR trên bàn để gọi món.\nNếu muốn mang đi, vui lòng chọn Tự đến lấy.',
  scanSubtitle: 'Quét mã QR trên bàn để vào thực đơn',
  locationByDistance: 'Sắp xếp theo khoảng cách',
  locationByCity: 'Hiển thị theo thành phố',
  relocate: 'Định vị lại',
  currentCity: 'Thành phố hiện tại',
  loading: 'Đang tải...',
  noMerchants: 'Các cửa hàng đang tham gia',
  noMerchantsHint: '云桥 Life đang kết nối các cửa hàng địa phương tại Bắc Ninh và Bắc Giang. Nhiều dịch vụ sẽ sớm được mở.',
  locationPermissionRequired: 'Cần bật định vị để xem các quán gần bạn',
  deliveryLocationRequired: 'Vui lòng chọn địa chỉ giao hàng trước khi tiếp tục',
  noOrders: 'Chưa có đơn hàng',
  ordersSubtitle: 'Theo dõi tiến độ gọi món bất cứ lúc nào',
  ordersEmptyHint: 'Khám phá nhà hàng gần bạn',
  orderNow: 'Gọi món',
  paidAmount: 'Cần thanh toán',
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
  mapNavigation: 'Chỉ đường',
  navigationRecommendationTitle: 'Gợi ý điều hướng',
  navigationRecommendationContent:
    'Để định vị chính xác hơn, bạn nên chọn Google Maps trên trang lựa chọn bản đồ.',
  continueNavigation: 'Tiếp tục điều hướng',
  merchantLocationMissing: 'Chưa có vị trí cửa hàng',
  miniappMapOpenFailed: 'Không thể mở bản đồ, vui lòng thử lại sau',
  callMerchant: 'Gọi',
  merchantPhoneMissing: 'Cửa hàng chưa cung cấp số điện thoại',
  merchantPhoneCallFailed: 'Không thể gọi điện, vui lòng thử lại sau',
  phone: 'Điện thoại',
  serviceArea: 'Khu vực phục vụ',
  myFavorites: 'Cửa hàng đã lưu',
  browsingHistory: 'Lịch sử xem',
  aboutTitle: 'Về 云桥 Life',
  aboutLine1: 'Yunqiao Life là công cụ hiển thị thông tin đời sống địa phương.',
  aboutLine2: 'Bạn có thể xem thông tin cửa hàng, địa chỉ, số liên hệ và giờ hoạt động để tìm hiểu các dịch vụ xung quanh.',
  editProfile: 'Chỉnh sửa hồ sơ',
  profileQuickActions: 'Truy cập nhanh',
  profilePreferences: 'Tùy chọn và dịch vụ',
  profileFavoritesHint: 'Xem các cửa hàng đã lưu',
  profileBrowsingHistoryHint: 'Xem các cửa hàng đã xem gần đây',
  profileEditHintShort: 'Đổi ảnh đại diện và biệt danh',
  profileWelcomeTitle: 'Chào mừng đến với 云桥 Life',
  profileWelcomeDesc: 'Đăng nhập để đồng bộ cửa hàng đã lưu, lịch sử xem và thông báo cửa hàng.',
  wechatOneTapLogin: 'Đăng nhập bằng WeChat',
  loggingIn: 'Đang đăng nhập...',
  loginPrivacyPrefix: 'Khi đăng nhập, bạn xác nhận đã đọc và đồng ý với',
  privacyProtectionGuide: 'Chính sách bảo vệ quyền riêng tư',
  guestBrowseHint: 'Bạn vẫn có thể xem thông tin cửa hàng mà không cần đăng nhập.',
  favoritesLoginTitle: 'Đăng nhập để xem cửa hàng đã lưu',
  favoritesLoginContent: 'Đăng nhập để đồng bộ các cửa hàng bạn đã lưu và dễ dàng tìm lại lần sau.',
  favoritesLoginHint: 'Bạn vẫn có thể tiếp tục xem thông tin cửa hàng mà không cần đăng nhập.',
  wechatUser: 'Người dùng WeChat',
  phoneNotLinked: 'Chưa liên kết số điện thoại',
  logout: 'Đăng xuất',
  loggedOut: 'Đã đăng xuất',
  loggedIn: 'Đã đăng nhập',
  bindPhone: 'Liên kết số điện thoại',
  phoneLinked: 'Đã liên kết số điện thoại',
  phoneBindFailed: 'Liên kết số điện thoại thất bại, vui lòng thử lại sau',
  phoneAuthorizationCanceled: 'Bạn đã hủy ủy quyền số điện thoại',
  phoneAuthorizationInfoInvalidRetry: 'Thông tin ủy quyền số điện thoại bất thường, vui lòng thử lại sau',
  phoneAuthorizationInfoInvalidUpgrade: 'Thông tin ủy quyền số điện thoại bất thường, vui lòng cập nhật WeChat và thử lại',
  phonePrivacyAuthorizationRequired: 'Bạn cần đồng ý với chính sách quyền riêng tư để liên kết số điện thoại',
  phoneLinkingServiceNotReady: 'Dịch vụ liên kết số điện thoại chưa hoàn tất, vui lòng thử lại sau',
  wechatLoginSuccess: 'Đăng nhập thành công',
  wechatLoginFailedSimple: 'Đăng nhập thất bại, vui lòng thử lại sau',
  signInServiceNotReady: 'Dịch vụ đăng nhập chưa hoàn tất, vui lòng thử lại sau',
  privacyAuthorizationRequired: 'Bạn cần đồng ý với chính sách bảo vệ quyền riêng tư để đăng nhập',
  privacyContractOpenFailed: 'Không thể mở chính sách bảo vệ quyền riêng tư',
  privacyContractUnavailable: 'Môi trường hiện tại chưa hỗ trợ mở chính sách bảo vệ quyền riêng tư',
  notNowLogin: 'Để sau',
  loginFavoriteTitle: 'Đăng nhập để lưu cửa hàng',
  loginFavoriteContent: 'Sau khi đăng nhập, bạn có thể lưu các cửa hàng quan tâm để xem lại dễ dàng.',
  loginMerchantNoticeTitle: 'Đăng nhập để xem thông báo cửa hàng',
  loginMerchantNoticeContent: 'Sau khi đăng nhập, bạn có thể xem thông báo dịch vụ và lịch sử trao đổi liên quan đến bạn.',
  loginProfileEditTitle: 'Vui lòng đăng nhập',
  loginProfileEditContent: 'Sau khi đăng nhập, bạn có thể chỉnh sửa ảnh đại diện, biệt danh và hồ sơ cá nhân.',
  browsingHistoryEmptyTitle: 'Chưa có lịch sử xem',
  browsingHistoryEmptyHint: 'Các cửa hàng bạn đã xem sẽ hiển thị tại đây.',
  browsingHistoryGoHome: 'Về trang chủ',
  today: 'Hôm nay',
  yesterday: 'Hôm qua',
  earlier: 'Trước đó',
  viewedAt: 'Xem gần nhất',
  viewCount: 'Đã xem {count} lần',
  messagesSubtitle: 'Xem thông báo từ cửa hàng và thông báo hệ thống',
  merchantNoticesTab: 'Thông báo cửa hàng',
  systemNoticesTab: 'Thông báo hệ thống',
  merchantNoticesDescription: 'Xem thông tin dịch vụ và thông báo từ cửa hàng',
  systemNoticesDescription: 'Xem thông báo từ nền tảng và nhắc nhở hệ thống',
  merchantServiceRecords: 'Lịch sử dịch vụ cửa hàng',
  openConversation: 'Liên hệ',
  viewConversation: 'Xem lịch sử trao đổi',
  merchantConversationAvailable: 'Có thể tiếp tục xem và trao đổi',
  completedViewRecordOnly: 'Đã hoàn tất, chỉ có thể xem lịch sử',
  noMerchantNoticesTitle: 'Chưa có thông báo cửa hàng',
  noMerchantNoticesHint: 'Thông tin dịch vụ và thông báo từ cửa hàng sẽ hiển thị tại đây.',
  noSystemNoticesTitle: 'Chưa có thông báo hệ thống',
  noSystemNoticesHint: 'Thông báo từ nền tảng sẽ hiển thị tại đây.',
  meNicknameFallback: 'Người dùng WeChat',
  mePhoneFallback: 'Chưa liên kết số điện thoại, chạm để liên kết',
  profilePhoneInvalid: 'Vui lòng nhập số điện thoại hợp lệ',
  locationSelectionFailed: 'Định vị thất bại, vui lòng chọn lại vị trí giao hàng',
  wechatProfileTitle: 'Thông tin WeChat',
  chooseAvatar: 'Chọn ảnh đại diện',
  nickname: 'Biệt danh',
  nicknamePlaceholder: 'Vui lòng nhập biệt danh',
  saveProfile: 'Lưu thông tin',
  wechatProfileSaved: 'Đã lưu thông tin',
  profileSaveFailed: 'Lưu thất bại, vui lòng thử lại sau',
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
  cancel: 'Hủy',
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
  merchantUnavailable: 'Cửa hàng này đã bị ẩn hoặc không còn hiển thị',
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
  appName: 'Yunqiao Life',
  language: 'Language',
  chinese: '中文',
  vietnamese: 'Tiếng Việt',
  english: 'English',
  switchLanguage: 'Switch Language',
  homeTab: 'Home',
  favoritesTab: 'Favorites',
  messagesTab: 'Messages',
  profileTab: 'Me',
  favoritesPageSubtitle: 'Save merchants you like for quick access next time',
  noFavoritesTitle: 'No favorites yet',
  noFavoritesHint: 'Save merchants you like for quick access next time',
  saveFavorite: 'Save',
  saved: 'Saved',
  favoriteSavedToast: 'Saved',
  favoriteRemovedToast: 'Removed from favorites',
  homeTitle: 'Yunqiao Life',
  messagesTitle: 'Messages',
  ordersTitle: 'My Orders',
  profileTitle: 'Me',
  profileEditTitle: 'Complete Profile',
  profileEditIntroTitle: 'Complete Your Profile',
  profileEditIntroDesc: 'You can choose an avatar and nickname to complete your profile.',
  profileEditHint: 'The avatar is saved locally first; the nickname can be updated here.',
  profileEditNicknameRequired: 'Please enter a nickname',
  merchantDetailTitle: 'Merchant Details',
  menuTitle: 'Menu',
  productDetailTitle: 'Product Details',
  scanTitle: 'Scan to Order',
  cartTitle: 'Cart',
  checkoutTitle: 'Confirm Order',
  orderDetailTitle: 'Order Details',
  contactMerchant: 'Contact Merchant',
  orderChat: 'Order Chat',
  chatHistory: 'Chat History',
  loadingMessages: 'Loading messages...',
  chatRefreshing: 'Syncing latest messages...',
  noMessages: 'No messages yet',
  messagePlaceholder: 'Type a text message',
  sending: 'Sending...',
  sendMessage: 'Send',
  chatClosedHint: 'Completed or cancelled orders are read-only.',
  read: 'Read',
  unread: 'Unread',
  merchant: 'Merchant',
  me: 'Me',
  close: 'Close',
  nearbyMerchants: 'Nearby Merchants',
  homeSearchPlaceholder: 'Search merchants or address',
  homeBannerKicker: 'Local shops',
  homeBannerTitle: 'Discover local shops nearby',
  homeBannerSubtitle: 'Selected local merchants and in-store services in Bac Ninh and Bac Giang',
  homeBannerAction: 'View nearby shops',
  homeTableOrderTitle: 'Scan for service',
  homeTableOrderHint: 'Scan the in-store QR code with WeChat to view services',
  homeTableOrderModal: 'Use WeChat to scan the in-store QR code and open the matching service page.',
  gotIt: 'Got it',
  homeFoodCategories: 'Service Categories',
  homeCategoryCaption: 'What service are you looking for today?',
  homeCategoryPopular: 'Popular Food',
  homeCategoryChinese: 'Chinese Dining',
  homeCategoryNoodles: 'Noodles & Snacks',
  homeCategoryDrinks: 'Coffee & Milk Tea',
  homeCategoryFlowers: 'Flowers & Gifts',
  homeCategoryFresh: 'Fresh Fruit',
  homeCategoryConvenience: 'Convenience Store',
  homeCategoryVietnamese: 'Vietnamese Food',
  homeNearbyRestaurants: 'Nearby Merchants',
  homeEmptyHint: 'Merchants are joining soon. More services are coming soon.',
  homeProvinceEmptyTitle: 'No merchants available in this province',
  homeNearbyProvinceEmptyTitle: 'No nearby merchants available in this province',
  homeProvinceEmptyHint: 'Please switch to another province or try again later.',
  homeNearbyProvinceSelectionRequired: 'Please select Bac Giang or Bac Ninh to view nearby merchants',
  homeNearbyUnsupportedTitle: 'No stores are currently available in this city',
  homeNearbyLocationPermissionRequired: 'Unable to get your current location. Please enable location permission and try again',
  homeNearbyLocationFailed: 'Unable to get your current location. Please try again later',
  homeSearchEmpty: 'No matching merchants found',
  homeSearchEmptyHint: 'Try another keyword',
  homeCategoryJoinSoon: 'Merchants in this category are joining soon',
  allMerchants: 'All merchants',
  scanOrder: 'Scan to Order',
  inStoreScanOrder: 'Scan to Order In-store',
  inStoreScanOrderDialogContent: 'This restaurant supports in-store scan-to-order.\nAfter you are seated, please scan the table QR code to order.\nFor takeaway pickup, please choose Pickup.',
  scanSubtitle: 'Scan the QR code on the table to open the menu',
  locationByDistance: 'Sorted by distance',
  locationByCity: 'Shown by city',
  relocate: 'Relocate',
  currentCity: 'Current city',
  loading: 'Loading...',
  noMerchants: 'Merchants are joining soon',
  noMerchantsHint: 'Yunqiao Life is adding local merchants in Bac Ninh and Bac Giang. More services are coming soon.',
  locationPermissionRequired: 'Please enable location to view nearby restaurants',
  deliveryLocationRequired: 'Please choose a delivery address before continuing',
  noOrders: 'No orders yet',
  ordersSubtitle: 'Track your food orders anytime',
  ordersEmptyHint: 'Explore nearby restaurants',
  orderNow: 'Order now',
  paidAmount: 'Amount Due',
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
  mapNavigation: 'Navigate',
  navigationRecommendationTitle: 'Navigation tip',
  navigationRecommendationContent:
    'For more accurate positioning, we recommend choosing Google Maps on the map selection screen.',
  continueNavigation: 'Continue',
  merchantLocationMissing: 'Merchant location is unavailable',
  miniappMapOpenFailed: 'Unable to open map, please try again later',
  callMerchant: 'Call',
  merchantPhoneMissing: 'The merchant has not provided a phone number',
  merchantPhoneCallFailed: 'Unable to make the call, please try again later',
  phone: 'Phone',
  serviceArea: 'Service Area',
  myFavorites: 'Saved Merchants',
  browsingHistory: 'Browsing history',
  aboutTitle: 'About Yunqiao Life',
  aboutLine1: 'Yunqiao Life is a local lifestyle information display tool.',
  aboutLine2: 'You can view local merchant profiles, addresses, contact details, and business hours to learn about nearby services.',
  editProfile: 'Edit Profile',
  profileQuickActions: 'Quick actions',
  profilePreferences: 'Preferences and services',
  profileFavoritesHint: 'View saved merchants',
  profileBrowsingHistoryHint: 'View recently viewed merchants',
  profileEditHintShort: 'Update avatar and nickname',
  profileWelcomeTitle: 'Welcome to Yunqiao Life',
  profileWelcomeDesc: 'Sign in to sync saved merchants, browsing history, and merchant notices.',
  wechatOneTapLogin: 'Sign in with WeChat',
  loggingIn: 'Signing in...',
  loginPrivacyPrefix: 'By signing in, you confirm that you have read and agreed to the',
  privacyProtectionGuide: 'Privacy Protection Guide',
  guestBrowseHint: 'You can still browse merchant information without signing in.',
  favoritesLoginTitle: 'Sign in to view saved merchants',
  favoritesLoginContent: 'Sign in to sync your saved merchants and find them faster next time.',
  favoritesLoginHint: 'You can still browse merchant information without signing in.',
  wechatUser: 'WeChat User',
  phoneNotLinked: 'Phone not linked',
  logout: 'Log out',
  loggedOut: 'Logged out',
  loggedIn: 'Signed in',
  bindPhone: 'Link phone',
  phoneLinked: 'Phone linked',
  phoneBindFailed: 'Phone linking failed. Please try again later.',
  phoneAuthorizationCanceled: 'You canceled phone number authorization.',
  phoneAuthorizationInfoInvalidRetry: 'Phone authorization information is invalid. Please try again later.',
  phoneAuthorizationInfoInvalidUpgrade: 'Phone authorization information is invalid. Please update WeChat and try again.',
  phonePrivacyAuthorizationRequired: 'Please agree to the Privacy Protection Guide before linking your phone number.',
  phoneLinkingServiceNotReady: 'Phone linking service is not ready yet. Please try again later.',
  wechatLoginSuccess: 'Signed in',
  wechatLoginFailedSimple: 'Sign-in failed. Please try again later.',
  signInServiceNotReady: 'Sign-in service is not ready yet. Please try again later.',
  privacyAuthorizationRequired: 'You need to agree to the Privacy Protection Guide before signing in',
  privacyContractOpenFailed: 'Unable to open the Privacy Protection Guide',
  privacyContractUnavailable: 'The Privacy Protection Guide is unavailable in this environment',
  notNowLogin: 'Not now',
  loginFavoriteTitle: 'Sign in to save merchants',
  loginFavoriteContent: 'Sign in to save merchants you are interested in and view them later.',
  loginMerchantNoticeTitle: 'Sign in to view merchant notices',
  loginMerchantNoticeContent: 'Sign in to view merchant service notices and related conversation records.',
  loginProfileEditTitle: 'Please sign in',
  loginProfileEditContent: 'Sign in to edit your avatar, nickname, and profile.',
  browsingHistoryEmptyTitle: 'No browsing history',
  browsingHistoryEmptyHint: 'Merchants you viewed will appear here.',
  browsingHistoryGoHome: 'Go to Home',
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
  viewedAt: 'Last viewed',
  viewCount: 'Viewed {count} times',
  messagesSubtitle: 'View merchant notices and system notifications',
  merchantNoticesTab: 'Merchant notices',
  systemNoticesTab: 'System notifications',
  merchantNoticesDescription: 'View merchant service information and notices',
  systemNoticesDescription: 'View platform notices and system reminders',
  merchantServiceRecords: 'Merchant service records',
  openConversation: 'Contact merchant',
  viewConversation: 'View conversation',
  merchantConversationAvailable: 'Service records and conversations are available',
  completedViewRecordOnly: 'Completed, view record only',
  noMerchantNoticesTitle: 'No merchant notices yet',
  noMerchantNoticesHint: 'Merchant service information and notices will appear here.',
  noSystemNoticesTitle: 'No system notifications yet',
  noSystemNoticesHint: 'System notifications will appear here.',
  meNicknameFallback: 'WeChat User',
  mePhoneFallback: 'Phone not linked yet, tap to bind',
  profilePhoneInvalid: 'Please enter a valid phone number',
  locationSelectionFailed: 'Location failed. Please choose the delivery location again.',
  wechatProfileTitle: 'WeChat Profile',
  chooseAvatar: 'Choose avatar',
  nickname: 'Nickname',
  nicknamePlaceholder: 'Please enter nickname',
  saveProfile: 'Save Profile',
  wechatProfileSaved: 'Profile saved',
  profileSaveFailed: 'Save failed. Please try again later.',
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
  cancel: 'Cancel',
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
  merchantUnavailable: 'This merchant is hidden or no longer available',
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

export function localeLabel(current = locale.value) {
  return current === 'vi' ? 'Tiếng Việt' : current === 'en' ? 'English' : '中文';
}

const merchantNameFallbacks: Record<string, { vi?: string; en?: string }> = {
  '川味小馆（云中店）': {
    vi: 'Nhà hàng Tứ Xuyên (Chi nhánh Vân Trung)',
    en: 'Sichuan Bistro (Van Trung Branch)',
  },
  '川味小馆（北宁店）': {
    vi: 'Nhà hàng Tứ Xuyên (Chi nhánh Bắc Ninh)',
    en: 'Sichuan Bistro (Bac Ninh Branch)',
  },
  '农品香-湘菜馆': {
    vi: 'Nhà hàng Hương Nông - Ẩm thực Hồ Nam',
    en: 'Nongpinxiang Hunan Restaurant',
  },
};

const productNameFallbacks: Record<string, { vi?: string; en?: string }> = {
  水煮牛肉: {
    vi: 'Bò luộc cay Tứ Xuyên',
    en: 'Spicy Boiled Beef',
  },
  毛血旺: {
    vi: 'Mao Xue Wang',
    en: 'Mao Xue Wang',
  },
  回锅肉: {
    vi: 'Thịt heo xào hai lần',
    en: 'Twice-Cooked Pork',
  },
  辣子鸡: {
    vi: 'Gà xào ớt khô',
    en: 'Spicy Diced Chicken',
  },
  宫保鸡丁: {
    vi: 'Gà xào hạt điều kiểu Kung Pao',
    en: 'Kung Pao Chicken',
  },
  麻婆豆腐: {
    vi: 'Đậu phụ Mapo',
    en: 'Mapo Tofu',
  },
  水煮鱼片: {
    vi: 'Cá luộc cay Tứ Xuyên',
    en: 'Spicy Boiled Fish',
  },
};

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

type LocalizedRecord = LocalizedFields | Record<string, unknown> | null | undefined;

function readString(source: LocalizedRecord, keys: string[]) {
  if (!source) return '';
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function readNestedString(source: LocalizedRecord, localeKey: 'zh' | 'vi' | 'en') {
  if (!source) return '';
  const record = source as Record<string, unknown>;
  const localizedName = record.localizedName;
  if (localizedName && typeof localizedName === 'object' && localizedName !== null) {
    const value = (localizedName as Record<string, unknown>)[localeKey];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const translations = record.translations;
  if (translations && typeof translations === 'object' && translations !== null) {
    const localeBlock = (translations as Record<string, unknown>)[localeKey];
    if (localeBlock && typeof localeBlock === 'object' && localeBlock !== null) {
      const name = (localeBlock as Record<string, unknown>).name;
      if (typeof name === 'string' && name.trim()) return name.trim();
      const title = (localeBlock as Record<string, unknown>).title;
      if (typeof title === 'string' && title.trim()) return title.trim();
    }
  }
  return '';
}

function readNestedText(
  source: LocalizedRecord,
  localeKey: 'zh' | 'vi' | 'en',
  field: 'name' | 'title' | 'description',
) {
  if (!source) return '';
  const record = source as Record<string, unknown>;
  const localizedText = record.localizedText;
  if (localizedText && typeof localizedText === 'object' && localizedText !== null) {
    const value = (localizedText as Record<string, unknown>)[localeKey];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const translations = record.translations as LocalizedTranslationMap | undefined;
  const translationValue = translations?.[localeKey]?.[field];
  if (typeof translationValue === 'string' && translationValue.trim()) {
    return translationValue.trim();
  }
  return '';
}

function localizedField(
  item: LocalizedRecord,
  current = locale.value,
  fallbackMap?: Record<string, { vi?: string; en?: string }>,
) {
  const zhValue =
    readString(item, ['nameZh', 'zhName', 'name_zh', 'titleZh', 'title_zh']) ||
    readNestedString(item, 'zh') ||
    readString(item, ['name', 'title']);
  const viValue =
    readString(item, ['nameVi', 'viName', 'name_vi', 'titleVi', 'title_vi']) ||
    readNestedString(item, 'vi') ||
    fallbackMap?.[zhValue]?.vi ||
    '';
  const enValue =
    readString(item, ['nameEn', 'enName', 'name_en', 'titleEn', 'title_en']) ||
    readNestedString(item, 'en') ||
    fallbackMap?.[zhValue]?.en ||
    '';

  if (current === 'vi') return viValue || zhValue || enValue || '';
  if (current === 'en') return enValue || viValue || zhValue || '';
  return zhValue || viValue || enValue || '';
}

export function localizedName(item: LocalizedRecord, current = locale.value) {
  return localizedField(item, current);
}

export function localizedText(
  item: LocalizedRecord,
  current = locale.value,
  keys: string[] = [
    'descriptionZh',
    'descriptionVi',
    'descriptionEn',
    'description_zh',
    'description_vi',
    'description_en',
    'description',
  ],
) {
  const record = item as Record<string, unknown> | null | undefined;
  const zhKeys = keys.filter((key) => /Zh|_zh$/.test(key));
  const viKeys = keys.filter((key) => /Vi|_vi$/.test(key));
  const enKeys = keys.filter((key) => /En|_en$/.test(key));

  const zhValue =
    readString(record, zhKeys) ||
    readNestedText(record, 'zh', 'description') ||
    readString(record, ['description', 'title', 'name']);
  const viValue =
    readString(record, viKeys) ||
    readNestedText(record, 'vi', 'description') ||
    '';
  const enValue =
    readString(record, enKeys) ||
    readNestedText(record, 'en', 'description') ||
    '';

  if (current === 'vi') return viValue || enValue || zhValue || '';
  if (current === 'en') return enValue || viValue || zhValue || '';
  return zhValue || viValue || enValue || '';
}

export function merchantName(item: LocalizedRecord, current = locale.value) {
  return localizedField(item, current, merchantNameFallbacks);
}

export function orderMerchantName(item: LocalizedRecord, current = locale.value) {
  if (!item) return '';

  const record = item as Record<string, unknown>;
  const merchant = record.merchant;
  if (merchant && typeof merchant === 'object') {
    return merchantName(merchant as LocalizedRecord, current);
  }

  return localizedField(
    {
      nameZh:
        readString(record, ['merchantNameZhSnapshot', 'merchantNameZh']) ||
        readString(record, ['nameZh', 'zhName', 'name_zh']) ||
        readString(record, ['merchantName', 'name']),
      nameVi:
        readString(record, ['merchantNameViSnapshot', 'merchantNameVi']) ||
        readString(record, ['nameVi', 'viName', 'name_vi']),
      nameEn:
        readString(record, ['merchantNameEnSnapshot', 'merchantNameEn']) ||
        readString(record, ['nameEn', 'enName', 'name_en']),
      localizedName: record.localizedName,
      translations: record.translations,
    },
    current,
    merchantNameFallbacks,
  );
}

export function categoryName(
  item: LocalizedRecord,
  current = locale.value,
) {
  return merchantName(item, current);
}

export function productName(
  item: LocalizedRecord,
  current = locale.value,
) {
  return localizedField(item, current, productNameFallbacks);
}

export function productSubtitle(
  item: LocalizedRecord,
  current = locale.value,
) {
  const zhValue = localizedField(item, 'zh', productNameFallbacks);
  const viValue = localizedField(item, 'vi', productNameFallbacks);
  const enValue = localizedField(item, 'en', productNameFallbacks);

  if (current === 'zh') return viValue || '';
  if (current === 'vi') return zhValue || '';
  return zhValue || viValue || '';
}

export function productSnapshotName(
  snapshot:
    | string
    | {
        productNameZhSnapshot?: string;
        productNameViSnapshot?: string;
        productNameEnSnapshot?: string;
      },
  current = locale.value,
) {
  if (typeof snapshot === 'string') {
    return localizedField({ nameZh: snapshot }, current, productNameFallbacks);
  }

  return localizedField(
    {
      nameZh: snapshot?.productNameZhSnapshot || '',
      nameVi: snapshot?.productNameViSnapshot || '',
      nameEn: snapshot?.productNameEnSnapshot || '',
    },
    current,
    productNameFallbacks,
  );
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
