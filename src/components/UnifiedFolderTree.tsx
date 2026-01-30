import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Folder, ConnectedAccount } from "../types/mail";

// Extended Folder type with JMAP fields
type ExtendedFolder = Folder & {
  displayName?: string;
  role?: string | null;
};

// Tree node for hierarchical folders
interface FolderNode {
  name: string;
  fullPath: string;
  folder: Folder;
  children: FolderNode[];
}

// Account with its folders
interface AccountWithFolders {
  account: ConnectedAccount;
  folders: Folder[];
}

interface Props {
  accounts: AccountWithFolders[];
  activeAccountId: string | null;
  selectedFolder: string;
  onSelectAccount: (accountId: string) => void;
  onSelectFolder: (accountId: string, folder: string) => void;
  onCreateFolder?: (name: string, parentFolder?: string) => Promise<void>;
  onRenameFolder?: (oldName: string, newName: string) => Promise<void>;
  onDeleteFolder?: (name: string) => Promise<void>;
}

// Context menu state
interface ContextMenuState {
  x: number;
  y: number;
  accountId: string;
  folderPath: string;
  folderName: string;
  isSystemFolder: boolean;
}

// Map folder names to icons
const folderIcons: Record<string, string> = {
  INBOX: "📥",
  Inbox: "📥",
  inbox: "📥",
  Sent: "📤",
  sent: "📤",
  Drafts: "📝",
  drafts: "📝",
  Trash: "🗑️",
  trash: "🗑️",
  Junk: "⚠️",
  junk: "⚠️",
  Spam: "⚠️",
  spam: "⚠️",
  Archive: "📦",
  archive: "📦",
};

// Get icon for folder
const getFolderIcon = (folder: ExtendedFolder): string => {
  const name = folder.displayName || folder.name;
  const role = folder.role;

  // Check JMAP role first
  if (role && folderIcons[role]) {
    return folderIcons[role];
  }

  // Check for exact match
  if (folderIcons[name]) {
    return folderIcons[name];
  }

  // Check for patterns
  const lowerName = name.toLowerCase();
  if (lowerName.includes("sent") || lowerName.includes("gesendet")) return "📤";
  if (lowerName.includes("draft") || lowerName.includes("entwurf")) return "📝";
  if (lowerName.includes("trash") || lowerName.includes("deleted") || lowerName.includes("papierkorb")) return "🗑️";
  if (lowerName.includes("junk") || lowerName.includes("spam")) return "⚠️";
  if (lowerName.includes("archive") || lowerName.includes("archiv")) return "📦";
  if (lowerName.includes("inbox") || lowerName.includes("posteingang")) return "📥";

  return "📁";
};

// Build hierarchical folder tree from flat folder list
const buildFolderTree = (folders: Folder[]): FolderNode[] => {
  const tree: FolderNode[] = [];
  const nodeMap = new Map<string, FolderNode>();

  // Sort folders to ensure parents come before children
  const sortedFolders = [...folders].sort((a, b) => a.name.localeCompare(b.name));

  for (const folder of sortedFolders) {
    const parts = folder.name.split(/[./]/); // Split by . or /
    let currentPath = "";
    let parentNodes = tree;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      let existingNode = nodeMap.get(currentPath);
      if (!existingNode) {
        const isLeaf = i === parts.length - 1;
        const newNode: FolderNode = {
          name: part,
          fullPath: isLeaf ? folder.name : currentPath,
          folder: isLeaf ? folder : { name: currentPath, delimiter: "/", unreadCount: 0, totalCount: 0 },
          children: [],
        };
        nodeMap.set(currentPath, newNode);
        parentNodes.push(newNode);
        existingNode = newNode;
      }

      if (i === parts.length - 1) {
        // Update the node with actual folder data
        existingNode.folder = folder;
        existingNode.fullPath = folder.name;
      }

      parentNodes = existingNode.children;
    }
  }

  return tree;
};

// Sort folder nodes: INBOX first, then special folders, then alphabetically
const sortFolderNodes = (nodes: FolderNode[]): FolderNode[] => {
  return [...nodes].sort((a, b) => {
    const aFolder = a.folder as ExtendedFolder;
    const bFolder = b.folder as ExtendedFolder;

    // INBOX always first
    if (aFolder.role === "inbox" || a.name.toUpperCase() === "INBOX") return -1;
    if (bFolder.role === "inbox" || b.name.toUpperCase() === "INBOX") return 1;

    // Special folders next
    const specialFolders = ["sent", "drafts", "trash", "junk", "spam", "archive"];
    const aIsSpecial = specialFolders.some(s => a.name.toLowerCase().includes(s) || aFolder.role?.toLowerCase().includes(s));
    const bIsSpecial = specialFolders.some(s => b.name.toLowerCase().includes(s) || bFolder.role?.toLowerCase().includes(s));
    if (aIsSpecial && !bIsSpecial) return -1;
    if (!aIsSpecial && bIsSpecial) return 1;

    return a.name.localeCompare(b.name);
  });
};

// Get initials from account
const getInitials = (account: ConnectedAccount) => {
  if (account.displayName) {
    return account.displayName
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }
  return account.email[0].toUpperCase();
};

// Generate color based on account ID
const getColor = (id: string) => {
  const colors = [
    "bg-blue-500",
    "bg-green-500",
    "bg-purple-500",
    "bg-orange-500",
    "bg-pink-500",
    "bg-teal-500",
    "bg-indigo-500",
    "bg-red-500",
  ];
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

// Check if folder is a system folder that shouldn't be renamed/deleted
const isSystemFolder = (folderName: string, role?: string | null): boolean => {
  const systemNames = ["inbox", "sent", "drafts", "trash", "junk", "spam", "archive"];
  const lowerName = folderName.toLowerCase();
  if (role && systemNames.includes(role.toLowerCase())) return true;
  return systemNames.some(s => lowerName === s || lowerName.includes(s));
};

// Folder node component
function FolderNodeItem({
  node,
  depth,
  accountId,
  selectedFolder,
  activeAccountId,
  expandedFolders,
  onToggleFolder,
  onSelectFolder,
  onContextMenu,
}: {
  node: FolderNode;
  depth: number;
  accountId: string;
  selectedFolder: string;
  activeAccountId: string | null;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFolder: (accountId: string, folder: string) => void;
  onContextMenu: (e: React.MouseEvent, accountId: string, node: FolderNode) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedFolders.has(`${accountId}:${node.fullPath}`);
  const isSelected = activeAccountId === accountId && selectedFolder === node.fullPath;
  const folder = node.folder as ExtendedFolder;
  const icon = getFolderIcon(folder);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, accountId, node);
  };

  return (
    <div>
      <button
        onClick={() => onSelectFolder(accountId, node.fullPath)}
        onContextMenu={handleContextMenu}
        className={`w-full flex items-center gap-1 py-1.5 pr-2 text-left text-sm transition-colors ${
          isSelected
            ? "bg-blue-100 text-blue-800"
            : "hover:bg-gray-100 text-gray-700"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFolder(`${accountId}:${node.fullPath}`);
            }}
            className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600"
          >
            <svg
              className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span className="text-base">{icon}</span>
        <span className="flex-1 truncate">{node.name}</span>
        {folder.unreadCount > 0 && (
          <span className="bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
            {folder.unreadCount}
          </span>
        )}
      </button>
      {hasChildren && isExpanded && (
        <div>
          {sortFolderNodes(node.children).map((child) => (
            <FolderNodeItem
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              accountId={accountId}
              selectedFolder={selectedFolder}
              activeAccountId={activeAccountId}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              onSelectFolder={onSelectFolder}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UnifiedFolderTree({
  accounts,
  activeAccountId,
  selectedFolder,
  onSelectAccount,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: Props) {
  const { t } = useTranslation();
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [parentFolderForCreate, setParentFolderForCreate] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [loading, setLoading] = useState(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Rename dialog state
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [folderToRename, setFolderToRename] = useState<string | null>(null);

  // Delete confirm state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<string | null>(null);

  // Auto-expand active account
  useEffect(() => {
    if (activeAccountId) {
      setExpandedAccounts((prev) => new Set([...prev, activeAccountId]));
    }
  }, [activeAccountId]);

  const toggleAccount = (accountId: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const handleSelectFolder = (accountId: string, folder: string) => {
    if (activeAccountId !== accountId) {
      onSelectAccount(accountId);
    }
    onSelectFolder(accountId, folder);
  };

  // Context menu handler
  const handleFolderContextMenu = (e: React.MouseEvent, accountId: string, node: FolderNode) => {
    const folder = node.folder as ExtendedFolder;
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      accountId,
      folderPath: node.fullPath,
      folderName: node.name,
      isSystemFolder: isSystemFolder(node.name, folder.role),
    });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  // Create folder handler
  const handleCreate = async () => {
    if (!onCreateFolder || !newFolderName.trim()) return;
    setLoading(true);
    try {
      // If parentFolderForCreate is set, create as subfolder
      const folderName = parentFolderForCreate
        ? `${parentFolderForCreate}.${newFolderName.trim()}`
        : newFolderName.trim();
      await onCreateFolder(folderName);
      setNewFolderName("");
      setParentFolderForCreate(null);
      setShowCreateDialog(false);
    } finally {
      setLoading(false);
    }
  };

  // Rename folder handler
  const handleRename = async () => {
    if (!onRenameFolder || !folderToRename || !renameValue.trim()) return;
    setLoading(true);
    try {
      await onRenameFolder(folderToRename, renameValue.trim());
      setRenameValue("");
      setFolderToRename(null);
      setShowRenameDialog(false);
    } finally {
      setLoading(false);
    }
  };

  // Delete folder handler
  const handleDelete = async () => {
    if (!onDeleteFolder || !folderToDelete) return;
    setLoading(true);
    try {
      await onDeleteFolder(folderToDelete);
      setFolderToDelete(null);
      setShowDeleteConfirm(false);
    } finally {
      setLoading(false);
    }
  };

  // Calculate total unread for all accounts
  const totalUnread = accounts.reduce((sum, acc) => {
    const inboxFolder = acc.folders.find(
      (f) => f.name.toUpperCase() === "INBOX" || (f as ExtendedFolder).role === "inbox"
    );
    return sum + (inboxFolder?.unreadCount || 0);
  }, 0);

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      {/* Header with create button */}
      <div className="px-3 py-2 flex items-center justify-between border-b bg-white">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {t("accounts.title")}
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

      {/* Scrollable tree */}
      <div className="flex-1 overflow-y-auto">
        {/* Unified Inbox - All accounts */}
        {accounts.length > 1 && (
          <div className="border-b">
            <button
              onClick={() => {
                // Select first account's inbox as unified view placeholder
                if (accounts.length > 0) {
                  const firstAccount = accounts[0];
                  const inbox = firstAccount.folders.find(
                    (f) => f.name.toUpperCase() === "INBOX" || (f as ExtendedFolder).role === "inbox"
                  );
                  if (inbox) {
                    handleSelectFolder(firstAccount.account.id, inbox.name);
                  }
                }
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              <span className="text-base">📬</span>
              <span className="flex-1">{t("email.allInboxes")}</span>
              {totalUnread > 0 && (
                <span className="bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                  {totalUnread}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Account trees */}
        {accounts.map(({ account, folders }) => {
          const isExpanded = expandedAccounts.has(account.id);
          const isActive = activeAccountId === account.id;
          const folderTree = buildFolderTree(folders);
          const sortedTree = sortFolderNodes(folderTree);

          // Calculate total unread for this account
          const accountUnread = folders.reduce((sum, f) => {
            const extF = f as ExtendedFolder;
            if (f.name.toUpperCase() === "INBOX" || extF.role === "inbox") {
              return sum + f.unreadCount;
            }
            return sum;
          }, 0);

          return (
            <div key={account.id} className="border-b last:border-b-0">
              {/* Account header */}
              <button
                onClick={() => toggleAccount(account.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                  isActive ? "bg-blue-50" : "hover:bg-gray-100"
                }`}
              >
                <svg
                  className={`w-3 h-3 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span
                  className={`w-6 h-6 rounded-full ${getColor(account.id)} text-white text-xs font-semibold flex items-center justify-center`}
                >
                  {getInitials(account)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{account.displayName || account.email}</div>
                  {account.displayName && (
                    <div className="text-xs text-gray-500 truncate">{account.email}</div>
                  )}
                </div>
                {accountUnread > 0 && (
                  <span className="bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full">
                    {accountUnread}
                  </span>
                )}
              </button>

              {/* Folder tree */}
              {isExpanded && (
                <div className="pb-1">
                  {sortedTree.map((node) => (
                    <FolderNodeItem
                      key={node.fullPath}
                      node={node}
                      depth={1}
                      accountId={account.id}
                      selectedFolder={selectedFolder}
                      activeAccountId={activeAccountId}
                      expandedFolders={expandedFolders}
                      onToggleFolder={toggleFolder}
                      onSelectFolder={handleSelectFolder}
                      onContextMenu={handleFolderContextMenu}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeContextMenu} />
          <div
            className="fixed bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-48 z-50"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {/* Create subfolder */}
            {onCreateFolder && (
              <button
                onClick={() => {
                  setParentFolderForCreate(contextMenu.folderPath);
                  setShowCreateDialog(true);
                  closeContextMenu();
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
              >
                <span>📁</span>
                {t("folders.createSubfolder")}
              </button>
            )}

            {/* Rename */}
            {onRenameFolder && !contextMenu.isSystemFolder && (
              <button
                onClick={() => {
                  setFolderToRename(contextMenu.folderPath);
                  setRenameValue(contextMenu.folderName);
                  setShowRenameDialog(true);
                  closeContextMenu();
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2"
              >
                <span>✏️</span>
                {t("folders.rename")}
              </button>
            )}

            {/* Delete */}
            {onDeleteFolder && !contextMenu.isSystemFolder && (
              <button
                onClick={() => {
                  setFolderToDelete(contextMenu.folderPath);
                  setShowDeleteConfirm(true);
                  closeContextMenu();
                }}
                className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 text-red-600 flex items-center gap-2"
              >
                <span>🗑️</span>
                {t("common.delete")}
              </button>
            )}
          </div>
        </>
      )}

      {/* Create Folder Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h3 className="text-lg font-semibold mb-2">
              {parentFolderForCreate ? t("folders.createSubfolder") : t("folders.create")}
            </h3>
            {parentFolderForCreate && (
              <p className="text-sm text-gray-500 mb-3">
                {t("folders.parentFolder")}: <span className="font-medium">{parentFolderForCreate}</span>
              </p>
            )}
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder={t("folders.newFolderName")}
              className="w-full px-3 py-2 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowCreateDialog(false); setNewFolderName(""); setParentFolderForCreate(null); }}
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

      {/* Rename Folder Dialog */}
      {showRenameDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-80">
            <h3 className="text-lg font-semibold mb-4">{t("folders.rename")}</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              placeholder={t("folders.newFolderName")}
              className="w-full px-3 py-2 border border-gray-300 rounded mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowRenameDialog(false); setRenameValue(""); setFolderToRename(null); }}
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
              {t("folders.confirmDelete", { name: folderToDelete })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowDeleteConfirm(false); setFolderToDelete(null); }}
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

export default UnifiedFolderTree;
