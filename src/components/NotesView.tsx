import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Note, SavedAccount } from "../types/mail";
import RichTextEditor from "./RichTextEditor";

interface Props {
  currentAccount: SavedAccount | null;
  onClose?: () => void;
}

const STORAGE_KEY = "mailclient_notes";

const NOTE_COLORS = [
  { name: "Standard", value: null },
  { name: "Gelb", value: "#fef9c3" },
  { name: "Gruen", value: "#dcfce7" },
  { name: "Blau", value: "#dbeafe" },
  { name: "Rot", value: "#fee2e2" },
  { name: "Lila", value: "#f3e8ff" },
];

function NotesView({ currentAccount, onClose }: Props) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Load notes from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const allNotes: Note[] = JSON.parse(stored);
        setNotes(allNotes);
      } catch (e) {
        console.error("Failed to load notes:", e);
      }
    }
  }, []);

  // Save notes to localStorage
  const saveNotes = (newNotes: Note[]) => {
    setNotes(newNotes);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newNotes));
  };

  // Filter notes by account
  const accountNotes = notes.filter(
    (n) => !currentAccount || n.accountId === currentAccount.id
  );

  // Apply search filter
  const filteredNotes = accountNotes.filter((n) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      n.title.toLowerCase().includes(query) ||
      n.content.toLowerCase().includes(query)
    );
  });

  // Sort by updated date (newest first)
  const sortedNotes = [...filteredNotes].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  const selectedNote = notes.find((n) => n.id === selectedNoteId);

  const handleCreateNote = () => {
    const now = new Date().toISOString();
    const newNote: Note = {
      id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: t("notes.add"),
      content: "",
      createdAt: now,
      updatedAt: now,
      accountId: currentAccount?.id || "default",
      color: null,
    };

    saveNotes([newNote, ...notes]);
    setSelectedNoteId(newNote.id);
  };

  const handleUpdateNote = (updates: Partial<Note>) => {
    if (!selectedNoteId) return;

    const newNotes = notes.map((n) =>
      n.id === selectedNoteId
        ? { ...n, ...updates, updatedAt: new Date().toISOString() }
        : n
    );
    saveNotes(newNotes);
  };

  const handleDeleteNote = (noteId: string) => {
    const newNotes = notes.filter((n) => n.id !== noteId);
    saveNotes(newNotes);
    if (selectedNoteId === noteId) {
      setSelectedNoteId(newNotes.length > 0 ? newNotes[0].id : null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">{t("notes.title")}</h2>
          <p className="text-sm text-gray-500">{accountNotes.length} {t("notes.title")}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleCreateNote}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t("notes.add")}
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

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Notes list (left sidebar) */}
        <div className="w-72 border-r bg-white flex flex-col">
          {/* Search */}
          <div className="p-3 border-b">
            <div className="relative">
              <svg
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("notes.searchNotes")}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Notes list */}
          <div className="flex-1 overflow-y-auto">
            {sortedNotes.length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-sm">
                {t("notes.noNotes")}
              </div>
            ) : (
              <div className="divide-y">
                {sortedNotes.map((note) => (
                  <button
                    key={note.id}
                    onClick={() => setSelectedNoteId(note.id)}
                    className={`w-full text-left p-3 hover:bg-gray-50 transition-colors ${
                      selectedNoteId === note.id ? "bg-blue-50 border-l-2 border-blue-500" : ""
                    }`}
                    style={{ backgroundColor: note.color && selectedNoteId !== note.id ? note.color : undefined }}
                  >
                    <div className="font-medium text-gray-800 truncate">{note.title}</div>
                    <div
                      className="text-sm text-gray-500 truncate mt-0.5"
                      dangerouslySetInnerHTML={{
                        __html: note.content.replace(/<[^>]+>/g, " ").substring(0, 50),
                      }}
                    />
                    <div className="text-xs text-gray-400 mt-1">
                      {new Date(note.updatedAt).toLocaleDateString("de-DE", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Note editor (right side) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedNote ? (
            <>
              {/* Note toolbar */}
              <div className="bg-white border-b px-4 py-2 flex items-center justify-between">
                <input
                  type="text"
                  value={selectedNote.title}
                  onChange={(e) => handleUpdateNote({ title: e.target.value })}
                  className="text-lg font-medium bg-transparent border-none focus:outline-none flex-1"
                  placeholder={t("notes.noteTitle")}
                />
                <div className="flex items-center gap-2">
                  {/* Color picker */}
                  <div className="relative group">
                    <button
                      className="p-2 hover:bg-gray-100 rounded"
                      title="Farbe"
                    >
                      <div
                        className="w-5 h-5 rounded border border-gray-300"
                        style={{ backgroundColor: selectedNote.color || "#ffffff" }}
                      />
                    </button>
                    <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-lg p-2 hidden group-hover:block z-10">
                      <div className="flex gap-1">
                        {NOTE_COLORS.map((color) => (
                          <button
                            key={color.name}
                            onClick={() => handleUpdateNote({ color: color.value })}
                            className={`w-6 h-6 rounded border ${
                              selectedNote.color === color.value
                                ? "ring-2 ring-blue-500"
                                : "border-gray-300"
                            }`}
                            style={{ backgroundColor: color.value || "#ffffff" }}
                            title={color.name}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={() => handleDeleteNote(selectedNote.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                    title={t("common.delete")}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Note content */}
              <div
                className="flex-1 overflow-hidden"
                style={{ backgroundColor: selectedNote.color || undefined }}
              >
                <div className="h-full p-4">
                  <RichTextEditor
                    content={selectedNote.content}
                    onChange={(html) => handleUpdateNote({ content: html })}
                    placeholder={t("notes.content")}
                    className="h-full bg-white"
                    minHeight="100%"
                  />
                </div>
              </div>

              {/* Note footer */}
              <div className="bg-white border-t px-4 py-2 text-xs text-gray-400">
                {t("notes.created")}: {new Date(selectedNote.createdAt).toLocaleString()} |
                {t("notes.lastEdited")}: {new Date(selectedNote.updatedAt).toLocaleString()}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <svg
                  className="w-16 h-16 mx-auto mb-4 text-gray-300"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
                <p className="text-lg">{t("notes.noNotes")}</p>
                <p className="text-sm mt-2">
                  {t("notes.selectOrCreate")}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default NotesView;
