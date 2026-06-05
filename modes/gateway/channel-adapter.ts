export type Platform = "cli" | "telegram" | "slack" | "webchat" | "discord" | "signal" | "whatsapp";

export interface Attachment {
  type: "image" | "audio" | "file";
  data: Buffer;
  mimeType: string;
  fileName?: string;
}

export interface ChannelRecipient {
  channelId: string;
  threadId?: string;
}

export interface InboundMessage {
  id: string;
  text?: string;
  senderId: string;
  senderName: string;
  chatId: string;
  attachments?: Attachment[];
  photoBuffer?: Buffer;
  mimeType?: string;
}

export interface OutboundMessage {
  text: string;
  attachments?: Attachment[];
  parseMode?: "Markdown" | "HTML";
}

export interface ChannelHealth {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ChannelAdapter {
  readonly name: string;
  readonly platform: Platform;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(recipient: ChannelRecipient, message: OutboundMessage): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => Promise<OutboundMessage | null>): void;
  health(): ChannelHealth;
}

export function adaptLegacyMessage(msg: ChannelMessage): InboundMessage {
  return {
    id: msg.id,
    text: msg.text,
    senderId: msg.senderId,
    senderName: msg.senderName,
    chatId: msg.chatId,
    photoBuffer: msg.photoBuffer,
    mimeType: msg.mimeType,
  };
}

export type ChannelMessage = InboundMessage;
