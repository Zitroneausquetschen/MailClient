import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import ConnectionForm from "./components/ConnectionForm";
import UnifiedFolderTree from "./components/UnifiedFolderTree";
import EmailList from "./components/EmailList";
import EmailView from "./components/EmailView";
import Composer from "./components/Composer";
import SieveEditor from "./components/SieveEditor";
import JmapSieveEditor from "./components/JmapSieveEditor";
import ContactsView from "./components/ContactsView";
import CalendarView from "./components/CalendarView";
import TasksView from "./components/TasksView";
import NotesView from "./components/NotesView";
import AccountSettings from "./components/AccountSettings";
import MainNavigation from "./components/MainNavigation";
import UpdateChecker from "./components/UpdateChecker";
import ContextMenu, { ContextMenuItem } from "./components/ContextMenu";
import CategoryTabs from "./components/CategoryTabs";
import CategoryManager from "./components/CategoryManager";
import AIChatPanel from "./components/AIChatPanel";
import DayAgentPanel from "./components/DayAgentPanel";
import SpamReviewDialog from "./components/SpamReviewDialog";
import LoginDialog from "./components/LoginDialog";
import AccountMenu from "./components/AccountMenu";
import PremiumUpgrade from "./components/PremiumUpgrade";
import { MailAccount, JmapAccount, Folder, EmailHeader, Email, OutgoingEmail, ConnectedAccount, SavedAccount, SieveRule, Attachment, JmapConnectedAccount, EmailCategory, SpamCandidate } from "./types/mail";
import { CloudUser, FREE_TIER_LIMITS } from "./types/cloud";
import { playSentSound, playReceivedSound, playErrorSound } from "./utils/sounds";
import { openComposerWindow } from "./utils/windows";

type MainTab = "today" | "email" | "calendar" | "contacts" | "tasks" | "notes";
type EmailSubView = "inbox" | "compose" | "sieve";

function App() {
  const { t } = useTranslation();

  // Main tab state
  const [mainTab, setMainTab] = useState<MainTab>("email");
  const [showSettings, setShowSettings] = useState(false);

  // Account state
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [activeAccountCredentials, setActiveAccountCredentials] = useState<MailAccount | null>(null);
  const [activeAccountSettings, setActiveAccountSettings] = useState<SavedAccount | null>(null);

  // Email view state
  const [emailSubView, setEmailSubView] = useState<EmailSubView>("inbox");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [accountFolders, setAccountFolders] = useState<Record<string, Folder[]>>({});
  const [selectedFolder, setSelectedFolder] = useState<string>("INBOX");
  const [emails, setEmails] = useState<EmailHeader[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Email | null>(null);

  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    total: number;
    completed: number;
    currentItem: string;
    folder: string;
  } | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EmailHeader[] | null>(null);
  const [searching, setSearching] = useState(false);

  // New email notification
  const [newEmailCount, setNewEmailCount] = useState(0);
  const lastKnownUidRef = useRef<number>(0);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    email: EmailHeader;
  } | null>(null);

  // Pending rule from context menu
  const [pendingRule, setPendingRule] = useState<SieveRule | null>(null);

  // Composer window preference
  const [openComposerInNewWindow, setOpenComposerInNewWindow] = useState(false);

  // Multi-select state
  const [selectedUids, setSelectedUids] = useState<Set<number>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);

  // Create task from email state
  const [showCreateTaskDialog, setShowCreateTaskDialog] = useState(false);
  const [_taskFromEmail, setTaskFromEmail] = useState<{ subject: string; from: string; date: string } | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskNotes, setNewTaskNotes] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskAccountId, setTaskAccountId] = useState<string>("");
  const [savedAccountsForTasks, setSavedAccountsForTasks] = useState<SavedAccount[]>([]);

  // AI Category state
  const [categories, setCategories] = useState<EmailCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [emailCategories, setEmailCategories] = useState<Map<number, string>>(new Map());
  const [showCategoryManager, setShowCategoryManager] = useState(false);

  // AI Chat panel state
  const [showAIChat, setShowAIChat] = useState(false);

  // Spam detection state
  const [showSpamDialog, setShowSpamDialog] = useState(false);
  const [spamCandidates, setSpamCandidates] = useState<SpamCandidate[]>([]);
  const [scanningSpam, setScanningSpam] = useState(false);
  const [spamCount, setSpamCount] = useState(0);

  // Cloud sync state
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [_cloudLoading, setCloudLoading] = useState(true);

  // Helper to set error and play sound
  const showError = (message: string) => {
    setError(message);
    playErrorSound();
  };

  // Check if user can add more accounts (free tier limit)
  const canAddAccount = (): boolean => {
    if (cloudUser?.is_premium) return true;
    return connectedAccounts.length < FREE_TIER_LIMITS.maxAccounts;
  };

  // Load categories for the active account
  const loadCategories = async (accountId: string) => {
    try {
      const cats = await invoke<EmailCategory[]>("get_categories", { accountId });
      setCategories(cats.sort((a, b) => a.sortOrder - b.sortOrder));
    } catch (e) {
      console.error("Failed to load categories:", e);
    }
  };

  // Load email categories for the current folder
  const loadEmailCategories = async (accountId: string, folder: string, uids: number[]) => {
    const categoryMap = new Map<number, string>();
    try {
      for (const uid of uids) {
        const categoryId = await invoke<string | null>("get_email_category", {
          accountId,
          folder,
          uid,
        });
        if (categoryId) {
          categoryMap.set(uid, categoryId);
        }
      }
      setEmailCategories(categoryMap);
    } catch (e) {
      console.error("Failed to load email categories:", e);
    }
  };

  // Set email category (manual override)
  const handleSetEmailCategory = async (uid: number, categoryId: string) => {
    if (!activeAccountId) return;
    try {
      await invoke("set_email_category", {
        accountId: activeAccountId,
        folder: selectedFolder,
        uid,
        categoryId,
      });
      setEmailCategories((prev) => new Map(prev).set(uid, categoryId));
    } catch (e) {
      console.error("Failed to set email category:", e);
    }
  };

  // Auto-connect saved accounts on startup
  useEffect(() => {
    const autoConnect = async () => {
      try {
        // Try to restore cloud session first
        try {
          const user = await invoke<CloudUser | null>("cloud_restore_session");
          if (user) {
            setCloudUser(user);
          }
        } catch (e) {
          console.log("No cloud session to restore:", e);
        } finally {
          setCloudLoading(false);
        }

        const newConnectedAccounts: ConnectedAccount[] = [];
        let hasSetFirstAccount = false;

        // Load and connect IMAP accounts
        try {
          const savedAccounts = await invoke<SavedAccount[]>("get_saved_accounts");
          const accountsWithPassword = savedAccounts.filter((a) => a.password);

          for (const saved of accountsWithPassword) {
            try {
              const account: MailAccount = {
                imapHost: saved.imap_host,
                imapPort: saved.imap_port,
                smtpHost: saved.smtp_host,
                smtpPort: saved.smtp_port,
                username: saved.username,
                password: saved.password!,
                displayName: saved.display_name,
              };

              const connectedAccount = await invoke<ConnectedAccount>("connect", { account });

              if (!newConnectedAccounts.find(a => a.id === connectedAccount.id)) {
                newConnectedAccounts.push(connectedAccount);
              }

              if (!hasSetFirstAccount) {
                hasSetFirstAccount = true;
                setActiveAccountCredentials(account);
                setActiveAccountSettings(saved);
              }
            } catch (e) {
              console.error(`Failed to auto-connect IMAP ${saved.username}:`, e);
            }
          }
        } catch (e) {
          console.error("Failed to load IMAP accounts:", e);
        }

        // Load and connect JMAP accounts
        try {
          const savedJmapAccounts = await invoke<{
            id: string;
            displayName: string;
            username: string;
            jmapUrl: string;
            password?: string;
            protocol: string;
          }[]>("get_saved_jmap_accounts");

          const jmapAccountsWithPassword = savedJmapAccounts.filter((a) => a.password);

          for (const saved of jmapAccountsWithPassword) {
            try {
              const account: JmapAccount = {
                jmapUrl: saved.jmapUrl,
                username: saved.username,
                password: saved.password!,
                displayName: saved.displayName,
              };

              const connectedAccount = await invoke<JmapConnectedAccount>("jmap_connect", { account });

              if (!newConnectedAccounts.find(a => a.id === connectedAccount.id)) {
                newConnectedAccounts.push(connectedAccount);
              }

              if (!hasSetFirstAccount) {
                hasSetFirstAccount = true;
                setActiveAccountCredentials(null); // JMAP doesn't use IMAP credentials
              }
            } catch (e) {
              console.error(`Failed to auto-connect JMAP ${saved.username}:`, e);
            }
          }
        } catch (e) {
          console.error("Failed to load JMAP accounts:", e);
        }

        setConnectedAccounts(newConnectedAccounts);

        // Load folders for all connected accounts
        const allFolders: Record<string, Folder[]> = {};
        for (const account of newConnectedAccounts) {
          try {
            let folderList: Folder[];
            if (account.id.startsWith("jmap_")) {
              const mailboxes = await invoke<{
                id: string;
                name: string;
                parentId: string | null;
                role: string | null;
                totalEmails: number;
                unreadEmails: number;
                sortOrder: number;
              }[]>("jmap_list_mailboxes", { accountId: account.id });

              folderList = mailboxes.map(mb => ({
                name: mb.id,
                delimiter: "/",
                unreadCount: mb.unreadEmails,
                totalCount: mb.totalEmails,
                displayName: mb.name,
                role: mb.role,
              } as Folder & { displayName?: string; role?: string | null }));
            } else {
              folderList = await invoke<Folder[]>("list_folders", { accountId: account.id });
            }
            allFolders[account.id] = folderList;
          } catch (e) {
            console.error(`Failed to load folders for ${account.id}:`, e);
            allFolders[account.id] = [];
          }
        }
        setAccountFolders(allFolders);

        if (newConnectedAccounts.length > 0) {
          setActiveAccountId(newConnectedAccounts[0].id);
          // Set folders for the first account
          if (allFolders[newConnectedAccounts[0].id]) {
            setFolders(allFolders[newConnectedAccounts[0].id]);
          }
        }
      } catch (e) {
        console.error("Failed to load saved accounts:", e);
      } finally {
        setInitializing(false);
      }
    };

    autoConnect();
  }, []);

  // Load folders and emails when active account changes
  useEffect(() => {
    const loadAccountData = async () => {
      if (activeAccountId && !initializing) {
        const loadedFolders = await loadFoldersAndReturn(activeAccountId);
        const inboxFolder = findInboxFolder(loadedFolders, isJmapAccountId(activeAccountId));
        await loadEmails(activeAccountId, inboxFolder);
        setSelectedFolder(inboxFolder);
        // Load categories for the account
        loadCategories(activeAccountId);
        // Load spam count
        loadSpamCount(activeAccountId, inboxFolder);
      }
    };
    loadAccountData();
  }, [activeAccountId, initializing]);

  // Polling for new emails
  useEffect(() => {
    if (!activeAccountId || initializing) return;

    const checkForNewEmails = async () => {
      try {
        const headers = await invoke<EmailHeader[]>("fetch_headers", {
          accountId: activeAccountId,
          folder: "INBOX",
          start: 0,
          count: 5,
        });

        if (headers.length > 0) {
          const highestUid = Math.max(...headers.map(h => h.uid));

          if (lastKnownUidRef.current > 0 && highestUid > lastKnownUidRef.current) {
            const newEmails = headers.filter(h => h.uid > lastKnownUidRef.current);
            const newCount = newEmails.length;
            setNewEmailCount(newCount);
            playReceivedSound();

            if (selectedFolder === "INBOX") {
              setEmails(prev => {
                const toAdd = headers.filter(h => !prev.find(e => e.uid === h.uid));
                return [...toAdd, ...prev];
              });
            }

            // Background spam scan for new emails (if cache enabled)
            if (activeAccountSettings?.cache_enabled && newEmails.length > 0) {
              const newUids = newEmails.map(h => h.uid);
              scanNewEmailsForSpam(activeAccountId, "INBOX", newUids);
            }
          }

          lastKnownUidRef.current = highestUid;
        }
      } catch (e) {
        console.error("Failed to check for new emails:", e);
      }
    };

    checkForNewEmails();
    pollingIntervalRef.current = setInterval(checkForNewEmails, 60000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [activeAccountId, initializing, selectedFolder]);

  const handleConnect = async (account: MailAccount | JmapAccount, protocol: "imap" | "jmap") => {
    // Check account limit for free users
    if (!canAddAccount()) {
      setShowUpgradeDialog(true);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let connectedAccount: ConnectedAccount | JmapConnectedAccount;

      if (protocol === "jmap") {
        const jmapAccount = account as JmapAccount;
        connectedAccount = await invoke<JmapConnectedAccount>("jmap_connect", { account: jmapAccount });
        // For JMAP accounts, we don't store IMAP credentials
        setActiveAccountCredentials(null);

        // Save JMAP account
        const savedAccount = {
          id: `jmap_${jmapAccount.username}`,
          displayName: jmapAccount.displayName,
          username: jmapAccount.username,
          jmapUrl: jmapAccount.jmapUrl,
          password: jmapAccount.password,
          protocol: "jmap",
        };
        await invoke("save_jmap_account", { account: savedAccount });
      } else {
        const imapAccount = account as MailAccount;
        connectedAccount = await invoke<ConnectedAccount>("connect", { account: imapAccount });
        setActiveAccountCredentials(imapAccount);

        // Save IMAP account
        const savedAccount = {
          id: imapAccount.username,
          display_name: imapAccount.displayName,
          username: imapAccount.username,
          imap_host: imapAccount.imapHost,
          imap_port: imapAccount.imapPort,
          smtp_host: imapAccount.smtpHost,
          smtp_port: imapAccount.smtpPort,
          password: imapAccount.password,
        };
        await invoke("save_account", { account: savedAccount });
      }

      setConnectedAccounts((prev) => [...prev, connectedAccount]);
      setEmailSubView("inbox");

      const loadedFolders = await loadFoldersAndReturn(connectedAccount.id);
      const inboxFolder = findInboxFolder(loadedFolders, isJmapAccountId(connectedAccount.id));
      await loadEmails(connectedAccount.id, inboxFolder);
      setSelectedFolder(inboxFolder);
      setActiveAccountId(connectedAccount.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const switchAccount = async (accountId: string) => {
    setActiveAccountId(accountId);
    setSelectedEmail(null);
    clearSearch();

    try {
      const savedAccounts = await invoke<SavedAccount[]>("get_saved_accounts");
      const accountSettings = savedAccounts.find(a => a.id === accountId || a.username === accountId);
      if (accountSettings) {
        setActiveAccountSettings(accountSettings);
      }
    } catch (e) {
      console.error("Failed to load account settings:", e);
    }

    const loadedFolders = await loadFoldersAndReturn(accountId);
    const inboxFolder = findInboxFolder(loadedFolders, isJmapAccountId(accountId));
    await loadEmails(accountId, inboxFolder);
    setSelectedFolder(inboxFolder);
  };

  // Helper to check if account is JMAP
  const isJmapAccountId = (accountId: string) => accountId.startsWith("jmap_");

  // Helper to find inbox folder (by role for JMAP, by name for IMAP)
  const findInboxFolder = (folderList: Folder[], isJmap: boolean): string => {
    if (isJmap) {
      // For JMAP, find folder with role "Inbox" or "inbox"
      const extendedFolders = folderList as (Folder & { role?: string | null })[];
      const inbox = extendedFolders.find(f =>
        f.role?.toLowerCase() === "inbox"
      );
      if (inbox) return inbox.name; // name contains the mailbox ID for JMAP
    }
    // Default to INBOX for IMAP or fallback
    return "INBOX";
  };

  // Load folders and return them (for use in handleConnect and switchAccount)
  const loadFoldersAndReturn = async (accountId: string): Promise<Folder[]> => {
    try {
      let folderList: Folder[];

      if (isJmapAccountId(accountId)) {
        const mailboxes = await invoke<{
          id: string;
          name: string;
          parentId: string | null;
          role: string | null;
          totalEmails: number;
          unreadEmails: number;
          sortOrder: number;
        }[]>("jmap_list_mailboxes", { accountId });

        folderList = mailboxes.map(mb => ({
          name: mb.id,
          delimiter: "/",
          unreadCount: mb.unreadEmails,
          totalCount: mb.totalEmails,
          displayName: mb.name,
          role: mb.role,
        } as Folder & { displayName?: string; role?: string | null }));
      } else {
        folderList = await invoke<Folder[]>("list_folders", { accountId });
      }

      // Update both the current folders and the accountFolders map
      setFolders(folderList);
      setAccountFolders(prev => ({ ...prev, [accountId]: folderList }));
      return folderList;
    } catch (e) {
      setError(String(e));
      return [];
    }
  };

  const loadFolders = async (accountId: string) => {
    try {
      let folderList: Folder[];

      if (isJmapAccountId(accountId)) {
        // JMAP: use jmap_list_mailboxes and convert to Folder format
        const mailboxes = await invoke<{
          id: string;
          name: string;
          parentId: string | null;
          role: string | null;
          totalEmails: number;
          unreadEmails: number;
          sortOrder: number;
        }[]>("jmap_list_mailboxes", { accountId });

        folderList = mailboxes.map(mb => ({
          name: mb.id, // Use ID as name for JMAP (we'll display mb.name)
          delimiter: "/",
          unreadCount: mb.unreadEmails,
          totalCount: mb.totalEmails,
          // Store display name and role in a way the FolderList can use
          displayName: mb.name,
          role: mb.role,
        } as Folder & { displayName?: string; role?: string | null }));
      } else {
        folderList = await invoke<Folder[]>("list_folders", { accountId });
      }

      setFolders(folderList);
      setAccountFolders(prev => ({ ...prev, [accountId]: folderList }));
    } catch (e) {
      setError(String(e));
    }
  };

  const loadEmails = async (accountId: string, folder: string) => {
    setSelectedFolder(folder);
    setSelectedEmail(null);

    const isCacheEnabled = activeAccountSettings?.cache_enabled ?? false;

    // Skip cache for JMAP (not implemented yet)
    if (isCacheEnabled && !isJmapAccountId(accountId)) {
      try {
        const cachedHeaders = await invoke<EmailHeader[]>("get_cached_headers", {
          accountId,
          folder,
          start: 0,
          count: 50,
        });
        if (cachedHeaders.length > 0) {
          setEmails(cachedHeaders);
        }
      } catch (e) {
        console.log("No cached emails found, fetching from server...");
      }
    }

    setLoading(true);
    try {
      let headers: EmailHeader[];

      if (isJmapAccountId(accountId)) {
        // JMAP: use jmap_fetch_email_list and convert to EmailHeader format
        const jmapHeaders = await invoke<{
          id: string;
          blobId: string;
          threadId: string;
          mailboxIds: string[];
          subject: string;
          from: string;
          to: string;
          date: string;
          isRead: boolean;
          isFlagged: boolean;
          isAnswered: boolean;
          isDraft: boolean;
          hasAttachments: boolean;
          size: number;
          preview: string;
        }[]>("jmap_fetch_email_list", {
          accountId,
          mailboxId: folder, // folder is actually the mailbox ID for JMAP
          position: 0,
          limit: 50,
        });

        headers = jmapHeaders.map(jh => ({
          uid: 0, // JMAP doesn't use UIDs, we'll use the ID differently
          subject: jh.subject,
          from: jh.from,
          to: jh.to,
          date: jh.date,
          isRead: jh.isRead,
          isFlagged: jh.isFlagged,
          isAnswered: jh.isAnswered,
          isDraft: jh.isDraft,
          flags: [],
          hasAttachments: jh.hasAttachments,
          // Store JMAP-specific data
          jmapId: jh.id,
          preview: jh.preview,
        } as EmailHeader & { jmapId?: string; preview?: string }));
      } else {
        headers = await invoke<EmailHeader[]>("fetch_headers", {
          accountId,
          folder,
          start: 0,
          count: 50,
        });
      }

      setEmails(headers);

      // Load email categories for the emails
      if (headers.length > 0 && !isJmapAccountId(accountId)) {
        const uids = headers.map(h => h.uid);
        loadEmailCategories(accountId, folder, uids);
      }

      if (isCacheEnabled && headers.length > 0) {
        setSyncing(true);
        setSyncProgress({
          total: headers.length,
          completed: 0,
          currentItem: "Speichere Header...",
          folder,
        });
        try {
          await invoke("cache_headers", { accountId, folder, headers });
          const highestUid = Math.max(...headers.map(h => h.uid));
          await invoke("set_cache_sync_state", { accountId, folder, highestUid });

          if (activeAccountSettings?.cache_body) {
            await cacheEmailBodies(accountId, folder, headers);
          }
        } catch (cacheError) {
          console.error("Failed to cache headers:", cacheError);
        } finally {
          setSyncing(false);
          setSyncProgress(null);
        }
      }
    } catch (e) {
      if (emails.length === 0) {
        setError(String(e));
      } else {
        console.error("Server fetch failed, showing cached data:", e);
      }
    } finally {
      setLoading(false);
    }
  };

  const cacheEmailBodies = async (accountId: string, folder: string, headers: EmailHeader[]) => {
    const emailsToCache = headers.slice(0, 50);
    let completed = 0;

    for (const header of emailsToCache) {
      try {
        setSyncProgress({
          total: emailsToCache.length,
          completed,
          currentItem: header.subject || "Ohne Betreff",
          folder,
        });

        const hasCachedBody = await invoke<boolean>("has_cached_email_body", {
          accountId,
          folder,
          uid: header.uid,
        });

        if (!hasCachedBody) {
          const email = await invoke<Email>("fetch_email", {
            accountId,
            folder,
            uid: header.uid,
          });
          await invoke("cache_email", { accountId, folder, email });
        }

        completed++;
        setSyncProgress({
          total: emailsToCache.length,
          completed,
          currentItem: header.subject || "Ohne Betreff",
          folder,
        });
      } catch (e) {
        console.error(`Failed to cache email ${header.uid}:`, e);
        completed++;
      }
    }
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);

    if (!query.trim()) {
      setSearchResults(null);
      return;
    }

    if (!activeAccountId) return;

    if (!activeAccountSettings?.cache_enabled) {
      setError(t("search.cacheRequired", "Search requires cache to be enabled. Please enable in settings."));
      return;
    }

    setSearching(true);
    try {
      const results = await invoke<EmailHeader[]>("search_cached_emails", {
        accountId: activeAccountId,
        query: query.trim(),
      });
      setSearchResults(results);
    } catch (e) {
      console.error("Search failed:", e);
      setError(`${t("search.failed", "Search failed")}: ${e}`);
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults(null);
  };

  const handleManualSync = async () => {
    if (!activeAccountId || syncing) return;

    const isCacheEnabled = activeAccountSettings?.cache_enabled ?? false;
    if (!isCacheEnabled) {
      setError(t("sync.cacheRequired", "Please enable cache in settings first."));
      return;
    }

    setSyncing(true);

    try {
      const foldersToSync: Folder[] = [];

      const inbox = folders.find(f => f.name === "INBOX");
      if (inbox) {
        foldersToSync.push(inbox);
      }

      const sentFolders = folders.filter(f =>
        f.name.toLowerCase().includes("sent") ||
        f.name.toLowerCase().includes("gesendet")
      );
      for (const sent of sentFolders) {
        if (!foldersToSync.find(f => f.name === sent.name)) {
          foldersToSync.push(sent);
        }
      }

      const currentFolder = folders.find(f => f.name === selectedFolder);
      if (currentFolder && !foldersToSync.find(f => f.name === currentFolder.name)) {
        foldersToSync.push(currentFolder);
      }

      for (const folder of foldersToSync) {
        const folderName = folder.name;
        setSyncProgress({
          total: 0,
          completed: 0,
          currentItem: `Lade ${folderName}...`,
          folder: folderName,
        });

        const headers = await invoke<EmailHeader[]>("fetch_headers", {
          accountId: activeAccountId,
          folder: folderName,
          start: 0,
          count: 100,
        });

        if (headers.length > 0) {
          await invoke("cache_headers", { accountId: activeAccountId, folder: folderName, headers });

          const highestUid = Math.max(...headers.map(h => h.uid));
          await invoke("set_cache_sync_state", { accountId: activeAccountId, folder: folderName, highestUid });

          if (activeAccountSettings?.cache_body) {
            await cacheEmailBodies(activeAccountId, folderName, headers);
          }
        }

        if (folderName === selectedFolder) {
          setEmails(headers);
        }
      }
    } catch (e) {
      showError(`${t("sync.syncError")}: ${e}`);
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const handleSelectFolder = async (folder: string) => {
    if (activeAccountId) {
      clearSearch();
      await loadEmails(activeAccountId, folder);
      // Load spam count for new folder
      loadSpamCount(activeAccountId, folder);
    }
  };

  // Handle folder selection from unified tree (includes account switch if needed)
  const handleUnifiedFolderSelect = async (accountId: string, folder: string) => {
    clearSearch();
    if (activeAccountId !== accountId) {
      await switchAccount(accountId);
    }
    // After switching, load emails for the selected folder
    await loadEmails(accountId, folder);
  };

  const handleSelectEmail = async (uid: number, jmapId?: string) => {
    if (!activeAccountId) return;

    const isCacheEnabled = activeAccountSettings?.cache_enabled ?? false;

    // Handle JMAP accounts
    if (isJmapAccountId(activeAccountId) && jmapId) {
      setLoading(true);
      try {
        const jmapEmail = await invoke<{
          id: string;
          blobId: string;
          threadId: string;
          mailboxIds: string[];
          subject: string;
          from: string;
          to: string;
          cc: string;
          bcc: string;
          date: string;
          bodyText: string;
          bodyHtml: string;
          attachments: { blobId: string; name: string; mimeType: string; size: number }[];
          isRead: boolean;
          isFlagged: boolean;
          isAnswered: boolean;
          isDraft: boolean;
          size: number;
        }>("jmap_fetch_email", {
          accountId: activeAccountId,
          emailId: jmapId,
        });

        // Convert to Email format for display
        const email: Email = {
          uid: 0,
          subject: jmapEmail.subject,
          from: jmapEmail.from,
          to: jmapEmail.to,
          cc: jmapEmail.cc,
          date: jmapEmail.date,
          bodyText: jmapEmail.bodyText,
          bodyHtml: jmapEmail.bodyHtml,
          attachments: jmapEmail.attachments.map(a => ({
            filename: a.name,
            mimeType: a.mimeType,
            size: a.size,
            partId: a.blobId, // Use blobId as partId for JMAP
            encoding: "base64",
          })),
          isRead: jmapEmail.isRead,
          isFlagged: jmapEmail.isFlagged,
          isAnswered: jmapEmail.isAnswered,
          isDraft: jmapEmail.isDraft,
          flags: [],
          jmapId: jmapEmail.id,
        } as Email & { jmapId?: string };

        setSelectedEmail(email);

        // Mark as read if not already
        if (!jmapEmail.isRead) {
          await invoke("jmap_mark_read", { accountId: activeAccountId, emailId: jmapId });
          setEmails((prev) =>
            prev.map((e) => {
              const emailWithJmapId = e as EmailHeader & { jmapId?: string };
              return emailWithJmapId.jmapId === jmapId ? { ...e, isRead: true } : e;
            })
          );
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
      return;
    }

    // IMAP accounts - original logic
    if (isCacheEnabled) {
      try {
        const cachedEmail = await invoke<Email | null>("get_cached_email", {
          accountId: activeAccountId,
          folder: selectedFolder,
          uid,
        });
        if (cachedEmail && cachedEmail.bodyText) {
          setSelectedEmail(cachedEmail);
          setEmails((prev) =>
            prev.map((e) => (e.uid === uid ? { ...e, isRead: true } : e))
          );
        }
      } catch (e) {
        console.log("No cached email found, fetching from server...");
      }
    }

    setLoading(true);
    try {
      const email = await invoke<Email>("fetch_email", {
        accountId: activeAccountId,
        folder: selectedFolder,
        uid,
      });
      setSelectedEmail(email);

      const header = emails.find((e) => e.uid === uid);
      if (header && !header.isRead) {
        await invoke("mark_read", { accountId: activeAccountId, folder: selectedFolder, uid });
        setEmails((prev) =>
          prev.map((e) => (e.uid === uid ? { ...e, isRead: true } : e))
        );

        if (isCacheEnabled) {
          await invoke("update_cache_read_status", {
            accountId: activeAccountId,
            folder: selectedFolder,
            uid,
            isRead: true,
          }).catch(console.error);
        }
      }

      if (isCacheEnabled) {
        await invoke("cache_email", {
          accountId: activeAccountId,
          folder: selectedFolder,
          email,
        }).catch(console.error);
      }
    } catch (e) {
      if (!selectedEmail || selectedEmail.uid !== uid) {
        setError(String(e));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEmail = async (uid: number) => {
    if (!activeAccountId) return;
    try {
      await invoke("delete_email", { accountId: activeAccountId, folder: selectedFolder, uid });
      setEmails((prev) => prev.filter((e) => e.uid !== uid));
      if (selectedEmail?.uid === uid) {
        setSelectedEmail(null);
      }

      if (activeAccountSettings?.cache_enabled) {
        await invoke("delete_cached_email", {
          accountId: activeAccountId,
          folder: selectedFolder,
          uid,
        }).catch(console.error);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleMoveEmail = async (uid: number, targetFolder: string) => {
    if (!activeAccountId) return;
    try {
      await invoke("move_email", {
        accountId: activeAccountId,
        folder: selectedFolder,
        uid,
        targetFolder,
      });
      setEmails((prev) => prev.filter((e) => e.uid !== uid));
      if (selectedEmail?.uid === uid) {
        setSelectedEmail(null);
      }

      if (activeAccountSettings?.cache_enabled) {
        await invoke("delete_cached_email", {
          accountId: activeAccountId,
          folder: selectedFolder,
          uid,
        }).catch(console.error);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  // Flag operations
  const handleToggleFlag = async (uid: number, currentlyFlagged: boolean) => {
    if (!activeAccountId) return;
    try {
      if (currentlyFlagged) {
        await invoke("unmark_flagged", { accountId: activeAccountId, folder: selectedFolder, uid });
      } else {
        await invoke("mark_flagged", { accountId: activeAccountId, folder: selectedFolder, uid });
      }
      // Update local state
      setEmails((prev) =>
        prev.map((e) => (e.uid === uid ? { ...e, isFlagged: !currentlyFlagged } : e))
      );
      if (selectedEmail?.uid === uid) {
        setSelectedEmail((prev) => prev ? { ...prev, isFlagged: !currentlyFlagged } : null);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleMarkUnread = async (uid: number) => {
    if (!activeAccountId) return;
    try {
      await invoke("mark_unread", { accountId: activeAccountId, folder: selectedFolder, uid });
      setEmails((prev) =>
        prev.map((e) => (e.uid === uid ? { ...e, isRead: false } : e))
      );
      if (selectedEmail?.uid === uid) {
        setSelectedEmail(null);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  // JMAP-specific handlers
  const handleDeleteEmailJmap = async (emailId: string) => {
    if (!activeAccountId) return;
    try {
      await invoke("jmap_delete_email", { accountId: activeAccountId, emailId });
      setEmails((prev) => prev.filter((e) => {
        const emailWithJmapId = e as EmailHeader & { jmapId?: string };
        return emailWithJmapId.jmapId !== emailId;
      }));
      const selectedWithJmapId = selectedEmail as Email & { jmapId?: string } | null;
      if (selectedWithJmapId?.jmapId === emailId) {
        setSelectedEmail(null);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleToggleFlagJmap = async (emailId: string, currentlyFlagged: boolean) => {
    if (!activeAccountId) return;
    try {
      if (currentlyFlagged) {
        await invoke("jmap_unmark_flagged", { accountId: activeAccountId, emailId });
      } else {
        await invoke("jmap_mark_flagged", { accountId: activeAccountId, emailId });
      }
      setEmails((prev) =>
        prev.map((e) => {
          const emailWithJmapId = e as EmailHeader & { jmapId?: string };
          return emailWithJmapId.jmapId === emailId ? { ...e, isFlagged: !currentlyFlagged } : e;
        })
      );
      const selectedWithJmapId = selectedEmail as Email & { jmapId?: string } | null;
      if (selectedWithJmapId?.jmapId === emailId) {
        setSelectedEmail((prev) => prev ? { ...prev, isFlagged: !currentlyFlagged } : null);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleMarkUnreadJmap = async (emailId: string) => {
    if (!activeAccountId) return;
    try {
      await invoke("jmap_mark_unread", { accountId: activeAccountId, emailId });
      setEmails((prev) =>
        prev.map((e) => {
          const emailWithJmapId = e as EmailHeader & { jmapId?: string };
          return emailWithJmapId.jmapId === emailId ? { ...e, isRead: false } : e;
        })
      );
      const selectedWithJmapId = selectedEmail as Email & { jmapId?: string } | null;
      if (selectedWithJmapId?.jmapId === emailId) {
        setSelectedEmail(null);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  // Bulk operations
  const handleBulkMarkRead = async () => {
    if (!activeAccountId || selectedUids.size === 0) return;
    try {
      const uids = Array.from(selectedUids);
      await invoke("bulk_mark_read", { accountId: activeAccountId, folder: selectedFolder, uids });
      setEmails((prev) =>
        prev.map((e) => (selectedUids.has(e.uid) ? { ...e, isRead: true } : e))
      );
      setSelectedUids(new Set());
    } catch (e) {
      setError(String(e));
    }
  };

  const handleBulkMarkUnread = async () => {
    if (!activeAccountId || selectedUids.size === 0) return;
    try {
      const uids = Array.from(selectedUids);
      await invoke("bulk_mark_unread", { accountId: activeAccountId, folder: selectedFolder, uids });
      setEmails((prev) =>
        prev.map((e) => (selectedUids.has(e.uid) ? { ...e, isRead: false } : e))
      );
      setSelectedUids(new Set());
    } catch (e) {
      setError(String(e));
    }
  };

  const handleBulkMarkFlagged = async () => {
    if (!activeAccountId || selectedUids.size === 0) return;
    try {
      const uids = Array.from(selectedUids);
      await invoke("bulk_mark_flagged", { accountId: activeAccountId, folder: selectedFolder, uids });
      setEmails((prev) =>
        prev.map((e) => (selectedUids.has(e.uid) ? { ...e, isFlagged: true } : e))
      );
      setSelectedUids(new Set());
    } catch (e) {
      setError(String(e));
    }
  };

  const handleBulkDelete = async () => {
    if (!activeAccountId || selectedUids.size === 0) return;
    try {
      const uids = Array.from(selectedUids);
      await invoke("bulk_delete", { accountId: activeAccountId, folder: selectedFolder, uids });
      setEmails((prev) => prev.filter((e) => !selectedUids.has(e.uid)));
      if (selectedEmail && selectedUids.has(selectedEmail.uid)) {
        setSelectedEmail(null);
      }
      setSelectedUids(new Set());
    } catch (e) {
      setError(String(e));
    }
  };

  const handleBulkMove = async (targetFolder: string) => {
    if (!activeAccountId || selectedUids.size === 0) return;
    try {
      const uids = Array.from(selectedUids);
      await invoke("bulk_move", { accountId: activeAccountId, folder: selectedFolder, uids, targetFolder });
      setEmails((prev) => prev.filter((e) => !selectedUids.has(e.uid)));
      if (selectedEmail && selectedUids.has(selectedEmail.uid)) {
        setSelectedEmail(null);
      }
      setSelectedUids(new Set());
    } catch (e) {
      setError(String(e));
    }
  };

  const handleClearSelection = () => {
    setSelectedUids(new Set());
    setMultiSelectMode(false);
  };

  const handleSelectAll = () => {
    setSelectedUids(new Set(emails.map((e) => e.uid)));
  };

  // Spam detection handlers
  const loadSpamCount = async (accountId: string, folder: string) => {
    try {
      const count = await invoke<number>("ai_get_spam_count", { accountId, folder });
      setSpamCount(count);
    } catch {
      setSpamCount(0);
    }
  };

  const handleShowSpam = async () => {
    if (!activeAccountId) return;
    setShowSpamDialog(true);
    setScanningSpam(true);
    setSpamCandidates([]);
    try {
      // This will scan unscanned emails and return all cached spam
      const candidates = await invoke<SpamCandidate[]>("ai_scan_for_spam", {
        accountId: activeAccountId,
        folder: selectedFolder,
        limit: 100,
      });
      setSpamCandidates(candidates);
      setSpamCount(candidates.length);
    } catch (e) {
      showError(t("spam.scanError", { error: String(e) }));
      setShowSpamDialog(false);
    } finally {
      setScanningSpam(false);
    }
  };

  const scanNewEmailsForSpam = async (accountId: string, folder: string, uids: number[]) => {
    try {
      const spamFound = await invoke<number>("ai_scan_new_emails", {
        accountId,
        folder,
        uids,
      });
      if (spamFound > 0) {
        // Update spam count
        loadSpamCount(accountId, folder);
      }
    } catch {
      // Silently fail background scan
    }
  };

  const handleConfirmSpam = async (selectedUids: number[]) => {
    if (!activeAccountId || selectedUids.length === 0) return;
    try {
      // Find spam folder
      const spamFolder = folders.find(f =>
        f.name.toLowerCase() === "spam" ||
        f.name.toLowerCase() === "junk" ||
        f.name.toLowerCase() === "[gmail]/spam"
      )?.name || "Spam";

      await invoke("bulk_move", {
        accountId: activeAccountId,
        folder: selectedFolder,
        uids: selectedUids,
        targetFolder: spamFolder,
      });

      // Update local state
      const uidSet = new Set(selectedUids);
      setEmails((prev) => prev.filter((e) => !uidSet.has(e.uid)));
      if (selectedEmail && uidSet.has(selectedEmail.uid)) {
        setSelectedEmail(null);
      }

      // Update spam count
      setSpamCount((prev) => Math.max(0, prev - selectedUids.length));
    } catch (e) {
      showError(String(e));
    }
  };

  // Mark single email as spam (from AI panel) - moves to spam folder
  const handleMarkAsSpam = async (uid: number) => {
    if (!activeAccountId) return;

    // Find spam folder
    const spamFolder = folders.find(f =>
      f.name.toLowerCase() === "spam" ||
      f.name.toLowerCase() === "junk" ||
      f.name.toLowerCase() === "[gmail]/spam"
    )?.name || "Spam";

    // Move to spam
    await invoke("move_email", {
      accountId: activeAccountId,
      folder: selectedFolder,
      uid,
      targetFolder: spamFolder,
    });

    // Update local state
    setEmails((prev) => prev.filter((e) => e.uid !== uid));
    if (selectedEmail?.uid === uid) {
      setSelectedEmail(null);
    }
  };

  // Mark single email as not spam (from AI panel) - moves to inbox
  const handleMarkAsNotSpam = async (uid: number) => {
    if (!activeAccountId) return;

    // Find inbox folder
    const inboxFolder = folders.find(f =>
      f.name.toLowerCase() === "inbox" ||
      f.name === "INBOX"
    )?.name || "INBOX";

    // Move to inbox
    await invoke("move_email", {
      accountId: activeAccountId,
      folder: selectedFolder,
      uid,
      targetFolder: inboxFolder,
    });

    // Update local state
    setEmails((prev) => prev.filter((e) => e.uid !== uid));
    if (selectedEmail?.uid === uid) {
      setSelectedEmail(null);
    }
  };

  // Folder management
  const handleCreateFolder = async (name: string) => {
    if (!activeAccountId) return;
    try {
      await invoke("create_folder", { accountId: activeAccountId, folderName: name });
      await loadFolders(activeAccountId);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleRenameFolder = async (oldName: string, newName: string) => {
    if (!activeAccountId) return;
    try {
      await invoke("rename_folder", { accountId: activeAccountId, oldName, newName });
      await loadFolders(activeAccountId);
      if (selectedFolder === oldName) {
        setSelectedFolder(newName);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDeleteFolder = async (folderName: string) => {
    if (!activeAccountId) return;
    try {
      await invoke("delete_folder", { accountId: activeAccountId, folderName });
      await loadFolders(activeAccountId);
      if (selectedFolder === folderName) {
        setSelectedFolder("INBOX");
        loadEmails(activeAccountId, "INBOX");
      }
    } catch (e) {
      setError(String(e));
    }
  };

  // Attachment download
  const handleDownloadAttachment = async (attachment: Attachment) => {
    if (!activeAccountId || !selectedEmail) return;
    try {
      const savedPath = await invoke<string>("download_attachment", {
        accountId: activeAccountId,
        folder: selectedFolder,
        uid: selectedEmail.uid,
        partId: attachment.partId,
        filename: attachment.filename,
      });
      // Show success notification (could be improved with a toast)
      console.log("Attachment saved to:", savedPath);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSendEmail = async (email: OutgoingEmail) => {
    if (!activeAccountId) return;
    console.log("[Frontend] handleSendEmail called", email);
    setLoading(true);
    try {
      if (isJmapAccountId(activeAccountId)) {
        // JMAP: convert OutgoingEmail to JmapOutgoingEmail format
        const jmapEmail = {
          to: email.to,
          cc: email.cc.length > 0 ? email.cc : undefined,
          bcc: email.bcc.length > 0 ? email.bcc : undefined,
          subject: email.subject,
          bodyText: email.bodyText,
          bodyHtml: email.bodyHtml,
          inReplyTo: email.replyToMessageId,
        };
        console.log("[Frontend] Calling invoke jmap_send_email...");
        await invoke("jmap_send_email", { accountId: activeAccountId, email: jmapEmail });
      } else {
        console.log("[Frontend] Calling invoke send_email...");
        await invoke("send_email", { accountId: activeAccountId, email });
      }
      console.log("[Frontend] Email sent successfully");
      playSentSound();
      setEmailSubView("inbox");
      setReplyTo(null);
    } catch (e) {
      console.error("[Frontend] send_email error:", e);
      playErrorSound();
      setError(String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const handleReply = (email: Email) => {
    setReplyTo(email);
    if (openComposerInNewWindow && activeAccountId) {
      openComposerWindow(activeAccountId, email);
    } else {
      setEmailSubView("compose");
    }
  };

  const handleCompose = () => {
    setReplyTo(null);
    if (openComposerInNewWindow && activeAccountId) {
      openComposerWindow(activeAccountId);
    } else {
      setEmailSubView("compose");
    }
  };


  const extractEmailAddress = (from: string): string => {
    const match = from.match(/<(.+)>/);
    return match ? match[1] : from;
  };

  const handleCreateRuleFromEmail = (email: EmailHeader) => {
    const senderEmail = extractEmailAddress(email.from);
    const newRule: SieveRule = {
      id: crypto.randomUUID(),
      name: `${t("sieve.ruleFor", "Rule for")} ${senderEmail}`,
      enabled: true,
      conditions: [
        {
          field: "from",
          operator: "contains",
          value: senderEmail,
        }
      ],
      actions: [
        {
          actionType: "fileinto",
          value: "INBOX",
        }
      ],
    };
    setPendingRule(newRule);
    setEmailSubView("sieve");
  };

  const handleCreateTaskFromEmail = async (email: EmailHeader) => {
    // Load saved accounts for the dropdown
    try {
      const accounts = await invoke<SavedAccount[]>("get_saved_accounts");
      const accountsWithPassword = accounts.filter(a => a.password);
      setSavedAccountsForTasks(accountsWithPassword);

      // Default to current account if available, otherwise first account
      if (activeAccountSettings && accountsWithPassword.find(a => a.id === activeAccountSettings.id)) {
        setTaskAccountId(activeAccountSettings.id);
      } else if (accountsWithPassword.length > 0) {
        setTaskAccountId(accountsWithPassword[0].id);
      }
    } catch (e) {
      console.error("Failed to load accounts:", e);
    }

    setTaskFromEmail({
      subject: email.subject,
      from: email.from,
      date: email.date,
    });
    setNewTaskTitle(email.subject || t("tasks.newTask"));
    setNewTaskNotes(`${t("email.from")}: ${email.from}\n${t("email.date")}: ${email.date}`);
    setNewTaskDueDate("");
    setShowCreateTaskDialog(true);
  };

  const handleSaveTaskFromEmail = async () => {
    const selectedAccount = savedAccountsForTasks.find(a => a.id === taskAccountId);
    if (!selectedAccount || !newTaskTitle.trim()) return;

    setCreatingTask(true);
    try {
      const task = {
        id: crypto.randomUUID(),
        calendarId: "personal",
        summary: newTaskTitle.trim(),
        description: newTaskNotes.trim() || null,
        completed: false,
        percentComplete: 0,
        priority: 5, // Medium priority
        due: newTaskDueDate || null,
        created: new Date().toISOString(),
        lastModified: new Date().toISOString(),
        status: "NEEDS-ACTION",
      };

      await invoke("create_caldav_task", {
        host: selectedAccount.imap_host,
        username: selectedAccount.username,
        password: selectedAccount.password || "",
        calendarId: "personal",
        task,
      });

      setShowCreateTaskDialog(false);
      setTaskFromEmail(null);
      setNewTaskTitle("");
      setNewTaskNotes("");
      setNewTaskDueDate("");
      setTaskAccountId("");
    } catch (e) {
      showError(String(e));
    } finally {
      setCreatingTask(false);
    }
  };

  const getContextMenuItems = (email: EmailHeader): ContextMenuItem[] => {
    const emailWithJmapId = email as EmailHeader & { jmapId?: string };
    const isJmap = isJmapAccountId(activeAccountId || "");

    return [
      {
        label: t("contextMenu.open", "Open"),
        icon: "M",
        onClick: () => handleSelectEmail(email.uid, emailWithJmapId.jmapId),
      },
      {
        label: t("email.reply"),
        icon: "A",
        onClick: async () => {
          if (isJmap && emailWithJmapId.jmapId) {
            // For JMAP, select the email first then reply
            await handleSelectEmail(email.uid, emailWithJmapId.jmapId);
            if (selectedEmail) {
              handleReply(selectedEmail);
            }
          } else {
            const fullEmail = await invoke<Email>("fetch_email", {
              accountId: activeAccountId,
              folder: selectedFolder,
              uid: email.uid,
            });
            handleReply(fullEmail);
          }
        },
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: email.isFlagged ? t("email.unmarkFlagged") : t("email.markFlagged"),
        icon: email.isFlagged ? "☆" : "★",
        onClick: () => isJmap && emailWithJmapId.jmapId
          ? handleToggleFlagJmap(emailWithJmapId.jmapId, email.isFlagged)
          : handleToggleFlag(email.uid, email.isFlagged),
      },
      {
        label: email.isRead ? t("email.markUnread") : t("email.markRead"),
        icon: email.isRead ? "●" : "○",
        onClick: () => email.isRead
          ? (isJmap && emailWithJmapId.jmapId ? handleMarkUnreadJmap(emailWithJmapId.jmapId) : handleMarkUnread(email.uid))
          : handleSelectEmail(email.uid, emailWithJmapId.jmapId),
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: t("email.move"),
        icon: "O",
        onClick: () => {
          handleSelectEmail(email.uid, emailWithJmapId.jmapId);
        },
      },
      {
        label: t("email.delete"),
        icon: "L",
        onClick: () => isJmap && emailWithJmapId.jmapId
          ? handleDeleteEmailJmap(emailWithJmapId.jmapId)
          : handleDeleteEmail(email.uid),
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: t("contextMenu.createTask", "Create task..."),
        icon: "T",
        onClick: () => handleCreateTaskFromEmail(email),
      },
      {
        label: t("contextMenu.createRule", "Create rule..."),
        icon: "R",
        onClick: () => handleCreateRuleFromEmail(email),
      },
    ];
  };

  const reloadActiveAccountSettings = async () => {
    if (!activeAccountId) return;
    try {
      const savedAccounts = await invoke<SavedAccount[]>("get_saved_accounts");
      const accountSettings = savedAccounts.find(a => a.id === activeAccountId || a.username === activeAccountId);
      if (accountSettings) {
        setActiveAccountSettings(accountSettings);
      }
    } catch (e) {
      console.error("Failed to reload account settings:", e);
    }
  };

  const handleCloseSettings = () => {
    setShowSettings(false);
    reloadActiveAccountSettings();
  };

  // Handle main tab changes
  const handleMainTabChange = (tab: string) => {
    setMainTab(tab as MainTab);
    setShowSettings(false);
    // Reset email subview when switching to email tab
    if (tab === "email") {
      setEmailSubView("inbox");
    }
  };

  // Handle settings click
  const handleSettingsClick = () => {
    setShowSettings(true);
  };

  // Show loading while initializing
  if (initializing) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{t("accounts.connecting")}</p>
        </div>
      </div>
    );
  }

  // No accounts connected - show login
  if (connectedAccounts.length === 0 && !showSettings) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-100">
        <ConnectionForm
          onConnect={(account, protocol) => handleConnect(account, protocol)}
          loading={loading}
          error={error}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-100">
      {/* Main Navigation */}
      <MainNavigation
        activeTab={mainTab}
        onTabChange={handleMainTabChange}
        onSettingsClick={handleSettingsClick}
        isSettingsActive={showSettings}
        accountMenu={
          <AccountMenu
            user={cloudUser}
            onLoginClick={() => setShowLoginDialog(true)}
            onLogout={() => setCloudUser(null)}
            onUpgradeClick={() => setShowUpgradeDialog(true)}
          />
        }
      />

      {/* Content based on main tab */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {mainTab === "today" && !showSettings && (
          <DayAgentPanel
            accountId={activeAccountId}
            caldavConfig={activeAccountSettings ? {
              host: activeAccountSettings.imap_host,
              username: activeAccountSettings.username,
              password: activeAccountSettings.password || "",
              calendarIds: [],
            } : null}
            onNavigateToEmail={(_uid, folder) => {
              setMainTab("email");
              setSelectedFolder(folder);
            }}
            onNavigateToCalendar={() => setMainTab("calendar")}
            onNavigateToTasks={() => setMainTab("tasks")}
          />
        )}

        {mainTab === "email" && !showSettings && (
          <>
            {/* Email Sub-Header/Toolbar */}
            <header className="bg-white border-b px-4 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {newEmailCount > 0 && (
                  <button
                    onClick={() => {
                      setNewEmailCount(0);
                      if (selectedFolder !== "INBOX") {
                        handleSelectFolder("INBOX");
                      }
                    }}
                    className="flex items-center gap-1 px-2 py-1 bg-blue-500 text-white text-xs rounded-full hover:bg-blue-600 transition-colors"
                    title={t("email.showNew", "Show new emails")}
                  >
                    <span>{newEmailCount} {t("email.new", "new")}</span>
                  </button>
                )}
              </div>

              {/* Search Bar */}
              <div className="flex-1 max-w-md mx-4">
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    placeholder={t("search.placeholder")}
                    className="w-full px-4 py-1.5 pl-10 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    disabled={!activeAccountSettings?.cache_enabled}
                    title={!activeAccountSettings?.cache_enabled ? t("search.cacheRequired") : ""}
                  />
                  <svg
                    className="absolute left-3 top-2 h-4 w-4 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  {searchQuery && (
                    <button
                      onClick={clearSearch}
                      className="absolute right-3 top-2 text-gray-400 hover:text-gray-600"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                  {searching && (
                    <div className="absolute right-10 top-2">
                      <svg className="animate-spin h-4 w-4 text-blue-500" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Sync Progress Bar */}
                {syncing && syncProgress && (
                  <div className="flex items-center gap-2 bg-blue-50 px-2 py-1 rounded border border-blue-200 text-sm">
                    <svg className="animate-spin h-4 w-4 text-blue-600" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span className="text-blue-700">{syncProgress.folder}</span>
                    <div className="w-20 h-1.5 bg-blue-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 transition-all duration-300"
                        style={{ width: `${(syncProgress.completed / syncProgress.total) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-blue-600">{syncProgress.completed}/{syncProgress.total}</span>
                  </div>
                )}
                {/* Sync Button */}
                {activeAccountSettings?.cache_enabled && !syncing && (
                  <button
                    onClick={handleManualSync}
                    className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    title={t("sync.syncEmails", "Sync emails")}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                )}

                {/* Compose Button with Dropdown */}
                <div className="relative group">
                  <button
                    onClick={handleCompose}
                    className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 flex items-center gap-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    {t("email.newEmail")}
                  </button>
                  {/* Dropdown for window options */}
                  <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                    <button
                      onClick={() => {
                        setOpenComposerInNewWindow(false);
                        handleCompose();
                      }}
                      className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2 ${!openComposerInNewWindow ? 'text-blue-600' : 'text-gray-700'}`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {t("email.inMainWindow", "In main window")}
                    </button>
                    <button
                      onClick={() => {
                        setOpenComposerInNewWindow(true);
                        if (activeAccountId) {
                          openComposerWindow(activeAccountId);
                        }
                      }}
                      className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-2 ${openComposerInNewWindow ? 'text-blue-600' : 'text-gray-700'}`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      {t("email.newWindow", "New window")}
                    </button>
                  </div>
                </div>

                {activeAccountCredentials && (
                  <button
                    onClick={() => setEmailSubView("sieve")}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
                    title={t("sieve.title")}
                  >
                    {t("sieve.filters", "Filters")}
                  </button>
                )}

                {/* Spam Scan Button */}
                {activeAccountSettings?.cache_enabled && (
                  <button
                    onClick={handleShowSpam}
                    disabled={scanningSpam}
                    className={`px-3 py-1.5 text-sm rounded flex items-center gap-1 disabled:opacity-50 relative ${
                      spamCount > 0
                        ? "text-red-600 hover:text-red-800 hover:bg-red-50"
                        : "text-gray-600 hover:text-gray-800 hover:bg-gray-100"
                    }`}
                    title={t("spam.scanInbox")}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>{t("spam.scanInbox")}</span>
                    {spamCount > 0 && (
                      <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
                        {spamCount > 9 ? "9+" : spamCount}
                      </span>
                    )}
                  </button>
                )}

                {/* AI Assistant Toggle */}
                <button
                  onClick={() => setShowAIChat(!showAIChat)}
                  className={`px-3 py-1.5 text-sm rounded flex items-center gap-1 transition-colors ${
                    showAIChat
                      ? "bg-blue-100 text-blue-700"
                      : "text-gray-600 hover:text-gray-800 hover:bg-gray-100"
                  }`}
                  title={t("ai.assistant", "AI Assistant")}
                >
                  <span>🤖</span>
                  <span>{t("ai.assistant", "AI Assistant")}</span>
                </button>
              </div>
            </header>

            {/* Error banner */}
            {error && (
              <div className="bg-red-100 border-b border-red-200 px-4 py-2 text-red-700 flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
                  X
                </button>
              </div>
            )}

            {/* Email Content */}
            <div className="flex-1 flex overflow-hidden">
              {emailSubView === "inbox" ? (
                <>
                  {/* Unified folder tree with accounts and folders */}
                  <div className="w-64 border-r overflow-hidden">
                    <UnifiedFolderTree
                      accounts={connectedAccounts.map(account => ({
                        account,
                        folders: accountFolders[account.id] || [],
                      }))}
                      activeAccountId={activeAccountId}
                      selectedFolder={selectedFolder}
                      onSelectAccount={switchAccount}
                      onSelectFolder={handleUnifiedFolderSelect}
                      onCreateFolder={handleCreateFolder}
                      onRenameFolder={handleRenameFolder}
                      onDeleteFolder={handleDeleteFolder}
                    />
                  </div>

                  {/* Email list with category tabs */}
                  <div className="w-80 bg-white border-r overflow-y-auto flex flex-col">
                    {/* Category Tabs */}
                    {categories.length > 0 && (
                      <CategoryTabs
                        accountId={activeAccountId}
                        selectedCategory={selectedCategory}
                        onSelectCategory={setSelectedCategory}
                        onManageCategories={() => setShowCategoryManager(true)}
                      />
                    )}

                    {searchResults !== null && (
                      <div className="px-4 py-2 bg-blue-50 border-b flex items-center justify-between">
                        <span className="text-sm text-blue-700">
                          {searchResults.length === 1
                            ? t("search.results", { count: searchResults.length })
                            : t("search.results_plural", { count: searchResults.length })} "{searchQuery}"
                        </span>
                        <button
                          onClick={clearSearch}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          {t("search.back")}
                        </button>
                      </div>
                    )}
                    {/* Bulk Action Toolbar */}
                    {selectedUids.size > 0 && (
                      <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center gap-2">
                        <span className="text-sm text-blue-800 font-medium">
                          {t("bulk.selected", { count: selectedUids.size })}
                        </span>
                        <div className="flex-1 flex items-center gap-1">
                          <button
                            onClick={handleBulkMarkRead}
                            className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
                            title={t("email.markRead")}
                          >
                            {t("bulk.markRead")}
                          </button>
                          <button
                            onClick={handleBulkMarkUnread}
                            className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
                            title={t("email.markUnread")}
                          >
                            {t("bulk.markUnread")}
                          </button>
                          <button
                            onClick={handleBulkMarkFlagged}
                            className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
                            title={t("email.markFlagged")}
                          >
                            ★ {t("bulk.markFlagged")}
                          </button>
                          <div className="relative group">
                            <button
                              className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
                            >
                              {t("bulk.move")} ▾
                            </button>
                            <div className="absolute left-0 top-full mt-1 bg-white border border-gray-300 rounded shadow-lg z-10 hidden group-hover:block min-w-32">
                              {folders.filter(f => f.name !== selectedFolder).map((folder) => (
                                <button
                                  key={folder.name}
                                  onClick={() => handleBulkMove(folder.name)}
                                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100"
                                >
                                  {folder.name}
                                </button>
                              ))}
                            </div>
                          </div>
                          <button
                            onClick={handleBulkDelete}
                            className="px-2 py-1 text-xs bg-red-50 border border-red-300 text-red-600 rounded hover:bg-red-100"
                            title={t("email.delete")}
                          >
                            {t("bulk.delete")}
                          </button>
                        </div>
                        <button
                          onClick={handleSelectAll}
                          className="px-2 py-1 text-xs text-blue-600 hover:underline"
                        >
                          {t("common.all")}
                        </button>
                        <button
                          onClick={handleClearSelection}
                          className="px-2 py-1 text-xs text-gray-600 hover:underline"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    )}
                    <div className="flex-1 overflow-y-auto">
                      <EmailList
                        emails={
                          searchResults !== null
                            ? searchResults
                            : selectedCategory
                            ? emails.filter((e) => emailCategories.get(e.uid) === selectedCategory)
                            : emails
                        }
                        selectedUid={selectedEmail?.uid}
                        onSelectEmail={handleSelectEmail}
                        onContextMenu={(email, x, y) => setContextMenu({ email, x, y })}
                        onToggleFlag={handleToggleFlag}
                        loading={loading || searching}
                        selectedUids={selectedUids}
                        onSelectionChange={setSelectedUids}
                        multiSelectMode={multiSelectMode}
                        categories={categories}
                        emailCategories={emailCategories}
                      />
                    </div>
                  </div>

                  {/* Email view */}
                  <div className="flex-1 bg-white overflow-y-auto">
                    {selectedEmail ? (
                      <EmailView
                        email={selectedEmail}
                        folders={folders}
                        currentFolder={selectedFolder}
                        onReply={handleReply}
                        onDelete={() => handleDeleteEmail(selectedEmail.uid)}
                        onMove={(folder) => handleMoveEmail(selectedEmail.uid, folder)}
                        onDownloadAttachment={handleDownloadAttachment}
                        onMarkSpam={() => handleMarkAsSpam(selectedEmail.uid)}
                        onMarkNotSpam={() => handleMarkAsNotSpam(selectedEmail.uid)}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-400">
                        {t("email.selectEmailToRead")}
                      </div>
                    )}
                  </div>

                  {/* AI Chat Panel */}
                  <AIChatPanel
                    isOpen={showAIChat}
                    onClose={() => setShowAIChat(false)}
                    currentEmail={selectedEmail}
                    accountId={activeAccountId}
                    folder={selectedFolder}
                    categories={categories}
                    onCategoryChange={(categoryId) => {
                      if (selectedEmail) {
                        handleSetEmailCategory(selectedEmail.uid, categoryId);
                      }
                    }}
                    onMarkSpam={handleMarkAsSpam}
                    onMarkNotSpam={handleMarkAsNotSpam}
                  />
                </>
              ) : emailSubView === "compose" ? (
                <div className="flex-1 bg-white overflow-y-auto">
                  <Composer
                    replyTo={replyTo}
                    onSend={handleSendEmail}
                    onCancel={() => {
                      setEmailSubView("inbox");
                      setReplyTo(null);
                    }}
                    loading={loading}
                    currentAccount={activeAccountSettings}
                  />
                </div>
              ) : emailSubView === "sieve" ? (
                <div className="flex-1 bg-white overflow-y-auto">
                  {activeAccountId && isJmapAccountId(activeAccountId) ? (
                    // JMAP Sieve Editor
                    <JmapSieveEditor
                      accountId={activeAccountId}
                      folders={folders}
                      onClose={() => {
                        setEmailSubView("inbox");
                        setPendingRule(null);
                      }}
                    />
                  ) : activeAccountCredentials ? (
                    // IMAP Sieve Editor
                    <SieveEditor
                      host={activeAccountCredentials.imapHost}
                      username={activeAccountCredentials.username}
                      password={activeAccountCredentials.password}
                      folders={folders}
                      onClose={() => {
                        setEmailSubView("inbox");
                        setPendingRule(null);
                      }}
                      pendingRule={pendingRule}
                      onPendingRuleHandled={() => setPendingRule(null)}
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-400">
                      {t("sieve.notAvailable", "Filter not available for this account")}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </>
        )}

        {mainTab === "calendar" && !showSettings && activeAccountSettings && (
          <div className="flex-1 bg-white overflow-y-auto">
            <CalendarView currentAccount={activeAccountSettings} />
          </div>
        )}

        {mainTab === "contacts" && !showSettings && activeAccountSettings && (
          <div className="flex-1 bg-white overflow-y-auto">
            <ContactsView
              currentAccount={activeAccountSettings}
              onClose={() => setMainTab("email")}
            />
          </div>
        )}

        {mainTab === "tasks" && !showSettings && (
          <div className="flex-1 bg-white overflow-y-auto">
            <TasksView currentAccount={activeAccountSettings} />
          </div>
        )}

        {mainTab === "notes" && !showSettings && (
          <div className="flex-1 bg-white overflow-y-auto">
            <NotesView currentAccount={activeAccountSettings} />
          </div>
        )}

        {/* Settings View (shown on top of other views) */}
        {showSettings && (
          <div className="flex-1 bg-white overflow-y-auto">
            <AccountSettings
              onClose={handleCloseSettings}
              onAccountsChanged={async () => {
                // Reload connected accounts from backend
                try {
                  const accounts = await invoke<ConnectedAccount[]>("get_connected_accounts");
                  setConnectedAccounts(accounts);
                  if (accounts.length > 0 && !activeAccountId) {
                    setActiveAccountId(accounts[0].id);
                  }
                } catch (e) {
                  console.error("Failed to reload accounts:", e);
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems(contextMenu.email)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Create Task from Email Dialog */}
      {showCreateTaskDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">{t("contextMenu.createTask")}</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("accounts.title")}
                </label>
                <select
                  value={taskAccountId}
                  onChange={(e) => setTaskAccountId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {savedAccountsForTasks.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.display_name} ({account.username})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("tasks.title")}
                </label>
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("tasks.dueDate")}
                </label>
                <input
                  type="date"
                  value={newTaskDueDate}
                  onChange={(e) => setNewTaskDueDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("tasks.notes")}
                </label>
                <textarea
                  value={newTaskNotes}
                  onChange={(e) => setNewTaskNotes(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowCreateTaskDialog(false);
                  setTaskFromEmail(null);
                }}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                disabled={creatingTask}
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleSaveTaskFromEmail}
                disabled={creatingTask || !newTaskTitle.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400"
              >
                {creatingTask ? t("common.loading") : t("tasks.createTask")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Category Manager Modal */}
      {activeAccountId && (
        <CategoryManager
          accountId={activeAccountId}
          isOpen={showCategoryManager}
          onClose={() => setShowCategoryManager(false)}
          onCategoriesChanged={() => loadCategories(activeAccountId)}
        />
      )}

      {/* Spam Review Dialog */}
      <SpamReviewDialog
        isOpen={showSpamDialog}
        candidates={spamCandidates}
        isScanning={scanningSpam}
        onClose={() => setShowSpamDialog(false)}
        onConfirm={handleConfirmSpam}
      />

      {/* Cloud Login Dialog */}
      <LoginDialog
        isOpen={showLoginDialog}
        onClose={() => setShowLoginDialog(false)}
        onLoginSuccess={(user) => setCloudUser(user)}
      />

      {/* Premium Upgrade Dialog */}
      <PremiumUpgrade
        isOpen={showUpgradeDialog}
        onClose={() => setShowUpgradeDialog(false)}
        user={cloudUser}
        onLoginClick={() => {
          setShowUpgradeDialog(false);
          setShowLoginDialog(true);
        }}
      />

      {/* Update Checker - checks automatically on app start */}
      <UpdateChecker checkOnMount={true} />

    </div>
  );
}

export default App;
