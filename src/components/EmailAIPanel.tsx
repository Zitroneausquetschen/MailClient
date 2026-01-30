import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface ExtractedDeadline {
  date: string;
  description: string;
  is_urgent: boolean;
}

interface SuggestedTask {
  title: string;
  description: string | null;
  due_date: string | null;
  priority: string;
}

interface SuggestedEvent {
  title: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
}

interface EmailAnalysis {
  summary: string | null;
  importance_score: number;
  importance_reason: string | null;
  deadlines: ExtractedDeadline[];
  action_items: string[];
  suggested_task: SuggestedTask | null;
  suggested_event: SuggestedEvent | null;
  sentiment: string | null;
  entities: string[];
}

interface Props {
  subject: string;
  from: string;
  body: string;
  onCreateTask?: (task: SuggestedTask) => void;
  onCreateEvent?: (event: SuggestedEvent) => void;
}

export default function EmailAIPanel({ subject, from, body, onCreateTask, onCreateEvent }: Props) {
  const [analysis, setAnalysis] = useState<EmailAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  const analyze = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<EmailAnalysis>('ai_analyze_email', {
        subject,
        from,
        body,
      });
      setAnalysis(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // Auto-analyze on mount if body is provided
  useEffect(() => {
    if (body && body.length > 0) {
      // Check if AI is enabled first
      invoke('get_ai_config')
        .then((config: any) => {
          if (config.provider_type !== 'disabled') {
            analyze();
          }
        })
        .catch(() => {
          // AI not available
        });
    }
  }, [subject, from, body]);

  const getImportanceColor = (score: number) => {
    if (score >= 80) return 'text-red-600 dark:text-red-400';
    if (score >= 60) return 'text-orange-600 dark:text-orange-400';
    if (score >= 40) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-gray-600 dark:text-gray-400';
  };

  const getSentimentIcon = (sentiment: string | null) => {
    switch (sentiment) {
      case 'positive':
        return '😊';
      case 'negative':
        return '😟';
      default:
        return '😐';
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  if (error) {
    return (
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 p-3 mb-4">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-sm text-yellow-800 dark:text-yellow-200">AI nicht verfügbar</span>
          <button
            onClick={analyze}
            className="ml-auto text-sm text-yellow-600 hover:text-yellow-800 dark:text-yellow-400"
          >
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 p-3 mb-4">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="text-sm text-blue-800 dark:text-blue-200">AI analysiert E-Mail...</span>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return null;
  }

  return (
    <div className="bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border rounded-lg mb-4 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-white/50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <span className="font-medium text-purple-800 dark:text-purple-200">AI-Analyse</span>
          <span className={`font-bold ${getImportanceColor(analysis.importance_score)}`}>
            {analysis.importance_score}%
          </span>
          <span className="text-lg">{getSentimentIcon(analysis.sentiment)}</span>
        </div>
        <svg
          className={`w-5 h-5 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="p-4 pt-0 space-y-4">
          {/* Summary */}
          {analysis.summary && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                Zusammenfassung
              </h4>
              <p className="text-sm text-gray-800 dark:text-gray-200">{analysis.summary}</p>
            </div>
          )}

          {/* Importance */}
          {analysis.importance_reason && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                Wichtigkeit ({analysis.importance_score}%)
              </h4>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      analysis.importance_score >= 80
                        ? 'bg-red-500'
                        : analysis.importance_score >= 60
                        ? 'bg-orange-500'
                        : analysis.importance_score >= 40
                        ? 'bg-yellow-500'
                        : 'bg-gray-400'
                    }`}
                    style={{ width: `${analysis.importance_score}%` }}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{analysis.importance_reason}</p>
            </div>
          )}

          {/* Deadlines */}
          {analysis.deadlines.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                Deadlines
              </h4>
              <div className="space-y-1">
                {analysis.deadlines.map((deadline, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center gap-2 text-sm ${
                      deadline.is_urgent ? 'text-red-600 dark:text-red-400 font-medium' : ''
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                      />
                    </svg>
                    <span className="font-mono">{formatDate(deadline.date)}</span>
                    <span>{deadline.description}</span>
                    {deadline.is_urgent && (
                      <span className="text-xs bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 px-1 rounded">
                        DRINGEND
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Items */}
          {analysis.action_items.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                Handlungspunkte
              </h4>
              <ul className="space-y-1">
                {analysis.action_items.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <svg
                      className="w-4 h-4 mt-0.5 text-blue-500 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggested Task */}
          {analysis.suggested_task && onCreateTask && (
            <div className="bg-white dark:bg-gray-800 rounded p-3 border border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase mb-1">
                    Vorgeschlagene Aufgabe
                  </h4>
                  <p className="font-medium text-sm">{analysis.suggested_task.title}</p>
                  {analysis.suggested_task.description && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      {analysis.suggested_task.description}
                    </p>
                  )}
                  {analysis.suggested_task.due_date && (
                    <p className="text-xs text-gray-500 mt-1">
                      Fällig: {formatDate(analysis.suggested_task.due_date)}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => onCreateTask(analysis.suggested_task!)}
                  className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
                >
                  Erstellen
                </button>
              </div>
            </div>
          )}

          {/* Suggested Event */}
          {analysis.suggested_event && onCreateEvent && (
            <div className="bg-white dark:bg-gray-800 rounded p-3 border border-green-200 dark:border-green-800">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase mb-1">
                    Vorgeschlagener Termin
                  </h4>
                  <p className="font-medium text-sm">{analysis.suggested_event.title}</p>
                  {analysis.suggested_event.start_time && (
                    <p className="text-xs text-gray-500 mt-1">
                      {analysis.suggested_event.start_time}
                      {analysis.suggested_event.location && ` - ${analysis.suggested_event.location}`}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => onCreateEvent(analysis.suggested_event!)}
                  className="px-3 py-1 bg-green-500 text-white text-sm rounded hover:bg-green-600"
                >
                  Erstellen
                </button>
              </div>
            </div>
          )}

          {/* Entities */}
          {analysis.entities.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                Erkannte Entitäten
              </h4>
              <div className="flex flex-wrap gap-1">
                {analysis.entities.map((entity, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-xs rounded-full"
                  >
                    {entity}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
