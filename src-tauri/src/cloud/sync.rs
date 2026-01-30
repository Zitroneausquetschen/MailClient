// Sync module for cloud data synchronization
use super::{get_api_url, SyncData, SyncResult, SyncStatus, SyncConflict};
use super::auth::get_token;
use super::crypto;
use reqwest::Client;
use chrono::Utc;

/// Push local data to cloud
pub async fn push_data(data: SyncData, encryption_key: Option<&str>) -> Result<SyncResult, String> {
    let token = get_token().ok_or_else(|| "Not logged in".to_string())?;

    // Encrypt sensitive data before upload
    let encrypted_data = if let Some(key) = encryption_key {
        encrypt_sync_data(&data, key)?
    } else {
        data
    };

    let client = Client::new();
    let url = format!("{}/api/sync/push", get_api_url());

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&encrypted_data)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if response.status().as_u16() == 401 {
        return Err("Session expired. Please login again.".to_string());
    }

    let result: SyncResult = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(result)
}

/// Pull data from cloud
pub async fn pull_data(since: Option<&str>, encryption_key: Option<&str>) -> Result<SyncData, String> {
    let token = get_token().ok_or_else(|| "Not logged in".to_string())?;

    let client = Client::new();
    let mut url = format!("{}/api/sync/pull", get_api_url());

    if let Some(timestamp) = since {
        url = format!("{}?since={}", url, timestamp);
    }

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if response.status().as_u16() == 401 {
        return Err("Session expired. Please login again.".to_string());
    }

    let encrypted_data: SyncData = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    // Decrypt sensitive data after download
    let data = if let Some(key) = encryption_key {
        decrypt_sync_data(&encrypted_data, key)?
    } else {
        encrypted_data
    };

    Ok(data)
}

/// Get sync status
pub async fn get_sync_status() -> Result<SyncStatus, String> {
    let token = get_token().ok_or_else(|| "Not logged in".to_string())?;

    let client = Client::new();
    let url = format!("{}/api/sync/status", get_api_url());

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if response.status().as_u16() == 401 {
        return Err("Session expired. Please login again.".to_string());
    }

    let status: SyncStatus = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(status)
}

/// Encrypt sensitive fields in sync data before upload
fn encrypt_sync_data(data: &SyncData, key: &str) -> Result<SyncData, String> {
    let mut encrypted = data.clone();

    // Encrypt accounts (contains passwords)
    if let Some(accounts) = &data.accounts {
        let accounts_str = serde_json::to_string(accounts)
            .map_err(|e| format!("Serialization error: {}", e))?;
        let encrypted_accounts = crypto::encrypt(&accounts_str, key)?;
        encrypted.accounts = Some(serde_json::json!({
            "encrypted": true,
            "data": encrypted_accounts
        }));
    }

    // Encrypt AI config (contains API keys)
    if let Some(ai_config) = &data.ai_config {
        let ai_str = serde_json::to_string(ai_config)
            .map_err(|e| format!("Serialization error: {}", e))?;
        let encrypted_ai = crypto::encrypt(&ai_str, key)?;
        encrypted.ai_config = Some(serde_json::json!({
            "encrypted": true,
            "data": encrypted_ai
        }));
    }

    // Categories don't need encryption
    encrypted.client_timestamp = Some(Utc::now().to_rfc3339());

    Ok(encrypted)
}

/// Decrypt sensitive fields in sync data after download
fn decrypt_sync_data(data: &SyncData, key: &str) -> Result<SyncData, String> {
    let mut decrypted = data.clone();

    // Decrypt accounts
    if let Some(accounts) = &data.accounts {
        if let Some(encrypted_data) = accounts.get("encrypted") {
            if encrypted_data.as_bool() == Some(true) {
                if let Some(data_str) = accounts.get("data").and_then(|d| d.as_str()) {
                    let decrypted_str = crypto::decrypt(data_str, key)?;
                    decrypted.accounts = Some(serde_json::from_str(&decrypted_str)
                        .map_err(|e| format!("Parse error: {}", e))?);
                }
            }
        }
    }

    // Decrypt AI config
    if let Some(ai_config) = &data.ai_config {
        if let Some(encrypted_data) = ai_config.get("encrypted") {
            if encrypted_data.as_bool() == Some(true) {
                if let Some(data_str) = ai_config.get("data").and_then(|d| d.as_str()) {
                    let decrypted_str = crypto::decrypt(data_str, key)?;
                    decrypted.ai_config = Some(serde_json::from_str(&decrypted_str)
                        .map_err(|e| format!("Parse error: {}", e))?);
                }
            }
        }
    }

    Ok(decrypted)
}

/// Merge remote data with local data, handling conflicts
pub fn merge_sync_data(local: &SyncData, remote: &SyncData) -> (SyncData, Vec<SyncConflict>) {
    let mut merged = SyncData {
        accounts: None,
        ai_config: None,
        categories: None,
        client_timestamp: None,
        last_modified: remote.last_modified.clone(),
    };
    let mut conflicts = Vec::new();

    // Simple conflict resolution: newer timestamp wins
    // In a real implementation, you'd want field-level merging

    let local_ts = local.client_timestamp.as_ref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.timestamp());
    let remote_ts = remote.last_modified.as_ref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.timestamp());

    // Accounts
    if local.accounts.is_some() && remote.accounts.is_some() {
        if local_ts > remote_ts {
            merged.accounts = local.accounts.clone();
            conflicts.push(SyncConflict {
                data_type: "accounts".to_string(),
                local_timestamp: local.client_timestamp.clone().unwrap_or_default(),
                server_timestamp: remote.last_modified.clone().unwrap_or_default(),
                resolution: "local".to_string(),
            });
        } else {
            merged.accounts = remote.accounts.clone();
        }
    } else {
        merged.accounts = remote.accounts.clone().or_else(|| local.accounts.clone());
    }

    // AI config
    if local.ai_config.is_some() && remote.ai_config.is_some() {
        if local_ts > remote_ts {
            merged.ai_config = local.ai_config.clone();
            conflicts.push(SyncConflict {
                data_type: "ai_config".to_string(),
                local_timestamp: local.client_timestamp.clone().unwrap_or_default(),
                server_timestamp: remote.last_modified.clone().unwrap_or_default(),
                resolution: "local".to_string(),
            });
        } else {
            merged.ai_config = remote.ai_config.clone();
        }
    } else {
        merged.ai_config = remote.ai_config.clone().or_else(|| local.ai_config.clone());
    }

    // Categories
    if local.categories.is_some() && remote.categories.is_some() {
        if local_ts > remote_ts {
            merged.categories = local.categories.clone();
            conflicts.push(SyncConflict {
                data_type: "categories".to_string(),
                local_timestamp: local.client_timestamp.clone().unwrap_or_default(),
                server_timestamp: remote.last_modified.clone().unwrap_or_default(),
                resolution: "local".to_string(),
            });
        } else {
            merged.categories = remote.categories.clone();
        }
    } else {
        merged.categories = remote.categories.clone().or_else(|| local.categories.clone());
    }

    (merged, conflicts)
}
