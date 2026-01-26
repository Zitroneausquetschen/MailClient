import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import ConnectionForm from "./components/ConnectionForm";
import FolderList from "./components/FolderList";
import EmailList from "./components/EmailList";
import EmailView from "./components/EmailView";
import Composer from "./components/Composer";
import AccountSidebar from "./components/AccountSidebar";
import SieveEditor from "./components/SieveEditor";
import AccountSettings from "./components/AccountSettings";
import { MailAccount, Folder, EmailHeader, Email, OutgoingEmail, ConnectedAccount, SavedAccount } from "./types/mail";
import { playSentSound, playReceivedSound, playErrorSound } from "./utils/sounds";

type View = "inbox" | "compose" | "add-account" | "sieve" | "settings";

function App() {
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>("INBOX");
  const [emails, setEmails] = useState<EmailHeader[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [currentView, setCurrentView] = useState<View>("inbox");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Email | null>(null);
  const [activeAccountCredentials, setActiveAccountCredentials] = useState<MailAccount | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{
    total: number;
    completed: number;
    currentItem: string;
    folder: string;
  } | null>(null);
  const [activeAccountSettings, setActiveAccountSettings] = useState<SavedAccount | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EmailHeader[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [newEmailCount, setNewEmailCount] = useState(0);
  const lastKnownUidRef = useRef<number>(0);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

            // Only add if not already in the list
            if (!newConnectedAccounts.find(a => a.id === connectedAccount.id)) {
              newConnectedAccounts.push(connectedAccount);
            }

            // Store first account credentials for Sieve
            if (!firstAccount) {
              firstAccount = account;
              setActiveAccountCredentials(account);
              setActiveAccountSettings(saved);
            }
          } catch (e) {
            console.error(`Failed to auto-connect ${saved.username}:`, e);
          }
        }

        // Set all connected accounts at once (prevents duplicates from multiple renders)
        setConnectedAccounts(newConnectedAccounts);

        // Set first account as active
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

  // Polling for new emails (check every 60 seconds)
  useEffect(() => {
    if (!activeAccountId || initializing) return;

    const checkForNewEmails = async () => {
      try {
        // Only check INBOX for new emails
        const headers = await invoke<EmailHeader[]>("fetch_headers", {
          accountId: activeAccountId,
          folder: "INBOX",
          start: 0,
          count: 5, // Just check the latest few
        });

        if (headers.length > 0) {
          const highestUid = Math.max(...headers.map(h => h.uid));

          // If we have a previous UID and new one is higher, we have new mail
          if (lastKnownUidRef.current > 0 && highestUid > lastKnownUidRef.current) {
            const newCount = headers.filter(h => h.uid > lastKnownUidRef.current).length;
            setNewEmailCount(newCount);
            playReceivedSound();

            // Update email list if we're viewing INBOX
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

    // Initial check to set the baseline UID
    checkForNewEmails();

    // Set up polling interval (60 seconds)
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
      setCurrentView("inbox");

      // Store credentials for Sieve access
      setActiveAccountCredentials(account);

      // Load folders and emails for the new account
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

      // If disconnecting active account, switch to another or show login
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

  const handleDisconnectAll = async () => {
    try {
      await invoke("disconnect_all");
      setConnectedAccounts([]);
      setActiveAccountId(null);
      setFolders([]);
      setEmails([]);
      setSelectedEmail(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const switchAccount = async (accountId: string) => {
    setActiveAccountId(accountId);
    setSelectedEmail(null);
    clearSearch(); // Clear search when switching accounts

    // Load account settings for cache configuration
    try {
      const savedAccounts = await invoke<SavedAccount[]>("get_saved_accounts");
      // Match by id or username (id might be the username in some cases)
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

    // Check if cache is enabled for this account
    const isCacheEnabled = activeAccountSettings?.cache_enabled ?? false;

    // First, try to load from cache for instant display
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

    // Then fetch from server
    setLoading(true);
    try {
      const headers = await invoke<EmailHeader[]>("fetch_headers", {
        accountId,
        folder,
        start: 0,
        count: 50,
      });
      setEmails(headers);

      // Store in cache if enabled
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
          // Update sync state with highest UID
          const highestUid = Math.max(...headers.map(h => h.uid));
          await invoke("set_cache_sync_state", { accountId, folder, highestUid });

          // If cache_body is enabled, cache full emails
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
      // If server fetch fails and we have cached data, keep showing it
      if (emails.length === 0) {
        setError(String(e));
      } else {
        console.error("Server fetch failed, showing cached data:", e);
      }
    } finally {
      setLoading(false);
    }
  };

  // Function to cache email bodies with progress reporting
  const cacheEmailBodies = async (accountId: string, folder: string, headers: EmailHeader[]) => {
    const emailsToCache = headers.slice(0, 50); // Cache up to 50 emails
    let completed = 0;

    for (const header of emailsToCache) {
      try {
        // Update progress
        setSyncProgress({
          total: emailsToCache.length,
          completed,
          currentItem: header.subject || "Ohne Betreff",
          folder,
        });

        // Check if already cached
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

    // Only search if cache is enabled
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

  // Manual sync function - syncs important folders
  const handleManualSync = async () => {
    if (!activeAccountId || syncing) return;

    const isCacheEnabled = activeAccountSettings?.cache_enabled ?? false;
    if (!isCacheEnabled) {
      setError("Bitte aktiviere zuerst den Cache in den Einstellungen.");
      return;
    }

    setSyncing(true);

    try {
      // Sync important folders: INBOX, Sent, current folder
      const foldersToSync: Folder[] = [];

      // Add INBOX first
      const inbox = folders.find(f => f.name === "INBOX");
      if (inbox) {
        foldersToSync.push(inbox);
      }

      // Add Sent/Gesendet folders
      const sentFolders = folders.filter(f =>
        f.name.toLowerCase().includes("sent") ||
        f.name.toLowerCase().includes("gesendet")
      );
      for (const sent of sentFolders) {
        if (!foldersToSync.find(f => f.name === sent.name)) {
          foldersToSync.push(sent);
        }
      }

      // Add current folder if not already in list
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

        // Fetch headers from server
        const headers = await invoke<EmailHeader[]>("fetch_headers", {
          accountId: activeAccountId,
          folder: folderName,
          start: 0,
          count: 100, // Sync more emails for full sync
        });

        if (headers.length > 0) {
          // Cache headers
          await invoke("cache_headers", { accountId: activeAccountId, folder: folderName, headers });

          // Update sync state
          const highestUid = Math.max(...headers.map(h => h.uid));
          await invoke("set_cache_sync_state", { accountId: activeAccountId, folder: folderName, highestUid });

          // Cache email bodies if enabled
          if (activeAccountSettings?.cache_body) {
            await cacheEmailBodies(activeAccountId, folderName, headers);
          }
        }

        // Update UI if this is the currently selected folder
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
      clearSearch(); // Clear search when switching folders
      await loadEmails(activeAccountId, folder);
    }
  };

  const handleSelectEmail = async (uid: number) => {
    if (!activeAccountId) return;

    const isCacheEnabled = activeAccountSettings?.cache_enabled ?? false;

    // First, try to load from cache for instant display
    if (isCacheEnabled) {
      try {
        const cachedEmail = await invoke<Email | null>("get_cached_email", {
          accountId: activeAccountId,
          folder: selectedFolder,
          uid,
        });
        if (cachedEmail && cachedEmail.bodyText) {
          setSelectedEmail(cachedEmail);
          // Mark as read in UI immediately
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

      // Mark as read on server
      const header = emails.find((e) => e.uid === uid);
      if (header && !header.isRead) {
        await invoke("mark_read", { accountId: activeAccountId, folder: selectedFolder, uid });
        setEmails((prev) =>
          prev.map((e) => (e.uid === uid ? { ...e, isRead: true } : e))
        );

        // Update cache read status
        if (isCacheEnabled) {
          await invoke("update_cache_read_status", {
            accountId: activeAccountId,
            folder: selectedFolder,
            uid,
            isRead: true,
          }).catch(console.error);
        }
      }

      // Cache the full email if enabled
      if (isCacheEnabled) {
        await invoke("cache_email", {
          accountId: activeAccountId,
          folder: selectedFolder,
          email,
        }).catch(console.error);
      }
    } catch (e) {
      // If we already showed cached email, don't show error
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

      // Also delete from cache
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

      // Also delete from cache (will be re-cached when target folder is opened)
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

  const handleSendEmail = async (email: OutgoingEmail) => {
    if (!activeAccountId) return;
    console.log("[Frontend] handleSendEmail called", email);
    setLoading(true);
    try {
      console.log("[Frontend] Calling invoke send_email...");
      await invoke("send_email", { accountId: activeAccountId, email });
      console.log("[Frontend] send_email returned successfully");
      playSentSound(); // Play success sound
      setCurrentView("inbox");
      setReplyTo(null);
    } catch (e) {
      console.error("[Frontend] send_email error:", e);
      playErrorSound(); // Play error sound
      setError(String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const handleReply = (email: Email) => {
    setReplyTo(email);
    setCurrentView("compose");
  };

  const handleCompose = () => {
    setReplyTo(null);
    setCurrentView("compose");
  };

  const handleAddAccount = () => {
    setCurrentView("add-account");
  };

  // Reload account settings (called when returning from settings view)
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
    setCurrentView("inbox");
    // Reload settings in case user changed them
    reloadActiveAccountSettings();
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
  if (connectedAccounts.length === 0 && currentView !== "add-account") {
    return (
      <div className="h-full flex items-center justify-center bg-gray-100">
        <ConnectionForm onConnect={handleConnect} loading={loading} error={error} />
      </div>
    );
  }

  // Adding account view
  if (currentView === "add-account") {
    return (
      <div className="h-full flex items-center justify-center bg-gray-100">
        <div className="relative">
          {connectedAccounts.length > 0 && (
            <button
              onClick={() => setCurrentView("inbox")}
              className="absolute -top-12 left-0 text-gray-600 hover:text-gray-800"
            >
              &larr; Zurück
            </button>
          )}
          <ConnectionForm onConnect={handleConnect} loading={loading} error={error} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-gray-800">MailClient</h1>
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
              className="w-full px-4 py-2 pl-10 pr-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={!activeAccountSettings?.cache_enabled}
              title={!activeAccountSettings?.cache_enabled ? "Cache muss aktiviert sein für die Suche" : ""}
            />
            <svg
              className="absolute left-3 top-2.5 h-5 w-5 text-gray-400"
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
                className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            {searching && (
              <div className="absolute right-10 top-2.5">
                <svg className="animate-spin h-5 w-5 text-blue-500" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Sync Progress Bar */}
          {syncing && syncProgress && (
            <div className="flex items-center gap-3 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200">
              <div className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4 text-blue-600" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="text-sm text-blue-700 font-medium">
                  Synchronisiere {syncProgress.folder}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-32 h-2 bg-blue-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-300"
                    style={{ width: `${(syncProgress.completed / syncProgress.total) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-blue-600 min-w-[3rem]">
                  {syncProgress.completed}/{syncProgress.total}
                </span>
              </div>
              <span className="text-xs text-gray-500 max-w-[150px] truncate" title={syncProgress.currentItem}>
                {syncProgress.currentItem}
              </span>
            </div>
          )}
          {/* Sync Button */}
          {activeAccountSettings?.cache_enabled && !syncing && (
            <button
              onClick={handleManualSync}
              className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="E-Mails synchronisieren"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
          <button
            onClick={handleCompose}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Neue E-Mail
          </button>
          {activeAccountCredentials && (
            <button
              onClick={() => setCurrentView("sieve")}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
              title="Sieve Filterregeln"
            >
              Filter
            </button>
          )}
          <button
            onClick={() => setCurrentView("settings")}
            className="px-4 py-2 text-gray-600 hover:text-gray-800"
            title="Konto-Einstellungen"
          >
            Einstellungen
          </button>
          <button
            onClick={handleDisconnectAll}
            className="px-4 py-2 text-gray-600 hover:text-gray-800"
          >
            Abmelden
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="bg-red-100 border-b border-red-200 px-4 py-2 text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
            &times;
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {currentView === "inbox" ? (
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
              />
            </div>

            {/* Email list */}
            <div className="w-80 bg-white border-r overflow-y-auto flex flex-col">
              {/* Search results header */}
              {searchResults !== null && (
                <div className="px-4 py-2 bg-blue-50 border-b flex items-center justify-between">
                  <span className="text-sm text-blue-700">
                    {searchResults.length} Ergebnis{searchResults.length !== 1 ? "se" : ""} für "{searchQuery}"
                  </span>
                  <button
                    onClick={clearSearch}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    Zurück
                  </button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto">
                <EmailList
                  emails={searchResults !== null ? searchResults : emails}
                  selectedUid={selectedEmail?.uid}
                  onSelectEmail={handleSelectEmail}
                  loading={loading || searching}
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
                />
              ) : (
                <div className="h-full flex items-center justify-center text-gray-400">
                  Wähle eine E-Mail aus
                </div>
              )}
            </div>
          </>
        ) : currentView === "compose" ? (
          <div className="flex-1 bg-white overflow-y-auto">
            <Composer
              replyTo={replyTo}
              onSend={handleSendEmail}
              onCancel={() => {
                setCurrentView("inbox");
                setReplyTo(null);
              }}
              loading={loading}
            />
          </div>
        ) : currentView === "sieve" && activeAccountCredentials ? (
          <div className="flex-1 bg-white overflow-y-auto">
            <SieveEditor
              host={activeAccountCredentials.imapHost}
              username={activeAccountCredentials.username}
              password={activeAccountCredentials.password}
              folders={folders}
              onClose={() => setCurrentView("inbox")}
            />
          </div>
        ) : currentView === "settings" ? (
          <div className="flex-1 bg-white overflow-y-auto">
            <AccountSettings onClose={handleCloseSettings} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default App;
