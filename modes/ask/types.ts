export interface AskMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface AskSession {
  sessionId: string;
  createdAt: Date;
  history: AskMessage[];
}
