import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

interface UpdateCheckerProps {
  checkOnMount?: boolean;
}

export interface UpdateCheckResult {
  available: boolean;
  version?: string;
  error?: string;
}

// Export function for manual update check from settings
export async function checkForUpdatesManual(): Promise<UpdateCheckResult> {
  try {
    const update = await check();
    if (update) {
      return { available: true, version: update.version };
    }
    return { available: false };
  } catch (e) {
    return { available: false, error: String(e) };
  }
}

function UpdateChecker({ checkOnMount = true }: UpdateCheckerProps) {
  const { t } = useTranslation();
  const [update, setUpdate] = useState<Update | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedSize, setDownloadedSize] = useState(0);
  const [totalSize, setTotalSize] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  const checkForUpdates = useCallback(async () => {
    try {
      const updateResult = await check();
      if (updateResult) {
        setUpdate(updateResult);
        setShowDialog(true);
      }
    } catch (e) {
      console.log("Update check failed:", e);
      // Silently fail on automatic checks
    }
  }, []);

  useEffect(() => {
    if (checkOnMount) {
      // Delay the check a bit to not block app startup
      const timer = setTimeout(() => {
        checkForUpdates();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [checkOnMount, checkForUpdates]);

  const handleDownloadAndInstall = async () => {
    if (!update) return;

    setDownloading(true);
    setError(null);
    setDownloadProgress(0);

    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            setTotalSize(event.data.contentLength || 0);
            break;
          case "Progress":
            setDownloadedSize((prev) => prev + event.data.chunkLength);
            if (totalSize > 0) {
              setDownloadProgress(
                Math.round(((downloadedSize + event.data.chunkLength) / totalSize) * 100)
              );
            }
            break;
          case "Finished":
            setDownloadProgress(100);
            break;
        }
      });

      setInstalling(true);
      // Relaunch the app to apply the update
      await relaunch();
    } catch (e) {
      setError(String(e));
      setDownloading(false);
    }
  };

  const handleClose = () => {
    setShowDialog(false);
    setUpdate(null);
    setError(null);
    setDownloading(false);
    setDownloadProgress(0);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  if (!showDialog || !update) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
              <svg
                className="w-6 h-6 text-blue-600 dark:text-blue-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {t("updates.available")}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Version {update.version}
              </p>
            </div>
          </div>

          {update.body && (
            <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg max-h-40 overflow-y-auto">
              <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">
                {update.body}
              </p>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {downloading && (
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
                <span>{t("updates.downloading")}</span>
                <span>
                  {totalSize > 0
                    ? `${formatBytes(downloadedSize)} / ${formatBytes(totalSize)}`
                    : `${downloadProgress}%`}
                </span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </div>
          )}

          {installing && (
            <div className="mb-4 text-center">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {t("updates.installing")}
              </p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 rounded-b-lg flex justify-end gap-3">
          {!downloading && !installing && (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg transition-colors"
              >
                {t("updates.later")}
              </button>
              <button
                onClick={handleDownloadAndInstall}
                className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors"
              >
                {t("updates.updateNow")}
              </button>
            </>
          )}
          {downloading && !installing && (
            <button
              disabled
              className="px-4 py-2 bg-gray-400 text-white rounded-lg cursor-not-allowed"
            >
              {t("updates.downloading")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default UpdateChecker;
