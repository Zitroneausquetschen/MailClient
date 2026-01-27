import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { CalDavTask, Calendar, SavedAccount } from "../types/mail";

interface Props {
  currentAccount: SavedAccount | null;
  onClose?: () => void;
}

// Convert CalDAV priority (1-9) to our priority levels
function caldavPriorityToLevel(priority: number | null): "low" | "medium" | "high" {
  if (priority === null || priority === 0) return "medium";
  if (priority <= 4) return "high";
  if (priority <= 6) return "medium";
  return "low";
}

// Convert our priority levels to CalDAV priority (1-9)
function levelToCaldavPriority(level: "low" | "medium" | "high"): number {
  switch (level) {
    case "high": return 1;
    case "medium": return 5;
    case "low": return 9;
  }
}

function TasksView({ currentAccount, onClose }: Props) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<CalDavTask[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>("personal");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingTask, setEditingTask] = useState<CalDavTask | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

  // Load calendars
  useEffect(() => {
    if (!currentAccount) return;

    const loadCalendars = async () => {
      try {
        const result = await invoke<Calendar[]>("fetch_calendars", {
          host: currentAccount.imap_host,
          username: currentAccount.username,
          password: currentAccount.password || "",
        });
        setCalendars(result);
        // Use "personal" as default if available, otherwise first calendar
        if (result.length > 0) {
          const personal = result.find(c => c.id === "personal");
          setSelectedCalendarId(personal?.id || result[0].id);
        }
      } catch (e) {
        console.error("Failed to load calendars:", e);
        setError(t("errors.loadFailed"));
      }
    };

    loadCalendars();
  }, [currentAccount?.id]);

  // Load tasks from CalDAV
  const loadTasks = useCallback(async () => {
    if (!currentAccount || !selectedCalendarId) return;

    setLoading(true);
    setError(null);

    try {
      const result = await invoke<CalDavTask[]>("fetch_caldav_tasks", {
        host: currentAccount.imap_host,
        username: currentAccount.username,
        password: currentAccount.password || "",
        calendarId: selectedCalendarId,
      });
      setTasks(result);
    } catch (e) {
      console.error("Failed to load tasks:", e);
      setError(t("errors.loadFailed") + ": " + String(e));
    } finally {
      setLoading(false);
    }
  }, [currentAccount, selectedCalendarId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Filter tasks
  const filteredTasks = tasks.filter((t) => {
    if (filter === "active") return !t.completed;
    if (filter === "completed") return t.completed;
    return true;
  });

  // Sort: incomplete first, then by due date, then by priority
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.due && b.due) return a.due.localeCompare(b.due);
    if (a.due) return -1;
    if (b.due) return 1;
    // Lower priority number = higher priority
    const aPrio = a.priority ?? 5;
    const bPrio = b.priority ?? 5;
    return aPrio - bPrio;
  });

  const handleToggleComplete = async (task: CalDavTask) => {
    if (!currentAccount) return;

    const updatedTask: CalDavTask = {
      ...task,
      completed: !task.completed,
      percentComplete: !task.completed ? 100 : 0,
      status: !task.completed ? "COMPLETED" : "NEEDS-ACTION",
    };

    try {
      await invoke("update_caldav_task", {
        host: currentAccount.imap_host,
        username: currentAccount.username,
        password: currentAccount.password || "",
        calendarId: selectedCalendarId,
        task: updatedTask,
      });
      // Update local state
      setTasks(tasks.map(t => t.id === task.id ? updatedTask : t));
    } catch (e) {
      console.error("Failed to toggle task:", e);
      setError(t("errors.saveFailed"));
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!currentAccount) return;

    try {
      await invoke("delete_caldav_task", {
        host: currentAccount.imap_host,
        username: currentAccount.username,
        password: currentAccount.password || "",
        calendarId: selectedCalendarId,
        taskId,
      });
      setTasks(tasks.filter(t => t.id !== taskId));
    } catch (e) {
      console.error("Failed to delete task:", e);
      setError(t("errors.deleteFailed"));
    }
  };

  const handleSaveTask = async (task: CalDavTask, isNew: boolean) => {
    if (!currentAccount) return;

    try {
      if (isNew) {
        await invoke("create_caldav_task", {
          host: currentAccount.imap_host,
          username: currentAccount.username,
          password: currentAccount.password || "",
          calendarId: selectedCalendarId,
          task,
        });
      } else {
        await invoke("update_caldav_task", {
          host: currentAccount.imap_host,
          username: currentAccount.username,
          password: currentAccount.password || "",
          calendarId: selectedCalendarId,
          task,
        });
      }
      // Reload tasks to get fresh data from server
      loadTasks();
      setShowAddDialog(false);
      setEditingTask(null);
    } catch (e) {
      console.error("Failed to save task:", e);
      setError(t("errors.saveFailed") + ": " + String(e));
    }
  };

  const completedCount = tasks.filter((t) => t.completed).length;
  const totalCount = tasks.length;

  if (!currentAccount) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400">
        <p>{t("accounts.select")}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">{t("tasks.title")}</h2>
          <p className="text-sm text-gray-500">
            {completedCount} / {totalCount} {t("tasks.statusCompleted").toLowerCase()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Calendar selector */}
          {calendars.length > 1 && (
            <select
              value={selectedCalendarId}
              onChange={(e) => setSelectedCalendarId(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {calendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={loadTasks}
            disabled={loading}
            className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
            title={t("common.refresh")}
          >
            <svg className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          <button
            onClick={() => {
              setEditingTask(null);
              setShowAddDialog(true);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t("tasks.add")}
          </button>
          {onClose && (
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border-b border-red-200 px-6 py-3 text-red-700 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">{t("common.close")}</button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="bg-white border-b px-6">
        <div className="flex gap-4">
          {(["all", "active", "completed"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
                filter === f
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {f === "all" ? t("common.all") : f === "active" ? t("tasks.statusOpen") : t("tasks.statusCompleted")}
              <span className="ml-2 text-xs bg-gray-100 px-2 py-0.5 rounded-full">
                {f === "all"
                  ? tasks.length
                  : f === "active"
                  ? tasks.filter((t) => !t.completed).length
                  : completedCount}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading && tasks.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <svg className="w-8 h-8 mx-auto mb-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <p>{t("common.loading")}</p>
          </div>
        ) : sortedTasks.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <p className="text-lg">{t("tasks.noTasks")}</p>
            <p className="text-sm mt-2">{t("tasks.add")}</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-3xl mx-auto">
            {sortedTasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onToggle={() => handleToggleComplete(task)}
                onEdit={() => {
                  setEditingTask(task);
                  setShowAddDialog(true);
                }}
                onDelete={() => handleDelete(task.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Dialog */}
      {showAddDialog && (
        <TaskDialog
          task={editingTask}
          calendarId={selectedCalendarId}
          onSave={handleSaveTask}
          onCancel={() => {
            setShowAddDialog(false);
            setEditingTask(null);
          }}
        />
      )}
    </div>
  );
}

interface TaskItemProps {
  task: CalDavTask;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function TaskItem({ task, onToggle, onEdit, onDelete }: TaskItemProps) {
  const { t } = useTranslation();
  const priorityLevel = caldavPriorityToLevel(task.priority);

  const priorityColors = {
    high: "text-red-600 bg-red-50",
    medium: "text-yellow-600 bg-yellow-50",
    low: "text-green-600 bg-green-50",
  };

  const priorityLabels = {
    high: t("tasks.priorityHigh"),
    medium: t("tasks.priorityMedium"),
    low: t("tasks.priorityLow"),
  };

  const isOverdue = task.due && !task.completed && new Date(task.due) < new Date();

  return (
    <div
      className={`bg-white rounded-lg border p-4 flex items-start gap-4 hover:shadow-sm transition-shadow ${
        task.completed ? "opacity-60" : ""
      }`}
    >
      {/* Checkbox */}
      <button
        onClick={onToggle}
        className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
          task.completed
            ? "bg-green-500 border-green-500 text-white"
            : "border-gray-300 hover:border-blue-500"
        }`}
      >
        {task.completed && (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3
            className={`font-medium ${
              task.completed ? "line-through text-gray-400" : "text-gray-800"
            }`}
          >
            {task.summary}
          </h3>
          <span
            className={`text-xs px-2 py-0.5 rounded ${priorityColors[priorityLevel]}`}
          >
            {priorityLabels[priorityLevel]}
          </span>
        </div>

        {task.description && (
          <p className="text-sm text-gray-500 mt-1 line-clamp-2">{task.description}</p>
        )}

        <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
          {task.due && (
            <span className={isOverdue ? "text-red-500 font-medium" : ""}>
              <svg className="w-3 h-3 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {new Date(task.due).toLocaleDateString("de-DE")}
              {isOverdue && ` (${t("tasks.overdue") || "overdue"})`}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={onEdit}
          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
          title={t("tasks.edit")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
          title={t("common.delete")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

interface TaskDialogProps {
  task: CalDavTask | null;
  calendarId: string;
  onSave: (task: CalDavTask, isNew: boolean) => void;
  onCancel: () => void;
}

function TaskDialog({ task, calendarId, onSave, onCancel }: TaskDialogProps) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState(task?.summary || "");
  const [description, setDescription] = useState(task?.description || "");
  const [priority, setPriority] = useState<"low" | "medium" | "high">(
    task ? caldavPriorityToLevel(task.priority) : "medium"
  );
  const [dueDate, setDueDate] = useState(task?.due?.split("T")[0] || "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!summary.trim()) return;

    const isNew = !task;
    const now = new Date().toISOString();

    const newTask: CalDavTask = {
      id: task?.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      calendarId: task?.calendarId || calendarId,
      summary: summary.trim(),
      description: description.trim() || null,
      completed: task?.completed || false,
      percentComplete: task?.percentComplete ?? 0,
      priority: levelToCaldavPriority(priority),
      due: dueDate || null,
      created: task?.created || now,
      lastModified: now,
      status: task?.status || "NEEDS-ACTION",
    };

    onSave(newTask, isNew);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 border-b">
            <h3 className="text-lg font-semibold">
              {task ? t("tasks.edit") : t("tasks.add")}
            </h3>
          </div>

          <div className="px-6 py-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("tasks.taskTitle")} *
              </label>
              <input
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t("tasks.taskTitle")}
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t("tasks.description")}
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder={t("tasks.description")}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("tasks.priority")}
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as "low" | "medium" | "high")}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="low">{t("tasks.priorityLow")}</option>
                  <option value="medium">{t("tasks.priorityMedium")}</option>
                  <option value="high">{t("tasks.priorityHigh")}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t("tasks.dueDate")}
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t bg-gray-50 flex justify-end gap-3 rounded-b-lg">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={!summary.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {t("common.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TasksView;
