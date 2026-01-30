// Cloud sync module for premium features
pub mod auth;
pub mod sync;
pub mod crypto;

pub use auth::*;
pub use sync::*;
pub use crypto::*;

use serde::{Deserialize, Serialize};

/// Cloud API base URL - configurable via environment
pub const DEFAULT_API_URL: &str = "https://api.mailclient.app";

/// Get the API URL from environment or use default
pub fn get_api_url() -> String {
    std::env::var("MAILCLIENT_API_URL").unwrap_or_else(|_| DEFAULT_API_URL.to_string())
}

/// Cloud user information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudUser {
    pub id: i64,
    pub email: String,
    pub name: Option<String>,
    pub is_premium: bool,
    pub premium_until: Option<String>,
    pub created_at: String,
}

/// Authentication response from server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponse {
    pub success: bool,
    pub token: Option<String>,
    pub user: Option<CloudUser>,
    pub error: Option<String>,
}

/// Sync status information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatus {
    pub last_sync: Option<String>,
    pub device_count: i32,
    pub is_syncing: bool,
}

/// Sync result after push/pull
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub success: bool,
    pub server_timestamp: Option<String>,
    pub conflicts: Vec<SyncConflict>,
    pub error: Option<String>,
}

/// Sync conflict information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConflict {
    pub data_type: String,
    pub local_timestamp: String,
    pub server_timestamp: String,
    pub resolution: String,
}

/// Subscription information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionInfo {
    pub is_premium: bool,
    pub plan: Option<String>,
    pub premium_until: Option<String>,
    pub cancel_at_period_end: bool,
}

/// Sync data structure for upload/download
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncData {
    pub accounts: Option<serde_json::Value>,
    pub ai_config: Option<serde_json::Value>,
    pub categories: Option<serde_json::Value>,
    pub client_timestamp: Option<String>,
    pub last_modified: Option<String>,
}
