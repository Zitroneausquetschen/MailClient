import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Calendar as BigCalendar, dateFnsLocalizer, View, SlotInfo } from "react-big-calendar";
import withDragAndDrop, { EventInteractionArgs } from "react-big-calendar/lib/addons/dragAndDrop";
import { format, parse, startOfWeek, getDay, startOfMonth, endOfMonth, addMonths, subMonths } from "date-fns";
import { de } from "date-fns/locale";
import { SavedAccount, Calendar, CalendarEvent } from "../types/mail";
import EventDialog from "./EventDialog";

import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";

const locales = { de };

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

const DnDCalendar = withDragAndDrop<BigCalendarEvent>(BigCalendar);

interface BigCalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  resource: CalendarEvent;
}

interface Props {
  currentAccount: SavedAccount;
  onClose?: () => void;
}

function CalendarView({ currentAccount }: Props) {
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<View>("month");
  const [date, setDate] = useState(new Date());

  const [showEventDialog, setShowEventDialog] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [newEventSlot, setNewEventSlot] = useState<{ start: Date; end: Date } | null>(null);

  // Load calendars on mount
  useEffect(() => {
    loadCalendars();
  }, [currentAccount?.id]);

  // Load events when calendars or date range changes
  useEffect(() => {
    if (selectedCalendarIds.size > 0) {
      loadEventsForRange();
    }
  }, [selectedCalendarIds, date, view]);

  const loadCalendars = async () => {
    if (!currentAccount) {
      console.log("[CalendarView] No currentAccount, skipping loadCalendars");
      return;
    }
    console.log("[CalendarView] Loading calendars for:", currentAccount.username, "host:", currentAccount.imap_host);
    setLoading(true);
    setError(null);

    try {
      const result = await invoke<Calendar[]>("fetch_calendars", {
        host: currentAccount.imap_host,
        username: currentAccount.username,
        password: currentAccount.password || "",
      });
      console.log("[CalendarView] Loaded calendars:", result);
      setCalendars(result);

      // Select all calendars by default
      if (result.length > 0) {
        setSelectedCalendarIds(new Set(result.map((c) => c.id)));
      }
    } catch (e) {
      console.error("[CalendarView] Error loading calendars:", e);
      setError(`Fehler beim Laden der Kalender: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const loadEventsForRange = async () => {
    if (!currentAccount || selectedCalendarIds.size === 0) return;

    // Calculate date range based on view
    let start: Date;
    let end: Date;

    if (view === "month") {
      start = startOfMonth(subMonths(date, 1));
      end = endOfMonth(addMonths(date, 1));
    } else if (view === "week") {
      start = subMonths(date, 1);
      end = addMonths(date, 1);
    } else {
      start = subMonths(date, 1);
      end = addMonths(date, 1);
    }

    const startStr = start.toISOString().split("T")[0];
    const endStr = end.toISOString().split("T")[0];

    setLoading(true);

    try {
      const allEvents: CalendarEvent[] = [];

      for (const calId of selectedCalendarIds) {
        const calEvents = await invoke<CalendarEvent[]>("fetch_calendar_events", {
          host: currentAccount.imap_host,
          username: currentAccount.username,
          password: currentAccount.password || "",
          calendarId: calId,
          start: startStr,
          end: endStr,
        });

        // Add calendar color to events
        const calendar = calendars.find((c) => c.id === calId);
        const eventsWithColor = calEvents.map((e) => ({
          ...e,
          color: calendar?.color || null,
        }));

        allEvents.push(...eventsWithColor);
      }

      setEvents(allEvents);
    } catch (e) {
      console.error("Failed to load events:", e);
    } finally {
      setLoading(false);
    }
  };

  // Convert CalendarEvent to BigCalendar event format
  const bigCalendarEvents: BigCalendarEvent[] = useMemo(() => {
    return events.map((event) => {
      let start: Date;
      let end: Date;

      if (event.allDay) {
        start = new Date(event.start + "T00:00:00");
        end = new Date(event.end + "T23:59:59");
      } else {
        start = new Date(event.start);
        end = new Date(event.end);
      }

      return {
        id: event.id,
        title: event.summary,
        start,
        end,
        allDay: event.allDay,
        resource: event,
      };
    });
  }, [events]);

  const handleSelectSlot = useCallback((slotInfo: SlotInfo) => {
    setNewEventSlot({ start: slotInfo.start, end: slotInfo.end });
    setEditingEvent(null);
    setShowEventDialog(true);
  }, []);

  const handleSelectEvent = useCallback((event: BigCalendarEvent) => {
    setEditingEvent(event.resource);
    setNewEventSlot(null);
    setShowEventDialog(true);
  }, []);

  const handleEventDrop = useCallback(
    async (args: EventInteractionArgs<BigCalendarEvent>) => {
      const { event, start, end } = args;
      const originalEvent = event.resource;

      const updatedEvent: CalendarEvent = {
        ...originalEvent,
        start: originalEvent.allDay
          ? format(start as Date, "yyyy-MM-dd")
          : (start as Date).toISOString().replace("Z", ""),
        end: originalEvent.allDay
          ? format(end as Date, "yyyy-MM-dd")
          : (end as Date).toISOString().replace("Z", ""),
      };

      try {
        await invoke("update_calendar_event", {
          host: currentAccount.imap_host,
          username: currentAccount.username,
          password: currentAccount.password || "",
          calendarId: originalEvent.calendarId,
          event: updatedEvent,
        });

        setEvents((prev) =>
          prev.map((e) => (e.id === updatedEvent.id ? updatedEvent : e))
        );
      } catch (e) {
        setError(`Fehler beim Verschieben: ${e}`);
      }
    },
    [currentAccount]
  );

  const handleEventResize = useCallback(
    async (args: EventInteractionArgs<BigCalendarEvent>) => {
      const { event, start, end } = args;
      const originalEvent = event.resource;

      const updatedEvent: CalendarEvent = {
        ...originalEvent,
        start: originalEvent.allDay
          ? format(start as Date, "yyyy-MM-dd")
          : (start as Date).toISOString().replace("Z", ""),
        end: originalEvent.allDay
          ? format(end as Date, "yyyy-MM-dd")
          : (end as Date).toISOString().replace("Z", ""),
      };

      try {
        await invoke("update_calendar_event", {
          host: currentAccount.imap_host,
          username: currentAccount.username,
          password: currentAccount.password || "",
          calendarId: originalEvent.calendarId,
          event: updatedEvent,
        });

        setEvents((prev) =>
          prev.map((e) => (e.id === updatedEvent.id ? updatedEvent : e))
        );
      } catch (e) {
        setError(`Fehler beim Aendern: ${e}`);
      }
    },
    [currentAccount]
  );

  const handleSaveEvent = async (event: CalendarEvent) => {
    const isNew = !editingEvent;
    const calendarId = event.calendarId || Array.from(selectedCalendarIds)[0];

    if (isNew) {
      await invoke("create_calendar_event", {
        host: currentAccount.imap_host,
        username: currentAccount.username,
        password: currentAccount.password || "",
        calendarId,
        event: { ...event, calendarId },
      });
      setEvents((prev) => [...prev, { ...event, calendarId }]);
    } else {
      await invoke("update_calendar_event", {
        host: currentAccount.imap_host,
        username: currentAccount.username,
        password: currentAccount.password || "",
        calendarId: event.calendarId,
        event,
      });
      setEvents((prev) => prev.map((e) => (e.id === event.id ? event : e)));
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    const event = events.find((e) => e.id === eventId);
    if (!event) return;

    await invoke("delete_calendar_event", {
      host: currentAccount.imap_host,
      username: currentAccount.username,
      password: currentAccount.password || "",
      calendarId: event.calendarId,
      eventId,
    });

    setEvents((prev) => prev.filter((e) => e.id !== eventId));
  };

  const toggleCalendarSelection = (calendarId: string) => {
    setSelectedCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(calendarId)) {
        next.delete(calendarId);
      } else {
        next.add(calendarId);
      }
      return next;
    });
  };

  const eventStyleGetter = (event: BigCalendarEvent) => {
    const color = event.resource.color || "#3b82f6";
    return {
      style: {
        backgroundColor: color,
        borderColor: color,
        color: "#ffffff",
      },
    };
  };

  // Get the default calendar ID for new events
  const defaultCalendarId = useMemo(() => {
    if (selectedCalendarIds.size > 0) {
      return Array.from(selectedCalendarIds)[0];
    }
    if (calendars.length > 0) {
      return calendars[0].id;
    }
    return "";
  }, [selectedCalendarIds, calendars]);

  // Create new event from slot selection
  const getNewEventFromSlot = (): CalendarEvent | null => {
    if (!newEventSlot) return null;

    // Check if this is a month view click (both hours are 0)
    const isMonthViewClick =
      newEventSlot.start.getHours() === 0 &&
      newEventSlot.end.getHours() === 0;

    let start: Date;
    let end: Date;

    if (isMonthViewClick) {
      // For month view clicks, create a 1-hour event at 9:00
      start = new Date(newEventSlot.start);
      start.setHours(9, 0, 0, 0);
      end = new Date(newEventSlot.start);
      end.setHours(10, 0, 0, 0);
    } else {
      start = newEventSlot.start;
      end = newEventSlot.end;
    }

    return {
      id: crypto.randomUUID(),
      calendarId: defaultCalendarId,
      summary: "",
      description: null,
      location: null,
      start: start.toISOString().replace("Z", ""),
      end: end.toISOString().replace("Z", ""),
      allDay: false,
      recurrenceRule: null,
      color: null,
      organizer: null,
      attendees: [],
    };
  };

  const messages = {
    today: "Heute",
    previous: "Zurueck",
    next: "Weiter",
    month: "Monat",
    week: "Woche",
    day: "Tag",
    agenda: "Agenda",
    date: "Datum",
    time: "Uhrzeit",
    event: "Termin",
    noEventsInRange: "Keine Termine in diesem Zeitraum",
    showMore: (total: number) => `+${total} weitere`,
  };

  return (
    <div className="h-full flex">
      {/* Calendar Sidebar */}
      <div className="w-56 border-r bg-gray-50 p-4 flex flex-col">
        <button
          onClick={() => {
            setEditingEvent(null);
            setNewEventSlot({ start: new Date(), end: new Date() });
            setShowEventDialog(true);
          }}
          disabled={calendars.length === 0}
          className={`w-full px-4 py-2 rounded-lg mb-4 flex items-center justify-center gap-2 ${
            calendars.length === 0
              ? "bg-gray-300 text-gray-500 cursor-not-allowed"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
          title={calendars.length === 0 ? "Keine Kalender verfuegbar" : "Neuen Termin erstellen"}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Neuer Termin
        </button>

        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Kalender</h3>
          {loading && calendars.length === 0 ? (
            <p className="text-sm text-gray-500">Laden...</p>
          ) : calendars.length === 0 ? (
            <div className="text-sm text-gray-500">
              <p>Keine Kalender gefunden.</p>
              <button
                onClick={loadCalendars}
                className="text-blue-600 hover:text-blue-800 mt-1"
              >
                Erneut versuchen
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {calendars.map((cal) => (
                <label
                  key={cal.id}
                  className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-1 rounded"
                >
                  <input
                    type="checkbox"
                    checked={selectedCalendarIds.has(cal.id)}
                    onChange={() => toggleCalendarSelection(cal.id)}
                    className="w-4 h-4 rounded"
                    style={{ accentColor: cal.color || "#3b82f6" }}
                  />
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: cal.color || "#3b82f6" }}
                  />
                  <span className="text-sm text-gray-700 truncate">{cal.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={loadEventsForRange}
          disabled={loading}
          className="mt-auto w-full px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded flex items-center justify-center gap-2"
        >
          <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Aktualisieren
        </button>
      </div>

      {/* Calendar Main Area */}
      <div className="flex-1 flex flex-col">
        {/* Error banner */}
        {error && (
          <div className="bg-red-100 border-b border-red-200 px-4 py-2 text-red-700 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
              X
            </button>
          </div>
        )}

        {/* Calendar */}
        <div className="flex-1 p-4">
          <DnDCalendar
            localizer={localizer}
            events={bigCalendarEvents}
            view={view}
            onView={setView}
            date={date}
            onNavigate={setDate}
            selectable
            resizable
            onSelectSlot={handleSelectSlot}
            onSelectEvent={handleSelectEvent}
            onEventDrop={handleEventDrop}
            onEventResize={handleEventResize}
            eventPropGetter={eventStyleGetter}
            messages={messages}
            culture="de"
            style={{ height: "100%" }}
            views={["month", "week", "day", "agenda"]}
            step={30}
            timeslots={2}
            defaultView="month"
            min={new Date(2020, 0, 1, 6, 0)}
            max={new Date(2020, 0, 1, 22, 0)}
            formats={{
              timeGutterFormat: "HH:mm",
              eventTimeRangeFormat: ({ start, end }) =>
                `${format(start, "HH:mm")} - ${format(end, "HH:mm")}`,
              dayHeaderFormat: (date) => format(date, "EEEE, d. MMMM", { locale: de }),
              dayRangeHeaderFormat: ({ start, end }) =>
                `${format(start, "d. MMM", { locale: de })} - ${format(end, "d. MMM yyyy", { locale: de })}`,
            }}
          />
        </div>
      </div>

      {/* Event Dialog */}
      <EventDialog
        event={editingEvent || (newEventSlot ? getNewEventFromSlot() : null)}
        calendars={calendars}
        selectedCalendarId={defaultCalendarId}
        isOpen={showEventDialog}
        onClose={() => {
          setShowEventDialog(false);
          setEditingEvent(null);
          setNewEventSlot(null);
        }}
        onSave={handleSaveEvent}
        onDelete={editingEvent ? handleDeleteEvent : undefined}
      />
    </div>
  );
}

export default CalendarView;
