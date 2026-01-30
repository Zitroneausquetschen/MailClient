use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoConfigResult {
    pub imap_host: Option<String>,
    pub imap_port: Option<u16>,
    pub imap_socket_type: Option<String>,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<u16>,
    pub smtp_socket_type: Option<String>,
    pub display_name: Option<String>,
    pub jmap_url: Option<String>,
}

impl Default for AutoConfigResult {
    fn default() -> Self {
        Self {
            imap_host: None,
            imap_port: None,
            imap_socket_type: None,
            smtp_host: None,
            smtp_port: None,
            smtp_socket_type: None,
            display_name: None,
            jmap_url: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JmapDiscoveryResult {
    pub jmap_url: Option<String>,
}

pub async fn lookup_autoconfig(email: &str) -> Result<AutoConfigResult, String> {
    let parts: Vec<&str> = email.split('@').collect();
    if parts.len() != 2 {
        return Err("Invalid email format".to_string());
    }
    let domain = parts[1];

    // Try different autoconfig URLs in order
    let urls = vec![
        format!("https://autoconfig.{}/mail/config-v1.1.xml?emailaddress={}", domain, email),
        format!("https://{}/.well-known/autoconfig/mail/config-v1.1.xml?emailaddress={}", domain, email),
        format!("http://autoconfig.{}/mail/config-v1.1.xml?emailaddress={}", domain, email),
        format!("https://autoconfig.thunderbird.net/v1.1/{}", domain),
    ];

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    for url in urls {
        match client.get(&url).send().await {
            Ok(response) if response.status().is_success() => {
                if let Ok(text) = response.text().await {
                    if let Some(config) = parse_autoconfig_xml(&text, email) {
                        return Ok(config);
                    }
                }
            }
            _ => continue,
        }
    }

    // If no autoconfig found, try common patterns
    Ok(AutoConfigResult {
        imap_host: Some(format!("imap.{}", domain)),
        imap_port: Some(993),
        imap_socket_type: Some("SSL".to_string()),
        smtp_host: Some(format!("smtp.{}", domain)),
        smtp_port: Some(587),
        smtp_socket_type: Some("STARTTLS".to_string()),
        display_name: None,
        jmap_url: None,
    })
}

fn parse_autoconfig_xml(xml: &str, email: &str) -> Option<AutoConfigResult> {
    let mut result = AutoConfigResult::default();

    // Simple XML parsing for autoconfig format
    // Looking for <incomingServer type="imap"> and <outgoingServer type="smtp">

    let domain = email.split('@').nth(1).unwrap_or("");
    let local_part = email.split('@').nth(0).unwrap_or("");

    // Parse incoming server (IMAP)
    if let Some(imap_section) = find_section(xml, "incomingServer", "imap") {
        result.imap_host = extract_value(&imap_section, "hostname")
            .map(|h| replace_placeholders(&h, email, domain, local_part));
        result.imap_port = extract_value(&imap_section, "port")
            .and_then(|p| p.parse().ok());
        result.imap_socket_type = extract_value(&imap_section, "socketType");
    }

    // Parse outgoing server (SMTP)
    if let Some(smtp_section) = find_section(xml, "outgoingServer", "smtp") {
        result.smtp_host = extract_value(&smtp_section, "hostname")
            .map(|h| replace_placeholders(&h, email, domain, local_part));
        result.smtp_port = extract_value(&smtp_section, "port")
            .and_then(|p| p.parse().ok());
        result.smtp_socket_type = extract_value(&smtp_section, "socketType");
    }

    // Extract display name if available
    result.display_name = extract_value(xml, "displayName");

    if result.imap_host.is_some() || result.smtp_host.is_some() {
        Some(result)
    } else {
        None
    }
}

fn find_section(xml: &str, tag: &str, type_attr: &str) -> Option<String> {
    // Find <incomingServer type="imap"> or <outgoingServer type="smtp">
    let pattern = format!("<{}", tag);
    let mut pos = 0;

    while let Some(start) = xml[pos..].find(&pattern) {
        let start = pos + start;
        let tag_end = xml[start..].find('>')?;
        let tag_content = &xml[start..start + tag_end + 1];

        // Check if type attribute matches
        if tag_content.contains(&format!("type=\"{}\"", type_attr))
           || tag_content.contains(&format!("type='{}'", type_attr)) {
            // Find the closing tag
            let close_tag = format!("</{}>", tag);
            if let Some(end) = xml[start..].find(&close_tag) {
                return Some(xml[start..start + end + close_tag.len()].to_string());
            }
        }

        pos = start + 1;
    }

    None
}

fn extract_value(xml: &str, tag: &str) -> Option<String> {
    let open_tag = format!("<{}>", tag);
    let close_tag = format!("</{}>", tag);

    if let Some(start) = xml.find(&open_tag) {
        let value_start = start + open_tag.len();
        if let Some(end) = xml[value_start..].find(&close_tag) {
            let value = xml[value_start..value_start + end].trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }

    None
}

fn replace_placeholders(template: &str, email: &str, domain: &str, local_part: &str) -> String {
    template
        .replace("%EMAILADDRESS%", email)
        .replace("%EMAILLOCALPART%", local_part)
        .replace("%EMAILDOMAIN%", domain)
}

/// Discover JMAP server URL for an email domain
/// JMAP servers expose their endpoint at /.well-known/jmap
pub async fn lookup_jmap_url(email: &str) -> Result<JmapDiscoveryResult, String> {
    let parts: Vec<&str> = email.split('@').collect();
    if parts.len() != 2 {
        return Err("Invalid email format".to_string());
    }
    let domain = parts[1];

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Try common JMAP well-known URLs
    let urls = vec![
        format!("https://{}/.well-known/jmap", domain),
        format!("https://mail.{}/.well-known/jmap", domain),
        format!("https://jmap.{}/.well-known/jmap", domain),
    ];

    for url in urls {
        match client.get(&url).send().await {
            Ok(response) if response.status().is_success() => {
                // JMAP well-known should return a JSON object with capabilities
                if let Ok(text) = response.text().await {
                    // Check if it looks like a valid JMAP session response
                    if text.contains("capabilities") || text.contains("apiUrl") {
                        // The URL we called is the JMAP URL
                        return Ok(JmapDiscoveryResult {
                            jmap_url: Some(url),
                        });
                    }
                }
            }
            Ok(response) => {
                // Check for redirect - the final URL might be the JMAP endpoint
                let final_url = response.url().to_string();
                if final_url != url && response.status().is_success() {
                    return Ok(JmapDiscoveryResult {
                        jmap_url: Some(final_url),
                    });
                }
            }
            Err(_) => continue,
        }
    }

    // No JMAP server found
    Ok(JmapDiscoveryResult {
        jmap_url: None,
    })
}
