import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import ConnectionForm from "./components/ConnectionForm";
import FolderList from "./components/FolderList";
import EmailList from "./components/EmailList";
import EmailView from "./components/EmailView";
import Composer from "./components/Composer";
import AccountSidebar from "./components/AccountSidebar";
import SieveEditor from "./components/SieveEditor";
import ContactsView from "./components/ContactsView";
import CalendarView from "./components/CalendarView";
import TasksView from "./components/TasksView";
import NotesView from "./components/NotesView";
import AccountSettings from "./components/AccountSettings";
import MainNavigation from "./components/MainNavigation";
import ContextMenu, { ContextMenuItem } from "./components/ContextMenu";
import { MailAccount, Folder, EmailHeader, Email, OutgoingEmail, ConnectedAccount, SavedAccount, SieveRule, Attachment } from "./types/mail";
import { playSentSound, playReceivedSound, playErrorSound } from "./utils/sounds";
import { openComposerWindow } from "./utils/windows";

type MainTab = "email" | "calendar" | "contacts" | "tasks" | "notes";
type EmailSubView = "inbox" | "compose" | "sieve";

function App() {
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

  // Helper to set error and play sound
  const showError = (message: string) => {
    setError(message);
    playErrorSound();
  };

  // Auto-connect saved accounts on startup
  useEffect(() => {
    const autoConnect = async () => {
      try {
        const savedAccounts = await invoke<SavedAccount[]>("get_saved_accounts");
        const accountsWithPassword = savedAccounts.filter((a) => a.password);

        let firstAccount: MailAccount | null = null;
        const newConnectedAccounts: ConnectedAccount[] = [];

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

            if (!firstAccount) {
              firstAccount = account;
              setActiveAccountCredentials(account);
              setActiveAccountSettings(saved);
            }
          } catch (e) {
            console.error(`Failed to auto-connect ${saved.username}:`, e);
          }
        }

        setConnectedAccounts(newConnectedAccounts);

        if (newConnectedAccounts.length > 0) {
          setActiveAccountId(newConnectedAccounts[0].id);
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
    if (activeAccountId && !initializing) {
      loadFolders(activeAccountId);
      loadEmails(activeAccountId, "INBOX");
      setSelectedFolder("INBOX");
    }
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
            const newCount = headers.filter(h => h.uid > lastKnownUidRef.current).length;
            setNewEmailCount(newCount);
            playReceivedSound();

            if (selectedFolder === "INBOX") {
              setEmails(prev => {
                const newEmails = headers.filter(h => !prev.find(e => e.uid === h.uid));
                return [...newEmails, ...prev];
              });
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

  const handleConnect = async (account: MailAccount) => {
    setLoading(true);
    setError(null);
    try {
      const connectedAccount = await invoke<ConnectedAccount>("connect", { account });
      setConnectedAccounts((prev) => [...prev, connectedAccount]);
      setEmailSubView("inbox");

      setActiveAccountCredentials(account);

      await loadFolders(connectedAccount.id);
      await loadEmails(connectedAccount.id, "INBOX");
      setSelectedFolder("INBOX");
      setActiveAccountId(connectedAccount.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async (accountId: string) => {
    try {
      await invoke("disconnect", { accountId });
      setConnectedAccounts((prev) => prev.filter((a) => a.id !== accountId));

      if (activeAccountId === accountId) {
        const remaining = connectedAccounts.filter((a) => a.id !== accountId);
        if (remaining.length > 0) {
          await switchAccount(remaining[0].id);
        } else {
          setActiveAccountId(null);
          setFolders([]);
          setEmails([]);
          setSelectedEmail(null);
        }
      }
    } catch (e) {
      setError(String(e));
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

    await loadFolders(accountId);
    await loadEmails(accountId, "INBOX");
    setSelectedFolder("INBOX");
  };

  const loadFolders = async (accountId: string) => {
    try {
      const folderList = await invoke<Folder[]>("list_folders", { accountId });
      setFolders(folderList);
    } catch (e) {
      setError(String(e));
    }
  };

  const loadEmails = async (accountId: string, folder: string) => {
    setSelectedFolder(folder);
    setSelectedEmail(null);

    const isCacheEnabled = activeAccountSettings?.cache_enabled ?? false;

    if (isCacheEnabled) {
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
      const headers = await invoke<EmailHeader[]>("fetch_headers", {
        accountId,
        folder,
        start: 0,
        count: 50,
      });
      setEmails(headers);

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
      setError("Suche erfordert aktivierten Cache. Bitte in den Einstellungen aktivieren.");
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
      setError(`Suche fehlgeschlagen: ${e}`);
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
      setError("Bitte aktiviere zuerst den Cache in den Einstellungen.");
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
      showError(`Synchronisierung fehlgeschlagen: ${e}`);
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const handleSelectFolder = async (folder: string) => {
    if (activeAccountId) {
      clearSearch();
      await loadEmails(activeAccountId, folder);
    }
  };

  const handleSelectEmail = async (uid: number) => {
    if (!activeAccountId) return;

    const isCacheEnabled = activeAccountSettings?.cache_enabled ?? false;

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
      console.log("[Frontend] Calling invoke send_email...");
      await invoke("send_email", { accountId: activeAccountId, email });
      console.log("[Frontend] send_email returned successfully");
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

  const handleAddAccount = () => {
    // Switch to settings to add account
    setShowSettings(true);
  };

  const extractEmailAddress = (from: string): string => {
    const match = from.match(/<(.+)>/);
    return match ? match[1] : from;
  };

  const handleCreateRuleFromEmail = (email: EmailHeader) => {
    const senderEmail = extractEmailAddress(email.from);
    const newRule: SieveRule = {
      id: crypto.randomUUID(),
      name: `Regel fuer ${senderEmail}`,
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

  const getContextMenuItems = (email: EmailHeader): ContextMenuItem[] => {
    return [
      {
        label: "Oeffnen",
        icon: "M",
        onClick: () => handleSelectEmail(email.uid),
      },
      {
        label: "Antworten",
        icon: "A",
        onClick: async () => {
          const fullEmail = await invoke<Email>("fetch_email", {
            accountId: activeAccountId,
            folder: selectedFolder,
            uid: email.uid,
          });
          handleReply(fullEmail);
        },
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: email.isFlagged ? "Markierung entfernen" : "Markieren",
        icon: email.isFlagged ? "☆" : "★",
        onClick: () => handleToggleFlag(email.uid, email.isFlagged),
      },
      {
        label: email.isRead ? "Als ungelesen markieren" : "Als gelesen markieren",
        icon: email.isRead ? "●" : "○",
        onClick: () => email.isRead ? handleMarkUnread(email.uid) : handleSelectEmail(email.uid),
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: "In Ordner verschieben",
        icon: "O",
        onClick: () => {
          handleSelectEmail(email.uid);
        },
      },
      {
        label: "Loeschen",
        icon: "L",
        onClick: () => handleDeleteEmail(email.uid),
      },
      { label: "", onClick: () => {}, separator: true },
      {
        label: "Regel erstellen...",
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
          <p className="text-gray-600">Verbinde Konten...</p>
        </div>
      </div>
    );
  }

  // No accounts connected - show login
  if (connectedAccounts.length === 0 && !showSettings) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-100">
        <ConnectionForm onConnect={handleConnect} loading={loading} error={error} />
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
      />

      {/* Content based on main tab */}
      <div className="flex-1 flex flex-col overflow-hidden">
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
                    title="Neue E-Mails anzeigen"
                  >
                    <span>{newEmailCount} neue</span>
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
                    placeholder="E-Mails durchsuchen..."
                    className="w-full px-4 py-1.5 pl-10 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                    disabled={!activeAccountSettings?.cache_enabled}
                    title={!activeAccountSettings?.cache_enabled ? "Cache muss aktiviert sein fuer die Suche" : ""}
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
                    title="E-Mails synchronisieren"
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
                    Neue E-Mail
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
                      Im Hauptfenster
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
                      Neues Fenster
                    </button>
                  </div>
                </div>

                {activeAccountCredentials && (
                  <button
                    onClick={() => setEmailSubView("sieve")}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
                    title="Sieve Filterregeln"
                  >
                    Filter
                  </button>
                )}
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
                  {/* Account sidebar */}
                  <AccountSidebar
                    accounts={connectedAccounts}
                    activeAccountId={activeAccountId}
                    onSelectAccount={switchAccount}
                    onAddAccount={handleAddAccount}
                    onRemoveAccount={handleDisconnect}
                  />

                  {/* Folder list */}
                  <div className="w-48 bg-white border-r overflow-y-auto">
                    <FolderList
                      folders={folders}
                      selectedFolder={selectedFolder}
                      onSelectFolder={handleSelectFolder}
                      onCreateFolder={handleCreateFolder}
                      onRenameFolder={handleRenameFolder}
                      onDeleteFolder={handleDeleteFolder}
                    />
                  </div>

                  {/* Email list */}
                  <div className="w-80 bg-white border-r overflow-y-auto flex flex-col">
                    {searchResults !== null && (
                      <div className="px-4 py-2 bg-blue-50 border-b flex items-center justify-between">
                        <span className="text-sm text-blue-700">
                          {searchResults.length} Ergebnis{searchResults.length !== 1 ? "se" : ""} fuer "{searchQuery}"
                        </span>
                        <button
                          onClick={clearSearch}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Zurueck
                        </button>
                      </div>
                    )}
                    {/* Bulk Action Toolbar */}
                    {selectedUids.size > 0 && (
                      <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center gap-2">
                        <span className="text-sm text-blue-800 font-medium">
                          {selectedUids.size} ausgewaehlt
                        </span>
                        <div className="flex-1 flex items-center gap-1">
                          <button
                            onClick={handleBulkMarkRead}
                            className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
                            title="Als gelesen markieren"
                          >
                            Gelesen
                          </button>
                          <button
                            onClick={handleBulkMarkUnread}
                            className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
                            title="Als ungelesen markieren"
                          >
                            Ungelesen
                          </button>
                          <button
                            onClick={handleBulkMarkFlagged}
                            className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
                            title="Markieren"
                          >
                            ★ Markieren
                          </button>
                          <div className="relative group">
                            <button
                              className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
                            >
                              Verschieben ▾
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
                            title="Loeschen"
                          >
                            Loeschen
                          </button>
                        </div>
                        <button
                          onClick={handleSelectAll}
                          className="px-2 py-1 text-xs text-blue-600 hover:underline"
                        >
                          Alle
                        </button>
                        <button
                          onClick={handleClearSelection}
                          className="px-2 py-1 text-xs text-gray-600 hover:underline"
                        >
                          Abbrechen
                        </button>
                      </div>
                    )}
                    <div className="flex-1 overflow-y-auto">
                      <EmailList
                        emails={searchResults !== null ? searchResults : emails}
                        selectedUid={selectedEmail?.uid}
                        onSelectEmail={handleSelectEmail}
                        onContextMenu={(email, x, y) => setContextMenu({ email, x, y })}
                        onToggleFlag={handleToggleFlag}
                        loading={loading || searching}
                        selectedUids={selectedUids}
                        onSelectionChange={setSelectedUids}
                        multiSelectMode={multiSelectMode}
                      />
                    </div>
                  </div>

                  {/* Email view */}
                  <div className="flex-1 bg-white overflow-y-auto">
                    {selectedEmail ? (
                      <EmailView
                        email={selectedEmail}
                        folders={folders}
                        onReply={handleReply}
                        onDelete={() => handleDeleteEmail(selectedEmail.uid)}
                        onMove={(folder) => handleMoveEmail(selectedEmail.uid, folder)}
                        onDownloadAttachment={handleDownloadAttachment}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-400">
                        Waehle eine E-Mail aus
                      </div>
                    )}
                  </div>
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
              ) : emailSubView === "sieve" && activeAccountCredentials ? (
                <div className="flex-1 bg-white overflow-y-auto">
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
            <AccountSettings onClose={handleCloseSettings} />
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
    </div>
  );
}

export default App;
