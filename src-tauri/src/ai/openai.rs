// OpenAI API client (also works with OpenAI-compatible APIs like LM Studio)
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use crate::ai::provider::{AIProvider, AIMessage};

pub struct OpenAIProvider {
    api_key: String,
    model: String,
    base_url: String,
    client: reqwest::Client,
}

#[derive(Serialize)]
struct OpenAIRequest {
    model: String,
    messages: Vec<OpenAIMessage>,
    temperature: f32,
    max_tokens: u32,
}

#[derive(Serialize, Deserialize)]
struct OpenAIMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct OpenAIResponse {
    choices: Vec<OpenAIChoice>,
}

#[derive(Deserialize)]
struct OpenAIChoice {
    message: OpenAIResponseMessage,
}

#[derive(Deserialize)]
struct OpenAIResponseMessage {
    content: String,
}

#[derive(Deserialize)]
struct OpenAIError {
    error: OpenAIErrorDetail,
}

#[derive(Deserialize)]
struct OpenAIErrorDetail {
    message: String,
}

impl OpenAIProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self::with_base_url(api_key, model, "https://api.openai.com/v1".to_string())
    }

    pub fn with_base_url(api_key: String, model: String, base_url: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .unwrap_or_default();

        Self {
            api_key,
            model,
            base_url,
            client,
        }
    }
}

#[async_trait]
impl AIProvider for OpenAIProvider {
    async fn is_available(&self) -> bool {
        !self.api_key.is_empty()
    }

    async fn complete(&self, messages: Vec<AIMessage>) -> Result<String, String> {
        let url = format!("{}/chat/completions", self.base_url);

        let openai_messages: Vec<OpenAIMessage> = messages
            .into_iter()
            .map(|m| OpenAIMessage {
                role: m.role,
                content: m.content,
            })
            .collect();

        let request = OpenAIRequest {
            model: self.model.clone(),
            messages: openai_messages,
            temperature: 0.3,
            max_tokens: 1000,
        };

        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("OpenAI request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();

            // Try to parse error message
            if let Ok(error) = serde_json::from_str::<OpenAIError>(&body) {
                return Err(format!("OpenAI error: {}", error.error.message));
            }
            return Err(format!("OpenAI error {}: {}", status, body));
        }

        let openai_response: OpenAIResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;

        openai_response
            .choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or_else(|| "No response from OpenAI".to_string())
    }

    fn name(&self) -> &'static str {
        "OpenAI"
    }
}

/// Available OpenAI models
pub fn openai_models() -> Vec<(&'static str, &'static str)> {
    vec![
        ("gpt-4o", "GPT-4o (Beste Qualität)"),
        ("gpt-4o-mini", "GPT-4o Mini (Schnell & günstig)"),
        ("gpt-4-turbo", "GPT-4 Turbo"),
        ("gpt-3.5-turbo", "GPT-3.5 Turbo (Günstig)"),
    ]
}
