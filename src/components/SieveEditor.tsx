import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { SieveScript, SieveRule, Folder } from "../types/mail";

interface Props {
  host: string;
  username: string;
  password: string;
  folders: Folder[];
  onClose: () => void;
  pendingRule?: SieveRule | null;
  onPendingRuleHandled?: () => void;
}

function SieveEditor({ host, username, password, folders, onClose, pendingRule, onPendingRuleHandled }: Props) {
  const { t } = useTranslation();
  const [scripts, setScripts] = useState<SieveScript[]>([]);
  const [selectedScript, setSelectedScript] = useState<string | null>(null);
  const [rules, setRules] = useState<SieveRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingRule, setEditingRule] = useState<SieveRule | null>(null);
  const [showRawEditor, setShowRawEditor] = useState(false);
  const [rawScript, setRawScript] = useState("");
  const [pendingRuleProcessed, setPendingRuleProcessed] = useState(false);

  const sievePort = 4190;
  // ManageSieve typically runs on the mail server hostname (mail.domain.com)
  const sieveHost = host.replace("imap.", "mail."); // Convert imap.domain.com to mail.domain.com

  useEffect(() => {
    loadScripts();
  }, []);

  // Handle pending rule from context menu
  useEffect(() => {
    if (pendingRule && !pendingRuleProcessed && !loading && selectedScript) {
      setEditingRule(pendingRule);
      setPendingRuleProcessed(true);
      if (onPendingRuleHandled) {
        onPendingRuleHandled();
      }
    }
  }, [pendingRule, pendingRuleProcessed, loading, selectedScript]);

  const loadScripts = async () => {
    setLoading(true);
    setError(null);
    try {
      const scriptList = await invoke<SieveScript[]>("sieve_list_scripts", {
        host: sieveHost,
        port: sievePort,
        username,
        password,
      });
      setScripts(scriptList);

      // Auto-select active script
      const active = scriptList.find((s) => s.active);
      if (active) {
        setSelectedScript(active.name);
        await loadRules(active.name);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadRules = async (scriptName: string) => {
    setLoading(true);
    try {
      const content = await invoke<string>("sieve_get_script", {
        host: sieveHost,
        port: sievePort,
        username,
        password,
        name: scriptName,
      });
      setRawScript(content);

      const ruleList = await invoke<SieveRule[]>("sieve_get_rules", {
        host: sieveHost,
        port: sievePort,
        username,
        password,
        scriptName,
      });
      setRules(ruleList);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const saveRules = async () => {
    if (!selectedScript) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("sieve_save_rules", {
        host: sieveHost,
        port: sievePort,
        username,
        password,
        scriptName: selectedScript,
        rules,
      });
      // Reload to verify
      await loadRules(selectedScript);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const saveRawScript = async () => {
    if (!selectedScript) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("sieve_save_script", {
        host: sieveHost,
        port: sievePort,
        username,
        password,
        name: selectedScript,
        content: rawScript,
      });
      await loadRules(selectedScript);
      setShowRawEditor(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const createNewScript = async () => {
    const name = prompt("Name des neuen Skripts:", "mailclient-rules");
    if (!name) return;

    setLoading(true);
    try {
      await invoke("sieve_save_script", {
        host: sieveHost,
        port: sievePort,
        username,
        password,
        name,
        content: 'require ["fileinto", "imap4flags"];\n\n# Automatisch generiert von MailClient\n',
      });
      await loadScripts();
      setSelectedScript(name);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const activateScript = async (name: string) => {
    setLoading(true);
    try {
      await invoke("sieve_activate_script", {
        host: sieveHost,
        port: sievePort,
        username,
        password,
        name,
      });
      await loadScripts();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const addRule = () => {
    const newRule: SieveRule = {
      id: `rule_${Date.now()}`,
      name: t("sieve.newRule", "New rule"),
      enabled: true,
      conditions: [{ field: "from", operator: "contains", value: "" }],
      actions: [{ actionType: "fileinto", value: "INBOX" }],
    };
    setEditingRule(newRule);
  };

  const saveRule = () => {
    if (!editingRule) return;

    setRules((prev) => {
      const existing = prev.findIndex((r) => r.id === editingRule.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = editingRule;
        return updated;
      } else {
        return [...prev, editingRule];
      }
    });
    setEditingRule(null);
  };

  const deleteRule = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const toggleRule = (id: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))
    );
  };

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-800">{t("sieve.title")}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRawEditor(!showRawEditor)}
            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-800"
          >
            {showRawEditor ? t("sieve.visualEditor", "Visual Editor") : t("sieve.rawScript", "Raw Script")}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1 text-gray-600 hover:text-gray-800"
          >
            {t("settings.close")}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border-b border-red-200 px-4 py-2 text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 text-red-500">
            &times;
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Script list */}
        <div className="w-48 border-r p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">{t("sieve.scripts", "Scripts")}</h3>
            <button
              onClick={createNewScript}
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              + {t("sieve.new", "New")}
            </button>
          </div>
          {scripts.map((script) => (
            <div
              key={script.name}
              className={`p-2 rounded cursor-pointer mb-1 flex items-center justify-between ${
                selectedScript === script.name
                  ? "bg-blue-100 text-blue-800"
                  : "hover:bg-gray-100"
              }`}
              onClick={() => {
                setSelectedScript(script.name);
                loadRules(script.name);
              }}
            >
              <span className="text-sm truncate">{script.name}</span>
              {script.active && (
                <span className="text-xs bg-green-500 text-white px-1 rounded">
                  {t("sieve.active")}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 p-4 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : showRawEditor ? (
            <div className="h-full flex flex-col">
              <textarea
                value={rawScript}
                onChange={(e) => setRawScript(e.target.value)}
                className="flex-1 w-full p-3 border border-gray-300 rounded font-mono text-sm resize-none"
                placeholder="Sieve Script..."
              />
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setShowRawEditor(false)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  {t("sieve.cancel")}
                </button>
                <button
                  onClick={saveRawScript}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  {t("sieve.save")}
                </button>
              </div>
            </div>
          ) : selectedScript ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-medium">{selectedScript}</h3>
                  {!scripts.find((s) => s.name === selectedScript)?.active && (
                    <button
                      onClick={() => activateScript(selectedScript)}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      {t("sieve.activate", "Activate")}
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={addRule}
                    className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                  >
                    + {t("sieve.rule", "Rule")}
                  </button>
                  <button
                    onClick={saveRules}
                    className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                  >
                    {t("sieve.save")}
                  </button>
                </div>
              </div>

              {/* Rules list */}
              <div className="space-y-3">
                {rules.map((rule) => (
                  <div
                    key={rule.id}
                    className={`border rounded p-3 ${
                      rule.enabled ? "bg-white" : "bg-gray-50 opacity-60"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={rule.enabled}
                          onChange={() => toggleRule(rule.id)}
                          className="h-4 w-4"
                        />
                        <span className="font-medium">{rule.name}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditingRule({ ...rule })}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          {t("sieve.editRule")}
                        </button>
                        <button
                          onClick={() => deleteRule(rule.id)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          {t("sieve.deleteRule")}
                        </button>
                      </div>
                    </div>
                    <div className="text-sm text-gray-600">
                      <div>
                        <strong>{t("sieve.if", "If")}:</strong>{" "}
                        {rule.conditions.map((c, i) => (
                          <span key={i}>
                            {i > 0 && ` ${t("sieve.and", "AND")} `}
                            {c.field} {c.operator} "{c.value}"
                          </span>
                        ))}
                      </div>
                      <div>
                        <strong>{t("sieve.then", "Then")}:</strong>{" "}
                        {rule.actions.map((a, i) => (
                          <span key={i}>
                            {i > 0 && ", "}
                            {a.actionType}
                            {a.value && ` "${a.value}"`}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}

                {rules.length === 0 && (
                  <div className="text-center text-gray-500 py-8">
                    {t("sieve.noRules", "No rules. Click \"+ Rule\" to create one.")}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              {t("sieve.selectOrCreate", "Select a script or create a new one")}
            </div>
          )}
        </div>
      </div>

      {/* Rule Editor Modal */}
      {editingRule && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">{t("sieve.editRule")}</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">{t("sieve.ruleName")}</label>
                <input
                  type="text"
                  value={editingRule.name}
                  onChange={(e) =>
                    setEditingRule({ ...editingRule, name: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">{t("sieve.conditions")}</label>
                {editingRule.conditions.map((cond, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <select
                      value={cond.field}
                      onChange={(e) => {
                        const newConds = [...editingRule.conditions];
                        newConds[i] = { ...cond, field: e.target.value };
                        setEditingRule({ ...editingRule, conditions: newConds });
                      }}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="from">{t("sieve.fieldFrom", "From")}</option>
                      <option value="to">{t("sieve.fieldTo", "To")}</option>
                      <option value="subject">{t("sieve.fieldSubject", "Subject")}</option>
                    </select>
                    <select
                      value={cond.operator}
                      onChange={(e) => {
                        const newConds = [...editingRule.conditions];
                        newConds[i] = { ...cond, operator: e.target.value };
                        setEditingRule({ ...editingRule, conditions: newConds });
                      }}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="contains">{t("sieve.opContains", "contains")}</option>
                      <option value="is">{t("sieve.opIs", "is")}</option>
                      <option value="matches">{t("sieve.opMatches", "matches")}</option>
                    </select>
                    <input
                      type="text"
                      value={cond.value}
                      onChange={(e) => {
                        const newConds = [...editingRule.conditions];
                        newConds[i] = { ...cond, value: e.target.value };
                        setEditingRule({ ...editingRule, conditions: newConds });
                      }}
                      className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                      placeholder={t("sieve.valuePlaceholder", "Value...")}
                    />
                    {editingRule.conditions.length > 1 && (
                      <button
                        onClick={() => {
                          const newConds = editingRule.conditions.filter(
                            (_, idx) => idx !== i
                          );
                          setEditingRule({ ...editingRule, conditions: newConds });
                        }}
                        className="text-red-600"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() =>
                    setEditingRule({
                      ...editingRule,
                      conditions: [
                        ...editingRule.conditions,
                        { field: "from", operator: "contains", value: "" },
                      ],
                    })
                  }
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  + {t("sieve.addCondition", "Condition")}
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">{t("sieve.actions")}</label>
                {editingRule.actions.map((action, i) => (
                  <div key={i} className="flex gap-2 mb-2">
                    <select
                      value={action.actionType}
                      onChange={(e) => {
                        const newActions = [...editingRule.actions];
                        newActions[i] = { ...action, actionType: e.target.value };
                        setEditingRule({ ...editingRule, actions: newActions });
                      }}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="fileinto">{t("sieve.actionMoveTo", "Move to")}</option>
                      <option value="redirect">{t("sieve.actionRedirect", "Redirect to")}</option>
                      <option value="discard">{t("sieve.actionDiscard", "Discard")}</option>
                      <option value="keep">{t("sieve.actionKeep", "Keep")}</option>
                      <option value="flag">{t("sieve.actionFlag", "Flag")}</option>
                    </select>
                    {(action.actionType === "fileinto" ||
                      action.actionType === "redirect" ||
                      action.actionType === "flag") && (
                      action.actionType === "fileinto" ? (
                        <select
                          value={action.value || ""}
                          onChange={(e) => {
                            const newActions = [...editingRule.actions];
                            newActions[i] = { ...action, value: e.target.value };
                            setEditingRule({ ...editingRule, actions: newActions });
                          }}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                        >
                          <option value="">{t("sieve.selectFolder", "Select folder...")}</option>
                          {folders.map((f) => (
                            <option key={f.name} value={f.name}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={action.value || ""}
                          onChange={(e) => {
                            const newActions = [...editingRule.actions];
                            newActions[i] = { ...action, value: e.target.value };
                            setEditingRule({ ...editingRule, actions: newActions });
                          }}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                          placeholder={
                            action.actionType === "redirect"
                              ? "email@example.com"
                              : "Flag..."
                          }
                        />
                      )
                    )}
                    {editingRule.actions.length > 1 && (
                      <button
                        onClick={() => {
                          const newActions = editingRule.actions.filter(
                            (_, idx) => idx !== i
                          );
                          setEditingRule({ ...editingRule, actions: newActions });
                        }}
                        className="text-red-600"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() =>
                    setEditingRule({
                      ...editingRule,
                      actions: [
                        ...editingRule.actions,
                        { actionType: "keep", value: undefined },
                      ],
                    })
                  }
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  + {t("sieve.addAction", "Action")}
                </button>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setEditingRule(null)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                {t("sieve.cancel")}
              </button>
              <button
                onClick={saveRule}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                {t("sieve.save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SieveEditor;
