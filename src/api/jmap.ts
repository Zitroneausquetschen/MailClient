import { invoke } from "@tauri-apps/api/core";
import type {
  JmapAccount,
  JmapMailbox,
  JmapEmailHeader,
  JmapEmail,
  JmapOutgoingEmail,
  JmapConnectedAccount,
} from "../types/mail";

// Connection
export async function jmapConnect(account: JmapAccount): Promise<JmapConnectedAccount> {
  return invoke("jmap_connect", { account });
}

export async function jmapDisconnect(accountId: string): Promise<void> {
  return invoke("jmap_disconnect", { accountId });
}

// Mailboxes
export async function jmapListMailboxes(accountId: string): Promise<JmapMailbox[]> {
  return invoke("jmap_list_mailboxes", { accountId });
}

// Emails
export async function jmapFetchEmailList(
  accountId: string,
  mailboxId: string,
  position: number,
  limit: number
): Promise<JmapEmailHeader[]> {
  return invoke("jmap_fetch_email_list", { accountId, mailboxId, position, limit });
}

export async function jmapFetchEmail(accountId: string, emailId: string): Promise<JmapEmail> {
  return invoke("jmap_fetch_email", { accountId, emailId });
}

// Email actions
export async function jmapMarkRead(accountId: string, emailId: string): Promise<void> {
  return invoke("jmap_mark_read", { accountId, emailId });
}

export async function jmapMarkUnread(accountId: string, emailId: string): Promise<void> {
  return invoke("jmap_mark_unread", { accountId, emailId });
}

export async function jmapMarkFlagged(accountId: string, emailId: string): Promise<void> {
  return invoke("jmap_mark_flagged", { accountId, emailId });
}

export async function jmapUnmarkFlagged(accountId: string, emailId: string): Promise<void> {
  return invoke("jmap_unmark_flagged", { accountId, emailId });
}

export async function jmapDeleteEmail(accountId: string, emailId: string): Promise<void> {
  return invoke("jmap_delete_email", { accountId, emailId });
}

export async function jmapMoveEmail(
  accountId: string,
  emailId: string,
  targetMailboxId: string
): Promise<void> {
  return invoke("jmap_move_email", { accountId, emailId, targetMailboxId });
}

// Mailbox management
export async function jmapCreateMailbox(
  accountId: string,
  name: string,
  parentId?: string
): Promise<string> {
  return invoke("jmap_create_mailbox", { accountId, name, parentId });
}

export async function jmapDeleteMailbox(accountId: string, mailboxId: string): Promise<void> {
  return invoke("jmap_delete_mailbox", { accountId, mailboxId });
}

export async function jmapRenameMailbox(
  accountId: string,
  mailboxId: string,
  newName: string
): Promise<void> {
  return invoke("jmap_rename_mailbox", { accountId, mailboxId, newName });
}

// Attachments
export async function jmapDownloadAttachment(
  accountId: string,
  blobId: string,
  filename: string
): Promise<string> {
  return invoke("jmap_download_attachment", { accountId, blobId, filename });
}

// Send email
export async function jmapSendEmail(accountId: string, email: JmapOutgoingEmail): Promise<string> {
  return invoke("jmap_send_email", { accountId, email });
}

// Search
export async function jmapSearchEmails(
  accountId: string,
  query: string,
  mailboxId?: string
): Promise<JmapEmailHeader[]> {
  return invoke("jmap_search_emails", { accountId, query, mailboxId });
}

// Bulk operations
export async function jmapBulkMarkRead(accountId: string, emailIds: string[]): Promise<void> {
  return invoke("jmap_bulk_mark_read", { accountId, emailIds });
}

export async function jmapBulkMarkUnread(accountId: string, emailIds: string[]): Promise<void> {
  return invoke("jmap_bulk_mark_unread", { accountId, emailIds });
}

export async function jmapBulkMarkFlagged(accountId: string, emailIds: string[]): Promise<void> {
  return invoke("jmap_bulk_mark_flagged", { accountId, emailIds });
}

export async function jmapBulkDelete(accountId: string, emailIds: string[]): Promise<void> {
  return invoke("jmap_bulk_delete", { accountId, emailIds });
}

export async function jmapBulkMove(
  accountId: string,
  emailIds: string[],
  targetMailboxId: string
): Promise<void> {
  return invoke("jmap_bulk_move", { accountId, emailIds, targetMailboxId });
}
