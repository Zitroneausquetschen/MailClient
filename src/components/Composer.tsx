import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Email, OutgoingEmail, Contact, SavedAccount } from "../types/mail";
import RichTextEditor from "./RichTextEditor";

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
      setError("Bitte gib mindestens einen Empfaenger an.");
      return;
    }

    try {
      await onSend({
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject,
        bodyText: bodyText,
        bodyHtml: bodyHtml,
        replyToMessageId: replyTo?.uid?.toString(),
      });
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(`Fehler beim Senden: ${errorMsg}`);
    }
  };

  return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-gray-800">
          {replyTo ? "Antworten" : "Neue E-Mail"}
        </h2>
        <div className="flex items-center gap-4">
          {loadingContacts && (
            <span className="text-sm text-gray-400">Kontakte laden...</span>
          )}
          {!loadingContacts && contacts.length > 0 && (
            <span className="text-sm text-gray-400">{contacts.length} Kontakte</span>
          )}
          <button
            onClick={onCancel}
            className="text-gray-500 hover:text-gray-700"
          >
            Abbrechen
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
            label="An"
            value={to}
            onChange={setTo}
            contacts={contacts}
            placeholder="empfaenger@example.com"
            required
          />
          <AutocompleteInput
            label="CC"
            value={cc}
            onChange={setCc}
            contacts={contacts}
            placeholder="Optional"
          />
          <AutocompleteInput
            label="BCC"
            value={bcc}
            onChange={setBcc}
            contacts={contacts}
            placeholder="Optional"
          />
          <div className="flex items-center">
            <label className="w-16 text-sm text-gray-600">Betreff:</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Betreff eingeben..."
            />
          </div>

          {/* Signature selector */}
          {signatures.length > 0 && (
            <div className="flex items-center">
              <label className="w-16 text-sm text-gray-600">Signatur:</label>
              <select
                value={selectedSignatureId || "none"}
                onChange={(e) => handleSignatureChange(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="none">Keine Signatur</option>
                {signatures.map((sig) => (
                  <option key={sig.id} value={sig.id}>
                    {sig.name} {sig.isDefault ? "(Standard)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0">
          <RichTextEditor
            content={bodyHtml}
            onChange={handleEditorChange}
            placeholder="Nachricht eingeben..."
            className="h-full"
            minHeight="250px"
          />
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed"
          >
            {loading ? "Sende..." : "Senden"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default Composer;
