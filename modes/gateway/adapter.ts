export interface ChannelMessage {
  id: string;
  senderId: string;
  senderName: string;
  text?: string;
  photoBuffer?: Buffer;
  mimeType?: string;
  chatId: string;
}

export interface ChannelAdapter {
  name: string;
  initialize(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(chatId: string, text: string, options?: { parseMode?: "Markdown" | "HTML" }): Promise<void>;
  onMessage(callback: (msg: ChannelMessage) => Promise<void>): void;
}
