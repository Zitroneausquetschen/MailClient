// Local LLM provider using llama.cpp
// Supports GGUF models for local inference without external dependencies

use async_trait::async_trait;
use std::path::PathBuf;
use std::num::NonZeroU32;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::sampling::LlamaSampler;
use llama_cpp_2::token::LlamaToken;
use crate::ai::provider::{AIProvider, AIMessage, LocalModel};

/// Local LLM provider using llama.cpp for GGUF model inference
pub struct LocalProvider {
    model_path: PathBuf,
    model_type: LocalModel,
    backend: Option<LlamaBackend>,
    model: Option<LlamaModel>,
}

impl LocalProvider {
    pub fn new(model_path: PathBuf, model_type: LocalModel) -> Self {
        Self {
            model_path,
            model_type,
            backend: None,
            model: None,
        }
    }

    /// Load the model into memory
    pub fn load_model(&mut self) -> Result<(), String> {
        if !self.model_path.exists() {
            return Err("Model file not found. Please download the model first.".to_string());
        }

        // Initialize backend
        let backend = LlamaBackend::init()
            .map_err(|e| format!("Failed to initialize llama backend: {}", e))?;

        // Set up model parameters
        let model_params = LlamaModelParams::default();

        // Load the model
        let model = LlamaModel::load_from_file(&backend, &self.model_path, &model_params)
            .map_err(|e| format!("Failed to load model: {}", e))?;

        self.backend = Some(backend);
        self.model = Some(model);

        Ok(())
    }

    /// Check if model is loaded
    pub fn is_loaded(&self) -> bool {
        self.model.is_some()
    }
}

#[async_trait]
impl AIProvider for LocalProvider {
    async fn is_available(&self) -> bool {
        self.model_path.exists()
    }

    async fn complete(&self, messages: Vec<AIMessage>) -> Result<String, String> {
        let backend = self.backend.as_ref()
            .ok_or("Backend not initialized. Please load the model first.")?;
        let model = self.model.as_ref()
            .ok_or("Model not loaded. Please wait while the model loads...")?;

        let prompt = format_messages_for_model(&self.model_type, &messages);

        // Create context
        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(2048));

        let mut ctx = model.new_context(backend, ctx_params)
            .map_err(|e| format!("Failed to create context: {}", e))?;

        // Tokenize the prompt
        let tokens = model.str_to_token(&prompt, llama_cpp_2::model::AddBos::Always)
            .map_err(|e| format!("Failed to tokenize: {}", e))?;

        // Create batch and add tokens
        let mut batch = LlamaBatch::new(2048, 1);

        for (i, token) in tokens.iter().enumerate() {
            let is_last = i == tokens.len() - 1;
            batch.add(*token, i as i32, &[0], is_last)
                .map_err(|e| format!("Failed to add token to batch: {}", e))?;
        }

        // Decode the prompt
        ctx.decode(&mut batch)
            .map_err(|e| format!("Failed to decode prompt: {}", e))?;

        // Set up sampler for generation
        let mut sampler = LlamaSampler::chain_simple([
            LlamaSampler::temp(0.7),
            LlamaSampler::top_p(0.9, 1),
            LlamaSampler::dist(42),
        ]);

        // Generate tokens
        let mut result = String::new();
        let mut n_cur = tokens.len();
        let max_tokens = 512;
        let eos_token = model.token_eos();

        for _ in 0..max_tokens {
            // Sample next token
            let token = sampler.sample(&ctx, -1);

            // Check for end of stream
            if token == eos_token {
                break;
            }

            // Convert token to text
            let piece = model.token_to_str(token, llama_cpp_2::model::Special::Tokenize)
                .map_err(|e| format!("Failed to convert token: {}", e))?;

            // Check for end-of-turn markers
            if piece.contains("<|end|>") ||
               piece.contains("<|im_end|>") ||
               piece.contains("</s>") ||
               piece.contains("<|eot_id|>") {
                break;
            }

            result.push_str(&piece);

            // Prepare next batch
            batch.clear();
            batch.add(token, n_cur as i32, &[0], true)
                .map_err(|e| format!("Failed to add token: {}", e))?;

            n_cur += 1;

            // Decode
            ctx.decode(&mut batch)
                .map_err(|e| format!("Failed to decode: {}", e))?;
        }

        Ok(result.trim().to_string())
    }

    fn name(&self) -> &'static str {
        "Local LLM"
    }
}

/// Format messages into a prompt suitable for the specific model type
fn format_messages_for_model(model_type: &LocalModel, messages: &[AIMessage]) -> String {
    match model_type {
        LocalModel::TinyLlama1_1B => format_tinyllama(messages),
        LocalModel::Phi3Mini => format_phi3(messages),
        LocalModel::Qwen2_0_5B => format_chatml(messages),
        LocalModel::SmolLM135M => format_chatml(messages),
    }
}

/// TinyLlama chat format
fn format_tinyllama(messages: &[AIMessage]) -> String {
    let mut prompt = String::new();

    for msg in messages {
        match msg.role.as_str() {
            "system" => {
                prompt.push_str(&format!("<|system|>\n{}</s>\n", msg.content));
            }
            "user" => {
                prompt.push_str(&format!("<|user|>\n{}</s>\n", msg.content));
            }
            "assistant" => {
                prompt.push_str(&format!("<|assistant|>\n{}</s>\n", msg.content));
            }
            _ => {}
        }
    }

    prompt.push_str("<|assistant|>\n");
    prompt
}

/// Phi-3 chat format
fn format_phi3(messages: &[AIMessage]) -> String {
    let mut prompt = String::new();

    for msg in messages {
        match msg.role.as_str() {
            "system" => {
                prompt.push_str(&format!("<|system|>\n{}<|end|>\n", msg.content));
            }
            "user" => {
                prompt.push_str(&format!("<|user|>\n{}<|end|>\n", msg.content));
            }
            "assistant" => {
                prompt.push_str(&format!("<|assistant|>\n{}<|end|>\n", msg.content));
            }
            _ => {}
        }
    }

    prompt.push_str("<|assistant|>\n");
    prompt
}

/// ChatML format (used by Qwen2, SmolLM, and many others)
fn format_chatml(messages: &[AIMessage]) -> String {
    let mut prompt = String::new();

    for msg in messages {
        match msg.role.as_str() {
            "system" => {
                prompt.push_str(&format!("<|im_start|>system\n{}<|im_end|>\n", msg.content));
            }
            "user" => {
                prompt.push_str(&format!("<|im_start|>user\n{}<|im_end|>\n", msg.content));
            }
            "assistant" => {
                prompt.push_str(&format!("<|im_start|>assistant\n{}<|im_end|>\n", msg.content));
            }
            _ => {}
        }
    }

    prompt.push_str("<|im_start|>assistant\n");
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
        .timeout(std::time::Duration::from_secs(3600))
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
