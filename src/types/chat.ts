// Chat types for AI assistant

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isLoading?: boolean;
}

export interface ChatContext {
  emailUid?: number;
  folder?: string;
  accountId?: string;
  emailSubject?: string;
  emailFrom?: string;
  emailBody?: string;
}

export interface ChatConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  context?: ChatContext;
}
