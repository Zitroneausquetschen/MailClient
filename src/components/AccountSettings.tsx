import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { SavedAccount, SavedJmapAccount, CacheStats, EmailSignature, VacationSettings as VacationSettingsType, MailAccount, JmapAccount, ConnectedAccount, JmapConnectedAccount } from "../types/mail";
import SignatureManager from "./SignatureManager";
import VacationSettings from "./VacationSettings";
import ConnectionForm from "./ConnectionForm";
import { UpdateCheckResult } from "./UpdateChecker";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

interface ProtocolStatus {
  protocol: string;
  connected: boolean;
  error: string | null;
}

interface AccountStatus {
  account_id: string;
  protocols: ProtocolStatus[];
}

interface Props {
  onClose: () => void;
  onAccountsChanged?: () => void;  // Callback when accounts are added/removed
}

type SettingsTab = "general" | "signatures" | "vacation" | "app";

function AccountSettings({ onClose, onAccountsChanged }: Props) {
  const { t, i18n } = useTranslation();
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [jmapAccounts, setJmapAccounts] = useState<SavedJmapAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedAccountType, setSelectedAccountType] = useState<"imap" | "jmap">("imap");
  const [formData, setFormData] = useState<SavedAccount | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  // Add account form state
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [addAccountError, setAddAccountError] = useState<string | null>(null);
  // Delete account state
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // App version
  const [appVersion, setAppVersion] = useState("0.0.0");
  // Account status popup
  const [statusPopup, setStatusPopup] = useState<{ accountId: string; x: number; y: number } | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  useEffect(() => {
    loadAccounts();
    // Load app version
    getVersion().then(setAppVersion).catch(() => setAppVersion("0.3.2"));
  }, []);

  const loadAccounts = async () => {
    try {
      const savedAccounts = await invoke<SavedAccount[]>("get_saved_accounts");
      setAccounts(savedAccounts);

      // Also load JMAP accounts
      let savedJmapAccounts: SavedJmapAccount[] = [];
      try {
        savedJmapAccounts = await invoke<SavedJmapAccount[]>("get_saved_jmap_accounts");
        setJmapAccounts(savedJmapAccounts);
      } catch {
        // JMAP accounts might not exist yet
      }

      // Auto-select first account if available
      if (savedAccounts.length > 0 && !selectedAccountId) {
        selectAccount(savedAccounts[0].id, savedAccounts);
      } else if (savedJmapAccounts.length > 0 && !selectedAccountId) {
        // Select first JMAP account if no IMAP accounts
        setSelectedAccountId(savedJmapAccounts[0].id);
        setSelectedAccountType("jmap");
      }
    } catch (e) {
      setMessage({ type: "error", text: `${t("errors.loadFailed")}: ${e}` });
    }
  };

  const selectAccount = async (id: string, accountList?: SavedAccount[]) => {
    const searchList = accountList || accounts;
    const account = searchList.find((a) => a.id === id);
    if (account) {
      setSelectedAccountId(id);
      setFormData({
        ...account,
        cache_enabled: account.cache_enabled ?? false,
        cache_days: account.cache_days ?? 30,
        cache_body: account.cache_body ?? true,
        cache_attachments: account.cache_attachments ?? false,
        signatures: account.signatures ?? [],
        vacation: account.vacation ?? { enabled: false, subject: t("vacation.title"), message: "" },
      });
      setMessage(null);
      await loadCacheStats(id);
    }
  };

  const loadCacheStats = async (accountId: string) => {
    try {
      const stats = await invoke<CacheStats>("get_cache_stats", { accountId });
      setCacheStats(stats);
    } catch (e) {
      console.error("Failed to load cache stats:", e);
      setCacheStats(null);
    }
  };

  const handleStatusClick = async (e: React.MouseEvent, accountId: string) => {
    e.stopPropagation();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setStatusPopup({ accountId, x: rect.right + 10, y: rect.top });
    setLoadingStatus(true);
    setAccountStatus(null);
    try {
      const status = await invoke<AccountStatus>("get_account_status", { accountId });
      setAccountStatus(status);
    } catch (err) {
      console.error("Failed to get account status:", err);
    } finally {
      setLoadingStatus(false);
    }
  };

  const handleClearCache = async () => {
    if (!selectedAccountId) return;

    setClearingCache(true);
    try {
      await invoke("clear_cache", { accountId: selectedAccountId });
      await loadCacheStats(selectedAccountId);
      setMessage({ type: "success", text: t("settings.cacheCleared") });
    } catch (e) {
      setMessage({ type: "error", text: `${t("common.error")}: ${e}` });
    } finally {
      setClearingCache(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return "-";
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(i18n.language === "de" ? "de-DE" : "en-US");
    } catch {
      return dateStr;
    }
  };

  const handleChange = (field: keyof SavedAccount, value: string | number | boolean | EmailSignature[] | VacationSettingsType | undefined) => {
    if (!formData) return;
    setFormData((prev) => (prev ? { ...prev, [field]: value } : null));
  };

  const handleSignaturesChange = (signatures: EmailSignature[]) => {
    handleChange("signatures", signatures);
  };

  const handleVacationChange = (vacation: VacationSettingsType) => {
    handleChange("vacation", vacation);
  };

  const handleSave = async () => {
    if (!formData) return;

    if (!formData.display_name || !formData.username || !formData.imap_host || !formData.smtp_host) {
      setMessage({ type: "error", text: t("errors.saveFailed") });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      await invoke("save_account", { account: formData });
      await loadAccounts();
      setMessage({ type: "success", text: t("settings.saved") });
    } catch (e) {
      setMessage({ type: "error", text: `${t("errors.saveFailed")}: ${e}` });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (selectedAccountId) {
      const account = accounts.find((a) => a.id === selectedAccountId);
      if (account) {
        setFormData({ ...account });
      }
    }
    setMessage(null);
  };

  // Add new account
  const handleAddAccount = async (account: MailAccount | JmapAccount, protocol: "imap" | "jmap") => {
    setAddingAccount(true);
    setAddAccountError(null);

    try {
      if (protocol === "jmap") {
        const jmapAccount = account as JmapAccount;
        await invoke<JmapConnectedAccount>("jmap_connect", { account: jmapAccount });

        // Save the JMAP account
        const savedAccount: SavedJmapAccount = {
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
        await invoke<ConnectedAccount>("connect", { account: imapAccount });

        // Save the IMAP account
        const savedAccount: SavedAccount = {
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

      setShowAddAccount(false);
      await loadAccounts();
      onAccountsChanged?.();
      setMessage({ type: "success", text: t("accounts.connected") });
    } catch (e) {
      setAddAccountError(String(e));
    } finally {
      setAddingAccount(false);
    }
  };

  // Delete account
  const handleDeleteAccount = async () => {
    if (!selectedAccountId) return;

    setDeletingAccount(true);
    try {
      // Disconnect the account first
      try {
        if (selectedAccountType === "jmap") {
          await invoke("jmap_disconnect", { accountId: selectedAccountId });
        } else {
          await invoke("disconnect", { accountId: selectedAccountId });
        }
      } catch {
        // Account might not be connected
      }

      // Delete the saved account
      if (selectedAccountType === "jmap") {
        await invoke("delete_saved_jmap_account", { accountId: selectedAccountId });
      } else {
        await invoke("delete_saved_account", { accountId: selectedAccountId });
      }

      // Clear cache for this account
      try {
        await invoke("clear_cache", { accountId: selectedAccountId });
      } catch {
        // Cache might not exist
      }

      setShowDeleteConfirm(false);
      setSelectedAccountId(null);
      setFormData(null);
      await loadAccounts();
      onAccountsChanged?.();
      setMessage({ type: "success", text: t("accounts.deleteAccount") + " - OK" });
    } catch (e) {
      setMessage({ type: "error", text: `${t("errors.deleteFailed")}: ${e}` });
    } finally {
      setDeletingAccount(false);
    }
  };

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: t("settings.general") },
    { id: "signatures", label: t("settings.signatures") },
    { id: "vacation", label: t("settings.vacation") },
    { id: "app", label: t("settings.appInfo") },
  ];

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateResult(null);
    setPendingUpdate(null);
    try {
      const update = await check();
      if (update) {
        setUpdateResult({ available: true, version: update.version });
        setPendingUpdate(update);
      } else {
        setUpdateResult({ available: false });
      }
    } catch (e) {
      setUpdateResult({ available: false, error: String(e) });
    }
    setCheckingUpdate(false);
  };

  const handleInstallUpdate = async () => {
    if (!pendingUpdate) return;

    setInstallingUpdate(true);
    setDownloadProgress(0);

    let totalSize = 0;
    let downloadedSize = 0;

    try {
      await pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            totalSize = event.data.contentLength || 0;
            break;
          case "Progress":
            downloadedSize += event.data.chunkLength;
            if (totalSize > 0) {
              setDownloadProgress(Math.round((downloadedSize / totalSize) * 100));
            }
            break;
          case "Finished":
            setDownloadProgress(100);
            break;
        }
      });
      await relaunch();
    } catch (e) {
      setUpdateResult({ available: true, version: pendingUpdate.version, error: String(e) });
      setInstallingUpdate(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b px-6 py-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-800">{t("settings.title")}</h2>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-700"
          title={t("common.close")}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Account list (left side) */}
        <div className="w-64 border-r bg-gray-50 overflow-y-auto">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                {t("accounts.title")}
              </h3>
              <button
                onClick={() => setShowAddAccount(true)}
                className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                title={t("accounts.add")}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
            {accounts.length === 0 && jmapAccounts.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-gray-500 mb-2">{t("accounts.disconnected")}</p>
                <button
                  onClick={() => setShowAddAccount(true)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  {t("accounts.add")}
                </button>
              </div>
            ) : (
              <ul className="space-y-1">
                {/* IMAP Accounts */}
                {accounts.map((account) => (
                  <li key={account.id}>
                    <button
                      onClick={() => {
                        selectAccount(account.id);
                        setSelectedAccountType("imap");
                      }}
                      className={`w-full text-left px-3 py-2 rounded transition-colors ${
                        selectedAccountId === account.id
                          ? "bg-blue-100 text-blue-800"
                          : "hover:bg-gray-100 text-gray-700"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          onClick={(e) => handleStatusClick(e, account.id)}
                          className={`w-2.5 h-2.5 rounded-full cursor-pointer hover:ring-2 hover:ring-blue-300 ${
                            selectedAccountId === account.id ? "bg-blue-600" : "bg-gray-400"
                          }`}
                          title={t("accounts.status")}
                        />
                        <div className="overflow-hidden flex-1">
                          <div className="font-medium truncate">{account.display_name}</div>
                          <div className="text-xs text-gray-500 truncate">{account.username}</div>
                        </div>
                        <span className="text-xs text-gray-400">IMAP</span>
                      </div>
                    </button>
                  </li>
                ))}
                {/* JMAP Accounts */}
                {jmapAccounts.map((account) => (
                  <li key={account.id}>
                    <button
                      onClick={() => {
                        setSelectedAccountId(account.id);
                        setSelectedAccountType("jmap");
                        setFormData(null); // JMAP accounts use different form
                      }}
                      className={`w-full text-left px-3 py-2 rounded transition-colors ${
                        selectedAccountId === account.id
                          ? "bg-blue-100 text-blue-800"
                          : "hover:bg-gray-100 text-gray-700"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          onClick={(e) => handleStatusClick(e, account.id)}
                          className={`w-2.5 h-2.5 rounded-full cursor-pointer hover:ring-2 hover:ring-green-300 ${
                            selectedAccountId === account.id ? "bg-blue-600" : "bg-gray-400"
                          }`}
                          title={t("accounts.status")}
                        />
                        <div className="overflow-hidden flex-1">
                          <div className="font-medium truncate">{account.displayName}</div>
                          <div className="text-xs text-gray-500 truncate">{account.username}</div>
                        </div>
                        <span className="text-xs text-green-600">JMAP</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Edit form (right side) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* JMAP Account View */}
          {selectedAccountType === "jmap" && selectedAccountId && (
            <>
              <div className="border-b px-6 py-4">
                <h3 className="text-lg font-medium text-gray-900">JMAP {t("accounts.title")}</h3>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-2xl">
                  {message && (
                    <div
                      className={`mb-4 px-4 py-3 rounded ${
                        message.type === "success"
                          ? "bg-green-100 border border-green-300 text-green-700"
                          : "bg-red-100 border border-red-300 text-red-700"
                      }`}
                    >
                      {message.text}
                    </div>
                  )}
                  {(() => {
                    const jmapAccount = jmapAccounts.find(a => a.id === selectedAccountId);
                    if (!jmapAccount) return null;
                    return (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {t("accounts.displayName")}
                          </label>
                          <input
                            type="text"
                            value={jmapAccount.displayName}
                            className="w-full px-3 py-2 border border-gray-300 rounded bg-gray-50"
                            disabled
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {t("accounts.username")}
                          </label>
                          <input
                            type="text"
                            value={jmapAccount.username}
                            className="w-full px-3 py-2 border border-gray-300 rounded bg-gray-50"
                            disabled
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            {t("accounts.jmapUrl")}
                          </label>
                          <input
                            type="text"
                            value={jmapAccount.jmapUrl}
                            className="w-full px-3 py-2 border border-gray-300 rounded bg-gray-50"
                            disabled
                          />
                        </div>
                        <div className="border-t pt-4 mt-4">
                          <button
                            onClick={() => setShowDeleteConfirm(true)}
                            className="px-4 py-2 text-red-600 border border-red-300 rounded hover:bg-red-50"
                          >
                            {t("accounts.deleteAccount")}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </>
          )}
          {/* IMAP Account View */}
          {selectedAccountType === "imap" && !formData && (
            <div className="h-full flex items-center justify-center text-gray-400">
              {t("common.select")}
            </div>
          )}
          {selectedAccountType === "imap" && formData && (
            <>
              {/* Tab navigation */}
              <div className="border-b px-6">
                <nav className="flex gap-4">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                        activeTab === tab.id
                          ? "border-blue-500 text-blue-600"
                          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-2xl">
                  {/* Message */}
                  {message && (
                    <div
                      className={`mb-4 px-4 py-3 rounded ${
                        message.type === "success"
                          ? "bg-green-100 border border-green-300 text-green-700"
                          : "bg-red-100 border border-red-300 text-red-700"
                      }`}
                    >
                      {message.text}
                    </div>
                  )}

                  {activeTab === "general" && (
                    <div className="space-y-4">
                      {/* Display Name */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t("contacts.firstName")}
                        </label>
                        <input
                          type="text"
                          value={formData.display_name}
                          onChange={(e) => handleChange("display_name", e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Max Mustermann"
                        />
                      </div>

                      {/* Username */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t("accounts.email")}
                        </label>
                        <input
                          type="text"
                          value={formData.username}
                          className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50"
                          placeholder="mail@example.com"
                          disabled
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          {t("accounts.email")}
                        </p>
                      </div>

                      {/* Password */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          {t("accounts.password")}
                        </label>
                        <input
                          type="password"
                          value={formData.password || ""}
                          onChange={(e) => handleChange("password", e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="••••••••"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          {t("accounts.password")}
                        </p>
                      </div>

                      {/* Server Settings */}
                      <div className="border-t pt-4 mt-4">
                        <h3 className="text-sm font-medium text-gray-700 mb-3">{t("accounts.server")}</h3>

                        {/* IMAP */}
                        <div className="grid grid-cols-3 gap-2 mb-3">
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-500 mb-1">{t("accounts.imapServer")}</label>
                            <input
                              type="text"
                              value={formData.imap_host}
                              onChange={(e) => handleChange("imap_host", e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                              placeholder="imap.example.com"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">{t("accounts.port")}</label>
                            <input
                              type="number"
                              value={formData.imap_port}
                              onChange={(e) => handleChange("imap_port", parseInt(e.target.value) || 993)}
                              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            />
                          </div>
                        </div>

                        {/* SMTP */}
                        <div className="grid grid-cols-3 gap-2">
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-500 mb-1">{t("accounts.smtpServer")}</label>
                            <input
                              type="text"
                              value={formData.smtp_host}
                              onChange={(e) => handleChange("smtp_host", e.target.value)}
                              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                              placeholder="smtp.example.com"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">{t("accounts.port")}</label>
                            <input
                              type="number"
                              value={formData.smtp_port}
                              onChange={(e) => handleChange("smtp_port", parseInt(e.target.value) || 587)}
                              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Cache Settings */}
                      <div className="border-t pt-4 mt-4">
                        <h3 className="text-sm font-medium text-gray-700 mb-3">{t("settings.cache")}</h3>

                        {/* Enable Cache */}
                        <div className="flex items-center mb-4">
                          <input
                            type="checkbox"
                            id="cacheEnabled"
                            checked={formData.cache_enabled || false}
                            onChange={(e) => handleChange("cache_enabled", e.target.checked)}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                          <label htmlFor="cacheEnabled" className="ml-2 block text-sm text-gray-700">
                            {t("settings.cacheEnabled")}
                          </label>
                        </div>

                        {formData.cache_enabled && (
                          <>
                            {/* Cache Duration */}
                            <div className="mb-4">
                              <label className="block text-xs text-gray-500 mb-1">{t("settings.cacheDays")}</label>
                              <select
                                value={formData.cache_days || 30}
                                onChange={(e) => handleChange("cache_days", parseInt(e.target.value))}
                                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                              >
                                <option value={7}>7</option>
                                <option value={30}>30</option>
                                <option value={90}>90</option>
                                <option value={365}>365</option>
                                <option value={0}>{t("common.all")}</option>
                              </select>
                            </div>

                            {/* Cache Body */}
                            <div className="flex items-center mb-3">
                              <input
                                type="checkbox"
                                id="cacheBody"
                                checked={formData.cache_body ?? true}
                                onChange={(e) => handleChange("cache_body", e.target.checked)}
                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                              />
                              <label htmlFor="cacheBody" className="ml-2 block text-sm text-gray-700">
                                {t("settings.cacheBody")}
                              </label>
                            </div>

                            {/* Cache Attachments */}
                            <div className="flex items-center mb-4">
                              <input
                                type="checkbox"
                                id="cacheAttachments"
                                checked={formData.cache_attachments || false}
                                onChange={(e) => handleChange("cache_attachments", e.target.checked)}
                                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                              />
                              <label htmlFor="cacheAttachments" className="ml-2 block text-sm text-gray-700">
                                {t("settings.cacheAttachments")}
                              </label>
                            </div>

                            {/* Cache Statistics */}
                            <div className="bg-gray-50 rounded p-3 mb-4">
                              <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">{t("settings.cache")}</h4>
                              {cacheStats && cacheStats.emailCount > 0 ? (
                                <div className="text-sm text-gray-700 space-y-1">
                                  <div className="flex justify-between">
                                    <span>{t("nav.email")}:</span>
                                    <span className="font-medium">{cacheStats.emailCount.toLocaleString()}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>{t("email.attachments")}:</span>
                                    <span className="font-medium">{cacheStats.attachmentCount.toLocaleString()}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>{t("settings.cache")}:</span>
                                    <span className="font-medium">{formatBytes(cacheStats.totalSizeBytes)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>{t("email.date")}:</span>
                                    <span className="font-medium">{formatDate(cacheStats.oldestEmail)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>{t("email.date")}:</span>
                                    <span className="font-medium">{formatDate(cacheStats.newestEmail)}</span>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-sm text-gray-500">
                                  {t("email.noEmails")}
                                </div>
                              )}
                            </div>

                            {/* Clear Cache Button */}
                            <button
                              type="button"
                              onClick={handleClearCache}
                              disabled={clearingCache}
                              className="px-3 py-1.5 text-sm text-red-600 border border-red-300 rounded hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {clearingCache ? t("common.loading") : t("settings.clearCache")}
                            </button>
                          </>
                        )}
                      </div>

                      {/* Buttons */}
                      <div className="flex gap-3 pt-4 border-t mt-4">
                        <button
                          onClick={handleSave}
                          disabled={saving}
                          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed"
                        >
                          {saving ? t("common.loading") : t("common.save")}
                        </button>
                        <button
                          onClick={handleCancel}
                          disabled={saving}
                          className="px-4 py-2 text-gray-600 border border-gray-300 rounded hover:bg-gray-50 disabled:cursor-not-allowed"
                        >
                          {t("common.cancel")}
                        </button>
                        <div className="flex-1" />
                        <button
                          onClick={() => setShowDeleteConfirm(true)}
                          className="px-4 py-2 text-red-600 border border-red-300 rounded hover:bg-red-50"
                        >
                          {t("accounts.deleteAccount")}
                        </button>
                      </div>
                    </div>
                  )}

                  {activeTab === "signatures" && (
                    <div>
                      <SignatureManager
                        signatures={formData.signatures || []}
                        onChange={handleSignaturesChange}
                      />

                      {/* Save button for signatures */}
                      <div className="flex gap-3 pt-4 mt-6 border-t">
                        <button
                          onClick={handleSave}
                          disabled={saving}
                          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed"
                        >
                          {saving ? t("common.loading") : t("common.save")}
                        </button>
                      </div>
                    </div>
                  )}

                  {activeTab === "vacation" && formData && (
                    <VacationSettings
                      vacation={formData.vacation}
                      onChange={handleVacationChange}
                      account={formData}
                    />
                  )}

                  {activeTab === "app" && (
                    <div className="space-y-6">
                      <div>
                        <h3 className="text-lg font-medium text-gray-900 mb-4">{t("settings.appInfo")}</h3>

                        <div className="bg-gray-50 rounded-lg p-4 mb-6">
                          <div className="flex items-center gap-3 mb-2">
                            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                            </div>
                            <div>
                              <h4 className="font-semibold text-gray-900">{t("app.name")}</h4>
                              <p className="text-sm text-gray-500">{t("app.version", { version: appVersion })}</p>
                            </div>
                          </div>
                        </div>

                        <div className="border rounded-lg p-4 mb-4">
                          <h4 className="font-medium text-gray-900 mb-3">{t("settings.language")}</h4>
                          <select
                            value={i18n.language}
                            onChange={(e) => i18n.changeLanguage(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="de">Deutsch</option>
                            <option value="en">English</option>
                          </select>
                        </div>

                        <div className="border rounded-lg p-4">
                          <h4 className="font-medium text-gray-900 mb-3">{t("updates.title")}</h4>

                          <div className="flex items-center gap-3">
                            <button
                              onClick={handleCheckUpdate}
                              disabled={checkingUpdate}
                              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                              {checkingUpdate ? (
                                <>
                                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  {t("updates.checking")}
                                </>
                              ) : (
                                <>
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                  {t("updates.checkForUpdates")}
                                </>
                              )}
                            </button>
                          </div>

                          {updateResult && (
                            <div className={`mt-3 p-3 rounded-lg ${
                              updateResult.error
                                ? "bg-red-50 border border-red-200"
                                : updateResult.available
                                  ? "bg-green-50 border border-green-200"
                                  : "bg-gray-50 border border-gray-200"
                            }`}>
                              {updateResult.error ? (
                                <p className="text-sm text-red-600">{t("updates.error")}: {updateResult.error}</p>
                              ) : updateResult.available ? (
                                <div className="flex items-center justify-between">
                                  <p className="text-sm text-green-600">
                                    {t("updates.available")}: Version {updateResult.version}
                                  </p>
                                  <button
                                    onClick={handleInstallUpdate}
                                    disabled={installingUpdate}
                                    className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed flex items-center gap-2"
                                  >
                                    {installingUpdate ? (
                                      <>
                                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        {downloadProgress > 0 ? `${downloadProgress}%` : t("updates.installing")}
                                      </>
                                    ) : (
                                      <>
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                        </svg>
                                        {t("updates.updateNow")}
                                      </>
                                    )}
                                  </button>
                                </div>
                              ) : (
                                <p className="text-sm text-gray-600">{t("updates.notAvailable")}</p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* App tab content - shown even without selected account */}
          {!formData && activeTab === "app" && (
            <div className="flex-1 p-6 overflow-y-auto">
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">{t("settings.appInfo")}</h3>

                  <div className="bg-gray-50 rounded-lg p-4 mb-6">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                        <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div>
                        <h4 className="font-semibold text-gray-900">{t("app.name")}</h4>
                        <p className="text-sm text-gray-500">{t("app.version", { version: appVersion })}</p>
                      </div>
                    </div>
                  </div>

                  <div className="border rounded-lg p-4 mb-4">
                    <h4 className="font-medium text-gray-900 mb-3">{t("settings.language")}</h4>
                    <select
                      value={i18n.language}
                      onChange={(e) => i18n.changeLanguage(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="de">Deutsch</option>
                      <option value="en">English</option>
                    </select>
                  </div>

                  <div className="border rounded-lg p-4">
                    <h4 className="font-medium text-gray-900 mb-3">{t("updates.title")}</h4>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleCheckUpdate}
                        disabled={checkingUpdate}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {checkingUpdate ? (
                          <>
                            <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            {t("updates.checking")}
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            {t("updates.checkForUpdates")}
                          </>
                        )}
                      </button>
                    </div>

                    {updateResult && (
                      <div className={`mt-3 p-3 rounded-lg ${
                        updateResult.error
                          ? "bg-red-50 border border-red-200"
                          : updateResult.available
                            ? "bg-green-50 border border-green-200"
                            : "bg-gray-50 border border-gray-200"
                      }`}>
                        {updateResult.error ? (
                          <p className="text-sm text-red-600">{t("updates.error")}: {updateResult.error}</p>
                        ) : updateResult.available ? (
                          <div className="flex items-center justify-between">
                            <p className="text-sm text-green-600">
                              {t("updates.available")}: Version {updateResult.version}
                            </p>
                            <button
                              onClick={handleInstallUpdate}
                              disabled={installingUpdate}
                              className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                              {installingUpdate ? (
                                <>
                                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  {downloadProgress > 0 ? `${downloadProgress}%` : t("updates.installing")}
                                </>
                              ) : (
                                <>
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                  </svg>
                                  {t("updates.updateNow")}
                                </>
                              )}
                            </button>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-600">{t("updates.notAvailable")}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Account Modal */}
      {showAddAccount && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => {
                setShowAddAccount(false);
                setAddAccountError(null);
              }}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-700 z-10"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <ConnectionForm
              onConnect={handleAddAccount}
              loading={addingAccount}
              error={addAccountError}
            />
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {t("accounts.deleteAccount")}
            </h3>
            <p className="text-gray-600 mb-4">
              {t("accounts.deleteConfirm", "Möchten Sie dieses Konto wirklich löschen? Alle gespeicherten Daten werden entfernt.")}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deletingAccount}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded hover:bg-gray-50 disabled:cursor-not-allowed"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deletingAccount}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-red-400 disabled:cursor-not-allowed"
              >
                {deletingAccount ? t("common.loading") : t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Status Popup */}
      {statusPopup && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setStatusPopup(null)}
          />
          <div
            className="fixed bg-white rounded-lg shadow-xl border border-gray-200 z-50 min-w-56"
            style={{ left: statusPopup.x, top: statusPopup.y }}
          >
            <div className="px-4 py-3 border-b border-gray-100">
              <h4 className="font-medium text-gray-900">{t("accounts.connectionStatus")}</h4>
            </div>
            <div className="p-3">
              {loadingStatus ? (
                <div className="flex items-center justify-center py-4">
                  <svg className="animate-spin w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
              ) : accountStatus ? (
                <div className="space-y-2">
                  {accountStatus.protocols.map((proto) => (
                    <div key={proto.protocol} className="flex items-center justify-between gap-4">
                      <span className="text-sm font-medium text-gray-700">{proto.protocol}</span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            proto.connected ? "bg-green-500" : "bg-red-500"
                          }`}
                        />
                        <span className={`text-xs ${proto.connected ? "text-green-600" : "text-red-600"}`}>
                          {proto.connected ? t("accounts.connected") : (proto.error || t("accounts.disconnected"))}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">{t("errors.loadFailed")}</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default AccountSettings;
