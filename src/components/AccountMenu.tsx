import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { CloudUser, SyncStatus } from "../types/cloud";

interface Props {
  user: CloudUser | null;
  onLoginClick: () => void;
  onLogout: () => void;
  onUpgradeClick: () => void;
}

export default function AccountMenu({
  user,
  onLoginClick,
  onLogout,
  onUpgradeClick,
}: Props) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Load sync status when menu opens
  useEffect(() => {
    if (isOpen && user) {
      loadSyncStatus();
    }
  }, [isOpen, user]);

  const loadSyncStatus = async () => {
    try {
      const status = await invoke<SyncStatus>("cloud_sync_status");
      setSyncStatus(status);
    } catch (err) {
      console.error("Failed to load sync status:", err);
    }
  };

  const handleSync = async () => {
    if (!user?.is_premium) {
      onUpgradeClick();
      return;
    }

    setIsSyncing(true);
    setSyncError(null);

    try {
      // First pull to get latest changes
      await invoke("cloud_sync_pull", { encryptionPassword: null });
      // Then push local changes
      await invoke("cloud_sync_push", { encryptionPassword: null });
      // Refresh status
      await loadSyncStatus();
    } catch (err) {
      setSyncError(String(err));
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogout = async () => {
    try {
      await invoke("cloud_logout");
      onLogout();
      setIsOpen(false);
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  const formatLastSync = (timestamp: string | null) => {
    if (!timestamp) return t("cloud.neverSynced", "Never");
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return t("cloud.justNow", "Just now");
    if (diffMins < 60) return t("cloud.minutesAgo", "{{count}} min ago", { count: diffMins });
    if (diffHours < 24) return t("cloud.hoursAgo", "{{count}}h ago", { count: diffHours });
    return t("cloud.daysAgo", "{{count}}d ago", { count: diffDays });
  };

  // Not logged in - show login button
  if (!user) {
    return (
      <button
        onClick={onLoginClick}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        <span>{t("cloud.login", "Login")}</span>
      </button>
    );
  }

  return (
    <div ref={menuRef} className="relative">
      {/* Avatar button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 py-1 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-medium">
          {(user.name || user.email)[0].toUpperCase()}
        </div>
        <div className="text-left hidden sm:block">
          <div className="text-sm font-medium text-gray-800">
            {user.name || user.email.split("@")[0]}
          </div>
          <div className="text-xs text-gray-500 flex items-center gap-1">
            {user.is_premium ? (
              <>
                <span className="text-amber-500">Premium</span>
              </>
            ) : (
              <span>Free</span>
            )}
          </div>
        </div>
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-white rounded-lg shadow-xl border z-50">
          {/* User info */}
          <div className="px-4 py-3 border-b">
            <div className="font-medium text-gray-800">{user.name || user.email.split("@")[0]}</div>
            <div className="text-sm text-gray-500">{user.email}</div>
            {user.is_premium && user.premium_until && (
              <div className="text-xs text-amber-600 mt-1">
                Premium bis {new Date(user.premium_until).toLocaleDateString()}
              </div>
            )}
          </div>

          {/* Sync section */}
          <div className="px-4 py-3 border-b">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                {t("cloud.sync", "Cloud Sync")}
              </span>
              {user.is_premium ? (
                <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">
                  {t("cloud.active", "Active")}
                </span>
              ) : (
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                  {t("cloud.premiumOnly", "Premium")}
                </span>
              )}
            </div>

            {syncStatus && (
              <div className="text-xs text-gray-500 mb-2">
                {t("cloud.lastSync", "Last sync")}: {formatLastSync(syncStatus.last_sync)}
                {syncStatus.device_count > 1 && (
                  <span className="ml-2">
                    ({syncStatus.device_count} {t("cloud.devices", "devices")})
                  </span>
                )}
              </div>
            )}

            {syncError && (
              <div className="text-xs text-red-600 mb-2">{syncError}</div>
            )}

            <button
              onClick={handleSync}
              disabled={isSyncing}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                user.is_premium
                  ? "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {isSyncing ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {t("cloud.syncing", "Syncing...")}
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {user.is_premium
                    ? t("cloud.syncNow", "Sync Now")
                    : t("cloud.upgradeTo", "Upgrade for Sync")
                  }
                </>
              )}
            </button>
          </div>

          {/* Upgrade button for free users */}
          {!user.is_premium && (
            <div className="px-4 py-3 border-b">
              <button
                onClick={() => {
                  onUpgradeClick();
                  setIsOpen(false);
                }}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg text-sm font-medium hover:from-amber-600 hover:to-orange-600 transition-colors"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                {t("cloud.upgradeToPremium", "Upgrade to Premium")}
              </button>
            </div>
          )}

          {/* Menu items */}
          <div className="py-2">
            <button
              onClick={handleLogout}
              className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {t("cloud.logout", "Logout")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
