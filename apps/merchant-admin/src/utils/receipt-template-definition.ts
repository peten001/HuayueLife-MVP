export type ReceiptSettingKey =
  | 'merchantName'
  | 'phone'
  | 'qrCode'
  | 'orderNumber'
  | 'tableNumber'
  | 'orderTime'
  | 'note'
  | 'itemPrice'
  | 'total'
  | 'footer';

export type ReceiptSettings = Record<ReceiptSettingKey, boolean> & {
  footerZh: string;
  footerVi: string;
};

export const CANONICAL_RECEIPT_SECTION_TYPES = [
  'MERCHANT_HEADER',
  'ORDER_INFO',
  'TABLE_INFO',
  'ITEMS',
  'TOTALS',
  'FOOTER',
] as const;

type CanonicalReceiptSectionType = (typeof CANONICAL_RECEIPT_SECTION_TYPES)[number];

interface ReceiptTemplateSection {
  type: CanonicalReceiptSectionType;
  enabled?: boolean;
  title?: string;
}

interface BuildReceiptSettingsDefinitionInput {
  existingDefinition: Record<string, unknown>;
  settings: ReceiptSettings;
}

export const RECEIPT_FOOTER_LINE_MAX_LENGTH = 60;

export type ReceiptFooterInputError = 'TOO_MANY_LINES' | 'LINE_TOO_LONG';

export type ParsedReceiptFooterInput =
  | { ok: true; footerZh: string; footerVi: string }
  | { ok: false; error: ReceiptFooterInputError };

const CANONICAL_RECEIPT_SECTION_TYPE_SET = new Set<string>(CANONICAL_RECEIPT_SECTION_TYPES);

export const RECEIPT_DISPLAY_KEYS = [
  'merchantName',
  'orderNumber',
  'tableNumber',
  'orderTime',
  'note',
  'itemPrice',
  'orderTotal',
  'footer',
] as const;

type ReceiptDisplayKey = (typeof RECEIPT_DISPLAY_KEYS)[number];
type ReceiptDisplaySettings = Record<ReceiptDisplayKey, boolean>;
type PersistedReceiptSettingKey = Exclude<ReceiptSettingKey, 'phone' | 'qrCode'>;

const RECEIPT_DISPLAY_MAPPING: ReadonlyArray<{
  displayKey: ReceiptDisplayKey;
  settingKey: PersistedReceiptSettingKey;
}> = [
  { displayKey: 'merchantName', settingKey: 'merchantName' },
  { displayKey: 'orderNumber', settingKey: 'orderNumber' },
  { displayKey: 'tableNumber', settingKey: 'tableNumber' },
  { displayKey: 'orderTime', settingKey: 'orderTime' },
  { displayKey: 'note', settingKey: 'note' },
  { displayKey: 'itemPrice', settingKey: 'itemPrice' },
  { displayKey: 'orderTotal', settingKey: 'total' },
  { displayKey: 'footer', settingKey: 'footer' },
];

const DEFAULT_RECEIPT_DISPLAY: ReceiptDisplaySettings = {
  merchantName: true,
  orderNumber: true,
  tableNumber: true,
  orderTime: true,
  note: true,
  itemPrice: true,
  orderTotal: true,
  footer: true,
};

export function buildReceiptSettingsDefinition({
  existingDefinition,
  settings,
}: BuildReceiptSettingsDefinitionInput): Record<string, unknown> {
  const existingSections = validCanonicalSections(existingDefinition.sections);
  const sections = existingSections ?? CANONICAL_RECEIPT_SECTION_TYPES.map((type) => ({ type }));
  const footerZh = settings.footerZh.trim();
  const footerVi = settings.footerVi.trim();

  return {
    ...existingDefinition,
    schemaVersion: 1,
    sections,
    display: receiptDisplayFromSettings(settings),
    footerTextZh: footerZh,
    footerTextVi: footerVi,
    footerText: [footerZh, footerVi].filter(Boolean).join('\n'),
  };
}

export function receiptFooterText(settings: Pick<ReceiptSettings, 'footerZh' | 'footerVi'>) {
  return settings.footerVi ? `${settings.footerZh}\n${settings.footerVi}` : settings.footerZh;
}

export function parseReceiptFooterInput(value: string): ParsedReceiptFooterInput {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 2) return { ok: false, error: 'TOO_MANY_LINES' };
  if (lines.some((line) => [...line].length > RECEIPT_FOOTER_LINE_MAX_LENGTH)) {
    return { ok: false, error: 'LINE_TOO_LONG' };
  }
  return {
    ok: true,
    footerZh: lines[0] ?? '',
    footerVi: lines[1] ?? '',
  };
}

export function receiptFooterSaveError(
  settings: Pick<ReceiptSettings, 'footer' | 'footerZh' | 'footerVi'>,
): 'FIRST_LINE_REQUIRED' | 'SECOND_WITHOUT_FIRST' | null {
  const footerZh = settings.footerZh.trim();
  const footerVi = settings.footerVi.trim();
  if (!footerZh && footerVi) return 'SECOND_WITHOUT_FIRST';
  if (settings.footer && !footerZh) return 'FIRST_LINE_REQUIRED';
  return null;
}

export function receiptSettingsDisplayFromDefinition(
  definition: Record<string, unknown>,
): Pick<ReceiptSettings, PersistedReceiptSettingKey> {
  const display = isPlainObject(definition.display) ? definition.display : {};
  const normalized = { ...DEFAULT_RECEIPT_DISPLAY };
  for (const { displayKey } of RECEIPT_DISPLAY_MAPPING) {
    if (typeof display[displayKey] === 'boolean') normalized[displayKey] = display[displayKey];
  }
  return RECEIPT_DISPLAY_MAPPING.reduce(
    (settings, { displayKey, settingKey }) => {
      settings[settingKey] = normalized[displayKey];
      return settings;
    },
    {} as Pick<ReceiptSettings, PersistedReceiptSettingKey>,
  );
}

function receiptDisplayFromSettings(settings: ReceiptSettings): ReceiptDisplaySettings {
  return RECEIPT_DISPLAY_MAPPING.reduce(
    (display, { displayKey, settingKey }) => {
      display[displayKey] = settings[settingKey];
      return display;
    },
    {} as ReceiptDisplaySettings,
  );
}

function validCanonicalSections(value: unknown): ReceiptTemplateSection[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > CANONICAL_RECEIPT_SECTION_TYPES.length) {
    return null;
  }
  const sections: ReceiptTemplateSection[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!isPlainObject(candidate)) return null;
    if (Object.keys(candidate).some((key) => !['type', 'enabled', 'title'].includes(key))) return null;
    if (typeof candidate.type !== 'string' || !CANONICAL_RECEIPT_SECTION_TYPE_SET.has(candidate.type)) return null;
    if (seen.has(candidate.type)) return null;
    if (candidate.enabled !== undefined && typeof candidate.enabled !== 'boolean') return null;
    if (
      candidate.title !== undefined &&
      (typeof candidate.title !== 'string' || candidate.title.length > 120 || /[<>]/.test(candidate.title))
    ) {
      return null;
    }
    seen.add(candidate.type);
    sections.push({
      type: candidate.type as CanonicalReceiptSectionType,
      ...(candidate.enabled !== undefined ? { enabled: candidate.enabled } : {}),
      ...(candidate.title !== undefined ? { title: candidate.title } : {}),
    });
  }
  return sections;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
