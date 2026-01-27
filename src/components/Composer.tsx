import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Email, OutgoingEmail, OutgoingAttachment, Contact, SavedAccount } from "../types/mail";
import RichTextEditor from "./RichTextEditor";

interface AttachmentFile {
  file: File;
  name: string;
  size: number;
  type: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix (e.g., "data:image/png;base64,")
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface Props {
  replyTo: Email | null;
  onSend: (email: OutgoingEmail) => Promise<void>;
  onCancel: () => void;
  loading: boolean;
  currentAccount: SavedAccount | null;
}

function extractEmail(from: string): string {
  const match = from.match(/<(.+)>/);
  return match ? match[1] : from;
}

interface AutocompleteInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  contacts: Contact[];
  placeholder?: string;
  required?: boolean;
}

function AutocompleteInput({
  label,
  value,
  onChange,
  contacts,
  placeholder,
  required,
}: AutocompleteInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<{ contact: Contact; email: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Get the current email being typed (after last comma/semicolon)
  const getCurrentInput = (): string => {
    const parts = value.split(/[,;]/);
    return parts[parts.length - 1].trim();
  };

  // Replace the current input with the selected suggestion
  const selectSuggestion = (email: string, displayName: string) => {
    const parts = value.split(/[,;]/);
    parts.pop(); // Remove the partial input
    const formatted = displayName ? `${displayName} <${email}>` : email;
    const newValue = parts.length > 0
      ? parts.map(p => p.trim()).filter(Boolean).join(", ") + ", " + formatted
      : formatted;
    onChange(newValue + ", ");
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  // Update suggestions based on input
  useEffect(() => {
    const currentInput = getCurrentInput().toLowerCase();
    if (currentInput.length < 1) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const matched: { contact: Contact; email: string }[] = [];
    for (const contact of contacts) {
      for (const emailObj of contact.emails) {
        if (
          emailObj.email.toLowerCase().includes(currentInput) ||
          contact.displayName.toLowerCase().includes(currentInput) ||
          contact.firstName.toLowerCase().includes(currentInput) ||
          contact.lastName.toLowerCase().includes(currentInput)
        ) {
          matched.push({ contact, email: emailObj.email });
        }
      }
    }
    setSuggestions(matched.slice(0, 8)); // Max 8 suggestions
    setShowSuggestions(matched.length > 0);
  }, [value, contacts]);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="flex items-center relative">
      <label className="w-16 text-sm text-gray-600">{label}:</label>
      <div className="flex-1 relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (suggestions.length > 0) setShowSuggestions(true);
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={placeholder}
          required={required}
        />
        {showSuggestions && suggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-y-auto"
          >
            {suggestions.map(({ contact, email }, index) => (
              <div
                key={`${contact.id}-${email}-${index}`}
                className="px-4 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-0"
                onClick={() => selectSuggestion(email, contact.displayName)}
              >
                <div className="font-medium text-gray-800">{contact.displayName}</div>
                <div className="text-sm text-gray-500">{email}</div>
                {contact.organization && (
                  <div className="text-xs text-gray-400">{contact.organization}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Composer({ replyTo, onSend, onCancel, loading, currentAccount }: Props) {
  const { t } = useTranslation();
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [selectedSignatureId, setSelectedSignatureId] = useState<string | null>(null);
  const [signatureApplied, setSignatureApplied] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get signatures from current account
  const signatures = currentAccount?.signatures || [];
  const defaultSignature = signatures.find(s => s.isDefault);

  // Fetch contacts when component mounts or account changes
  useEffect(() => {
    if (currentAccount) {
      fetchContacts();
    }
  }, [currentAccount?.id]);

  // Apply default signature on mount
  useEffect(() => {
    if (defaultSignature && !signatureApplied && !replyTo) {
      setSelectedSignatureId(defaultSignature.id);
      const signatureHtml = `<p></p><br/><div class="email-signature">${defaultSignature.content}</div>`;
      setBodyHtml(signatureHtml);
      setSignatureApplied(true);
    }
  }, [defaultSignature, signatureApplied, replyTo]);

  const fetchContacts = async () => {
    if (!currentAccount) return;

    setLoadingContacts(true);
    try {
      const host = currentAccount.imap_host;
      const result = await invoke<Contact[]>("fetch_contacts", {
        host,
        username: currentAccount.username,
        password: currentAccount.password || "",
      });
      setContacts(result);
    } catch (e) {
      console.error("Failed to fetch contacts:", e);
    } finally {
      setLoadingContacts(false);
    }
  };

  useEffect(() => {
    if (replyTo) {
      setTo(extractEmail(replyTo.from));
      setSubject(
        replyTo.subject.startsWith("Re:") ? replyTo.subject : `Re: ${replyTo.subject}`
      );

      // Build reply with quote and optional signature
      const quote = replyTo.bodyText
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");

      let replyHtml = `<p></p><br/><p>---</p><p>Am ${replyTo.date} schrieb ${replyTo.from}:</p><blockquote style="border-left: 2px solid #ccc; margin-left: 0; padding-left: 10px; color: #666;">${quote.replace(/\n/g, "<br/>")}</blockquote>`;

      // Add default signature before quote if available
      if (defaultSignature) {
        replyHtml = `<p></p><br/><div class="email-signature">${defaultSignature.content}</div>${replyHtml}`;
        setSelectedSignatureId(defaultSignature.id);
      }

      setBodyHtml(replyHtml);
      setSignatureApplied(true);
    }
  }, [replyTo, defaultSignature]);

  // Handle signature change
  const handleSignatureChange = (signatureId: string) => {
    setSelectedSignatureId(signatureId);

    // Remove old signature from body
    let cleanHtml = bodyHtml.replace(/<div class="email-signature">[\s\S]*?<\/div>/gi, "");

    // Add new signature
    if (signatureId && signatureId !== "none") {
      const signature = signatures.find(s => s.id === signatureId);
      if (signature) {
        // Insert signature at the end (before any quote block if present)
        const quoteIndex = cleanHtml.indexOf("<blockquote");
        if (quoteIndex > 0) {
          cleanHtml = cleanHtml.slice(0, quoteIndex) + `<div class="email-signature">${signature.content}</div>` + cleanHtml.slice(quoteIndex);
        } else {
          cleanHtml = cleanHtml + `<div class="email-signature">${signature.content}</div>`;
        }
      }
    }

    setBodyHtml(cleanHtml);
  };

  const handleEditorChange = (html: string, text: string) => {
    setBodyHtml(html);
    setBodyText(text);
  };

  // Attachment handling
  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return;
    const newAttachments: AttachmentFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      newAttachments.push({
        file,
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
      });
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Parse recipients - handle both "email" and "Name <email>" formats
    const parseRecipients = (str: string): string[] => {
      return str
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const match = s.match(/<(.+)>/);
          return match ? match[1] : s;
        });
    };

    const toList = parseRecipients(to);
    const ccList = parseRecipients(cc);
    const bccList = parseRecipients(bcc);

    if (toList.length === 0) {
      setError(t("email.recipientRequired"));
      return;
    }

    try {
      // Convert attachments to base64
      const outgoingAttachments: OutgoingAttachment[] = [];
      for (const att of attachments) {
        const base64Data = await fileToBase64(att.file);
        outgoingAttachments.push({
          filename: att.name,
          mimeType: att.type,
          data: base64Data,
        });
      }

      await onSend({
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject,
        bodyText: bodyText,
        bodyHtml: bodyHtml,
        replyToMessageId: replyTo?.uid?.toString(),
        attachments: outgoingAttachments.length > 0 ? outgoingAttachments : undefined,
      });
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(t("email.sendError", { error: errorMsg }));
    }
  };

  return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-800">
          {replyTo ? t("email.reply") : t("email.newEmail")}
        </h2>
        <div className="flex items-center gap-4">
          {loadingContacts && (
            <span className="text-sm text-gray-400">{t("email.loadingContacts")}</span>
          )}
          {!loadingContacts && contacts.length > 0 && (
            <span className="text-sm text-gray-400">{t("email.contactsCount", { count: contacts.length })}</span>
          )}
          <button
            onClick={onCancel}
            className="text-gray-500 hover:text-gray-700"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-300 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
        <div className="space-y-3 mb-4">
          <AutocompleteInput
            label={t("email.to")}
            value={to}
            onChange={setTo}
            contacts={contacts}
            placeholder="recipient@example.com"
            required
          />
          <AutocompleteInput
            label={t("email.cc")}
            value={cc}
            onChange={setCc}
            contacts={contacts}
          />
          <AutocompleteInput
            label={t("email.bcc")}
            value={bcc}
            onChange={setBcc}
            contacts={contacts}
          />
          <div className="flex items-center">
            <label className="w-16 text-sm text-gray-600">{t("email.subject")}:</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Signature selector */}
          {signatures.length > 0 && (
            <div className="flex items-center">
              <label className="w-16 text-sm text-gray-600">{t("email.signature")}:</label>
              <select
                value={selectedSignatureId || "none"}
                onChange={(e) => handleSignatureChange(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="none">{t("email.noSignature")}</option>
                {signatures.map((sig) => (
                  <option key={sig.id} value={sig.id}>
                    {sig.name} {sig.isDefault ? `(${t("signatures.default")})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div
          className={`flex-1 min-h-0 ${isDragging ? "ring-2 ring-blue-500 ring-opacity-50" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <RichTextEditor
            content={bodyHtml}
            onChange={handleEditorChange}
            placeholder={t("email.enterMessage")}
            className="h-full"
            minHeight="250px"
          />
        </div>

        {/* Attachments section */}
        <div className="mt-4 border-t pt-4">
          <div className="flex items-center gap-4 mb-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => handleFileSelect(e.target.files)}
              multiple
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 flex items-center gap-2"
            >
              <span>📎</span>
              {t("email.addAttachment")}
            </button>
            {attachments.length > 0 && (
              <span className="text-sm text-gray-500">
                {t("email.attachment", { count: attachments.length })} ({formatFileSize(attachments.reduce((sum, a) => sum + a.size, 0))})
              </span>
            )}
          </div>

          {/* Attachment list */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((att, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded text-sm"
                >
                  <span>📎</span>
                  <span className="max-w-48 truncate" title={att.name}>
                    {att.name}
                  </span>
                  <span className="text-gray-500 text-xs">
                    ({formatFileSize(att.size)})
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(i)}
                    className="text-red-500 hover:text-red-700 ml-1"
                    title={t("email.remove")}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {isDragging && (
            <div className="mt-2 p-4 border-2 border-dashed border-blue-400 rounded bg-blue-50 text-center text-blue-600">
              {t("email.dropFilesHere")}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed"
          >
            {loading ? t("email.sending") : t("email.send")}
          </button>
        </div>
      </form>
    </div>
  );
}

export default Composer;
