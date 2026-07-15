type MerchantImportTemplateFieldConfig = {
  key:
    | 'nameZh'
    | 'nameVi'
    | 'nameEn'
    | 'businessType'
    | 'contactPhone'
    | 'contactName'
    | 'province'
    | 'addressZh'
    | 'latitude'
    | 'longitude'
    | 'coverPath'
    | '营业时间';
  label: string;
  required: boolean;
  description: string;
  format: string;
  correctExample: string;
  wrongExample: string;
  textFormat?: boolean;
  decimalFormat?: string;
  optionKey?: 'businessType';
};

export const MERCHANT_IMPORT_TEMPLATE_FIELDS = [
  {
    key: 'nameZh',
    label: '中文店名',
    required: true,
    description: '商家的中文显示名称',
    format: '文本，2-120 字符',
    correctExample: '688便利店',
    wrongExample: '空白',
    textFormat: true,
  },
  {
    key: 'nameVi',
    label: '越南语店名',
    required: true,
    description: '商家的越南语显示名称',
    format: '文本，2-120 字符',
    correctExample: 'Cua hang tien loi 688',
    wrongExample: '空白',
    textFormat: true,
  },
  {
    key: 'nameEn',
    label: '英文店名',
    required: true,
    description: '商家的英文显示名称',
    format: '文本，2-120 字符',
    correctExample: '688 Convenience Store',
    wrongExample: '空白',
    textFormat: true,
  },
  {
    key: 'businessType',
    label: '商家类型',
    required: true,
    description: '必须填写系统允许的业务类型编码',
    format: '固定枚举',
    correctExample: 'CONVENIENCE_STORE',
    wrongExample: '便利店',
    textFormat: true,
    optionKey: 'businessType',
  },
  {
    key: 'contactPhone',
    label: '联系电话',
    required: true,
    description: '商家联系电话，按文本填写，避免科学计数法和前导 0 丢失',
    format: '文本，1-32 字符',
    correctExample: '0333520688',
    wrongExample: '3.33521E+9',
    textFormat: true,
  },
  {
    key: 'contactName',
    label: '联系人',
    required: true,
    description: '商家联系人姓名',
    format: '文本，1-64 字符',
    correctExample: 'Nguyen Van A',
    wrongExample: '*',
    textFormat: true,
  },
  {
    key: 'province',
    label: '省/直辖市',
    required: true,
    description: '商家所在省或直辖市名称',
    format: '文本，1-80 字符',
    correctExample: 'Bac Giang',
    wrongExample: '空白',
    textFormat: true,
  },
  {
    key: 'addressZh',
    label: '中文详细地址',
    required: true,
    description: '商家的中文详细地址',
    format: '文本，1-255 字符',
    correctExample: '北江省越安县云中工业区商业街18号',
    wrongExample: '空白',
    textFormat: true,
  },
  {
    key: 'latitude',
    label: '纬度',
    required: true,
    description: 'Google Maps 纬度，范围 -90 至 90',
    format: '小数，最多 7 位小数',
    correctExample: '21.2414881',
    wrongExample: '106.154411',
    decimalFormat: '0.0000000',
  },
  {
    key: 'longitude',
    label: '经度',
    required: true,
    description: 'Google Maps 经度，范围 -180 至 180',
    format: '小数，最多 7 位小数',
    correctExample: '106.154411',
    wrongExample: '21.2414881',
    decimalFormat: '0.0000000',
  },
  {
    key: 'coverPath',
    label: '商家封面图路径',
    required: false,
    description: 'ZIP 压缩包内图片的相对路径；不填写则不导入封面图',
    format: '文本，相对路径，仅支持 jpg/jpeg/png/webp',
    correctExample: 'images/BG001_688便利店/cover.jpg',
    wrongExample: '/absolute/path/cover.jpg',
    textFormat: true,
  },
  {
    key: '营业时间',
    label: '营业时间',
    required: false,
    description: '用于小程序判断营业中；填写后自动应用到每天，留空默认每天 10:00-22:00，不支持按星期分别设置',
    format: 'HH:mm-HH:mm、HH:mm - HH:mm 或空白',
    correctExample: '10:00-22:00',
    wrongExample: '上午10点到晚上10点',
    textFormat: true,
  },
] as const satisfies readonly MerchantImportTemplateFieldConfig[];

export type MerchantImportTemplateFieldDefinition =
  (typeof MERCHANT_IMPORT_TEMPLATE_FIELDS)[number];

export type MerchantImportTemplateFieldKey =
  MerchantImportTemplateFieldDefinition['key'];

export const MERCHANT_IMPORT_TEMPLATE_FIELD_KEYS = MERCHANT_IMPORT_TEMPLATE_FIELDS.map(
  (field) => field.key,
);
