use async_imap::Session;
use async_native_tls::TlsStream;
use futures::StreamExt;
use mailparse::{parse_mail, MailHeaderMap};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio_util::compat::TokioAsyncReadCompatExt;

// Use a compat wrapper type for the session
pub type ImapSession = Session<TlsStream<tokio_util::compat::Compat<TcpStream>>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAccount {
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub username: String,
    pub password: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub name: String,
    pub delimiter: String,
    pub unread_count: u32,
    pub total_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailHeader {
    pub uid: u32,
    pub subject: String,
    pub from: String,
    pub to: String,
    pub date: String,
    pub is_read: bool,
    pub is_flagged: bool,
    pub is_answered: bool,
    pub is_draft: bool,
    pub flags: Vec<String>,
    pub has_attachments: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Email {
    pub uid: u32,
    pub subject: String,
    pub from: String,
    pub to: String,
    pub cc: String,
    pub date: String,
    pub body_text: String,
    pub body_html: String,
    pub attachments: Vec<Attachment>,
    pub is_read: bool,
    pub is_flagged: bool,
    pub is_answered: bool,
    pub is_draft: bool,
    pub flags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub filename: String,
    pub mime_type: String,
    pub size: usize,
    pub part_id: String,
    pub encoding: String,
}

pub struct ImapClient {
    session: Option<Arc<Mutex<ImapSession>>>,
    account: Option<MailAccount>,
}

impl ImapClient {
    pub fn new() -> Self {
        Self {
            session: None,
            account: None,
        }
    }

    pub async fn connect(&mut self, account: MailAccount) -> Result<(), String> {
        let addr = format!("{}:{}", account.imap_host, account.imap_port);

        // Connect to IMAP server
        let tcp_stream = TcpStream::connect(&addr)
            .await
            .map_err(|e| format!("TCP connection failed: {}", e))?;

        // Wrap with compat layer for futures_io compatibility
        let compat_stream = tcp_stream.compat();

        // Upgrade to TLS (accept self-signed certificates)
        let mut tls_builder = native_tls::TlsConnector::builder();
        tls_builder.danger_accept_invalid_certs(true);
        let tls: async_native_tls::TlsConnector = tls_builder.into();
        let tls_stream = tls
            .connect(&account.imap_host, compat_stream)
            .await
            .map_err(|e| format!("TLS connection failed: {}", e))?;

        // Create IMAP client
        let client = async_imap::Client::new(tls_stream);

        // Login
        let session = client
            .login(&account.username, &account.password)
            .await
            .map_err(|(e, _)| format!("Login failed: {}", e))?;

        self.session = Some(Arc::new(Mutex::new(session)));
        self.account = Some(account);

        Ok(())
    }

    pub async fn disconnect(&mut self) -> Result<(), String> {
        if let Some(session) = self.session.take() {
            let mut sess = session.lock().await;
            let _ = sess.logout().await;
        }
        self.account = None;
        Ok(())
    }

    pub async fn list_folders(&self) -> Result<Vec<Folder>, String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let mailboxes_stream = sess
            .list(None, Some("*"))
            .await
            .map_err(|e| format!("Failed to list folders: {}", e))?;

        // Collect the stream into a Vec
        let mailboxes: Vec<_> = mailboxes_stream
            .filter_map(|result| async { result.ok() })
            .collect()
            .await;

        let mut folders = Vec::new();
        for mailbox in mailboxes {
            folders.push(Folder {
                name: decode_imap_utf7(mailbox.name()),
                delimiter: mailbox.delimiter().unwrap_or("/").to_string(),
                unread_count: 0,
                total_count: 0,
            });
        }

        Ok(folders)
    }

    pub async fn select_folder(&self, folder: &str) -> Result<(u32, u32), String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        // Encode folder name for IMAP
        let encoded_folder = encode_imap_utf7(folder);
        let mailbox = sess
            .select(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to select folder: {}", e))?;

        let total = mailbox.exists;
        let unseen = mailbox.unseen.unwrap_or(0);

        Ok((total, unseen))
    }

    pub async fn fetch_headers(&self, folder: &str, start: u32, count: u32) -> Result<Vec<EmailHeader>, String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        // Encode folder name for IMAP and select folder
        let encoded_folder = encode_imap_utf7(folder);
        let mailbox = sess
            .select(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to select folder: {}", e))?;

        let total = mailbox.exists;
        if total == 0 {
            return Ok(Vec::new());
        }

        // Calculate range (fetch newest first)
        let end = total.saturating_sub(start);
        let begin = end.saturating_sub(count).max(1);

        if end < begin {
            return Ok(Vec::new());
        }

        let range = format!("{}:{}", begin, end);

        let messages_stream = sess
            .fetch(&range, "(UID FLAGS ENVELOPE BODYSTRUCTURE)")
            .await
            .map_err(|e| format!("Failed to fetch messages: {}", e))?;

        // Collect the stream into a Vec
        let messages: Vec<_> = messages_stream
            .filter_map(|result| async { result.ok() })
            .collect()
            .await;

        let mut headers = Vec::new();
        for msg in messages {
            let uid = msg.uid.unwrap_or(0);

            // Parse all flags
            let flags_iter = msg.flags();
            let mut is_read = false;
            let mut is_flagged = false;
            let mut is_answered = false;
            let mut is_draft = false;
            let mut flags_list: Vec<String> = Vec::new();

            for flag in flags_iter {
                match flag {
                    async_imap::types::Flag::Seen => {
                        is_read = true;
                        flags_list.push("\\Seen".to_string());
                    }
                    async_imap::types::Flag::Flagged => {
                        is_flagged = true;
                        flags_list.push("\\Flagged".to_string());
                    }
                    async_imap::types::Flag::Answered => {
                        is_answered = true;
                        flags_list.push("\\Answered".to_string());
                    }
                    async_imap::types::Flag::Draft => {
                        is_draft = true;
                        flags_list.push("\\Draft".to_string());
                    }
                    async_imap::types::Flag::Deleted => {
                        flags_list.push("\\Deleted".to_string());
                    }
                    async_imap::types::Flag::Recent => {
                        flags_list.push("\\Recent".to_string());
                    }
                    async_imap::types::Flag::Custom(ref s) => {
                        flags_list.push(s.to_string());
                    }
                    _ => {}
                }
            }

            let envelope = msg.envelope();
            let (subject, from, to, date) = if let Some(env) = envelope {
                let subject = env
                    .subject
                    .as_ref()
                    .map(|s| decode_header_value(s))
                    .unwrap_or_default();

                let from = env
                    .from
                    .as_ref()
                    .and_then(|addrs| addrs.first())
                    .map(format_address)
                    .unwrap_or_default();

                let to = env
                    .to
                    .as_ref()
                    .and_then(|addrs| addrs.first())
                    .map(format_address)
                    .unwrap_or_default();

                let date = env
                    .date
                    .as_ref()
                    .map(|d| String::from_utf8_lossy(d).to_string())
                    .unwrap_or_default();

                (subject, from, to, date)
            } else {
                (String::new(), String::new(), String::new(), String::new())
            };

            // Check for attachments (simplified)
            let has_attachments = false; // TODO: Parse BODYSTRUCTURE

            headers.push(EmailHeader {
                uid,
                subject,
                from,
                to,
                date,
                is_read,
                is_flagged,
                is_answered,
                is_draft,
                flags: flags_list,
                has_attachments,
            });
        }

        // Reverse to show newest first
        headers.reverse();

        Ok(headers)
    }

    pub async fn fetch_email(&self, folder: &str, uid: u32) -> Result<Email, String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let encoded_folder = encode_imap_utf7(folder);
        sess.select(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to select folder: {}", e))?;

        let messages_stream = sess
            .uid_fetch(uid.to_string(), "(UID FLAGS ENVELOPE BODY[])")
            .await
            .map_err(|e| format!("Failed to fetch message: {}", e))?;

        // Collect the stream
        let messages: Vec<_> = messages_stream
            .filter_map(|result| async { result.ok() })
            .collect()
            .await;

        let msg = messages
            .first()
            .ok_or("Message not found")?;

        // Parse flags
        let flags_iter = msg.flags();
        let mut is_read = false;
        let mut is_flagged = false;
        let mut is_answered = false;
        let mut is_draft = false;
        let mut flags_list: Vec<String> = Vec::new();

        for flag in flags_iter {
            match flag {
                async_imap::types::Flag::Seen => {
                    is_read = true;
                    flags_list.push("\\Seen".to_string());
                }
                async_imap::types::Flag::Flagged => {
                    is_flagged = true;
                    flags_list.push("\\Flagged".to_string());
                }
                async_imap::types::Flag::Answered => {
                    is_answered = true;
                    flags_list.push("\\Answered".to_string());
                }
                async_imap::types::Flag::Draft => {
                    is_draft = true;
                    flags_list.push("\\Draft".to_string());
                }
                async_imap::types::Flag::Deleted => {
                    flags_list.push("\\Deleted".to_string());
                }
                async_imap::types::Flag::Recent => {
                    flags_list.push("\\Recent".to_string());
                }
                async_imap::types::Flag::Custom(ref s) => {
                    flags_list.push(s.to_string());
                }
                _ => {}
            }
        }

        let body = msg.body().unwrap_or(&[]);

        // Parse email
        let parsed = parse_mail(body)
            .map_err(|e| format!("Failed to parse email: {}", e))?;

        let subject = parsed
            .headers
            .get_first_value("Subject")
            .unwrap_or_default();

        let from = parsed
            .headers
            .get_first_value("From")
            .unwrap_or_default();

        let to = parsed
            .headers
            .get_first_value("To")
            .unwrap_or_default();

        let cc = parsed
            .headers
            .get_first_value("Cc")
            .unwrap_or_default();

        let date = parsed
            .headers
            .get_first_value("Date")
            .unwrap_or_default();

        // Extract body
        let (body_text, body_html) = extract_body(&parsed);

        // Extract attachments
        let attachments = extract_attachments(&parsed);

        Ok(Email {
            uid,
            subject,
            from,
            to,
            cc,
            date,
            body_text,
            body_html: sanitize_html(&body_html),
            attachments,
            is_read,
            is_flagged,
            is_answered,
            is_draft,
            flags: flags_list,
        })
    }

    pub async fn get_attachment(&self, folder: &str, uid: u32, part_id: &str) -> Result<Vec<u8>, String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let encoded_folder = encode_imap_utf7(folder);
        sess.select(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to select folder: {}", e))?;

        // Fetch the specific MIME part
        let fetch_query = format!("BODY[{}]", part_id);
        let messages_stream = sess
            .uid_fetch(uid.to_string(), &fetch_query)
            .await
            .map_err(|e| format!("Failed to fetch attachment: {}", e))?;

        // Collect the stream
        let messages: Vec<_> = messages_stream
            .filter_map(|result| async { result.ok() })
            .collect()
            .await;

        let msg = messages
            .first()
            .ok_or("Message not found")?;

        let body = msg.body().unwrap_or(&[]);

        // The body is the raw MIME part data, which might be base64 encoded
        // We need to decode it based on the Content-Transfer-Encoding
        // For now, try to decode as base64 if it looks like base64
        let decoded = if body.iter().all(|&b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=' || b == b'\r' || b == b'\n') {
            // Looks like base64
            let cleaned: String = body.iter()
                .filter(|&&b| b != b'\r' && b != b'\n')
                .map(|&b| b as char)
                .collect();
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &cleaned)
                .unwrap_or_else(|_| body.to_vec())
        } else {
            body.to_vec()
        };

        Ok(decoded)
    }

    pub async fn mark_read(&self, folder: &str, uid: u32) -> Result<(), String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let encoded_folder = encode_imap_utf7(folder);
        sess.select(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to select folder: {}", e))?;

        // Consume the stream
        let _: Vec<_> = sess.uid_store(uid.to_string(), "+FLAGS (\\Seen)")
            .await
            .map_err(|e| format!("Failed to mark as read: {}", e))?
            .collect()
            .await;

        Ok(())
    }

    pub async fn delete_email(&self, folder: &str, uid: u32) -> Result<(), String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let encoded_folder = encode_imap_utf7(folder);
        sess.select(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to select folder: {}", e))?;

        // Consume the stream
        let _: Vec<_> = sess.uid_store(uid.to_string(), "+FLAGS (\\Deleted)")
            .await
            .map_err(|e| format!("Failed to delete: {}", e))?
            .collect()
            .await;

        let _: Vec<_> = sess.expunge()
            .await
            .map_err(|e| format!("Failed to expunge: {}", e))?
            .collect()
            .await;

        Ok(())
    }

    pub async fn move_email(&self, folder: &str, uid: u32, target_folder: &str) -> Result<(), String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let encoded_folder = encode_imap_utf7(folder);
        let encoded_target = encode_imap_utf7(target_folder);
        sess.select(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to select folder: {}", e))?;

        sess.uid_mv(uid.to_string(), &encoded_target)
            .await
            .map_err(|e| format!("Failed to move: {}", e))?;

        Ok(())
    }

    pub fn get_account(&self) -> Option<&MailAccount> {
        self.account.as_ref()
    }

    pub async fn append_to_sent(&self, message: &[u8]) -> Result<(), String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        // Try common sent folder names
        let sent_folders = ["Sent", "Gesendet", "INBOX.Sent", "INBOX.Gesendet", "Sent Items", "Sent Messages"];

        for folder_name in &sent_folders {
            // append(mailbox, flags, date, content)
            match sess.append(folder_name, None, None, message).await {
                Ok(_) => return Ok(()),
                Err(_) => continue,
            }
        }

        Err("Could not find Sent folder".to_string())
    }

    // Flag operations

    pub async fn mark_flagged(&self, folder: &str, uid: u32) -> Result<(), String> {
        self.add_flags(folder, uid, &["\\Flagged"]).await
    }

    pub async fn unmark_flagged(&self, folder: &str, uid: u32) -> Result<(), String> {
        self.remove_flags(folder, uid, &["\\Flagged"]).await
    }

    pub async fn mark_unread(&self, folder: &str, uid: u32) -> Result<(), String> {
        self.remove_flags(folder, uid, &["\\Seen"]).await
    }

    pub async fn add_flags(&self, folder: &str, uid: u32, flags: &[&str]) -> Result<(), String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let encoded_folder = encode_imap_utf7(folder);
        sess.select(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to select folder: {}", e))?;

        let flags_str = format!("+FLAGS ({})", flags.join(" "));
        let _: Vec<_> = sess.uid_store(uid.to_string(), &flags_str)
            .await
            .map_err(|e| format!("Failed to add flags: {}", e))?
            .collect()
            .await;

        Ok(())
    }

    pub async fn remove_flags(&self, folder: &str, uid: u32, flags: &[&str]) -> Result<(), String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let encoded_folder = encode_imap_utf7(folder);
        sess.select(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to select folder: {}", e))?;

        let flags_str = format!("-FLAGS ({})", flags.join(" "));
        let _: Vec<_> = sess.uid_store(uid.to_string(), &flags_str)
            .await
            .map_err(|e| format!("Failed to remove flags: {}", e))?
            .collect()
            .await;

        Ok(())
    }

    pub async fn set_flags(&self, folder: &str, uid: u32, flags: &[&str]) -> Result<(), String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let encoded_folder = encode_imap_utf7(folder);
        sess.select(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to select folder: {}", e))?;

        let flags_str = format!("FLAGS ({})", flags.join(" "));
        let _: Vec<_> = sess.uid_store(uid.to_string(), &flags_str)
            .await
            .map_err(|e| format!("Failed to set flags: {}", e))?
            .collect()
            .await;

        Ok(())
    }

    // Folder operations

    pub async fn create_folder(&self, folder_name: &str) -> Result<(), String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let encoded_folder = encode_imap_utf7(folder_name);
        sess.create(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to create folder: {}", e))?;

        Ok(())
    }

    pub async fn delete_folder(&self, folder_name: &str) -> Result<(), String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let encoded_folder = encode_imap_utf7(folder_name);
        sess.delete(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to delete folder: {}", e))?;

        Ok(())
    }

    pub async fn rename_folder(&self, old_name: &str, new_name: &str) -> Result<(), String> {
        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let encoded_old = encode_imap_utf7(old_name);
        let encoded_new = encode_imap_utf7(new_name);
        sess.rename(&encoded_old, &encoded_new)
            .await
            .map_err(|e| format!("Failed to rename folder: {}", e))?;

        Ok(())
    }

    // Bulk operations

    pub async fn bulk_mark_read(&self, folder: &str, uids: &[u32]) -> Result<(), String> {
        self.bulk_add_flags(folder, uids, &["\\Seen"]).await
    }

    pub async fn bulk_mark_unread(&self, folder: &str, uids: &[u32]) -> Result<(), String> {
        self.bulk_remove_flags(folder, uids, &["\\Seen"]).await
    }

    pub async fn bulk_mark_flagged(&self, folder: &str, uids: &[u32]) -> Result<(), String> {
        self.bulk_add_flags(folder, uids, &["\\Flagged"]).await
    }

    pub async fn bulk_delete(&self, folder: &str, uids: &[u32]) -> Result<(), String> {
        if uids.is_empty() {
            return Ok(());
        }

        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let encoded_folder = encode_imap_utf7(folder);
        sess.select(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to select folder: {}", e))?;

        let uid_str = uids_to_sequence(uids);
        let _: Vec<_> = sess.uid_store(&uid_str, "+FLAGS (\\Deleted)")
            .await
            .map_err(|e| format!("Failed to mark deleted: {}", e))?
            .collect()
            .await;

        let _: Vec<_> = sess.expunge()
            .await
            .map_err(|e| format!("Failed to expunge: {}", e))?
            .collect()
            .await;

        Ok(())
    }

    pub async fn bulk_move(&self, folder: &str, uids: &[u32], target_folder: &str) -> Result<(), String> {
        if uids.is_empty() {
            return Ok(());
        }

        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let encoded_folder = encode_imap_utf7(folder);
        let encoded_target = encode_imap_utf7(target_folder);
        sess.select(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to select folder: {}", e))?;

        let uid_str = uids_to_sequence(uids);
        sess.uid_mv(&uid_str, &encoded_target)
            .await
            .map_err(|e| format!("Failed to move emails: {}", e))?;

        Ok(())
    }

    pub async fn bulk_add_flags(&self, folder: &str, uids: &[u32], flags: &[&str]) -> Result<(), String> {
        if uids.is_empty() {
            return Ok(());
        }

        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let encoded_folder = encode_imap_utf7(folder);
        sess.select(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to select folder: {}", e))?;

        let uid_str = uids_to_sequence(uids);
        let flags_str = format!("+FLAGS ({})", flags.join(" "));
        let _: Vec<_> = sess.uid_store(&uid_str, &flags_str)
            .await
            .map_err(|e| format!("Failed to add flags: {}", e))?
            .collect()
            .await;

        Ok(())
    }

    pub async fn bulk_remove_flags(&self, folder: &str, uids: &[u32], flags: &[&str]) -> Result<(), String> {
        if uids.is_empty() {
            return Ok(());
        }

        let session = self
            .session
            .as_ref()
            .ok_or("Not connected")?;

        let mut sess = session.lock().await;

        let encoded_folder = encode_imap_utf7(folder);
        sess.select(&encoded_folder)
            .await
            .map_err(|e| format!("Failed to select folder: {}", e))?;

        let uid_str = uids_to_sequence(uids);
        let flags_str = format!("-FLAGS ({})", flags.join(" "));
        let _: Vec<_> = sess.uid_store(&uid_str, &flags_str)
            .await
            .map_err(|e| format!("Failed to remove flags: {}", e))?
            .collect()
            .await;

        Ok(())
    }
}

// Helper function to convert UID array to IMAP sequence string (e.g., "1,2,3,5:10")
fn uids_to_sequence(uids: &[u32]) -> String {
    if uids.is_empty() {
        return String::new();
    }

    let mut sorted: Vec<u32> = uids.to_vec();
    sorted.sort_unstable();

    let mut result = String::new();
    let mut range_start = sorted[0];
    let mut range_end = sorted[0];

    for &uid in &sorted[1..] {
        if uid == range_end + 1 {
            range_end = uid;
        } else {
            if !result.is_empty() {
                result.push(',');
            }
            if range_start == range_end {
                result.push_str(&range_start.to_string());
            } else {
                result.push_str(&format!("{}:{}", range_start, range_end));
            }
            range_start = uid;
            range_end = uid;
        }
    }

    if !result.is_empty() {
        result.push(',');
    }
    if range_start == range_end {
        result.push_str(&range_start.to_string());
    } else {
        result.push_str(&format!("{}:{}", range_start, range_end));
    }

    result
}

fn decode_header_value(value: &[u8]) -> String {
    // Decode RFC 2047 MIME encoded words
    let raw = String::from_utf8_lossy(value).to_string();
    decode_rfc2047(&raw)
}

fn decode_rfc2047(input: &str) -> String {
    // Pattern: =?charset?encoding?encoded_text?=
    let mut result = String::new();
    let mut i = 0;
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();

    while i < len {
        // Look for start of encoded word "=?"
        if i + 1 < len && chars[i] == '=' && chars[i + 1] == '?' {
            // Find the structure: =?charset?encoding?text?=
            // We need to find 3 '?' after the initial '=' and ending with '?='
            let start = i;
            i += 2; // skip "=?"

            // Find charset (until first ?)
            let charset_start = i;
            while i < len && chars[i] != '?' {
                i += 1;
            }
            if i >= len {
                result.push_str(&input[start..]);
                break;
            }
            let charset: String = chars[charset_start..i].iter().collect();
            i += 1; // skip '?'

            // Find encoding (single char, then ?)
            if i >= len {
                result.push_str(&input[start..]);
                break;
            }
            let encoding = chars[i].to_ascii_uppercase();
            i += 1;
            if i >= len || chars[i] != '?' {
                result.push_str(&input[start..]);
                continue;
            }
            i += 1; // skip '?'

            // Find encoded text (until ?=)
            let text_start = i;
            while i + 1 < len && !(chars[i] == '?' && chars[i + 1] == '=') {
                i += 1;
            }
            if i + 1 >= len {
                result.push_str(&input[start..]);
                break;
            }
            let text: String = chars[text_start..i].iter().collect();
            i += 2; // skip "?="

            // Decode the text
            let decoded_bytes = if encoding == 'B' {
                // Base64
                base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &text).ok()
            } else if encoding == 'Q' {
                // Quoted-printable (with underscore = space)
                let qp_text = text.replace('_', " ");
                decode_quoted_printable(&qp_text)
            } else {
                None
            };

            if let Some(bytes) = decoded_bytes {
                if charset.eq_ignore_ascii_case("utf-8") {
                    result.push_str(&String::from_utf8_lossy(&bytes));
                } else if charset.eq_ignore_ascii_case("iso-8859-1") || charset.eq_ignore_ascii_case("latin1") {
                    let decoded: String = bytes.iter().map(|&b| b as char).collect();
                    result.push_str(&decoded);
                } else {
                    result.push_str(&String::from_utf8_lossy(&bytes));
                }
            } else {
                // Decoding failed, output original
                let original: String = chars[start..i].iter().collect();
                result.push_str(&original);
            }

            // Skip whitespace between consecutive encoded words (RFC 2047)
            while i < len && (chars[i] == ' ' || chars[i] == '\t') {
                if i + 1 < len && chars[i + 1] == '=' {
                    i += 1; // skip space before next encoded word
                    break;
                }
                result.push(chars[i]);
                i += 1;
            }
        } else {
            result.push(chars[i]);
            i += 1;
        }
    }

    result
}

fn decode_quoted_printable(input: &str) -> Option<Vec<u8>> {
    let mut result = Vec::new();
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '=' {
            let hex: String = chars.by_ref().take(2).collect();
            if hex.len() == 2 {
                if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                    result.push(byte);
                }
            }
        } else {
            result.push(c as u8);
        }
    }

    Some(result)
}

fn format_address(addr: &imap_proto::types::Address) -> String {
    let name = addr
        .name
        .as_ref()
        .map(|n| decode_header_value(n))
        .unwrap_or_default();

    let mailbox = addr
        .mailbox
        .as_ref()
        .map(|m| String::from_utf8_lossy(m).to_string())
        .unwrap_or_default();

    let host = addr
        .host
        .as_ref()
        .map(|h| String::from_utf8_lossy(h).to_string())
        .unwrap_or_default();

    let email = format!("{}@{}", mailbox, host);

    if name.is_empty() {
        email
    } else {
        format!("{} <{}>", name, email)
    }
}

fn extract_body(mail: &mailparse::ParsedMail) -> (String, String) {
    let mut text_body = String::new();
    let mut html_body = String::new();

    if mail.subparts.is_empty() {
        let content_type = mail.ctype.mimetype.to_lowercase();
        let body = mail.get_body().unwrap_or_default();

        if content_type.contains("text/html") {
            html_body = body;
        } else {
            text_body = body;
        }
    } else {
        for part in &mail.subparts {
            let (t, h) = extract_body(part);
            if !t.is_empty() && text_body.is_empty() {
                text_body = t;
            }
            if !h.is_empty() && html_body.is_empty() {
                html_body = h;
            }
        }
    }

    (text_body, html_body)
}

fn extract_attachments(mail: &mailparse::ParsedMail) -> Vec<Attachment> {
    extract_attachments_with_path(mail, "")
}

fn extract_attachments_with_path(mail: &mailparse::ParsedMail, parent_path: &str) -> Vec<Attachment> {
    let mut attachments = Vec::new();

    for (idx, part) in mail.subparts.iter().enumerate() {
        // Build IMAP part path (1-indexed)
        let part_id = if parent_path.is_empty() {
            format!("{}", idx + 1)
        } else {
            format!("{}.{}", parent_path, idx + 1)
        };

        let disposition = part
            .headers
            .iter()
            .find(|h| h.get_key().to_lowercase() == "content-disposition");

        // Get content-transfer-encoding
        let encoding = part
            .headers
            .iter()
            .find(|h| h.get_key().to_lowercase() == "content-transfer-encoding")
            .map(|h| h.get_value().to_lowercase())
            .unwrap_or_else(|| "7bit".to_string());

        if let Some(disp) = disposition {
            let value = disp.get_value();
            if value.to_lowercase().starts_with("attachment") {
                // Try to get filename from Content-Disposition first
                let mut filename = disp.get_value()
                    .split(';')
                    .find(|p| p.trim().to_lowercase().starts_with("filename="))
                    .map(|p| {
                        let val = p.trim()[9..].trim();
                        val.trim_matches('"').to_string()
                    });

                // Fallback to Content-Type name parameter
                if filename.is_none() {
                    filename = part
                        .headers
                        .iter()
                        .find(|h| h.get_key().to_lowercase() == "content-type")
                        .and_then(|h| {
                            h.get_value()
                                .split(';')
                                .find(|p| p.trim().to_lowercase().starts_with("name="))
                                .map(|p| p.trim()[5..].trim_matches('"').to_string())
                        });
                }

                attachments.push(Attachment {
                    filename: filename.unwrap_or_else(|| "attachment".to_string()),
                    mime_type: part.ctype.mimetype.clone(),
                    size: part.get_body_raw().map(|b| b.len()).unwrap_or(0),
                    part_id: part_id.clone(),
                    encoding: encoding.clone(),
                });
            }
        }

        // Recurse into subparts
        attachments.extend(extract_attachments_with_path(part, &part_id));
    }

    attachments
}

fn sanitize_html(html: &str) -> String {
    ammonia::clean(html)
}

// Decode IMAP Modified UTF-7 folder names (RFC 3501)
fn decode_imap_utf7(input: &str) -> String {
    let mut result = String::new();
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '&' {
            // Start of encoded sequence
            let mut encoded = String::new();
            while let Some(&next) = chars.peek() {
                if next == '-' {
                    chars.next(); // consume the '-'
                    break;
                }
                encoded.push(chars.next().unwrap());
            }

            if encoded.is_empty() {
                // &- represents a literal &
                result.push('&');
            } else {
                // Decode modified base64 to UTF-16BE, then to UTF-8
                // Modified base64 uses , instead of /
                let standard_base64 = encoded.replace(',', "/");

                // Pad to multiple of 4
                let padded = match standard_base64.len() % 4 {
                    2 => format!("{}==", standard_base64),
                    3 => format!("{}=", standard_base64),
                    _ => standard_base64,
                };

                if let Ok(bytes) = base64::Engine::decode(
                    &base64::engine::general_purpose::STANDARD,
                    &padded,
                ) {
                    // Decode UTF-16BE
                    let utf16: Vec<u16> = bytes
                        .chunks(2)
                        .filter_map(|chunk| {
                            if chunk.len() == 2 {
                                Some(u16::from_be_bytes([chunk[0], chunk[1]]))
                            } else {
                                None
                            }
                        })
                        .collect();

                    if let Ok(decoded) = String::from_utf16(&utf16) {
                        result.push_str(&decoded);
                    } else {
                        // Fallback: keep original
                        result.push('&');
                        result.push_str(&encoded);
                        result.push('-');
                    }
                } else {
                    // Fallback: keep original
                    result.push('&');
                    result.push_str(&encoded);
                    result.push('-');
                }
            }
        } else {
            result.push(c);
        }
    }

    result
}

// Encode folder name to IMAP Modified UTF-7 (RFC 3501)
fn encode_imap_utf7(input: &str) -> String {
    let mut result = String::new();
    let mut non_ascii = String::new();

    for c in input.chars() {
        if c == '&' {
            // Literal & becomes &-
            if !non_ascii.is_empty() {
                result.push_str(&encode_utf16_to_imap_base64(&non_ascii));
                non_ascii.clear();
            }
            result.push_str("&-");
        } else if c.is_ascii() && c >= '\x20' && c <= '\x7e' {
            // Printable ASCII characters pass through unchanged
            if !non_ascii.is_empty() {
                result.push_str(&encode_utf16_to_imap_base64(&non_ascii));
                non_ascii.clear();
            }
            result.push(c);
        } else {
            // Non-ASCII or non-printable characters need encoding
            non_ascii.push(c);
        }
    }

    // Handle remaining non-ASCII characters
    if !non_ascii.is_empty() {
        result.push_str(&encode_utf16_to_imap_base64(&non_ascii));
    }

    result
}

fn encode_utf16_to_imap_base64(input: &str) -> String {
    use base64::Engine;

    // Convert to UTF-16BE
    let utf16: Vec<u8> = input
        .encode_utf16()
        .flat_map(|u| u.to_be_bytes())
        .collect();

    // Encode to base64
    let base64 = base64::engine::general_purpose::STANDARD.encode(&utf16);

    // Remove padding and convert / to , (IMAP modified base64)
    let modified = base64.trim_end_matches('=').replace('/', ",");

    format!("&{}-", modified)
}
