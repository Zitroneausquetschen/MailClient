import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder } from "../types/mail";

// Extended Folder type with JMAP fields
type ExtendedFolder = Folder & {
  displayName?: string;
  role?: string | null;
};

interface Props {
  folders: Folder[];
  selectedFolder: string;
  onSelectFolder: (folder: string) => void;
  onCreateFolder?: (name: string) => Promise<void>;
  onRenameFolder?: (oldName: string, newName: string) => Promise<void>;
  onDeleteFolder?: (name: string) => Promise<void>;
}

// Map folder names to icons and translation keys
const folderMeta: Record<string, { icon: string; labelKey: string }> = {
  INBOX: { icon: "📥", labelKey: "email.inbox" },
  Inbox: { icon: "📥", labelKey: "email.inbox" },
  Sent: { icon: "📤", labelKey: "email.sent" },
  Drafts: { icon: "📝", labelKey: "email.draft" },
  Trash: { icon: "🗑️", labelKey: "email.trash" },
  Junk: { icon: "⚠️", labelKey: "email.spam" },
  Spam: { icon: "⚠️", labelKey: "email.spam" },
  Archive: { icon: "📦", labelKey: "email.archive" },
};

// Map JMAP roles to icons
const jmapRoleMeta: Record<string, { icon: string; labelKey: string }> = {
  inbox: { icon: "📥", labelKey: "email.inbox" },
  Inbox: { icon: "📥", labelKey: "email.inbox" },
  sent: { icon: "📤", labelKey: "email.sent" },
  Sent: { icon: "📤", labelKey: "email.sent" },
  drafts: { icon: "📝", labelKey: "email.draft" },
  Drafts: { icon: "📝", labelKey: "email.draft" },
  trash: { icon: "🗑️", labelKey: "email.trash" },
  Trash: { icon: "🗑️", labelKey: "email.trash" },
  junk: { icon: "⚠️", labelKey: "email.spam" },
  Junk: { icon: "⚠️", labelKey: "email.spam" },
  archive: { icon: "📦", labelKey: "email.archive" },
  Archive: { icon: "📦", labelKey: "email.archive" },
};

function FolderList({ folders, selectedFolder, onSelectFolder, onCreateFolder, onRenameFolder, onDeleteFolder }: Props) {
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; folder: Folder } | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState<Folder | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<Folder | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [loading, setLoading] = useState(false);

  const handleContextMenu = (e: React.MouseEvent, folder: Folder) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, folder });
  };

  const handleCreate = async () => {
    if (!onCreateFolder || !newFolderName.trim()) return;
    setLoading(true);
    try {
      await onCreateFolder(newFolderName.trim());
      setNewFolderName("");
      setShowCreateDialog(false);
    } finally {
      setLoading(false);
    }
  };

  const handleRename = async () => {
    if (!onRenameFolder || !showRenameDialog || !renameValue.trim()) return;
    setLoading(true);
    try {
      await onRenameFolder(showRenameDialog.name, renameValue.trim());
      setShowRenameDialog(null);
      setRenameValue("");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!onDeleteFolder || !showDeleteConfirm) return;
    setLoading(true);
    try {
      await onDeleteFolder(showDeleteConfirm.name);
      setShowDeleteConfirm(null);
    } finally {
      setLoading(false);
    }
  };

  const getFolderMeta = (folder: ExtendedFolder) => {
    const name = folder.displayName || folder.name;
    const role = folder.role;

    // Check JMAP role first
    if (role && jmapRoleMeta[role]) {
      return { icon: jmapRoleMeta[role].icon, label: t(jmapRoleMeta[role].labelKey) };
    }

    // Check for exact match by name
    if (folderMeta[name]) {
      return { icon: folderMeta[name].icon, label: t(folderMeta[name].labelKey) };
    }

    // Check for common folder name patterns
    const lowerName = name.toLowerCase();
    if (lowerName.includes("sent")) return { icon: "📤", label: name };
    if (lowerName.includes("draft") || lowerName.includes("entwurf")) return { icon: "📝", label: name };
    if (lowerName.includes("trash") || lowerName.includes("deleted") || lowerName.includes("papierkorb")) return { icon: "🗑️", label: name };
    if (lowerName.includes("junk") || lowerName.includes("spam")) return { icon: "⚠️", label: name };
    if (lowerName.includes("archive") || lowerName.includes("archiv")) return { icon: "📦", label: name };
    if (lowerName.includes("inbox") || lowerName.includes("posteingang")) return { icon: "📥", label: name };

    return { icon: "📁", label: name };
  };

  // Sort folders: INBOX first, then alphabetically
  const sortedFolders = [...folders].sort((a, b) => {
    const extA = a as ExtendedFolder;
    const extB = b as ExtendedFolder;

    // JMAP: check role for inbox
    if (extA.role === "Inbox" || extA.role === "inbox" || a.name === "INBOX") return -1;
    if (extB.role === "Inbox" || extB.role === "inbox" || b.name === "INBOX") return 1;

    // Use display name for sorting if available
    const nameA = extA.displayName || a.name;
    const nameB = extB.displayName || b.name;
    return nameA.localeCompare(nameB);
  });

  return (
    <div className="py-2" onClick={() => setContextMenu(null)}>
      <div className="px-4 py-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {t("folders.title")}
        </h3>
        {onCreateFolder && (
          <button
            onClick={() => setShowCreateDialog(true)}
            className="text-gray-400 hover:text-gray-600 text-lg"
            title={t("folders.create")}
          >
            +
          </button>
        )}
      </div>
      <ul>
        {sortedFolders.map((folder) => {
          const extFolder = folder as ExtendedFolder;
          const meta = getFolderMeta(extFolder);
          const isSelected = folder.name === selectedFolder;

          return (
            <li key={folder.name}>
              <button
                onClick={() => onSelectFolder(folder.name)}
                onContextMenu={(e) => handleContextMenu(e, folder)}
                className={`w-full px-4 py-2 flex items-center gap-3 text-left folder-item ${
                  isSelected ? "selected" : ""
                }`}
              >
                <span className="text-lg">{meta.icon}</span>
                <span className="flex-1 truncate text-sm">{meta.label}</span>
                {folder.unreadCount > 0 && (
                  <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">
                    {folder.unreadCount}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 min-w-40"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {onRenameFolder && contextMenu.folder.name !== "INBOX" && (
            <button
              onClick={() => {
                setRenameValue(contextMenu.folder.name);
                setShowRenameDialog(contextMenu.folder);
                setContextMenu(null);
              }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100"
            >
              {t("folders.rename")}
            </button>
          )}
          {onDeleteFolder && contextMenu.folder.name !== "INBOX" && (
            <button
              onClick={() => {
                setShowDeleteConfirm(contextMenu.folder);
                setContextMenu(null);
              }}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 text-red-600"
            >
              {t("common.delete")}
            </button>
          )}
        </div>
      )}

      {/* Create Folder Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h3 className="text-lg font-semibold mb-4">{t("folders.create")}</h3>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder={t("folders.newFolderName")}
              className="w-full px-3 py-2 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowCreateDialog(false); setNewFolderName(""); }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
                disabled={loading}
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleCreate}
                disabled={loading || !newFolderName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-400"
              >
                {loading ? "..." : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Dialog */}
      {showRenameDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h3 className="text-lg font-semibold mb-4">{t("folders.rename")}</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={t("folders.newFolderName")}
              className="w-full px-3 py-2 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowRenameDialog(null); setRenameValue(""); }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
                disabled={loading}
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleRename}
                disabled={loading || !renameValue.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-400"
              >
                {loading ? "..." : t("folders.rename")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h3 className="text-lg font-semibold mb-4">{t("folders.delete")}</h3>
            <p className="text-gray-600 mb-4">
              {t("folders.confirmDelete", { name: showDeleteConfirm.name })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
                disabled={loading}
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-red-400"
              >
                {loading ? "..." : t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FolderList;
