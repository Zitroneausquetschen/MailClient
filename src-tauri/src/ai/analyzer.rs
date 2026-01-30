// Email Analyzer - Uses AI provider to analyze emails
use crate::ai::provider::{AIProvider, AIMessage, EmailAnalysis, ExtractedDeadline, SuggestedTask, SuggestedEvent};
use serde_json;

/// System prompt for email analysis
const SYSTEM_PROMPT: &str = r#"Du bist ein hilfreicher E-Mail-Assistent. Analysiere die E-Mail und extrahiere wichtige Informationen.

Antworte NUR mit einem JSON-Objekt im folgenden Format (keine anderen Texte, nur das JSON):
{
  "summary": "Kurze Zusammenfassung in 1-2 Sätzen",
  "importance_score": 0-100,
  "importance_reason": "Warum ist die E-Mail wichtig/unwichtig",
  "deadlines": [
    {"date": "YYYY-MM-DD", "description": "Was ist die Deadline", "is_urgent": true/false}
  ],
  "action_items": ["Liste von Aktionen die der Empfänger tun soll"],
  "suggested_task": {"title": "Aufgabentitel", "description": "Details", "due_date": "YYYY-MM-DD oder null", "priority": "high/medium/low"} oder null,
  "suggested_event": {"title": "Termintitel", "description": "Details", "start_time": "ISO datetime oder null", "end_time": "ISO datetime oder null", "location": "Ort oder null"} oder null,
  "sentiment": "positive/negative/neutral",
  "entities": ["Namen von Personen", "Firmen", "Projekte"]
}

Regeln:
- importance_score: Newsletter/Werbung = 10-30, normale Infos = 40-60, Anfragen = 60-80, Dringend/Deadline = 80-100
- Extrahiere nur echte Deadlines mit konkreten Daten
- suggested_task nur wenn eine klare Aufgabe erkennbar ist
- suggested_event nur wenn ein Termin/Meeting erwähnt wird
- Leere Arrays wenn nichts gefunden"#;

/// Analyze an email using the provided AI
pub async fn analyze_email(
    provider: &dyn AIProvider,
    subject: &str,
    from: &str,
    body: &str,
) -> Result<EmailAnalysis, String> {
    // Truncate body if too long
    let truncated_body = if body.len() > 4000 {
        format!("{}...[gekürzt]", &body[..4000])
    } else {
        body.to_string()
    };

    let user_message = format!(
        "Analysiere diese E-Mail:\n\nVon: {}\nBetreff: {}\n\nInhalt:\n{}",
        from, subject, truncated_body
    );

    let messages = vec![
        AIMessage {
            role: "system".to_string(),
            content: SYSTEM_PROMPT.to_string(),
        },
        AIMessage {
            role: "user".to_string(),
            content: user_message,
        },
    ];

    let response = provider.complete(messages).await?;

    // Parse JSON response
    parse_analysis_response(&response)
}

/// Parse the AI response into EmailAnalysis
fn parse_analysis_response(response: &str) -> Result<EmailAnalysis, String> {
    // Try to find JSON in the response (AI might add extra text)
    let json_str = extract_json(response);

    #[derive(serde::Deserialize)]
    struct RawAnalysis {
        summary: Option<String>,
        importance_score: Option<u8>,
        importance_reason: Option<String>,
        deadlines: Option<Vec<RawDeadline>>,
        action_items: Option<Vec<String>>,
        suggested_task: Option<RawTask>,
        suggested_event: Option<RawEvent>,
        sentiment: Option<String>,
        entities: Option<Vec<String>>,
    }

    #[derive(serde::Deserialize)]
    struct RawDeadline {
        date: String,
        description: String,
        is_urgent: Option<bool>,
    }

    #[derive(serde::Deserialize)]
    struct RawTask {
        title: String,
        description: Option<String>,
        due_date: Option<String>,
        priority: Option<String>,
    }

    #[derive(serde::Deserialize)]
    struct RawEvent {
        title: String,
        description: Option<String>,
        start_time: Option<String>,
        end_time: Option<String>,
        location: Option<String>,
    }

    let raw: RawAnalysis = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse AI response as JSON: {}. Response: {}", e, response))?;

    Ok(EmailAnalysis {
        summary: raw.summary,
        importance_score: raw.importance_score.unwrap_or(50),
        importance_reason: raw.importance_reason,
        deadlines: raw.deadlines.unwrap_or_default().into_iter().map(|d| ExtractedDeadline {
            date: d.date,
            description: d.description,
            is_urgent: d.is_urgent.unwrap_or(false),
        }).collect(),
        action_items: raw.action_items.unwrap_or_default(),
        suggested_task: raw.suggested_task.map(|t| SuggestedTask {
            title: t.title,
            description: t.description,
            due_date: t.due_date,
            priority: t.priority.unwrap_or_else(|| "medium".to_string()),
        }),
        suggested_event: raw.suggested_event.map(|e| SuggestedEvent {
            title: e.title,
            description: e.description,
            start_time: e.start_time,
            end_time: e.end_time,
            location: e.location,
        }),
        sentiment: raw.sentiment,
        entities: raw.entities.unwrap_or_default(),
    })
}

/// Extract JSON from response (handles cases where AI adds extra text)
fn extract_json(text: &str) -> String {
    // Try to find JSON object
    if let Some(start) = text.find('{') {
        if let Some(end) = text.rfind('}') {
            return text[start..=end].to_string();
        }
    }
    text.to_string()
}

/// Quick summary without full analysis
pub async fn summarize_email(
    provider: &dyn AIProvider,
    subject: &str,
    body: &str,
) -> Result<String, String> {
    let truncated_body = if body.len() > 2000 {
        format!("{}...", &body[..2000])
    } else {
        body.to_string()
    };

    let messages = vec![
        AIMessage {
            role: "system".to_string(),
            content: "Fasse die E-Mail in maximal 2 Sätzen zusammen. Antworte nur mit der Zusammenfassung, ohne Einleitung.".to_string(),
        },
        AIMessage {
            role: "user".to_string(),
            content: format!("Betreff: {}\n\n{}", subject, truncated_body),
        },
    ];

    provider.complete(messages).await
}

/// Extract deadlines only
pub async fn extract_deadlines(
    provider: &dyn AIProvider,
    subject: &str,
    body: &str,
) -> Result<Vec<ExtractedDeadline>, String> {
    let truncated_body = if body.len() > 3000 {
        format!("{}...", &body[..3000])
    } else {
        body.to_string()
    };

    let messages = vec![
        AIMessage {
            role: "system".to_string(),
            content: r#"Extrahiere alle Deadlines und wichtigen Termine aus der E-Mail.
Antworte NUR mit einem JSON-Array:
[{"date": "YYYY-MM-DD", "description": "Was", "is_urgent": true/false}]
Wenn keine Deadlines gefunden, antworte mit: []"#.to_string(),
        },
        AIMessage {
            role: "user".to_string(),
            content: format!("Betreff: {}\n\n{}", subject, truncated_body),
        },
    ];

    let response = provider.complete(messages).await?;
    let json_str = extract_json(&response);

    #[derive(serde::Deserialize)]
    struct RawDeadline {
        date: String,
        description: String,
        is_urgent: Option<bool>,
    }

    let deadlines: Vec<RawDeadline> = serde_json::from_str(&json_str)
        .unwrap_or_default();

    Ok(deadlines.into_iter().map(|d| ExtractedDeadline {
        date: d.date,
        description: d.description,
        is_urgent: d.is_urgent.unwrap_or(false),
    }).collect())
}

/// Calculate importance score
pub async fn calculate_importance(
    provider: &dyn AIProvider,
    subject: &str,
    from: &str,
    body: &str,
) -> Result<(u8, String), String> {
    let truncated_body = if body.len() > 1500 {
        format!("{}...", &body[..1500])
    } else {
        body.to_string()
    };

    let messages = vec![
        AIMessage {
            role: "system".to_string(),
            content: r#"Bewerte die Wichtigkeit der E-Mail auf einer Skala von 0-100.
Regeln:
- Newsletter/Werbung: 10-30
- Informationen: 40-60
- Anfragen/Aufgaben: 60-80
- Dringend/Deadlines: 80-100

Antworte NUR mit JSON: {"score": 0-100, "reason": "Kurze Begründung"}"#.to_string(),
        },
        AIMessage {
            role: "user".to_string(),
            content: format!("Von: {}\nBetreff: {}\n\n{}", from, subject, truncated_body),
        },
    ];

    let response = provider.complete(messages).await?;
    let json_str = extract_json(&response);

    #[derive(serde::Deserialize)]
    struct ImportanceResponse {
        score: u8,
        reason: String,
    }

    let result: ImportanceResponse = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse importance: {}", e))?;

    Ok((result.score, result.reason))
}
