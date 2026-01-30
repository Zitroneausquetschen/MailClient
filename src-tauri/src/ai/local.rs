// Local LLM provider using llama.cpp
// Note: Local model inference is currently in development due to llama-cpp-2 API changes.
// Download functionality is fully operational.

use async_trait::async_trait;
use std::path::PathBuf;
use crate::ai::provider::{AIProvider, AIMessage, LocalModel};

/// Local LLM provider using llama.cpp
/// Currently in development - download works, inference coming soon
pub struct LocalProvider {
    model_path: PathBuf,
}

impl LocalProvider {
    pub fn new(model_path: PathBuf) -> Self {
        Self {
            model_path,
        }
    }

    /// Load the model into memory
    /// TODO: Implement with updated llama-cpp-2 API
    pub fn load_model(&self) -> Result<(), String> {
        if !self.model_path.exists() {
            return Err("Model file not found. Please download the model first.".to_string());
        }

        // Model loading will be implemented when llama-cpp-2 API stabilizes
        Err("Local LLM inference is currently in development. Please use Ollama or a cloud provider.".to_string())
    }

    /// Check if model is loaded
    pub fn is_loaded(&self) -> bool {
        false // Not yet implemented
    }
}

#[async_trait]
impl AIProvider for LocalProvider {
    async fn is_available(&self) -> bool {
        self.model_path.exists()
    }

    async fn complete(&self, _messages: Vec<AIMessage>) -> Result<String, String> {
        Err("Local LLM inference is currently in development. Please use Ollama or a cloud provider for now.".to_string())
    }

    fn name(&self) -> &'static str {
        "Local LLM"
    }
}

/// Format messages into a prompt suitable for the local model
#[allow(dead_code)]
fn format_messages_to_prompt(messages: &[AIMessage]) -> String {
    let mut prompt = String::new();

    for msg in messages {
        match msg.role.as_str() {
            "system" => {
                prompt.push_str(&format!("### System:\n{}\n\n", msg.content));
            }
            "user" => {
                prompt.push_str(&format!("### User:\n{}\n\n", msg.content));
            }
            "assistant" => {
                prompt.push_str(&format!("### Assistant:\n{}\n\n", msg.content));
            }
            _ => {
                prompt.push_str(&format!("{}\n\n", msg.content));
            }
        }
    }

    prompt.push_str("### Assistant:\n");
    prompt
}

/// Get the model directory path
pub fn get_models_dir() -> Result<PathBuf, String> {
    let data_dir = dirs::data_local_dir()
        .ok_or("Could not find local data directory")?;

    let models_dir = data_dir.join("MailClient").join("models");

    if !models_dir.exists() {
        std::fs::create_dir_all(&models_dir)
            .map_err(|e| format!("Failed to create models directory: {}", e))?;
    }

    Ok(models_dir)
}

/// Get the path for a specific model
pub fn get_model_path(model: &LocalModel) -> Result<PathBuf, String> {
    let models_dir = get_models_dir()?;
    Ok(models_dir.join(model.filename()))
}

/// Check if a model is downloaded
pub fn is_model_downloaded(model: &LocalModel) -> Result<bool, String> {
    let path = get_model_path(model)?;
    Ok(path.exists())
}

/// Download progress information
#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub percent: f32,
    pub speed_bps: u64,
    pub status: String,
}

/// Download a model from Hugging Face
pub async fn download_model(
    model: &LocalModel,
    progress_callback: impl Fn(DownloadProgress) + Send + 'static,
) -> Result<PathBuf, String> {
    let url = model.download_url();
    let target_path = get_model_path(model)?;

    // Create parent directory if needed
    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    progress_callback(DownloadProgress {
        total_bytes: 0,
        downloaded_bytes: 0,
        percent: 0.0,
        speed_bps: 0,
        status: "Connecting...".to_string(),
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600)) // 1 hour timeout for large files
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client.get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);

    progress_callback(DownloadProgress {
        total_bytes: total_size,
        downloaded_bytes: 0,
        percent: 0.0,
        speed_bps: 0,
        status: "Downloading...".to_string(),
    });

    // Create temp file for download
    let temp_path = target_path.with_extension("tmp");
    let mut file = tokio::fs::File::create(&temp_path)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let start_time = std::time::Instant::now();

    use futures::StreamExt;
    use tokio::io::AsyncWriteExt;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;

        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write: {}", e))?;

        downloaded += chunk.len() as u64;

        let elapsed = start_time.elapsed().as_secs_f64();
        let speed = if elapsed > 0.0 { (downloaded as f64 / elapsed) as u64 } else { 0 };
        let percent = if total_size > 0 { (downloaded as f32 / total_size as f32) * 100.0 } else { 0.0 };

        progress_callback(DownloadProgress {
            total_bytes: total_size,
            downloaded_bytes: downloaded,
            percent,
            speed_bps: speed,
            status: "Downloading...".to_string(),
        });
    }

    file.flush().await.map_err(|e| format!("Failed to flush: {}", e))?;
    drop(file);

    // Rename temp file to final path
    tokio::fs::rename(&temp_path, &target_path)
        .await
        .map_err(|e| format!("Failed to finalize download: {}", e))?;

    progress_callback(DownloadProgress {
        total_bytes: total_size,
        downloaded_bytes: total_size,
        percent: 100.0,
        speed_bps: 0,
        status: "Complete".to_string(),
    });

    Ok(target_path)
}

/// Delete a downloaded model
pub fn delete_model(model: &LocalModel) -> Result<(), String> {
    let path = get_model_path(model)?;
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete model: {}", e))?;
    }
    Ok(())
}

/// Get info about downloaded models
pub fn get_downloaded_models_info() -> Result<Vec<(LocalModel, bool, u64)>, String> {
    let models = vec![
        LocalModel::SmolLM135M,
        LocalModel::Qwen2_0_5B,
        LocalModel::TinyLlama1_1B,
        LocalModel::Phi3Mini,
    ];

    let mut result = Vec::new();
    for model in models {
        let path = get_model_path(&model)?;
        let exists = path.exists();
        let size = if exists {
            std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
        } else {
            0
        };
        result.push((model, exists, size));
    }

    Ok(result)
}
