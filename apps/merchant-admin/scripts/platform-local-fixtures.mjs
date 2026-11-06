// Isolated acceptance data. This module is never imported by application code.
export function createPlatformAcceptanceState() {
  const stamp = "2026-11-05T04:20:00.000Z";
  const admin = { username: "本地验收管理员" };
  let settings = { platformOrderingEnabled: true, readOnly: false };
  const types = [
    {
      id: "1",
      code: "CHINESE_RESTAURANT",
      nameZh: "中式餐饮",
      nameVi: "Ẩm thực Trung Hoa",
      nameEn: "Chinese dining",
      enabled: true,
      parentId: null,
      level: 1,
      sortOrder: 10,
      showOnHome: true,
      defaultMerchantMode: "DISPLAY",
      defaultCapabilities: {},
    },
    {
      id: "2",
      code: "COFFEE_TEA",
      nameZh: "咖啡茶饮",
      nameVi: "Cà phê và trà",
      enabled: true,
      level: 1,
      parentId: null,
      sortOrder: 20,
      showOnHome: true,
      defaultMerchantMode: "DISPLAY",
      defaultCapabilities: {},
    },
  ];
  types.push({
    id: "3",
    code: "HOTEL",
    nameZh: "酒店",
    nameVi: "Khách sạn",
    nameEn: "Hotel",
    contentTemplate: "HOTEL",
    enabled: true,
    level: 1,
    parentId: null,
    sortOrder: 30,
    defaultMerchantMode: "DISPLAY",
    defaultCapabilities: {},
  });
  const capabilities = [
    ["phoneEnabled", "联系电话", "DISPLAY", "展示能力"],
    ["navigationEnabled", "地图导航", "DISPLAY", "展示能力"],
    ["imageGalleryEnabled", "图片相册", "DISPLAY", "展示能力"],
    ["dineInEnabled", "堂食", "ORDER", "经营能力"],
    ["pickupEnabled", "到店自取", "ORDER", "经营能力"],
    ["deliveryEnabled", "商家配送", "ORDER", "经营能力"],
    ["qrOrderEnabled", "扫码点餐", "ORDER", "经营能力"],
    ["printerEnabled", "打印机", "PRINTING", "打印能力"],
  ].map(([code, nameZh, groupCode, groupNameZh], i) => ({
    id: String(i + 1),
    code,
    nameZh,
    groupCode,
    groupNameZh,
    enabled: true,
    defaultValue: false,
    sortOrder: i,
  }));
  const tags = [
    {
      id: "1",
      code: "FAMILY",
      nameZh: "亲子友好",
      nameVi: "Thân thiện với gia đình",
      nameEn: "Family friendly",
      scope: "SCENE",
      color: "#7961c8",
      enabled: true,
      sortOrder: 0,
      merchantReferenceCount: 3,
      reserved: false,
    },
    {
      id: "2",
      code: "SICHUAN",
      nameZh: "川菜",
      nameVi: "Ẩm thực Tứ Xuyên",
      scope: "CUISINE",
      color: "#416bd8",
      enabled: true,
      sortOrder: 1,
      merchantReferenceCount: 6,
      reserved: false,
    },
    {
      id: "3",
      code: "HOT_FOOD",
      nameZh: "热门推荐",
      nameVi: "Đề xuất nổi bật",
      scope: "OPERATIONAL",
      color: "#288f95",
      enabled: true,
      sortOrder: 2,
      merchantReferenceCount: 4,
      reserved: true,
    },
  ];
  const merchants = Array.from({ length: 26 }, (_, i) => ({
    id: String(i + 1),
    nameZh:
      ["本地验收 · 迎客餐厅", "本地验收 · 午后咖啡", "本地验收 · 小巷越餐"][
        i % 3
      ] + (i > 2 ? ` ${i + 1}` : ""),
    nameVi: ["Nhà hàng thử nghiệm", "Cà phê thử nghiệm", "Quán ăn thử nghiệm"][
      i % 3
    ],
    city: i % 3 ? "北宁" : "北江",
    province: i % 3 ? "北宁" : "北江",
    contactName: "本地验收联系人",
    contactPhone: "0900000000",
    addressZh: "本地示例地址",
    addressVi: "Địa chỉ thử nghiệm",
    descriptionZh: "本地隔离示例，不是线上商家",
    descriptionVi: "Dữ liệu thử nghiệm nội bộ",
    latitude: "21.1861",
    longitude: "106.0763",
    coverUrl: null,
    businessType: types[i % 2],
    businessTypeId: types[i % 2].id,
    status: i === 5 ? "PENDING" : "ACTIVE",
    isVisibleOnClient: i !== 5,
    claimStatus: i === 2 ? "CLAIMED" : "UNCLAIMED",
    updatedAt: stamp,
    createdAt: stamp,
    manualPopular: i < 4,
    homepageCategoryKeys: ["chinese_dining"],
    images: [],
    capabilities: capabilities.map((c) => ({
      ...c,
      isEnabled: c.groupCode === "DISPLAY",
    })),
    missing: i % 3 === 0 ? ["封面", "菜单或菜品"] : [],
    openingHoursText: "09:00-22:00",
    businessHours: { monday: ["09:00-22:00"] },
    merchantMode: "DISPLAY",
    account: "",
    phone: "0900000000",
    isActive: true,
    profileCompletion: 75,
    promotionTags: tags.slice(0, 1),
  }));
  const orders = Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 1),
    orderNo: `LOCAL20261105${String(i + 1).padStart(6, "0")}`,
    merchantId: merchants[i].id,
    merchantName: merchants[i].nameZh,
    merchantCity: merchants[i].city,
    orderType: ["DINE_IN", "PICKUP", "DELIVERY"][i % 3],
    status:
      i === 2 ? "CANCELLED" : i === 3 ? "PENDING_ACCEPTANCE" : "COMPLETED",
    totalAmount: String(125000 + i * 75000),
    contactName: "本地测试顾客",
    contactPhone: "0900000000",
    createdAt: stamp,
    completedAt: stamp,
    items: [
      {
        id: "1",
        productNameZhSnapshot: "本地示例菜品",
        unitPriceVnd: "125000",
        quantity: 1,
        subtotalVnd: "125000",
      },
    ],
    statusLogs: [
      {
        id: "1",
        toStatus: "COMPLETED",
        createdAt: stamp,
        operatorType: "SYSTEM",
      },
    ],
  }));
  const users = Array.from({ length: 6 }, (_, i) => ({
    id: String(i + 1),
    nickname: `本地测试用户 ${i + 1}`,
    phone: "0900000000",
    avatarUrl: null,
    city: "北宁",
    createdAt: stamp,
    lastLoginAt: stamp,
    orderCount: 3,
    orderAmount: "425000",
    completedOrderCount: 2,
    canceledOrderCount: 1,
    lastOrderAt: stamp,
  }));
  const reviews = Array.from({ length: 5 }, (_, i) => ({
    id: String(i + 1),
    source: "ORDER",
    rating: 4,
    content: "本地隔离验收评价：环境舒适，上菜及时。",
    isAnonymous: i % 2 === 0,
    status: i === 0 ? "PENDING_REVIEW" : i === 4 ? "HIDDEN" : "PUBLISHED",
    createdAt: stamp,
    updatedAt: stamp,
    merchant: { id: merchants[i].id, nameZh: merchants[i].nameZh },
    author: { id: users[i].id, nickname: users[i].nickname },
    order: {
      id: orders[i].id,
      orderNo: orders[i].orderNo,
      orderType: orders[i].orderType,
    },
    images: [],
    moderationChecks: [
      {
        id: "1",
        imageId: null,
        type: "LOCAL_TEXT",
        status: i === 0 ? "REVIEW" : "PASS",
        reasonCodes: [],
        providerLabel: null,
        providerTraceId: null,
        errorCode: null,
        createdAt: stamp,
        updatedAt: stamp,
      },
    ],
    moderationActions: [],
  }));
  let content = {
    categories: [
      {
        code: "food",
        nameZh: "美食餐饮",
        nameVi: "Ẩm thực",
        nameEn: "Dining",
        iconKey: "food",
        sortOrder: 10,
        enabled: true,
        businessTypeCodes: ["CHINESE_RESTAURANT"],
        legacyKeys: ["chinese_dining"],
      },
    ],
    topics: [
      {
        code: "after-work",
        nameZh: "下班放松一下",
        nameVi: "Thư giãn sau giờ làm",
        subtitleZh: "探索附近好店",
        enabled: false,
        regions: [],
        sortOrder: 1,
      },
    ],
    tags: structuredClone(tags),
    recommendations: merchants.map((m) => ({
      merchantId: m.id,
      manualPopular: m.manualPopular,
      homepageCategoryKeys: m.homepageCategoryKeys,
    })),
    version: 0,
    baseRevision: "LOCAL_CONTENT",
    merchants,
    hasDraft: false,
  };
  const drafts = new Map();
  let trash = [
    { id: "99", nameZh: "本地已删除商家", city: "北宁", updatedAt: stamp },
  ];
  let selection = [];
  let uploaded = 0;
  const getDraft = (id) =>
    drafts.get(id) || {
      profile: structuredClone(
        merchants.find((m) => m.id === id) || merchants[0],
      ),
      images: [],
      tagIds: ["1"],
      signatureDishes:
        id === "3"
          ? [
              {
                id: "100",
                nameZh: "认领前的独立记录",
                imageUrl: "/uploads/platform-preview-0.png",
                sortOrder: 0,
                isVisible: true,
              },
            ]
          : [],
      serviceItems: [],
      claimStatus: id === "3" ? "CLAIMED" : "UNCLAIMED",
      contentCounts: { menu: id === "3" ? 2 : 0, services: 0 },
      version: 0,
      baseRevision: "LOCAL_REVISION",
      currentlyVisible: true,
      hasDraft: false,
      missing: ["封面", "菜单或菜品"],
    };
  return {
    admin,
    respond(path, q, method, body) {
      if (path === "/platform/uploads/merchant-image")
        return { imageUrl: `/uploads/platform-preview-${++uploaded}.png` };
      if (path === "/platform/auth/login")
        return { accessToken: "LOCAL_PLATFORM_UI_ONLY", admin };
      if (path === "/platform/settings") {
        if (method === "PATCH") settings = { ...settings, ...body };
        return settings;
      }
      if (path === "/platform/workbench/health")
        return {
          api: "ok",
          database: "ok",
          checkedAt: new Date().toISOString(),
        };
      if (path === "/platform/workbench/queue")
        return {
          items: [
            {
              label: "长时间未接单",
              count: 2,
              path: "/platform/orders?status=PENDING_ACCEPTANCE",
            },
            {
              label: "待审核评价",
              count: 1,
              path: "/platform/reviews?status=PENDING_REVIEW",
            },
            {
              label: "待完善商家",
              count: 8,
              path: "/platform/merchants?incomplete=1",
            },
          ],
        };
      if (path === "/platform/workbench/search")
        return {
          items: [
            {
              id: "1",
              kind: "商家",
              label: merchants[0].nameZh,
              detail: merchants[0].city,
              path: "/platform/merchants?quick=1",
            },
          ],
        };
      if (path === "/platform/workbench/directory") {
        let rows = merchants.filter(
          (m) =>
            (!q.get("keyword") || m.nameZh.includes(q.get("keyword"))) &&
            (!q.get("city") || m.city === q.get("city")) &&
            (!q.get("view") || q.get("view") === "incomplete"
              ? q.get("view") !== "incomplete" || m.missing.length
              : true),
        );
        const page = Number(q.get("page") || 1);
        return {
          items: rows
            .slice((page - 1) * 20, page * 20)
            .map((m) => ({ ...m, businessType: m.businessType.nameZh })),
          total: rows.length,
          page,
          pageSize: 20,
        };
      }
      if (path === "/platform/workbench/selection") {
        selection = merchants.map((m) => m.id);
        return { token: "LOCAL_SELECTION", total: selection.length };
      }
      if (path === "/platform/workbench/bulk")
        return {
          results: (body.ids || selection).map((id) => ({ id, ok: true })),
        };
      if (path === "/platform/workbench/trash") return { items: trash };
      if (/^\/platform\/workbench\/trash\/\d+\/restore$/.test(path)) {
        trash = [];
        return { id: "99", isVisibleOnClient: false };
      }
      if (path === "/platform/workbench/merchant-drafts") {
        const id = String(merchants.length + 1);
        merchants.push({
          ...structuredClone(merchants[0]),
          id,
          nameZh: body.nameZh,
          city: body.city,
          status: "PENDING",
          isVisibleOnClient: false,
        });
        return { id };
      }
      if (
        /^\/platform\/workbench\/merchants\/\d+\/(draft|publish|quick)$/.test(
          path,
        )
      ) {
        const id = path.split("/")[4];
        if (method === "GET")
          return path.endsWith("/quick")
            ? {
                ...merchants.find((m) => m.id === id),
                businessType: "中式餐饮",
              }
            : getDraft(id);
        drafts.set(id, {
          ...body,
          version: body.version + 1,
          savedAt: new Date().toISOString(),
          hasDraft: true,
        });
        return path.endsWith("/publish") ? { published: true } : getDraft(id);
      }
      if (/^\/platform\/workbench\/tags\/\d+\/impact$/.test(path))
        return { total: 3, items: merchants.slice(0, 3) };
      if (path === "/platform/merchant-types") return { items: types };
      if (path === "/platform/promotion-tags") return { items: tags };
      if (path === "/platform/capabilities") return { items: capabilities };
      if (path === "/platform/content/draft") {
        const existing = new Set(
          content.recommendations.map((rec) => rec.merchantId),
        );
        content.recommendations.push(
          ...merchants
            .filter((m) => !existing.has(m.id))
            .map((m) => ({
              merchantId: m.id,
              manualPopular: m.manualPopular,
              homepageCategoryKeys: m.homepageCategoryKeys,
            })),
        );
        if (method === "PUT")
          content = {
            ...content,
            ...body,
            version: body.version + 1,
            savedAt: stamp,
            hasDraft: true,
          };
        return content;
      }
      if (path === "/platform/content/preview")
        return {
          previewToken: "LOCAL_PREVIEW",
          city: body.city,
          at: body.at,
          categories: body.draft.categories,
          topics: [],
          notice: "本地隔离示例预览，不连接生产。",
          recommendations: {
            period: { nameZh: "午餐时间" },
            spotlights: [{ kind: "FOOD", merchant: merchants[0], photos: [] }],
            scenes: [],
          },
        };
      if (path === "/platform/content/publish") {
        content = {
          ...content,
          ...body,
          version: 0,
          hasDraft: false,
          savedAt: null,
        };
        return { published: true };
      }
      if (path === "/platform/analytics") {
        const from = q.get("dateFrom") || "2026-11-05";
        const to = q.get("dateTo") || from;
        const start = new Date(`${from}T00:00:00Z`);
        const days =
          Math.round((new Date(`${to}T00:00:00Z`) - start) / 86400000) + 1;
        const trend = Array.from({ length: Math.min(days, 366) }, (_, i) => ({
          date: new Date(+start + i * 86400000).toISOString().slice(0, 10),
          orderCount: 18 + i * 3,
          orderAmount: String(i === 1 ? 0 : 12500000 + i * 1800000),
        }));
        const previous = trend.map((r) => ({
          ...r,
          date: new Date(Date.parse(r.date) - days * 86400000)
            .toISOString()
            .slice(0, 10),
          orderCount: Math.max(0, r.orderCount - 4),
          orderAmount: String(Math.round(Number(r.orderAmount) * 0.86)),
        }));
        const chartTrend =
          days === 1
            ? Array.from({ length: 24 }, (_, h) => ({
                date: `${from}T${String(h).padStart(2, "0")}:00:00+07:00`,
                orderCount:
                  h > 20
                    ? null
                    : [
                        0, 0, 0, 0, 0, 0, 2, 3, 5, 2, 6, 10, 14, 7, 4, 3, 6, 9,
                        12, 8, 2,
                      ][h],
                orderAmount:
                  h > 20
                    ? null
                    : String(
                        [
                          0, 0, 0, 0, 0, 0, 250000, 450000, 750000, 600000,
                          900000, 1500000, 2100000, 1250000, 500000, 350000,
                          800000, 1200000, 1600000, 1000000, 250000,
                        ][h],
                      ),
              }))
            : undefined;
        return {
          chartTrend,
          range: { dateFrom: from, dateTo: to, includesToday: true },
          previous: {
            dateFrom: previous[0].date,
            dateTo: previous.at(-1).date,
            orderCount: previous.reduce((s, r) => s + r.orderCount, 0),
            orderAmount: previous
              .reduce((s, r) => s + BigInt(r.orderAmount), 0n)
              .toString(),
            trend: previous,
            chartTrend: chartTrend?.map((r) => ({
              ...r,
              date: r.date.replace(from, previous[0].date),
              orderCount:
                r.orderCount === null ? 2 : Math.max(0, r.orderCount - 2),
              orderAmount:
                r.orderAmount === null
                  ? "200000"
                  : String(Math.round(Number(r.orderAmount) * 0.8)),
            })),
          },
          summary: {
            orderCount: trend.reduce((s, r) => s + r.orderCount, 0),
            orderAmount: trend
              .reduce((s, r) => s + BigInt(r.orderAmount), 0n)
              .toString(),
            completedOrderCount: 18,
            pendingOrderCount: 2,
            canceledOrderCount: 1,
            activeOrderAmount: "2250000",
            canceledOrderAmount: "175000",
            averageOrderAmount: "320000",
            completionRate: 90,
            cancelRate: 4.8,
          },
          trend,
          orderTypeDistribution: ["DINE_IN", "PICKUP", "DELIVERY"].map(
            (type, i) => ({
              type,
              count: [12, 5, 4][i],
              amount: String([7600000, 2800000, 2100000][i]),
            }),
          ),
          statusDistribution: [],
          merchantRankingByOrders: merchants.slice(0, 5).map((m, i) => ({
            merchantId: m.id,
            merchantName: m.nameZh,
            city: m.city,
            orderCount: 18 - i * 2,
            orderAmount: String(4500000 - i * 550000),
          })),
          merchantRankingByAmount: merchants.slice(0, 5).map((m, i) => ({
            merchantId: m.id,
            merchantName: m.nameZh,
            city: m.city,
            orderCount: 18 - i * 2,
            orderAmount: String(4500000 - i * 550000),
          })),
          cityStats: [
            {
              city: "北宁",
              orderCount: 15,
              orderAmount: "9250000",
              merchantCount: 8,
            },
            {
              city: "北江",
              orderCount: 6,
              orderAmount: "3250000",
              merchantCount: 4,
            },
          ],
        };
      }
      if (path === "/platform/merchants") return { items: merchants };
      if (/^\/platform\/merchants\/\d+\/detail$/.test(path)) {
        const m =
          merchants.find((m) => m.id === path.split("/")[3]) || merchants[0];
        return {
          merchant: { ...m, contentTemplate: "RESTAURANT" },
          metrics: {},
          trend: [],
          operation: {},
          printingSummary: {
            capabilityEnabled: false,
            configurationState: "NOT_CONFIGURED",
            connectionState: "UNKNOWN",
            automaticPrintingEnabled: false,
            lastReportedAt: null,
            lastConnectedAt: null,
          },
          recentOrders: [],
        };
      }
      if (/^\/platform\/merchants\/\d+\/signature-dishes$/.test(path))
        return { items: [] };
      if (path.startsWith("/platform/merchants/") && method === "PATCH")
        return merchants[0];
      if (path === "/platform/orders") {
        const items = orders.filter(
          (o) =>
            (!q.get("status") || o.status === q.get("status")) &&
            (!q.get("orderNo") || o.orderNo === q.get("orderNo")) &&
            (!q.get("merchantId") || o.merchantId === q.get("merchantId")),
        );
        return {
          items,
          total: items.length,
          page: 1,
          pageSize: 20,
          summary: {
            todayOrderCount: 12,
            pendingOrderCount: 1,
            completedRate: 90,
            todayOrderAmount: "4500000",
          },
        };
      }
      if (path === "/platform/users")
        return {
          items: users,
          total: users.length,
          page: 1,
          pageSize: 20,
          summary: {
            userCount: 6,
            boundPhoneUserCount: 6,
            todayNewUserCount: 1,
            orderUserCount: 6,
          },
        };
      if (/^\/platform\/users\/\d+$/.test(path)) {
        const user = users.find((u) => u.id === path.split("/")[3]) || users[0];
        return {
          user,
          metrics: { ...user, averageOrderAmount: "212500" },
          recentOrders: orders.slice(0, 3),
        };
      }
      if (path === "/platform/reviews") {
        const items = reviews.filter(
          (r) => !q.get("status") || r.status === q.get("status"),
        );
        return {
          items,
          total: items.length,
          page: 1,
          pageSize: 20,
          summary: { pending: 1, published: 3, hidden: 1, risk: 1 },
        };
      }
      if (/^\/platform\/reviews\/\d+\//.test(path)) {
        const row = reviews.find((r) => r.id === path.split("/")[3]);
        const action = path.split("/")[4];
        const previous = row.status;
        row.status = action === "hide" ? "HIDDEN" : "PUBLISHED";
        row.moderationActions.unshift({
          id: String(Date.now()),
          action: action.toUpperCase(),
          fromStatus: previous,
          toStatus: row.status,
          actorUsername: admin.username,
          reasonCode: body.reasonCode,
          reasonNote: body.reasonNote,
          createdAt: stamp,
        });
        return row;
      }
      throw new Error(`Local fixture has no route: ${method} ${path}`);
    },
  };
}
