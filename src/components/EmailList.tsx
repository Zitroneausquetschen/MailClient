import { EmailHeader } from "../types/mail";

interface Props {
  emails: EmailHeader[];
  selectedUid?: number;
  onSelectEmail: (uid: number) => void;
  onContextMenu?: (email: EmailHeader, x: number, y: number) => void;
  loading: boolean;
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const emailDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (emailDate.getTime() === today.getTime()) {
      // Today: show time
      return date.toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (emailDate.getTime() === today.getTime() - 86400000) {
      // Yesterday
      return "Gestern";
    } else if (date.getFullYear() === now.getFullYear()) {
      // This year: show day and month
      return date.toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
      });
    } else {
      // Other years: show full date
      return date.toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      });
    }
  } catch {
    return dateStr;
  }
}

function extractName(from: string): string {
  // Extract name from "Name <email>" format
  const match = from.match(/^(.+?)\s*<.+>$/);
  if (match) {
    return match[1].trim().replace(/^"|"$/g, "");
  }
  // If no name, extract email part
  const emailMatch = from.match(/<(.+)>/);
  if (emailMatch) {
    return emailMatch[1];
  }
  return from;
}

function EmailList({ emails, selectedUid, onSelectEmail, onContextMenu, loading }: Props) {
  if (loading && emails.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        Laden...
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        Keine E-Mails
      </div>
    );
  }

  const handleContextMenu = (e: React.MouseEvent, email: EmailHeader) => {
    e.preventDefault();
    if (onContextMenu) {
      onContextMenu(email, e.clientX, e.clientY);
    }
  };

  return (
    <div className="divide-y">
      {emails.map((email) => (
        <button
          key={email.uid}
          onClick={() => onSelectEmail(email.uid)}
          onContextMenu={(e) => handleContextMenu(e, email)}
          className={`w-full p-3 text-left email-item ${
            selectedUid === email.uid ? "selected" : ""
          } ${!email.isRead ? "email-unread" : ""}`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm truncate flex-1 mr-2">
              {extractName(email.from)}
            </span>
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {formatDate(email.date)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!email.isRead && (
              <span className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0"></span>
            )}
            <span className="text-sm text-gray-700 truncate">
              {email.subject || "(Kein Betreff)"}
            </span>
            {email.hasAttachments && (
              <span className="text-gray-400 flex-shrink-0">📎</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

export default EmailList;
