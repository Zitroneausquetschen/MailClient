import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SpamCandidate } from "../types/mail";

interface Props {
  isOpen: boolean;
  candidates: SpamCandidate[];
  isScanning: boolean;
  onClose: () => void;
  onConfirm: (selectedUids: number[]) => Promise<void>;
}

function SpamReviewDialog({
  isOpen,
  candidates,
  isScanning,
  onClose,
  onConfirm,
}: Props) {
  const { t } = useTranslation();
  const [selectedUids, setSelectedUids] = useState<Set<number>>(new Set());
  const [isMoving, setIsMoving] = useState(false);

  // Initialize selection when candidates change
  useState(() => {
    // Pre-select all candidates with confidence >= 80
    const highConfidence = candidates
      .filter((c) => c.confidence >= 80)
      .map((c) => c.uid);
    setSelectedUids(new Set(highConfidence));
  });

  const toggleSelection = (uid: number) => {
    const newSelected = new Set(selectedUids);
    if (newSelected.has(uid)) {
      newSelected.delete(uid);
    } else {
      newSelected.add(uid);
    }
    setSelectedUids(newSelected);
  };

  const selectAll = () => {
    setSelectedUids(new Set(candidates.map((c) => c.uid)));
  };

  const selectNone = () => {
    setSelectedUids(new Set());
  };

  const handleConfirm = async () => {
    if (selectedUids.size === 0) return;
    setIsMoving(true);
    try {
      await onConfirm(Array.from(selectedUids));
      onClose();
    } finally {
      setIsMoving(false);
    }
  };

  if (!isOpen) return null;

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return "bg-red-100 text-red-800";
    if (confidence >= 60) return "bg-orange-100 text-orange-800";
    return "bg-yellow-100 text-yellow-800";
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 80) return t("spam.highConfidence");
    if (confidence >= 60) return t("spam.mediumConfidence");
    return t("spam.lowConfidence");
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
              <svg
                className="w-5 h-5 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold">{t("spam.reviewTitle")}</h2>
              <p className="text-sm text-gray-500">
                {isScanning
                  ? t("spam.scanning")
                  : t("spam.foundCount", { count: candidates.length })}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isScanning ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-4" />
              <p className="text-gray-600">{t("spam.analyzingEmails")}</p>
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <svg
                  className="w-8 h-8 text-green-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <p className="text-gray-600 font-medium">{t("spam.noSpamFound")}</p>
              <p className="text-gray-400 text-sm mt-1">{t("spam.inboxClean")}</p>
            </div>
          ) : (
            <>
              {/* Selection controls */}
              <div className="px-6 py-3 bg-gray-50 border-b flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button
                    onClick={selectAll}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    {t("spam.selectAll")}
                  </button>
                  <button
                    onClick={selectNone}
                    className="text-sm text-gray-600 hover:text-gray-800"
                  >
                    {t("spam.selectNone")}
                  </button>
                </div>
                <span className="text-sm text-gray-500">
                  {t("spam.selectedCount", { count: selectedUids.size })}
                </span>
              </div>

              {/* Spam list */}
              <div className="divide-y">
                {candidates.map((candidate) => (
                  <div
                    key={candidate.uid}
                    className={`px-6 py-4 flex items-start gap-4 hover:bg-gray-50 cursor-pointer ${
                      selectedUids.has(candidate.uid) ? "bg-blue-50" : ""
                    }`}
                    onClick={() => toggleSelection(candidate.uid)}
                  >
                    {/* Checkbox */}
                    <div className="pt-0.5">
                      <input
                        type="checkbox"
                        checked={selectedUids.has(candidate.uid)}
                        onChange={() => toggleSelection(candidate.uid)}
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                    </div>

                    {/* Email info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-gray-900 truncate">
                          {candidate.from}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${getConfidenceColor(
                            candidate.confidence
                          )}`}
                        >
                          {candidate.confidence}% {getConfidenceLabel(candidate.confidence)}
                        </span>
                      </div>
                      <p className="text-gray-700 truncate">{candidate.subject}</p>
                      <p className="text-sm text-gray-500 mt-1">{candidate.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex items-center justify-between bg-gray-50">
          <p className="text-xs text-gray-500">{t("spam.reviewHint")}</p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={isMoving}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            {candidates.length > 0 && (
              <button
                onClick={handleConfirm}
                disabled={isMoving || selectedUids.size === 0}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {isMoving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    {t("spam.moving")}
                  </>
                ) : (
                  <>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                    {t("spam.moveToSpam", { count: selectedUids.size })}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SpamReviewDialog;
