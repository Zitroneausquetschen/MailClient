import { useState } from "react";
import { Folder } from "../types/mail";

interface Props {
  folders: Folder[];
  selectedFolder: string;
  onSelectFolder: (folder: string) => void;
  onCreateFolder?: (name: string) => Promise<void>;
  onRenameFolder?: (oldName: string, newName: string) => Promise<void>;
  onDeleteFolder?: (name: string) => Promise<void>;
}

// Map folder names to icons and German labels
const folderMeta: Record<string, { icon: string; label: string }> = {
  INBOX: { icon: "📥", label: "Posteingang" },
  Sent: { icon: "📤", label: "Gesendet" },
  Drafts: { icon: "📝", label: "Entwürfe" },
  Trash: { icon: "🗑️", label: "Papierkorb" },
  Junk: { icon: "⚠️", label: "Spam" },
  Spam: { icon: "⚠️", label: "Spam" },
  Archive: { icon: "📦", label: "Archiv" },
};

function FolderList({ folders, selectedFolder, onSelectFolder, onCreateFolder, onRenameFolder, onDeleteFolder }: Props) {
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

  const getFolderMeta = (name: string) => {
    // Check for exact match first
    if (folderMeta[name]) {
      return folderMeta[name];
    }

    // Check for common folder name patterns
    const lowerName = name.toLowerCase();
    if (lowerName.includes("sent")) return { icon: "📤", label: name };
    if (lowerName.includes("draft")) return { icon: "📝", label: name };
    if (lowerName.includes("trash") || lowerName.includes("deleted")) return { icon: "🗑️", label: name };
    if (lowerName.includes("junk") || lowerName.includes("spam")) return { icon: "⚠️", label: name };
    if (lowerName.includes("archive")) return { icon: "📦", label: name };

    return { icon: "📁", label: name };
  };

  // Sort folders: INBOX first, then alphabetically
  const sortedFolders = [...folders].sort((a, b) => {
    if (a.name === "INBOX") return -1;
    if (b.name === "INBOX") return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="py-2" onClick={() => setContextMenu(null)}>
      <div className="px-4 py-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          Ordner
        </h3>
        {onCreateFolder && (
          <button
            onClick={() => setShowCreateDialog(true)}
            className="text-gray-400 hover:text-gray-600 text-lg"
            title="Neuer Ordner"
          >
            +
          </button>
        )}
      </div>
      <ul>
        {sortedFolders.map((folder) => {
          const meta = getFolderMeta(folder.name);
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
              Umbenennen
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
              Loeschen
            </button>
          )}
        </div>
      )}

      {/* Create Folder Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h3 className="text-lg font-semibold mb-4">Neuer Ordner</h3>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Ordnername"
              className="w-full px-3 py-2 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowCreateDialog(false); setNewFolderName(""); }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
                disabled={loading}
              >
                Abbrechen
              </button>
              <button
                onClick={handleCreate}
                disabled={loading || !newFolderName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-400"
              >
                {loading ? "..." : "Erstellen"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Dialog */}
      {showRenameDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h3 className="text-lg font-semibold mb-4">Ordner umbenennen</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Neuer Name"
              className="w-full px-3 py-2 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowRenameDialog(null); setRenameValue(""); }}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
                disabled={loading}
              >
                Abbrechen
              </button>
              <button
                onClick={handleRename}
                disabled={loading || !renameValue.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-400"
              >
                {loading ? "..." : "Umbenennen"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h3 className="text-lg font-semibold mb-4">Ordner loeschen</h3>
            <p className="text-gray-600 mb-4">
              Moechtest du den Ordner "{showDeleteConfirm.name}" wirklich loeschen?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
                disabled={loading}
              >
                Abbrechen
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-red-400"
              >
                {loading ? "..." : "Loeschen"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default FolderList;
