// Authentication module for cloud sync
use super::{get_api_url, AuthResponse, CloudUser};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::RwLock;
use once_cell::sync::Lazy;

/// Stored authentication state
static AUTH_STATE: Lazy<RwLock<AuthState>> = Lazy::new(|| {
    RwLock::new(AuthState::default())
});

#[derive(Debug, Default)]
struct AuthState {
    token: Option<String>,
    user: Option<CloudUser>,
}

/// Login request body
#[derive(Serialize)]
struct LoginRequest {
    email: String,
    password: String,
}

/// Register request body
#[derive(Serialize)]
struct RegisterRequest {
    email: String,
    password: String,
    name: String,
}

/// Get the current auth token
pub fn get_token() -> Option<String> {
    AUTH_STATE.read().ok()?.token.clone()
}

/// Get the current user
pub fn get_current_user() -> Option<CloudUser> {
    AUTH_STATE.read().ok()?.user.clone()
}

/// Check if user is logged in
pub fn is_logged_in() -> bool {
    AUTH_STATE.read().map(|s| s.token.is_some()).unwrap_or(false)
}

/// Check if user has premium
pub fn is_premium() -> bool {
    AUTH_STATE.read()
        .map(|s| s.user.as_ref().map(|u| u.is_premium).unwrap_or(false))
        .unwrap_or(false)
}

/// Set auth state after login
fn set_auth_state(token: Option<String>, user: Option<CloudUser>) {
    if let Ok(mut state) = AUTH_STATE.write() {
        state.token = token;
        state.user = user;
    }
}

/// Clear auth state on logout
fn clear_auth_state() {
    if let Ok(mut state) = AUTH_STATE.write() {
        state.token = None;
        state.user = None;
    }
}

/// Register a new user
pub async fn register(email: &str, password: &str, name: &str) -> Result<AuthResponse, String> {
    let client = Client::new();
    let url = format!("{}/api/auth/register", get_api_url());

    let response = client
        .post(&url)
        .json(&RegisterRequest {
            email: email.to_string(),
            password: password.to_string(),
            name: name.to_string(),
        })
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let auth_response: AuthResponse = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    if auth_response.success {
        if let (Some(token), Some(user)) = (&auth_response.token, &auth_response.user) {
            set_auth_state(Some(token.clone()), Some(user.clone()));
            // Save token to secure storage
            save_token_to_storage(token).await?;
        }
    }

    Ok(auth_response)
}

/// Login with email and password
pub async fn login(email: &str, password: &str) -> Result<AuthResponse, String> {
    let client = Client::new();
    let url = format!("{}/api/auth/login", get_api_url());

    let response = client
        .post(&url)
        .json(&LoginRequest {
            email: email.to_string(),
            password: password.to_string(),
        })
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = response.status();
    let auth_response: AuthResponse = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    if auth_response.success {
        if let (Some(token), Some(user)) = (&auth_response.token, &auth_response.user) {
            set_auth_state(Some(token.clone()), Some(user.clone()));
            // Save token to secure storage
            save_token_to_storage(token).await?;
        }
    } else if status.as_u16() == 401 {
        return Ok(AuthResponse {
            success: false,
            token: None,
            user: None,
            error: Some("Invalid email or password".to_string()),
        });
    }

    Ok(auth_response)
}

/// Logout and clear session
pub async fn logout() -> Result<(), String> {
    let token = get_token();

    if let Some(token) = token {
        let client = Client::new();
        let url = format!("{}/api/auth/logout", get_api_url());

        // Best effort logout on server
        let _ = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await;
    }

    clear_auth_state();
    clear_token_from_storage().await?;

    Ok(())
}

/// Refresh user data from server
pub async fn refresh_user() -> Result<Option<CloudUser>, String> {
    let token = match get_token() {
        Some(t) => t,
        None => return Ok(None),
    };

    let client = Client::new();
    let url = format!("{}/api/auth/me", get_api_url());

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if response.status().as_u16() == 401 {
        // Token expired, clear auth state
        clear_auth_state();
        clear_token_from_storage().await?;
        return Ok(None);
    }

    #[derive(Deserialize)]
    struct MeResponse {
        user: CloudUser,
    }

    let me_response: MeResponse = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    set_auth_state(Some(token), Some(me_response.user.clone()));

    Ok(Some(me_response.user))
}

/// Refresh the auth token
pub async fn refresh_token() -> Result<Option<String>, String> {
    let token = match get_token() {
        Some(t) => t,
        None => return Ok(None),
    };

    let client = Client::new();
    let url = format!("{}/api/auth/refresh", get_api_url());

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if response.status().as_u16() == 401 {
        clear_auth_state();
        clear_token_from_storage().await?;
        return Ok(None);
    }

    #[derive(Deserialize)]
    struct RefreshResponse {
        token: String,
    }

    let refresh_response: RefreshResponse = response
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    // Update token in state
    if let Ok(mut state) = AUTH_STATE.write() {
        state.token = Some(refresh_response.token.clone());
    }

    save_token_to_storage(&refresh_response.token).await?;

    Ok(Some(refresh_response.token))
}

/// Try to restore session from saved token
pub async fn restore_session() -> Result<Option<CloudUser>, String> {
    let token = load_token_from_storage().await?;

    if let Some(token) = token {
        set_auth_state(Some(token), None);
        // Refresh user data to validate token
        return refresh_user().await;
    }

    Ok(None)
}

// Storage functions for token persistence
use std::path::PathBuf;

fn get_token_path() -> Result<PathBuf, String> {
    let config_dir = dirs::config_dir()
        .ok_or_else(|| "Could not find config directory".to_string())?;
    Ok(config_dir.join("mailclient").join(".cloud_token"))
}

async fn save_token_to_storage(token: &str) -> Result<(), String> {
    use base64::Engine;

    let path = get_token_path()?;

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create config directory: {}", e))?;
    }

    // Simple obfuscation (not encryption, just to avoid plaintext)
    let encoded = base64::engine::general_purpose::STANDARD.encode(token);

    std::fs::write(&path, encoded)
        .map_err(|e| format!("Could not save token: {}", e))?;

    Ok(())
}

async fn load_token_from_storage() -> Result<Option<String>, String> {
    use base64::Engine;

    let path = get_token_path()?;

    if !path.exists() {
        return Ok(None);
    }

    let encoded = std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read token: {}", e))?;

    let decoded = base64::engine::general_purpose::STANDARD.decode(&encoded)
        .map_err(|e| format!("Could not decode token: {}", e))?;

    let token = String::from_utf8(decoded)
        .map_err(|e| format!("Invalid token encoding: {}", e))?;

    Ok(Some(token))
}

async fn clear_token_from_storage() -> Result<(), String> {
    let path = get_token_path()?;

    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Could not remove token: {}", e))?;
    }

    Ok(())
}
