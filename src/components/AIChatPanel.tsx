import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Email, EmailCategory } from "../types/mail";
import { ChatMessage, ChatContext } from "../types/chat";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  currentEmail: Email | null;
  accountId: string | null;
  folder: string;
  onInsertReply?: (text: string) => void;
  categories?: EmailCategory[];
  onCategoryChange?: (categoryId: string) => void;
}

function AIChatPanel({
  isOpen,
  onClose,
  currentEmail,
  accountId,
  folder,
  onInsertReply,
  categories = [],
  onCategoryChange,
}: Props) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Clear messages when email changes
  useEffect(() => {
    if (currentEmail) {
      setMessages([]);
    }
  }, [currentEmail?.uid]);

  const buildContext = (): ChatContext | undefined => {
    if (!currentEmail || !accountId) return undefined;

    return {
      emailUid: currentEmail.uid,
      folder,
      accountId,
      emailSubject: currentEmail.subject,
      emailFrom: currentEmail.from,
      emailBody: currentEmail.bodyText?.substring(0, 2000), // Limit body size
    };
  };

  const sendMessage = async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: content.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);
    setError(null);

    try {
      // Build messages for the AI
      const aiMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      aiMessages.push({ role: "user", content: content.trim() });

      const response = await invoke<string>("ai_chat", {
        messages: aiMessages,
        context: buildContext(),
      });

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAction = async (action: string) => {
    if (isLoading || !currentEmail) return;

    setIsLoading(true);
    setError(null);

    try {
      let response: string;

      switch (action) {
        case "summarize":
          const summaryPrompt = t("ai.actions.summarizePrompt", "Please summarize this email briefly:");
          await sendMessage(summaryPrompt);
          return;

        case "reply_formal":
          response = await invoke<string>("ai_generate_reply", {
            accountId,
            folder,
            uid: currentEmail.uid,
            tone: "formal",
          });
          break;

        case "reply_friendly":
          response = await invoke<string>("ai_generate_reply", {
            accountId,
            folder,
            uid: currentEmail.uid,
            tone: "friendly",
          });
          break;

        case "reply_brief":
          response = await invoke<string>("ai_generate_reply", {
            accountId,
            folder,
            uid: currentEmail.uid,
            tone: "brief",
          });
          break;

        default:
          return;
      }

      // Add the response as an assistant message
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputValue);
    }
  };

  const handleInsertReply = (content: string) => {
    if (onInsertReply) {
      onInsertReply(content);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="w-80 border-l bg-white flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <h3 className="font-medium">{t("ai.assistant", "AI Assistant")}</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Quick Actions */}
      {currentEmail && (
        <div className="p-3 border-b bg-gray-50 space-y-2">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">
            {t("ai.quickActions", "Quick Actions")}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleQuickAction("summarize")}
              disabled={isLoading}
              className="px-2 py-1.5 text-xs bg-white border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
            >
              <span>📝</span> {t("ai.actions.summarize", "Summarize")}
            </button>

            <button
              onClick={() => handleQuickAction("reply_formal")}
              disabled={isLoading}
              className="px-2 py-1.5 text-xs bg-white border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
            >
              <span>📨</span> {t("ai.actions.replyFormal", "Formal Reply")}
            </button>

            <button
              onClick={() => handleQuickAction("reply_friendly")}
              disabled={isLoading}
              className="px-2 py-1.5 text-xs bg-white border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
            >
              <span>😊</span> {t("ai.actions.replyFriendly", "Friendly Reply")}
            </button>

            <button
              onClick={() => handleQuickAction("reply_brief")}
              disabled={isLoading}
              className="px-2 py-1.5 text-xs bg-white border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1"
            >
              <span>⚡</span> {t("ai.actions.replyBrief", "Brief Reply")}
            </button>
          </div>

          {/* Category Change */}
          {categories.length > 0 && onCategoryChange && (
            <div className="mt-2">
              <select
                onChange={(e) => onCategoryChange(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded bg-white"
                defaultValue=""
              >
                <option value="" disabled>
                  {t("ai.actions.changeCategory", "Change category...")}
                </option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.icon} {cat.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !currentEmail && (
          <div className="text-center text-gray-400 py-8">
            <div className="text-4xl mb-2">💬</div>
            <p className="text-sm">{t("ai.selectEmailHint", "Select an email to get started")}</p>
          </div>
        )}

        {messages.length === 0 && currentEmail && (
          <div className="text-center text-gray-400 py-8">
            <div className="text-4xl mb-2">🤖</div>
            <p className="text-sm">{t("ai.askQuestionHint", "Ask a question or use the quick actions")}</p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                message.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-800"
              }`}
            >
              <div className="whitespace-pre-wrap">{message.content}</div>

              {/* Insert reply button for assistant messages */}
              {message.role === "assistant" && onInsertReply && (
                <button
                  onClick={() => handleInsertReply(message.content)}
                  className="mt-2 text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  {t("ai.insertReply", "Insert as reply")}
                </button>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-3 py-2 rounded-lg">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-red-700 text-sm flex items-center justify-between">
          <span className="truncate">{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 flex-shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t bg-gray-50">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("ai.inputPlaceholder", "Ask a question...")}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            rows={2}
            disabled={isLoading}
          />
          <button
            onClick={() => sendMessage(inputValue)}
            disabled={isLoading || !inputValue.trim()}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default AIChatPanel;
