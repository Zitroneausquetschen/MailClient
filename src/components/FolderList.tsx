import { Folder } from "../types/mail";

interface Props {
  folders: Folder[];
  selectedFolder: string;
  onSelectFolder: (folder: string) => void;
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

function FolderList({ folders, selectedFolder, onSelectFolder }: Props) {
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
    <div className="py-2">
      <h3 className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
        Ordner
      </h3>
      <ul>
        {sortedFolders.map((folder) => {
          const meta = getFolderMeta(folder.name);
          const isSelected = folder.name === selectedFolder;

          return (
            <li key={folder.name}>
              <button
                onClick={() => onSelectFolder(folder.name)}
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
    </div>
  );
}

export default FolderList;
