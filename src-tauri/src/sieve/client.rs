use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use native_tls::TlsConnector;
use serde::{Deserialize, Serialize};
use std::io::{self, Error, ErrorKind};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_native_tls::TlsStream;

const READ_TIMEOUT: Duration = Duration::from_secs(30);

// ManageSieve protocol commands
const CMD_STARTTLS: &str = "STARTTLS";
const CMD_AUTHENTICATE: &str = "AUTHENTICATE";
const CMD_LOGOUT: &str = "LOGOUT";
const CMD_LISTSCRIPTS: &str = "LISTSCRIPTS";
const CMD_GETSCRIPT: &str = "GETSCRIPT";
const CMD_PUTSCRIPT: &str = "PUTSCRIPT";
const CMD_SETACTIVE: &str = "SETACTIVE";
const CMD_DELETESCRIPT: &str = "DELETESCRIPT";

// Response status codes
const RESP_OK: &str = "OK";
const RESP_NO: &str = "NO";
const RESP_BYE: &str = "BYE";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SieveScript {
    pub name: String,
    pub active: bool,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SieveRule {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub conditions: Vec<SieveCondition>,
    pub actions: Vec<SieveAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SieveCondition {
    pub field: String,
    pub operator: String,
    pub value: String,
    pub header_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SieveAction {
    pub action_type: String,
    pub value: Option<String>,
}

enum StreamType {
    Plain(BufReader<TcpStream>),
    Tls(BufReader<TlsStream<TcpStream>>),
}

pub struct SieveClient {
    host: String,
    port: u16,
    stream: Option<StreamType>,
}

impl SieveClient {
    pub fn new(host: String, port: u16) -> Self {
        Self {
            host,
            port,
            stream: None,
        }
    }

    pub async fn connect(&mut self, username: &str, password: &str) -> io::Result<()> {
        let tcp_stream = TcpStream::connect(format!("{}:{}", self.host, self.port)).await?;

        // Read initial server greeting
        let mut reader = BufReader::new(tcp_stream);
        let capabilities = self.read_capabilities(&mut reader).await?;

        // Check if STARTTLS is available
        if capabilities.iter().any(|c| c.contains("STARTTLS")) {
            // Send STARTTLS command
            let tcp_stream = reader.into_inner();
            let tcp_stream = self.send_starttls(tcp_stream).await?;

            // Upgrade to TLS
            let connector = TlsConnector::builder()
                .danger_accept_invalid_certs(true)
                .build()
                .map_err(|e| Error::new(ErrorKind::Other, e))?;

            let connector = tokio_native_tls::TlsConnector::from(connector);
            let tls_stream = connector
                .connect(&self.host, tcp_stream)
                .await
                .map_err(|e| Error::new(ErrorKind::Other, e))?;

            let mut tls_reader = BufReader::new(tls_stream);

            // Re-read capabilities after TLS
            let _new_caps = self.read_capabilities(&mut tls_reader).await?;
            self.stream = Some(StreamType::Tls(tls_reader));
        } else {
            self.stream = Some(StreamType::Plain(reader));
        }

        // Authenticate
        self.authenticate(username, password).await?;

        Ok(())
    }

    async fn send_starttls(&self, mut stream: TcpStream) -> io::Result<TcpStream> {
        stream
            .write_all(format!("{}\r\n", CMD_STARTTLS).as_bytes())
            .await?;
        stream.flush().await?;

        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader.read_line(&mut line).await?;

        if line.starts_with(RESP_OK) {
            Ok(reader.into_inner())
        } else {
            Err(Error::new(ErrorKind::Other, format!("STARTTLS failed: {}", line.trim())))
        }
    }

    async fn read_capabilities<R: AsyncBufReadExt + Unpin>(
        &self,
        reader: &mut R,
    ) -> io::Result<Vec<String>> {
        let mut capabilities = Vec::new();
        let mut line = String::new();

        loop {
            line.clear();
            reader.read_line(&mut line).await?;
            let trimmed = line.trim();

            if trimmed.starts_with(RESP_OK) {
                break;
            } else if trimmed.starts_with(RESP_NO) || trimmed.starts_with(RESP_BYE) {
                return Err(Error::new(ErrorKind::Other, trimmed.to_string()));
            } else if !trimmed.is_empty() {
                capabilities.push(trimmed.to_string());
            }
        }

        Ok(capabilities)
    }

    async fn authenticate(&mut self, username: &str, password: &str) -> io::Result<()> {
        let auth_string = format!("\x00{}\x00{}", username, password);
        let encoded = BASE64.encode(auth_string.as_bytes());

        let command = format!("{} \"PLAIN\" \"{}\"\r\n", CMD_AUTHENTICATE, encoded);
        self.send_command(&command).await?;

        let response = self.read_response().await?;
        if response.starts_with(RESP_OK) {
            Ok(())
        } else {
            Err(Error::new(ErrorKind::PermissionDenied, response))
        }
    }

    pub async fn disconnect(&mut self) -> io::Result<()> {
        if self.stream.is_some() {
            let _ = self.send_command(&format!("{}\r\n", CMD_LOGOUT)).await;
            let _ = self.read_response().await;
            self.stream = None;
        }
        Ok(())
    }

    pub async fn list_scripts(&mut self) -> io::Result<Vec<SieveScript>> {
        self.send_command(&format!("{}\r\n", CMD_LISTSCRIPTS)).await?;

        let mut scripts = Vec::new();
        loop {
            let line = self.read_line().await?;
            let trimmed = line.trim();

            if trimmed.starts_with(RESP_OK) {
                break;
            } else if trimmed.starts_with(RESP_NO) {
                return Err(Error::new(ErrorKind::Other, trimmed.to_string()));
            } else if !trimmed.is_empty() && trimmed.starts_with('"') {
                if let Some(end) = trimmed[1..].find('"') {
                    let name = trimmed[1..=end].to_string();
                    let active = trimmed[end + 2..].contains("ACTIVE");
                    scripts.push(SieveScript {
                        name,
                        active,
                        content: None,
                    });
                }
            }
        }

        Ok(scripts)
    }

    pub async fn get_script(&mut self, name: &str) -> io::Result<String> {
        self.send_command(&format!("{} \"{}\"\r\n", CMD_GETSCRIPT, name)).await?;

        let mut content = String::new();
        let mut in_literal = false;
        let mut literal_size: usize = 0;
        let mut collected: usize = 0;

        loop {
            let line = self.read_line().await?;
            let trimmed = line.trim();

            if trimmed.starts_with(RESP_OK) {
                break;
            } else if trimmed.starts_with(RESP_NO) {
                return Err(Error::new(ErrorKind::NotFound, trimmed.to_string()));
            } else if !in_literal && trimmed.starts_with('{') && trimmed.ends_with('}') {
                if let Ok(size) = trimmed[1..trimmed.len() - 1].parse::<usize>() {
                    literal_size = size;
                    in_literal = true;
                }
            } else if in_literal {
                content.push_str(&line);
                collected += line.len();
                if collected >= literal_size {
                    in_literal = false;
                }
            }
        }

        Ok(content.trim_end().to_string())
    }

    pub async fn put_script(&mut self, name: &str, content: &str) -> io::Result<()> {
        let literal_size = content.len();
        let command = format!(
            "{} \"{}\" {{{}+}}\r\n{}\r\n",
            CMD_PUTSCRIPT, name, literal_size, content
        );
        self.send_command(&command).await?;

        let response = self.read_response().await?;
        if response.starts_with(RESP_OK) {
            Ok(())
        } else {
            Err(Error::new(ErrorKind::Other, response))
        }
    }

    pub async fn activate_script(&mut self, name: &str) -> io::Result<()> {
        let command = format!("{} \"{}\"\r\n", CMD_SETACTIVE, name);
        self.send_command(&command).await?;

        let response = self.read_response().await?;
        if response.starts_with(RESP_OK) {
            Ok(())
        } else {
            Err(Error::new(ErrorKind::Other, response))
        }
    }

    pub async fn delete_script(&mut self, name: &str) -> io::Result<()> {
        self.send_command(&format!("{} \"{}\"\r\n", CMD_DELETESCRIPT, name)).await?;

        let response = self.read_response().await?;
        if response.starts_with(RESP_OK) {
            Ok(())
        } else {
            Err(Error::new(ErrorKind::Other, response))
        }
    }

    async fn send_command(&mut self, command: &str) -> io::Result<()> {
        match &mut self.stream {
            Some(StreamType::Plain(reader)) => {
                let stream = reader.get_mut();
                stream.write_all(command.as_bytes()).await?;
                stream.flush().await
            }
            Some(StreamType::Tls(reader)) => {
                let stream = reader.get_mut();
                stream.write_all(command.as_bytes()).await?;
                stream.flush().await
            }
            None => Err(Error::new(ErrorKind::NotConnected, "Not connected")),
        }
    }

    async fn read_line(&mut self) -> io::Result<String> {
        let mut line = String::new();
        let result = match &mut self.stream {
            Some(StreamType::Plain(reader)) => {
                timeout(READ_TIMEOUT, reader.read_line(&mut line)).await
            }
            Some(StreamType::Tls(reader)) => {
                timeout(READ_TIMEOUT, reader.read_line(&mut line)).await
            }
            None => return Err(Error::new(ErrorKind::NotConnected, "Not connected")),
        };

        match result {
            Ok(Ok(_)) => Ok(line),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(Error::new(ErrorKind::TimedOut, "Read timeout")),
        }
    }

    async fn read_response(&mut self) -> io::Result<String> {
        loop {
            let line = self.read_line().await?;
            let trimmed = line.trim();
            if trimmed.starts_with(RESP_OK)
                || trimmed.starts_with(RESP_NO)
                || trimmed.starts_with(RESP_BYE)
            {
                return Ok(trimmed.to_string());
            }
        }
    }
}

// Helper functions to convert between visual rules and Sieve script

pub fn rules_to_sieve_script(rules: &[SieveRule]) -> String {
    let mut script = String::new();

    script.push_str("require [\"fileinto\", \"imap4flags\", \"reject\", \"vacation\"];\n\n");

    for rule in rules {
        if !rule.enabled {
            script.push_str("# DISABLED: ");
        }
        script.push_str(&format!("# Rule: {}\n", rule.name));

        if rule.conditions.is_empty() {
            continue;
        }

        script.push_str("if ");

        if rule.conditions.len() > 1 {
            script.push_str("allof (\n");
        }

        for (i, cond) in rule.conditions.iter().enumerate() {
            if i > 0 {
                script.push_str(",\n");
            }

            let field = match cond.field.as_str() {
                "from" => "from",
                "to" => "to",
                "subject" => "subject",
                "header" => cond.header_name.as_deref().unwrap_or("X-Custom"),
                _ => "from",
            };

            let test = match cond.operator.as_str() {
                "contains" => format!("header :contains \"{}\" \"{}\"", field, cond.value),
                "is" => format!("header :is \"{}\" \"{}\"", field, cond.value),
                "matches" => format!("header :matches \"{}\" \"{}\"", field, cond.value),
                "regex" => format!("header :regex \"{}\" \"{}\"", field, cond.value),
                _ => format!("header :contains \"{}\" \"{}\"", field, cond.value),
            };

            if rule.conditions.len() > 1 {
                script.push_str("    ");
            }
            script.push_str(&test);
        }

        if rule.conditions.len() > 1 {
            script.push_str("\n)");
        }

        script.push_str(" {\n");

        for action in &rule.actions {
            let action_str = match action.action_type.as_str() {
                "fileinto" => format!("    fileinto \"{}\";\n", action.value.as_deref().unwrap_or("INBOX")),
                "redirect" => format!("    redirect \"{}\";\n", action.value.as_deref().unwrap_or("")),
                "discard" => "    discard;\n".to_string(),
                "keep" => "    keep;\n".to_string(),
                "flag" => format!("    addflag \"{}\";\n", action.value.as_deref().unwrap_or("\\Flagged")),
                "reject" => format!("    reject \"{}\";\n", action.value.as_deref().unwrap_or("Message rejected")),
                _ => "    keep;\n".to_string(),
            };
            script.push_str(&action_str);
        }

        script.push_str("}\n\n");
    }

    script
}

pub fn parse_sieve_script(script: &str) -> Vec<SieveRule> {
    let mut rules = Vec::new();
    let mut current_rule: Option<SieveRule> = None;
    let mut rule_id = 0;

    for line in script.lines() {
        let line = line.trim();

        if line.starts_with("# Rule:") {
            if let Some(rule) = current_rule.take() {
                rules.push(rule);
            }
            let name = line.trim_start_matches("# Rule:").trim().to_string();
            current_rule = Some(SieveRule {
                id: format!("rule_{}", rule_id),
                name,
                enabled: true,
                conditions: Vec::new(),
                actions: Vec::new(),
            });
            rule_id += 1;
        }

        if line.starts_with("# DISABLED:") {
            if let Some(ref mut rule) = current_rule {
                rule.enabled = false;
            }
        }

        if line.contains("header :contains") || line.contains("header :is") {
            if let Some(ref mut rule) = current_rule {
                let parts: Vec<&str> = line.split('"').collect();
                if parts.len() >= 4 {
                    let field = parts[1].to_string();
                    let value = parts[3].to_string();
                    let operator = if line.contains(":contains") {
                        "contains"
                    } else if line.contains(":is") {
                        "is"
                    } else if line.contains(":matches") {
                        "matches"
                    } else {
                        "contains"
                    };

                    rule.conditions.push(SieveCondition {
                        field,
                        operator: operator.to_string(),
                        value,
                        header_name: None,
                    });
                }
            }
        }

        if let Some(ref mut rule) = current_rule {
            if line.starts_with("fileinto") {
                let parts: Vec<&str> = line.split('"').collect();
                if parts.len() >= 2 {
                    rule.actions.push(SieveAction {
                        action_type: "fileinto".to_string(),
                        value: Some(parts[1].to_string()),
                    });
                }
            } else if line.starts_with("redirect") {
                let parts: Vec<&str> = line.split('"').collect();
                if parts.len() >= 2 {
                    rule.actions.push(SieveAction {
                        action_type: "redirect".to_string(),
                        value: Some(parts[1].to_string()),
                    });
                }
            } else if line.starts_with("discard") {
                rule.actions.push(SieveAction {
                    action_type: "discard".to_string(),
                    value: None,
                });
            } else if line.starts_with("keep") {
                rule.actions.push(SieveAction {
                    action_type: "keep".to_string(),
                    value: None,
                });
            }
        }
    }

    if let Some(rule) = current_rule {
        rules.push(rule);
    }

    rules
}
