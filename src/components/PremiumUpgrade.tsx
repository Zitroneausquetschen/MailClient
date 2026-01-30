import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { SUBSCRIPTION_PLANS, type SubscriptionPlan, type CloudUser } from "../types/cloud";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  user: CloudUser | null;
  onLoginClick: () => void;
}

export default function PremiumUpgrade({ isOpen, onClose, user, onLoginClick }: Props) {
  const { t } = useTranslation();
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>("yearly");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpgrade = async () => {
    if (!user) {
      onLoginClick();
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const checkoutUrl = await invoke<string>("cloud_get_checkout_url", {
        plan: selectedPlan,
      });

      // Open checkout in browser
      await openUrl(checkoutUrl);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-8 text-white text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            <h2 className="text-2xl font-bold">
              {t("cloud.upgradeTitle", "Upgrade to Premium")}
            </h2>
          </div>
          <p className="text-white/90">
            {t("cloud.upgradeSubtitle", "Unlock the full potential of MailClient")}
          </p>
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/80 hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Plans */}
        <div className="p-6">
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            {SUBSCRIPTION_PLANS.map((plan) => (
              <div
                key={plan.id}
                onClick={() => setSelectedPlan(plan.id)}
                className={`relative cursor-pointer rounded-xl border-2 p-4 transition-all ${
                  selectedPlan === plan.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded-full">
                    {t("cloud.popular", "Popular")}
                  </div>
                )}

                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-2xl font-bold text-gray-800">{plan.price}</span>
                  <span className="text-gray-500">{plan.period}</span>
                </div>

                <h3 className="font-semibold text-gray-800 mb-3">{plan.name}</h3>

                <ul className="space-y-2">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                      <svg className="w-5 h-5 text-green-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* Selection indicator */}
                <div className={`absolute top-4 right-4 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                  selectedPlan === plan.id
                    ? "border-blue-500 bg-blue-500"
                    : "border-gray-300"
                }`}>
                  {selectedPlan === plan.id && (
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Comparison with free */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h4 className="font-medium text-gray-700 mb-3">
              {t("cloud.freeVsPremium", "Free vs Premium")}
            </h4>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div className="font-medium text-gray-600">{t("cloud.feature", "Feature")}</div>
              <div className="text-center text-gray-500">Free</div>
              <div className="text-center text-amber-600 font-medium">Premium</div>

              <div className="text-gray-600">{t("cloud.mailAccounts", "Email Accounts")}</div>
              <div className="text-center text-gray-500">1</div>
              <div className="text-center text-amber-600">{t("cloud.unlimited", "Unlimited")}</div>

              <div className="text-gray-600">{t("cloud.cloudSync", "Cloud Sync")}</div>
              <div className="text-center text-gray-400">-</div>
              <div className="text-center text-green-600">
                <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <div className="text-gray-600">{t("cloud.multiDevice", "Multi-Device")}</div>
              <div className="text-center text-gray-400">-</div>
              <div className="text-center text-green-600">
                <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <div className="text-gray-600">{t("cloud.localAI", "AI Features")}</div>
              <div className="text-center text-green-600">
                <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div className="text-center text-green-600">
                <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
            >
              {t("common.cancel", "Cancel")}
            </button>
            <button
              onClick={handleUpgrade}
              disabled={isLoading}
              className="flex-1 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg hover:from-amber-600 hover:to-orange-600 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {t("common.loading", "Loading...")}
                </>
              ) : !user ? (
                t("cloud.loginToUpgrade", "Login to Upgrade")
              ) : (
                t("cloud.continueToCheckout", "Continue to Checkout")
              )}
            </button>
          </div>

          {/* Secure checkout note */}
          <p className="text-center text-xs text-gray-500 mt-4">
            {t("cloud.secureCheckout", "Secure checkout via Stripe. Cancel anytime.")}
          </p>
        </div>
      </div>
    </div>
  );
}
