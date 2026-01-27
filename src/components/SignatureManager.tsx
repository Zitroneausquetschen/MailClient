import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmailSignature } from "../types/mail";
import RichTextEditor from "./RichTextEditor";

interface Props {
  signatures: EmailSignature[];
  onChange: (signatures: EmailSignature[]) => void;
}

function SignatureManager({ signatures, onChange }: Props) {
  const { t } = useTranslation();
  const [editingSignature, setEditingSignature] = useState<EmailSignature | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const generateId = () => {
    return `sig-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const handleAdd = () => {
    setEditingSignature({
      id: generateId(),
      name: "",
      content: "",
      isDefault: signatures.length === 0, // First signature is default
    });
    setShowEditor(true);
  };

  const handleEdit = (signature: EmailSignature) => {
    setEditingSignature({ ...signature });
    setShowEditor(true);
  };

  const handleDelete = (id: string) => {
    const wasDefault = signatures.find(s => s.id === id)?.isDefault;
    const newSignatures = signatures.filter(s => s.id !== id);

    // If deleted signature was default, make first remaining one default
    if (wasDefault && newSignatures.length > 0) {
      newSignatures[0].isDefault = true;
    }

    onChange(newSignatures);
  };

  const handleSetDefault = (id: string) => {
    const newSignatures = signatures.map(s => ({
      ...s,
      isDefault: s.id === id,
    }));
    onChange(newSignatures);
  };

  const handleSave = () => {
    if (!editingSignature || !editingSignature.name.trim()) {
      return;
    }

    const existingIndex = signatures.findIndex(s => s.id === editingSignature.id);

    if (existingIndex >= 0) {
      // Update existing
      const newSignatures = [...signatures];
      newSignatures[existingIndex] = editingSignature;

      // If this is set as default, remove default from others
      if (editingSignature.isDefault) {
        newSignatures.forEach((s, i) => {
          if (i !== existingIndex) s.isDefault = false;
        });
      }

      onChange(newSignatures);
    } else {
      // Add new
      let newSignatures = [...signatures, editingSignature];

      // If this is set as default, remove default from others
      if (editingSignature.isDefault) {
        newSignatures = newSignatures.map(s =>
          s.id === editingSignature.id ? s : { ...s, isDefault: false }
        );
      }

      onChange(newSignatures);
    }

    setEditingSignature(null);
    setShowEditor(false);
  };

  const handleCancel = () => {
    setEditingSignature(null);
    setShowEditor(false);
  };

  const handleEditorChange = (html: string, _text: string) => {
    if (editingSignature) {
      setEditingSignature({ ...editingSignature, content: html });
    }
  };

  if (showEditor && editingSignature) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-gray-700">
            {signatures.find(s => s.id === editingSignature.id) ? t("signatures.edit") : t("signatures.add")}
          </h4>
          <button
            onClick={handleCancel}
            className="text-gray-500 hover:text-gray-700"
          >
            {t("common.back")}
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("signatures.name")}
          </label>
          <input
            type="text"
            value={editingSignature.name}
            onChange={(e) => setEditingSignature({ ...editingSignature, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t("signatures.namePlaceholder", "e.g. Business, Personal...")}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t("signatures.content")}
          </label>
          <RichTextEditor
            content={editingSignature.content}
            onChange={handleEditorChange}
            placeholder={t("signatures.contentPlaceholder", "Enter your signature...")}
            minHeight="150px"
          />
        </div>

        <div className="flex items-center">
          <input
            type="checkbox"
            id="isDefault"
            checked={editingSignature.isDefault}
            onChange={(e) => setEditingSignature({ ...editingSignature, isDefault: e.target.checked })}
            className="mr-2"
          />
          <label htmlFor="isDefault" className="text-sm text-gray-700">
            {t("signatures.setDefault")}
          </label>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={!editingSignature.name.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {t("common.save")}
          </button>
          <button
            onClick={handleCancel}
            className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-gray-700">{t("signatures.title")}</h4>
        <button
          onClick={handleAdd}
          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
        >
          + {t("signatures.add")}
        </button>
      </div>

      {signatures.length === 0 ? (
        <p className="text-gray-500 text-sm">
          {t("signatures.noSignatures", "No signatures yet. Click \"Add signature\" to create one.")}
        </p>
      ) : (
        <div className="space-y-2">
          {signatures.map((sig) => (
            <div
              key={sig.id}
              className="flex items-center justify-between p-3 bg-gray-50 rounded border border-gray-200"
            >
              <div className="flex items-center gap-3">
                <div>
                  <div className="font-medium text-gray-800">
                    {sig.name}
                    {sig.isDefault && (
                      <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                        {t("signatures.default")}
                      </span>
                    )}
                  </div>
                  <div
                    className="text-sm text-gray-500 truncate max-w-md"
                    dangerouslySetInnerHTML={{
                      __html: sig.content.replace(/<[^>]+>/g, " ").substring(0, 60) + (sig.content.length > 60 ? "..." : ""),
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!sig.isDefault && (
                  <button
                    onClick={() => handleSetDefault(sig.id)}
                    className="text-sm text-blue-600 hover:text-blue-800"
                    title={t("signatures.setDefault")}
                  >
                    {t("signatures.default")}
                  </button>
                )}
                <button
                  onClick={() => handleEdit(sig)}
                  className="text-sm text-gray-600 hover:text-gray-800"
                >
                  {t("signatures.edit")}
                </button>
                <button
                  onClick={() => handleDelete(sig.id)}
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  {t("signatures.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default SignatureManager;
