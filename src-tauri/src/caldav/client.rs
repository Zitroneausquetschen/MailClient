use reqwest::Client;
use serde::{Deserialize, Serialize};
use regex::Regex;
use chrono::Utc;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub calendar_id: String,
    pub summary: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start: String,          // ISO 8601
    pub end: String,            // ISO 8601
    pub all_day: bool,
    pub recurrence_rule: Option<String>,
    pub color: Option<String>,
    pub organizer: Option<EventAttendee>,
    pub attendees: Vec<EventAttendee>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventAttendee {
    pub email: String,
    pub name: Option<String>,
    pub role: String,      // REQ-PARTICIPANT, OPT-PARTICIPANT, CHAIR
    pub status: String,    // NEEDS-ACTION, ACCEPTED, DECLINED, TENTATIVE
    pub rsvp: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalDavTask {
    pub id: String,
    pub calendar_id: String,
    pub summary: String,
    pub description: Option<String>,
    pub completed: bool,
    pub percent_complete: Option<u8>,
    pub priority: Option<u8>,  // 1-9, 1=high, 9=low
    pub due: Option<String>,   // ISO 8601
    pub created: Option<String>,
    pub last_modified: Option<String>,
    pub status: Option<String>, // NEEDS-ACTION, IN-PROCESS, COMPLETED, CANCELLED
}

pub struct CalDavClient {
    client: Client,
    base_url: String,
    username: String,
    password: String,
}

impl CalDavClient {
    pub fn new(base_url: &str, username: &str, password: &str) -> Self {
        let client = Client::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .unwrap();

        Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            username: username.to_string(),
            password: password.to_string(),
        }
    }

    pub fn discover_url(host: &str, username: &str) -> String {
        // SOGo/MailCow CalDAV URL structure
        // URL-encode the username in case it contains @ or other special characters
        let encoded_username = urlencoding::encode(username);
        format!("https://{}/SOGo/dav/{}/Calendar/", host, encoded_username)
    }

    pub async fn test_connection(&self) -> Result<bool, String> {
        let response = self.client
            .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &self.base_url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Depth", "0")
            .header("Content-Type", "application/xml; charset=utf-8")
            .send()
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;

        Ok(response.status().is_success() || response.status().as_u16() == 207)
    }

    pub async fn fetch_calendars(&self) -> Result<Vec<Calendar>, String> {
        let propfind_body = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <cs:calendar-color/>
    <d:resourcetype/>
    <c:calendar-description/>
  </d:prop>
</d:propfind>"#;

        // Debug: write to file in app data directory (more reliable on Windows)
        let debug_path = dirs::data_local_dir()
            .map(|p| p.join("MailClient").join("caldav_debug.txt"))
            .unwrap_or_else(|| std::path::PathBuf::from("caldav_debug.txt"));
        // Ensure directory exists
        if let Some(parent) = debug_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&debug_path, format!("PROPFIND request to: {}\n", self.base_url));

        let response = self.client
            .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &self.base_url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Depth", "1")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(propfind_body)
            .send()
            .await
            .map_err(|e| format!("CalDAV request failed: {}", e))?;

        let status = response.status();
        let _ = std::fs::write(&debug_path, format!("PROPFIND request to: {}\nResponse status: {}\n", self.base_url, status));

        if !status.is_success() && status.as_u16() != 207 {
            return Err(format!("CalDAV request failed with status: {}", status));
        }

        let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
        let calendars = parse_calendars_response(&body, &self.base_url);
        let calendars_debug = format!("{:?}", calendars);
        let _ = std::fs::write(&debug_path, format!(
            "=== CalDAV Debug ===\n\
             Request URL: {}\n\
             Username: {}\n\
             Response Status: {}\n\n\
             === Response Body ===\n{}\n\n\
             === Parsed Calendars ===\n{}\n",
            self.base_url, self.username, status, body, calendars_debug
        ));
        calendars
    }

    pub async fn fetch_events(&self, calendar_id: &str, start: &str, end: &str) -> Result<Vec<CalendarEvent>, String> {
        let calendar_url = format!("{}/{}/", self.base_url, calendar_id);

        // Convert ISO dates to CalDAV format (YYYYMMDDTHHMMSSZ)
        let start_caldav = iso_to_caldav_date(start)?;
        let end_caldav = iso_to_caldav_date(end)?;

        let report_body = format!(r#"<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="{}" end="{}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>"#, start_caldav, end_caldav);

        let response = self.client
            .request(reqwest::Method::from_bytes(b"REPORT").unwrap(), &calendar_url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Depth", "1")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(report_body)
            .send()
            .await
            .map_err(|e| format!("CalDAV REPORT request failed: {}", e))?;

        if !response.status().is_success() && response.status().as_u16() != 207 {
            return Err(format!("CalDAV REPORT failed with status: {}", response.status()));
        }

        let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
        Ok(parse_events_response(&body, calendar_id))
    }

    pub async fn create_event(&self, calendar_id: &str, event: &CalendarEvent) -> Result<String, String> {
        let event_url = format!("{}/{}/{}.ics", self.base_url, calendar_id, event.id);
        let ics_data = event_to_icalendar(event);

        let response = self.client
            .put(&event_url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Content-Type", "text/calendar; charset=utf-8")
            .body(ics_data)
            .send()
            .await
            .map_err(|e| format!("Failed to create event: {}", e))?;

        if response.status().is_success() || response.status().as_u16() == 201 {
            Ok(event.id.clone())
        } else {
            Err(format!("Failed to create event: {}", response.status()))
        }
    }

    pub async fn update_event(&self, calendar_id: &str, event: &CalendarEvent) -> Result<(), String> {
        let event_url = format!("{}/{}/{}.ics", self.base_url, calendar_id, event.id);
        let ics_data = event_to_icalendar(event);

        let response = self.client
            .put(&event_url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Content-Type", "text/calendar; charset=utf-8")
            .body(ics_data)
            .send()
            .await
            .map_err(|e| format!("Failed to update event: {}", e))?;

        if response.status().is_success() || response.status().as_u16() == 204 {
            Ok(())
        } else {
            Err(format!("Failed to update event: {}", response.status()))
        }
    }

    pub async fn delete_event(&self, calendar_id: &str, event_id: &str) -> Result<(), String> {
        let event_url = format!("{}/{}/{}.ics", self.base_url, calendar_id, event_id);

        let response = self.client
            .delete(&event_url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| format!("Failed to delete event: {}", e))?;

        if response.status().is_success() || response.status().as_u16() == 204 {
            Ok(())
        } else {
            Err(format!("Failed to delete event: {}", response.status()))
        }
    }

    // Task (VTODO) methods
    pub async fn fetch_tasks(&self, calendar_id: &str) -> Result<Vec<CalDavTask>, String> {
        let calendar_url = format!("{}/{}/", self.base_url, calendar_id);

        // CalDAV REPORT to fetch all VTODOs
        let report_body = r#"<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO"/>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>"#;

        let response = self.client
            .request(reqwest::Method::from_bytes(b"REPORT").unwrap(), &calendar_url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Depth", "1")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(report_body)
            .send()
            .await
            .map_err(|e| format!("CalDAV REPORT request failed: {}", e))?;

        if !response.status().is_success() && response.status().as_u16() != 207 {
            return Err(format!("CalDAV REPORT failed with status: {}", response.status()));
        }

        let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
        Ok(parse_tasks_response(&body, calendar_id))
    }

    pub async fn create_task(&self, calendar_id: &str, task: &CalDavTask) -> Result<String, String> {
        let task_url = format!("{}/{}/{}.ics", self.base_url, calendar_id, task.id);
        let ics_data = task_to_icalendar(task);

        let response = self.client
            .put(&task_url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Content-Type", "text/calendar; charset=utf-8")
            .body(ics_data)
            .send()
            .await
            .map_err(|e| format!("Failed to create task: {}", e))?;

        if response.status().is_success() || response.status().as_u16() == 201 {
            Ok(task.id.clone())
        } else {
            let error_body = response.text().await.unwrap_or_default();
            Err(format!("Failed to create task: {}", error_body))
        }
    }

    pub async fn update_task(&self, calendar_id: &str, task: &CalDavTask) -> Result<(), String> {
        let task_url = format!("{}/{}/{}.ics", self.base_url, calendar_id, task.id);
        let ics_data = task_to_icalendar(task);

        let response = self.client
            .put(&task_url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Content-Type", "text/calendar; charset=utf-8")
            .body(ics_data)
            .send()
            .await
            .map_err(|e| format!("Failed to update task: {}", e))?;

        if response.status().is_success() || response.status().as_u16() == 204 {
            Ok(())
        } else {
            let error_body = response.text().await.unwrap_or_default();
            Err(format!("Failed to update task: {}", error_body))
        }
    }

    pub async fn delete_task(&self, calendar_id: &str, task_id: &str) -> Result<(), String> {
        let task_url = format!("{}/{}/{}.ics", self.base_url, calendar_id, task_id);

        let response = self.client
            .delete(&task_url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| format!("Failed to delete task: {}", e))?;

        if response.status().is_success() || response.status().as_u16() == 204 {
            Ok(())
        } else {
            Err(format!("Failed to delete task: {}", response.status()))
        }
    }
}

// Parse calendars from PROPFIND response
fn parse_calendars_response(xml: &str, _base_url: &str) -> Result<Vec<Calendar>, String> {
    let mut calendars = Vec::new();

    // More flexible patterns that handle various namespace prefixes (d:, D:, DAV:, or none)
    // href pattern - matches <d:href>, <D:href>, <href>, etc.
    let href_pattern = Regex::new(r"<(?:[dD]:|DAV:)?href>([^<]+)</(?:[dD]:|DAV:)?href>").unwrap();
    // displayname pattern
    let displayname_pattern = Regex::new(r"<(?:[dD]:|DAV:)?displayname>([^<]*)</(?:[dD]:|DAV:)?displayname>").unwrap();
    // calendar-color pattern (various namespaces)
    let color_pattern = Regex::new(r"<(?:cs:|x1:|IC:)?calendar-color[^>]*>([^<]*)</(?:cs:|x1:|IC:)?calendar-color>").unwrap();
    // calendar resource type pattern - match various formats including:
    // <c:calendar/>, <calendar xmlns="urn:ietf:params:xml:ns:caldav"/>, <calendar>, etc.
    let calendar_pattern = Regex::new(r#"<(?:[cC]:|cal:)?calendar(?:\s+xmlns="[^"]*")?\s*/?>|<(?:[cC]:|cal:)?calendar(?:\s+xmlns="[^"]*")?>"#).unwrap();
    // response pattern - flexible namespace handling
    let response_pattern = Regex::new(r"(?s)<(?:[dD]:|DAV:)?response>(.*?)</(?:[dD]:|DAV:)?response>").unwrap();

    for response_cap in response_pattern.captures_iter(xml) {
        let response_xml = &response_cap[1];

        // Check if this is a calendar (has calendar resource type)
        if !calendar_pattern.is_match(response_xml) {
            continue;
        }

        // Extract href (calendar ID)
        let href = href_pattern.captures(response_xml)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_default();

        // Skip the base calendar path itself
        if href.ends_with("/Calendar/") || href.is_empty() {
            continue;
        }

        // Extract calendar ID from href
        let id = href.trim_end_matches('/').split('/').last().unwrap_or("").to_string();
        if id.is_empty() {
            continue;
        }

        // Extract display name
        let name = displayname_pattern.captures(response_xml)
            .and_then(|c| c.get(1))
            .map(|m| html_escape::decode_html_entities(m.as_str()).to_string())
            .unwrap_or_else(|| id.clone());

        // Extract color
        let color = color_pattern.captures(response_xml)
            .and_then(|c| c.get(1))
            .map(|m| {
                let c = m.as_str().trim();
                // SOGo sometimes returns colors like "#FF0000FF" (with alpha), normalize to "#RRGGBB"
                if c.len() == 9 && c.starts_with('#') {
                    format!("#{}", &c[1..7])
                } else {
                    c.to_string()
                }
            });

        calendars.push(Calendar {
            id,
            name,
            color,
            description: None,
        });
    }

    Ok(calendars)
}

// Parse events from REPORT response
fn parse_events_response(xml: &str, calendar_id: &str) -> Vec<CalendarEvent> {
    let mut events = Vec::new();

    // Extract calendar-data (ICS content)
    let calendar_data_pattern = Regex::new(
        r"(?s)<(?:c:|C:|cal:)?calendar-data[^>]*>(.*?)</(?:c:|C:|cal:)?calendar-data>"
    ).unwrap();

    for cap in calendar_data_pattern.captures_iter(xml) {
        if let Some(ics_match) = cap.get(1) {
            let ics_data = html_escape::decode_html_entities(ics_match.as_str());
            if let Some(event) = parse_icalendar(&ics_data, calendar_id) {
                events.push(event);
            }
        }
    }

    events
}

// Parse a single iCalendar event
fn parse_icalendar(ics_data: &str, calendar_id: &str) -> Option<CalendarEvent> {
    let lines: Vec<&str> = ics_data.lines().collect();

    let mut uid = String::new();
    let mut summary = String::new();
    let mut description: Option<String> = None;
    let mut location: Option<String> = None;
    let mut dtstart = String::new();
    let mut dtend = String::new();
    let mut all_day = false;
    let mut rrule: Option<String> = None;
    let mut organizer: Option<EventAttendee> = None;
    let mut attendees: Vec<EventAttendee> = Vec::new();

    let mut in_vevent = false;

    for line in lines {
        let line = line.trim();

        if line == "BEGIN:VEVENT" {
            in_vevent = true;
            continue;
        }
        if line == "END:VEVENT" {
            break;
        }

        if !in_vevent {
            continue;
        }

        if line.starts_with("UID:") {
            uid = line[4..].to_string();
        } else if line.starts_with("SUMMARY:") {
            summary = unescape_icalendar(line[8..].trim());
        } else if line.starts_with("DESCRIPTION:") {
            description = Some(unescape_icalendar(line[12..].trim()));
        } else if line.starts_with("LOCATION:") {
            location = Some(unescape_icalendar(line[9..].trim()));
        } else if line.starts_with("DTSTART") {
            let (value, is_date_only) = parse_dt_line(line);
            dtstart = value;
            if is_date_only {
                all_day = true;
            }
        } else if line.starts_with("DTEND") {
            let (value, _) = parse_dt_line(line);
            dtend = value;
        } else if line.starts_with("RRULE:") {
            rrule = Some(line[6..].to_string());
        } else if line.starts_with("ORGANIZER") {
            organizer = parse_attendee_line(line, true);
        } else if line.starts_with("ATTENDEE") {
            if let Some(attendee) = parse_attendee_line(line, false) {
                attendees.push(attendee);
            }
        }
    }

    if uid.is_empty() || summary.is_empty() {
        return None;
    }

    // If no end date, set it to start date (for all-day events)
    if dtend.is_empty() {
        dtend = dtstart.clone();
    }

    Some(CalendarEvent {
        id: uid,
        calendar_id: calendar_id.to_string(),
        summary,
        description,
        location,
        start: dtstart,
        end: dtend,
        all_day,
        recurrence_rule: rrule,
        color: None,
        organizer,
        attendees,
    })
}

// Parse ORGANIZER or ATTENDEE line
fn parse_attendee_line(line: &str, is_organizer: bool) -> Option<EventAttendee> {
    // Examples:
    // ORGANIZER;CN=Max Mustermann:mailto:max@example.com
    // ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Anna:mailto:anna@example.com

    // Extract email (after mailto:)
    let email = if let Some(mailto_pos) = line.to_lowercase().find("mailto:") {
        line[mailto_pos + 7..].trim().to_string()
    } else {
        return None;
    };

    // Extract CN (common name)
    let name = if let Some(cn_match) = Regex::new(r"CN=([^;:]+)").ok()?.captures(line) {
        Some(unescape_icalendar(cn_match.get(1)?.as_str()))
    } else {
        None
    };

    // Extract ROLE
    let role = if let Some(role_match) = Regex::new(r"ROLE=([^;:]+)").ok()?.captures(line) {
        role_match.get(1)?.as_str().to_string()
    } else if is_organizer {
        "CHAIR".to_string()
    } else {
        "REQ-PARTICIPANT".to_string()
    };

    // Extract PARTSTAT
    let status = if let Some(status_match) = Regex::new(r"PARTSTAT=([^;:]+)").ok()?.captures(line) {
        status_match.get(1)?.as_str().to_string()
    } else {
        "NEEDS-ACTION".to_string()
    };

    // Extract RSVP
    let rsvp = line.to_uppercase().contains("RSVP=TRUE");

    Some(EventAttendee {
        email,
        name,
        role,
        status,
        rsvp,
    })
}

// Parse DTSTART/DTEND line and return ISO 8601 date string
fn parse_dt_line(line: &str) -> (String, bool) {
    // Examples:
    // DTSTART:20260127T090000
    // DTSTART:20260127T090000Z
    // DTSTART;VALUE=DATE:20260127
    // DTSTART;TZID=Europe/Berlin:20260127T090000

    let is_date_only = line.contains("VALUE=DATE") && !line.contains("VALUE=DATE-TIME");

    // Extract the value after the last colon
    let value = line.split(':').last().unwrap_or("").trim();

    if is_date_only {
        // Date only: YYYYMMDD -> YYYY-MM-DD
        if value.len() >= 8 {
            let iso = format!("{}-{}-{}", &value[0..4], &value[4..6], &value[6..8]);
            return (iso, true);
        }
    } else {
        // DateTime: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
        if value.len() >= 15 {
            let date_part = &value[0..8];
            let time_part = &value[9..15];
            let is_utc = value.ends_with('Z');

            let iso = format!(
                "{}-{}-{}T{}:{}:{}{}",
                &date_part[0..4],
                &date_part[4..6],
                &date_part[6..8],
                &time_part[0..2],
                &time_part[2..4],
                &time_part[4..6],
                if is_utc { "Z" } else { "" }
            );
            return (iso, false);
        }
    }

    (value.to_string(), false)
}

// Convert ISO 8601 date to CalDAV format
fn iso_to_caldav_date(iso: &str) -> Result<String, String> {
    // Input: 2026-01-27 or 2026-01-27T09:00:00 or 2026-01-27T09:00:00Z
    // Output: 20260127T000000Z

    let clean = iso.replace("-", "").replace(":", "");

    if clean.len() >= 8 {
        // If it's just a date, add time
        if clean.len() == 8 {
            return Ok(format!("{}T000000Z", clean));
        }
        // If it has time
        if clean.contains('T') {
            let parts: Vec<&str> = clean.split('T').collect();
            if parts.len() == 2 {
                let date = parts[0];
                let mut time = parts[1].replace("Z", "");
                // Ensure time is 6 digits
                while time.len() < 6 {
                    time.push('0');
                }
                return Ok(format!("{}T{}Z", date, &time[0..6]));
            }
        }
    }

    Err(format!("Invalid date format: {}", iso))
}

// Convert CalendarEvent to iCalendar format
fn event_to_icalendar(event: &CalendarEvent) -> String {
    let now = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();

    let dtstart = if event.all_day {
        format!("DTSTART;VALUE=DATE:{}", event.start.replace("-", "").split('T').next().unwrap_or(""))
    } else {
        format!("DTSTART:{}", iso_to_icalendar_dt(&event.start))
    };

    let dtend = if event.all_day {
        format!("DTEND;VALUE=DATE:{}", event.end.replace("-", "").split('T').next().unwrap_or(""))
    } else {
        format!("DTEND:{}", iso_to_icalendar_dt(&event.end))
    };

    let mut ics = format!(
        "BEGIN:VCALENDAR\r\n\
         VERSION:2.0\r\n\
         PRODID:-//MailClient//CalDAV Client//EN\r\n\
         METHOD:REQUEST\r\n\
         BEGIN:VEVENT\r\n\
         UID:{}\r\n\
         DTSTAMP:{}\r\n\
         {}\r\n\
         {}\r\n\
         SUMMARY:{}\r\n",
        event.id,
        now,
        dtstart,
        dtend,
        escape_icalendar(&event.summary)
    );

    if let Some(ref desc) = event.description {
        if !desc.is_empty() {
            ics.push_str(&format!("DESCRIPTION:{}\r\n", escape_icalendar(desc)));
        }
    }

    if let Some(ref loc) = event.location {
        if !loc.is_empty() {
            ics.push_str(&format!("LOCATION:{}\r\n", escape_icalendar(loc)));
        }
    }

    if let Some(ref rrule) = event.recurrence_rule {
        if !rrule.is_empty() {
            ics.push_str(&format!("RRULE:{}\r\n", rrule));
        }
    }

    // Add organizer
    if let Some(ref org) = event.organizer {
        let cn_part = if let Some(ref name) = org.name {
            format!(";CN={}", escape_icalendar(name))
        } else {
            String::new()
        };
        ics.push_str(&format!("ORGANIZER{}:mailto:{}\r\n", cn_part, org.email));
    }

    // Add attendees
    for attendee in &event.attendees {
        let cn_part = if let Some(ref name) = attendee.name {
            format!(";CN={}", escape_icalendar(name))
        } else {
            String::new()
        };
        let rsvp_part = if attendee.rsvp { ";RSVP=TRUE" } else { "" };
        ics.push_str(&format!(
            "ATTENDEE;ROLE={};PARTSTAT={}{}{}:mailto:{}\r\n",
            attendee.role,
            attendee.status,
            cn_part,
            rsvp_part,
            attendee.email
        ));
    }

    ics.push_str("END:VEVENT\r\n");
    ics.push_str("END:VCALENDAR\r\n");

    ics
}

// Convert ISO datetime to iCalendar format
fn iso_to_icalendar_dt(iso: &str) -> String {
    // Input: 2026-01-27T09:00:00 or 2026-01-27T09:00:00Z
    // Output: 20260127T090000 or 20260127T090000Z

    let clean = iso.replace("-", "").replace(":", "");
    clean
}

// Escape special characters for iCalendar
fn escape_icalendar(text: &str) -> String {
    text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
        .replace("\r", "")
}

// Unescape iCalendar text
fn unescape_icalendar(text: &str) -> String {
    text.replace("\\n", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}

// Parse tasks from REPORT response
fn parse_tasks_response(xml: &str, calendar_id: &str) -> Vec<CalDavTask> {
    let mut tasks = Vec::new();

    // Extract calendar-data (ICS content)
    let calendar_data_pattern = Regex::new(
        r"(?s)<(?:c:|C:|cal:)?calendar-data[^>]*>(.*?)</(?:c:|C:|cal:)?calendar-data>"
    ).unwrap();

    for cap in calendar_data_pattern.captures_iter(xml) {
        if let Some(ics_match) = cap.get(1) {
            let ics_data = html_escape::decode_html_entities(ics_match.as_str());
            if let Some(task) = parse_vtodo(&ics_data, calendar_id) {
                tasks.push(task);
            }
        }
    }

    tasks
}

// Parse a single VTODO from iCalendar data
fn parse_vtodo(ics_data: &str, calendar_id: &str) -> Option<CalDavTask> {
    let lines: Vec<&str> = ics_data.lines().collect();

    let mut uid = String::new();
    let mut summary = String::new();
    let mut description: Option<String> = None;
    let mut status: Option<String> = None;
    let mut completed = false;
    let mut percent_complete: Option<u8> = None;
    let mut priority: Option<u8> = None;
    let mut due: Option<String> = None;
    let mut created: Option<String> = None;
    let mut last_modified: Option<String> = None;

    let mut in_vtodo = false;

    for line in lines {
        let line = line.trim();

        if line == "BEGIN:VTODO" {
            in_vtodo = true;
            continue;
        }
        if line == "END:VTODO" {
            break;
        }

        if !in_vtodo {
            continue;
        }

        if line.starts_with("UID:") {
            uid = line[4..].to_string();
        } else if line.starts_with("SUMMARY:") {
            summary = unescape_icalendar(line[8..].trim());
        } else if line.starts_with("DESCRIPTION:") {
            description = Some(unescape_icalendar(line[12..].trim()));
        } else if line.starts_with("STATUS:") {
            let s = line[7..].trim().to_uppercase();
            completed = s == "COMPLETED";
            status = Some(s);
        } else if line.starts_with("PERCENT-COMPLETE:") {
            if let Ok(p) = line[17..].trim().parse::<u8>() {
                percent_complete = Some(p);
                if p == 100 {
                    completed = true;
                }
            }
        } else if line.starts_with("PRIORITY:") {
            if let Ok(p) = line[9..].trim().parse::<u8>() {
                priority = Some(p);
            }
        } else if line.starts_with("DUE") {
            let (value, _) = parse_dt_line(line);
            if !value.is_empty() {
                due = Some(value);
            }
        } else if line.starts_with("CREATED:") {
            let val = line[8..].trim();
            if val.len() >= 8 {
                created = Some(parse_icalendar_dt_to_iso(val));
            }
        } else if line.starts_with("LAST-MODIFIED:") {
            let val = line[14..].trim();
            if val.len() >= 8 {
                last_modified = Some(parse_icalendar_dt_to_iso(val));
            }
        } else if line.starts_with("COMPLETED:") {
            completed = true;
        }
    }

    if uid.is_empty() {
        return None;
    }

    // Use summary or a default
    if summary.is_empty() {
        summary = "Untitled Task".to_string();
    }

    Some(CalDavTask {
        id: uid,
        calendar_id: calendar_id.to_string(),
        summary,
        description,
        completed,
        percent_complete,
        priority,
        due,
        created,
        last_modified,
        status,
    })
}

// Parse iCalendar datetime to ISO format
fn parse_icalendar_dt_to_iso(val: &str) -> String {
    // Input: 20260127T090000 or 20260127T090000Z or 20260127
    if val.len() >= 15 && val.contains('T') {
        let is_utc = val.ends_with('Z');
        let clean = val.replace("Z", "");
        format!(
            "{}-{}-{}T{}:{}:{}{}",
            &clean[0..4],
            &clean[4..6],
            &clean[6..8],
            &clean[9..11],
            &clean[11..13],
            &clean[13..15],
            if is_utc { "Z" } else { "" }
        )
    } else if val.len() >= 8 {
        format!("{}-{}-{}", &val[0..4], &val[4..6], &val[6..8])
    } else {
        val.to_string()
    }
}

// Convert CalDavTask to iCalendar VTODO format
fn task_to_icalendar(task: &CalDavTask) -> String {
    let now = Utc::now().format("%Y%m%dT%H%M%SZ").to_string();

    let mut ics = format!(
        "BEGIN:VCALENDAR\r\n\
         VERSION:2.0\r\n\
         PRODID:-//MailClient//CalDAV Client//EN\r\n\
         BEGIN:VTODO\r\n\
         UID:{}\r\n\
         DTSTAMP:{}\r\n\
         SUMMARY:{}\r\n",
        task.id,
        now,
        escape_icalendar(&task.summary)
    );

    // Add created timestamp
    if let Some(ref created) = task.created {
        ics.push_str(&format!("CREATED:{}\r\n", iso_to_icalendar_dt(created)));
    } else {
        ics.push_str(&format!("CREATED:{}\r\n", now));
    }

    // Add last-modified
    ics.push_str(&format!("LAST-MODIFIED:{}\r\n", now));

    // Add description
    if let Some(ref desc) = task.description {
        if !desc.is_empty() {
            ics.push_str(&format!("DESCRIPTION:{}\r\n", escape_icalendar(desc)));
        }
    }

    // Add due date
    if let Some(ref due) = task.due {
        if !due.is_empty() {
            // Check if it's date-only or datetime
            if due.contains('T') {
                ics.push_str(&format!("DUE:{}\r\n", iso_to_icalendar_dt(due)));
            } else {
                ics.push_str(&format!("DUE;VALUE=DATE:{}\r\n", due.replace("-", "")));
            }
        }
    }

    // Add priority (1-9, where 1 is highest)
    if let Some(prio) = task.priority {
        ics.push_str(&format!("PRIORITY:{}\r\n", prio));
    }

    // Add status and percent-complete
    if task.completed {
        ics.push_str("STATUS:COMPLETED\r\n");
        ics.push_str("PERCENT-COMPLETE:100\r\n");
        ics.push_str(&format!("COMPLETED:{}\r\n", now));
    } else {
        ics.push_str("STATUS:NEEDS-ACTION\r\n");
        if let Some(pc) = task.percent_complete {
            ics.push_str(&format!("PERCENT-COMPLETE:{}\r\n", pc));
        }
    }

    ics.push_str("END:VTODO\r\n");
    ics.push_str("END:VCALENDAR\r\n");

    ics
}
