import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import Composer from "./components/Composer";
import { OutgoingEmail, SavedAccount, Email } from "./types/mail";
import { playSentSound, playErrorSound } from "./utils/sounds";

function ComposerWindow() {
  const [loading, setLoading] = useState(false);
  const [currentAccount, setCurrentAccount] = useState<SavedAccount | null>(null);
  const [replyTo, setReplyTo] = useState<Email | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    // Get data passed to this window via URL params
    const params = new URLSearchParams(window.location.search);
    const accountIdParam = params.get("accountId");
    const replyToParam = params.get("replyTo");

    if (accountIdParam) {
      setAccountId(accountIdParam);
      // Load account settings
      loadAccountSettings(accountIdParam);
    }

    if (replyToParam) {
      try {
        const replyData = JSON.parse(decodeURIComponent(replyToParam));
        setReplyTo(replyData);
      } catch (e) {
        console.error("Failed to parse replyTo data:", e);
      }
    }
  }, []);

  const loadAccountSettings = async (id: string) => {
    try {
      const savedAccounts = await invoke<SavedAccount[]>("get_saved_accounts");
      const account = savedAccounts.find(a => a.id === id || a.username === id);
      if (account) {
        setCurrentAccount(account);
      }
    } catch (e) {
      console.error("Failed to load account settings:", e);
    }
  };

  const handleSend = async (email: OutgoingEmail) => {
    if (!accountId) return;
    setLoading(true);
    try {
      await invoke("send_email", { accountId, email });
      playSentSound();
      // Close the window after successful send
      const window = getCurrentWebviewWindow();
      await window.close();
    } catch (e) {
      playErrorSound();
      throw e;
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    const window = getCurrentWebviewWindow();
    await window.close();
  };

  if (!currentAccount) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-100">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-white">
      <Composer
        replyTo={replyTo}
        onSend={handleSend}
        onCancel={handleCancel}
        loading={loading}
        currentAccount={currentAccount}
      />
    </div>
  );
}

export default ComposerWindow;
