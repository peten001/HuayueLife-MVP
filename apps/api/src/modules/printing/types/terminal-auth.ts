import { MerchantTerminalPlatform, MerchantTerminalStatus } from '@prisma/client';
import { RequestWithContext } from '../../../common/types/request.type';

export interface AuthenticatedTerminal {
  id: bigint;
  merchantId: bigint;
  boundPrinterId: bigint | null;
  name: string;
  platform: MerchantTerminalPlatform;
  status: MerchantTerminalStatus;
  tokenVersion: number;
}

export interface RequestWithTerminal extends RequestWithContext {
  terminal?: AuthenticatedTerminal;
}
