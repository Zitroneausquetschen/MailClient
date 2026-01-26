import { useState, useEffect } from "react";
import { Email, OutgoingEmail } from "../types/mail";

interface Props {
  replyTo: Email | null;
  onSend: (email: OutgoingEmail) => Promise<void>;
  onCancel: () => void;
  loading: boolean;
}

function extractEmail(from: string): string {
  const match = from.match(/<(.+)>/);
  return match ? match[1] : from;
}

function Composer({ replyTo, onSend, onCancel, loading }: Props) {
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (replyTo) {
      setTo(extractEmail(replyTo.from));
      setSubject(
        replyTo.subject.startsWith("Re:") ? replyTo.subject : `Re: ${replyTo.subject}`
      );
      setBody(
        `\n\n---\nAm ${replyTo.date} schrieb ${replyTo.from}:\n\n${replyTo.bodyText
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")}`
      );
    }
  }, [replyTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Parse recipients
    const toList = to
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const ccList = cc
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const bccList = bcc
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (toList.length === 0) {
      setError("Bitte gib mindestens einen Empfänger an.");
      return;
    }

    try {
      await onSend({
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject,
        bodyText: body,
        replyToMessageId: replyTo?.uid?.toString(),
      });
      // Success - the onSend will handle navigation
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
        <button
          onClick={onCancel}
          className="text-gray-500 hover:text-gray-700"
        >
          Abbrechen
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-300 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
        <div className="space-y-3 mb-4">
          <div className="flex items-center">
            <label className="w-16 text-sm text-gray-600">An:</label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="empfaenger@example.com"
              required
            />
          </div>
          <div className="flex items-center">
            <label className="w-16 text-sm text-gray-600">CC:</label>
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional"
            />
          </div>
          <div className="flex items-center">
            <label className="w-16 text-sm text-gray-600">BCC:</label>
            <input
              type="text"
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional"
            />
          </div>
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
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none font-sans"
          placeholder="Nachricht eingeben..."
        />

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
