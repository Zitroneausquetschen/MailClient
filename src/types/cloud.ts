// Cloud sync types for premium features

export interface CloudUser {
  id: number;
  email: string;
  name: string | null;
  is_premium: boolean;
  premium_until: string | null;
  created_at: string;
}

export interface AuthResponse {
  success: boolean;
  token: string | null;
  user: CloudUser | null;
  error: string | null;
}

export interface SyncStatus {
  last_sync: string | null;
  device_count: number;
  is_syncing: boolean;
}

export interface SyncResult {
  success: boolean;
  server_timestamp: string | null;
  conflicts: SyncConflict[];
  error: string | null;
}

export interface SyncConflict {
  data_type: string;
  local_timestamp: string;
  server_timestamp: string;
  resolution: string;
}

export interface SubscriptionInfo {
  is_premium: boolean;
  plan: string | null;
  premium_until: string | null;
  cancel_at_period_end: boolean;
}

export interface SyncData {
  accounts: unknown | null;
  ai_config: unknown | null;
  categories: unknown | null;
  client_timestamp: string | null;
  last_modified: string | null;
}

// Auth state for React context
export interface CloudAuthState {
  user: CloudUser | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  isPremium: boolean;
  error: string | null;
}

// Subscription plans
export type SubscriptionPlan = "monthly" | "yearly";

export interface PlanInfo {
  id: SubscriptionPlan;
  name: string;
  price: string;
  period: string;
  features: string[];
  popular?: boolean;
}

export const SUBSCRIPTION_PLANS: PlanInfo[] = [
  {
    id: "monthly",
    name: "Premium Monatlich",
    price: "4,99 €",
    period: "/Monat",
    features: [
      "Unbegrenzte Postfächer",
      "Cloud-Sync über alle Geräte",
      "Multi-Device Support",
      "Prioritäts-Support",
    ],
  },
  {
    id: "yearly",
    name: "Premium Jährlich",
    price: "49,99 €",
    period: "/Jahr",
    features: [
      "Unbegrenzte Postfächer",
      "Cloud-Sync über alle Geräte",
      "Multi-Device Support",
      "Prioritäts-Support",
      "2 Monate gratis",
    ],
    popular: true,
  },
];

// Free tier limits
export const FREE_TIER_LIMITS = {
  maxAccounts: 1,
  cloudSync: false,
  multiDevice: false,
};
