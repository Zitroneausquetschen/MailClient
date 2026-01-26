import { useState } from "react";
import { Email, Folder } from "../types/mail";

interface Props {
  email: Email;
  folders: Folder[];
  onReply: (email: Email) => void;
  onDelete: () => void;
  onMove: (folder: string) => void;
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString("de-DE", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

function EmailView({ email, folders, onReply, onDelete, onMove }: Props) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-800 flex-1">
            {email.subject || "(Kein Betreff)"}
          </h2>
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={() => onReply(email)}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Antworten
            </button>
            <div className="relative">
              <button
                onClick={() => setShowMoveMenu(!showMoveMenu)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                Verschieben
              </button>
              {showMoveMenu && (
                <div className="absolute right-0 mt-1 w-48 bg-white border rounded-lg shadow-lg z-10">
                  {folders.map((folder) => (
                    <button
                      key={folder.name}
                      onClick={() => {
                        onMove(folder.name);
                        setShowMoveMenu(false);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
                    >
                      {folder.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={onDelete}
              className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50"
            >
              Löschen
            </button>
          </div>
        </div>

        <div className="space-y-1 text-sm">
          <div className="flex">
            <span className="w-16 text-gray-500">Von:</span>
            <span className="text-gray-800">{email.from}</span>
          </div>
          <div className="flex">
            <span className="w-16 text-gray-500">An:</span>
            <span className="text-gray-800">{email.to}</span>
          </div>
          {email.cc && (
            <div className="flex">
              <span className="w-16 text-gray-500">CC:</span>
              <span className="text-gray-800">{email.cc}</span>
            </div>
          )}
          <div className="flex">
            <span className="w-16 text-gray-500">Datum:</span>
            <span className="text-gray-800">{formatDate(email.date)}</span>
          </div>
        </div>

        {/* Attachments */}
        {email.attachments.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              Anhänge ({email.attachments.length})
            </h4>
            <div className="flex flex-wrap gap-2">
              {email.attachments.map((attachment, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded text-sm"
                >
                  <span>📎</span>
                  <span>{attachment.filename}</span>
                  <span className="text-gray-500 text-xs">
                    ({formatSize(attachment.size)})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4">
        {email.bodyHtml ? (
          <div
            className="prose max-w-none"
            dangerouslySetInnerHTML={{ __html: email.bodyHtml }}
          />
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-gray-800">
            {email.bodyText}
          </pre>
        )}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default EmailView;
