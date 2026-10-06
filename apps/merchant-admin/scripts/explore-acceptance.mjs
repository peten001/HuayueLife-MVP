// Frontend acceptance adapter: all writes stay in memory; no production proxy.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
process.env.VITE_API_BASE_URL = '/__explore_fixture/api/v1';
let categories = [], topics = [], types = [], items = [];
let failNextRead = false;
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#d9c6af"/><text x="320" y="180" font-size="30" text-anchor="middle" fill="#435247">本地隔离图片</text></svg>');
function respond(path, method, body) {
  if (path === '/platform/merchant-types') return { items: types };
  if (path === '/platform/promotion-tags') return { items: [{ id: '1', code: 'FEATURED', nameZh: '首页推荐', scope: 'OPERATIONAL', enabled: true, merchantCount: 0 }, { id: '2', code: 'RELAX', nameZh: '放松休闲', scope: 'SCENE', enabled: true }] };
  if (path === '/platform/capabilities') return { items: [] };
  if (path === '/platform/settings') return { platformOrderingEnabled: false, source: 'database', readOnly: false };
  if (path === '/platform/explore/initialize') return { businessTypesCreated: 0, settingsCreated: 0 };
  if (path === '/platform/explore/categories') {
    if (method === 'PUT') { const index = categories.findIndex(item => item.code === body.code); if (index < 0) categories.push(body); else categories[index] = body; }
    return method === 'GET' ? categories.toSorted((a,b) => a.sortOrder - b.sortOrder) : body;
  }
  if (path === '/platform/explore/topics') {
    if (method === 'PUT') { const index = topics.findIndex(item => item.code === body.code); if (index < 0) topics.push(body); else topics[index] = body; }
    return method === 'GET' ? topics.toSorted((a,b) => a.sortOrder - b.sortOrder) : body;
  }
  if (path.startsWith('/platform/explore/topics/') && method === 'DELETE') { topics = topics.filter(item => item.code !== path.split('/').pop()); return { deleted: true }; }
  if (path === '/platform/uploads/merchant-image') return { imageUrl: image };
  if (path === '/platform/merchants/1/detail') return {
    merchant: { id: '1', name: '服务商家 · 隔离验收', nameZh: '服务商家 · 隔离验收', nameVi: 'Dịch vụ thử nghiệm', nameEn: 'Acceptance service merchant', businessType: types.find(item => item.code === 'MASSAGE_SPA'), contentTemplate: 'SERVICE', merchantMode: 'DISPLAY', claimStatus: 'UNCLAIMED', account: '', phone: '', contactName: '', province: '北江', city: '北江', address: '隔离测试地址', addressZh: '隔离测试地址', latitude: '21.28', longitude: '106.19', businessHours: {}, status: 'ACTIVE', isActive: true, homepageCategoryKeys: [], manualPopular: false, isVisibleOnClient: true, reportFeatureEnabled: false, printingEnabled: false, dineInEnabled: false, promotionTags: [], capabilities: [], images: [], sortOrder: 0, isNew: false, profileCompletion: 80, createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-04T00:00:00Z' },
    metrics: { todayOrderCount:0,todayOrderAmount:'0',pendingAcceptanceOrderCount:0,preparingOrderCount:0,last7DaysOrderCount:0,last7DaysOrderAmount:'0',completedOrderCount:0,canceledOrderCount:0,completionRate:null,averageOrderAmount:null,lastOrderAt:null }, trend: [], operation: { menuCategoryCount:0,dishCount:0,activeDishCount:0,tableCount:0,activeTableCount:0 }, printingSummary: { enabled:false,printerCount:0,onlinePrinterCount:0,todayPrintJobCount:0,failedPrintJobCount:0 }, recentOrders: [],
  };
  if (path.startsWith('/platform/merchants/1/service-items')) {
    const id = path.split('/')[5];
    if (method === 'GET') return { items: items.toSorted((a,b) => a.sortOrder - b.sortOrder) };
    if (method === 'POST') { const item = { ...body, id: String(Date.now()) }; items.push(item); return item; }
    if (method === 'PUT') { const index = items.findIndex(item => item.id === id); if (index < 0) throw new Error('项目不存在'); items[index] = { ...body, id }; return items[index]; }
    if (method === 'DELETE') { items = items.filter(item => item.id !== id); return { deleted: true }; }
  }
  throw new Error('本地隔离预览不支持此操作');
}
const server = await createServer({ root, mode: 'explore-acceptance', server: { host: '127.0.0.1', port:4201, strictPort:true }, plugins:[{
  name:'explore-isolated-acceptance',
  transformIndexHtml(html) { return html.replace('</head>', '<script>addEventListener("error",e=>{const p=document.createElement("pre");p.id="fixture-error";p.textContent=e.message;document.body.appendChild(p)});localStorage.setItem("huayue_platform_token","ISOLATED_UI_ONLY");localStorage.setItem("huayue_platform_admin",JSON.stringify({id:"0",username:"LOCAL_ADMIN",name:"本地隔离管理员"}));</script></head>').replace('<body>', '<body><div style="padding:8px;background:#fff5d8;text-align:center;font:12px/1.5 system-ui">本地隔离验收 · 示例数据 · 不连接生产 · 保存仅在服务内存</div>'); },
  configureServer(vite) { vite.middlewares.use(async (req,res,next) => {
    if (!req.url?.startsWith('/__explore_fixture/api/v1/')) return next();
    const path = new URL(req.url,'http://fixture').pathname.replace('/__explore_fixture/api/v1','');
    res.setHeader('Content-Type','application/json; charset=utf-8');
    if (req.method === 'GET' && failNextRead && (path === '/platform/explore/categories' || path.endsWith('/service-items'))) { failNextRead = false; res.statusCode=503; res.end(JSON.stringify({code:'LOCAL_ONLY',message:'隔离测试：列表回读失败'})); return; }
    if (['PUT','POST'].includes(req.method) && req.headers.referer?.includes('readback=fail')) failNextRead = true;
    try { let raw=''; for await (const chunk of req) { raw+=chunk; if(raw.length>6e6) throw new Error('请求过大'); } const body=path.includes('/uploads/') ? {} : raw ? JSON.parse(raw) : {}; res.end(JSON.stringify({code:'OK', data:respond(path,req.method,body)})); }
    catch(error) { res.statusCode=400; res.end(JSON.stringify({code:'LOCAL_ONLY',message:error.message})); }
  }); }
}] });
const content = await server.ssrLoadModule('/@fs/' + fileURLToPath(new URL('../../api/src/modules/explore/explore-content.ts', import.meta.url)));
categories = JSON.parse(JSON.stringify(content.DEFAULT_EXPLORE_CATEGORIES));
types = [...new Set(categories.flatMap(item => item.businessTypeCodes))].map((code,index) => ({ id:String(index+1),code,nameZh:categories.find(item => item.businessTypeCodes.includes(code)).nameZh,enabled:true,showOnHome:false,sortOrder:index,level:1,defaultMerchantMode:'DISPLAY',defaultCapabilities:{} }));
topics = [{ code:'after-work',nameZh:'下班放松一下',subtitleZh:'给自己一点放松时光',imageUrl:image,regions:[],categoryCode:'massage',sortOrder:0,enabled:true }];
items = [{ id:'1',nameZh:'足部放松',descriptionZh:'隔离验收项目',imageUrl:image,durationMinutes:60,priceMode:'INQUIRY',amountVnd:null,sortOrder:10,isVisible:true }];
await server.listen(); console.log('Isolated Platform acceptance: http://localhost:4201/platform/explore');
