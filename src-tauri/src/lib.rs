mod autoconfig;
mod cache;
mod caldav;
mod carddav;
mod imap;
mod jmap;
mod sieve;
mod smtp;
mod storage;

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
use tauri::State;
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

#[tauri::command]
async fn jmap_connect(state: State<'_, AppState>, account: JmapAccount) -> Result<JmapConnectedAccount, String> {
    let account_id = account.username.clone();
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
            get_saved_accounts,
            save_account,
            delete_saved_account,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
