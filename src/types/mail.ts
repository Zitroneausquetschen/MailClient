export interface MailAccount {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  username: string;
  password: string;
  displayName: string;
}

export interface Folder {
  name: string;
  delimiter: string;
  unreadCount: number;
  totalCount: number;
}

export interface EmailHeader {
  uid: number;
  subject: string;
  from: string;
  to: string;
  date: string;
  isRead: boolean;
  hasAttachments: boolean;
}

export interface Email {
  uid: number;
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  bodyText: string;
  bodyHtml: string;
  attachments: Attachment[];
}

export interface Attachment {
  filename: string;
  mimeType: string;
  size: number;
}

export interface OutgoingEmail {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  replyToMessageId?: string;
}

export interface AutoConfigResult {
  imap_host?: string;
  imap_port?: number;
  imap_socket_type?: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_socket_type?: string;
  display_name?: string;
}

export interface SavedAccount {
  id: string;
  display_name: string;
  username: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  password?: string;
  // Cache settings
  cache_enabled?: boolean;
  cache_days?: number;
  cache_body?: boolean;
  cache_attachments?: boolean;
}

export interface CacheStats {
  emailCount: number;
  attachmentCount: number;
  totalSizeBytes: number;
  oldestEmail: string | null;
  newestEmail: string | null;
}

export interface SyncState {
  folder: string;
  lastSync: number;
  highestUid: number;
}

export interface ConnectedAccount {
  id: string;
  displayName: string;
  email: string;
}

export interface SieveScript {
  name: string;
  active: boolean;
  content?: string;
}

export interface SieveRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: SieveCondition[];
  actions: SieveAction[];
}

export interface SieveCondition {
  field: string;
  operator: string;
  value: string;
  headerName?: string;
}

export interface SieveAction {
  actionType: string;
  value?: string;
}
