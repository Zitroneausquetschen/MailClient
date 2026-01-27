# Changelog

All notable changes to MailClient will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-01-27

### Added
- Install button in settings when update is available
- Modal dialog for adding new accounts (+ button now works)

### Fixed
- Update check in settings now allows direct installation

## [0.3.0] - 2026-01-27

### Added
- JMAP protocol support (modern JSON-based email protocol)
  - Full email operations (list, read, send, delete, move)
  - Mailbox management (create, rename, delete)
  - Attachment download via blob API
  - Email search functionality
  - Bulk operations (mark read/unread, flag, delete, move)
  - Identity-based email submission
- TypeScript API for JMAP integration
- Compatible with Stalwart Mail Server and other JMAP servers

## [0.2.0] - 2026-01-27

### Added
- Internationalization (i18n) support with German and English
- Language selector in Settings (App-Info tab)
- Auto-detection of browser/system language
- Auto-updater integration with GitHub Releases
- Update checker component (automatic + manual check)

### Fixed
- macOS build signing configuration
- GitHub Actions workflow for update signing

## [0.1.2] - 2026-01-26

### Added
- Email flags (flagged/starred)
- Attachment support (view, download, add)
- Bulk operations (mark read/unread, flag, delete, move)
- Folder management (create, rename, delete)
- macOS code signing preparation

## [0.1.1] - 2026-01-25

### Added
- Calendar view with CalDAV synchronization
- Contacts management with CardDAV support
- Tasks view with CalDAV (VTODO) synchronization
- Notes functionality
- SOGo server compatibility
- Event creation and editing dialog

## [0.1.0] - 2026-01-24

### Added
- Initial release
- IMAP email client with folder support
- SMTP email sending
- Email composition with rich text editor
- Multiple account support
- Auto-configuration for email servers
- Sieve filter rules editor
- Email signatures management
- Vacation/Out-of-Office responder
- Local email caching with SQLite
- Email search functionality
- Context menu for email actions
- Dark header navigation bar

[0.3.1]: https://github.com/Zitroneausquetschen/MailClient/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Zitroneausquetschen/MailClient/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Zitroneausquetschen/MailClient/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/Zitroneausquetschen/MailClient/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Zitroneausquetschen/MailClient/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Zitroneausquetschen/MailClient/releases/tag/v0.1.0
