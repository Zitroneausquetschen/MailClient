import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
  DayState,
  DayProgress,
  CalDavConfig,
  ImportantEmail,
  CalendarEventSummary,
  TaskSummary,
  AISuggestion,
} from "../types/dayAgent";

interface Props {
  accountId: string | null;
  caldavConfig: CalDavConfig | null;
  onNavigateToEmail?: (uid: number, folder: string) => void;
  onNavigateToCalendar?: (eventId: string) => void;
  onNavigateToTasks?: (taskId: string) => void;
}

function DayAgentPanel({
  accountId,
  caldavConfig,
  onNavigateToEmail,
  onNavigateToCalendar,
  onNavigateToTasks,
}: Props) {
  const { t } = useTranslation();
  const [dayState, setDayState] = useState<DayState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [morningBaseline, setMorningBaseline] = useState<DayProgress | null>(null);

  // Get greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t("dayAgent.greetingMorning", "Guten Morgen");
    if (hour < 17) return t("dayAgent.greetingAfternoon", "Guten Tag");
    return t("dayAgent.greetingEvening", "Guten Abend");
  };

  // Format date
  const formatDate = () => {
    return new Date().toLocaleDateString("de-DE", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  // Load day briefing
  const loadBriefing = useCallback(async (isRefresh = false) => {
    if (!accountId) return;

    setLoading(true);
    setError(null);

    try {
      let state: DayState;

      if (isRefresh && morningBaseline) {
        state = await invoke<DayState>("refresh_day_state", {
          accountId,
          caldavConfig,
          morningBaseline,
        });
      } else {
        state = await invoke<DayState>("get_day_briefing", {
          accountId,
          caldavConfig,
        });
        // Store morning baseline
        const today = new Date().toDateString();
        localStorage.setItem(
          "dayAgentBaseline",
          JSON.stringify({ date: today, baseline: state.progress })
        );
        setMorningBaseline(state.progress);
      }

      setDayState(state);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [accountId, caldavConfig, morningBaseline]);

  // Load on mount and restore baseline
  useEffect(() => {
    const today = new Date().toDateString();
    const stored = localStorage.getItem("dayAgentBaseline");
    if (stored) {
      try {
        const { date, baseline } = JSON.parse(stored);
        if (date === today) {
          setMorningBaseline(baseline);
        }
      } catch {
        // Ignore parse errors
      }
    }
    loadBriefing();
  }, [accountId]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      if (dayState && morningBaseline) {
        loadBriefing(true);
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [dayState, morningBaseline, loadBriefing]);

  // Format time for events
  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return isoString;
    }
  };

  // Handle suggestion action
  const handleSuggestionAction = (suggestion: AISuggestion) => {
    if (!suggestion.action) return;

    switch (suggestion.action.targetType) {
      case "email":
        onNavigateToEmail?.(parseInt(suggestion.action.targetId), "INBOX");
        break;
      case "event":
        onNavigateToCalendar?.(suggestion.action.targetId);
        break;
      case "task":
        onNavigateToTasks?.(suggestion.action.targetId);
        break;
    }
  };

  if (!accountId) {
    return (
      <div className="h-full flex items-center justify-center bg-gradient-to-b from-blue-50 to-white">
        <div className="text-center text-gray-500">
          <div className="text-4xl mb-4">📧</div>
          <p>{t("dayAgent.selectAccount", "Bitte wähle einen Account aus")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-blue-50 to-white overflow-hidden">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-800">
              {getGreeting()}!
            </h1>
            <p className="text-sm text-gray-500">{formatDate()}</p>
          </div>
          <button
            onClick={() => loadBriefing(!!morningBaseline)}
            disabled={loading}
            className="p-2 rounded-lg bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-50 transition-colors"
            title={t("dayAgent.refresh", "Aktualisieren")}
          >
            <svg
              className={`w-5 h-5 ${loading ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && !dayState && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-500">{t("dayAgent.loading", "Lade Briefing...")}</p>
          </div>
        </div>
      )}

      {/* Content */}
      {dayState && (
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* AI Briefing */}
          {dayState.aiBriefing && (
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">🤖</span>
                <p className="text-gray-700 leading-relaxed">{dayState.aiBriefing}</p>
              </div>
            </div>
          )}

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              icon="📧"
              label={t("dayAgent.emails", "E-Mails")}
              value={dayState.emailSummary.unreadCount}
              highlight={dayState.emailSummary.unreadCount > 0}
            />
            <StatCard
              icon="📅"
              label={t("dayAgent.events", "Termine")}
              value={dayState.calendarSummary.totalEventsToday}
              subtext={
                dayState.calendarSummary.eventsRemaining > 0
                  ? `${dayState.calendarSummary.eventsRemaining} ${t("dayAgent.remaining", "offen")}`
                  : undefined
              }
            />
            <StatCard
              icon="✅"
              label={t("dayAgent.tasks", "Aufgaben")}
              value={dayState.taskSummary.totalOpen}
              highlight={dayState.taskSummary.overdue.length > 0}
              highlightColor="red"
            />
          </div>

          {/* Important Emails */}
          {dayState.emailSummary.importantEmails.length > 0 && (
            <Section
              icon="📧"
              title={t("dayAgent.importantEmails", "Wichtige E-Mails")}
            >
              {dayState.emailSummary.importantEmails.map((email) => (
                <EmailItem
                  key={email.uid}
                  email={email}
                  onClick={() => onNavigateToEmail?.(email.uid, email.folder)}
                />
              ))}
            </Section>
          )}

          {/* Today's Events */}
          {dayState.calendarSummary.todayEvents.length > 0 && (
            <Section
              icon="📅"
              title={t("dayAgent.todayEvents", "Termine heute")}
            >
              {dayState.calendarSummary.todayEvents.map((event) => (
                <EventItem
                  key={event.id}
                  event={event}
                  isNext={dayState.calendarSummary.nextEvent?.id === event.id}
                  minutesUntil={
                    dayState.calendarSummary.nextEvent?.id === event.id
                      ? dayState.calendarSummary.minutesUntilNext
                      : null
                  }
                  formatTime={formatTime}
                  onClick={() => onNavigateToCalendar?.(event.id)}
                />
              ))}
            </Section>
          )}

          {/* Overdue Tasks */}
          {dayState.taskSummary.overdue.length > 0 && (
            <Section
              icon="⚠️"
              title={t("dayAgent.overdueTasks", "Überfällige Aufgaben")}
              urgent
            >
              {dayState.taskSummary.overdue.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onClick={() => onNavigateToTasks?.(task.id)}
                />
              ))}
            </Section>
          )}

          {/* Due Today */}
          {dayState.taskSummary.dueToday.length > 0 && (
            <Section
              icon="📋"
              title={t("dayAgent.dueTodayTasks", "Heute fällig")}
            >
              {dayState.taskSummary.dueToday.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onClick={() => onNavigateToTasks?.(task.id)}
                />
              ))}
            </Section>
          )}

          {/* AI Suggestions */}
          {dayState.aiSuggestions.length > 0 && (
            <Section
              icon="💡"
              title={t("dayAgent.suggestions", "Empfehlungen")}
            >
              {dayState.aiSuggestions.map((suggestion, idx) => (
                <SuggestionItem
                  key={idx}
                  suggestion={suggestion}
                  onClick={() => handleSuggestionAction(suggestion)}
                />
              ))}
            </Section>
          )}
        </div>
      )}

      {/* Progress Footer */}
      {dayState && (
        <footer className="bg-white border-t px-6 py-3 flex-shrink-0">
          <div className="mb-2">
            <div className="flex justify-between text-sm text-gray-600 mb-1">
              <span>{t("dayAgent.progress", "Fortschritt")}</span>
              <span>{dayState.progress.overallProgressPercent}%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${dayState.progress.overallProgressPercent}%` }}
              />
            </div>
          </div>
          <div className="flex gap-4 text-xs text-gray-500">
            {dayState.progress.emailsProcessed > 0 && (
              <span>✓ {dayState.progress.emailsProcessed} {t("dayAgent.emailsRead", "E-Mails gelesen")}</span>
            )}
            {dayState.progress.tasksCompleted > 0 && (
              <span>✓ {dayState.progress.tasksCompleted} {t("dayAgent.tasksCompleted", "Aufgaben erledigt")}</span>
            )}
            {dayState.progress.eventsAttended > 0 && (
              <span>✓ {dayState.progress.eventsAttended} {t("dayAgent.eventsAttended", "Termine wahrgenommen")}</span>
            )}
          </div>
        </footer>
      )}
    </div>
  );
}

// Sub-components

interface StatCardProps {
  icon: string;
  label: string;
  value: number;
  subtext?: string;
  highlight?: boolean;
  highlightColor?: "blue" | "red";
}

function StatCard({ icon, label, value, subtext, highlight, highlightColor = "blue" }: StatCardProps) {
  const highlightClass = highlight
    ? highlightColor === "red"
      ? "bg-red-50 border-red-200"
      : "bg-blue-50 border-blue-200"
    : "bg-white border-gray-200";

  return (
    <div className={`rounded-xl border p-3 text-center ${highlightClass}`}>
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-2xl font-bold text-gray-800">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
      {subtext && <div className="text-xs text-gray-400 mt-1">{subtext}</div>}
    </div>
  );
}

interface SectionProps {
  icon: string;
  title: string;
  urgent?: boolean;
  children: React.ReactNode;
}

function Section({ icon, title, urgent, children }: SectionProps) {
  return (
    <div className={`bg-white rounded-xl shadow-sm border p-4 ${urgent ? "border-red-200" : ""}`}>
      <h3 className={`font-medium mb-3 flex items-center gap-2 ${urgent ? "text-red-700" : "text-gray-700"}`}>
        <span>{icon}</span>
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

interface EmailItemProps {
  email: ImportantEmail;
  onClick?: () => void;
}

function EmailItem({ email, onClick }: EmailItemProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-2 rounded-lg hover:bg-gray-50 transition-colors"
    >
      <div className="flex items-center gap-2">
        {!email.isRead && <span className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-800 truncate">{email.subject}</div>
          <div className="text-sm text-gray-500 truncate">{email.from}</div>
        </div>
      </div>
    </button>
  );
}

interface EventItemProps {
  event: CalendarEventSummary;
  isNext: boolean;
  minutesUntil: number | null;
  formatTime: (s: string) => string;
  onClick?: () => void;
}

function EventItem({ event, isNext, minutesUntil, formatTime, onClick }: EventItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-2 rounded-lg transition-colors ${
        event.isPast ? "opacity-50" : "hover:bg-gray-50"
      } ${isNext ? "bg-blue-50 border border-blue-200" : ""}`}
    >
      <div className="flex items-center gap-3">
        <div className="text-sm text-gray-500 w-12 flex-shrink-0">
          {event.allDay ? "Ganzt." : formatTime(event.start)}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-medium truncate ${event.isPast ? "line-through text-gray-400" : "text-gray-800"}`}>
            {event.summary}
          </div>
          {event.location && (
            <div className="text-sm text-gray-500 truncate">📍 {event.location}</div>
          )}
        </div>
        {isNext && minutesUntil !== null && minutesUntil > 0 && (
          <div className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full flex-shrink-0">
            in {minutesUntil} min
          </div>
        )}
      </div>
    </button>
  );
}

interface TaskItemProps {
  task: TaskSummary;
  onClick?: () => void;
}

function TaskItem({ task, onClick }: TaskItemProps) {
  const priorityColors = {
    high: "text-red-600",
    medium: "text-yellow-600",
    low: "text-gray-400",
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-2 rounded-lg hover:bg-gray-50 transition-colors ${
        task.isOverdue ? "bg-red-50" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`text-lg ${priorityColors[task.priorityLabel]}`}>
          {task.priorityLabel === "high" ? "🔴" : task.priorityLabel === "medium" ? "🟡" : "⚪"}
        </span>
        <div className="flex-1 min-w-0">
          <div className={`font-medium truncate ${task.isOverdue ? "text-red-700" : "text-gray-800"}`}>
            {task.summary}
          </div>
          {task.due && (
            <div className="text-sm text-gray-500">
              {task.isOverdue ? "Überfällig: " : "Fällig: "}
              {new Date(task.due).toLocaleDateString("de-DE")}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

interface SuggestionItemProps {
  suggestion: AISuggestion;
  onClick?: () => void;
}

function SuggestionItem({ suggestion, onClick }: SuggestionItemProps) {
  const typeIcons: Record<string, string> = {
    priority: "🎯",
    time_block: "⏰",
    email_action: "📧",
    task_reminder: "📋",
    meeting_prep: "🗓️",
  };

  return (
    <button
      onClick={onClick}
      className="w-full text-left p-3 rounded-lg bg-gradient-to-r from-purple-50 to-blue-50 hover:from-purple-100 hover:to-blue-100 transition-colors"
    >
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0">{typeIcons[suggestion.suggestionType] || "💡"}</span>
        <div>
          <div className="font-medium text-gray-800">{suggestion.title}</div>
          <div className="text-sm text-gray-600">{suggestion.description}</div>
        </div>
      </div>
    </button>
  );
}

export default DayAgentPanel;
