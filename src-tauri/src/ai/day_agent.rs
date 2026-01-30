// Day Agent - Dynamic daily briefing and progress tracking
//
// Aggregates data from emails, calendar, and tasks to provide
// an AI-powered daily overview with real-time updates.

use serde::{Deserialize, Serialize};
use chrono::{Local, NaiveDate, NaiveDateTime, Timelike, Duration};
use crate::cache::EmailCache;
use crate::caldav::client::{CalDavClient, CalendarEvent, CalDavTask};
use crate::ai::provider::{AIProvider, AIMessage};
use crate::storage;

/// Complete state for a day's briefing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayState {
    /// When this state was generated (ISO 8601)
    pub generated_at: String,
    /// Email summary
    pub email_summary: EmailDaySummary,
    /// Calendar summary
    pub calendar_summary: CalendarDaySummary,
    /// Task summary
    pub task_summary: TaskDaySummary,
    /// AI-generated briefing text
    pub ai_briefing: Option<String>,
    /// AI-generated suggestions
    pub ai_suggestions: Vec<AISuggestion>,
    /// Progress tracking
    pub progress: DayProgress,
}

/// Email summary for the day
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailDaySummary {
    /// Total unread emails
    pub unread_count: u32,
    /// Important emails (high priority or from known senders)
    pub important_emails: Vec<ImportantEmail>,
    /// Emails read today
    pub emails_read_today: u32,
    /// Emails with extracted deadlines
    pub emails_with_deadlines: Vec<EmailDeadline>,
}

/// An important email requiring attention
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportantEmail {
    pub uid: u32,
    pub folder: String,
    pub subject: String,
    pub from: String,
    pub date: String,
    pub is_read: bool,
    pub importance_reason: Option<String>,
}

/// A deadline extracted from an email
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailDeadline {
    pub email_uid: u32,
    pub email_subject: String,
    pub deadline_date: String,
    pub deadline_description: String,
    pub is_urgent: bool,
}

/// Calendar summary for the day
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDaySummary {
    /// Events happening today
    pub today_events: Vec<CalendarEventSummary>,
    /// Next upcoming event
    pub next_event: Option<CalendarEventSummary>,
    /// Minutes until next event
    pub minutes_until_next: Option<i64>,
    /// Total events today
    pub total_events_today: u32,
    /// Events already past
    pub events_completed: u32,
    /// Events still to come
    pub events_remaining: u32,
}

/// Summary of a calendar event
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEventSummary {
    pub id: String,
    pub calendar_id: String,
    pub summary: String,
    pub location: Option<String>,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub is_past: bool,
    pub attendee_count: u32,
}

/// Task summary for the day
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDaySummary {
    /// Tasks due today
    pub due_today: Vec<TaskSummary>,
    /// Overdue tasks
    pub overdue: Vec<TaskSummary>,
    /// Tasks due this week
    pub due_this_week: Vec<TaskSummary>,
    /// Tasks completed today
    pub completed_today: u32,
    /// High priority uncompleted tasks
    pub high_priority_pending: Vec<TaskSummary>,
    /// Total open tasks
    pub total_open: u32,
}

/// Summary of a task
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub id: String,
    pub calendar_id: String,
    pub summary: String,
    pub description: Option<String>,
    pub due: Option<String>,
    pub priority: Option<u8>,
    pub priority_label: String,
    pub is_overdue: bool,
}

/// AI-generated suggestion
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AISuggestion {
    pub suggestion_type: SuggestionType,
    pub title: String,
    pub description: String,
    pub action: Option<SuggestedAction>,
}

/// Type of suggestion
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SuggestionType {
    Priority,
    TimeBlock,
    EmailAction,
    TaskReminder,
    MeetingPrep,
}

/// Suggested action the user can take
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedAction {
    pub action_type: String,
    pub target_id: String,
    pub target_type: String,
}

/// Progress tracking for the day
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayProgress {
    /// Starting unread count (morning baseline)
    pub morning_unread: u32,
    /// Starting open task count
    pub morning_open_tasks: u32,
    /// Starting event count
    pub morning_events: u32,
    /// Emails processed (read) today
    pub emails_processed: u32,
    /// Tasks completed today
    pub tasks_completed: u32,
    /// Events attended (past)
    pub events_attended: u32,
    /// Overall progress percentage
    pub overall_progress_percent: u8,
}

/// CalDAV configuration for fetching calendar/tasks
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalDavConfig {
    pub host: String,
    pub username: String,
    pub password: String,
    pub calendar_ids: Vec<String>,
}

// === Implementation ===

/// Generate a fresh day briefing
pub async fn generate_day_briefing(
    account_id: &str,
    caldav_config: Option<&CalDavConfig>,
) -> Result<DayState, String> {
    let now = Local::now();
    let today = now.date_naive();

    // Get email summary from cache
    let email_summary = get_email_summary(account_id)?;

    // Get calendar summary if CalDAV is configured
    let calendar_summary = if let Some(config) = caldav_config {
        get_calendar_summary(config, today).await?
    } else {
        CalendarDaySummary {
            today_events: vec![],
            next_event: None,
            minutes_until_next: None,
            total_events_today: 0,
            events_completed: 0,
            events_remaining: 0,
        }
    };

    // Get task summary if CalDAV is configured
    let task_summary = if let Some(config) = caldav_config {
        get_task_summary(config, today).await?
    } else {
        TaskDaySummary {
            due_today: vec![],
            overdue: vec![],
            due_this_week: vec![],
            completed_today: 0,
            high_priority_pending: vec![],
            total_open: 0,
        }
    };

    // Calculate initial progress (baseline)
    let progress = DayProgress {
        morning_unread: email_summary.unread_count,
        morning_open_tasks: task_summary.total_open,
        morning_events: calendar_summary.total_events_today,
        emails_processed: 0,
        tasks_completed: task_summary.completed_today,
        events_attended: calendar_summary.events_completed,
        overall_progress_percent: 0,
    };

    // Generate AI briefing if AI is enabled
    let (ai_briefing, ai_suggestions) = generate_ai_content(
        &email_summary,
        &calendar_summary,
        &task_summary,
    ).await.unwrap_or((None, vec![]));

    Ok(DayState {
        generated_at: now.to_rfc3339(),
        email_summary,
        calendar_summary,
        task_summary,
        ai_briefing,
        ai_suggestions,
        progress,
    })
}

/// Refresh day state with progress tracking
pub async fn refresh_day_state(
    account_id: &str,
    caldav_config: Option<&CalDavConfig>,
    morning_baseline: &DayProgress,
) -> Result<DayState, String> {
    let now = Local::now();
    let today = now.date_naive();

    // Get current email summary
    let email_summary = get_email_summary(account_id)?;

    // Get calendar summary
    let calendar_summary = if let Some(config) = caldav_config {
        get_calendar_summary(config, today).await?
    } else {
        CalendarDaySummary {
            today_events: vec![],
            next_event: None,
            minutes_until_next: None,
            total_events_today: 0,
            events_completed: 0,
            events_remaining: 0,
        }
    };

    // Get task summary
    let task_summary = if let Some(config) = caldav_config {
        get_task_summary(config, today).await?
    } else {
        TaskDaySummary {
            due_today: vec![],
            overdue: vec![],
            due_this_week: vec![],
            completed_today: 0,
            high_priority_pending: vec![],
            total_open: 0,
        }
    };

    // Calculate progress compared to morning baseline
    let emails_processed = if morning_baseline.morning_unread > email_summary.unread_count {
        morning_baseline.morning_unread - email_summary.unread_count
    } else {
        0
    };

    let tasks_completed_since = if morning_baseline.morning_open_tasks > task_summary.total_open {
        morning_baseline.morning_open_tasks - task_summary.total_open
    } else {
        0
    };

    // Calculate overall progress
    let total_items = morning_baseline.morning_unread
        + morning_baseline.morning_open_tasks
        + morning_baseline.morning_events;

    let completed_items = emails_processed
        + tasks_completed_since
        + calendar_summary.events_completed;

    let progress_percent = if total_items > 0 {
        ((completed_items as f32 / total_items as f32) * 100.0).min(100.0) as u8
    } else {
        100
    };

    let progress = DayProgress {
        morning_unread: morning_baseline.morning_unread,
        morning_open_tasks: morning_baseline.morning_open_tasks,
        morning_events: morning_baseline.morning_events,
        emails_processed,
        tasks_completed: task_summary.completed_today,
        events_attended: calendar_summary.events_completed,
        overall_progress_percent: progress_percent,
    };

    // Generate updated AI content
    let (ai_briefing, ai_suggestions) = generate_ai_content(
        &email_summary,
        &calendar_summary,
        &task_summary,
    ).await.unwrap_or((None, vec![]));

    Ok(DayState {
        generated_at: now.to_rfc3339(),
        email_summary,
        calendar_summary,
        task_summary,
        ai_briefing,
        ai_suggestions,
        progress,
    })
}

/// Get email summary from cache
fn get_email_summary(account_id: &str) -> Result<EmailDaySummary, String> {
    let cache = EmailCache::new(account_id)?;

    // Get unread count
    let unread_count = cache.count_unread(None)?;

    // Get recent unread emails for importance detection
    let headers = cache.get_headers("INBOX", 0, 20)?;
    let important_emails: Vec<ImportantEmail> = headers
        .iter()
        .filter(|h| !h.is_read)
        .take(5)
        .map(|h| ImportantEmail {
            uid: h.uid,
            folder: "INBOX".to_string(),
            subject: h.subject.clone(),
            from: h.from.clone(),
            date: h.date.clone(),
            is_read: h.is_read,
            importance_reason: None,
        })
        .collect();

    Ok(EmailDaySummary {
        unread_count,
        important_emails,
        emails_read_today: 0, // Would need to track this separately
        emails_with_deadlines: vec![], // Would need AI extraction
    })
}

/// Get calendar summary for today
async fn get_calendar_summary(
    config: &CalDavConfig,
    today: NaiveDate,
) -> Result<CalendarDaySummary, String> {
    let client = CalDavClient::new(
        &config.host,
        &config.username,
        &config.password,
    );

    let now = Local::now();
    let start_of_day = today.and_hms_opt(0, 0, 0).unwrap();
    let end_of_day = today.and_hms_opt(23, 59, 59).unwrap();

    let mut all_events: Vec<CalendarEvent> = vec![];

    // Fetch events from all configured calendars
    for calendar_id in &config.calendar_ids {
        match client.fetch_events(
            calendar_id,
            &start_of_day.to_string(),
            &end_of_day.to_string(),
        ).await {
            Ok(events) => all_events.extend(events),
            Err(_) => continue,
        }
    }

    // Sort by start time
    all_events.sort_by(|a, b| a.start.cmp(&b.start));

    // Convert to summaries
    let today_events: Vec<CalendarEventSummary> = all_events
        .iter()
        .map(|e| {
            let event_start = parse_datetime(&e.start);
            let is_past = event_start
                .map(|dt| dt < now.naive_local())
                .unwrap_or(false);

            CalendarEventSummary {
                id: e.id.clone(),
                calendar_id: e.calendar_id.clone(),
                summary: e.summary.clone(),
                location: e.location.clone(),
                start: e.start.clone(),
                end: e.end.clone(),
                all_day: e.all_day,
                is_past,
                attendee_count: e.attendees.len() as u32,
            }
        })
        .collect();

    // Find next event
    let next_event = today_events.iter().find(|e| !e.is_past).cloned();

    // Calculate minutes until next event
    let minutes_until_next = next_event.as_ref().and_then(|e| {
        parse_datetime(&e.start).map(|dt| {
            let diff = dt - now.naive_local();
            diff.num_minutes()
        })
    });

    let events_completed = today_events.iter().filter(|e| e.is_past).count() as u32;
    let events_remaining = today_events.iter().filter(|e| !e.is_past).count() as u32;

    Ok(CalendarDaySummary {
        total_events_today: today_events.len() as u32,
        today_events,
        next_event,
        minutes_until_next,
        events_completed,
        events_remaining,
    })
}

/// Get task summary for today and this week
async fn get_task_summary(
    config: &CalDavConfig,
    today: NaiveDate,
) -> Result<TaskDaySummary, String> {
    let client = CalDavClient::new(
        &config.host,
        &config.username,
        &config.password,
    );

    let mut all_tasks: Vec<CalDavTask> = vec![];

    // Fetch tasks from all configured calendars
    for calendar_id in &config.calendar_ids {
        match client.fetch_tasks(calendar_id).await {
            Ok(tasks) => all_tasks.extend(tasks),
            Err(_) => continue,
        }
    }

    let week_end = today + Duration::days(7);

    let mut due_today: Vec<TaskSummary> = vec![];
    let mut overdue: Vec<TaskSummary> = vec![];
    let mut due_this_week: Vec<TaskSummary> = vec![];
    let mut high_priority_pending: Vec<TaskSummary> = vec![];
    let mut completed_today = 0u32;
    let mut total_open = 0u32;

    for task in all_tasks {
        let task_summary = TaskSummary {
            id: task.id.clone(),
            calendar_id: task.calendar_id.clone(),
            summary: task.summary.clone(),
            description: task.description.clone(),
            due: task.due.clone(),
            priority: task.priority,
            priority_label: priority_to_label(task.priority),
            is_overdue: false, // Will be set below
        };

        if task.completed {
            // Check if completed today (would need last_modified date)
            completed_today += 1;
            continue;
        }

        total_open += 1;

        // High priority (1-3)
        if task.priority.map(|p| p <= 3).unwrap_or(false) {
            high_priority_pending.push(task_summary.clone());
        }

        // Check due date
        if let Some(due_str) = &task.due {
            if let Some(due_date) = parse_date(due_str) {
                let mut summary = task_summary.clone();

                if due_date < today {
                    summary.is_overdue = true;
                    overdue.push(summary);
                } else if due_date == today {
                    due_today.push(summary);
                } else if due_date <= week_end {
                    due_this_week.push(summary);
                }
            }
        }
    }

    Ok(TaskDaySummary {
        due_today,
        overdue,
        due_this_week,
        completed_today,
        high_priority_pending,
        total_open,
    })
}

/// Generate AI briefing and suggestions
async fn generate_ai_content(
    email_summary: &EmailDaySummary,
    calendar_summary: &CalendarDaySummary,
    task_summary: &TaskDaySummary,
) -> Result<(Option<String>, Vec<AISuggestion>), String> {
    let config = storage::load_ai_config()?;

    // Skip if AI is disabled
    if config.provider_type == crate::ai::provider::AIProviderType::Disabled {
        return Ok((Some(generate_static_briefing(email_summary, calendar_summary, task_summary)), vec![]));
    }

    let provider = crate::create_ai_provider(&config)?;

    // Build context
    let hour = Local::now().hour();
    let greeting = if hour < 12 {
        "Guten Morgen"
    } else if hour < 17 {
        "Guten Tag"
    } else {
        "Guten Abend"
    };

    let context = format!(
        "{greeting}!\n\n\
        Aktuelle Situation:\n\
        - {} ungelesene E-Mails\n\
        - {} wichtige E-Mails\n\
        - {} Termine heute (nächster: {})\n\
        - {} überfällige Aufgaben\n\
        - {} heute fällige Aufgaben\n\
        - {} Aufgaben diese Woche\n",
        email_summary.unread_count,
        email_summary.important_emails.len(),
        calendar_summary.total_events_today,
        calendar_summary.next_event.as_ref().map(|e| e.summary.as_str()).unwrap_or("keine"),
        task_summary.overdue.len(),
        task_summary.due_today.len(),
        task_summary.due_this_week.len(),
    );

    let system_prompt = r#"Du bist ein persönlicher Tagesassistent. Erstelle eine kurze, motivierende Zusammenfassung des Tages.

Struktur:
1. Kurze Begrüßung
2. Wichtigste Priorität (1 Satz)
3. Übersicht der Zahlen
4. Besondere Hinweise (überfällig, dringend)
5. Motivierender Abschluss

Halte dich kurz (max 5-6 Sätze). Sei freundlich und hilfreich."#;

    let messages = vec![
        AIMessage {
            role: "system".to_string(),
            content: system_prompt.to_string(),
        },
        AIMessage {
            role: "user".to_string(),
            content: context,
        },
    ];

    match provider.complete(messages).await {
        Ok(briefing) => Ok((Some(briefing), generate_suggestions(email_summary, calendar_summary, task_summary))),
        Err(_) => Ok((Some(generate_static_briefing(email_summary, calendar_summary, task_summary)), vec![])),
    }
}

/// Generate a static briefing without AI
fn generate_static_briefing(
    email_summary: &EmailDaySummary,
    calendar_summary: &CalendarDaySummary,
    task_summary: &TaskDaySummary,
) -> String {
    let hour = Local::now().hour();
    let greeting = if hour < 12 {
        "Guten Morgen"
    } else if hour < 17 {
        "Guten Tag"
    } else {
        "Guten Abend"
    };

    let mut parts = vec![format!("{}!", greeting)];

    parts.push(format!(
        "Du hast {} ungelesene E-Mail{}, {} Termin{} heute und {} offene Aufgabe{}.",
        email_summary.unread_count,
        if email_summary.unread_count == 1 { "" } else { "s" },
        calendar_summary.total_events_today,
        if calendar_summary.total_events_today == 1 { "" } else { "e" },
        task_summary.total_open,
        if task_summary.total_open == 1 { "" } else { "n" },
    ));

    if !task_summary.overdue.is_empty() {
        parts.push(format!(
            "Achtung: {} überfällige Aufgabe{}!",
            task_summary.overdue.len(),
            if task_summary.overdue.len() == 1 { "" } else { "n" },
        ));
    }

    if let Some(next) = &calendar_summary.next_event {
        if let Some(mins) = calendar_summary.minutes_until_next {
            if mins <= 60 && mins > 0 {
                parts.push(format!("Nächster Termin '{}' in {} Minuten.", next.summary, mins));
            }
        }
    }

    parts.join(" ")
}

/// Generate suggestions based on current state
fn generate_suggestions(
    email_summary: &EmailDaySummary,
    calendar_summary: &CalendarDaySummary,
    task_summary: &TaskDaySummary,
) -> Vec<AISuggestion> {
    let mut suggestions = vec![];

    // Suggest handling overdue tasks first
    if let Some(overdue) = task_summary.overdue.first() {
        suggestions.push(AISuggestion {
            suggestion_type: SuggestionType::TaskReminder,
            title: "Überfällige Aufgabe".to_string(),
            description: format!("'{}' ist überfällig - priorisiere diese Aufgabe.", overdue.summary),
            action: Some(SuggestedAction {
                action_type: "view_task".to_string(),
                target_id: overdue.id.clone(),
                target_type: "task".to_string(),
            }),
        });
    }

    // Suggest preparing for upcoming meeting
    if let Some(next) = &calendar_summary.next_event {
        if let Some(mins) = calendar_summary.minutes_until_next {
            if mins <= 30 && mins > 0 {
                suggestions.push(AISuggestion {
                    suggestion_type: SuggestionType::MeetingPrep,
                    title: "Termin vorbereiten".to_string(),
                    description: format!("'{}' beginnt in {} Minuten.", next.summary, mins),
                    action: Some(SuggestedAction {
                        action_type: "view_calendar".to_string(),
                        target_id: next.id.clone(),
                        target_type: "event".to_string(),
                    }),
                });
            }
        }
    }

    // Suggest checking important emails
    if !email_summary.important_emails.is_empty() {
        let email = &email_summary.important_emails[0];
        suggestions.push(AISuggestion {
            suggestion_type: SuggestionType::EmailAction,
            title: "Wichtige E-Mail".to_string(),
            description: format!("E-Mail von {} prüfen.", email.from),
            action: Some(SuggestedAction {
                action_type: "open_email".to_string(),
                target_id: email.uid.to_string(),
                target_type: "email".to_string(),
            }),
        });
    }

    suggestions.truncate(3); // Max 3 suggestions
    suggestions
}

/// Convert priority number to label
fn priority_to_label(priority: Option<u8>) -> String {
    match priority {
        Some(1..=3) => "high".to_string(),
        Some(4..=6) => "medium".to_string(),
        Some(7..=9) => "low".to_string(),
        _ => "medium".to_string(),
    }
}

/// Parse datetime string
fn parse_datetime(s: &str) -> Option<NaiveDateTime> {
    // Try common formats
    NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S"))
        .or_else(|_| NaiveDateTime::parse_from_str(&format!("{}T00:00:00", s), "%Y-%m-%dT%H:%M:%S"))
        .ok()
}

/// Parse date string
fn parse_date(s: &str) -> Option<NaiveDate> {
    // Try common formats
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .or_else(|_| NaiveDate::parse_from_str(&s[..10], "%Y-%m-%d"))
        .ok()
}
