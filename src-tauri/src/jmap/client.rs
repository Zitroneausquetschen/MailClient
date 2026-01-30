use jmap_client::client::Client;
use jmap_client::client::Credentials;
use jmap_client::core::query::Filter;
use jmap_client::email::{self, Property as EmailProperty};
use jmap_client::mailbox::{self, Property as MailboxProperty, Role};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use chrono::{Utc, TimeZone};

/// JMAP Session response structure
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JmapSession {
    api_url: String,
    download_url: Option<String>,
    upload_url: Option<String>,
    #[serde(default)]
    capabilities: serde_json::Value,
    #[serde(default)]
    accounts: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JmapAccount {
    pub jmap_url: String,
    pub username: String,
    pub password: String,
    pub display_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JmapMailbox {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub role: Option<String>,
    pub total_emails: u32,
    pub unread_emails: u32,
    pub sort_order: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JmapEmailHeader {
    pub id: String,
    pub blob_id: String,
    pub thread_id: String,
    pub mailbox_ids: Vec<String>,
    pub subject: String,
    pub from: String,
    pub to: String,
    pub date: String,
    pub is_read: bool,
    pub is_flagged: bool,
    pub is_answered: bool,
    pub is_draft: bool,
    pub has_attachments: bool,
    pub size: u64,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JmapEmail {
    pub id: String,
    pub blob_id: String,
    pub thread_id: String,
    pub mailbox_ids: Vec<String>,
    pub subject: String,
    pub from: String,
    pub to: String,
    pub cc: String,
    pub bcc: String,
    pub date: String,
    pub body_text: String,
    pub body_html: String,
    pub attachments: Vec<JmapAttachment>,
    pub is_read: bool,
    pub is_flagged: bool,
    pub is_answered: bool,
    pub is_draft: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JmapAttachment {
    pub blob_id: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JmapOutgoingEmail {
    pub to: Vec<String>,
    pub cc: Option<Vec<String>>,
    pub bcc: Option<Vec<String>>,
    pub subject: String,
    pub body_text: String,
    pub body_html: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
}

/// JMAP Sieve Script
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JmapSieveScript {
    pub id: String,
    pub name: String,
    pub is_active: bool,
    #[serde(default)]
    pub blob_id: Option<String>,
}

pub struct JmapClient {
    client: Option<Arc<Client>>,
    account: Option<JmapAccount>,
    api_url: Option<String>,
    account_id: Option<String>,
}

impl JmapClient {
    pub fn new() -> Self {
        Self {
            client: None,
            account: None,
            api_url: None,
            account_id: None,
        }
    }

    pub async fn connect(&mut self, account: JmapAccount) -> Result<(), String> {
        // Strip .well-known/jmap from URL if present
        let base_url = account.jmap_url
            .trim_end_matches('/')
            .trim_end_matches("/.well-known/jmap")
            .trim_end_matches(".well-known/jmap")
            .to_string();

        // Create HTTP client that follows redirects
        let http_client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        // Manually fetch the .well-known/jmap endpoint to get the session
        // This follows all redirects automatically
        let well_known_url = format!("{}/.well-known/jmap", base_url);
        let response = http_client
            .get(&well_known_url)
            .basic_auth(&account.username, Some(&account.password))
            .header("Accept", "application/json")
            .send()
            .await
            .map_err(|e| format!("Failed to fetch JMAP session: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("JMAP server returned error: {}", response.status()));
        }

        // Get the final URL after redirects - this is where the session was actually served from
        let final_url = response.url().clone();

        // Parse the session response as JSON Value first
        let session_json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse JMAP session: {}", e))?;

        // Extract session data
        let session = JmapSession {
            api_url: session_json.get("apiUrl")
                .and_then(|v| v.as_str())
                .ok_or("Missing apiUrl in session")?
                .to_string(),
            download_url: session_json.get("downloadUrl").and_then(|v| v.as_str()).map(|s| s.to_string()),
            upload_url: session_json.get("uploadUrl").and_then(|v| v.as_str()).map(|s| s.to_string()),
            capabilities: session_json.get("capabilities").cloned().unwrap_or(serde_json::Value::Null),
            accounts: session_json.get("accounts").cloned().unwrap_or(serde_json::Value::Null),
        };

        // Resolve the API URL - it might be relative
        let api_url = if session.api_url.starts_with("http://") || session.api_url.starts_with("https://") {
            session.api_url.clone()
        } else if session.api_url.starts_with('/') {
            // Absolute path - combine with final URL's origin
            format!("{}://{}{}",
                final_url.scheme(),
                final_url.host_str().unwrap_or(""),
                session.api_url
            )
        } else {
            // Relative path
            format!("{}/{}", final_url.as_str().trim_end_matches('/'), session.api_url)
        };

        // Collect trusted hosts for redirects
        let mut trusted_hosts: Vec<String> = Vec::new();

        // Add original host
        if let Ok(orig_url) = reqwest::Url::parse(&base_url) {
            if let Some(host) = orig_url.host_str() {
                trusted_hosts.push(host.to_string());
            }
        }

        // Add final URL host (after redirects)
        if let Some(host) = final_url.host_str() {
            if !trusted_hosts.contains(&host.to_string()) {
                trusted_hosts.push(host.to_string());
            }
        }

        // Add API URL host if different
        if let Ok(api_parsed) = reqwest::Url::parse(&api_url) {
            if let Some(host) = api_parsed.host_str() {
                if !trusted_hosts.contains(&host.to_string()) {
                    trusted_hosts.push(host.to_string());
                }
            }
        }

        // Extract base URL from the API URL for jmap-client
        let connect_base = if let Ok(url) = reqwest::Url::parse(&api_url) {
            let mut base = format!("{}://{}", url.scheme(), url.host_str().unwrap_or(""));
            if let Some(port) = url.port() {
                base = format!("{}:{}", base, port);
            }
            base
        } else {
            // Fallback: use base from final URL
            let mut base = format!("{}://{}", final_url.scheme(), final_url.host_str().unwrap_or(""));
            if let Some(port) = final_url.port() {
                base = format!("{}:{}", base, port);
            }
            base
        };

        // Try to connect using the resolved base URL with trusted redirect hosts
        let client = Client::new()
            .credentials(Credentials::basic(&account.username, &account.password))
            .accept_invalid_certs(true)
            .follow_redirects(trusted_hosts)
            .timeout(std::time::Duration::from_secs(30))
            .connect(&connect_base)
            .await
            .map_err(|e| format!("JMAP connection failed: {} (tried connecting to {})", e, connect_base))?;

        // Extract primary account ID from session
        let primary_account_id = session_json
            .get("primaryAccounts")
            .and_then(|pa| pa.get("urn:ietf:params:jmap:mail"))
            .and_then(|v| v.as_str())
            .or_else(|| {
                // Fallback: get first account from accounts object
                session_json.get("accounts")
                    .and_then(|accts| accts.as_object())
                    .and_then(|obj| obj.keys().next())
                    .map(|s| s.as_str())
            })
            .map(|s| s.to_string());

        self.client = Some(Arc::new(client));
        self.account = Some(account);
        self.api_url = Some(api_url);
        self.account_id = primary_account_id;

        Ok(())
    }

    pub async fn disconnect(&mut self) -> Result<(), String> {
        self.client = None;
        self.account = None;
        self.api_url = None;
        self.account_id = None;
        Ok(())
    }

    pub fn get_account(&self) -> Option<&JmapAccount> {
        self.account.as_ref()
    }

    pub async fn list_mailboxes(&self) -> Result<Vec<JmapMailbox>, String> {
        let client = self.client.as_ref().ok_or("Not connected")?;

        // Query all mailboxes
        let response = client
            .mailbox_query(None::<Filter<mailbox::query::Filter>>, None::<Vec<_>>)
            .await
            .map_err(|e| format!("Failed to query mailboxes: {}", e))?;

        let mailbox_ids = response.ids();

        if mailbox_ids.is_empty() {
            return Ok(Vec::new());
        }

        // Fetch mailbox details
        let mut result = Vec::new();
        for mailbox_id in mailbox_ids {
            if let Ok(Some(mailbox)) = client
                .mailbox_get(
                    mailbox_id,
                    Some(vec![
                        MailboxProperty::Id,
                        MailboxProperty::Name,
                        MailboxProperty::ParentId,
                        MailboxProperty::Role,
                        MailboxProperty::TotalEmails,
                        MailboxProperty::UnreadEmails,
                        MailboxProperty::SortOrder,
                    ]),
                )
                .await
            {
                let role = mailbox.role();
                let role_str = match role {
                    Role::Archive => Some("Archive".to_string()),
                    Role::Drafts => Some("Drafts".to_string()),
                    Role::Important => Some("Important".to_string()),
                    Role::Inbox => Some("Inbox".to_string()),
                    Role::Junk => Some("Junk".to_string()),
                    Role::Sent => Some("Sent".to_string()),
                    Role::Trash => Some("Trash".to_string()),
                    Role::Other(s) => Some(s.to_string()),
                    Role::None => None,
                };
                result.push(JmapMailbox {
                    id: mailbox.id().unwrap_or("").to_string(),
                    name: mailbox.name().unwrap_or("").to_string(),
                    parent_id: mailbox.parent_id().map(|s| s.to_string()),
                    role: role_str,
                    total_emails: mailbox.total_emails() as u32,
                    unread_emails: mailbox.unread_emails() as u32,
                    sort_order: mailbox.sort_order(),
                });
            }
        }

        Ok(result)
    }

    pub async fn fetch_email_list(
        &self,
        mailbox_id: &str,
        position: u32,
        limit: u32,
    ) -> Result<Vec<JmapEmailHeader>, String> {
        let client = self.client.as_ref().ok_or("Not connected")?;

        // Query emails in the mailbox
        let filter = email::query::Filter::in_mailbox(mailbox_id);

        let response = client
            .email_query(
                Some(filter),
                Some(vec![email::query::Comparator::received_at().descending()]),
            )
            .await
            .map_err(|e| format!("Failed to query emails: {}", e))?;

        let email_ids: Vec<&str> = response
            .ids()
            .iter()
            .skip(position as usize)
            .take(limit as usize)
            .map(|id| id.as_ref())
            .collect();

        if email_ids.is_empty() {
            return Ok(Vec::new());
        }

        // Fetch email details
        let mut result = Vec::new();
        for email_id in email_ids {
            if let Ok(Some(email)) = client
                .email_get(
                    email_id,
                    Some(vec![
                        EmailProperty::Id,
                        EmailProperty::BlobId,
                        EmailProperty::ThreadId,
                        EmailProperty::MailboxIds,
                        EmailProperty::Subject,
                        EmailProperty::From,
                        EmailProperty::To,
                        EmailProperty::ReceivedAt,
                        EmailProperty::Keywords,
                        EmailProperty::HasAttachment,
                        EmailProperty::Size,
                        EmailProperty::Preview,
                    ]),
                )
                .await
            {
                let keywords = email.keywords();
                let is_read = keywords.iter().any(|k| *k == "$seen");
                let is_flagged = keywords.iter().any(|k| *k == "$flagged");
                let is_answered = keywords.iter().any(|k| *k == "$answered");
                let is_draft = keywords.iter().any(|k| *k == "$draft");

                result.push(JmapEmailHeader {
                    id: email.id().unwrap_or("").to_string(),
                    blob_id: email.blob_id().unwrap_or("").to_string(),
                    thread_id: email.thread_id().unwrap_or("").to_string(),
                    mailbox_ids: email
                        .mailbox_ids()
                        .iter()
                        .map(|id| id.to_string())
                        .collect(),
                    subject: email.subject().unwrap_or("").to_string(),
                    from: email
                        .from()
                        .and_then(|addrs| addrs.first())
                        .map(format_email_address)
                        .unwrap_or_default(),
                    to: email
                        .to()
                        .and_then(|addrs| addrs.first())
                        .map(format_email_address)
                        .unwrap_or_default(),
                    date: email
                        .received_at()
                        .map(|ts| format_timestamp(ts))
                        .unwrap_or_default(),
                    is_read,
                    is_flagged,
                    is_answered,
                    is_draft,
                    has_attachments: email.has_attachment(),
                    size: email.size() as u64,
                    preview: email.preview().unwrap_or("").to_string(),
                });
            }
        }

        Ok(result)
    }

    pub async fn fetch_email(&self, email_id: &str) -> Result<JmapEmail, String> {
        let client = self.client.as_ref().ok_or("Not connected")?;

        let email = client
            .email_get(
                email_id,
                Some(vec![
                    EmailProperty::Id,
                    EmailProperty::BlobId,
                    EmailProperty::ThreadId,
                    EmailProperty::MailboxIds,
                    EmailProperty::Subject,
                    EmailProperty::From,
                    EmailProperty::To,
                    EmailProperty::Cc,
                    EmailProperty::Bcc,
                    EmailProperty::ReceivedAt,
                    EmailProperty::Keywords,
                    EmailProperty::Size,
                    EmailProperty::TextBody,
                    EmailProperty::HtmlBody,
                    EmailProperty::BodyValues,
                    EmailProperty::Attachments,
                ]),
            )
            .await
            .map_err(|e| format!("Failed to get email: {}", e))?
            .ok_or("Email not found")?;

        let keywords = email.keywords();
        let is_read = keywords.iter().any(|k| *k == "$seen");
        let is_flagged = keywords.iter().any(|k| *k == "$flagged");
        let is_answered = keywords.iter().any(|k| *k == "$answered");
        let is_draft = keywords.iter().any(|k| *k == "$draft");

        // Extract body content from body values
        let mut body_text = String::new();
        let mut body_html = String::new();

        // Get text body parts
        if let Some(text_parts) = email.text_body() {
            for part in text_parts {
                if let Some(part_id) = part.part_id() {
                    if let Some(value) = email.body_value(part_id) {
                        body_text.push_str(value.value());
                    }
                }
            }
        }

        // Get HTML body parts
        if let Some(html_parts) = email.html_body() {
            for part in html_parts {
                if let Some(part_id) = part.part_id() {
                    if let Some(value) = email.body_value(part_id) {
                        body_html.push_str(value.value());
                    }
                }
            }
        }

        // Extract attachments
        let attachments: Vec<JmapAttachment> = email
            .attachments()
            .map(|atts| {
                atts.iter()
                    .map(|att| JmapAttachment {
                        blob_id: att.blob_id().unwrap_or("").to_string(),
                        name: att.name().unwrap_or("attachment").to_string(),
                        mime_type: att.content_type().unwrap_or("application/octet-stream").to_string(),
                        size: att.size() as u64,
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(JmapEmail {
            id: email.id().unwrap_or("").to_string(),
            blob_id: email.blob_id().unwrap_or("").to_string(),
            thread_id: email.thread_id().unwrap_or("").to_string(),
            mailbox_ids: email
                .mailbox_ids()
                .iter()
                .map(|id| id.to_string())
                .collect(),
            subject: email.subject().unwrap_or("").to_string(),
            from: email
                .from()
                .and_then(|addrs| addrs.first())
                .map(format_email_address)
                .unwrap_or_default(),
            to: email
                .to()
                .map(|addrs| {
                    addrs
                        .iter()
                        .map(format_email_address)
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default(),
            cc: email
                .cc()
                .map(|addrs| {
                    addrs
                        .iter()
                        .map(format_email_address)
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default(),
            bcc: email
                .bcc()
                .map(|addrs| {
                    addrs
                        .iter()
                        .map(format_email_address)
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default(),
            date: email
                .received_at()
                .map(|ts| format_timestamp(ts))
                .unwrap_or_default(),
            body_text,
            body_html: sanitize_html(&body_html),
            attachments,
            is_read,
            is_flagged,
            is_answered,
            is_draft,
            size: email.size() as u64,
        })
    }

    pub async fn mark_read(&self, email_id: &str) -> Result<(), String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        client
            .email_set_keyword(email_id, "$seen", true)
            .await
            .map_err(|e| format!("Failed to mark as read: {}", e))?;
        Ok(())
    }

    pub async fn mark_unread(&self, email_id: &str) -> Result<(), String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        client
            .email_set_keyword(email_id, "$seen", false)
            .await
            .map_err(|e| format!("Failed to mark as unread: {}", e))?;
        Ok(())
    }

    pub async fn mark_flagged(&self, email_id: &str) -> Result<(), String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        client
            .email_set_keyword(email_id, "$flagged", true)
            .await
            .map_err(|e| format!("Failed to mark as flagged: {}", e))?;
        Ok(())
    }

    pub async fn unmark_flagged(&self, email_id: &str) -> Result<(), String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        client
            .email_set_keyword(email_id, "$flagged", false)
            .await
            .map_err(|e| format!("Failed to unmark as flagged: {}", e))?;
        Ok(())
    }

    pub async fn delete_email(&self, email_id: &str) -> Result<(), String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        client
            .email_destroy(email_id)
            .await
            .map_err(|e| format!("Failed to delete email: {}", e))?;
        Ok(())
    }

    pub async fn move_email(&self, email_id: &str, target_mailbox_id: &str) -> Result<(), String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        client
            .email_set_mailboxes(email_id, [target_mailbox_id])
            .await
            .map_err(|e| format!("Failed to move email: {}", e))?;
        Ok(())
    }

    pub async fn create_mailbox(&self, name: &str, parent_id: Option<&str>) -> Result<String, String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        let mut response = client
            .mailbox_create(name, parent_id, Role::None)
            .await
            .map_err(|e| format!("Failed to create mailbox: {}", e))?;
        Ok(response.take_id())
    }

    pub async fn delete_mailbox(&self, mailbox_id: &str) -> Result<(), String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        client
            .mailbox_destroy(mailbox_id, true)
            .await
            .map_err(|e| format!("Failed to delete mailbox: {}", e))?;
        Ok(())
    }

    pub async fn rename_mailbox(&self, mailbox_id: &str, new_name: &str) -> Result<(), String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        client
            .mailbox_rename(mailbox_id, new_name)
            .await
            .map_err(|e| format!("Failed to rename mailbox: {}", e))?;
        Ok(())
    }

    pub async fn download_blob(&self, blob_id: &str) -> Result<Vec<u8>, String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        let blob = client
            .download(blob_id)
            .await
            .map_err(|e| format!("Failed to download blob: {}", e))?;
        Ok(blob)
    }

    pub async fn send_email(&self, email: JmapOutgoingEmail) -> Result<String, String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        let account = self.account.as_ref().ok_or("No account")?;

        // Build RFC 5322 message for import and submission
        let mut message = String::new();

        // From header
        message.push_str(&format!("From: {} <{}>\r\n", account.display_name, account.username));

        // To header
        message.push_str(&format!("To: {}\r\n", email.to.join(", ")));

        // CC header
        if let Some(cc) = &email.cc {
            if !cc.is_empty() {
                message.push_str(&format!("Cc: {}\r\n", cc.join(", ")));
            }
        }

        // Subject header
        message.push_str(&format!("Subject: {}\r\n", email.subject));

        // Date header
        let now = chrono::Utc::now();
        message.push_str(&format!("Date: {}\r\n", now.format("%a, %d %b %Y %H:%M:%S +0000")));

        // Message-ID
        let msg_id = uuid::Uuid::new_v4();
        let domain = account.username.split('@').last().unwrap_or("localhost");
        message.push_str(&format!("Message-ID: <{}@{}>\r\n", msg_id, domain));

        // In-Reply-To
        if let Some(reply_to) = &email.in_reply_to {
            message.push_str(&format!("In-Reply-To: {}\r\n", reply_to));
        }

        // References
        if let Some(refs) = &email.references {
            message.push_str(&format!("References: {}\r\n", refs));
        }

        // MIME headers
        if let Some(html) = &email.body_html {
            message.push_str("MIME-Version: 1.0\r\n");
            message.push_str("Content-Type: multipart/alternative; boundary=\"boundary-alternative\"\r\n");
            message.push_str("\r\n");
            message.push_str("--boundary-alternative\r\n");
            message.push_str("Content-Type: text/plain; charset=utf-8\r\n");
            message.push_str("\r\n");
            message.push_str(&email.body_text);
            message.push_str("\r\n--boundary-alternative\r\n");
            message.push_str("Content-Type: text/html; charset=utf-8\r\n");
            message.push_str("\r\n");
            message.push_str(html);
            message.push_str("\r\n--boundary-alternative--\r\n");
        } else {
            message.push_str("Content-Type: text/plain; charset=utf-8\r\n");
            message.push_str("\r\n");
            message.push_str(&email.body_text);
        }

        // Find the Sent mailbox
        let sent_mailbox_id = self.find_mailbox_by_role(Role::Sent).await?;

        // Import the message to get an email ID
        let imported_email = client
            .email_import(
                message.into_bytes(),
                [sent_mailbox_id.as_str()],
                ["$seen"].into(),
                None,
            )
            .await
            .map_err(|e| format!("Failed to import email: {}", e))?;

        let email_id = imported_email
            .id()
            .ok_or("Imported email has no ID")?
            .to_string();

        // Get the identity ID for submission
        let identity_id = self.get_identity_id().await?;

        // Submit the email for sending
        client
            .email_submission_create(&email_id, &identity_id)
            .await
            .map_err(|e| format!("Failed to submit email: {}", e))?;

        Ok(email_id)
    }

    async fn get_identity_id(&self) -> Result<String, String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        let account = self.account.as_ref().ok_or("No account")?;

        // Query all identities
        let mut request = client.build();
        request.get_identity();

        let response = request
            .send_get_identity()
            .await
            .map_err(|e| format!("Failed to get identities: {}", e))?;

        // Find the identity matching our email or use the first one
        let identities = response.list();
        for identity in identities {
            if let Some(email) = identity.email() {
                if email == account.username {
                    if let Some(id) = identity.id() {
                        return Ok(id.to_string());
                    }
                }
            }
        }

        // Use the first identity if no match
        identities
            .first()
            .and_then(|i| i.id())
            .map(|id| id.to_string())
            .ok_or_else(|| "No identity found".to_string())
    }

    async fn find_mailbox_by_role(&self, role: Role) -> Result<String, String> {
        let client = self.client.as_ref().ok_or("Not connected")?;

        let filter = mailbox::query::Filter::role(role);
        let response = client
            .mailbox_query(Some(filter), None::<Vec<_>>)
            .await
            .map_err(|e| format!("Failed to query mailboxes: {}", e))?;

        response
            .ids()
            .first()
            .map(|id| id.to_string())
            .ok_or_else(|| "Mailbox not found".to_string())
    }

    // Bulk operations
    pub async fn bulk_mark_read(&self, email_ids: &[&str]) -> Result<(), String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        for email_id in email_ids {
            client
                .email_set_keyword(email_id, "$seen", true)
                .await
                .map_err(|e| format!("Failed to mark as read: {}", e))?;
        }
        Ok(())
    }

    pub async fn bulk_mark_unread(&self, email_ids: &[&str]) -> Result<(), String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        for email_id in email_ids {
            client
                .email_set_keyword(email_id, "$seen", false)
                .await
                .map_err(|e| format!("Failed to mark as unread: {}", e))?;
        }
        Ok(())
    }

    pub async fn bulk_mark_flagged(&self, email_ids: &[&str]) -> Result<(), String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        for email_id in email_ids {
            client
                .email_set_keyword(email_id, "$flagged", true)
                .await
                .map_err(|e| format!("Failed to mark as flagged: {}", e))?;
        }
        Ok(())
    }

    pub async fn bulk_delete(&self, email_ids: &[&str]) -> Result<(), String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        for email_id in email_ids {
            client
                .email_destroy(email_id)
                .await
                .map_err(|e| format!("Failed to delete email: {}", e))?;
        }
        Ok(())
    }

    pub async fn bulk_move(&self, email_ids: &[&str], target_mailbox_id: &str) -> Result<(), String> {
        let client = self.client.as_ref().ok_or("Not connected")?;
        for email_id in email_ids {
            client
                .email_set_mailboxes(email_id, [target_mailbox_id])
                .await
                .map_err(|e| format!("Failed to move email: {}", e))?;
        }
        Ok(())
    }

    pub async fn search_emails(
        &self,
        query: &str,
        mailbox_id: Option<&str>,
    ) -> Result<Vec<JmapEmailHeader>, String> {
        let client = self.client.as_ref().ok_or("Not connected")?;

        // Build filter with text search
        let filter = if let Some(mb_id) = mailbox_id {
            Filter::and([
                email::query::Filter::text(query),
                email::query::Filter::in_mailbox(mb_id),
            ])
        } else {
            email::query::Filter::text(query).into()
        };

        let response = client
            .email_query(
                Some(filter),
                Some(vec![email::query::Comparator::received_at().descending()]),
            )
            .await
            .map_err(|e| format!("Failed to search emails: {}", e))?;

        let email_ids: Vec<&str> = response
            .ids()
            .iter()
            .take(50) // Limit search results
            .map(|id| id.as_ref())
            .collect();

        if email_ids.is_empty() {
            return Ok(Vec::new());
        }

        // Fetch email details
        let mut result = Vec::new();
        for email_id in email_ids {
            if let Ok(Some(email)) = client
                .email_get(
                    email_id,
                    Some(vec![
                        EmailProperty::Id,
                        EmailProperty::BlobId,
                        EmailProperty::ThreadId,
                        EmailProperty::MailboxIds,
                        EmailProperty::Subject,
                        EmailProperty::From,
                        EmailProperty::To,
                        EmailProperty::ReceivedAt,
                        EmailProperty::Keywords,
                        EmailProperty::HasAttachment,
                        EmailProperty::Size,
                        EmailProperty::Preview,
                    ]),
                )
                .await
            {
                let keywords = email.keywords();
                let is_read = keywords.iter().any(|k| *k == "$seen");
                let is_flagged = keywords.iter().any(|k| *k == "$flagged");
                let is_answered = keywords.iter().any(|k| *k == "$answered");
                let is_draft = keywords.iter().any(|k| *k == "$draft");

                result.push(JmapEmailHeader {
                    id: email.id().unwrap_or("").to_string(),
                    blob_id: email.blob_id().unwrap_or("").to_string(),
                    thread_id: email.thread_id().unwrap_or("").to_string(),
                    mailbox_ids: email
                        .mailbox_ids()
                        .iter()
                        .map(|id| id.to_string())
                        .collect(),
                    subject: email.subject().unwrap_or("").to_string(),
                    from: email
                        .from()
                        .and_then(|addrs| addrs.first())
                        .map(format_email_address)
                        .unwrap_or_default(),
                    to: email
                        .to()
                        .and_then(|addrs| addrs.first())
                        .map(format_email_address)
                        .unwrap_or_default(),
                    date: email
                        .received_at()
                        .map(|ts| format_timestamp(ts))
                        .unwrap_or_default(),
                    is_read,
                    is_flagged,
                    is_answered,
                    is_draft,
                    has_attachments: email.has_attachment(),
                    size: email.size() as u64,
                    preview: email.preview().unwrap_or("").to_string(),
                });
            }
        }

        Ok(result)
    }

    // JMAP Sieve methods

    /// List all Sieve scripts
    pub async fn list_sieve_scripts(&self) -> Result<Vec<JmapSieveScript>, String> {
        let account = self.account.as_ref().ok_or("Not connected")?;
        let api_url = self.api_url.as_ref().ok_or("API URL not available")?;
        let account_id = self.account_id.as_ref().ok_or("Account ID not available")?;

        let http_client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let request_body = serde_json::json!({
            "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:sieve"],
            "methodCalls": [
                ["SieveScript/get", {
                    "accountId": account_id,
                    "ids": null
                }, "0"]
            ]
        });

        let response = http_client
            .post(api_url)
            .basic_auth(&account.username, Some(&account.password))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch Sieve scripts: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Server returned error: {}", response.status()));
        }

        let response_json: serde_json::Value = response.json().await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        // Extract scripts from response
        let scripts = response_json
            .get("methodResponses")
            .and_then(|mr| mr.get(0))
            .and_then(|r| r.get(1))
            .and_then(|data| data.get("list"))
            .and_then(|list| list.as_array())
            .ok_or("Invalid response format")?;

        let mut result = Vec::new();
        for script in scripts {
            result.push(JmapSieveScript {
                id: script.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                name: script.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                is_active: script.get("isActive").and_then(|v| v.as_bool()).unwrap_or(false),
                blob_id: script.get("blobId").and_then(|v| v.as_str()).map(|s| s.to_string()),
            });
        }

        Ok(result)
    }

    /// Get the content of a Sieve script
    pub async fn get_sieve_script_content(&self, blob_id: &str) -> Result<String, String> {
        let account = self.account.as_ref().ok_or("Not connected")?;
        let api_url = self.api_url.as_ref().ok_or("API URL not available")?;
        let account_id = self.account_id.as_ref().ok_or("Account ID not available")?;

        // JMAP uses downloadUrl template for blob downloads
        // The template typically looks like: https://server/jmap/download/{accountId}/{blobId}/{name}
        // We need to get it from the session, but for now we'll construct a reasonable URL
        let download_url = api_url.replace("/jmap", &format!("/jmap/download/{}/{}/script.sieve", account_id, blob_id));

        let http_client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let response = http_client
            .get(&download_url)
            .basic_auth(&account.username, Some(&account.password))
            .send()
            .await
            .map_err(|e| format!("Failed to download script: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Server returned error: {}", response.status()));
        }

        response.text().await.map_err(|e| format!("Failed to read script content: {}", e))
    }

    /// Create or update a Sieve script
    pub async fn set_sieve_script(&self, id: Option<&str>, name: &str, content: &str, is_active: bool) -> Result<String, String> {
        let account = self.account.as_ref().ok_or("Not connected")?;
        let api_url = self.api_url.as_ref().ok_or("API URL not available")?;
        let account_id = self.account_id.as_ref().ok_or("Account ID not available")?;

        let http_client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        // First, upload the blob
        let upload_url = api_url.replace("/jmap", &format!("/jmap/upload/{}", account_id));

        let upload_response = http_client
            .post(&upload_url)
            .basic_auth(&account.username, Some(&account.password))
            .header("Content-Type", "application/sieve")
            .body(content.to_string())
            .send()
            .await
            .map_err(|e| format!("Failed to upload script: {}", e))?;

        if !upload_response.status().is_success() {
            return Err(format!("Upload failed: {}", upload_response.status()));
        }

        let upload_result: serde_json::Value = upload_response.json().await
            .map_err(|e| format!("Failed to parse upload response: {}", e))?;

        let blob_id = upload_result.get("blobId")
            .and_then(|v| v.as_str())
            .ok_or("No blobId in upload response")?;

        // Then create/update the script
        let method_calls = if let Some(script_id) = id {
            // Update existing script
            serde_json::json!([
                ["SieveScript/set", {
                    "accountId": account_id,
                    "update": {
                        script_id: {
                            "name": name,
                            "blobId": blob_id
                        }
                    },
                    "onSuccessActivateScript": if is_active { Some(script_id) } else { None::<&str> }
                }, "0"]
            ])
        } else {
            // Create new script
            serde_json::json!([
                ["SieveScript/set", {
                    "accountId": account_id,
                    "create": {
                        "new": {
                            "name": name,
                            "blobId": blob_id
                        }
                    },
                    "onSuccessActivateScript": if is_active { Some("#new") } else { None::<&str> }
                }, "0"]
            ])
        };

        let request_body = serde_json::json!({
            "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:sieve"],
            "methodCalls": method_calls
        });

        let response = http_client
            .post(api_url)
            .basic_auth(&account.username, Some(&account.password))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Failed to set script: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Server returned error: {}", response.status()));
        }

        let response_json: serde_json::Value = response.json().await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        // Check for errors
        if let Some(error) = response_json.get("methodResponses")
            .and_then(|mr| mr.get(0))
            .and_then(|r| r.get(1))
            .and_then(|data| data.get("notCreated").or(data.get("notUpdated")))
            .and_then(|errors| errors.as_object())
            .and_then(|obj| obj.values().next())
        {
            return Err(format!("Script error: {:?}", error));
        }

        // Return the script ID (either the existing one or the newly created one)
        if let Some(script_id) = id {
            Ok(script_id.to_string())
        } else {
            response_json.get("methodResponses")
                .and_then(|mr| mr.get(0))
                .and_then(|r| r.get(1))
                .and_then(|data| data.get("created"))
                .and_then(|created| created.get("new"))
                .and_then(|new| new.get("id"))
                .and_then(|id| id.as_str())
                .map(|s| s.to_string())
                .ok_or_else(|| "Failed to get new script ID".to_string())
        }
    }

    /// Delete a Sieve script
    pub async fn delete_sieve_script(&self, script_id: &str) -> Result<(), String> {
        let account = self.account.as_ref().ok_or("Not connected")?;
        let api_url = self.api_url.as_ref().ok_or("API URL not available")?;
        let account_id = self.account_id.as_ref().ok_or("Account ID not available")?;

        let http_client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let request_body = serde_json::json!({
            "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:sieve"],
            "methodCalls": [
                ["SieveScript/set", {
                    "accountId": account_id,
                    "destroy": [script_id]
                }, "0"]
            ]
        });

        let response = http_client
            .post(api_url)
            .basic_auth(&account.username, Some(&account.password))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Failed to delete script: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Server returned error: {}", response.status()));
        }

        // Parse response to check for JMAP-level errors
        let response_body: serde_json::Value = response.json().await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        // Check for method-level errors
        if let Some(method_responses) = response_body.get("methodResponses").and_then(|v| v.as_array()) {
            for method_response in method_responses {
                if let Some(arr) = method_response.as_array() {
                    let method_name = arr.get(0).and_then(|v| v.as_str()).unwrap_or("");
                    let result = arr.get(1);

                    if method_name == "error" {
                        let error_type = result.and_then(|r| r.get("type")).and_then(|t| t.as_str()).unwrap_or("unknown");
                        let description = result.and_then(|r| r.get("description")).and_then(|d| d.as_str()).unwrap_or("");
                        return Err(format!("JMAP error: {} - {}", error_type, description));
                    }

                    if method_name == "SieveScript/set" {
                        // Check if script was not destroyed
                        if let Some(not_destroyed) = result.and_then(|r| r.get("notDestroyed")) {
                            if let Some(error_obj) = not_destroyed.get(script_id) {
                                let error_type = error_obj.get("type").and_then(|t| t.as_str()).unwrap_or("unknown");
                                let description = error_obj.get("description").and_then(|d| d.as_str()).unwrap_or("");
                                return Err(format!("Failed to delete script: {} - {}", error_type, description));
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Activate a Sieve script
    pub async fn activate_sieve_script(&self, script_id: &str) -> Result<(), String> {
        let account = self.account.as_ref().ok_or("Not connected")?;
        let api_url = self.api_url.as_ref().ok_or("API URL not available")?;
        let account_id = self.account_id.as_ref().ok_or("Account ID not available")?;

        let http_client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let request_body = serde_json::json!({
            "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:sieve"],
            "methodCalls": [
                ["SieveScript/set", {
                    "accountId": account_id,
                    "onSuccessActivateScript": script_id
                }, "0"]
            ]
        });

        let response = http_client
            .post(api_url)
            .basic_auth(&account.username, Some(&account.password))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Failed to activate script: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Server returned error: {}", response.status()));
        }

        Ok(())
    }

    /// Deactivate all Sieve scripts (set none as active)
    pub async fn deactivate_sieve_scripts(&self) -> Result<(), String> {
        let account = self.account.as_ref().ok_or("Not connected")?;
        let api_url = self.api_url.as_ref().ok_or("API URL not available")?;
        let account_id = self.account_id.as_ref().ok_or("Account ID not available")?;

        let http_client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let request_body = serde_json::json!({
            "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:sieve"],
            "methodCalls": [
                ["SieveScript/set", {
                    "accountId": account_id,
                    "onSuccessActivateScript": serde_json::Value::Null
                }, "0"]
            ]
        });

        let response = http_client
            .post(api_url)
            .basic_auth(&account.username, Some(&account.password))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Failed to deactivate scripts: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("Server returned error: {}", response.status()));
        }

        Ok(())
    }
}

fn format_email_address(addr: &jmap_client::email::EmailAddress) -> String {
    let name = addr.name();
    let email = addr.email();

    if let Some(n) = name {
        if !n.is_empty() {
            return format!("{} <{}>", n, email);
        }
    }
    email.to_string()
}

fn format_timestamp(ts: i64) -> String {
    Utc.timestamp_opt(ts, 0)
        .single()
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| ts.to_string())
}

fn sanitize_html(html: &str) -> String {
    ammonia::clean(html)
}
