import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface AIConfig {
  provider_type: 'local' | 'ollama' | 'open_ai' | 'anthropic' | 'custom_open_ai' | 'disabled';
  local_model: string;
  local_model_downloaded: boolean;
  ollama_url: string;
  ollama_model: string;
  openai_api_key: string;
  openai_model: string;
  anthropic_api_key: string;
  anthropic_model: string;
  custom_api_url: string;
  custom_api_key: string;
  custom_model: string;
  auto_summarize: boolean;
  auto_extract_deadlines: boolean;
  auto_prioritize: boolean;
  suggest_tasks: boolean;
  suggest_calendar: boolean;
}

interface LocalModelStatus {
  id: string;
  name: string;
  size_mb: number;
  downloaded: boolean;
  file_size: number;
}

interface DownloadProgress {
  total_bytes: number;
  downloaded_bytes: number;
  percent: number;
  speed_bps: number;
  status: string;
}

const defaultConfig: AIConfig = {
  provider_type: 'disabled',
  local_model: 'tiny_llama1_1b',
  local_model_downloaded: false,
  ollama_url: 'http://localhost:11434',
  ollama_model: 'llama3.2:latest',
  openai_api_key: '',
  openai_model: 'gpt-4o-mini',
  anthropic_api_key: '',
  anthropic_model: 'claude-3-haiku-20240307',
  custom_api_url: '',
  custom_api_key: '',
  custom_model: '',
  auto_summarize: true,
  auto_extract_deadlines: true,
  auto_prioritize: true,
  suggest_tasks: true,
  suggest_calendar: true,
};

const localModels = [
  { id: 'smol_l_m135_m', name: 'SmolLM 135M', size: '~80 MB', description: 'Sehr schnell, grundlegende Fähigkeiten' },
  { id: 'qwen2_0_5b', name: 'Qwen2 0.5B', size: '~350 MB', description: 'Gute Balance aus Geschwindigkeit und Qualität' },
  { id: 'tiny_llama1_1b', name: 'TinyLlama 1.1B', size: '~600 MB', description: 'Empfohlen - beste Preis-Leistung' },
  { id: 'phi3_mini', name: 'Phi-3 Mini', size: '~2 GB', description: 'Beste Qualität, benötigt mehr Speicher' },
];

interface Props {
  onClose: () => void;
}

export default function AISettings({ onClose }: Props) {
  const [config, setConfig] = useState<AIConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [openaiModels, setOpenaiModels] = useState<[string, string][]>([]);
  const [anthropicModels, setAnthropicModels] = useState<[string, string][]>([]);
  const [loadingOllamaModels, setLoadingOllamaModels] = useState(false);
  const [localModelsStatus, setLocalModelsStatus] = useState<LocalModelStatus[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
    loadModelLists();
    loadLocalModelsStatus();

    // Listen for download progress events
    const unlisten = listen<DownloadProgress>('local-model-download-progress', (event) => {
      setDownloadProgress(event.payload);
      if (event.payload.status === 'Complete') {
        setDownloadingModel(null);
        setDownloadProgress(null);
        loadLocalModelsStatus();
      }
    });

    return () => {
      unlisten.then(fn => fn());
    };
  }, []);

  const loadConfig = async () => {
    try {
      const savedConfig = await invoke<AIConfig>('get_ai_config');
      setConfig(savedConfig);
    } catch (error) {
      console.error('Failed to load AI config:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadModelLists = async () => {
    try {
      const [openai, anthropic] = await Promise.all([
        invoke<[string, string][]>('get_openai_models'),
        invoke<[string, string][]>('get_anthropic_models'),
      ]);
      setOpenaiModels(openai);
      setAnthropicModels(anthropic);
    } catch (error) {
      console.error('Failed to load model lists:', error);
    }
  };

  const loadOllamaModels = async () => {
    setLoadingOllamaModels(true);
    try {
      const models = await invoke<string[]>('list_ollama_models', {
        baseUrl: config.ollama_url,
      });
      setOllamaModels(models);
    } catch (error) {
      console.error('Failed to load Ollama models:', error);
      setOllamaModels([]);
    } finally {
      setLoadingOllamaModels(false);
    }
  };

  const loadLocalModelsStatus = async () => {
    try {
      const status = await invoke<LocalModelStatus[]>('get_local_models_status');
      setLocalModelsStatus(status);
    } catch (error) {
      console.error('Failed to load local models status:', error);
    }
  };

  const handleDownloadModel = async (modelId: string) => {
    setDownloadingModel(modelId);
    setDownloadProgress({ total_bytes: 0, downloaded_bytes: 0, percent: 0, speed_bps: 0, status: 'Starting...' });
    try {
      await invoke('download_local_model', { modelId });
    } catch (error) {
      console.error('Failed to download model:', error);
      alert('Download fehlgeschlagen: ' + error);
      setDownloadingModel(null);
      setDownloadProgress(null);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    if (!confirm('Möchten Sie dieses Modell wirklich löschen?')) {
      return;
    }
    setDeletingModel(modelId);
    try {
      await invoke('delete_local_model', { modelId });
      await loadLocalModelsStatus();
    } catch (error) {
      console.error('Failed to delete model:', error);
      alert('Löschen fehlgeschlagen: ' + error);
    } finally {
      setDeletingModel(null);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatSpeed = (bps: number): string => {
    return formatBytes(bps) + '/s';
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke('save_ai_config', { config });
      onClose();
    } catch (error) {
      console.error('Failed to save AI config:', error);
      alert('Fehler beim Speichern: ' + error);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await invoke<string>('test_ai_connection', { config });
      setTestResult({ success: true, message: result });
    } catch (error) {
      setTestResult({ success: false, message: String(error) });
    } finally {
      setTesting(false);
    }
  };

  const updateConfig = (updates: Partial<AIConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
    setTestResult(null);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6">
          <p>Lade AI-Einstellungen...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b dark:border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold">AI-Assistent Einstellungen</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Provider Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">AI-Provider</label>
            <select
              value={config.provider_type}
              onChange={(e) => updateConfig({ provider_type: e.target.value as AIConfig['provider_type'] })}
              className="w-full p-2 border rounded dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="disabled">Deaktiviert</option>
              <option value="local">Lokal (Eingebettet) - Keine Installation nötig</option>
              <option value="ollama">Ollama (Selbst gehostet)</option>
              <option value="open_ai">OpenAI (ChatGPT)</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="custom_open_ai">Benutzerdefinierte OpenAI-kompatible API</option>
            </select>
          </div>

          {/* Local Model Settings */}
          {config.provider_type === 'local' && (
            <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <h3 className="font-medium">Lokales Modell (Eingebettet)</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Wähle ein Modell aus, das direkt in der App läuft. Keine externe Installation oder API-Keys erforderlich.
                Die Modelle werden einmalig heruntergeladen und lokal gespeichert.
              </p>
              <div className="space-y-2">
                {localModels.map((model) => {
                  const status = localModelsStatus.find(s => s.id === model.id);
                  const isDownloaded = status?.downloaded || false;
                  const isDownloading = downloadingModel === model.id;
                  const isDeleting = deletingModel === model.id;

                  return (
                    <div
                      key={model.id}
                      className={`p-3 border rounded-lg transition-colors ${
                        config.local_model === model.id
                          ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                          : 'border-gray-200 dark:border-gray-600 hover:border-purple-300'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="local_model"
                          value={model.id}
                          checked={config.local_model === model.id}
                          onChange={(e) => updateConfig({ local_model: e.target.value })}
                          className="mt-1"
                          disabled={!isDownloaded}
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{model.name}</span>
                            <span className="text-xs bg-gray-200 dark:bg-gray-600 px-2 py-0.5 rounded">
                              {model.size}
                            </span>
                            {model.id === 'tiny_llama1_1b' && (
                              <span className="text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 px-2 py-0.5 rounded">
                                Empfohlen
                              </span>
                            )}
                            {isDownloaded && (
                              <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded flex items-center gap-1">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                                Heruntergeladen
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            {model.description}
                          </p>

                          {/* Download Progress */}
                          {isDownloading && downloadProgress && (
                            <div className="mt-3 space-y-2">
                              <div className="flex justify-between text-xs text-gray-500">
                                <span>{downloadProgress.status}</span>
                                <span>
                                  {formatBytes(downloadProgress.downloaded_bytes)} / {formatBytes(downloadProgress.total_bytes)}
                                  {downloadProgress.speed_bps > 0 && ` (${formatSpeed(downloadProgress.speed_bps)})`}
                                </span>
                              </div>
                              <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                                <div
                                  className="bg-purple-500 h-2 rounded-full transition-all duration-300"
                                  style={{ width: `${downloadProgress.percent}%` }}
                                />
                              </div>
                              <div className="text-center text-xs text-gray-500">
                                {downloadProgress.percent.toFixed(1)}%
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex-shrink-0">
                          {!isDownloaded && !isDownloading && (
                            <button
                              onClick={() => handleDownloadModel(model.id)}
                              disabled={downloadingModel !== null}
                              className="px-3 py-1.5 bg-purple-500 text-white text-sm rounded hover:bg-purple-600 disabled:opacity-50 flex items-center gap-1"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              Download
                            </button>
                          )}
                          {isDownloading && (
                            <button
                              disabled
                              className="px-3 py-1.5 bg-gray-300 dark:bg-gray-600 text-gray-500 text-sm rounded flex items-center gap-1"
                            >
                              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Lädt...
                            </button>
                          )}
                          {isDownloaded && !isDeleting && (
                            <button
                              onClick={() => handleDeleteModel(model.id)}
                              className="px-3 py-1.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm rounded hover:bg-red-200 dark:hover:bg-red-900/50 flex items-center gap-1"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              Löschen
                            </button>
                          )}
                          {isDeleting && (
                            <button
                              disabled
                              className="px-3 py-1.5 bg-gray-300 dark:bg-gray-600 text-gray-500 text-sm rounded flex items-center gap-1"
                            >
                              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Löscht...
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Info about disk space */}
              {localModelsStatus.filter(s => s.downloaded).length > 0 && (
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                  Gespeicherte Modelle: {formatBytes(localModelsStatus.filter(s => s.downloaded).reduce((acc, s) => acc + s.file_size, 0))}
                </div>
              )}

              {/* Development notice */}
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mt-4">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      Lokale KI in Entwicklung
                    </p>
                    <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                      Der Modell-Download ist funktionsfähig. Die lokale Inferenz wird in einer zukünftigen Version aktiviert.
                      Für sofortige KI-Nutzung verwenden Sie bitte <strong>Ollama</strong> (selbst gehostet) oder einen Cloud-Anbieter.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Ollama Settings */}
          {config.provider_type === 'ollama' && (
            <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <h3 className="font-medium">Ollama Einstellungen</h3>
              <div>
                <label className="block text-sm mb-1">Server URL</label>
                <input
                  type="text"
                  value={config.ollama_url}
                  onChange={(e) => updateConfig({ ollama_url: e.target.value })}
                  className="w-full p-2 border rounded dark:bg-gray-600 dark:border-gray-500"
                  placeholder="http://localhost:11434"
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Modell</label>
                <div className="flex gap-2">
                  <select
                    value={config.ollama_model}
                    onChange={(e) => updateConfig({ ollama_model: e.target.value })}
                    className="flex-1 p-2 border rounded dark:bg-gray-600 dark:border-gray-500"
                  >
                    {ollamaModels.length === 0 && (
                      <option value={config.ollama_model}>{config.ollama_model}</option>
                    )}
                    {ollamaModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={loadOllamaModels}
                    disabled={loadingOllamaModels}
                    className="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                  >
                    {loadingOllamaModels ? '...' : 'Laden'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* OpenAI Settings */}
          {config.provider_type === 'open_ai' && (
            <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <h3 className="font-medium">OpenAI Einstellungen</h3>
              <div>
                <label className="block text-sm mb-1">API Key</label>
                <input
                  type="password"
                  value={config.openai_api_key}
                  onChange={(e) => updateConfig({ openai_api_key: e.target.value })}
                  className="w-full p-2 border rounded dark:bg-gray-600 dark:border-gray-500"
                  placeholder="sk-..."
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Modell</label>
                <select
                  value={config.openai_model}
                  onChange={(e) => updateConfig({ openai_model: e.target.value })}
                  className="w-full p-2 border rounded dark:bg-gray-600 dark:border-gray-500"
                >
                  {openaiModels.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Anthropic Settings */}
          {config.provider_type === 'anthropic' && (
            <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <h3 className="font-medium">Anthropic Einstellungen</h3>
              <div>
                <label className="block text-sm mb-1">API Key</label>
                <input
                  type="password"
                  value={config.anthropic_api_key}
                  onChange={(e) => updateConfig({ anthropic_api_key: e.target.value })}
                  className="w-full p-2 border rounded dark:bg-gray-600 dark:border-gray-500"
                  placeholder="sk-ant-..."
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Modell</label>
                <select
                  value={config.anthropic_model}
                  onChange={(e) => updateConfig({ anthropic_model: e.target.value })}
                  className="w-full p-2 border rounded dark:bg-gray-600 dark:border-gray-500"
                >
                  {anthropicModels.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Custom OpenAI-compatible Settings */}
          {config.provider_type === 'custom_open_ai' && (
            <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <h3 className="font-medium">Benutzerdefinierte API Einstellungen</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Kompatibel mit LM Studio, LocalAI, Text Generation WebUI und anderen OpenAI-kompatiblen APIs.
              </p>
              <div>
                <label className="block text-sm mb-1">API URL</label>
                <input
                  type="text"
                  value={config.custom_api_url}
                  onChange={(e) => updateConfig({ custom_api_url: e.target.value })}
                  className="w-full p-2 border rounded dark:bg-gray-600 dark:border-gray-500"
                  placeholder="http://localhost:1234/v1"
                />
              </div>
              <div>
                <label className="block text-sm mb-1">API Key (optional)</label>
                <input
                  type="password"
                  value={config.custom_api_key}
                  onChange={(e) => updateConfig({ custom_api_key: e.target.value })}
                  className="w-full p-2 border rounded dark:bg-gray-600 dark:border-gray-500"
                  placeholder="Optional"
                />
              </div>
              <div>
                <label className="block text-sm mb-1">Modell Name</label>
                <input
                  type="text"
                  value={config.custom_model}
                  onChange={(e) => updateConfig({ custom_model: e.target.value })}
                  className="w-full p-2 border rounded dark:bg-gray-600 dark:border-gray-500"
                  placeholder="z.B. local-model"
                />
              </div>
            </div>
          )}

          {/* Feature Toggles */}
          {config.provider_type !== 'disabled' && (
            <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <h3 className="font-medium">AI-Funktionen</h3>
              <div className="space-y-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.auto_summarize}
                    onChange={(e) => updateConfig({ auto_summarize: e.target.checked })}
                    className="rounded"
                  />
                  <span>Automatische E-Mail-Zusammenfassung</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.auto_extract_deadlines}
                    onChange={(e) => updateConfig({ auto_extract_deadlines: e.target.checked })}
                    className="rounded"
                  />
                  <span>Deadlines automatisch erkennen</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.auto_prioritize}
                    onChange={(e) => updateConfig({ auto_prioritize: e.target.checked })}
                    className="rounded"
                  />
                  <span>Wichtigkeit automatisch bewerten</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.suggest_tasks}
                    onChange={(e) => updateConfig({ suggest_tasks: e.target.checked })}
                    className="rounded"
                  />
                  <span>Aufgaben vorschlagen</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config.suggest_calendar}
                    onChange={(e) => updateConfig({ suggest_calendar: e.target.checked })}
                    className="rounded"
                  />
                  <span>Kalendertermine vorschlagen</span>
                </label>
              </div>
            </div>
          )}

          {/* Test Result */}
          {testResult && (
            <div
              className={`p-4 rounded-lg ${
                testResult.success
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                  : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
              }`}
            >
              <p className="font-medium">{testResult.success ? 'Erfolg' : 'Fehler'}</p>
              <p className="text-sm mt-1">{testResult.message}</p>
            </div>
          )}
        </div>

        <div className="p-4 border-t dark:border-gray-700 flex justify-between">
          <button
            onClick={handleTest}
            disabled={testing || config.provider_type === 'disabled'}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            {testing ? 'Teste...' : 'Verbindung testen'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              Abbrechen
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
            >
              {saving ? 'Speichere...' : 'Speichern'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
