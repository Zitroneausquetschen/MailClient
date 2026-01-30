mod ai;
mod autoconfig;
mod cache;
mod caldav;
mod carddav;
mod cloud;
mod imap;
mod jmap;
mod sieve;
mod smtp;
mod storage;

use ai::{AIConfig, AIProviderType, LocalModel, EmailAnalysis, ExtractedDeadline};
use autoconfig::AutoConfigResult;
use cache::{EmailCache, CacheStats};
use caldav::client::{CalDavClient, Calendar, CalendarEvent, CalDavTask};
use carddav::client::{CardDavClient, Contact};
use imap::client::{Email, EmailHeader, Folder, ImapClient, MailAccount};
use jmap::client::{JmapClient, JmapAccount, JmapMailbox, JmapEmailHeader, JmapEmail, JmapOutgoingEmail};
use sieve::client::{SieveClient, SieveScript, SieveRule, rules_to_sieve_script, parse_sieve_script};
use smtp::client::{OutgoingEmail, SmtpClient};
use storage::SavedAccount;
use std::collections::HashMap;
use std::sync::Arc;
use std::io::Write;
use serde::{Deserialize, Serialize};
use tauri::{State, Emitter};
use tokio::sync::Mutex;

fn log_to_file(msg: &str) {
    if let Some(dir) = dirs::data_local_dir() {
        let log_path = dir.join("MailClient").join("debug.log");
        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
            let _ = writeln!(file, "[{}] {}", timestamp, msg);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedAccount {
    pub id: String,
    pub display_name: String,
    pub email: String,
}

pub struct AppState {
    // Multiple IMAP clients indexed by account ID
    imap_clients: Arc<Mutex<HashMap<String, ImapClient>>>,
    // Multiple JMAP clients indexed by account ID
    jmap_clients: Arc<Mutex<HashMap<String, JmapClient>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            imap_clients: Arc::new(Mutex::new(HashMap::new())),
            jmap_clients: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[tauri::command]
async fn connect(state: State<'_, AppState>, account: MailAccount) -> Result<ConnectedAccount, String> {
    let account_id = account.username.clone();
    let display_name = account.display_name.clone();
    let email = account.username.clone();

    let mut client = ImapClient::new();
    client.connect(account).await?;

    let mut clients = state.imap_clients.lock().await;
    clients.insert(account_id.clone(), client);

    Ok(ConnectedAccount {
        id: account_id,
        display_name,
        email,
    })
}

#[tauri::command]
async fn disconnect(state: State<'_, AppState>, account_id: String) -> Result<(), String> {
    let mut clients = state.imap_clients.lock().await;
    if let Some(mut client) = clients.remove(&account_id) {
        client.disconnect().await?;
    }
    Ok(())
}

#[tauri::command]
async fn disconnect_all(state: State<'_, AppState>) -> Result<(), String> {
    let mut clients = state.imap_clients.lock().await;
    for (_, mut client) in clients.drain() {
        let _ = client.disconnect().await;
    }
    Ok(())
}

#[tauri::command]
async fn get_connected_accounts(state: State<'_, AppState>) -> Result<Vec<ConnectedAccount>, String> {
    let clients = state.imap_clients.lock().await;
    let accounts: Vec<ConnectedAccount> = clients
        .iter()
        .filter_map(|(id, client)| {
            client.get_account().map(|acc| ConnectedAccount {
                id: id.clone(),
                display_name: acc.display_name.clone(),
                email: acc.username.clone(),
            })
        })
        .collect();
    Ok(accounts)
}

#[derive(serde::Serialize)]
struct ProtocolStatus {
    protocol: String,
    connected: bool,
    error: Option<String>,
}

#[derive(serde::Serialize)]
struct AccountStatus {
    account_id: String,
    protocols: Vec<ProtocolStatus>,
}

#[tauri::command]
async fn get_account_status(state: State<'_, AppState>, account_id: String) -> Result<AccountStatus, String> {
    let mut protocols = Vec::new();

    // Check if it's a JMAP account
    if account_id.starts_with("jmap_") {
        let jmap_clients = state.jmap_clients.lock().await;
        let jmap_connected = jmap_clients.contains_key(&account_id);
        protocols.push(ProtocolStatus {
            protocol: "JMAP".to_string(),
            connected: jmap_connected,
            error: if jmap_connected { None } else { Some("Not connected".to_string()) },
        });

        // JMAP handles mail submission internally
        protocols.push(ProtocolStatus {
            protocol: "JMAP Submission".to_string(),
            connected: jmap_connected,
            error: if jmap_connected { None } else { Some("Not connected".to_string()) },
        });
    } else {
        // IMAP account - check IMAP connection
        let imap_clients = state.imap_clients.lock().await;
        let imap_connected = imap_clients.contains_key(&account_id);
        protocols.push(ProtocolStatus {
            protocol: "IMAP".to_string(),
            connected: imap_connected,
            error: if imap_connected { None } else { Some("Not connected".to_string()) },
        });

        // SMTP connects on-demand when sending mail
        protocols.push(ProtocolStatus {
            protocol: "SMTP".to_string(),
            connected: true, // SMTP is stateless, connects per send
            error: None,
        });

        // Sieve connects on-demand when managing filters
        protocols.push(ProtocolStatus {
            protocol: "Sieve".to_string(),
            connected: true, // Sieve is stateless, connects per operation
            error: None,
        });
    }

    Ok(AccountStatus {
        account_id,
        protocols,
    })
}

#[tauri::command]
async fn list_folders(state: State<'_, AppState>, account_id: String) -> Result<Vec<Folder>, String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.list_folders().await
}

#[tauri::command]
async fn select_folder(state: State<'_, AppState>, account_id: String, folder: String) -> Result<(u32, u32), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.select_folder(&folder).await
}

#[tauri::command]
async fn fetch_headers(
    state: State<'_, AppState>,
    account_id: String,
    folder: String,
    start: u32,
    count: u32,
) -> Result<Vec<EmailHeader>, String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.fetch_headers(&folder, start, count).await
}

#[tauri::command]
async fn fetch_email(
    state: State<'_, AppState>,
    account_id: String,
    folder: String,
    uid: u32,
) -> Result<Email, String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.fetch_email(&folder, uid).await
}

#[tauri::command]
async fn mark_read(state: State<'_, AppState>, account_id: String, folder: String, uid: u32) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.mark_read(&folder, uid).await
}

#[tauri::command]
async fn delete_email(state: State<'_, AppState>, account_id: String, folder: String, uid: u32) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.delete_email(&folder, uid).await
}

#[tauri::command]
async fn move_email(
    state: State<'_, AppState>,
    account_id: String,
    folder: String,
    uid: u32,
    target_folder: String,
) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.move_email(&folder, uid, &target_folder).await
}

// Flag operations
#[tauri::command]
async fn mark_flagged(state: State<'_, AppState>, account_id: String, folder: String, uid: u32) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.mark_flagged(&folder, uid).await
}

#[tauri::command]
async fn unmark_flagged(state: State<'_, AppState>, account_id: String, folder: String, uid: u32) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.unmark_flagged(&folder, uid).await
}

#[tauri::command]
async fn mark_unread(state: State<'_, AppState>, account_id: String, folder: String, uid: u32) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.mark_unread(&folder, uid).await
}

#[tauri::command]
async fn add_flags(
    state: State<'_, AppState>,
    account_id: String,
    folder: String,
    uid: u32,
    flags: Vec<String>,
) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    let flag_refs: Vec<&str> = flags.iter().map(|s| s.as_str()).collect();
    client.add_flags(&folder, uid, &flag_refs).await
}

#[tauri::command]
async fn remove_flags(
    state: State<'_, AppState>,
    account_id: String,
    folder: String,
    uid: u32,
    flags: Vec<String>,
) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    let flag_refs: Vec<&str> = flags.iter().map(|s| s.as_str()).collect();
    client.remove_flags(&folder, uid, &flag_refs).await
}

// Folder operations
#[tauri::command]
async fn create_folder(state: State<'_, AppState>, account_id: String, folder_name: String) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.create_folder(&folder_name).await
}

#[tauri::command]
async fn delete_folder(state: State<'_, AppState>, account_id: String, folder_name: String) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.delete_folder(&folder_name).await
}

#[tauri::command]
async fn rename_folder(
    state: State<'_, AppState>,
    account_id: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.rename_folder(&old_name, &new_name).await
}

// Attachment operations
#[tauri::command]
async fn download_attachment(
    state: State<'_, AppState>,
    account_id: String,
    folder: String,
    uid: u32,
    part_id: String,
    filename: String,
) -> Result<String, String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;

    // Get the attachment data
    let data = client.get_attachment(&folder, uid, &part_id).await?;

    // Get the downloads directory
    let downloads_dir = dirs::download_dir()
        .ok_or("Could not find downloads directory")?;

    // Sanitize filename to prevent path traversal
    let safe_filename = filename
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_' || *c == ' ')
        .collect::<String>();

    let file_path = downloads_dir.join(&safe_filename);

    // Handle duplicate filenames
    let final_path = if file_path.exists() {
        let stem = file_path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ext = file_path.extension().and_then(|s| s.to_str()).unwrap_or("");
        let mut counter = 1;
        loop {
            let new_name = if ext.is_empty() {
                format!("{} ({})", stem, counter)
            } else {
                format!("{} ({}).{}", stem, counter, ext)
            };
            let new_path = downloads_dir.join(&new_name);
            if !new_path.exists() {
                break new_path;
            }
            counter += 1;
        }
    } else {
        file_path
    };

    // Write the file
    std::fs::write(&final_path, &data)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(final_path.to_string_lossy().to_string())
}

// Bulk operations
#[tauri::command]
async fn bulk_mark_read(
    state: State<'_, AppState>,
    account_id: String,
    folder: String,
    uids: Vec<u32>,
) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.bulk_mark_read(&folder, &uids).await
}

#[tauri::command]
async fn bulk_mark_unread(
    state: State<'_, AppState>,
    account_id: String,
    folder: String,
    uids: Vec<u32>,
) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.bulk_mark_unread(&folder, &uids).await
}

#[tauri::command]
async fn bulk_mark_flagged(
    state: State<'_, AppState>,
    account_id: String,
    folder: String,
    uids: Vec<u32>,
) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.bulk_mark_flagged(&folder, &uids).await
}

#[tauri::command]
async fn bulk_delete(
    state: State<'_, AppState>,
    account_id: String,
    folder: String,
    uids: Vec<u32>,
) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.bulk_delete(&folder, &uids).await
}

#[tauri::command]
async fn bulk_move(
    state: State<'_, AppState>,
    account_id: String,
    folder: String,
    uids: Vec<u32>,
    target_folder: String,
) -> Result<(), String> {
    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;
    client.bulk_move(&folder, &uids, &target_folder).await
}

#[tauri::command]
async fn send_email(state: State<'_, AppState>, account_id: String, email: OutgoingEmail) -> Result<(), String> {
    log_to_file(&format!("send_email called for account: {}", account_id));

    let clients = state.imap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("Account not connected")?;

    let account = client
        .get_account()
        .ok_or("Account not configured")?;
    log_to_file(&format!("Got account: {}:{}", account.smtp_host, account.smtp_port));

    let smtp_client = SmtpClient::new(
        account.smtp_host.clone(),
        account.smtp_port,
        account.username.clone(),
        account.password.clone(),
        account.display_name.clone(),
    );

    // Release the lock before sending SMTP
    drop(clients);
    log_to_file("Released lock, starting send...");

    // Send email and get raw message bytes
    let raw_message = smtp_client.send_email(email).await?;
    log_to_file("Email sent via SMTP, saving to Sent folder...");

    // Save to Sent folder via IMAP
    let clients = state.imap_clients.lock().await;
    if let Some(client) = clients.get(&account_id) {
        match client.append_to_sent(&raw_message).await {
            Ok(_) => log_to_file("Saved to Sent folder"),
            Err(e) => log_to_file(&format!("Failed to save to Sent: {}", e)),
        }
    }

    Ok(())
}

#[tauri::command]
async fn lookup_autoconfig(email: String) -> Result<AutoConfigResult, String> {
    autoconfig::lookup_autoconfig(&email).await
}

#[tauri::command]
async fn lookup_jmap_url(email: String) -> Result<autoconfig::JmapDiscoveryResult, String> {
    autoconfig::lookup_jmap_url(&email).await
}

#[tauri::command]
fn get_saved_accounts() -> Result<Vec<SavedAccount>, String> {
    storage::load_accounts()
}

#[tauri::command]
fn save_account(account: SavedAccount) -> Result<(), String> {
    storage::save_account(account)
}

#[tauri::command]
fn delete_saved_account(account_id: String) -> Result<(), String> {
    storage::delete_account(&account_id)
}

// JMAP account storage commands
#[tauri::command]
fn get_saved_jmap_accounts() -> Result<Vec<storage::SavedJmapAccount>, String> {
    storage::load_jmap_accounts()
}

#[tauri::command]
fn save_jmap_account(account: storage::SavedJmapAccount) -> Result<(), String> {
    storage::save_jmap_account(account)
}

#[tauri::command]
fn delete_saved_jmap_account(account_id: String) -> Result<(), String> {
    storage::delete_jmap_account(&account_id)
}

// Sieve commands
#[tauri::command]
async fn sieve_list_scripts(host: String, port: u16, username: String, password: String) -> Result<Vec<SieveScript>, String> {
    let mut client = SieveClient::new(host, port);
    client.connect(&username, &password).await.map_err(|e| e.to_string())?;
    let scripts = client.list_scripts().await.map_err(|e| e.to_string())?;
    let _ = client.disconnect().await;
    Ok(scripts)
}

#[tauri::command]
async fn sieve_get_script(host: String, port: u16, username: String, password: String, name: String) -> Result<String, String> {
    let mut client = SieveClient::new(host, port);
    client.connect(&username, &password).await.map_err(|e| e.to_string())?;
    let content = client.get_script(&name).await.map_err(|e| e.to_string())?;
    let _ = client.disconnect().await;
    Ok(content)
}

#[tauri::command]
async fn sieve_save_script(host: String, port: u16, username: String, password: String, name: String, content: String) -> Result<(), String> {
    let mut client = SieveClient::new(host, port);
    client.connect(&username, &password).await.map_err(|e| e.to_string())?;
    client.put_script(&name, &content).await.map_err(|e| e.to_string())?;
    let _ = client.disconnect().await;
    Ok(())
}

#[tauri::command]
async fn sieve_activate_script(host: String, port: u16, username: String, password: String, name: String) -> Result<(), String> {
    let mut client = SieveClient::new(host, port);
    client.connect(&username, &password).await.map_err(|e| e.to_string())?;
    client.activate_script(&name).await.map_err(|e| e.to_string())?;
    let _ = client.disconnect().await;
    Ok(())
}

#[tauri::command]
async fn sieve_delete_script(host: String, port: u16, username: String, password: String, name: String) -> Result<(), String> {
    let mut client = SieveClient::new(host, port);
    client.connect(&username, &password).await.map_err(|e| e.to_string())?;
    client.delete_script(&name).await.map_err(|e| e.to_string())?;
    let _ = client.disconnect().await;
    Ok(())
}

#[tauri::command]
async fn sieve_get_rules(host: String, port: u16, username: String, password: String, script_name: String) -> Result<Vec<SieveRule>, String> {
    let mut client = SieveClient::new(host, port);
    client.connect(&username, &password).await.map_err(|e| e.to_string())?;
    let content = client.get_script(&script_name).await.map_err(|e| e.to_string())?;
    let _ = client.disconnect().await;
    Ok(parse_sieve_script(&content))
}

#[tauri::command]
async fn sieve_save_rules(host: String, port: u16, username: String, password: String, script_name: String, rules: Vec<SieveRule>) -> Result<(), String> {
    let content = rules_to_sieve_script(&rules);
    let mut client = SieveClient::new(host, port);
    client.connect(&username, &password).await.map_err(|e| e.to_string())?;
    client.put_script(&script_name, &content).await.map_err(|e| e.to_string())?;
    let _ = client.disconnect().await;
    Ok(())
}

// CardDAV commands
#[tauri::command]
async fn fetch_contacts(host: String, username: String, password: String) -> Result<Vec<Contact>, String> {
    let carddav_url = CardDavClient::discover_url(&host, &username);
    let client = CardDavClient::new(&carddav_url, &username, &password);
    client.fetch_contacts().await
}

#[tauri::command]
async fn test_carddav_connection(host: String, username: String, password: String) -> Result<bool, String> {
    let carddav_url = CardDavClient::discover_url(&host, &username);
    let client = CardDavClient::new(&carddav_url, &username, &password);
    client.test_connection().await
}

#[tauri::command]
async fn create_contact(host: String, username: String, password: String, contact: Contact) -> Result<String, String> {
    let carddav_url = CardDavClient::discover_url(&host, &username);
    let client = CardDavClient::new(&carddav_url, &username, &password);
    client.create_contact(&contact).await
}

#[tauri::command]
async fn update_contact(host: String, username: String, password: String, contact: Contact) -> Result<(), String> {
    let carddav_url = CardDavClient::discover_url(&host, &username);
    let client = CardDavClient::new(&carddav_url, &username, &password);
    client.update_contact(&contact).await
}

#[tauri::command]
async fn delete_contact(host: String, username: String, password: String, contact_id: String) -> Result<(), String> {
    let carddav_url = CardDavClient::discover_url(&host, &username);
    let client = CardDavClient::new(&carddav_url, &username, &password);
    client.delete_contact(&contact_id).await
}

// CalDAV commands
#[tauri::command]
async fn fetch_calendars(host: String, username: String, password: String) -> Result<Vec<Calendar>, String> {
    log_to_file(&format!("[CalDAV] fetch_calendars called with host: {}, username: {}", host, username));
    let caldav_url = CalDavClient::discover_url(&host, &username);
    log_to_file(&format!("[CalDAV] Constructed URL: {}", caldav_url));
    println!("[CalDAV] Fetching calendars from URL: {}", caldav_url);
    let client = CalDavClient::new(&caldav_url, &username, &password);
    let result = client.fetch_calendars().await;
    log_to_file(&format!("[CalDAV] Result: {:?}", result));
    println!("[CalDAV] Result: {:?}", result);
    result
}

#[tauri::command]
async fn fetch_calendar_events(
    host: String,
    username: String,
    password: String,
    calendar_id: String,
    start: String,
    end: String
) -> Result<Vec<CalendarEvent>, String> {
    let caldav_url = CalDavClient::discover_url(&host, &username);
    let client = CalDavClient::new(&caldav_url, &username, &password);
    client.fetch_events(&calendar_id, &start, &end).await
}

#[tauri::command]
async fn create_calendar_event(
    host: String,
    username: String,
    password: String,
    calendar_id: String,
    event: CalendarEvent
) -> Result<String, String> {
    let caldav_url = CalDavClient::discover_url(&host, &username);
    let client = CalDavClient::new(&caldav_url, &username, &password);
    client.create_event(&calendar_id, &event).await
}

#[tauri::command]
async fn update_calendar_event(
    host: String,
    username: String,
    password: String,
    calendar_id: String,
    event: CalendarEvent
) -> Result<(), String> {
    let caldav_url = CalDavClient::discover_url(&host, &username);
    let client = CalDavClient::new(&caldav_url, &username, &password);
    client.update_event(&calendar_id, &event).await
}

#[tauri::command]
async fn delete_calendar_event(
    host: String,
    username: String,
    password: String,
    calendar_id: String,
    event_id: String
) -> Result<(), String> {
    let caldav_url = CalDavClient::discover_url(&host, &username);
    let client = CalDavClient::new(&caldav_url, &username, &password);
    client.delete_event(&calendar_id, &event_id).await
}

// CalDAV Task commands
#[tauri::command]
async fn fetch_caldav_tasks(
    host: String,
    username: String,
    password: String,
    calendar_id: String
) -> Result<Vec<CalDavTask>, String> {
    let caldav_url = CalDavClient::discover_url(&host, &username);
    let client = CalDavClient::new(&caldav_url, &username, &password);
    client.fetch_tasks(&calendar_id).await
}

#[tauri::command]
async fn create_caldav_task(
    host: String,
    username: String,
    password: String,
    calendar_id: String,
    task: CalDavTask
) -> Result<String, String> {
    let caldav_url = CalDavClient::discover_url(&host, &username);
    let client = CalDavClient::new(&caldav_url, &username, &password);
    client.create_task(&calendar_id, &task).await
}

#[tauri::command]
async fn update_caldav_task(
    host: String,
    username: String,
    password: String,
    calendar_id: String,
    task: CalDavTask
) -> Result<(), String> {
    let caldav_url = CalDavClient::discover_url(&host, &username);
    let client = CalDavClient::new(&caldav_url, &username, &password);
    client.update_task(&calendar_id, &task).await
}

#[tauri::command]
async fn delete_caldav_task(
    host: String,
    username: String,
    password: String,
    calendar_id: String,
    task_id: String
) -> Result<(), String> {
    let caldav_url = CalDavClient::discover_url(&host, &username);
    let client = CalDavClient::new(&caldav_url, &username, &password);
    client.delete_task(&calendar_id, &task_id).await
}

// Cache commands
#[tauri::command]
fn get_cached_headers(account_id: String, folder: String, start: u32, count: u32) -> Result<Vec<EmailHeader>, String> {
    let cache = EmailCache::new(&account_id)?;
    cache.get_headers(&folder, start, count)
}

#[tauri::command]
fn get_cached_email(account_id: String, folder: String, uid: u32) -> Result<Option<Email>, String> {
    let cache = EmailCache::new(&account_id)?;
    cache.get_email(&folder, uid)
}

#[tauri::command]
fn cache_headers(account_id: String, folder: String, headers: Vec<EmailHeader>) -> Result<(), String> {
    let cache = EmailCache::new(&account_id)?;
    cache.store_headers(&folder, &headers)
}

#[tauri::command]
fn cache_email(account_id: String, folder: String, email: Email) -> Result<(), String> {
    let cache = EmailCache::new(&account_id)?;
    cache.store_email(&folder, &email)
}

#[tauri::command]
fn update_cache_read_status(account_id: String, folder: String, uid: u32, is_read: bool) -> Result<(), String> {
    let cache = EmailCache::new(&account_id)?;
    cache.update_read_status(&folder, uid, is_read)
}

#[tauri::command]
fn delete_cached_email(account_id: String, folder: String, uid: u32) -> Result<(), String> {
    let cache = EmailCache::new(&account_id)?;
    cache.delete_email(&folder, uid)
}

#[tauri::command]
fn search_cached_emails(account_id: String, query: String) -> Result<Vec<EmailHeader>, String> {
    let cache = EmailCache::new(&account_id)?;
    cache.search(&query)
}

#[tauri::command]
fn get_cache_stats(account_id: String) -> Result<CacheStats, String> {
    let cache = EmailCache::new(&account_id)?;
    cache.get_stats()
}

#[tauri::command]
fn clear_cache(account_id: String) -> Result<(), String> {
    let cache = EmailCache::new(&account_id)?;
    cache.clear()
}

#[tauri::command]
fn cleanup_old_cache(account_id: String, days: u32) -> Result<u32, String> {
    let cache = EmailCache::new(&account_id)?;
    cache.cleanup_old_emails(days)
}

#[tauri::command]
fn get_cache_sync_state(account_id: String, folder: String) -> Result<Option<cache::SyncState>, String> {
    let cache = EmailCache::new(&account_id)?;
    cache.get_sync_state(&folder)
}

#[tauri::command]
fn set_cache_sync_state(account_id: String, folder: String, highest_uid: u32) -> Result<(), String> {
    let cache = EmailCache::new(&account_id)?;
    cache.set_sync_state(&folder, highest_uid)
}

#[tauri::command]
fn has_cached_email_body(account_id: String, folder: String, uid: u32) -> Result<bool, String> {
    let cache = EmailCache::new(&account_id)?;
    cache.has_email_body(&folder, uid)
}

// JMAP commands
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JmapConnectedAccount {
    pub id: String,
    pub display_name: String,
    pub email: String,
    pub protocol: String,
}

// Debug command to test JMAP connection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JmapDebugInfo {
    pub original_url: String,
    pub final_url: String,
    pub api_url: String,
    pub status: String,
    pub error: Option<String>,
}

#[tauri::command]
async fn debug_jmap_connection(jmap_url: String, username: String, password: String) -> Result<JmapDebugInfo, String> {
    let base_url = jmap_url
        .trim_end_matches('/')
        .trim_end_matches("/.well-known/jmap")
        .trim_end_matches(".well-known/jmap")
        .to_string();

    let http_client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let well_known_url = format!("{}/.well-known/jmap", base_url);

    let response = match http_client
        .get(&well_known_url)
        .basic_auth(&username, Some(&password))
        .header("Accept", "application/json")
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return Ok(JmapDebugInfo {
                original_url: well_known_url,
                final_url: "N/A".to_string(),
                api_url: "N/A".to_string(),
                status: "Request failed".to_string(),
                error: Some(format!("{}", e)),
            });
        }
    };

    let status = response.status().to_string();
    let final_url = response.url().to_string();

    if !response.status().is_success() {
        return Ok(JmapDebugInfo {
            original_url: well_known_url,
            final_url,
            api_url: "N/A".to_string(),
            status,
            error: Some("Server returned error status".to_string()),
        });
    }

    let json: serde_json::Value = match response.json().await {
        Ok(j) => j,
        Err(e) => {
            return Ok(JmapDebugInfo {
                original_url: well_known_url,
                final_url,
                api_url: "N/A".to_string(),
                status,
                error: Some(format!("Failed to parse JSON: {}", e)),
            });
        }
    };

    let api_url = json
        .get("apiUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("N/A")
        .to_string();

    Ok(JmapDebugInfo {
        original_url: well_known_url,
        final_url,
        api_url,
        status,
        error: None,
    })
}

#[tauri::command]
async fn jmap_connect(state: State<'_, AppState>, account: JmapAccount) -> Result<JmapConnectedAccount, String> {
    // Use jmap_ prefix to match the saved account ID format
    let account_id = format!("jmap_{}", account.username);
    let display_name = account.display_name.clone();
    let email = account.username.clone();

    let mut client = JmapClient::new();
    client.connect(account).await?;

    let mut clients = state.jmap_clients.lock().await;
    clients.insert(account_id.clone(), client);

    Ok(JmapConnectedAccount {
        id: account_id,
        display_name,
        email,
        protocol: "jmap".to_string(),
    })
}

#[tauri::command]
async fn jmap_disconnect(state: State<'_, AppState>, account_id: String) -> Result<(), String> {
    let mut clients = state.jmap_clients.lock().await;
    if let Some(mut client) = clients.remove(&account_id) {
        client.disconnect().await?;
    }
    Ok(())
}

#[tauri::command]
async fn jmap_list_mailboxes(state: State<'_, AppState>, account_id: String) -> Result<Vec<JmapMailbox>, String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.list_mailboxes().await
}

#[tauri::command]
async fn jmap_fetch_email_list(
    state: State<'_, AppState>,
    account_id: String,
    mailbox_id: String,
    position: u32,
    limit: u32,
) -> Result<Vec<JmapEmailHeader>, String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.fetch_email_list(&mailbox_id, position, limit).await
}

#[tauri::command]
async fn jmap_fetch_email(
    state: State<'_, AppState>,
    account_id: String,
    email_id: String,
) -> Result<JmapEmail, String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.fetch_email(&email_id).await
}

#[tauri::command]
async fn jmap_mark_read(state: State<'_, AppState>, account_id: String, email_id: String) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.mark_read(&email_id).await
}

#[tauri::command]
async fn jmap_mark_unread(state: State<'_, AppState>, account_id: String, email_id: String) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.mark_unread(&email_id).await
}

#[tauri::command]
async fn jmap_mark_flagged(state: State<'_, AppState>, account_id: String, email_id: String) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.mark_flagged(&email_id).await
}

#[tauri::command]
async fn jmap_unmark_flagged(state: State<'_, AppState>, account_id: String, email_id: String) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.unmark_flagged(&email_id).await
}

#[tauri::command]
async fn jmap_delete_email(state: State<'_, AppState>, account_id: String, email_id: String) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.delete_email(&email_id).await
}

#[tauri::command]
async fn jmap_move_email(
    state: State<'_, AppState>,
    account_id: String,
    email_id: String,
    target_mailbox_id: String,
) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.move_email(&email_id, &target_mailbox_id).await
}

#[tauri::command]
async fn jmap_create_mailbox(
    state: State<'_, AppState>,
    account_id: String,
    name: String,
    parent_id: Option<String>,
) -> Result<String, String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.create_mailbox(&name, parent_id.as_deref()).await
}

#[tauri::command]
async fn jmap_delete_mailbox(state: State<'_, AppState>, account_id: String, mailbox_id: String) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.delete_mailbox(&mailbox_id).await
}

#[tauri::command]
async fn jmap_rename_mailbox(
    state: State<'_, AppState>,
    account_id: String,
    mailbox_id: String,
    new_name: String,
) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.rename_mailbox(&mailbox_id, &new_name).await
}

#[tauri::command]
async fn jmap_download_attachment(
    state: State<'_, AppState>,
    account_id: String,
    blob_id: String,
    filename: String,
) -> Result<String, String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;

    // Download the blob
    let data = client.download_blob(&blob_id).await?;

    // Get the downloads directory
    let downloads_dir = dirs::download_dir()
        .ok_or("Could not find downloads directory")?;

    // Sanitize filename
    let safe_filename = filename
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '.' || *c == '-' || *c == '_' || *c == ' ')
        .collect::<String>();

    let file_path = downloads_dir.join(&safe_filename);

    // Handle duplicate filenames
    let final_path = if file_path.exists() {
        let stem = file_path.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
        let ext = file_path.extension().and_then(|s| s.to_str()).unwrap_or("");
        let mut counter = 1;
        loop {
            let new_name = if ext.is_empty() {
                format!("{} ({})", stem, counter)
            } else {
                format!("{} ({}).{}", stem, counter, ext)
            };
            let new_path = downloads_dir.join(&new_name);
            if !new_path.exists() {
                break new_path;
            }
            counter += 1;
        }
    } else {
        file_path
    };

    // Write the file
    std::fs::write(&final_path, &data)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(final_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn jmap_send_email(state: State<'_, AppState>, account_id: String, email: JmapOutgoingEmail) -> Result<String, String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.send_email(email).await
}

#[tauri::command]
async fn jmap_search_emails(
    state: State<'_, AppState>,
    account_id: String,
    query: String,
    mailbox_id: Option<String>,
) -> Result<Vec<JmapEmailHeader>, String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.search_emails(&query, mailbox_id.as_deref()).await
}

// JMAP bulk operations
#[tauri::command]
async fn jmap_bulk_mark_read(
    state: State<'_, AppState>,
    account_id: String,
    email_ids: Vec<String>,
) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    let ids: Vec<&str> = email_ids.iter().map(|s| s.as_str()).collect();
    client.bulk_mark_read(&ids).await
}

#[tauri::command]
async fn jmap_bulk_mark_unread(
    state: State<'_, AppState>,
    account_id: String,
    email_ids: Vec<String>,
) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    let ids: Vec<&str> = email_ids.iter().map(|s| s.as_str()).collect();
    client.bulk_mark_unread(&ids).await
}

#[tauri::command]
async fn jmap_bulk_mark_flagged(
    state: State<'_, AppState>,
    account_id: String,
    email_ids: Vec<String>,
) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    let ids: Vec<&str> = email_ids.iter().map(|s| s.as_str()).collect();
    client.bulk_mark_flagged(&ids).await
}

#[tauri::command]
async fn jmap_bulk_delete(
    state: State<'_, AppState>,
    account_id: String,
    email_ids: Vec<String>,
) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    let ids: Vec<&str> = email_ids.iter().map(|s| s.as_str()).collect();
    client.bulk_delete(&ids).await
}

#[tauri::command]
async fn jmap_bulk_move(
    state: State<'_, AppState>,
    account_id: String,
    email_ids: Vec<String>,
    target_mailbox_id: String,
) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    let ids: Vec<&str> = email_ids.iter().map(|s| s.as_str()).collect();
    client.bulk_move(&ids, &target_mailbox_id).await
}

// JMAP Sieve commands
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JmapSieveScriptInfo {
    pub id: String,
    pub name: String,
    pub is_active: bool,
    pub blob_id: Option<String>,
}

#[tauri::command]
async fn jmap_list_sieve_scripts(state: State<'_, AppState>, account_id: String) -> Result<Vec<JmapSieveScriptInfo>, String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    let scripts = client.list_sieve_scripts().await?;
    Ok(scripts.into_iter().map(|s| JmapSieveScriptInfo {
        id: s.id,
        name: s.name,
        is_active: s.is_active,
        blob_id: s.blob_id,
    }).collect())
}

#[tauri::command]
async fn jmap_get_sieve_script(state: State<'_, AppState>, account_id: String, blob_id: String) -> Result<String, String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.get_sieve_script_content(&blob_id).await
}

#[tauri::command]
async fn jmap_set_sieve_script(
    state: State<'_, AppState>,
    account_id: String,
    id: Option<String>,
    name: String,
    content: String,
    is_active: bool,
) -> Result<String, String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.set_sieve_script(id.as_deref(), &name, &content, is_active).await
}

#[tauri::command]
async fn jmap_delete_sieve_script(state: State<'_, AppState>, account_id: String, script_id: String) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.delete_sieve_script(&script_id).await
}

#[tauri::command]
async fn jmap_activate_sieve_script(state: State<'_, AppState>, account_id: String, script_id: String) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.activate_sieve_script(&script_id).await
}

#[tauri::command]
async fn jmap_deactivate_sieve_scripts(state: State<'_, AppState>, account_id: String) -> Result<(), String> {
    let clients = state.jmap_clients.lock().await;
    let client = clients.get(&account_id).ok_or("JMAP account not connected")?;
    client.deactivate_sieve_scripts().await
}

// AI commands

/// Helper function to create AI provider from config
fn create_ai_provider(config: &AIConfig) -> Result<Box<dyn ai::AIProvider>, String> {
    match config.provider_type {
        AIProviderType::Local => {
            let model_path = ai::get_model_path(&config.local_model)?;
            if !model_path.exists() {
                return Err("Lokales Modell nicht heruntergeladen. Bitte zuerst herunterladen.".to_string());
            }
            let mut provider = ai::LocalProvider::new(model_path, config.local_model.clone());
            provider.load_model()?;
            Ok(Box::new(provider))
        }
        AIProviderType::Ollama => {
            Ok(Box::new(ai::ollama::OllamaProvider::new(
                config.ollama_url.clone(),
                config.ollama_model.clone(),
            )))
        }
        AIProviderType::OpenAI => {
            Ok(Box::new(ai::openai::OpenAIProvider::new(
                config.openai_api_key.clone(),
                config.openai_model.clone(),
            )))
        }
        AIProviderType::Anthropic => {
            Ok(Box::new(ai::anthropic::AnthropicProvider::new(
                config.anthropic_api_key.clone(),
                config.anthropic_model.clone(),
            )))
        }
        AIProviderType::CustomOpenAI => {
            Ok(Box::new(ai::openai::OpenAIProvider::with_base_url(
                config.custom_api_key.clone(),
                config.custom_model.clone(),
                config.custom_api_url.clone(),
            )))
        }
        AIProviderType::Disabled => {
            Err("AI ist deaktiviert".to_string())
        }
    }
}

#[tauri::command]
fn get_ai_config() -> Result<AIConfig, String> {
    storage::load_ai_config()
}

#[tauri::command]
fn save_ai_config(config: AIConfig) -> Result<(), String> {
    storage::save_ai_config(&config)
}

#[tauri::command]
async fn test_ai_connection(config: AIConfig) -> Result<String, String> {
    let provider = create_ai_provider(&config)?;

    if !provider.is_available().await {
        return Err("Provider nicht verfügbar".to_string());
    }

    // Send a simple test message
    let messages = vec![ai::AIMessage {
        role: "user".to_string(),
        content: "Antworte nur mit 'OK' wenn du funktionierst.".to_string(),
    }];

    provider.complete(messages).await.map(|response| {
        format!("Verbindung erfolgreich! Antwort: {}", response.trim())
    })
}

#[tauri::command]
async fn ai_analyze_email(subject: String, from: String, body: String) -> Result<EmailAnalysis, String> {
    let config = storage::load_ai_config()?;
    let provider = create_ai_provider(&config)?;
    ai::analyze_email(provider.as_ref(), &subject, &from, &body).await
}

#[tauri::command]
async fn ai_summarize_email(subject: String, body: String) -> Result<String, String> {
    let config = storage::load_ai_config()?;
    let provider = create_ai_provider(&config)?;
    ai::summarize_email(provider.as_ref(), &subject, &body).await
}

#[tauri::command]
async fn ai_extract_deadlines(subject: String, body: String) -> Result<Vec<ExtractedDeadline>, String> {
    let config = storage::load_ai_config()?;
    let provider = create_ai_provider(&config)?;
    ai::extract_deadlines(provider.as_ref(), &subject, &body).await
}

#[tauri::command]
async fn ai_calculate_importance(subject: String, from: String, body: String) -> Result<(u8, String), String> {
    let config = storage::load_ai_config()?;
    let provider = create_ai_provider(&config)?;
    ai::calculate_importance(provider.as_ref(), &subject, &from, &body).await
}

/// Scan for spam - only scans unscanned emails and caches results
#[tauri::command]
async fn ai_scan_for_spam(account_id: String, folder: String, limit: Option<u32>) -> Result<Vec<ai::SpamCandidate>, String> {
    let config = storage::load_ai_config()?;
    let provider = create_ai_provider(&config)?;
    let email_cache = cache::EmailCache::new(&account_id)?;

    // Get UIDs that haven't been scanned yet
    let limit = limit.unwrap_or(50);
    let unscanned_uids = email_cache.get_unscanned_uids(&folder, limit)?;

    if !unscanned_uids.is_empty() {
        // Get headers for unscanned emails
        let headers = email_cache.get_headers(&folder, 0, 500)?;
        let unscanned_headers: Vec<_> = headers
            .into_iter()
            .filter(|h| unscanned_uids.contains(&h.uid))
            .collect();

        // Process in batches of 10 for better AI performance
        for chunk in unscanned_headers.chunks(10) {
            let email_data: Vec<(u32, String, String, String, String)> = chunk
                .iter()
                .map(|h| {
                    let body = email_cache.get_email(&folder, h.uid)
                        .ok()
                        .flatten()
                        .map(|e| e.body_text)
                        .unwrap_or_default();
                    (h.uid, folder.clone(), h.subject.clone(), h.from.clone(), body)
                })
                .collect();

            match ai::detect_spam_batch(provider.as_ref(), &email_data).await {
                Ok(candidates) => {
                    // Store results in cache
                    for data in &email_data {
                        let uid = data.0;
                        let is_spam = candidates.iter().any(|c| c.uid == uid);
                        let (confidence, reason) = candidates
                            .iter()
                            .find(|c| c.uid == uid)
                            .map(|c| (c.confidence, c.reason.clone()))
                            .unwrap_or((0, String::new()));
                        let _ = email_cache.store_spam_result(&folder, uid, is_spam, confidence, &reason);
                    }
                }
                Err(e) => eprintln!("Spam detection batch failed: {}", e),
            }
        }

        // Update scan state with highest UID
        if let Some(max_uid) = unscanned_uids.iter().max() {
            let _ = email_cache.set_spam_scan_state(&folder, *max_uid);
        }
    }

    // Return all cached spam candidates
    ai_get_spam_candidates(account_id, folder).await
}

/// Get cached spam candidates without scanning
#[tauri::command]
async fn ai_get_spam_candidates(account_id: String, folder: String) -> Result<Vec<ai::SpamCandidate>, String> {
    let email_cache = cache::EmailCache::new(&account_id)?;
    let headers = email_cache.get_headers(&folder, 0, 500)?;

    // Get cached spam results
    let spam_data = email_cache.get_spam_candidates(&folder)?;

    // Build SpamCandidate structs with email details
    let candidates: Vec<ai::SpamCandidate> = spam_data
        .into_iter()
        .filter_map(|(uid, confidence, reason)| {
            headers.iter()
                .find(|h| h.uid == uid)
                .map(|h| ai::SpamCandidate {
                    uid,
                    folder: folder.clone(),
                    subject: h.subject.clone(),
                    from: h.from.clone(),
                    confidence,
                    reason,
                })
        })
        .collect();

    Ok(candidates)
}

/// Get count of detected spam in folder
#[tauri::command]
async fn ai_get_spam_count(account_id: String, folder: String) -> Result<u32, String> {
    let email_cache = cache::EmailCache::new(&account_id)?;
    email_cache.get_spam_count(&folder)
}

/// Scan new emails in background (called when new emails arrive)
#[tauri::command]
async fn ai_scan_new_emails(account_id: String, folder: String, uids: Vec<u32>) -> Result<u32, String> {
    let config = match storage::load_ai_config() {
        Ok(c) => c,
        Err(_) => return Ok(0), // AI not configured, skip
    };

    let provider = match create_ai_provider(&config) {
        Ok(p) => p,
        Err(_) => return Ok(0), // Provider not available, skip
    };

    let email_cache = cache::EmailCache::new(&account_id)?;

    // Filter to only unscanned UIDs
    let unscanned: Vec<u32> = uids
        .into_iter()
        .filter(|uid| !email_cache.is_spam_scanned(&folder, *uid).unwrap_or(true))
        .collect();

    if unscanned.is_empty() {
        return Ok(0);
    }

    let headers = email_cache.get_headers(&folder, 0, 500)?;
    let to_scan: Vec<_> = headers
        .into_iter()
        .filter(|h| unscanned.contains(&h.uid))
        .collect();

    let mut spam_found = 0;

    for chunk in to_scan.chunks(10) {
        let email_data: Vec<(u32, String, String, String, String)> = chunk
            .iter()
            .map(|h| {
                let body = email_cache.get_email(&folder, h.uid)
                    .ok()
                    .flatten()
                    .map(|e| e.body_text)
                    .unwrap_or_default();
                (h.uid, folder.clone(), h.subject.clone(), h.from.clone(), body)
            })
            .collect();

        match ai::detect_spam_batch(provider.as_ref(), &email_data).await {
            Ok(candidates) => {
                spam_found += candidates.len() as u32;
                for data in &email_data {
                    let uid = data.0;
                    let is_spam = candidates.iter().any(|c| c.uid == uid);
                    let (confidence, reason) = candidates
                        .iter()
                        .find(|c| c.uid == uid)
                        .map(|c| (c.confidence, c.reason.clone()))
                        .unwrap_or((0, String::new()));
                    let _ = email_cache.store_spam_result(&folder, uid, is_spam, confidence, &reason);
                }
            }
            Err(e) => eprintln!("Background spam scan failed: {}", e),
        }
    }

    Ok(spam_found)
}

#[tauri::command]
async fn list_ollama_models(base_url: String) -> Result<Vec<String>, String> {
    ai::ollama::list_ollama_models(&base_url).await
}

#[tauri::command]
fn get_openai_models() -> Vec<(&'static str, &'static str)> {
    ai::openai::openai_models()
}

#[tauri::command]
fn get_anthropic_models() -> Vec<(&'static str, &'static str)> {
    ai::anthropic::anthropic_models()
}

// Local model commands
#[derive(serde::Serialize)]
struct LocalModelInfo {
    id: String,
    name: String,
    size_mb: u64,
    downloaded: bool,
    file_size: u64,
}

#[tauri::command]
fn get_local_models_status() -> Result<Vec<LocalModelInfo>, String> {
    let models_info = ai::get_downloaded_models_info()?;

    Ok(models_info.into_iter().map(|(model, downloaded, file_size)| {
        LocalModelInfo {
            id: model.id().to_string(),
            name: model.display_name().to_string(),
            size_mb: model.file_size_mb(),
            downloaded,
            file_size,
        }
    }).collect())
}

#[tauri::command]
fn is_local_model_downloaded(model_id: String) -> Result<bool, String> {
    let model = parse_local_model(&model_id)?;
    ai::is_model_downloaded(&model)
}

#[tauri::command]
async fn download_local_model(app: tauri::AppHandle, model_id: String) -> Result<String, String> {
    let model = parse_local_model(&model_id)?;

    let app_handle = app.clone();
    let path = ai::download_model(&model, move |progress| {
        let _ = app_handle.emit("local-model-download-progress", &progress);
    }).await?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn delete_local_model(model_id: String) -> Result<(), String> {
    let model = parse_local_model(&model_id)?;
    ai::delete_model(&model)
}

fn parse_local_model(model_id: &str) -> Result<LocalModel, String> {
    match model_id {
        "smollm135m" | "smol_l_m135_m" => Ok(LocalModel::SmolLM135M),
        "qwen2_0_5b" | "qwen20_5b" => Ok(LocalModel::Qwen2_0_5B),
        "tinyllama1_1b" | "tiny_llama1_1b" => Ok(LocalModel::TinyLlama1_1B),
        "phi3mini" | "phi3_mini" => Ok(LocalModel::Phi3Mini),
        _ => Err(format!("Unknown model: {}", model_id)),
    }
}

// === Category Commands ===

#[tauri::command]
fn get_categories(account_id: String) -> Result<Vec<ai::EmailCategory>, String> {
    let cache = cache::EmailCache::new(&account_id)?;
    cache.get_categories()
}

#[tauri::command]
fn create_category(account_id: String, name: String, color: String, icon: Option<String>) -> Result<ai::EmailCategory, String> {
    let cache = cache::EmailCache::new(&account_id)?;
    cache.create_category(&name, &color, icon.as_deref())
}

#[tauri::command]
fn update_category(account_id: String, id: String, name: String, color: String, icon: Option<String>) -> Result<(), String> {
    let cache = cache::EmailCache::new(&account_id)?;
    cache.update_category(&id, &name, &color, icon.as_deref())
}

#[tauri::command]
fn delete_category(account_id: String, id: String) -> Result<(), String> {
    let cache = cache::EmailCache::new(&account_id)?;
    cache.delete_category(&id)
}

#[tauri::command]
fn get_email_category(account_id: String, folder: String, uid: u32) -> Result<Option<String>, String> {
    let cache = cache::EmailCache::new(&account_id)?;
    cache.get_email_category(&folder, uid)
}

#[tauri::command]
fn set_email_category(account_id: String, folder: String, uid: u32, category_id: String) -> Result<(), String> {
    let cache = cache::EmailCache::new(&account_id)?;
    cache.set_email_category(&folder, uid, &category_id, 1.0, true)
}

#[tauri::command]
fn get_emails_by_category(account_id: String, category_id: String) -> Result<Vec<imap::client::EmailHeader>, String> {
    let cache = cache::EmailCache::new(&account_id)?;
    cache.get_emails_by_category(&category_id)
}

#[tauri::command]
fn get_category_counts(account_id: String, folder: String) -> Result<Vec<(String, u32)>, String> {
    let cache = cache::EmailCache::new(&account_id)?;
    cache.get_category_counts(&folder)
}

#[tauri::command]
fn get_uncategorized_count(account_id: String, folder: String) -> Result<u32, String> {
    let cache = cache::EmailCache::new(&account_id)?;
    cache.get_uncategorized_count(&folder)
}

#[tauri::command]
async fn categorize_email_ai(account_id: String, folder: String, uid: u32, subject: String, from: String, body: String) -> Result<ai::CategoryResult, String> {
    let config = storage::load_ai_config()?;
    let provider = create_ai_provider(&config)?;
    let cache = cache::EmailCache::new(&account_id)?;
    let categories = cache.get_categories()?;

    let result = ai::categorize_email(
        provider.as_ref(),
        &subject,
        &from,
        &body,
        &categories,
    ).await?;

    // Save the result
    cache.set_email_category(&folder, uid, &result.category_id, result.confidence, false)?;

    Ok(result)
}

#[tauri::command]
async fn categorize_emails_batch(account_id: String, folder: String) -> Result<u32, String> {
    let config = storage::load_ai_config()?;
    if config.provider_type == AIProviderType::Disabled {
        return Ok(0);
    }

    let provider = create_ai_provider(&config)?;
    let cache = cache::EmailCache::new(&account_id)?;
    let categories = cache.get_categories()?;

    // Get uncategorized emails (max 10 at a time)
    let uncategorized = cache.get_uncategorized_emails(&folder, 10)?;

    let mut categorized = 0;
    for uid in uncategorized {
        // Get email details from cache
        if let Ok(Some(email)) = cache.get_email(&folder, uid) {
            let body_preview = if email.body_text.len() > 500 {
                &email.body_text[..500]
            } else {
                &email.body_text
            };

            if let Ok(result) = ai::categorize_email(
                provider.as_ref(),
                &email.subject,
                &email.from,
                body_preview,
                &categories,
            ).await {
                let _ = cache.set_email_category(&folder, uid, &result.category_id, result.confidence, false);
                categorized += 1;
            }
        }
    }

    Ok(categorized)
}

// === AI Chat Commands ===

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatContext {
    account_id: Option<String>,
    email_uid: Option<u32>,
    folder: Option<String>,
    email_subject: Option<String>,
    email_from: Option<String>,
    email_body: Option<String>,
}

#[tauri::command]
async fn ai_chat(
    state: State<'_, AppState>,
    messages: Vec<ai::AIMessage>,
    context: Option<ChatContext>,
) -> Result<String, String> {
    let config = storage::load_ai_config()?;
    let provider = create_ai_provider(&config)?;

    // Build system message with context and tools
    let mut all_messages = Vec::new();

    let mut system_content = "Du bist ein hilfreicher E-Mail-Assistent. Du hilfst beim Verstehen, Beantworten und Organisieren von E-Mails. Antworte auf Deutsch.\n\n".to_string();

    // Add tools description
    system_content.push_str(ai::get_tools_description());

    if let Some(ctx) = &context {
        if let Some(subject) = &ctx.email_subject {
            system_content.push_str(&format!("\n\nAktuelle E-Mail:\nBetreff: {}", subject));
        }
        if let Some(from) = &ctx.email_from {
            system_content.push_str(&format!("\nVon: {}", from));
        }
        if let Some(body) = &ctx.email_body {
            let truncated = if body.len() > 2000 { &body[..2000] } else { body };
            system_content.push_str(&format!("\n\nInhalt:\n{}", truncated));
        }
    }

    all_messages.push(ai::AIMessage {
        role: "system".to_string(),
        content: system_content,
    });

    all_messages.extend(messages);

    // First completion - might include a tool call
    let response = provider.complete(all_messages.clone()).await?;

    // Check if response contains a tool call
    if let Some(tool_call) = ai::parse_tool_call(&response) {
        // Get account ID from context
        let account_id = context
            .as_ref()
            .and_then(|c| c.account_id.clone())
            .unwrap_or_default();

        if account_id.is_empty() {
            return Ok("Ich kann keine Aktionen ausführen ohne einen ausgewählten Account. Bitte wähle zuerst einen Account aus.".to_string());
        }

        // Execute the tool
        let tool_result = ai::execute_tool(
            &tool_call,
            &account_id,
            &state.imap_clients,
        ).await;

        // Build response with tool result
        let tool_response = if tool_result.success {
            format!(
                "Tool '{}' ausgeführt. Ergebnis:\n```json\n{}\n```",
                tool_call.name,
                serde_json::to_string_pretty(&tool_result.data).unwrap_or_default()
            )
        } else {
            format!(
                "Tool '{}' fehlgeschlagen: {}",
                tool_call.name,
                tool_result.error.unwrap_or_default()
            )
        };

        // Add the tool call and result to messages
        all_messages.push(ai::AIMessage {
            role: "assistant".to_string(),
            content: response.clone(),
        });

        all_messages.push(ai::AIMessage {
            role: "user".to_string(),
            content: format!("Tool-Ergebnis: {}", tool_response),
        });

        // Get final response from AI
        let final_response = provider.complete(all_messages).await?;

        // Return the combined response
        Ok(format!("{}\n\n{}", tool_response, final_response))
    } else {
        // No tool call, return response directly
        Ok(response)
    }
}

#[tauri::command]
async fn ai_generate_reply(account_id: String, folder: String, uid: u32, tone: String) -> Result<String, String> {
    let config = storage::load_ai_config()?;
    let provider = create_ai_provider(&config)?;
    let cache = cache::EmailCache::new(&account_id)?;

    let email = cache.get_email(&folder, uid)?
        .ok_or("E-Mail nicht im Cache gefunden")?;

    let tone_desc = match tone.as_str() {
        "formal" => "formell und professionell",
        "friendly" => "freundlich und persönlich",
        "brief" => "kurz und prägnant",
        _ => "neutral und höflich",
    };

    let system_prompt = format!(
        r#"Du bist ein E-Mail-Assistent. Erstelle eine Antwort auf die folgende E-Mail.
Der Ton soll {} sein.
Antworte auf Deutsch.
Gib NUR den Antworttext zurück, keine Erklärungen."#,
        tone_desc
    );

    let body_truncated = if email.body_text.len() > 2000 {
        &email.body_text[..2000]
    } else {
        &email.body_text
    };

    let user_message = format!(
        "Von: {}\nBetreff: {}\n\n{}",
        email.from, email.subject, body_truncated
    );

    let messages = vec![
        ai::AIMessage {
            role: "system".to_string(),
            content: system_prompt,
        },
        ai::AIMessage {
            role: "user".to_string(),
            content: user_message,
        },
    ];

    provider.complete(messages).await
}

// === Cloud Sync Commands ===

#[tauri::command]
async fn cloud_register(email: String, password: String, name: String) -> Result<cloud::AuthResponse, String> {
    cloud::auth::register(&email, &password, &name).await
}

#[tauri::command]
async fn cloud_login(email: String, password: String) -> Result<cloud::AuthResponse, String> {
    cloud::auth::login(&email, &password).await
}

#[tauri::command]
async fn cloud_logout() -> Result<(), String> {
    cloud::auth::logout().await
}

#[tauri::command]
async fn cloud_get_user() -> Result<Option<cloud::CloudUser>, String> {
    Ok(cloud::auth::get_current_user())
}

#[tauri::command]
async fn cloud_refresh_user() -> Result<Option<cloud::CloudUser>, String> {
    cloud::auth::refresh_user().await
}

#[tauri::command]
async fn cloud_restore_session() -> Result<Option<cloud::CloudUser>, String> {
    cloud::auth::restore_session().await
}

#[tauri::command]
async fn cloud_is_premium() -> Result<bool, String> {
    Ok(cloud::auth::is_premium())
}

#[tauri::command]
async fn cloud_sync_push(encryption_password: Option<String>) -> Result<cloud::SyncResult, String> {
    // Load local data
    let accounts = storage::load_accounts()?;
    let jmap_accounts = storage::load_jmap_accounts()?;
    let ai_config = storage::load_ai_config()?;

    // Combine accounts
    let all_accounts = serde_json::json!({
        "imap": accounts,
        "jmap": jmap_accounts
    });

    let sync_data = cloud::SyncData {
        accounts: Some(all_accounts),
        ai_config: Some(serde_json::to_value(&ai_config).map_err(|e| e.to_string())?),
        categories: None, // Categories are per-account in cache, not synced globally
        client_timestamp: Some(chrono::Utc::now().to_rfc3339()),
        last_modified: None,
    };

    cloud::sync::push_data(sync_data, encryption_password.as_deref()).await
}

#[tauri::command]
async fn cloud_sync_pull(encryption_password: Option<String>) -> Result<cloud::SyncData, String> {
    let data = cloud::sync::pull_data(None, encryption_password.as_deref()).await?;

    // Apply pulled data to local storage
    if let Some(accounts) = &data.accounts {
        // Extract IMAP accounts
        if let Some(imap_accounts) = accounts.get("imap") {
            if let Ok(accounts_vec) = serde_json::from_value::<Vec<SavedAccount>>(imap_accounts.clone()) {
                for account in accounts_vec {
                    let _ = storage::save_account(account);
                }
            }
        }

        // Extract JMAP accounts
        if let Some(jmap_accounts) = accounts.get("jmap") {
            if let Ok(accounts_vec) = serde_json::from_value::<Vec<storage::SavedJmapAccount>>(jmap_accounts.clone()) {
                for account in accounts_vec {
                    let _ = storage::save_jmap_account(account);
                }
            }
        }
    }

    // Apply AI config
    if let Some(ai_config) = &data.ai_config {
        if let Ok(config) = serde_json::from_value::<AIConfig>(ai_config.clone()) {
            let _ = storage::save_ai_config(&config);
        }
    }

    Ok(data)
}

#[tauri::command]
async fn cloud_sync_status() -> Result<cloud::SyncStatus, String> {
    cloud::sync::get_sync_status().await
}

#[tauri::command]
async fn cloud_get_checkout_url(plan: String) -> Result<String, String> {
    let token = cloud::auth::get_token().ok_or("Not logged in")?;

    let client = reqwest::Client::new();
    let url = format!("{}/api/subscription/create-checkout", cloud::get_api_url());

    #[derive(serde::Serialize)]
    struct CheckoutRequest {
        plan: String,
    }

    #[derive(serde::Deserialize)]
    struct CheckoutResponse {
        checkout_url: String,
    }

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&CheckoutRequest { plan })
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let checkout: CheckoutResponse = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(checkout.checkout_url)
}

#[tauri::command]
async fn cloud_get_subscription() -> Result<cloud::SubscriptionInfo, String> {
    let token = cloud::auth::get_token().ok_or("Not logged in")?;

    let client = reqwest::Client::new();
    let url = format!("{}/api/subscription/status", cloud::get_api_url());

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let subscription: cloud::SubscriptionInfo = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(subscription)
}

// === Day Agent Commands ===

#[tauri::command]
async fn get_day_briefing(
    account_id: String,
    caldav_config: Option<ai::CalDavConfig>,
) -> Result<ai::DayState, String> {
    ai::generate_day_briefing(
        &account_id,
        caldav_config.as_ref(),
    ).await
}

#[tauri::command]
async fn refresh_day_state(
    account_id: String,
    caldav_config: Option<ai::CalDavConfig>,
    morning_baseline: ai::DayProgress,
) -> Result<ai::DayState, String> {
    ai::refresh_day_state(
        &account_id,
        caldav_config.as_ref(),
        &morning_baseline,
    ).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            connect,
            disconnect,
            disconnect_all,
            get_connected_accounts,
            get_account_status,
            list_folders,
            select_folder,
            fetch_headers,
            fetch_email,
            mark_read,
            delete_email,
            move_email,
            // Flag operations
            mark_flagged,
            unmark_flagged,
            mark_unread,
            add_flags,
            remove_flags,
            // Folder operations
            create_folder,
            delete_folder,
            rename_folder,
            // Attachment operations
            download_attachment,
            // Bulk operations
            bulk_mark_read,
            bulk_mark_unread,
            bulk_mark_flagged,
            bulk_delete,
            bulk_move,
            send_email,
            lookup_autoconfig,
            lookup_jmap_url,
            get_saved_accounts,
            save_account,
            delete_saved_account,
            get_saved_jmap_accounts,
            save_jmap_account,
            delete_saved_jmap_account,
            sieve_list_scripts,
            sieve_get_script,
            sieve_save_script,
            sieve_activate_script,
            sieve_delete_script,
            sieve_get_rules,
            sieve_save_rules,
            // CardDAV commands
            fetch_contacts,
            test_carddav_connection,
            create_contact,
            update_contact,
            delete_contact,
            // Cache commands
            get_cached_headers,
            get_cached_email,
            cache_headers,
            cache_email,
            update_cache_read_status,
            delete_cached_email,
            search_cached_emails,
            get_cache_stats,
            clear_cache,
            cleanup_old_cache,
            get_cache_sync_state,
            set_cache_sync_state,
            has_cached_email_body,
            // CalDAV commands
            fetch_calendars,
            fetch_calendar_events,
            create_calendar_event,
            update_calendar_event,
            delete_calendar_event,
            fetch_caldav_tasks,
            create_caldav_task,
            update_caldav_task,
            delete_caldav_task,
            // JMAP commands
            debug_jmap_connection,
            jmap_connect,
            jmap_disconnect,
            jmap_list_mailboxes,
            jmap_fetch_email_list,
            jmap_fetch_email,
            jmap_mark_read,
            jmap_mark_unread,
            jmap_mark_flagged,
            jmap_unmark_flagged,
            jmap_delete_email,
            jmap_move_email,
            jmap_create_mailbox,
            jmap_delete_mailbox,
            jmap_rename_mailbox,
            jmap_download_attachment,
            jmap_send_email,
            jmap_search_emails,
            jmap_bulk_mark_read,
            jmap_bulk_mark_unread,
            jmap_bulk_mark_flagged,
            jmap_bulk_delete,
            jmap_bulk_move,
            // JMAP Sieve commands
            jmap_list_sieve_scripts,
            jmap_get_sieve_script,
            jmap_set_sieve_script,
            jmap_delete_sieve_script,
            jmap_activate_sieve_script,
            jmap_deactivate_sieve_scripts,
            // AI commands
            get_ai_config,
            save_ai_config,
            test_ai_connection,
            ai_analyze_email,
            ai_summarize_email,
            ai_extract_deadlines,
            ai_calculate_importance,
            ai_scan_for_spam,
            ai_get_spam_candidates,
            ai_get_spam_count,
            ai_scan_new_emails,
            list_ollama_models,
            get_openai_models,
            get_anthropic_models,
            // Local model commands
            get_local_models_status,
            is_local_model_downloaded,
            download_local_model,
            delete_local_model,
            // Category commands
            get_categories,
            create_category,
            update_category,
            delete_category,
            get_email_category,
            set_email_category,
            get_emails_by_category,
            get_category_counts,
            get_uncategorized_count,
            categorize_email_ai,
            categorize_emails_batch,
            // AI Chat commands
            ai_chat,
            ai_generate_reply,
            // Day Agent commands
            get_day_briefing,
            refresh_day_state,
            // Cloud sync commands
            cloud_register,
            cloud_login,
            cloud_logout,
            cloud_get_user,
            cloud_refresh_user,
            cloud_restore_session,
            cloud_is_premium,
            cloud_sync_push,
            cloud_sync_pull,
            cloud_sync_status,
            cloud_get_checkout_url,
            cloud_get_subscription,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
