import { PrinterChannelType, Prisma } from '@prisma/client';

export const V2_LOCAL_CHANNELS = [
  'LOCAL_USB_ESCPOS',
  'LOCAL_LAN_ESCPOS',
  'LOCAL_BLUETOOTH_ESCPOS',
] as const satisfies readonly PrinterChannelType[];

export type V2LocalChannel = (typeof V2_LOCAL_CHANNELS)[number];
export type V2Transport = 'USB' | 'LAN' | 'BLUETOOTH';

export const V2_TERMINAL_ADAPTERS: Record<V2LocalChannel, string> = {
  LOCAL_USB_ESCPOS: 'ANDROID_USB_ESCPOS',
  LOCAL_LAN_ESCPOS: 'ANDROID_LAN_ESCPOS',
  LOCAL_BLUETOOTH_ESCPOS: 'ANDROID_BLUETOOTH_ESCPOS',
};

export interface V2BindingMetadata {
  terminalId: string;
  terminalInstanceId: string;
  localBindingId: string;
  bindingVersion: number;
  transport: V2Transport;
  endpointKey: string;
  bindingUpdatedAt: string;
  archivedAt?: string;
}

const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

export function channelForV2Transport(
  transport: V2Transport,
): V2LocalChannel {
  if (transport === 'USB') return 'LOCAL_USB_ESCPOS';
  if (transport === 'LAN') return 'LOCAL_LAN_ESCPOS';
  return 'LOCAL_BLUETOOTH_ESCPOS';
}

export function isV2LocalChannel(
  channelType: PrinterChannelType,
): channelType is V2LocalChannel {
  return (V2_LOCAL_CHANNELS as readonly PrinterChannelType[]).includes(
    channelType,
  );
}

export function v2BindingMetadata(
  value: Prisma.JsonValue | undefined,
): V2BindingMetadata | null {
  if (!isPlainObject(value) || !isPlainObject(value.v2Binding)) return null;
  const binding = value.v2Binding;
  if (
    typeof binding.terminalId !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(binding.terminalId) ||
    BigInt(binding.terminalId) > MAX_SIGNED_BIGINT ||
    typeof binding.terminalInstanceId !== 'string' ||
    !binding.terminalInstanceId ||
    typeof binding.localBindingId !== 'string' ||
    !binding.localBindingId ||
    !Number.isInteger(binding.bindingVersion) ||
    Number(binding.bindingVersion) < 1 ||
    !['USB', 'LAN', 'BLUETOOTH'].includes(String(binding.transport)) ||
    typeof binding.endpointKey !== 'string' ||
    !binding.endpointKey ||
    typeof binding.bindingUpdatedAt !== 'string' ||
    Number.isNaN(new Date(binding.bindingUpdatedAt).getTime()) ||
    (binding.archivedAt !== undefined &&
      (typeof binding.archivedAt !== 'string' ||
        Number.isNaN(new Date(binding.archivedAt).getTime())))
  ) {
    return null;
  }
  return {
    terminalId: binding.terminalId,
    terminalInstanceId: binding.terminalInstanceId,
    localBindingId: binding.localBindingId,
    bindingVersion: Number(binding.bindingVersion),
    transport: binding.transport as V2Transport,
    endpointKey: binding.endpointKey,
    bindingUpdatedAt: binding.bindingUpdatedAt,
    ...(typeof binding.archivedAt === 'string'
      ? { archivedAt: binding.archivedAt }
      : {}),
  };
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
