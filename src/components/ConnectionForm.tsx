import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { MailAccount, AutoConfigResult, SavedAccount } from "../types/mail";

interface Props {
  onConnect: (account: MailAccount) => Promise<void>;
  loading: boolean;
  error: string | null;
}

function ConnectionForm({ onConnect, loading, error }: Props) {
  const { t } = useTranslation();
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [autoConfigLoading, setAutoConfigLoading] = useState(false);
  const [autoConfigStatus, setAutoConfigStatus] = useState<string>("");
  const [savePassword, setSavePassword] = useState(true);

  const [formData, setFormData] = useState<MailAccount>({
    imapHost: "",
    imapPort: 993,
    smtpHost: "",
    smtpPort: 587,
    username: "",
    password: "",
    displayName: "",
  });

  // Load saved accounts on mount
  useEffect(() => {
    loadSavedAccounts();
  }, []);

  const loadSavedAccounts = async () => {
    try {
      const accounts = await invoke<SavedAccount[]>("get_saved_accounts");
      setSavedAccounts(accounts);
    } catch (e) {
      console.error("Failed to load saved accounts:", e);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onConnect(formData);

    // After successful connection, offer to save
    if (!error) {
      try {
        const accountId = formData.username;
        const savedAccount: SavedAccount = {
          id: accountId,
          display_name: formData.displayName,
          username: formData.username,
          imap_host: formData.imapHost,
          imap_port: formData.imapPort,
          smtp_host: formData.smtpHost,
          smtp_port: formData.smtpPort,
          password: savePassword ? formData.password : undefined,
        };
        await invoke("save_account", { account: savedAccount });
        await loadSavedAccounts();
      } catch (e) {
        console.error("Failed to save account:", e);
      }
    }
  };

  const handleChange = (field: keyof MailAccount, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // Lookup autoconfig when email is entered
  const handleEmailChange = async (email: string) => {
    handleChange("username", email);

    // Only trigger autoconfig lookup if email looks valid
    if (email.includes("@") && email.split("@")[1]?.includes(".")) {
      setAutoConfigLoading(true);
      setAutoConfigStatus(t("accounts.searchingSettings"));

      try {
        const config = await invoke<AutoConfigResult>("lookup_autoconfig", { email });

        if (config.imap_host) {
          setFormData((prev) => ({
            ...prev,
            imapHost: config.imap_host || prev.imapHost,
            imapPort: config.imap_port || prev.imapPort,
            smtpHost: config.smtp_host || prev.smtpHost,
            smtpPort: config.smtp_port || prev.smtpPort,
            displayName: config.display_name || prev.displayName,
          }));
          setAutoConfigStatus(t("accounts.settingsFound"));
        } else {
          setAutoConfigStatus(t("accounts.usingDefaults"));
        }
      } catch (e) {
        setAutoConfigStatus(t("accounts.autoConfigFailed"));
        console.error("AutoConfig failed:", e);
      } finally {
        setAutoConfigLoading(false);
        // Clear status after a few seconds
        setTimeout(() => setAutoConfigStatus(""), 3000);
      }
    }
  };

  // Handle saved account selection
  const handleAccountSelect = (accountId: string) => {
    setSelectedAccountId(accountId);

    if (accountId === "") {
      // Clear form for new account
      setFormData({
        imapHost: "",
        imapPort: 993,
        smtpHost: "",
        smtpPort: 587,
        username: "",
        password: "",
        displayName: "",
      });
      return;
    }

    const account = savedAccounts.find((a) => a.id === accountId);
    if (account) {
      setFormData({
        imapHost: account.imap_host,
        imapPort: account.imap_port,
        smtpHost: account.smtp_host,
        smtpPort: account.smtp_port,
        username: account.username,
        password: account.password || "",
        displayName: account.display_name,
      });
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    try {
      await invoke("delete_saved_account", { accountId });
      await loadSavedAccounts();
      if (selectedAccountId === accountId) {
        setSelectedAccountId("");
        setFormData({
          imapHost: "",
          imapPort: 993,
          smtpHost: "",
          smtpPort: 587,
          username: "",
          password: "",
          displayName: "",
        });
      }
    } catch (e) {
      console.error("Failed to delete account:", e);
    }
  };

  return (
    <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
      <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">
        {t("accounts.connectAccount")}
      </h2>

      {error && (
        <div className="bg-red-100 border border-red-300 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Saved Accounts Dropdown */}
      {savedAccounts.length > 0 && (
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("accounts.savedAccounts")}
          </label>
          <div className="flex gap-2">
            <select
              value={selectedAccountId}
              onChange={(e) => handleAccountSelect(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">{t("accounts.newAccount")}</option>
              {savedAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.display_name} ({account.username})
                </option>
              ))}
            </select>
            {selectedAccountId && (
              <button
                type="button"
                onClick={() => handleDeleteAccount(selectedAccountId)}
                className="px-3 py-2 text-red-600 hover:bg-red-50 rounded"
                title={t("accounts.deleteAccount")}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("accounts.displayName")}
          </label>
          <input
            type="text"
            value={formData.displayName}
            onChange={(e) => handleChange("displayName", e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Max Mustermann"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("accounts.username")}
          </label>
          <input
            type="text"
            value={formData.username}
            onChange={(e) => handleEmailChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="mail@example.com"
            required
          />
          {autoConfigStatus && (
            <p className={`text-xs mt-1 ${autoConfigLoading ? "text-blue-600" : autoConfigStatus === t("accounts.settingsFound") ? "text-green-600" : "text-gray-500"}`}>
              {autoConfigLoading && (
                <span className="inline-block animate-spin mr-1">⟳</span>
              )}
              {autoConfigStatus}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("accounts.password")}
          </label>
          <input
            type="password"
            value={formData.password}
            onChange={(e) => handleChange("password", e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <div className="flex items-center">
          <input
            type="checkbox"
            id="savePassword"
            checked={savePassword}
            onChange={(e) => setSavePassword(e.target.checked)}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label htmlFor="savePassword" className="ml-2 block text-sm text-gray-700">
            {t("accounts.savePassword")}
          </label>
        </div>

        <div className="border-t pt-4 mt-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">{t("accounts.serverSettings")}</h3>

          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">{t("accounts.imapServer")}</label>
              <input
                type="text"
                value={formData.imapHost}
                onChange={(e) => handleChange("imapHost", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="imap.example.com"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("accounts.port")}</label>
              <input
                type="number"
                value={formData.imapPort}
                onChange={(e) => handleChange("imapPort", parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">{t("accounts.smtpServer")}</label>
              <input
                type="text"
                value={formData.smtpHost}
                onChange={(e) => handleChange("smtpHost", e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                placeholder="smtp.example.com"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t("accounts.port")}</label>
              <input
                type="number"
                value={formData.smtpPort}
                onChange={(e) => handleChange("smtpPort", parseInt(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                required
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed mt-6"
        >
          {loading ? t("accounts.connecting") : t("accounts.connect")}
        </button>
      </form>
    </div>
  );
}

export default ConnectionForm;
