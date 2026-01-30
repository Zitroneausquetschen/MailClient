// Ollama API client for self-hosted LLMs
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use crate::ai::provider::{AIProvider, AIMessage};

pub struct OllamaProvider {
    base_url: String,
    model: String,
    client: reqwest::Client,
}

#[derive(Serialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
}

#[derive(Serialize, Deserialize)]
struct OllamaMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct OllamaResponse {
    message: OllamaResponseMessage,
}

#[derive(Deserialize)]
struct OllamaResponseMessage {
    content: String,
}

impl OllamaProvider {
    pub fn new(base_url: String, model: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .unwrap_or_default();

        Self {
            base_url,
            model,
            client,
        }
    }
}

#[async_trait]
impl AIProvider for OllamaProvider {
    async fn is_available(&self) -> bool {
        let url = format!("{}/api/tags", self.base_url);
        match self.client.get(&url).send().await {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        }
    }

    async fn complete(&self, messages: Vec<AIMessage>) -> Result<String, String> {
        let url = format!("{}/api/chat", self.base_url);

        let ollama_messages: Vec<OllamaMessage> = messages
            .into_iter()
            .map(|m| OllamaMessage {
                role: m.role,
                content: m.content,
            })
            .collect();

        let request = OllamaRequest {
            model: self.model.clone(),
            messages: ollama_messages,
            stream: false,
        };

        let response = self.client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Ollama request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Ollama error {}: {}", status, body));
        }

        let ollama_response: OllamaResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

        Ok(ollama_response.message.content)
    }

    fn name(&self) -> &'static str {
        "Ollama"
    }
}

/// List available models from Ollama
pub async fn list_ollama_models(base_url: &str) -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/tags", base_url);

    #[derive(Deserialize)]
    struct TagsResponse {
        models: Vec<ModelInfo>,
    }

    #[derive(Deserialize)]
    struct ModelInfo {
        name: String,
    }

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Ollama returned error: {}", response.status()));
    }

    let tags: TagsResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(tags.models.into_iter().map(|m| m.name).collect())
}
