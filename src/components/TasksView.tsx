import { useState, useEffect } from "react";
import { Task, SavedAccount } from "../types/mail";

interface Props {
  currentAccount: SavedAccount | null;
  onClose?: () => void;
}

const STORAGE_KEY = "mailclient_tasks";

function TasksView({ currentAccount, onClose }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

  // Load tasks from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const allTasks: Task[] = JSON.parse(stored);
        setTasks(allTasks);
      } catch (e) {
        console.error("Failed to load tasks:", e);
      }
    }
  }, []);

  // Save tasks to localStorage
  const saveTasks = (newTasks: Task[]) => {
    setTasks(newTasks);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newTasks));
  };

  // Filter tasks by account
  const accountTasks = tasks.filter(
    (t) => !currentAccount || t.accountId === currentAccount.id
  );

  // Apply filter
  const filteredTasks = accountTasks.filter((t) => {
    if (filter === "active") return !t.completed;
    if (filter === "completed") return t.completed;
    return true;
  });

  // Sort: incomplete first, then by due date, then by priority
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  const handleToggleComplete = (taskId: string) => {
    const newTasks = tasks.map((t) =>
      t.id === taskId
        ? { ...t, completed: !t.completed, updatedAt: new Date().toISOString() }
        : t
    );
    saveTasks(newTasks);
  };

  const handleDelete = (taskId: string) => {
    const newTasks = tasks.filter((t) => t.id !== taskId);
    saveTasks(newTasks);
  };

  const handleSaveTask = (task: Task) => {
    const existingIndex = tasks.findIndex((t) => t.id === task.id);
    let newTasks: Task[];

    if (existingIndex >= 0) {
      newTasks = [...tasks];
      newTasks[existingIndex] = { ...task, updatedAt: new Date().toISOString() };
    } else {
      newTasks = [...tasks, task];
    }

    saveTasks(newTasks);
    setShowAddDialog(false);
    setEditingTask(null);
  };

  const completedCount = accountTasks.filter((t) => t.completed).length;
  const totalCount = accountTasks.length;

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">Aufgaben</h2>
          <p className="text-sm text-gray-500">
            {completedCount} von {totalCount} erledigt
          </p>
        </div>
        <div className="flex items-center gap-3">
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
            Neue Aufgabe
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
              {f === "all" ? "Alle" : f === "active" ? "Offen" : "Erledigt"}
              <span className="ml-2 text-xs bg-gray-100 px-2 py-0.5 rounded-full">
                {f === "all"
                  ? accountTasks.length
                  : f === "active"
                  ? accountTasks.filter((t) => !t.completed).length
                  : completedCount}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto p-6">
        {sortedTasks.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <p className="text-lg">Keine Aufgaben</p>
            <p className="text-sm mt-2">Erstelle eine neue Aufgabe um loszulegen</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-3xl mx-auto">
            {sortedTasks.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                onToggle={() => handleToggleComplete(task.id)}
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
          accountId={currentAccount?.id || "default"}
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
  task: Task;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function TaskItem({ task, onToggle, onEdit, onDelete }: TaskItemProps) {
  const priorityColors = {
    high: "text-red-600 bg-red-50",
    medium: "text-yellow-600 bg-yellow-50",
    low: "text-green-600 bg-green-50",
  };

  const priorityLabels = {
    high: "Hoch",
    medium: "Mittel",
    low: "Niedrig",
  };

  const isOverdue = task.dueDate && !task.completed && new Date(task.dueDate) < new Date();

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
            {task.title}
          </h3>
          <span
            className={`text-xs px-2 py-0.5 rounded ${priorityColors[task.priority]}`}
          >
            {priorityLabels[task.priority]}
          </span>
        </div>

        {task.description && (
          <p className="text-sm text-gray-500 mt-1 line-clamp-2">{task.description}</p>
        )}

        <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
          {task.dueDate && (
            <span className={isOverdue ? "text-red-500 font-medium" : ""}>
              <svg className="w-3 h-3 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {new Date(task.dueDate).toLocaleDateString("de-DE")}
              {isOverdue && " (ueberfaellig)"}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={onEdit}
          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
          title="Bearbeiten"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
          title="Loeschen"
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
  task: Task | null;
  accountId: string;
  onSave: (task: Task) => void;
  onCancel: () => void;
}

function TaskDialog({ task, accountId, onSave, onCancel }: TaskDialogProps) {
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [priority, setPriority] = useState<"low" | "medium" | "high">(task?.priority || "medium");
  const [dueDate, setDueDate] = useState(task?.dueDate || "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const now = new Date().toISOString();
    const newTask: Task = {
      id: task?.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: title.trim(),
      description: description.trim(),
      completed: task?.completed || false,
      priority,
      dueDate: dueDate || null,
      createdAt: task?.createdAt || now,
      updatedAt: now,
      accountId: task?.accountId || accountId,
    };

    onSave(newTask);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4 border-b">
            <h3 className="text-lg font-semibold">
              {task ? "Aufgabe bearbeiten" : "Neue Aufgabe"}
            </h3>
          </div>

          <div className="px-6 py-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Titel *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Was muss erledigt werden?"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Beschreibung
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Optionale Details..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Prioritaet
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as "low" | "medium" | "high")}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="low">Niedrig</option>
                  <option value="medium">Mittel</option>
                  <option value="high">Hoch</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Faellig am
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
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {task ? "Speichern" : "Erstellen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TasksView;
