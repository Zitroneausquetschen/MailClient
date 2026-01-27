import { useState, useEffect } from "react";
import { CalendarEvent, Calendar, EventAttendee } from "../types/mail";

interface Props {
  event: CalendarEvent | null;
  calendars: Calendar[];
  selectedCalendarId: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (event: CalendarEvent) => Promise<void>;
  onDelete?: (eventId: string) => Promise<void>;
}

function EventDialog({
  event,
  calendars,
  selectedCalendarId,
  isOpen,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [multiDay, setMultiDay] = useState(false);
  const [calendarId, setCalendarId] = useState(selectedCalendarId);
  const [attendees, setAttendees] = useState<EventAttendee[]>([]);
  const [newAttendeeEmail, setNewAttendeeEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = event !== null;

  useEffect(() => {
    if (event) {
      setSummary(event.summary);
      setDescription(event.description || "");
      setLocation(event.location || "");
      setAllDay(event.allDay);
      setCalendarId(event.calendarId);
      setAttendees(event.attendees || []);

      // Parse start date/time
      let parsedStartDate = "";
      if (event.start) {
        const startParts = event.start.split("T");
        parsedStartDate = startParts[0];
        setStartDate(parsedStartDate);
        setStartTime(startParts[1]?.substring(0, 5) || "09:00");
      }

      // Parse end date/time
      if (event.end) {
        const endParts = event.end.split("T");
        const parsedEndDate = endParts[0];
        setEndDate(parsedEndDate);
        setEndTime(endParts[1]?.substring(0, 5) || "10:00");
        // Check if this is a multi-day event
        setMultiDay(parsedEndDate !== parsedStartDate);
      }
    } else {
      // New event - set defaults
      const now = new Date();
      const dateStr = now.toISOString().split("T")[0];
      const hour = now.getHours();
      const nextHour = (hour + 1) % 24;

      setSummary("");
      setDescription("");
      setLocation("");
      setStartDate(dateStr);
      setStartTime(`${String(hour).padStart(2, "0")}:00`);
      setEndDate(dateStr);
      setEndTime(`${String(nextHour).padStart(2, "0")}:00`);
      setAllDay(false);
      setMultiDay(false);
      setCalendarId(selectedCalendarId);
      setAttendees([]);
    }
    setNewAttendeeEmail("");
    setError(null);
  }, [event, selectedCalendarId, isOpen]);

  const handleSave = async () => {
    if (!summary.trim()) {
      setError("Bitte einen Titel eingeben");
      return;
    }

    // Ensure we have a valid calendar ID
    const finalCalendarId = calendarId || selectedCalendarId || (calendars.length > 0 ? calendars[0].id : "");
    if (!finalCalendarId) {
      setError("Kein Kalender ausgewaehlt");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Use start date as end date if not multi-day
      const finalEndDate = multiDay ? endDate : startDate;

      const eventData: CalendarEvent = {
        id: event?.id || crypto.randomUUID(),
        calendarId: finalCalendarId,
        summary: summary.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        start: allDay ? startDate : `${startDate}T${startTime}:00`,
        end: allDay ? finalEndDate : `${finalEndDate}T${endTime}:00`,
        allDay,
        recurrenceRule: event?.recurrenceRule || null,
        color: null,
        organizer: event?.organizer || null,
        attendees,
      };

      await onSave(eventData);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!event || !onDelete) return;

    if (!confirm("Termin wirklich loeschen?")) return;

    setSaving(true);
    try {
      await onDelete(event.id);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isEditing ? "Termin bearbeiten" : "Neuer Termin"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="bg-red-100 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Titel *
            </label>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Termintitel"
              autoFocus
            />
          </div>

          {/* Calendar selection */}
          {calendars.length > 1 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Kalender
              </label>
              <select
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* All day toggle */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="allDay"
                checked={allDay}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setAllDay(checked);
                  // When switching off all-day, reset end date to start date if not multi-day
                  if (!checked && !multiDay) {
                    setEndDate(startDate);
                  }
                }}
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
              />
              <label htmlFor="allDay" className="text-sm text-gray-700">
                Ganztaegig
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="multiDay"
                checked={multiDay}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setMultiDay(checked);
                  // When switching off multi-day, reset end date to start date
                  if (!checked) {
                    setEndDate(startDate);
                  }
                }}
                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
              />
              <label htmlFor="multiDay" className="text-sm text-gray-700">
                Mehrtaegig
              </label>
            </div>
          </div>

          {/* Start date/time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {multiDay ? "Startdatum" : "Datum"}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  // Keep end date in sync if not multi-day
                  if (!multiDay) {
                    setEndDate(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {!allDay && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {multiDay ? "Startzeit" : "Von"}
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>

          {/* End date/time - only show end date if multi-day */}
          <div className="grid grid-cols-2 gap-4">
            {multiDay && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Enddatum
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
            {!allDay && (
              <div className={multiDay ? "" : "col-start-2"}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {multiDay ? "Endzeit" : "Bis"}
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Ort
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ort (optional)"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Beschreibung
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Beschreibung (optional)"
            />
          </div>

          {/* Attendees */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Teilnehmer einladen
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                value={newAttendeeEmail}
                onChange={(e) => setNewAttendeeEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (newAttendeeEmail.trim() && newAttendeeEmail.includes("@")) {
                      const exists = attendees.some(a => a.email.toLowerCase() === newAttendeeEmail.toLowerCase());
                      if (!exists) {
                        setAttendees([...attendees, {
                          email: newAttendeeEmail.trim(),
                          name: null,
                          role: "REQ-PARTICIPANT",
                          status: "NEEDS-ACTION",
                          rsvp: true,
                        }]);
                      }
                      setNewAttendeeEmail("");
                    }
                  }
                }}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="E-Mail-Adresse"
              />
              <button
                type="button"
                onClick={() => {
                  if (newAttendeeEmail.trim() && newAttendeeEmail.includes("@")) {
                    const exists = attendees.some(a => a.email.toLowerCase() === newAttendeeEmail.toLowerCase());
                    if (!exists) {
                      setAttendees([...attendees, {
                        email: newAttendeeEmail.trim(),
                        name: null,
                        role: "REQ-PARTICIPANT",
                        status: "NEEDS-ACTION",
                        rsvp: true,
                      }]);
                    }
                    setNewAttendeeEmail("");
                  }
                }}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
            {/* Attendee list */}
            {attendees.length > 0 && (
              <div className="mt-2 space-y-1">
                {attendees.map((attendee, index) => (
                  <div
                    key={attendee.email}
                    className="flex items-center justify-between px-3 py-1.5 bg-gray-50 rounded-lg text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${
                        attendee.status === "ACCEPTED" ? "bg-green-500" :
                        attendee.status === "DECLINED" ? "bg-red-500" :
                        attendee.status === "TENTATIVE" ? "bg-yellow-500" :
                        "bg-gray-400"
                      }`} />
                      <span>{attendee.name || attendee.email}</span>
                      {attendee.name && (
                        <span className="text-gray-400 text-xs">({attendee.email})</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">
                        {attendee.status === "ACCEPTED" ? "Zugesagt" :
                         attendee.status === "DECLINED" ? "Abgesagt" :
                         attendee.status === "TENTATIVE" ? "Vielleicht" :
                         "Ausstehend"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setAttendees(attendees.filter((_, i) => i !== index))}
                        className="text-gray-400 hover:text-red-500"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t flex items-center justify-between">
          <div>
            {isEditing && onDelete && (
              <button
                onClick={handleDelete}
                disabled={saving}
                className="px-4 py-2 text-red-600 hover:text-red-800 disabled:opacity-50"
              >
                Loeschen
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 disabled:opacity-50"
            >
              Abbrechen
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Speichern..." : "Speichern"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EventDialog;
