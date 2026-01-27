use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSignature {
    pub id: String,
    pub name: String,
    pub content: String,  // HTML content
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VacationSettings {
    pub enabled: bool,
    pub subject: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
}

impl Default for VacationSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            subject: "Abwesend".to_string(),
            message: String::new(),
            start_date: None,
            end_date: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedAccount {
    pub id: String,
    pub display_name: String,
    pub username: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
    // Password is optional - user can choose to save it or not
    #[serde(default)]
    pub password: Option<String>,
    // Cache settings
    #[serde(default)]
    pub cache_enabled: bool,
    #[serde(default = "default_cache_days")]
    pub cache_days: u32,           // 0 = unbegrenzt
    #[serde(default = "default_true")]
    pub cache_body: bool,          // E-Mail-Inhalt cachen
    #[serde(default)]
    pub cache_attachments: bool,   // Anhaenge cachen
    // Signatures
    #[serde(default)]
    pub signatures: Vec<EmailSignature>,
    // Vacation settings
    #[serde(default)]
    pub vacation: Option<VacationSettings>,
}

fn default_cache_days() -> u32 { 30 }
fn default_true() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub accounts: Vec<SavedAccount>,
}

fn get_config_path() -> Result<PathBuf, String> {
    let config_dir = dirs::config_dir()
        .ok_or("Could not find config directory")?
        .join("MailClient");

    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    Ok(config_dir.join("accounts.json"))
}

pub fn load_accounts() -> Result<Vec<SavedAccount>, String> {
    let config_path = get_config_path()?;

    if !config_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    let config: AppConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    Ok(config.accounts)
}

pub fn save_account(account: SavedAccount) -> Result<(), String> {
    let config_path = get_config_path()?;

    let mut config = if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        AppConfig::default()
    };

    // Update existing or add new
    let existing_idx = config.accounts.iter().position(|a| a.id == account.id);
    if let Some(idx) = existing_idx {
        config.accounts[idx] = account;
    } else {
        config.accounts.push(account);
    }

    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

pub fn delete_account(account_id: &str) -> Result<(), String> {
    let config_path = get_config_path()?;

    if !config_path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    let mut config: AppConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    config.accounts.retain(|a| a.id != account_id);

    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}
