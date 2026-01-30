// AI Module - Flexible AI provider system for email analysis
//
// Supports:
// - Embedded local LLMs (via llama.cpp)
// - Self-hosted APIs (Ollama, LM Studio)
// - Cloud APIs (OpenAI, Anthropic, Google, Mistral)

pub mod provider;
pub mod local;
pub mod ollama;
pub mod openai;
pub mod anthropic;
pub mod analyzer;
pub mod categorizer;

pub use provider::*;
pub use analyzer::*;
pub use categorizer::{EmailCategory, CategoryResult, categorize_email, get_default_categories};
pub use local::{LocalProvider, get_model_path, is_model_downloaded, download_model, delete_model, get_downloaded_models_info, DownloadProgress};
