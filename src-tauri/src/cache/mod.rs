use rusqlite::{Connection, params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::imap::client::{EmailHeader, Email, Attachment};
use crate::ai::categorizer::{EmailCategory, get_default_categories};

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

            -- Categories table
            CREATE TABLE IF NOT EXISTS categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL,
                icon TEXT,
                is_system INTEGER DEFAULT 0,
                sort_order INTEGER DEFAULT 0
            );

            -- Email categories mapping
            CREATE TABLE IF NOT EXISTS email_categories (
                folder TEXT NOT NULL,
                uid INTEGER NOT NULL,
                category_id TEXT NOT NULL,
                confidence REAL DEFAULT 0.5,
                is_user_override INTEGER DEFAULT 0,
                categorized_at INTEGER NOT NULL,
                PRIMARY KEY (folder, uid)
            );

            CREATE INDEX IF NOT EXISTS idx_email_categories_category ON email_categories(category_id);
            "
        ).map_err(|e| format!("Failed to create tables: {}", e))?;

        // Initialize default categories if table is empty
        let category_count: i32 = db.query_row(
            "SELECT COUNT(*) FROM categories",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        if category_count == 0 {
            let default_categories = get_default_categories();
            for cat in default_categories {
                let _ = db.execute(
                    "INSERT OR IGNORE INTO categories (id, name, color, icon, is_system, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![cat.id, cat.name, cat.color, cat.icon, cat.is_system as i32, cat.sort_order],
                );
            }
        }

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

    // === Category Methods ===

    /// Get all categories
    pub fn get_categories(&self) -> Result<Vec<EmailCategory>, String> {
        let mut stmt = self.db.prepare(
            "SELECT id, name, color, icon, is_system, sort_order FROM categories ORDER BY sort_order"
        ).map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt.query_map([], |row| {
            Ok(EmailCategory {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                icon: row.get(3)?,
                is_system: row.get::<_, i32>(4)? != 0,
                sort_order: row.get(5)?,
            })
        }).map_err(|e| format!("Failed to query categories: {}", e))?;

        let mut categories = Vec::new();
        for row in rows {
            categories.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
        }

        Ok(categories)
    }

    /// Create a new category
    pub fn create_category(&self, name: &str, color: &str, icon: Option<&str>) -> Result<EmailCategory, String> {
        let id = format!("custom_{}", uuid::Uuid::new_v4().to_string().replace("-", "")[..8].to_string());

        // Get max sort order
        let max_order: i32 = self.db.query_row(
            "SELECT COALESCE(MAX(sort_order), 0) FROM categories",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        self.db.execute(
            "INSERT INTO categories (id, name, color, icon, is_system, sort_order) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
            params![id, name, color, icon, max_order + 1],
        ).map_err(|e| format!("Failed to create category: {}", e))?;

        Ok(EmailCategory {
            id,
            name: name.to_string(),
            color: color.to_string(),
            icon: icon.map(|s| s.to_string()),
            is_system: false,
            sort_order: max_order + 1,
        })
    }

    /// Update a category
    pub fn update_category(&self, id: &str, name: &str, color: &str, icon: Option<&str>) -> Result<(), String> {
        self.db.execute(
            "UPDATE categories SET name = ?1, color = ?2, icon = ?3 WHERE id = ?4 AND is_system = 0",
            params![name, color, icon, id],
        ).map_err(|e| format!("Failed to update category: {}", e))?;

        Ok(())
    }

    /// Delete a category (only non-system)
    pub fn delete_category(&self, id: &str) -> Result<(), String> {
        // First, remove all email associations
        self.db.execute(
            "DELETE FROM email_categories WHERE category_id = ?1",
            params![id],
        ).map_err(|e| format!("Failed to remove email categories: {}", e))?;

        // Then delete the category
        self.db.execute(
            "DELETE FROM categories WHERE id = ?1 AND is_system = 0",
            params![id],
        ).map_err(|e| format!("Failed to delete category: {}", e))?;

        Ok(())
    }

    /// Get category for an email
    pub fn get_email_category(&self, folder: &str, uid: u32) -> Result<Option<String>, String> {
        let category_id = self.db.query_row(
            "SELECT category_id FROM email_categories WHERE folder = ?1 AND uid = ?2",
            params![folder, uid],
            |row| row.get::<_, String>(0),
        ).optional().map_err(|e| format!("Failed to get email category: {}", e))?;

        Ok(category_id)
    }

    /// Set category for an email
    pub fn set_email_category(&self, folder: &str, uid: u32, category_id: &str, confidence: f32, is_user_override: bool) -> Result<(), String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        self.db.execute(
            "INSERT OR REPLACE INTO email_categories (folder, uid, category_id, confidence, is_user_override, categorized_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![folder, uid, category_id, confidence, is_user_override as i32, now],
        ).map_err(|e| format!("Failed to set email category: {}", e))?;

        Ok(())
    }

    /// Get uncategorized email UIDs in a folder
    pub fn get_uncategorized_emails(&self, folder: &str, limit: u32) -> Result<Vec<u32>, String> {
        let mut stmt = self.db.prepare(
            "SELECT e.uid FROM emails e
             LEFT JOIN email_categories ec ON e.folder = ec.folder AND e.uid = ec.uid
             WHERE e.folder = ?1 AND ec.uid IS NULL
             ORDER BY e.date_timestamp DESC
             LIMIT ?2"
        ).map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt.query_map(params![folder, limit], |row| {
            row.get::<_, u32>(0)
        }).map_err(|e| format!("Failed to query uncategorized emails: {}", e))?;

        let mut uids = Vec::new();
        for row in rows {
            uids.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
        }

        Ok(uids)
    }

    /// Get emails by category
    pub fn get_emails_by_category(&self, category_id: &str) -> Result<Vec<EmailHeader>, String> {
        let mut stmt = self.db.prepare(
            "SELECT e.uid, e.subject, e.from_addr, e.to_addr, e.date, e.is_read, e.has_attachments, e.folder
             FROM emails e
             JOIN email_categories ec ON e.folder = ec.folder AND e.uid = ec.uid
             WHERE ec.category_id = ?1
             ORDER BY e.date_timestamp DESC
             LIMIT 200"
        ).map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt.query_map(params![category_id], |row| {
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
        }).map_err(|e| format!("Failed to query emails by category: {}", e))?;

        let mut headers = Vec::new();
        for row in rows {
            headers.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
        }

        Ok(headers)
    }

    /// Get category counts (for badges)
    pub fn get_category_counts(&self, folder: &str) -> Result<Vec<(String, u32)>, String> {
        let mut stmt = self.db.prepare(
            "SELECT ec.category_id, COUNT(*) as cnt
             FROM email_categories ec
             JOIN emails e ON ec.folder = e.folder AND ec.uid = e.uid
             WHERE ec.folder = ?1 AND e.is_read = 0
             GROUP BY ec.category_id"
        ).map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt.query_map(params![folder], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
        }).map_err(|e| format!("Failed to query category counts: {}", e))?;

        let mut counts = Vec::new();
        for row in rows {
            counts.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
        }

        Ok(counts)
    }

    /// Get uncategorized count
    pub fn get_uncategorized_count(&self, folder: &str) -> Result<u32, String> {
        let count: u32 = self.db.query_row(
            "SELECT COUNT(*) FROM emails e
             LEFT JOIN email_categories ec ON e.folder = ec.folder AND e.uid = ec.uid
             WHERE e.folder = ?1 AND ec.uid IS NULL",
            params![folder],
            |row| row.get(0),
        ).map_err(|e| format!("Failed to count uncategorized emails: {}", e))?;

        Ok(count)
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
