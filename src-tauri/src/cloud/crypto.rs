// Cryptography module for encrypting sensitive sync data
// Uses AES-256-GCM for encryption

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use pbkdf2::pbkdf2_hmac;
use sha2::{Sha256, Digest};
use rand::RngCore;

const SALT_LENGTH: usize = 16;
const NONCE_LENGTH: usize = 12;
const KEY_LENGTH: usize = 32;
const PBKDF2_ITERATIONS: u32 = 100_000;

/// Encrypt plaintext with a password
/// Returns base64-encoded string: salt (16) + nonce (12) + ciphertext
pub fn encrypt(plaintext: &str, password: &str) -> Result<String, String> {
    // Generate random salt
    let mut salt = [0u8; SALT_LENGTH];
    OsRng.fill_bytes(&mut salt);

    // Derive key from password
    let key = derive_key(password, &salt)?;

    // Generate random nonce
    let mut nonce_bytes = [0u8; NONCE_LENGTH];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Create cipher and encrypt
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("Cipher creation error: {}", e))?;

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Encryption error: {}", e))?;

    // Combine salt + nonce + ciphertext
    let mut combined = Vec::with_capacity(SALT_LENGTH + NONCE_LENGTH + ciphertext.len());
    combined.extend_from_slice(&salt);
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    // Base64 encode
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&combined))
}

/// Decrypt ciphertext with a password
/// Input is base64-encoded string: salt (16) + nonce (12) + ciphertext
pub fn decrypt(encrypted: &str, password: &str) -> Result<String, String> {
    use base64::Engine;
    // Base64 decode
    let combined = base64::engine::general_purpose::STANDARD.decode(encrypted)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    if combined.len() < SALT_LENGTH + NONCE_LENGTH {
        return Err("Invalid encrypted data: too short".to_string());
    }

    // Extract salt, nonce, and ciphertext
    let salt = &combined[..SALT_LENGTH];
    let nonce_bytes = &combined[SALT_LENGTH..SALT_LENGTH + NONCE_LENGTH];
    let ciphertext = &combined[SALT_LENGTH + NONCE_LENGTH..];

    // Derive key from password
    let key = derive_key(password, salt)?;

    // Create cipher and decrypt
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|e| format!("Cipher creation error: {}", e))?;

    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed: wrong password or corrupted data".to_string())?;

    String::from_utf8(plaintext)
        .map_err(|e| format!("UTF-8 decode error: {}", e))
}

/// Derive encryption key from password using PBKDF2
fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; KEY_LENGTH], String> {
    let mut key = [0u8; KEY_LENGTH];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    Ok(key)
}

/// Generate a secure encryption key from user password
/// This should be called once when user sets up sync
pub fn generate_encryption_key(password: &str, email: &str) -> String {
    // Use email as additional entropy for salt derivation
    let salt_input = format!("mailclient-sync-{}", email);
    let mut salt = [0u8; SALT_LENGTH];

    // Hash the salt input to get consistent salt
    let mut hasher = Sha256::new();
    hasher.update(salt_input.as_bytes());
    let hash = hasher.finalize();
    salt.copy_from_slice(&hash[..SALT_LENGTH]);

    // Derive key
    let mut key = [0u8; KEY_LENGTH];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, PBKDF2_ITERATIONS, &mut key);

    // Return as hex string
    hex::encode(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt() {
        let plaintext = "Hello, World! This is a test message.";
        let password = "my-secure-password";

        let encrypted = encrypt(plaintext, password).unwrap();
        let decrypted = decrypt(&encrypted, password).unwrap();

        assert_eq!(plaintext, decrypted);
    }

    #[test]
    fn test_wrong_password() {
        let plaintext = "Secret data";
        let password = "correct-password";
        let wrong_password = "wrong-password";

        let encrypted = encrypt(plaintext, password).unwrap();
        let result = decrypt(&encrypted, wrong_password);

        assert!(result.is_err());
    }

    #[test]
    fn test_generate_encryption_key() {
        let key1 = generate_encryption_key("password123", "user@example.com");
        let key2 = generate_encryption_key("password123", "user@example.com");
        let key3 = generate_encryption_key("password123", "other@example.com");

        // Same inputs produce same key
        assert_eq!(key1, key2);
        // Different email produces different key
        assert_ne!(key1, key3);
        // Key is 64 hex chars (32 bytes)
        assert_eq!(key1.len(), 64);
    }
}
