// Day Agent Types - Dynamic daily briefing and progress tracking

export interface DayState {
  generatedAt: string;
  emailSummary: EmailDaySummary;
  calendarSummary: CalendarDaySummary;
  taskSummary: TaskDaySummary;
  aiBriefing: string | null;
  aiSuggestions: AISuggestion[];
  progress: DayProgress;
}

export interface EmailDaySummary {
  unreadCount: number;
  importantEmails: ImportantEmail[];
  emailsReadToday: number;
  emailsWithDeadlines: EmailDeadline[];
}

export interface ImportantEmail {
  uid: number;
  folder: string;
  subject: string;
  from: string;
  date: string;
  isRead: boolean;
  importanceReason: string | null;
}

export interface EmailDeadline {
  emailUid: number;
  emailSubject: string;
  deadlineDate: string;
  deadlineDescription: string;
  isUrgent: boolean;
}

export interface CalendarDaySummary {
  todayEvents: CalendarEventSummary[];
  nextEvent: CalendarEventSummary | null;
  minutesUntilNext: number | null;
  totalEventsToday: number;
  eventsCompleted: number;
  eventsRemaining: number;
}

export interface CalendarEventSummary {
  id: string;
  calendarId: string;
  summary: string;
  location: string | null;
  start: string;
  end: string;
  allDay: boolean;
  isPast: boolean;
  attendeeCount: number;
}

export interface TaskDaySummary {
  dueToday: TaskSummary[];
  overdue: TaskSummary[];
  dueThisWeek: TaskSummary[];
  completedToday: number;
  highPriorityPending: TaskSummary[];
  totalOpen: number;
}

export interface TaskSummary {
  id: string;
  calendarId: string;
  summary: string;
  description: string | null;
  due: string | null;
  priority: number | null;
  priorityLabel: "high" | "medium" | "low";
  isOverdue: boolean;
}

export interface AISuggestion {
  suggestionType: SuggestionType;
  title: string;
  description: string;
  action: SuggestedAction | null;
}

export type SuggestionType =
  | "priority"
  | "time_block"
  | "email_action"
  | "task_reminder"
  | "meeting_prep";

export interface SuggestedAction {
  actionType: "open_email" | "view_task" | "view_calendar";
  targetId: string;
  targetType: "email" | "task" | "event";
}

export interface DayProgress {
  morningUnread: number;
  morningOpenTasks: number;
  morningEvents: number;
  emailsProcessed: number;
  tasksCompleted: number;
  eventsAttended: number;
  overallProgressPercent: number;
}

export interface CalDavConfig {
  host: string;
  username: string;
  password: string;
  calendarIds: string[];
}
