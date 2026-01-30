import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { EmailCategory } from "../types/mail";

interface Props {
  accountId: string;
  isOpen: boolean;
  onClose: () => void;
  onCategoriesChanged: () => void;
}

const PRESET_COLORS = [
  "#3B82F6", // Blue
  "#10B981", // Green
  "#8B5CF6", // Purple
  "#F59E0B", // Amber
  "#EC4899", // Pink
  "#6366F1", // Indigo
  "#059669", // Emerald
  "#0EA5E9", // Sky
  "#EF4444", // Red
  "#84CC16", // Lime
];

const PRESET_ICONS = [
  "💼", "👤", "📰", "🏷️", "💬", "🔔", "💰", "✈️",
  "📧", "⭐", "🎯", "📁", "🏠", "🎓", "🛒", "🔧",
];

function CategoryManager({ accountId, isOpen, onClose, onCategoriesChanged }: Props) {
  const { t } = useTranslation();
  const [categories, setCategories] = useState<EmailCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit/Create state
  const [editingCategory, setEditingCategory] = useState<EmailCategory | null>(null);
  const [newCategory, setNewCategory] = useState({
    name: "",
    color: PRESET_COLORS[0],
    icon: "",
  });
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadCategories();
    }
  }, [isOpen, accountId]);

  const loadCategories = async () => {
    setLoading(true);
    setError(null);
    try {
      const cats = await invoke<EmailCategory[]>("get_categories", { accountId });
      setCategories(cats.sort((a, b) => a.sortOrder - b.sortOrder));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCategory = async () => {
    if (!newCategory.name.trim()) return;

    try {
      await invoke("create_category", {
        accountId,
        name: newCategory.name.trim(),
        color: newCategory.color,
        icon: newCategory.icon || null,
      });
      setNewCategory({ name: "", color: PRESET_COLORS[0], icon: "" });
      setShowCreateForm(false);
      await loadCategories();
      onCategoriesChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory || !editingCategory.name.trim()) return;

    try {
      await invoke("update_category", {
        accountId,
        id: editingCategory.id,
        name: editingCategory.name.trim(),
        color: editingCategory.color,
        icon: editingCategory.icon || null,
      });
      setEditingCategory(null);
      await loadCategories();
      onCategoriesChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDeleteCategory = async (id: string) => {
    if (!confirm(t("categories.confirmDelete", "Are you sure you want to delete this category?"))) {
      return;
    }

    try {
      await invoke("delete_category", { accountId, id });
      await loadCategories();
      onCategoriesChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t("categories.manage", "Manage Categories")}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Category List */}
              {categories.map((category) => (
                <div key={category.id} className="border rounded-lg p-3">
                  {editingCategory?.id === category.id ? (
                    /* Edit Form */
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={editingCategory.name}
                        onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder={t("categories.name", "Category name")}
                      />

                      {/* Color picker */}
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">{t("categories.color", "Color")}</label>
                        <div className="flex flex-wrap gap-2">
                          {PRESET_COLORS.map((color) => (
                            <button
                              key={color}
                              onClick={() => setEditingCategory({ ...editingCategory, color })}
                              className={`w-7 h-7 rounded-full border-2 ${
                                editingCategory.color === color ? "border-gray-800" : "border-transparent"
                              }`}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                      </div>

                      {/* Icon picker */}
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">{t("categories.icon", "Icon")}</label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => setEditingCategory({ ...editingCategory, icon: undefined })}
                            className={`w-8 h-8 rounded border ${
                              !editingCategory.icon ? "border-blue-500 bg-blue-50" : "border-gray-200"
                            } flex items-center justify-center text-gray-400`}
                          >
                            -
                          </button>
                          {PRESET_ICONS.map((icon) => (
                            <button
                              key={icon}
                              onClick={() => setEditingCategory({ ...editingCategory, icon })}
                              className={`w-8 h-8 rounded border ${
                                editingCategory.icon === icon ? "border-blue-500 bg-blue-50" : "border-gray-200"
                              } flex items-center justify-center`}
                            >
                              {icon}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => setEditingCategory(null)}
                          className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
                        >
                          {t("common.cancel", "Cancel")}
                        </button>
                        <button
                          onClick={handleUpdateCategory}
                          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                          {t("common.save", "Save")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Display Mode */
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm"
                          style={{ backgroundColor: category.color }}
                        >
                          {category.icon || category.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium">{category.name}</div>
                          {category.isSystem && (
                            <div className="text-xs text-gray-500">{t("categories.system", "System")}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditingCategory(category)}
                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                          title={t("common.edit", "Edit")}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        {!category.isSystem && (
                          <button
                            onClick={() => handleDeleteCategory(category.id)}
                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                            title={t("common.delete", "Delete")}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Create New Category Form */}
              {showCreateForm ? (
                <div className="border rounded-lg p-4 bg-gray-50 space-y-3">
                  <h3 className="font-medium">{t("categories.createNew", "Create New Category")}</h3>

                  <input
                    type="text"
                    value={newCategory.name}
                    onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={t("categories.name", "Category name")}
                    autoFocus
                  />

                  {/* Color picker */}
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">{t("categories.color", "Color")}</label>
                    <div className="flex flex-wrap gap-2">
                      {PRESET_COLORS.map((color) => (
                        <button
                          key={color}
                          onClick={() => setNewCategory({ ...newCategory, color })}
                          className={`w-7 h-7 rounded-full border-2 ${
                            newCategory.color === color ? "border-gray-800" : "border-transparent"
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Icon picker */}
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">{t("categories.icon", "Icon")}</label>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => setNewCategory({ ...newCategory, icon: "" })}
                        className={`w-8 h-8 rounded border ${
                          !newCategory.icon ? "border-blue-500 bg-blue-50" : "border-gray-200"
                        } flex items-center justify-center text-gray-400`}
                      >
                        -
                      </button>
                      {PRESET_ICONS.map((icon) => (
                        <button
                          key={icon}
                          onClick={() => setNewCategory({ ...newCategory, icon })}
                          className={`w-8 h-8 rounded border ${
                            newCategory.icon === icon ? "border-blue-500 bg-blue-50" : "border-gray-200"
                          } flex items-center justify-center`}
                        >
                          {icon}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setShowCreateForm(false);
                        setNewCategory({ name: "", color: PRESET_COLORS[0], icon: "" });
                      }}
                      className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
                    >
                      {t("common.cancel", "Cancel")}
                    </button>
                    <button
                      onClick={handleCreateCategory}
                      disabled={!newCategory.name.trim()}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-blue-300"
                    >
                      {t("common.create", "Create")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowCreateForm(true)}
                  className="w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-blue-500 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  {t("categories.addNew", "Add New Category")}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            {t("common.close", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CategoryManager;
