mod autoconfig;
mod cache;
mod imap;
mod sieve;
mod smtp;
mod storage;

use autoconfig::AutoConfigResult;
use cache::{EmailCache, CacheStats};
use imap::client::{Email, EmailHeader, Folder, ImapClient, MailAccount};
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
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            imap_clients: Arc::new(Mutex::new(HashMap::new())),
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
