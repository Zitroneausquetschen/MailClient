use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub id: String,
    pub display_name: String,
    pub first_name: String,
    pub last_name: String,
    pub emails: Vec<ContactEmail>,
    pub phones: Vec<ContactPhone>,
    pub organization: Option<String>,
    pub photo_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactEmail {
    pub email: String,
    pub label: String, // "work", "home", "other"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactPhone {
    pub number: String,
    pub label: String,
}

pub struct CardDavClient {
    client: Client,
    base_url: String,
    username: String,
    password: String,
}

impl CardDavClient {
    pub fn new(base_url: &str, username: &str, password: &str) -> Self {
        let client = Client::builder()
            .danger_accept_invalid_certs(true) // For self-signed certs
            .build()
            .unwrap();

        // Normalize base URL
        let base_url = base_url.trim_end_matches('/').to_string();

        Self {
            client,
            base_url,
            username: username.to_string(),
            password: password.to_string(),
        }
    }

    /// Auto-discover CardDAV URL from email domain
    pub fn discover_url(host: &str, username: &str) -> String {
        // Mailcow/SOGo format
        format!("https://{}/SOGo/dav/{}/Contacts/personal/", host, username)
    }

    /// Fetch all contacts from the CardDAV server
    pub async fn fetch_contacts(&self) -> Result<Vec<Contact>, String> {
        // PROPFIND request to get all vcards
        let propfind_body = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop>
    <d:getetag/>
    <card:address-data/>
  </d:prop>
</d:propfind>"#;

        let response = self.client
            .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &self.base_url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Depth", "1")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(propfind_body)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch contacts: {}", e))?;

        if !response.status().is_success() && response.status().as_u16() != 207 {
            return Err(format!("CardDAV request failed with status: {}", response.status()));
        }

        let body = response.text().await
            .map_err(|e| format!("Failed to read response: {}", e))?;

        // Parse the multistatus response and extract vCards
        let contacts = parse_carddav_response(&body)?;

        Ok(contacts)
    }

    /// Test connection to CardDAV server
    pub async fn test_connection(&self) -> Result<bool, String> {
        let response = self.client
            .request(reqwest::Method::from_bytes(b"PROPFIND").unwrap(), &self.base_url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Depth", "0")
            .send()
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;

        Ok(response.status().is_success() || response.status().as_u16() == 207)
    }

    /// Create a new contact on the CardDAV server
    pub async fn create_contact(&self, contact: &Contact) -> Result<String, String> {
        let vcard = contact_to_vcard(contact);
        let contact_url = format!("{}/{}.vcf", self.base_url, contact.id);

        let response = self.client
            .put(&contact_url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Content-Type", "text/vcard; charset=utf-8")
            .body(vcard)
            .send()
            .await
            .map_err(|e| format!("Failed to create contact: {}", e))?;

        if response.status().is_success() || response.status().as_u16() == 201 {
            Ok(contact.id.clone())
        } else {
            Err(format!("Failed to create contact: {}", response.status()))
        }
    }

    /// Update an existing contact on the CardDAV server
    pub async fn update_contact(&self, contact: &Contact) -> Result<(), String> {
        let vcard = contact_to_vcard(contact);
        let contact_url = format!("{}/{}.vcf", self.base_url, contact.id);

        let response = self.client
            .put(&contact_url)
            .basic_auth(&self.username, Some(&self.password))
            .header("Content-Type", "text/vcard; charset=utf-8")
            .body(vcard)
            .send()
            .await
            .map_err(|e| format!("Failed to update contact: {}", e))?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(format!("Failed to update contact: {}", response.status()))
        }
    }

    /// Delete a contact from the CardDAV server
    pub async fn delete_contact(&self, contact_id: &str) -> Result<(), String> {
        let contact_url = format!("{}/{}.vcf", self.base_url, contact_id);

        let response = self.client
            .delete(&contact_url)
            .basic_auth(&self.username, Some(&self.password))
            .send()
            .await
            .map_err(|e| format!("Failed to delete contact: {}", e))?;

        if response.status().is_success() || response.status().as_u16() == 204 {
            Ok(())
        } else {
            Err(format!("Failed to delete contact: {}", response.status()))
        }
    }
}

/// Convert a Contact to vCard format
fn contact_to_vcard(contact: &Contact) -> String {
    let mut vcard = String::new();
    vcard.push_str("BEGIN:VCARD\r\n");
    vcard.push_str("VERSION:3.0\r\n");
    vcard.push_str(&format!("UID:{}\r\n", contact.id));
    vcard.push_str(&format!("FN:{}\r\n", escape_vcard_value(&contact.display_name)));
    vcard.push_str(&format!("N:{};{};;;\r\n",
        escape_vcard_value(&contact.last_name),
        escape_vcard_value(&contact.first_name)
    ));

    for email in &contact.emails {
        let type_param = match email.label.as_str() {
            "work" => "WORK",
            "home" => "HOME",
            _ => "OTHER",
        };
        vcard.push_str(&format!("EMAIL;TYPE={}:{}\r\n", type_param, &email.email));
    }

    for phone in &contact.phones {
        let type_param = match phone.label.as_str() {
            "work" => "WORK",
            "home" => "HOME",
            "mobile" => "CELL",
            _ => "OTHER",
        };
        vcard.push_str(&format!("TEL;TYPE={}:{}\r\n", type_param, &phone.number));
    }

    if let Some(ref org) = contact.organization {
        vcard.push_str(&format!("ORG:{}\r\n", escape_vcard_value(org)));
    }

    vcard.push_str("END:VCARD\r\n");
    vcard
}

/// Escape special characters for vCard values
fn escape_vcard_value(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace(',', "\\,")
        .replace(';', "\\;")
        .replace('\n', "\\n")
}

/// Parse CardDAV PROPFIND response and extract contacts
fn parse_carddav_response(xml: &str) -> Result<Vec<Contact>, String> {
    let mut contacts = Vec::new();

    // Simple extraction of vCard data from response
    // Look for <card:address-data> or <C:address-data> elements
    let vcard_pattern = regex::Regex::new(r"(?s)<(?:card|C):address-data[^>]*>(.*?)</(?:card|C):address-data>")
        .map_err(|e| format!("Regex error: {}", e))?;

    for cap in vcard_pattern.captures_iter(xml) {
        if let Some(vcard_match) = cap.get(1) {
            let vcard_data = html_escape::decode_html_entities(vcard_match.as_str());
            if let Some(contact) = parse_vcard(&vcard_data) {
                contacts.push(contact);
            }
        }
    }

    // Also try to find raw vCard data (some servers include it differently)
    if contacts.is_empty() {
        let raw_vcard_pattern = regex::Regex::new(r"(?s)BEGIN:VCARD.*?END:VCARD")
            .map_err(|e| format!("Regex error: {}", e))?;

        for cap in raw_vcard_pattern.find_iter(xml) {
            let vcard_data = html_escape::decode_html_entities(cap.as_str());
            if let Some(contact) = parse_vcard(&vcard_data) {
                contacts.push(contact);
            }
        }
    }

    Ok(contacts)
}

/// Parse a vCard string into a Contact
fn parse_vcard(vcard: &str) -> Option<Contact> {
    let lines: Vec<&str> = vcard.lines().collect();

    let mut uid = String::new();
    let mut display_name = String::new();
    let mut first_name = String::new();
    let mut last_name = String::new();
    let mut emails: Vec<ContactEmail> = Vec::new();
    let mut phones: Vec<ContactPhone> = Vec::new();
    let mut organization: Option<String> = None;

    for line in lines {
        let line = line.trim();

        // Handle UID
        if line.starts_with("UID:") {
            uid = line[4..].to_string();
        }
        // Handle FN (Formatted Name / Display Name)
        else if line.starts_with("FN:") || line.starts_with("FN;") {
            display_name = extract_vcard_value(line);
        }
        // Handle N (Name: last;first;middle;prefix;suffix)
        else if line.starts_with("N:") || line.starts_with("N;") {
            let name_value = extract_vcard_value(line);
            let parts: Vec<&str> = name_value.split(';').collect();
            if parts.len() >= 2 {
                last_name = parts[0].to_string();
                first_name = parts[1].to_string();
            }
        }
        // Handle EMAIL
        else if line.starts_with("EMAIL") {
            let email_value = extract_vcard_value(line);
            let label = extract_type_param(line).unwrap_or("other".to_string());
            if !email_value.is_empty() {
                emails.push(ContactEmail {
                    email: email_value,
                    label,
                });
            }
        }
        // Handle TEL (Phone)
        else if line.starts_with("TEL") {
            let phone_value = extract_vcard_value(line);
            let label = extract_type_param(line).unwrap_or("other".to_string());
            if !phone_value.is_empty() {
                phones.push(ContactPhone {
                    number: phone_value,
                    label,
                });
            }
        }
        // Handle ORG (Organization)
        else if line.starts_with("ORG:") || line.starts_with("ORG;") {
            let org_value = extract_vcard_value(line);
            if !org_value.is_empty() {
                organization = Some(org_value.replace(';', " ").trim().to_string());
            }
        }
    }

    // Generate UID if not present
    if uid.is_empty() {
        uid = format!("{:x}", md5::compute(vcard.as_bytes()));
    }

    // Use email as display name if not set
    if display_name.is_empty() {
        if !first_name.is_empty() || !last_name.is_empty() {
            display_name = format!("{} {}", first_name, last_name).trim().to_string();
        } else if let Some(email) = emails.first() {
            display_name = email.email.clone();
        } else {
            return None; // Skip contacts without name or email
        }
    }

    // Skip if no emails
    if emails.is_empty() {
        return None;
    }

    Some(Contact {
        id: uid,
        display_name,
        first_name,
        last_name,
        emails,
        phones,
        organization,
        photo_url: None,
    })
}

/// Extract the value part from a vCard line (handles parameters)
fn extract_vcard_value(line: &str) -> String {
    // Find the colon that separates property from value
    if let Some(colon_pos) = line.find(':') {
        let value = &line[colon_pos + 1..];
        // Decode escaped characters
        value
            .replace("\\n", "\n")
            .replace("\\,", ",")
            .replace("\\;", ";")
            .replace("\\\\", "\\")
            .trim()
            .to_string()
    } else {
        String::new()
    }
}

/// Extract TYPE parameter from a vCard line
fn extract_type_param(line: &str) -> Option<String> {
    let line_upper = line.to_uppercase();

    if line_upper.contains("TYPE=WORK") || line_upper.contains("TYPE=\"WORK\"") {
        Some("work".to_string())
    } else if line_upper.contains("TYPE=HOME") || line_upper.contains("TYPE=\"HOME\"") {
        Some("home".to_string())
    } else if line_upper.contains("TYPE=CELL") || line_upper.contains("TYPE=\"CELL\"") {
        Some("mobile".to_string())
    } else {
        None
    }
}
