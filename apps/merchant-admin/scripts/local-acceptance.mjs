import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { createAcceptanceState } from './local-acceptance-fixtures.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const state=createAcceptanceState();
process.env.VITE_API_BASE_URL='/__local/api/v1';
const server=await createServer({root,mode:'local-acceptance',cacheDir:'node_modules/.vite-local-acceptance',server:{host:'0.0.0.0',port:4198,strictPort:true},plugins:[{
 name:'isolated-merchant-acceptance',
 transformIndexHtml(html){return html.replace('</head>',`<script>/* LAN HTTP preview only; production still uses native secure-context crypto. */if(!crypto.randomUUID)crypto.randomUUID=()=>{const a=crypto.getRandomValues(new Uint8Array(16));a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;const h=Array.from(a,b=>b.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);};localStorage.setItem('huayue_merchant_token','LOCAL_UI_ONLY');localStorage.setItem('huayue_merchant_staff',JSON.stringify(${JSON.stringify(state.staff)}));</script></head>`).replace('<body>',`<body><div id="local-acceptance-notice" style="padding:8px 14px;background:#fff5d8;color:#5c4210;font:12px/1.5 system-ui;text-align:center;overflow-wrap:anywhere">本地隔离验收 · 示例数据 · 不连接生产 · 编辑仅保存在本次服务内存</div>`);},
 configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  if(req.url?.startsWith('/__local/api/v1/src/assets/')){req.url=req.url.replace('/__local/api/v1','');return next();}
  if(!req.url?.startsWith('/__local/api/v1/'))return next();
  const url=new URL(req.url,'http://local');res.setHeader('Content-Type','application/json; charset=utf-8');
  try{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2e6)throw new Error('本地请求过大');}const body=raw?JSON.parse(raw):{};const role=['OWNER','MANAGER','STAFF'].includes(req.headers['x-local-role'])?req.headers['x-local-role']:'OWNER';const data=state.respond(url.pathname.replace('/__local/api/v1',''),url.searchParams,req.method,body,role);res.end(JSON.stringify({code:'OK',data}));}
  catch(error){res.statusCode=400;res.end(JSON.stringify({code:'LOCAL_ONLY',message:error.message}));}
 });}
}]});
await server.listen();
console.log('Local isolated acceptance: http://localhost:4198/dashboard');
for(const list of Object.values(networkInterfaces()))for(const item of list||[])if(item.family==='IPv4'&&!item.internal)console.log(`Phone on same Wi-Fi: http://${item.address}:4198/dashboard`);
console.log('No production proxy. Restart this process to reset sample edits.');
