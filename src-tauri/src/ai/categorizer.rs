// Email categorization using AI
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use crate::ai::provider::{AIProvider, AIMessage};

/// Email category definition
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailCategory {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: Option<String>,
    pub is_system: bool,
    pub sort_order: i32,
}

/// Result of AI categorization
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryResult {
    pub category_id: String,
    pub confidence: f32,
}

/// Default system categories
pub fn get_default_categories() -> Vec<EmailCategory> {
    vec![
        EmailCategory {
            id: "work".to_string(),
            name: "Arbeit".to_string(),
            color: "#3B82F6".to_string(),
            icon: Some("briefcase".to_string()),
            is_system: true,
            sort_order: 1,
        },
        EmailCategory {
            id: "personal".to_string(),
            name: "Persönlich".to_string(),
            color: "#10B981".to_string(),
            icon: Some("user".to_string()),
            is_system: true,
            sort_order: 2,
        },
        EmailCategory {
            id: "newsletter".to_string(),
            name: "Newsletter".to_string(),
            color: "#8B5CF6".to_string(),
            icon: Some("newspaper".to_string()),
            is_system: true,
            sort_order: 3,
        },
        EmailCategory {
            id: "promotions".to_string(),
            name: "Werbung".to_string(),
            color: "#F59E0B".to_string(),
            icon: Some("tag".to_string()),
            is_system: true,
            sort_order: 4,
        },
        EmailCategory {
            id: "social".to_string(),
            name: "Sozial".to_string(),
            color: "#EC4899".to_string(),
            icon: Some("users".to_string()),
            is_system: true,
            sort_order: 5,
        },
        EmailCategory {
            id: "updates".to_string(),
            name: "Updates".to_string(),
            color: "#6366F1".to_string(),
            icon: Some("bell".to_string()),
            is_system: true,
            sort_order: 6,
        },
        EmailCategory {
            id: "finance".to_string(),
            name: "Finanzen".to_string(),
            color: "#059669".to_string(),
            icon: Some("currency-euro".to_string()),
            is_system: true,
            sort_order: 7,
        },
        EmailCategory {
            id: "travel".to_string(),
            name: "Reisen".to_string(),
            color: "#0EA5E9".to_string(),
            icon: Some("plane".to_string()),
            is_system: true,
            sort_order: 8,
        },
    ]
}

/// Categorize an email using AI
pub async fn categorize_email(
    provider: &dyn AIProvider,
    subject: &str,
    from: &str,
    body_preview: &str,
    available_categories: &[EmailCategory],
) -> Result<CategoryResult, String> {
    let categories_list = available_categories
        .iter()
        .map(|c| format!("- {}: {}", c.id, c.name))
        .collect::<Vec<_>>()
        .join("\n");

    let system_prompt = format!(
        r#"Du bist ein E-Mail-Kategorisierer. Analysiere die E-Mail und ordne sie der passendsten Kategorie zu.

Verfügbare Kategorien:
{}

Regeln:
- Wähle die Kategorie, die am besten zum Inhalt passt
- Newsletter sind regelmäßige Informations-E-Mails von Unternehmen/Websites
- Werbung sind Marketing-E-Mails mit Angeboten
- Sozial sind Benachrichtigungen von sozialen Netzwerken
- Updates sind automatische Benachrichtigungen (Versand, Bestellungen, etc.)
- Finanzen sind Rechnungen, Kontoauszüge, Zahlungen
- Reisen sind Buchungsbestätigungen, Flüge, Hotels

Antworte NUR mit JSON in diesem Format:
{{"category_id": "kategorie_id", "confidence": 0.0-1.0}}"#,
        categories_list
    );

    let body_truncated = if body_preview.len() > 1000 {
        &body_preview[..1000]
    } else {
        body_preview
    };

    let user_message = format!(
        "Von: {}\nBetreff: {}\n\nInhalt:\n{}",
        from, subject, body_truncated
    );

    let messages = vec![
        AIMessage {
            role: "system".to_string(),
            content: system_prompt,
        },
        AIMessage {
            role: "user".to_string(),
            content: user_message,
        },
    ];

    let response = provider.complete(messages).await?;

    // Parse JSON response
    parse_category_result(&response, available_categories)
}

/// Parse the AI response into a CategoryResult
fn parse_category_result(
    response: &str,
    available_categories: &[EmailCategory],
) -> Result<CategoryResult, String> {
    // Try to extract JSON from response
    let json_str = extract_json(response);

    #[derive(Deserialize)]
    struct RawResult {
        category_id: String,
        confidence: Option<f32>,
    }

    match serde_json::from_str::<RawResult>(&json_str) {
        Ok(raw) => {
            // Validate category exists
            let category_id = if available_categories.iter().any(|c| c.id == raw.category_id) {
                raw.category_id
            } else {
                // Fall back to first category if invalid
                available_categories
                    .first()
                    .map(|c| c.id.clone())
                    .unwrap_or_else(|| "work".to_string())
            };

            Ok(CategoryResult {
                category_id,
                confidence: raw.confidence.unwrap_or(0.5),
            })
        }
        Err(_) => {
            // If parsing fails, try to find category ID in response
            for category in available_categories {
                if response.to_lowercase().contains(&category.id.to_lowercase()) {
                    return Ok(CategoryResult {
                        category_id: category.id.clone(),
                        confidence: 0.3, // Lower confidence for fallback
                    });
                }
            }

            // Default fallback
            Ok(CategoryResult {
                category_id: "work".to_string(),
                confidence: 0.1,
            })
        }
    }
}

/// Extract JSON object from a string (finds first { to last })
fn extract_json(text: &str) -> String {
    if let Some(start) = text.find('{') {
        if let Some(end) = text.rfind('}') {
            if end > start {
                return text[start..=end].to_string();
            }
        }
    }
    text.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_json() {
        let input = r#"Here is the result: {"category_id": "work", "confidence": 0.9} done"#;
        let expected = r#"{"category_id": "work", "confidence": 0.9}"#;
        assert_eq!(extract_json(input), expected);
    }

    #[test]
    fn test_parse_category_result() {
        let categories = get_default_categories();
        let response = r#"{"category_id": "newsletter", "confidence": 0.85}"#;
        let result = parse_category_result(response, &categories).unwrap();
        assert_eq!(result.category_id, "newsletter");
        assert!((result.confidence - 0.85).abs() < 0.01);
    }
}
