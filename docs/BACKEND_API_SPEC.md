# MailClient Backend API Spezifikation

## Übersicht

Backend-API für Cloud-Sync und Premium-Features des MailClient.

### Freemium-Modell

| Feature | Free | Premium |
|---------|------|---------|
| Postfächer | **1** | **Unbegrenzt** |
| KI (lokal/eigene API) | ✅ | ✅ |
| Alle lokalen Features | ✅ | ✅ |
| **Cloud-Sync** | ❌ | ✅ |
| **Multi-Device** | ❌ | ✅ |

---

## 1. Technologie-Stack

- **Framework:** Node.js + Express / PHP Laravel / oder ähnlich
- **Datenbank:** MySQL/MariaDB oder PostgreSQL
- **Auth:** JWT (JSON Web Tokens)
- **Payment:** Stripe

---

## 2. API-Endpunkte

### Base URL
```
https://api.mailclient.app/api
```

### 2.1 Auth Endpoints

#### POST /auth/register
Neuen Benutzer registrieren.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "name": "Max Mustermann"
}
```

**Response (201):**
```json
{
  "success": true,
  "user_id": 123,
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Errors:**
- `400` - Validation error (email format, password too short)
- `409` - Email already exists

---

#### POST /auth/login
Benutzer einloggen.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 123,
    "email": "user@example.com",
    "name": "Max Mustermann",
    "is_premium": true,
    "premium_until": "2025-12-31T23:59:59Z"
  }
}
```

**Errors:**
- `401` - Invalid credentials
- `429` - Too many attempts (rate limited)

---

#### POST /auth/logout
Token invalidieren.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true
}
```

---

#### GET /auth/me
Aktuellen Benutzer abrufen.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "user": {
    "id": 123,
    "email": "user@example.com",
    "name": "Max Mustermann",
    "is_premium": true,
    "premium_until": "2025-12-31T23:59:59Z",
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

**Errors:**
- `401` - Invalid or expired token

---

#### POST /auth/refresh
Token erneuern.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

---

### 2.2 Sync Endpoints

#### GET /sync/pull
Daten vom Server abrufen.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `since` (optional): Unix timestamp für inkrementellen Sync

**Response (200):**
```json
{
  "accounts": [...],
  "ai_config": {...},
  "categories": [...],
  "last_modified": 1706745600
}
```

**Errors:**
- `401` - Unauthorized
- `403` - Premium required (Free user)

---

#### POST /sync/push
Daten zum Server hochladen.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request:**
```json
{
  "accounts": [...],
  "ai_config": {...},
  "categories": [...],
  "client_timestamp": 1706745600
}
```

**Response (200):**
```json
{
  "success": true,
  "server_timestamp": 1706745601
}
```

**Errors:**
- `401` - Unauthorized
- `403` - Premium required
- `409` - Conflict (server has newer data)

---

#### GET /sync/status
Sync-Status abrufen.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "last_sync": 1706745600,
  "device_count": 3
}
```

---

### 2.3 Subscription Endpoints

#### POST /subscription/create-checkout
Stripe Checkout Session erstellen.

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request:**
```json
{
  "plan": "monthly"
}
```
Mögliche Werte: `"monthly"` oder `"yearly"`

**Response (200):**
```json
{
  "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_..."
}
```

---

#### POST /subscription/webhook
Stripe Webhook Endpoint (von Stripe aufgerufen).

**Headers:**
```
Stripe-Signature: t=1706745600,v1=...
```

**Request:** Stripe Webhook Payload

**Response:** `200 OK`

---

#### GET /subscription/status
Abo-Status abrufen.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "is_premium": true,
  "plan": "yearly",
  "premium_until": "2025-12-31T23:59:59Z",
  "cancel_at_period_end": false
}
```

---

#### POST /subscription/cancel
Abo kündigen (zum Periodenende).

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200):**
```json
{
  "success": true,
  "cancel_at": "2025-01-31T23:59:59Z"
}
```

---

## 3. Datenbank-Schema

```sql
-- Users Tabelle
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    is_premium BOOLEAN DEFAULT FALSE,
    premium_until DATETIME NULL,
    stripe_customer_id VARCHAR(255) NULL,
    stripe_subscription_id VARCHAR(255) NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_stripe_customer (stripe_customer_id)
);

-- Sync Data Tabelle (JSON-Speicher für Einstellungen)
CREATE TABLE sync_data (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    data_type ENUM('accounts', 'ai_config', 'categories') NOT NULL,
    data_json LONGTEXT NOT NULL,
    last_modified DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_type (user_id, data_type),
    INDEX idx_user_modified (user_id, last_modified)
);

-- Devices Tabelle (Multi-Device Tracking)
CREATE TABLE devices (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    device_id VARCHAR(255) NOT NULL,
    device_name VARCHAR(255),
    last_sync DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_device (user_id, device_id)
);

-- Auth Tokens (für Token-Invalidierung)
CREATE TABLE auth_tokens (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_token (token_hash),
    INDEX idx_expires (expires_at)
);

-- Audit Log (optional)
CREATE TABLE sync_log (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    action ENUM('push', 'pull', 'login', 'logout') NOT NULL,
    device_id VARCHAR(255),
    ip_address VARCHAR(45),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_time (user_id, created_at)
);
```

---

## 4. Datenstrukturen für Sync

### 4.1 accounts (JSON Array)

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "type": "imap",
    "display_name": "Arbeit",
    "username": "user@company.com",
    "imap_host": "imap.company.com",
    "imap_port": 993,
    "smtp_host": "smtp.company.com",
    "smtp_port": 587,
    "password": "ENCRYPTED:AES256:base64encodeddata...",
    "cache_enabled": true,
    "cache_days": 30,
    "cache_body": true,
    "cache_attachments": false,
    "signatures": [
      {
        "id": "sig-001",
        "name": "Standard",
        "content": "<p>Mit freundlichen Grüßen<br>Max Mustermann</p>",
        "is_default": true
      }
    ],
    "vacation": {
      "enabled": false,
      "subject": "Abwesend",
      "message": "Ich bin derzeit nicht erreichbar.",
      "start_date": null,
      "end_date": null
    }
  },
  {
    "id": "660e8400-e29b-41d4-a716-446655440001",
    "type": "jmap",
    "display_name": "Fastmail",
    "username": "user@fastmail.com",
    "jmap_url": "https://api.fastmail.com/jmap/session",
    "password": "ENCRYPTED:AES256:base64encodeddata...",
    "signatures": [],
    "vacation": null
  }
]
```

### 4.2 ai_config (JSON Object)

```json
{
  "provider_type": "openai",
  "local_model": "tinyllama",
  "local_model_downloaded": false,
  "ollama_url": "http://localhost:11434",
  "ollama_model": "llama3.2:latest",
  "openai_api_key": "ENCRYPTED:AES256:base64encodeddata...",
  "openai_model": "gpt-4o-mini",
  "anthropic_api_key": "ENCRYPTED:AES256:base64encodeddata...",
  "anthropic_model": "claude-3-haiku-20240307",
  "custom_api_url": "",
  "custom_api_key": "",
  "custom_model": "",
  "auto_summarize": true,
  "auto_extract_deadlines": true,
  "auto_prioritize": false,
  "suggest_tasks": true,
  "suggest_calendar": false
}
```

**provider_type Werte:**
- `"disabled"` - KI deaktiviert
- `"local"` - Lokales Modell (llama.cpp)
- `"ollama"` - Ollama Server
- `"openai"` - OpenAI API
- `"anthropic"` - Anthropic/Claude API
- `"custom_openai"` - OpenAI-kompatibler Endpoint

### 4.3 categories (JSON Array)

```json
[
  {
    "id": "cat-custom-001",
    "name": "Wichtig",
    "color": "#EF4444",
    "icon": "⭐",
    "is_system": false,
    "sort_order": 0
  },
  {
    "id": "cat-custom-002",
    "name": "Projekte",
    "color": "#3B82F6",
    "icon": "📁",
    "is_system": false,
    "sort_order": 1
  }
]
```

---

## 5. Sicherheit

### 5.1 Passwort-Hashing (Server)
- Algorithmus: **bcrypt** oder **Argon2**
- Cost Factor: mindestens 12

### 5.2 Sensible Daten (Client-seitige Verschlüsselung)
Folgende Felder werden **vor dem Upload vom Client verschlüsselt**:
- `accounts[].password`
- `ai_config.openai_api_key`
- `ai_config.anthropic_api_key`
- `ai_config.custom_api_key`

**Verschlüsselung:**
- Algorithmus: AES-256-GCM
- Schlüssel: Abgeleitet aus User-Passwort via PBKDF2
- Format: `ENCRYPTED:AES256:<base64-encoded-ciphertext>`

**Der Server speichert nur verschlüsselte Daten und kann diese nicht entschlüsseln!**

### 5.3 JWT Token

**Format:**
```json
{
  "sub": "123",
  "email": "user@example.com",
  "is_premium": true,
  "iat": 1706745600,
  "exp": 1706832000
}
```

**Einstellungen:**
- Algorithmus: HS256 oder RS256
- Gültigkeit: 24 Stunden
- Refresh: Vor Ablauf neuen Token anfordern

### 5.4 Rate Limiting

| Endpoint | Limit |
|----------|-------|
| POST /auth/login | 5 / 15 Min |
| POST /auth/register | 3 / Stunde |
| POST /sync/push | 60 / Stunde |
| GET /sync/pull | 120 / Stunde |

---

## 6. Stripe Integration

### 6.1 Produkte & Preise

Erstelle in Stripe Dashboard:
- **Produkt:** "MailClient Premium"
- **Preis Monthly:** €4.99/Monat (recurring)
- **Preis Yearly:** €49.99/Jahr (recurring)

### 6.2 Checkout Flow

1. Client ruft `POST /subscription/create-checkout` auf
2. Server erstellt Stripe Checkout Session
3. Server gibt `checkout_url` zurück
4. Client öffnet URL im Browser
5. User bezahlt bei Stripe
6. Stripe sendet Webhook an `POST /subscription/webhook`
7. Server aktiviert Premium

### 6.3 Webhook Events

```javascript
// Zu verarbeitende Events:
switch (event.type) {
  case 'checkout.session.completed':
    // User hat bezahlt → Premium aktivieren
    break;
  case 'customer.subscription.updated':
    // Abo geändert → Status aktualisieren
    break;
  case 'customer.subscription.deleted':
    // Abo gekündigt → Premium deaktivieren
    break;
  case 'invoice.payment_failed':
    // Zahlung fehlgeschlagen → User benachrichtigen
    break;
}
```

### 6.4 Webhook Signature Verification

```javascript
const sig = request.headers['stripe-signature'];
const event = stripe.webhooks.constructEvent(
  request.body,
  sig,
  process.env.STRIPE_WEBHOOK_SECRET
);
```

---

## 7. Umgebungsvariablen

```env
# Server
PORT=3000
NODE_ENV=production

# Database
DB_HOST=localhost
DB_PORT=3306
DB_NAME=mailclient
DB_USER=mailclient
DB_PASS=your-secure-password

# JWT
JWT_SECRET=your-256-bit-random-secret
JWT_EXPIRES_IN=24h

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_MONTHLY=price_1ABC...
STRIPE_PRICE_YEARLY=price_1XYZ...

# URLs
APP_URL=https://mailclient.app
API_URL=https://api.mailclient.app

# CORS
CORS_ORIGINS=https://mailclient.app,tauri://localhost
```

---

## 8. CORS Konfiguration

```javascript
app.use(cors({
  origin: [
    'https://mailclient.app',
    'tauri://localhost',  // Tauri App
    'http://localhost:1420'  // Dev
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

---

## 9. Error Response Format

Alle Fehler folgen diesem Format:

```json
{
  "success": false,
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "Invalid email or password"
  }
}
```

**Error Codes:**
- `AUTH_INVALID_CREDENTIALS` - Falsche Login-Daten
- `AUTH_TOKEN_EXPIRED` - Token abgelaufen
- `AUTH_TOKEN_INVALID` - Ungültiger Token
- `AUTH_EMAIL_EXISTS` - E-Mail bereits registriert
- `SYNC_PREMIUM_REQUIRED` - Premium benötigt
- `SYNC_CONFLICT` - Sync-Konflikt
- `RATE_LIMIT_EXCEEDED` - Zu viele Anfragen
- `VALIDATION_ERROR` - Validierungsfehler
- `STRIPE_ERROR` - Stripe Fehler

---

## 10. Test-Befehle

```bash
# Register
curl -X POST https://api.mailclient.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"Test123!","name":"Test User"}'

# Login
curl -X POST https://api.mailclient.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"Test123!"}'

# Get User (mit Token)
curl -X GET https://api.mailclient.app/api/auth/me \
  -H "Authorization: Bearer eyJhbG..."

# Sync Pull
curl -X GET https://api.mailclient.app/api/sync/pull \
  -H "Authorization: Bearer eyJhbG..."

# Sync Push
curl -X POST https://api.mailclient.app/api/sync/push \
  -H "Authorization: Bearer eyJhbG..." \
  -H "Content-Type: application/json" \
  -d '{"accounts":[],"ai_config":{},"categories":[],"client_timestamp":1706745600}'
```

---

## 11. Checkliste für Deployment

- [ ] Datenbank erstellt und Tabellen angelegt
- [ ] Environment Variables konfiguriert
- [ ] JWT Secret generiert (min. 256 bit)
- [ ] Stripe Account eingerichtet
- [ ] Stripe Produkte/Preise erstellt
- [ ] Stripe Webhook Endpoint konfiguriert
- [ ] HTTPS/SSL Zertifikat
- [ ] CORS konfiguriert
- [ ] Rate Limiting aktiviert
- [ ] Alle Endpoints getestet
