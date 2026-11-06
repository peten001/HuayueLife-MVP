import ExcelJS = require('exceljs');
import { PlatformMerchantsService } from './platform-merchants.service';
async function fixture(){
 const workbook=new ExcelJS.Workbook();const sheet=workbook.addWorksheet('Import');sheet.addRow(['门店名称','', '所在城市']);sheet.addRow(['仅有名称和城市','忽略的空表头列','北宁']);
 const buffer=Buffer.from(await workbook.xlsx.writeBuffer());const tx={merchant:{findMany:jest.fn().mockResolvedValue([]),findUnique:jest.fn()},merchantBusinessType:{findMany:jest.fn().mockResolvedValue([])}};
 const service=new PlatformMerchantsService(tx as never,{ensureDefaults:jest.fn()} as never,{} as never,{} as never,{} as never);
 return {service,file:{buffer,mimetype:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',originalname:'test.xlsx',size:buffer.byteLength}};
}
describe('Platform mapped draft import',()=>{
 it('maps custom headers without shifting a blank column and accepts name + city',async()=>{const h=await fixture();const preview=await h.service.previewMerchantImport(h.file);const mapped=await h.service.reviseMerchantImport({sessionId:preview.sessionId,mapping:{nameZh:'门店名称',province:'所在城市'}});expect(mapped.rows[0].normalizedData).toMatchObject({nameZh:'仅有名称和城市',province:'北宁'});expect(mapped.rows[0].errors).toEqual([]);});
 it('does not create duplicate merchants on a repeated confirmation',async()=>{const h=await fixture();const p=await h.service.previewMerchantImport(h.file);await h.service.reviseMerchantImport({sessionId:p.sessionId,mapping:{nameZh:'门店名称',province:'所在城市'}});const create=jest.spyOn(h.service,'createDisplayMerchant').mockResolvedValue({id:'7'} as never);const first=await h.service.confirmMerchantImport({sessionId:p.sessionId,rowNumbers:[2]});const again=await h.service.confirmMerchantImport({sessionId:p.sessionId,rowNumbers:[2]});expect(first.createdMerchantIds).toEqual(['7']);expect(again.createdMerchantIds).toEqual(['7']);expect(create).toHaveBeenCalledTimes(1);expect(create).toHaveBeenCalledWith(expect.objectContaining({isVisibleOnClient:false,status:'PENDING'}));});
});
