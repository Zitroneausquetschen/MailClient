import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { VacationSettings as VacationSettingsType, SavedAccount } from "../types/mail";

interface Props {
  vacation: VacationSettingsType | undefined;
  onChange: (vacation: VacationSettingsType) => void;
  account: SavedAccount;
}

function VacationSettings({ vacation, onChange, account }: Props) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(vacation?.enabled || false);
  const [subject, setSubject] = useState(vacation?.subject || t("vacation.defaultSubject", "Abwesend"));
  const [message, setMessage] = useState(
    vacation?.message ||
    `Vielen Dank fuer Ihre Nachricht.\n\nIch bin derzeit nicht im Buero und kann Ihre E-Mail nicht sofort beantworten.\n\nIch werde mich nach meiner Rueckkehr bei Ihnen melden.\n\nMit freundlichen Gruessen`
  );
  const [startDate, setStartDate] = useState(vacation?.startDate || "");
  const [endDate, setEndDate] = useState(vacation?.endDate || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Update local state when vacation prop changes
  useEffect(() => {
    if (vacation) {
      setEnabled(vacation.enabled);
      setSubject(vacation.subject);
      setMessage(vacation.message);
      setStartDate(vacation.startDate || "");
      setEndDate(vacation.endDate || "");
    }
  }, [vacation]);

  const handleToggle = async (newEnabled: boolean) => {
    setEnabled(newEnabled);
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      // Update the vacation settings in account
      const newVacation: VacationSettingsType = {
        enabled: newEnabled,
        subject,
        message,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };

      // Save to Sieve server
      await saveVacationToSieve(newVacation);

      // Update parent state
      onChange(newVacation);

      setSuccess(newEnabled ? t("vacation.activated", "Vacation notice activated") : t("vacation.deactivated", "Vacation notice deactivated"));
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(`${t("common.error")}: ${e}`);
      setEnabled(!newEnabled); // Revert on error
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      const newVacation: VacationSettingsType = {
        enabled,
        subject,
        message,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };

      // Save to Sieve server
      await saveVacationToSieve(newVacation);

      // Update parent state
      onChange(newVacation);

      setSuccess(t("settings.saved"));
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(`${t("errors.saveFailed")}: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const saveVacationToSieve = async (vacationSettings: VacationSettingsType) => {
    // Generate Sieve script for vacation
    const sieveScript = generateVacationSieve(vacationSettings);

    // Get the Sieve host - typically same as IMAP but port 4190
    const sieveHost = account.imap_host.replace(/^imap\./, "mail.");

    // Save to Sieve server
    await invoke("sieve_save_script", {
      host: sieveHost,
      port: 4190,
      username: account.username,
      password: account.password || "",
      scriptName: "vacation",
      script: sieveScript,
    });

    // If enabled, activate the script
    if (vacationSettings.enabled) {
      await invoke("sieve_activate_script", {
        host: sieveHost,
        port: 4190,
        username: account.username,
        password: account.password || "",
        scriptName: "vacation",
      });
    }
  };

  const generateVacationSieve = (settings: VacationSettingsType): string => {
    if (!settings.enabled) {
      // Return empty/disabled vacation script
      return `# Vacation auto-reply - DISABLED
require ["vacation"];

# Vacation is currently disabled
`;
    }

    // Build the vacation Sieve script
    let script = `# Vacation auto-reply
require ["vacation"`;

    // Add date extension if dates are specified
    if (settings.startDate || settings.endDate) {
      script += `, "date", "relational"`;
    }

    script += `];

`;

    // Add date conditions if specified
    if (settings.startDate || settings.endDate) {
      script += `# Date range check\n`;
      if (settings.startDate && settings.endDate) {
        script += `if allof(currentdate :value "ge" "date" "${settings.startDate}",
         currentdate :value "le" "date" "${settings.endDate}") {\n`;
      } else if (settings.startDate) {
        script += `if currentdate :value "ge" "date" "${settings.startDate}" {\n`;
      } else if (settings.endDate) {
        script += `if currentdate :value "le" "date" "${settings.endDate}" {\n`;
      }
    }

    // Escape message for Sieve
    const escapedMessage = settings.message
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');

    script += `vacation :days 1 :subject "${settings.subject}" "${escapedMessage}";\n`;

    // Close date condition if opened
    if (settings.startDate || settings.endDate) {
      script += `}\n`;
    }

    return script;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-gray-700">{t("vacation.title")}</h4>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => handleToggle(e.target.checked)}
            disabled={saving}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          <span className="ml-3 text-sm font-medium text-gray-700">
            {enabled ? t("vacation.enabled") : t("vacation.disabled")}
          </span>
        </label>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-300 text-red-700 px-3 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-100 border border-green-300 text-green-700 px-3 py-2 rounded text-sm">
          {success}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("vacation.startDate")} ({t("vacation.optional", "optional")})
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("vacation.endDate")} ({t("vacation.optional", "optional")})
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("vacation.subject")}
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={t("vacation.subjectPlaceholder", "e.g. Out of Office")}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {t("vacation.message")}
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={6}
          className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          placeholder={t("vacation.messagePlaceholder", "Your vacation notice...")}
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
        >
          {saving ? t("vacation.saving", "Saving...") : t("vacation.save")}
        </button>
      </div>

      <div className="text-xs text-gray-500 mt-4">
        <p>
          <strong>{t("vacation.note", "Note")}:</strong> {t("vacation.noteText", "The vacation notice is saved on the mail server via the Sieve protocol. Each incoming email will automatically be replied to with the configured message (at most once per day per sender).")}
        </p>
      </div>
    </div>
  );
}

export default VacationSettings;
