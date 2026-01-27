use base64::Engine;
use lettre::{
    message::{header::ContentType, Mailbox, MultiPart, SinglePart, Attachment, Body},
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingAttachment {
    pub filename: String,
    pub mime_type: String,
    pub data: String,  // Base64 encoded
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingEmail {
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub body_text: String,
    pub body_html: Option<String>,
    pub reply_to_message_id: Option<String>,
    pub attachments: Option<Vec<OutgoingAttachment>>,
}

pub struct SmtpClient {
    host: String,
    port: u16,
    username: String,
    password: String,
    display_name: String,
}

impl SmtpClient {
    pub fn new(
        host: String,
        port: u16,
        username: String,
        password: String,
        display_name: String,
    ) -> Self {
        Self {
            host,
            port,
            username,
            password,
            display_name,
        }
    }

    pub async fn send_email(&self, email: OutgoingEmail) -> Result<Vec<u8>, String> {
        println!("[SMTP] Building message...");

        // Build the from address
        let from_mailbox: Mailbox = format!("{} <{}>", self.display_name, self.username)
            .parse()
            .map_err(|e| format!("Invalid from address: {}", e))?;
        println!("[SMTP] From: {:?}", from_mailbox);

        // Start building the message
        let mut message_builder = Message::builder()
            .from(from_mailbox)
            .subject(&email.subject);

        // Add recipients
        for to in &email.to {
            let mailbox: Mailbox = to
                .parse()
                .map_err(|e| format!("Invalid to address '{}': {}", to, e))?;
            message_builder = message_builder.to(mailbox);
        }

        for cc in &email.cc {
            let mailbox: Mailbox = cc
                .parse()
                .map_err(|e| format!("Invalid cc address '{}': {}", cc, e))?;
            message_builder = message_builder.cc(mailbox);
        }

        for bcc in &email.bcc {
            let mailbox: Mailbox = bcc
                .parse()
                .map_err(|e| format!("Invalid bcc address '{}': {}", bcc, e))?;
            message_builder = message_builder.bcc(mailbox);
        }

        // Add reply-to header if replying
        if let Some(ref message_id) = email.reply_to_message_id {
            message_builder = message_builder.in_reply_to(message_id.clone());
        }

        // Build the body
        let has_attachments = email.attachments.as_ref().map(|a| !a.is_empty()).unwrap_or(false);

        let message = if has_attachments {
            // Build the text/html alternative part
            let body_part = if let Some(ref html) = email.body_html {
                MultiPart::alternative()
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_PLAIN)
                            .body(email.body_text.clone()),
                    )
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_HTML)
                            .body(html.clone()),
                    )
            } else {
                MultiPart::alternative()
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_PLAIN)
                            .body(email.body_text.clone()),
                    )
            };

            // Start with mixed multipart (body + attachments)
            let mut mixed = MultiPart::mixed().multipart(body_part);

            // Add attachments
            if let Some(ref attachments) = email.attachments {
                for att in attachments {
                    // Decode base64 data
                    let data = base64::Engine::decode(
                        &base64::engine::general_purpose::STANDARD,
                        &att.data
                    ).map_err(|e| format!("Failed to decode attachment data: {}", e))?;

                    // Parse content type
                    let content_type: ContentType = att.mime_type.parse()
                        .unwrap_or(ContentType::parse("application/octet-stream").unwrap());

                    // Create attachment
                    let attachment = Attachment::new(att.filename.clone())
                        .body(Body::new(data), content_type);

                    mixed = mixed.singlepart(attachment);
                }
            }

            message_builder
                .multipart(mixed)
                .map_err(|e| format!("Failed to build message: {}", e))?
        } else if let Some(ref html) = email.body_html {
            // Multipart message with text and HTML (no attachments)
            message_builder
                .multipart(
                    MultiPart::alternative()
                        .singlepart(
                            SinglePart::builder()
                                .header(ContentType::TEXT_PLAIN)
                                .body(email.body_text.clone()),
                        )
                        .singlepart(
                            SinglePart::builder()
                                .header(ContentType::TEXT_HTML)
                                .body(html.clone()),
                        ),
                )
                .map_err(|e| format!("Failed to build message: {}", e))?
        } else {
            // Plain text only
            message_builder
                .body(email.body_text.clone())
                .map_err(|e| format!("Failed to build message: {}", e))?
        };

        println!("[SMTP] Message built, creating transport...");

        // Create SMTP transport (accept self-signed certificates)
        let creds = Credentials::new(self.username.clone(), self.password.clone());

        let tls_params = lettre::transport::smtp::client::TlsParameters::builder(self.host.clone())
            .dangerous_accept_invalid_certs(true)
            .build()
            .map_err(|e| format!("Failed to build TLS parameters: {}", e))?;
        println!("[SMTP] TLS params built, port: {}", self.port);

        // Port 465 uses implicit SSL, Port 587 uses STARTTLS
        let mailer: AsyncSmtpTransport<Tokio1Executor> = if self.port == 465 {
            // Implicit TLS (SSL) for port 465
            AsyncSmtpTransport::<Tokio1Executor>::relay(&self.host)
                .map_err(|e| format!("Failed to create SMTP transport: {}", e))?
                .port(self.port)
                .credentials(creds)
                .tls(lettre::transport::smtp::client::Tls::Wrapper(tls_params))
                .timeout(Some(Duration::from_secs(30)))
                .build()
        } else {
            // STARTTLS for port 587 and others
            AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&self.host)
                .map_err(|e| format!("Failed to create SMTP transport: {}", e))?
                .port(self.port)
                .credentials(creds)
                .tls(lettre::transport::smtp::client::Tls::Required(tls_params))
                .timeout(Some(Duration::from_secs(30)))
                .build()
        };
        println!("[SMTP] Mailer created, sending...");

        // Get raw message bytes before sending
        let raw_message = message.formatted();

        // Send the email
        mailer
            .send(message)
            .await
            .map_err(|e| format!("Failed to send email: {}", e))?;

        println!("[SMTP] Email sent successfully!");
        Ok(raw_message)
    }
}
