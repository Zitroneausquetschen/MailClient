import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { AuthResponse, CloudUser } from "../types/cloud";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: CloudUser) => void;
}

type Mode = "login" | "register";

export default function LoginDialog({ isOpen, onClose, onLoginSuccess }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "register" && password !== confirmPassword) {
      setError(t("cloud.passwordMismatch", "Passwords do not match"));
      return;
    }

    if (password.length < 8) {
      setError(t("cloud.passwordTooShort", "Password must be at least 8 characters"));
      return;
    }

    setIsLoading(true);

    try {
      let response: AuthResponse;

      if (mode === "login") {
        response = await invoke<AuthResponse>("cloud_login", { email, password });
      } else {
        response = await invoke<AuthResponse>("cloud_register", {
          email,
          password,
          name: name || email.split("@")[0],
        });
      }

      if (response.success && response.user) {
        onLoginSuccess(response.user);
        onClose();
        // Reset form
        setEmail("");
        setPassword("");
        setConfirmPassword("");
        setName("");
      } else {
        setError(response.error || t("cloud.loginFailed", "Login failed"));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === "login" ? "register" : "login");
    setError(null);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-xl font-semibold text-gray-800">
            {mode === "login"
              ? t("cloud.login", "Login")
              : t("cloud.register", "Create Account")}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {mode === "register" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("cloud.name", "Name")}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder={t("cloud.namePlaceholder", "Your name")}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("cloud.email", "Email")}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="email@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t("cloud.password", "Password")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="********"
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("cloud.confirmPassword", "Confirm Password")}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="********"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {t("common.loading", "Loading...")}
              </span>
            ) : mode === "login" ? (
              t("cloud.loginButton", "Login")
            ) : (
              t("cloud.registerButton", "Create Account")
            )}
          </button>

          <div className="text-center text-sm text-gray-600">
            {mode === "login" ? (
              <>
                {t("cloud.noAccount", "Don't have an account?")}{" "}
                <button
                  type="button"
                  onClick={switchMode}
                  className="text-blue-600 hover:underline"
                >
                  {t("cloud.registerLink", "Create one")}
                </button>
              </>
            ) : (
              <>
                {t("cloud.hasAccount", "Already have an account?")}{" "}
                <button
                  type="button"
                  onClick={switchMode}
                  className="text-blue-600 hover:underline"
                >
                  {t("cloud.loginLink", "Login")}
                </button>
              </>
            )}
          </div>
        </form>

        {/* Info */}
        <div className="px-6 pb-6">
          <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
            <p className="font-medium mb-1">{t("cloud.whyLogin", "Why login?")}</p>
            <ul className="list-disc list-inside space-y-1 text-gray-500">
              <li>{t("cloud.benefit1", "Sync settings across devices")}</li>
              <li>{t("cloud.benefit2", "Unlimited email accounts (Premium)")}</li>
              <li>{t("cloud.benefit3", "Backup your configuration")}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
