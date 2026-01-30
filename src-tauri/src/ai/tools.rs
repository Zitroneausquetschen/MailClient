// AI Tools - Functions the AI can call to interact with emails
use serde::{Deserialize, Serialize};
use crate::cache;
use crate::imap::client::ImapClient;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Tool call request from AI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub name: String,
    pub arguments: HashMap<String, serde_json::Value>,
}

/// Tool call result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub success: bool,
    pub data: serde_json::Value,
    pub error: Option<String>,
}

/// Available tools for the AI
pub fn get_tools_description() -> &'static str {
    r#"Du hast Zugriff auf folgende Tools um mit E-Mails zu interagieren:

## Verfügbare Tools

### search_emails
Suche E-Mails nach Kriterien.
Argumente:
- query: Suchbegriff (Betreff, Absender oder Inhalt)
- folder: Optional, Ordner zum Suchen (Standard: INBOX)
- limit: Optional, maximale Anzahl (Standard: 10)

Beispiel: {"name": "search_emails", "arguments": {"query": "Mail Delivery System", "limit": 5}}

### get_email
Lese eine spezifische E-Mail.
Argumente:
- uid: E-Mail UID
- folder: Ordner der E-Mail

Beispiel: {"name": "get_email", "arguments": {"uid": 123, "folder": "INBOX"}}

### mark_as_read
Markiere E-Mails als gelesen.
Argumente:
- uids: Liste von E-Mail UIDs
- folder: Ordner der E-Mails

Beispiel: {"name": "mark_as_read", "arguments": {"uids": [123, 124, 125], "folder": "INBOX"}}

### mark_as_unread
Markiere E-Mails als ungelesen.
Argumente:
- uids: Liste von E-Mail UIDs
- folder: Ordner der E-Mails

Beispiel: {"name": "mark_as_unread", "arguments": {"uids": [123], "folder": "INBOX"}}

### move_emails
Verschiebe E-Mails in einen anderen Ordner.
Argumente:
- uids: Liste von E-Mail UIDs
- from_folder: Quell-Ordner
- to_folder: Ziel-Ordner

Beispiel: {"name": "move_emails", "arguments": {"uids": [123], "from_folder": "INBOX", "to_folder": "Archive"}}

### delete_emails
Lösche E-Mails (verschiebt in Papierkorb).
Argumente:
- uids: Liste von E-Mail UIDs
- folder: Ordner der E-Mails

Beispiel: {"name": "delete_emails", "arguments": {"uids": [123, 124], "folder": "INBOX"}}

### list_folders
Liste alle verfügbaren Ordner.
Keine Argumente.

Beispiel: {"name": "list_folders", "arguments": {}}

### count_unread
Zähle ungelesene E-Mails.
Argumente:
- folder: Optional, spezifischer Ordner (sonst alle)

Beispiel: {"name": "count_unread", "arguments": {"folder": "INBOX"}}

## Wichtige Regeln:
1. Wenn du ein Tool verwenden möchtest, antworte NUR mit dem JSON-Objekt, nichts anderes.
2. Warte auf das Ergebnis bevor du antwortest.
3. Bei kritischen Aktionen (löschen, verschieben) frage IMMER zuerst nach Bestätigung.
4. Beschreibe dem Benutzer was du tust.
"#
}

/// Parse a tool call from AI response
pub fn parse_tool_call(response: &str) -> Option<ToolCall> {
    let response = response.trim();

    // Try to find JSON in the response
    let json_start = response.find('{')?;
    let json_end = response.rfind('}')?;

    if json_end <= json_start {
        return None;
    }

    let json_str = &response[json_start..=json_end];

    // Try to parse as ToolCall
    serde_json::from_str(json_str).ok()
}

/// Execute a tool call
pub async fn execute_tool(
    tool_call: &ToolCall,
    account_id: &str,
    imap_clients: &Arc<Mutex<HashMap<String, ImapClient>>>,
) -> ToolResult {
    match tool_call.name.as_str() {
        "search_emails" => execute_search_emails(tool_call, account_id).await,
        "get_email" => execute_get_email(tool_call, account_id).await,
        "mark_as_read" => execute_mark_as_read(tool_call, account_id, imap_clients).await,
        "mark_as_unread" => execute_mark_as_unread(tool_call, account_id, imap_clients).await,
        "move_emails" => execute_move_emails(tool_call, account_id, imap_clients).await,
        "delete_emails" => execute_delete_emails(tool_call, account_id, imap_clients).await,
        "list_folders" => execute_list_folders(account_id).await,
        "count_unread" => execute_count_unread(tool_call, account_id).await,
        _ => ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some(format!("Unbekanntes Tool: {}", tool_call.name)),
        },
    }
}

async fn execute_search_emails(tool_call: &ToolCall, account_id: &str) -> ToolResult {
    let query = tool_call.arguments.get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let folder = tool_call.arguments.get("folder")
        .and_then(|v| v.as_str())
        .unwrap_or("INBOX");

    let limit = tool_call.arguments.get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(10) as usize;

    let cache = match cache::EmailCache::new(account_id) {
        Ok(c) => c,
        Err(e) => return ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some(e),
        },
    };

    match cache.search_emails(folder, query, limit) {
        Ok(emails) => {
            let results: Vec<serde_json::Value> = emails.iter().map(|e| {
                serde_json::json!({
                    "uid": e.uid,
                    "subject": e.subject,
                    "from": e.from,
                    "date": e.date,
                    "is_read": e.is_read,
                    "folder": folder,
                })
            }).collect();

            ToolResult {
                success: true,
                data: serde_json::json!({
                    "count": results.len(),
                    "emails": results,
                }),
                error: None,
            }
        }
        Err(e) => ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some(e),
        },
    }
}

async fn execute_get_email(tool_call: &ToolCall, account_id: &str) -> ToolResult {
    let uid = match tool_call.arguments.get("uid").and_then(|v| v.as_u64()) {
        Some(u) => u as u32,
        None => return ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some("uid ist erforderlich".to_string()),
        },
    };

    let folder = tool_call.arguments.get("folder")
        .and_then(|v| v.as_str())
        .unwrap_or("INBOX");

    let cache = match cache::EmailCache::new(account_id) {
        Ok(c) => c,
        Err(e) => return ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some(e),
        },
    };

    match cache.get_email(folder, uid) {
        Ok(Some(email)) => {
            let body_preview = if email.body_text.len() > 1000 {
                format!("{}...", &email.body_text[..1000])
            } else {
                email.body_text.clone()
            };

            ToolResult {
                success: true,
                data: serde_json::json!({
                    "uid": email.uid,
                    "subject": email.subject,
                    "from": email.from,
                    "to": email.to,
                    "date": email.date,
                    "body": body_preview,
                    "is_read": email.is_read,
                    "is_flagged": email.is_flagged,
                }),
                error: None,
            }
        }
        Ok(None) => ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some("E-Mail nicht gefunden".to_string()),
        },
        Err(e) => ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some(e),
        },
    }
}

async fn execute_mark_as_read(
    tool_call: &ToolCall,
    account_id: &str,
    imap_clients: &Arc<Mutex<HashMap<String, ImapClient>>>,
) -> ToolResult {
    let uids = match extract_uids(&tool_call.arguments) {
        Some(u) => u,
        None => return ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some("uids ist erforderlich".to_string()),
        },
    };

    let folder = tool_call.arguments.get("folder")
        .and_then(|v| v.as_str())
        .unwrap_or("INBOX");

    let clients = imap_clients.lock().await;
    let client = match clients.get(account_id) {
        Some(c) => c,
        None => return ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some("Nicht mit diesem Konto verbunden".to_string()),
        },
    };

    let mut success_count = 0;
    for uid in &uids {
        match client.add_flags(folder, *uid, &["\\Seen"]).await {
            Ok(_) => success_count += 1,
            Err(_) => {},
        }
    }

    // Update cache
    if let Ok(cache) = cache::EmailCache::new(account_id) {
        for uid in &uids {
            let _ = cache.update_email_flags(folder, *uid, true, None);
        }
    }

    ToolResult {
        success: true,
        data: serde_json::json!({
            "marked": success_count,
            "total": uids.len(),
        }),
        error: None,
    }
}

async fn execute_mark_as_unread(
    tool_call: &ToolCall,
    account_id: &str,
    imap_clients: &Arc<Mutex<HashMap<String, ImapClient>>>,
) -> ToolResult {
    let uids = match extract_uids(&tool_call.arguments) {
        Some(u) => u,
        None => return ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some("uids ist erforderlich".to_string()),
        },
    };

    let folder = tool_call.arguments.get("folder")
        .and_then(|v| v.as_str())
        .unwrap_or("INBOX");

    let clients = imap_clients.lock().await;
    let client = match clients.get(account_id) {
        Some(c) => c,
        None => return ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some("Nicht mit diesem Konto verbunden".to_string()),
        },
    };

    let mut success_count = 0;
    for uid in &uids {
        match client.remove_flags(folder, *uid, &["\\Seen"]).await {
            Ok(_) => success_count += 1,
            Err(_) => {},
        }
    }

    // Update cache
    if let Ok(cache) = cache::EmailCache::new(account_id) {
        for uid in &uids {
            let _ = cache.update_email_flags(folder, *uid, false, None);
        }
    }

    ToolResult {
        success: true,
        data: serde_json::json!({
            "marked": success_count,
            "total": uids.len(),
        }),
        error: None,
    }
}

async fn execute_move_emails(
    tool_call: &ToolCall,
    account_id: &str,
    imap_clients: &Arc<Mutex<HashMap<String, ImapClient>>>,
) -> ToolResult {
    let uids = match extract_uids(&tool_call.arguments) {
        Some(u) => u,
        None => return ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some("uids ist erforderlich".to_string()),
        },
    };

    let from_folder = match tool_call.arguments.get("from_folder").and_then(|v| v.as_str()) {
        Some(f) => f,
        None => return ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some("from_folder ist erforderlich".to_string()),
        },
    };

    let to_folder = match tool_call.arguments.get("to_folder").and_then(|v| v.as_str()) {
        Some(f) => f,
        None => return ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some("to_folder ist erforderlich".to_string()),
        },
    };

    let clients = imap_clients.lock().await;
    let client = match clients.get(account_id) {
        Some(c) => c,
        None => return ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some("Nicht mit diesem Konto verbunden".to_string()),
        },
    };

    let mut success_count = 0;
    for uid in &uids {
        match client.move_email(from_folder, *uid, to_folder).await {
            Ok(_) => success_count += 1,
            Err(_) => {},
        }
    }

    ToolResult {
        success: true,
        data: serde_json::json!({
            "moved": success_count,
            "total": uids.len(),
            "from": from_folder,
            "to": to_folder,
        }),
        error: None,
    }
}

async fn execute_delete_emails(
    tool_call: &ToolCall,
    account_id: &str,
    imap_clients: &Arc<Mutex<HashMap<String, ImapClient>>>,
) -> ToolResult {
    let uids = match extract_uids(&tool_call.arguments) {
        Some(u) => u,
        None => return ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some("uids ist erforderlich".to_string()),
        },
    };

    let folder = tool_call.arguments.get("folder")
        .and_then(|v| v.as_str())
        .unwrap_or("INBOX");

    let clients = imap_clients.lock().await;
    let client = match clients.get(account_id) {
        Some(c) => c,
        None => return ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some("Nicht mit diesem Konto verbunden".to_string()),
        },
    };

    let mut success_count = 0;
    for uid in &uids {
        match client.delete_email(folder, *uid).await {
            Ok(_) => success_count += 1,
            Err(_) => {},
        }
    }

    ToolResult {
        success: true,
        data: serde_json::json!({
            "deleted": success_count,
            "total": uids.len(),
        }),
        error: None,
    }
}

async fn execute_list_folders(account_id: &str) -> ToolResult {
    let cache = match cache::EmailCache::new(account_id) {
        Ok(c) => c,
        Err(e) => return ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some(e),
        },
    };

    match cache.get_folders() {
        Ok(folders) => {
            ToolResult {
                success: true,
                data: serde_json::json!({
                    "folders": folders,
                }),
                error: None,
            }
        }
        Err(e) => ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some(e),
        },
    }
}

async fn execute_count_unread(tool_call: &ToolCall, account_id: &str) -> ToolResult {
    let folder = tool_call.arguments.get("folder")
        .and_then(|v| v.as_str());

    let cache = match cache::EmailCache::new(account_id) {
        Ok(c) => c,
        Err(e) => return ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some(e),
        },
    };

    match cache.count_unread(folder) {
        Ok(count) => {
            ToolResult {
                success: true,
                data: serde_json::json!({
                    "unread": count,
                    "folder": folder.unwrap_or("alle"),
                }),
                error: None,
            }
        }
        Err(e) => ToolResult {
            success: false,
            data: serde_json::Value::Null,
            error: Some(e),
        },
    }
}

fn extract_uids(arguments: &HashMap<String, serde_json::Value>) -> Option<Vec<u32>> {
    let uids_value = arguments.get("uids")?;

    if let Some(arr) = uids_value.as_array() {
        let uids: Vec<u32> = arr.iter()
            .filter_map(|v| v.as_u64().map(|u| u as u32))
            .collect();
        if uids.is_empty() {
            None
        } else {
            Some(uids)
        }
    } else if let Some(uid) = uids_value.as_u64() {
        Some(vec![uid as u32])
    } else {
        None
    }
}
