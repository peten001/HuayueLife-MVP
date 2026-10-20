import type { DeliveryCoordinate } from '@huayue-life/shared';

export interface DeliveryLocationSelection {
  address: string;
  coordinate: DeliveryCoordinate;
  coordinateSystem: 'WGS84';
}

export interface DeliveryLocationInitial {
  address: string;
  coordinate: DeliveryCoordinate | null;
  fallbackCoordinate: DeliveryCoordinate;
}

export function chooseDeliveryLocation(initial: DeliveryLocationInitial): Promise<DeliveryLocationSelection | null> {
  return new Promise((resolve, reject) => {
    uni.navigateTo({
      url: '/pages/checkout/delivery-location',
      events: {
        deliveryLocationSelected: (selection: DeliveryLocationSelection) => resolve(selection),
        deliveryLocationCancelled: () => resolve(null),
      },
      success: ({ eventChannel }) => eventChannel.emit('deliveryLocationInitial', initial),
      fail: reject,
    });
  });
}


const labels = {
  zh: {
    title: '选择收餐位置', search: '搜索地址 / 地点', satellite: '卫星图', normal: '地图',
    hint: '放大地图，将指针对准能收餐的位置', locate: '定位', loading: '正在加载地图',
    coverageHint: '若无卫星影像，可切换“地图”选点',
    address: '补充收餐地址', placeholder: '补充门牌、楼栋或园区入口，方便交餐', coordinate: '定位坐标',
    confirm: '确认收餐位置', confirming: '正在确认位置…',
    readFailed: '暂时无法读取位置，请移动地图后重试',
    locateFailed: '未能定位，可拖动地图或搜索地址选点', searchFailed: '地点搜索未成功，请稍后重试',
    addressTooLong: '地址过长，请精简文字后重试', chooseFailed: '无法打开地图，请稍后重试',
    selected: '已选择收餐点，可补充门牌或楼栋',
  },
  vi: {
    title: 'Chọn điểm nhận món', search: 'Tìm địa chỉ / địa điểm', satellite: 'Vệ tinh', normal: 'Bản đồ',
    hint: 'Phóng to bản đồ, đặt ghim tại nơi bạn có thể nhận món', locate: 'Định vị', loading: 'Đang tải bản đồ',
    coverageHint: 'Nếu không có ảnh vệ tinh, hãy chuyển sang “Bản đồ”',
    address: 'Bổ sung địa chỉ nhận món', placeholder: 'Thêm số nhà, tòa nhà hoặc cổng để dễ giao món', coordinate: 'Tọa độ',
    confirm: 'Xác nhận điểm nhận món', confirming: 'Đang xác nhận vị trí…',
    readFailed: 'Chưa đọc được vị trí. Hãy di chuyển bản đồ rồi thử lại',
    locateFailed: 'Chưa định vị được. Bạn có thể kéo bản đồ hoặc tìm địa chỉ', searchFailed: 'Chưa tìm được địa điểm. Vui lòng thử lại',
    addressTooLong: 'Địa chỉ quá dài. Vui lòng rút gọn rồi thử lại', chooseFailed: 'Chưa mở được bản đồ. Vui lòng thử lại',
    selected: 'Đã chọn điểm nhận món. Có thể thêm số nhà hoặc tòa nhà',
  },
  en: {
    title: 'Choose delivery point', search: 'Search address / place', satellite: 'Satellite', normal: 'Map',
    hint: 'Zoom in and place the pin where you can receive your food', locate: 'Locate', loading: 'Loading map',
    coverageHint: 'If imagery is unavailable, switch to Map',
    address: 'Add delivery details', placeholder: 'Add a house number, building or gate to help with delivery', coordinate: 'Coordinates',
    confirm: 'Confirm delivery point', confirming: 'Confirming location…',
    readFailed: 'Location could not be read. Move the map and try again',
    locateFailed: 'Location unavailable. Drag the map or search for an address', searchFailed: 'Place search failed. Please try again',
    addressTooLong: 'The address is too long. Please shorten it and try again', chooseFailed: 'Map could not be opened. Please try again',
    selected: 'Delivery point selected. You can add a house or building number',
  },
};

export function deliveryLocationText(locale: string, key: keyof typeof labels.zh) {
  return labels[locale as keyof typeof labels]?.[key] ?? labels.zh[key];
}
