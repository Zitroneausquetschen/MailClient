import { useTranslation } from "react-i18next";
import { ConnectedAccount } from "../types/mail";

interface Props {
  accounts: ConnectedAccount[];
  activeAccountId: string | null;
  onSelectAccount: (accountId: string) => void;
  onAddAccount: () => void;
  onRemoveAccount: (accountId: string) => void;
}

function AccountSidebar({
  accounts,
  activeAccountId,
  onSelectAccount,
  onAddAccount,
  onRemoveAccount,
}: Props) {
  const { t } = useTranslation();
  // Get initials from display name or email
  const getInitials = (account: ConnectedAccount) => {
    if (account.displayName) {
      return account.displayName
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
    }
    return account.email[0].toUpperCase();
  };

  // Generate a color based on the account ID
  const getColor = (id: string) => {
    const colors = [
      "bg-blue-500",
      "bg-green-500",
      "bg-purple-500",
      "bg-orange-500",
      "bg-pink-500",
      "bg-teal-500",
      "bg-indigo-500",
      "bg-red-500",
    ];
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  return (
    <div className="w-16 bg-gray-800 flex flex-col items-center py-4 gap-2">
      {/* Account avatars */}
      {accounts.map((account) => (
        <div key={account.id} className="relative group">
          <button
            onClick={() => onSelectAccount(account.id)}
            className={`w-10 h-10 rounded-full ${getColor(account.id)} text-white font-semibold text-sm flex items-center justify-center transition-all ${
              activeAccountId === account.id
                ? "ring-2 ring-white ring-offset-2 ring-offset-gray-800"
                : "hover:opacity-80"
            }`}
            title={`${account.displayName} (${account.email})`}
          >
            {getInitials(account)}
          </button>

          {/* Remove button on hover */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemoveAccount(account.id);
            }}
            className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs hidden group-hover:flex items-center justify-center hover:bg-red-600"
            title={t("accounts.remove")}
          >
            &times;
          </button>

          {/* Tooltip */}
          <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
            {account.displayName}
            <br />
            <span className="text-gray-400">{account.email}</span>
          </div>
        </div>
      ))}

      {/* Add account button */}
      <button
        onClick={onAddAccount}
        className="w-10 h-10 rounded-full border-2 border-dashed border-gray-500 text-gray-500 hover:border-gray-400 hover:text-gray-400 flex items-center justify-center transition-colors mt-2"
        title={t("accounts.add")}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  );
}

export default AccountSidebar;
