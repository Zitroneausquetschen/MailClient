import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Email, Folder, Attachment } from "../types/mail";

interface Props {
  email: Email;
  folders: Folder[];
  onReply: (email: Email) => void;
  onDelete: () => void;
  onMove: (folder: string) => void;
  onDownloadAttachment?: (attachment: Attachment) => Promise<void>;
}

function EmailView({ email, folders, onReply, onDelete, onMove, onDownloadAttachment }: Props) {
  const { t, i18n } = useTranslation();
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [downloadingAttachment, setDownloadingAttachment] = useState<string | null>(null);

  const formatDate = (dateStr: string): string => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleString(i18n.language, {
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
  };

  const handleDownload = async (attachment: Attachment) => {
    if (!onDownloadAttachment) return;
    setDownloadingAttachment(attachment.partId);
    try {
      await onDownloadAttachment(attachment);
    } finally {
      setDownloadingAttachment(null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-800 flex-1">
            {email.subject || t("email.noSubject")}
          </h2>
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={() => onReply(email)}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              {t("email.reply")}
            </button>
            <div className="relative">
              <button
                onClick={() => setShowMoveMenu(!showMoveMenu)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                {t("email.move")}
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
              {t("common.delete")}
            </button>
          </div>
        </div>

        <div className="space-y-1 text-sm">
          <div className="flex">
            <span className="w-16 text-gray-500">{t("email.from")}:</span>
            <span className="text-gray-800">{email.from}</span>
          </div>
          <div className="flex">
            <span className="w-16 text-gray-500">{t("email.to")}:</span>
            <span className="text-gray-800">{email.to}</span>
          </div>
          {email.cc && (
            <div className="flex">
              <span className="w-16 text-gray-500">{t("email.cc")}:</span>
              <span className="text-gray-800">{email.cc}</span>
            </div>
          )}
          <div className="flex">
            <span className="w-16 text-gray-500">{t("email.date")}:</span>
            <span className="text-gray-800">{formatDate(email.date)}</span>
          </div>
        </div>

        {/* Attachments */}
        {email.attachments.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              {t("email.attachments")} ({email.attachments.length})
            </h4>
            <div className="flex flex-wrap gap-2">
              {email.attachments.map((attachment, i) => (
                <button
                  key={i}
                  onClick={() => handleDownload(attachment)}
                  disabled={downloadingAttachment === attachment.partId}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded text-sm hover:bg-gray-200 transition-colors cursor-pointer disabled:opacity-50"
                  title={t("email.downloadAttachment")}
                >
                  {downloadingAttachment === attachment.partId ? (
                    <span className="animate-spin">⏳</span>
                  ) : (
                    <span>📎</span>
                  )}
                  <span>{attachment.filename}</span>
                  <span className="text-gray-500 text-xs">
                    ({formatSize(attachment.size)})
                  </span>
                  <span className="text-blue-600 text-xs">⬇</span>
                </button>
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
