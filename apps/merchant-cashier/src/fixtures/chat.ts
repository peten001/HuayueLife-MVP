export interface DemoChatMessage {
  id: string;
  conversationId: string;
  orderId: string;
  senderType: 'MERCHANT';
  senderId: string;
  content: string;
  readAt: null;
  createdAt: string;
}

const messagesByOrder = new Map<string, DemoChatMessage[]>();
let messageSequence = 0;

export function listDemoChatMessages(orderId: string) {
  return [...(messagesByOrder.get(orderId) ?? [])];
}

export function createDemoChatMessage(orderId: string, content: string) {
  messageSequence += 1;
  const message: DemoChatMessage = {
    id: String(messageSequence),
    conversationId: `demo-chat-${orderId}`,
    orderId,
    senderType: 'MERCHANT',
    senderId: 'demo-staff',
    content,
    readAt: null,
    createdAt: new Date().toISOString(),
  };
  messagesByOrder.set(orderId, [
    ...(messagesByOrder.get(orderId) ?? []),
    message,
  ]);
  return message;
}

export function resetDemoChatRepository() {
  messagesByOrder.clear();
  messageSequence = 0;
}
