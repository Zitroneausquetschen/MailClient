// Anthropic API client for Claude
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use crate::ai::provider::{AIProvider, AIMessage};

pub struct AnthropicProvider {
    api_key: String,
    model: String,
    client: reqwest::Client,
}

#[derive(Serialize)]
struct AnthropicRequest {
    model: String,
    messages: Vec<AnthropicMessage>,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    system: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct AnthropicMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicContent>,
}

#[derive(Deserialize)]
struct AnthropicContent {
    text: String,
}

#[derive(Deserialize)]
struct AnthropicError {
    error: AnthropicErrorDetail,
}

#[derive(Deserialize)]
struct AnthropicErrorDetail {
    message: String,
}

impl AnthropicProvider {
    pub fn new(api_key: String, model: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .unwrap_or_default();

        Self {
            api_key,
            model,
            client,
        }
    }
}

#[async_trait]
impl AIProvider for AnthropicProvider {
    async fn is_available(&self) -> bool {
        !self.api_key.is_empty()
    }

    async fn complete(&self, messages: Vec<AIMessage>) -> Result<String, String> {
        let url = "https://api.anthropic.com/v1/messages";

        // Extract system message if present
        let mut system_message: Option<String> = None;
        let anthropic_messages: Vec<AnthropicMessage> = messages
            .into_iter()
            .filter_map(|m| {
                if m.role == "system" {
                    system_message = Some(m.content);
                    None
                } else {
                    Some(AnthropicMessage {
                        role: m.role,
                        content: m.content,
                    })
                }
            })
            .collect();

        let request = AnthropicRequest {
            model: self.model.clone(),
            messages: anthropic_messages,
            max_tokens: 1000,
            system: system_message,
        };

        let response = self.client
            .post(url)
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Anthropic request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();

            // Try to parse error message
            if let Ok(error) = serde_json::from_str::<AnthropicError>(&body) {
                return Err(format!("Anthropic error: {}", error.error.message));
            }
            return Err(format!("Anthropic error {}: {}", status, body));
        }

        let anthropic_response: AnthropicResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;

        anthropic_response
            .content
            .first()
            .map(|c| c.text.clone())
            .ok_or_else(|| "No response from Anthropic".to_string())
    }

    fn name(&self) -> &'static str {
        "Anthropic Claude"
    }
}

/// Available Anthropic models
pub fn anthropic_models() -> Vec<(&'static str, &'static str)> {
    vec![
        ("claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet (Beste Qualität)"),
        ("claude-3-5-haiku-20241022", "Claude 3.5 Haiku (Schnell & günstig)"),
        ("claude-3-opus-20240229", "Claude 3 Opus (Sehr leistungsstark)"),
        ("claude-3-sonnet-20240229", "Claude 3 Sonnet"),
        ("claude-3-haiku-20240307", "Claude 3 Haiku (Schnell)"),
    ]
}
