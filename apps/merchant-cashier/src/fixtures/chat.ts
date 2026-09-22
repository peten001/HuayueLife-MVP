export interface DemoChatMessage {
  id: string;
  conversationId: string;
  orderId: string;
  senderType: 'MERCHANT';
  senderId: string;
  content: string;
  messageType?: 'TEXT' | 'IMAGE' | 'LOCATION';
  mediaUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  readAt: null;
  createdAt: string;
}

const messagesByOrder = new Map<string, DemoChatMessage[]>();
let messageSequence = 0;

const demoLocationMessage: DemoChatMessage = {
  id: '0',
  conversationId: 'demo-chat-demo-order-1005',
  orderId: 'demo-order-1005',
  senderType: 'MERCHANT',
  senderId: 'demo-staff',
  content: '[位置]',
  messageType: 'LOCATION',
  latitude: 21.1862,
  longitude: 106.0763,
  readAt: null,
  createdAt: '2026-09-22T06:30:00.000Z',
};

export function listDemoChatMessages(orderId: string) {
  const stored = messagesByOrder.get(orderId);
  if (stored) return [...stored];
  return orderId === demoLocationMessage.orderId ? [demoLocationMessage] : [];
}

export function createDemoChatMessage(
  orderId: string,
  content: string,
  attachment: Partial<Pick<DemoChatMessage, 'messageType' | 'mediaUrl' | 'latitude' | 'longitude'>> = {},
) {
  messageSequence += 1;
  const message: DemoChatMessage = {
    id: String(messageSequence),
    conversationId: `demo-chat-${orderId}`,
    orderId,
    senderType: 'MERCHANT',
    senderId: 'demo-staff',
    content,
    ...attachment,
    readAt: null,
    createdAt: new Date().toISOString(),
  };
  messagesByOrder.set(orderId, [
    ...listDemoChatMessages(orderId),
    message,
  ]);
  return message;
}

export function resetDemoChatRepository() {
  messagesByOrder.clear();
  messageSequence = 0;
}
