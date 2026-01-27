import { useTranslation } from "react-i18next";
import { EmailHeader } from "../types/mail";

interface Props {
  emails: EmailHeader[];
  selectedUid?: number;
  onSelectEmail: (uid: number) => void;
  onContextMenu?: (email: EmailHeader, x: number, y: number) => void;
  onToggleFlag?: (uid: number, currentlyFlagged: boolean) => void;
  loading: boolean;
  // Multi-select props
  selectedUids?: Set<number>;
  onSelectionChange?: (uids: Set<number>) => void;
  multiSelectMode?: boolean;
}

function formatDate(dateStr: string, locale: string, yesterdayText: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const emailDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (emailDate.getTime() === today.getTime()) {
      // Today: show time
      return date.toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else if (emailDate.getTime() === today.getTime() - 86400000) {
      // Yesterday
      return yesterdayText;
    } else if (date.getFullYear() === now.getFullYear()) {
      // This year: show day and month
      return date.toLocaleDateString(locale, {
        day: "2-digit",
        month: "2-digit",
      });
    } else {
      // Other years: show full date
      return date.toLocaleDateString(locale, {
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

function EmailList({
  emails,
  selectedUid,
  onSelectEmail,
  onContextMenu,
  onToggleFlag,
  loading,
  selectedUids,
  onSelectionChange,
  multiSelectMode = false,
}: Props) {
  const { t, i18n } = useTranslation();

  if (loading && emails.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        {t("common.loading")}
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        {t("email.noEmails")}
      </div>
    );
  }

  const handleContextMenu = (e: React.MouseEvent, email: EmailHeader) => {
    e.preventDefault();
    if (onContextMenu) {
      onContextMenu(email, e.clientX, e.clientY);
    }
  };

  const handleClick = (e: React.MouseEvent, email: EmailHeader) => {
    if (multiSelectMode && onSelectionChange && selectedUids) {
      // In multi-select mode, toggle selection
      const newSelection = new Set(selectedUids);
      if (newSelection.has(email.uid)) {
        newSelection.delete(email.uid);
      } else {
        newSelection.add(email.uid);
      }
      onSelectionChange(newSelection);
    } else if (e.ctrlKey && onSelectionChange && selectedUids) {
      // Ctrl+Click: toggle selection
      const newSelection = new Set(selectedUids);
      if (newSelection.has(email.uid)) {
        newSelection.delete(email.uid);
      } else {
        newSelection.add(email.uid);
      }
      onSelectionChange(newSelection);
    } else if (e.shiftKey && onSelectionChange && selectedUids && selectedUid) {
      // Shift+Click: range selection
      const startIdx = emails.findIndex((e) => e.uid === selectedUid);
      const endIdx = emails.findIndex((e) => e.uid === email.uid);
      if (startIdx !== -1 && endIdx !== -1) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const newSelection = new Set(selectedUids);
        for (let i = from; i <= to; i++) {
          newSelection.add(emails[i].uid);
        }
        onSelectionChange(newSelection);
      }
    } else {
      onSelectEmail(email.uid);
    }
  };

  const handleCheckboxChange = (email: EmailHeader) => {
    if (onSelectionChange && selectedUids) {
      const newSelection = new Set(selectedUids);
      if (newSelection.has(email.uid)) {
        newSelection.delete(email.uid);
      } else {
        newSelection.add(email.uid);
      }
      onSelectionChange(newSelection);
    }
  };

  const handleFlagClick = (e: React.MouseEvent, email: EmailHeader) => {
    e.stopPropagation();
    if (onToggleFlag) {
      onToggleFlag(email.uid, email.isFlagged);
    }
  };

  const isSelected = (uid: number) => selectedUids?.has(uid) || false;

  return (
    <div className="divide-y">
      {emails.map((email) => (
        <div
          key={email.uid}
          onClick={(e) => handleClick(e, email)}
          onContextMenu={(e) => handleContextMenu(e, email)}
          className={`w-full p-3 text-left email-item cursor-pointer ${
            selectedUid === email.uid ? "selected" : ""
          } ${!email.isRead ? "email-unread" : ""} ${
            isSelected(email.uid) ? "bg-blue-50" : ""
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {/* Checkbox for multi-select */}
              {(multiSelectMode || (selectedUids && selectedUids.size > 0)) && (
                <input
                  type="checkbox"
                  checked={isSelected(email.uid)}
                  onChange={() => handleCheckboxChange(email)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-4 h-4 flex-shrink-0"
                />
              )}
              {/* Star/Flag icon */}
              <button
                onClick={(e) => handleFlagClick(e, email)}
                className={`flex-shrink-0 text-lg hover:scale-110 transition-transform ${
                  email.isFlagged ? "text-yellow-500" : "text-gray-300 hover:text-yellow-400"
                }`}
                title={email.isFlagged ? "Markierung entfernen" : "Markieren"}
              >
                {email.isFlagged ? "★" : "☆"}
              </button>
              <span className="text-sm truncate">
                {extractName(email.from)}
              </span>
            </div>
            <span className="text-xs text-gray-500 whitespace-nowrap ml-2">
              {formatDate(email.date, i18n.language, t("common.yesterday"))}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!email.isRead && (
              <span className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0"></span>
            )}
            {email.isAnswered && (
              <span className="text-gray-400 flex-shrink-0 text-xs" title="Beantwortet">↩</span>
            )}
            <span className="text-sm text-gray-700 truncate">
              {email.subject || "(Kein Betreff)"}
            </span>
            {email.hasAttachments && (
              <span className="text-gray-400 flex-shrink-0">📎</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default EmailList;
