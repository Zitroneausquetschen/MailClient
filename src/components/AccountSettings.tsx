import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { SavedAccount, CacheStats, EmailSignature, VacationSettings as VacationSettingsType } from "../types/mail";
import SignatureManager from "./SignatureManager";
import VacationSettings from "./VacationSettings";
import { checkForUpdatesManual, UpdateCheckResult } from "./UpdateChecker";

interface Props {
  onClose: () => void;
}

type SettingsTab = "general" | "signatures" | "vacation" | "app";

function AccountSettings({ onClose }: Props) {
  const { t, i18n } = useTranslation();
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [formData, setFormData] = useState<SavedAccount | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const savedAccounts = await invoke<SavedAccount[]>("get_saved_accounts");
      setAccounts(savedAccounts);

      // Auto-select first account if available
      if (savedAccounts.length > 0 && !selectedAccountId) {
        selectAccount(savedAccounts[0].id, savedAccounts);
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

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "general", label: t("settings.general") },
    { id: "signatures", label: t("settings.signatures") },
    { id: "vacation", label: t("settings.vacation") },
    { id: "app", label: t("settings.appInfo") },
  ];

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateResult(null);
    const result = await checkForUpdatesManual();
    setUpdateResult(result);
    setCheckingUpdate(false);
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
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
              {t("accounts.title")}
            </h3>
            {accounts.length === 0 ? (
              <p className="text-sm text-gray-500">{t("accounts.disconnected")}</p>
            ) : (
              <ul className="space-y-1">
                {accounts.map((account) => (
                  <li key={account.id}>
                    <button
                      onClick={() => selectAccount(account.id)}
                      className={`w-full text-left px-3 py-2 rounded transition-colors ${
                        selectedAccountId === account.id
                          ? "bg-blue-100 text-blue-800"
                          : "hover:bg-gray-100 text-gray-700"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            selectedAccountId === account.id ? "bg-blue-600" : "bg-gray-300"
                          }`}
                        />
                        <div className="overflow-hidden">
                          <div className="font-medium truncate">{account.display_name}</div>
                          <div className="text-xs text-gray-500 truncate">{account.username}</div>
                        </div>
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
          {!formData ? (
            <div className="h-full flex items-center justify-center text-gray-400">
              {t("common.select")}
            </div>
          ) : (
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
                              <p className="text-sm text-gray-500">{t("app.version", { version: "0.1.0" })}</p>
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
                                <p className="text-sm text-green-600">
                                  {t("updates.available", { version: updateResult.version })}
                                </p>
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
                        <p className="text-sm text-gray-500">{t("app.version", { version: "0.1.0" })}</p>
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
                          <p className="text-sm text-green-600">
                            {t("updates.available", { version: updateResult.version })}
                          </p>
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
    </div>
  );
}

export default AccountSettings;
