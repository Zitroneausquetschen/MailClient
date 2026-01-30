// AI Provider trait and types
use serde::{Deserialize, Serialize};
use async_trait::async_trait;

/// AI Provider types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AIProviderType {
    /// Embedded local model via llama.cpp
    Local,
    /// Self-hosted Ollama server
    Ollama,
    /// OpenAI API (GPT-4, GPT-3.5)
    OpenAI,
    /// Anthropic API (Claude)
    Anthropic,
    /// Custom OpenAI-compatible API
    CustomOpenAI,
    /// Disabled
    Disabled,
}

impl Default for AIProviderType {
    fn default() -> Self {
        AIProviderType::Disabled
    }
}

/// Available local models for embedded LLM
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum LocalModel {
    /// SmolLM 135M - Very fast, basic capabilities (~80MB)
    SmolLM135M,
    /// Qwen2 0.5B - Good balance (~350MB)
    Qwen2_0_5B,
    /// TinyLlama 1.1B - Recommended (~600MB)
    TinyLlama1_1B,
    /// Phi-3 Mini - Best quality (~2GB)
    Phi3Mini,
}

impl Default for LocalModel {
    fn default() -> Self {
        LocalModel::TinyLlama1_1B
    }
}

impl LocalModel {
    pub fn display_name(&self) -> &'static str {
        match self {
            LocalModel::SmolLM135M => "SmolLM 135M (80MB) - Schnell",
            LocalModel::Qwen2_0_5B => "Qwen2 0.5B (350MB) - Ausgewogen",
            LocalModel::TinyLlama1_1B => "TinyLlama 1.1B (600MB) - Empfohlen",
            LocalModel::Phi3Mini => "Phi-3 Mini (2GB) - Beste Qualität",
        }
    }

    pub fn file_size_mb(&self) -> u64 {
        match self {
            LocalModel::SmolLM135M => 80,
            LocalModel::Qwen2_0_5B => 350,
            LocalModel::TinyLlama1_1B => 600,
            LocalModel::Phi3Mini => 2000,
        }
    }

    pub fn download_url(&self) -> &'static str {
        match self {
            LocalModel::SmolLM135M => "https://huggingface.co/HuggingFaceTB/SmolLM-135M-Instruct-GGUF/resolve/main/smollm-135m-instruct-q8_0.gguf",
            LocalModel::Qwen2_0_5B => "https://huggingface.co/Qwen/Qwen2-0.5B-Instruct-GGUF/resolve/main/qwen2-0_5b-instruct-q4_k_m.gguf",
            LocalModel::TinyLlama1_1B => "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
            LocalModel::Phi3Mini => "https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4.gguf",
        }
    }

    pub fn filename(&self) -> &'static str {
        match self {
            LocalModel::SmolLM135M => "smollm-135m-instruct-q8_0.gguf",
            LocalModel::Qwen2_0_5B => "qwen2-0_5b-instruct-q4_k_m.gguf",
            LocalModel::TinyLlama1_1B => "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
            LocalModel::Phi3Mini => "Phi-3-mini-4k-instruct-q4.gguf",
        }
    }
}

/// AI Provider configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIConfig {
    /// Currently active provider
    pub provider_type: AIProviderType,

    /// Local model settings
    pub local_model: LocalModel,
    pub local_model_downloaded: bool,

    /// Ollama settings
    pub ollama_url: String,
    pub ollama_model: String,

    /// OpenAI settings
    pub openai_api_key: String,
    pub openai_model: String,

    /// Anthropic settings
    pub anthropic_api_key: String,
    pub anthropic_model: String,

    /// Custom OpenAI-compatible API settings
    pub custom_api_url: String,
    pub custom_api_key: String,
    pub custom_model: String,

    /// Feature toggles
    pub auto_summarize: bool,
    pub auto_extract_deadlines: bool,
    pub auto_prioritize: bool,
    pub suggest_tasks: bool,
    pub suggest_calendar: bool,
}

impl Default for AIConfig {
    fn default() -> Self {
        Self {
            provider_type: AIProviderType::Disabled,
            local_model: LocalModel::default(),
            local_model_downloaded: false,
            ollama_url: "http://localhost:11434".to_string(),
            ollama_model: "llama3.2:latest".to_string(),
            openai_api_key: String::new(),
            openai_model: "gpt-4o-mini".to_string(),
            anthropic_api_key: String::new(),
            anthropic_model: "claude-3-haiku-20240307".to_string(),
            custom_api_url: String::new(),
            custom_api_key: String::new(),
            custom_model: String::new(),
            auto_summarize: true,
            auto_extract_deadlines: true,
            auto_prioritize: true,
            suggest_tasks: true,
            suggest_calendar: true,
        }
    }
}

/// Message for AI chat
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AIMessage {
    pub role: String,  // "system", "user", "assistant"
    pub content: String,
}

/// AI Provider trait - all providers must implement this
#[async_trait]
pub trait AIProvider: Send + Sync {
    /// Check if the provider is available/configured
    async fn is_available(&self) -> bool;

    /// Generate a completion from messages
    async fn complete(&self, messages: Vec<AIMessage>) -> Result<String, String>;

    /// Get provider name for display
    fn name(&self) -> &'static str;
}

/// Email analysis result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailAnalysis {
    /// Short summary of the email (1-2 sentences)
    pub summary: Option<String>,

    /// Importance score (0-100)
    pub importance_score: u8,

    /// Reason for importance score
    pub importance_reason: Option<String>,

    /// Extracted deadlines/dates
    pub deadlines: Vec<ExtractedDeadline>,

    /// Extracted action items
    pub action_items: Vec<String>,

    /// Suggested task
    pub suggested_task: Option<SuggestedTask>,

    /// Suggested calendar event
    pub suggested_event: Option<SuggestedEvent>,

    /// Detected sentiment (positive, negative, neutral)
    pub sentiment: Option<String>,

    /// Key entities (people, companies, etc.)
    pub entities: Vec<String>,
}

impl Default for EmailAnalysis {
    fn default() -> Self {
        Self {
            summary: None,
            importance_score: 50,
            importance_reason: None,
            deadlines: Vec::new(),
            action_items: Vec::new(),
            suggested_task: None,
            suggested_event: None,
            sentiment: None,
            entities: Vec::new(),
        }
    }
}

/// Extracted deadline from email
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractedDeadline {
    pub date: String,           // ISO date string
    pub description: String,    // What the deadline is for
    pub is_urgent: bool,
}

/// Suggested task from email analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestedTask {
    pub title: String,
    pub description: Option<String>,
    pub due_date: Option<String>,
    pub priority: String,  // "high", "medium", "low"
}

/// Suggested calendar event from email analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuggestedEvent {
    pub title: String,
    pub description: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub location: Option<String>,
}

/// Model download progress
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub percent: f32,
    pub speed_bps: u64,
}
