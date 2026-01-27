import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Contact, ContactEmail, ContactPhone, SavedAccount } from "../types/mail";

interface Props {
  currentAccount: SavedAccount | null;
  onClose: () => void;
}

function ContactsView({ currentAccount, onClose }: Props) {
  const { t } = useTranslation();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState<{
    firstName: string;
    lastName: string;
    emails: ContactEmail[];
    phones: ContactPhone[];
    organization: string;
  }>({
    firstName: "",
    lastName: "",
    emails: [{ email: "", label: "work" }],
    phones: [],
    organization: "",
  });

  useEffect(() => {
    if (currentAccount) {
      loadContacts();
    }
  }, [currentAccount?.id]);

  const loadContacts = async () => {
    if (!currentAccount) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<Contact[]>("fetch_contacts", {
        host: currentAccount.imap_host,
        username: currentAccount.username,
        password: currentAccount.password || "",
      });
      setContacts(result);
    } catch (e) {
      setError(`${t("errors.loadFailed")}: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const filteredContacts = contacts.filter((contact) => {
    const query = searchQuery.toLowerCase();
    return (
      contact.displayName.toLowerCase().includes(query) ||
      contact.firstName.toLowerCase().includes(query) ||
      contact.lastName.toLowerCase().includes(query) ||
      contact.emails.some((e) => e.email.toLowerCase().includes(query)) ||
      (contact.organization?.toLowerCase().includes(query) ?? false)
    );
  });

  const handleSelectContact = (contact: Contact) => {
    setSelectedContact(contact);
    setIsEditing(false);
    setIsCreating(false);
  };

  const handleNewContact = () => {
    setSelectedContact(null);
    setIsEditing(false);
    setIsCreating(true);
    setFormData({
      firstName: "",
      lastName: "",
      emails: [{ email: "", label: "work" }],
      phones: [],
      organization: "",
    });
  };

  const handleEditContact = () => {
    if (!selectedContact) return;
    setIsEditing(true);
    setIsCreating(false);
    setFormData({
      firstName: selectedContact.firstName,
      lastName: selectedContact.lastName,
      emails: selectedContact.emails.length > 0
        ? [...selectedContact.emails]
        : [{ email: "", label: "work" }],
      phones: [...selectedContact.phones],
      organization: selectedContact.organization || "",
    });
  };

  const handleSave = async () => {
    if (!currentAccount) return;

    // Validate
    const validEmails = formData.emails.filter(e => e.email.trim() !== "");
    if (validEmails.length === 0) {
      setError(t("contacts.emailRequired"));
      return;
    }

    setSaving(true);
    setError(null);

    const displayName = `${formData.firstName} ${formData.lastName}`.trim() || validEmails[0].email;

    const contact: Contact = {
      id: isCreating ? crypto.randomUUID() : selectedContact!.id,
      displayName,
      firstName: formData.firstName,
      lastName: formData.lastName,
      emails: validEmails,
      phones: formData.phones.filter(p => p.number.trim() !== ""),
      organization: formData.organization || null,
      photoUrl: null,
    };

    try {
      if (isCreating) {
        await invoke("create_contact", {
          host: currentAccount.imap_host,
          username: currentAccount.username,
          password: currentAccount.password || "",
          contact,
        });
      } else {
        await invoke("update_contact", {
          host: currentAccount.imap_host,
          username: currentAccount.username,
          password: currentAccount.password || "",
          contact,
        });
      }
      await loadContacts();
      setSelectedContact(contact);
      setIsEditing(false);
      setIsCreating(false);
    } catch (e) {
      setError(`${t("errors.saveFailed")}: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!currentAccount || !selectedContact) return;

    if (!confirm(t("contacts.confirmDelete"))) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await invoke("delete_contact", {
        host: currentAccount.imap_host,
        username: currentAccount.username,
        password: currentAccount.password || "",
        contactId: selectedContact.id,
      });
      await loadContacts();
      setSelectedContact(null);
    } catch (e) {
      setError(`${t("errors.deleteFailed")}: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const addEmail = () => {
    setFormData({
      ...formData,
      emails: [...formData.emails, { email: "", label: "work" }],
    });
  };

  const removeEmail = (index: number) => {
    setFormData({
      ...formData,
      emails: formData.emails.filter((_, i) => i !== index),
    });
  };

  const updateEmail = (index: number, field: "email" | "label", value: string) => {
    const newEmails = [...formData.emails];
    newEmails[index] = { ...newEmails[index], [field]: value };
    setFormData({ ...formData, emails: newEmails });
  };

  const addPhone = () => {
    setFormData({
      ...formData,
      phones: [...formData.phones, { number: "", label: "work" }],
    });
  };

  const removePhone = (index: number) => {
    setFormData({
      ...formData,
      phones: formData.phones.filter((_, i) => i !== index),
    });
  };

  const updatePhone = (index: number, field: "number" | "label", value: string) => {
    const newPhones = [...formData.phones];
    newPhones[index] = { ...newPhones[index], [field]: value };
    setFormData({ ...formData, phones: newPhones });
  };

  const renderContactList = () => (
    <div className="w-80 border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center gap-2 mb-3">
          <input
            type="text"
            placeholder={t("contacts.search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={handleNewContact}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700"
        >
          + {t("contacts.add")}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-gray-500">{t("common.loading")}</div>
        ) : filteredContacts.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            {searchQuery ? t("search.noResults") : t("contacts.noContacts")}
          </div>
        ) : (
          filteredContacts.map((contact) => (
            <div
              key={contact.id}
              onClick={() => handleSelectContact(contact)}
              className={`p-3 border-b border-gray-100 cursor-pointer hover:bg-gray-50 ${
                selectedContact?.id === contact.id ? "bg-blue-50" : ""
              }`}
            >
              <div className="font-medium text-gray-800">{contact.displayName}</div>
              {contact.emails[0] && (
                <div className="text-sm text-gray-500">{contact.emails[0].email}</div>
              )}
              {contact.organization && (
                <div className="text-xs text-gray-400">{contact.organization}</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderContactDetails = () => {
    if (isCreating || isEditing) {
      return renderContactForm();
    }

    if (!selectedContact) {
      return (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          {t("contacts.selectOrCreate")}
        </div>
      );
    }

    return (
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-semibold text-gray-800">
              {selectedContact.displayName}
            </h2>
            {selectedContact.organization && (
              <p className="text-gray-500">{selectedContact.organization}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleEditContact}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              {t("common.edit")}
            </button>
            <button
              onClick={handleDelete}
              disabled={saving}
              className="px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
            >
              {t("common.delete")}
            </button>
          </div>
        </div>

        <div className="space-y-6">
          {selectedContact.emails.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">{t("contacts.email")}</h3>
              {selectedContact.emails.map((email, i) => (
                <div key={i} className="flex items-center gap-2 mb-1">
                  <a
                    href={`mailto:${email.email}`}
                    className="text-blue-600 hover:underline"
                  >
                    {email.email}
                  </a>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                    {email.label}
                  </span>
                </div>
              ))}
            </div>
          )}

          {selectedContact.phones.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-500 mb-2">{t("contacts.phone")}</h3>
              {selectedContact.phones.map((phone, i) => (
                <div key={i} className="flex items-center gap-2 mb-1">
                  <span className="text-gray-800">{phone.number}</span>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                    {phone.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderContactForm = () => (
    <div className="flex-1 p-6 overflow-y-auto">
      <h2 className="text-xl font-semibold text-gray-800 mb-6">
        {isCreating ? t("contacts.add") : t("contacts.edit")}
      </h2>

      <div className="space-y-4 max-w-lg">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              {t("contacts.firstName")}
            </label>
            <input
              type="text"
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              {t("contacts.lastName")}
            </label>
            <input
              type="text"
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">
            {t("contacts.company")}
          </label>
          <input
            type="text"
            value={formData.organization}
            onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">
            {t("contacts.email")}
          </label>
          {formData.emails.map((email, index) => (
            <div key={index} className="flex gap-2 mb-2">
              <input
                type="email"
                value={email.email}
                onChange={(e) => updateEmail(index, "email", e.target.value)}
                placeholder="email@example.com"
                className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={email.label}
                onChange={(e) => updateEmail(index, "label", e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="work">{t("contacts.work")}</option>
                <option value="home">{t("contacts.home")}</option>
                <option value="other">{t("contacts.other")}</option>
              </select>
              {formData.emails.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeEmail(index)}
                  className="px-3 py-2 text-red-600 hover:bg-red-50 rounded"
                >
                  X
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addEmail}
            className="text-sm text-blue-600 hover:underline"
          >
            + {t("contacts.addEmail")}
          </button>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">
            {t("contacts.phone")}
          </label>
          {formData.phones.map((phone, index) => (
            <div key={index} className="flex gap-2 mb-2">
              <input
                type="tel"
                value={phone.number}
                onChange={(e) => updatePhone(index, "number", e.target.value)}
                placeholder="+49 123 456789"
                className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={phone.label}
                onChange={(e) => updatePhone(index, "label", e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="work">{t("contacts.work")}</option>
                <option value="home">{t("contacts.home")}</option>
                <option value="mobile">{t("contacts.mobile")}</option>
                <option value="other">{t("contacts.other")}</option>
              </select>
              <button
                type="button"
                onClick={() => removePhone(index)}
                className="px-3 py-2 text-red-600 hover:bg-red-50 rounded"
              >
                X
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addPhone}
            className="text-sm text-blue-600 hover:underline"
          >
            + {t("contacts.addPhone")}
          </button>
        </div>

        <div className="flex gap-3 pt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:bg-blue-400"
          >
            {saving ? t("contacts.saving") : t("common.save")}
          </button>
          <button
            onClick={() => {
              setIsEditing(false);
              setIsCreating(false);
            }}
            className="px-6 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-semibold text-gray-800">{t("contacts.title")}</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">
            {contacts.length} {t("contacts.title")}
          </span>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            {t("common.close")}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border-b border-red-300 text-red-700 px-4 py-3">
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {renderContactList()}
        {renderContactDetails()}
      </div>
    </div>
  );
}

export default ContactsView;
