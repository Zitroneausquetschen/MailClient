import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { EmailCategory } from "../types/mail";

interface Props {
  accountId: string | null;
  selectedCategory: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  onManageCategories: () => void;
}

function CategoryTabs({ accountId, selectedCategory, onSelectCategory, onManageCategories }: Props) {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<EmailCategory[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadCategories = async () => {
      if (!accountId) return;

      setLoading(true);
      try {
        const cats = await invoke<EmailCategory[]>("get_categories", { accountId });
        setCategories(cats.sort((a, b) => a.sortOrder - b.sortOrder));
      } catch (e) {
        console.error("Failed to load categories:", e);
      } finally {
        setLoading(false);
      }
    };

    loadCategories();
  }, [accountId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-gray-50">
        <div className="animate-pulse flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-7 w-20 bg-gray-200 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b bg-gray-50 overflow-x-auto">
      {/* "All" tab */}
      <button
        onClick={() => onSelectCategory(null)}
        className={`px-3 py-1.5 text-sm rounded-lg transition-colors whitespace-nowrap ${
          selectedCategory === null
            ? "bg-blue-600 text-white"
            : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
        }`}
      >
        {t("categories.all", "All")}
      </button>

      {/* Category tabs */}
      {categories.map((category) => (
        <button
          key={category.id}
          onClick={() => onSelectCategory(category.id)}
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 ${
            selectedCategory === category.id
              ? "text-white"
              : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
          }`}
          style={{
            backgroundColor: selectedCategory === category.id ? category.color : undefined,
          }}
        >
          {category.icon && <span>{category.icon}</span>}
          {category.name}
        </button>
      ))}

      {/* Manage categories button */}
      <button
        onClick={onManageCategories}
        className="px-2 py-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
        title={t("categories.manage", "Manage categories")}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
      </button>
    </div>
  );
}

export default CategoryTabs;
