use rusqlite::{Connection, params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::imap::client::{EmailHeader, Email, Attachment};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub email_count: u32,
    pub attachment_count: u32,
    pub total_size_bytes: u64,
    pub oldest_email: Option<String>,
    pub newest_email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub folder: String,
    pub last_sync: i64,
    pub highest_uid: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheSettings {
    pub enabled: bool,
    pub days: u32,
    pub cache_body: bool,
    pub cache_attachments: bool,
}

pub struct EmailCache {
    db: Connection,
    account_id: String,
}

fn get_cache_dir() -> Result<PathBuf, String> {
    let data_dir = dirs::data_local_dir()
        .ok_or("Could not find data directory")?
        .join("MailClient")
        .join("cache");

    if !data_dir.exists() {
        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Failed to create cache directory: {}", e))?;
    }

    Ok(data_dir)
}

fn sanitize_account_id(account_id: &str) -> String {
    // Replace characters that are invalid in filenames
    account_id
        .replace('@', "_at_")
        .replace('/', "_")
        .replace('\\', "_")
        .replace(':', "_")
}

impl EmailCache {
    pub fn new(account_id: &str) -> Result<Self, String> {
        let cache_dir = get_cache_dir()?;
        let db_path = cache_dir.join(format!("{}.db", sanitize_account_id(account_id)));

        let db = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open cache database: {}", e))?;

        // Create tables if they don't exist
        db.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS emails (
                uid INTEGER NOT NULL,
                folder TEXT NOT NULL,
                subject TEXT,
                from_addr TEXT,
                to_addr TEXT,
                cc TEXT,
                date TEXT,
                date_timestamp INTEGER,
                is_read INTEGER DEFAULT 0,
                has_attachments INTEGER DEFAULT 0,
                body_text TEXT,
                body_html TEXT,
                cached_at INTEGER NOT NULL,
                PRIMARY KEY (folder, uid)
            );

            CREATE TABLE IF NOT EXISTS attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email_uid INTEGER NOT NULL,
                folder TEXT NOT NULL,
                filename TEXT,
                mime_type TEXT,
                size INTEGER,
                data BLOB,
                FOREIGN KEY (email_uid, folder) REFERENCES emails(uid, folder) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS sync_state (
                folder TEXT PRIMARY KEY,
                last_sync INTEGER,
                highest_uid INTEGER
            );

            CREATE INDEX IF NOT EXISTS idx_emails_folder ON emails(folder);
            CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date_timestamp DESC);
            "
        ).map_err(|e| format!("Failed to create tables: {}", e))?;

        Ok(Self {
            db,
            account_id: account_id.to_string(),
        })
    }

    pub fn get_headers(&self, folder: &str, start: u32, limit: u32) -> Result<Vec<EmailHeader>, String> {
        let mut stmt = self.db.prepare(
            "SELECT uid, subject, from_addr, to_addr, date, is_read, has_attachments
             FROM emails
             WHERE folder = ?1
             ORDER BY date_timestamp DESC
             LIMIT ?2 OFFSET ?3"
        ).map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt.query_map(params![folder, limit, start], |row| {
            Ok(EmailHeader {
                uid: row.get(0)?,
                subject: row.get(1)?,
                from: row.get(2)?,
                to: row.get(3)?,
                date: row.get(4)?,
                is_read: row.get::<_, i32>(5)? != 0,
                is_flagged: false,
                is_answered: false,
                is_draft: false,
                flags: Vec::new(),
                has_attachments: row.get::<_, i32>(6)? != 0,
            })
        }).map_err(|e| format!("Failed to query headers: {}", e))?;

        let mut headers = Vec::new();
        for row in rows {
            headers.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
        }

        Ok(headers)
    }

    pub fn get_email(&self, folder: &str, uid: u32) -> Result<Option<Email>, String> {
        let mut stmt = self.db.prepare(
            "SELECT uid, subject, from_addr, to_addr, cc, date, body_text, body_html
             FROM emails
             WHERE folder = ?1 AND uid = ?2"
        ).map_err(|e| format!("Failed to prepare query: {}", e))?;

        let email = stmt.query_row(params![folder, uid], |row| {
            Ok(Email {
                uid: row.get(0)?,
                subject: row.get(1)?,
                from: row.get(2)?,
                to: row.get(3)?,
                cc: row.get(4)?,
                date: row.get(5)?,
                body_text: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                body_html: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                attachments: Vec::new(), // Will be loaded separately
                is_read: true,
                is_flagged: false,
                is_answered: false,
                is_draft: false,
                flags: Vec::new(),
            })
        }).optional().map_err(|e| format!("Failed to query email: {}", e))?;

        if let Some(mut email) = email {
            // Load attachments metadata
            email.attachments = self.get_attachments_metadata(folder, uid)?;
            Ok(Some(email))
        } else {
            Ok(None)
        }
    }

    fn get_attachments_metadata(&self, folder: &str, uid: u32) -> Result<Vec<Attachment>, String> {
        let mut stmt = self.db.prepare(
            "SELECT filename, mime_type, size FROM attachments WHERE folder = ?1 AND email_uid = ?2"
        ).map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt.query_map(params![folder, uid], |row| {
            Ok(Attachment {
                filename: row.get(0)?,
                mime_type: row.get(1)?,
                size: row.get(2)?,
                part_id: String::new(),
                encoding: "base64".to_string(),
            })
        }).map_err(|e| format!("Failed to query attachments: {}", e))?;

        let mut attachments = Vec::new();
        for row in rows {
            attachments.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
        }

        Ok(attachments)
    }

    pub fn store_header(&self, folder: &str, header: &EmailHeader) -> Result<(), String> {
        let timestamp = parse_date_to_timestamp(&header.date);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        self.db.execute(
            "INSERT OR REPLACE INTO emails
             (uid, folder, subject, from_addr, to_addr, date, date_timestamp, is_read, has_attachments, cached_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                header.uid,
                folder,
                header.subject,
                header.from,
                header.to,
                header.date,
                timestamp,
                header.is_read as i32,
                header.has_attachments as i32,
                now,
            ],
        ).map_err(|e| format!("Failed to store header: {}", e))?;

        Ok(())
    }

    pub fn store_headers(&self, folder: &str, headers: &[EmailHeader]) -> Result<(), String> {
        for header in headers {
            self.store_header(folder, header)?;
        }
        Ok(())
    }

    pub fn store_email_body(&self, folder: &str, uid: u32, body_text: &str, body_html: &str) -> Result<(), String> {
        self.db.execute(
            "UPDATE emails SET body_text = ?1, body_html = ?2 WHERE folder = ?3 AND uid = ?4",
            params![body_text, body_html, folder, uid],
        ).map_err(|e| format!("Failed to store email body: {}", e))?;

        Ok(())
    }

    pub fn store_email(&self, folder: &str, email: &Email) -> Result<(), String> {
        let timestamp = parse_date_to_timestamp(&email.date);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        self.db.execute(
            "INSERT OR REPLACE INTO emails
             (uid, folder, subject, from_addr, to_addr, cc, date, date_timestamp, is_read, has_attachments, body_text, body_html, cached_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                email.uid,
                folder,
                email.subject,
                email.from,
                email.to,
                email.cc,
                email.date,
                timestamp,
                0, // is_read will be updated separately
                !email.attachments.is_empty() as i32,
                email.body_text,
                email.body_html,
                now,
            ],
        ).map_err(|e| format!("Failed to store email: {}", e))?;

        // Store attachment metadata
        for att in &email.attachments {
            self.store_attachment_metadata(folder, email.uid, att)?;
        }

        Ok(())
    }

    fn store_attachment_metadata(&self, folder: &str, uid: u32, att: &Attachment) -> Result<(), String> {
        self.db.execute(
            "INSERT INTO attachments (email_uid, folder, filename, mime_type, size)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![uid, folder, att.filename, att.mime_type, att.size],
        ).map_err(|e| format!("Failed to store attachment metadata: {}", e))?;

        Ok(())
    }

    pub fn store_attachment_data(&self, folder: &str, uid: u32, filename: &str, data: &[u8]) -> Result<(), String> {
        self.db.execute(
            "UPDATE attachments SET data = ?1 WHERE folder = ?2 AND email_uid = ?3 AND filename = ?4",
            params![data, folder, uid, filename],
        ).map_err(|e| format!("Failed to store attachment data: {}", e))?;

        Ok(())
    }

    pub fn get_attachment_data(&self, folder: &str, uid: u32, filename: &str) -> Result<Option<Vec<u8>>, String> {
        let mut stmt = self.db.prepare(
            "SELECT data FROM attachments WHERE folder = ?1 AND email_uid = ?2 AND filename = ?3"
        ).map_err(|e| format!("Failed to prepare query: {}", e))?;

        let data = stmt.query_row(params![folder, uid, filename], |row| {
            row.get::<_, Option<Vec<u8>>>(0)
        }).optional().map_err(|e| format!("Failed to query attachment: {}", e))?;

        Ok(data.flatten())
    }

    pub fn get_sync_state(&self, folder: &str) -> Result<Option<SyncState>, String> {
        let mut stmt = self.db.prepare(
            "SELECT folder, last_sync, highest_uid FROM sync_state WHERE folder = ?1"
        ).map_err(|e| format!("Failed to prepare query: {}", e))?;

        let state = stmt.query_row(params![folder], |row| {
            Ok(SyncState {
                folder: row.get(0)?,
                last_sync: row.get(1)?,
                highest_uid: row.get(2)?,
            })
        }).optional().map_err(|e| format!("Failed to query sync state: {}", e))?;

        Ok(state)
    }

    pub fn set_sync_state(&self, folder: &str, highest_uid: u32) -> Result<(), String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        self.db.execute(
            "INSERT OR REPLACE INTO sync_state (folder, last_sync, highest_uid) VALUES (?1, ?2, ?3)",
            params![folder, now, highest_uid],
        ).map_err(|e| format!("Failed to set sync state: {}", e))?;

        Ok(())
    }

    pub fn update_read_status(&self, folder: &str, uid: u32, is_read: bool) -> Result<(), String> {
        self.db.execute(
            "UPDATE emails SET is_read = ?1 WHERE folder = ?2 AND uid = ?3",
            params![is_read as i32, folder, uid],
        ).map_err(|e| format!("Failed to update read status: {}", e))?;

        Ok(())
    }

    pub fn delete_email(&self, folder: &str, uid: u32) -> Result<(), String> {
        // Attachments will be deleted by CASCADE
        self.db.execute(
            "DELETE FROM emails WHERE folder = ?1 AND uid = ?2",
            params![folder, uid],
        ).map_err(|e| format!("Failed to delete email: {}", e))?;

        Ok(())
    }

    pub fn cleanup_old_emails(&self, days: u32) -> Result<u32, String> {
        if days == 0 {
            return Ok(0); // 0 means unlimited, don't delete anything
        }

        let cutoff = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64 - (days as i64 * 24 * 60 * 60);

        let deleted = self.db.execute(
            "DELETE FROM emails WHERE cached_at < ?1",
            params![cutoff],
        ).map_err(|e| format!("Failed to cleanup old emails: {}", e))?;

        Ok(deleted as u32)
    }

    pub fn search(&self, query: &str) -> Result<Vec<EmailHeader>, String> {
        let search_pattern = format!("%{}%", query);

        let mut stmt = self.db.prepare(
            "SELECT uid, folder, subject, from_addr, to_addr, date, is_read, has_attachments
             FROM emails
             WHERE subject LIKE ?1 OR from_addr LIKE ?1 OR to_addr LIKE ?1 OR body_text LIKE ?1
             ORDER BY date_timestamp DESC
             LIMIT 100"
        ).map_err(|e| format!("Failed to prepare search query: {}", e))?;

        let rows = stmt.query_map(params![search_pattern], |row| {
            Ok(EmailHeader {
                uid: row.get(0)?,
                subject: row.get(2)?,
                from: row.get(3)?,
                to: row.get(4)?,
                date: row.get(5)?,
                is_read: row.get::<_, i32>(6)? != 0,
                is_flagged: false,
                is_answered: false,
                is_draft: false,
                flags: Vec::new(),
                has_attachments: row.get::<_, i32>(7)? != 0,
            })
        }).map_err(|e| format!("Failed to execute search: {}", e))?;

        let mut headers = Vec::new();
        for row in rows {
            headers.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
        }

        Ok(headers)
    }

    pub fn get_stats(&self) -> Result<CacheStats, String> {
        let email_count: u32 = self.db.query_row(
            "SELECT COUNT(*) FROM emails",
            [],
            |row| row.get(0),
        ).map_err(|e| format!("Failed to count emails: {}", e))?;

        let attachment_count: u32 = self.db.query_row(
            "SELECT COUNT(*) FROM attachments",
            [],
            |row| row.get(0),
        ).map_err(|e| format!("Failed to count attachments: {}", e))?;

        // Get size of text content
        let text_size: i64 = self.db.query_row(
            "SELECT COALESCE(SUM(LENGTH(body_text) + LENGTH(body_html) + LENGTH(subject)), 0) FROM emails",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        // Get size of attachment data
        let attachment_size: i64 = self.db.query_row(
            "SELECT COALESCE(SUM(LENGTH(data)), 0) FROM attachments WHERE data IS NOT NULL",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        let oldest_email: Option<String> = self.db.query_row(
            "SELECT date FROM emails ORDER BY date_timestamp ASC LIMIT 1",
            [],
            |row| row.get(0),
        ).optional().map_err(|e| format!("Failed to get oldest email: {}", e))?.flatten();

        let newest_email: Option<String> = self.db.query_row(
            "SELECT date FROM emails ORDER BY date_timestamp DESC LIMIT 1",
            [],
            |row| row.get(0),
        ).optional().map_err(|e| format!("Failed to get newest email: {}", e))?.flatten();

        Ok(CacheStats {
            email_count,
            attachment_count,
            total_size_bytes: (text_size + attachment_size) as u64,
            oldest_email,
            newest_email,
        })
    }

    pub fn clear(&self) -> Result<(), String> {
        self.db.execute("DELETE FROM attachments", [])
            .map_err(|e| format!("Failed to clear attachments: {}", e))?;
        self.db.execute("DELETE FROM emails", [])
            .map_err(|e| format!("Failed to clear emails: {}", e))?;
        self.db.execute("DELETE FROM sync_state", [])
            .map_err(|e| format!("Failed to clear sync state: {}", e))?;

        // Vacuum to reclaim space
        self.db.execute("VACUUM", [])
            .map_err(|e| format!("Failed to vacuum database: {}", e))?;

        Ok(())
    }

    pub fn has_email_body(&self, folder: &str, uid: u32) -> Result<bool, String> {
        let has_body: bool = self.db.query_row(
            "SELECT body_text IS NOT NULL AND body_text != '' FROM emails WHERE folder = ?1 AND uid = ?2",
            params![folder, uid],
            |row| row.get(0),
        ).optional().map_err(|e| format!("Failed to check email body: {}", e))?.unwrap_or(false);

        Ok(has_body)
    }
}

fn parse_date_to_timestamp(date: &str) -> i64 {
    // Try to parse common email date formats
    use chrono::DateTime;

    // Try RFC 2822 format first
    if let Ok(dt) = DateTime::parse_from_rfc2822(date) {
        return dt.timestamp();
    }

    // Try some common variations
    let formats = [
        "%a, %d %b %Y %H:%M:%S %z",
        "%d %b %Y %H:%M:%S %z",
        "%a, %d %b %Y %H:%M:%S %Z",
    ];

    for format in &formats {
        if let Ok(dt) = DateTime::parse_from_str(date, format) {
            return dt.timestamp();
        }
    }

    // Fallback to current time if parsing fails
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}
