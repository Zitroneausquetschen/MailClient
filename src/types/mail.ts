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
  isFlagged: boolean;
  isAnswered: boolean;
  isDraft: boolean;
  flags: string[];
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
  isRead: boolean;
  isFlagged: boolean;
  isAnswered: boolean;
  isDraft: boolean;
  flags: string[];
}

export interface Attachment {
  filename: string;
  mimeType: string;
  size: number;
  partId: string;
  encoding: string;
}

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  data: string;  // Base64 encoded
}

export interface OutgoingEmail {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  replyToMessageId?: string;
  attachments?: OutgoingAttachment[];
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

export interface EmailSignature {
  id: string;
  name: string;
  content: string; // HTML content
  isDefault: boolean;
}

export interface VacationSettings {
  enabled: boolean;
  subject: string;
  message: string;
  startDate?: string; // ISO date string
  endDate?: string;   // ISO date string
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
  // Signatures
  signatures?: EmailSignature[];
  // Vacation/Out-of-office
  vacation?: VacationSettings;
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

// CardDAV Contact types
export interface ContactEmail {
  email: string;
  label: string; // "work", "home", "other"
}

export interface ContactPhone {
  number: string;
  label: string;
}

export interface Contact {
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  emails: ContactEmail[];
  phones: ContactPhone[];
  organization: string | null;
  photoUrl: string | null;
}

// CalDAV Calendar types
export interface Calendar {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: string;        // ISO 8601
  end: string;          // ISO 8601
  allDay: boolean;
  recurrenceRule: string | null;
  color: string | null;
  organizer: EventAttendee | null;
  attendees: EventAttendee[];
}

export interface EventAttendee {
  email: string;
  name: string | null;
  role: "REQ-PARTICIPANT" | "OPT-PARTICIPANT" | "CHAIR";
  status: "NEEDS-ACTION" | "ACCEPTED" | "DECLINED" | "TENTATIVE";
  rsvp: boolean;
}

// Task types (local storage)
export interface Task {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  priority: "low" | "medium" | "high";
  dueDate: string | null;  // ISO date string
  createdAt: string;
  updatedAt: string;
  accountId: string;
}

// CalDAV Task (VTODO)
export interface CalDavTask {
  id: string;
  calendarId: string;
  summary: string;
  description: string | null;
  completed: boolean;
  percentComplete: number | null;
  priority: number | null;  // 1-9, 1=high, 9=low
  due: string | null;       // ISO date string
  created: string | null;
  lastModified: string | null;
  status: string | null;    // NEEDS-ACTION, IN-PROCESS, COMPLETED, CANCELLED
}

// Note types
export interface Note {
  id: string;
  title: string;
  content: string;  // HTML content
  createdAt: string;
  updatedAt: string;
  accountId: string;
  color: string | null;  // Optional background color
}

// JMAP types
export interface JmapAccount {
  jmapUrl: string;
  username: string;
  password: string;
  displayName: string;
}

export interface JmapMailbox {
  id: string;
  name: string;
  parentId: string | null;
  role: string | null;  // Inbox, Drafts, Sent, Trash, Junk, Archive, Important
  totalEmails: number;
  unreadEmails: number;
  sortOrder: number;
}

export interface JmapEmailHeader {
  id: string;
  blobId: string;
  threadId: string;
  mailboxIds: string[];
  subject: string;
  from: string;
  to: string;
  date: string;
  isRead: boolean;
  isFlagged: boolean;
  isAnswered: boolean;
  isDraft: boolean;
  hasAttachments: boolean;
  size: number;
  preview: string;
}

export interface JmapEmail {
  id: string;
  blobId: string;
  threadId: string;
  mailboxIds: string[];
  subject: string;
  from: string;
  to: string;
  cc: string;
  bcc: string;
  date: string;
  bodyText: string;
  bodyHtml: string;
  attachments: JmapAttachment[];
  isRead: boolean;
  isFlagged: boolean;
  isAnswered: boolean;
  isDraft: boolean;
  size: number;
}

export interface JmapAttachment {
  blobId: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface JmapOutgoingEmail {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  inReplyTo?: string;
  references?: string;
}

export interface JmapConnectedAccount {
  id: string;
  displayName: string;
  email: string;
  protocol: "jmap";
}

// SavedAccount extended for JMAP
export interface SavedJmapAccount {
  id: string;
  displayName: string;
  username: string;
  jmapUrl: string;
  password?: string;
  protocol: "jmap";
  // Signatures
  signatures?: EmailSignature[];
  // Vacation/Out-of-office
  vacation?: VacationSettings;
}

// Type for any saved account (IMAP or JMAP)
export type AnySavedAccount = SavedAccount | SavedJmapAccount;

// Type guard for JMAP accounts
export function isJmapAccount(account: AnySavedAccount): account is SavedJmapAccount {
  return 'protocol' in account && account.protocol === 'jmap';
}
