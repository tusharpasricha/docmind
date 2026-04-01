'use client';

import { useState } from 'react';

const PRESETS = [
  {
    id: 'precise',
    emoji: '📋',
    name: 'Precise',
    subtitle: 'Best for factual Q&A',
    values: { similarity_threshold: 0.60, top_k: 3, temperature: 0.0 },
  },
  {
    id: 'thorough',
    emoji: '🔍',
    name: 'Thorough',
    subtitle: 'Best for deep dives',
    values: { similarity_threshold: 0.35, top_k: 7, temperature: 0.1 },
  },
  {
    id: 'explore',
    emoji: '💡',
    name: 'Explore',
    subtitle: 'Best for open-ended',
    values: { similarity_threshold: 0.20, top_k: 10, temperature: 0.5 },
  },
];

const SLIDERS = [
  {
    key: 'similarity_threshold',
    question: 'How strictly should I match your question to the document?',
    leftLabel: 'Broad',
    rightLabel: 'Strict',
    leftSub: 'Casting a wide net',
    rightSub: 'Only exact matches',
    min: 0.0,
    max: 1.0,
    step: 0.05,
    format: (v) => v.toFixed(2),
    tooltip:
      "DocMind only uses document sections that score above this threshold for similarity to your question. Lower = more results but possibly less relevant. Higher = fewer but more precise results. If you get 'no relevant sections found', lower this value.",
  },
  {
    key: 'top_k',
    question: 'How much of the document should I consider?',
    leftLabel: 'Less',
    rightLabel: 'More',
    leftSub: 'Faster, focused answers',
    rightSub: 'Thorough, broader answers',
    min: 1,
    max: 10,
    step: 1,
    format: (v) => String(Math.round(v)),
    tooltip:
      'Controls how many sections of the document the AI reads before answering. More sections = more complete answers for complex questions, but slightly slower. For simple factual questions, less is better.',
  },
  {
    key: 'temperature',
    question: 'How should the answer be written?',
    leftLabel: 'Precise',
    rightLabel: 'Creative',
    leftSub: 'Sticks closely to the text',
    rightSub: 'Interprets and connects ideas',
    min: 0.0,
    max: 1.0,
    step: 0.05,
    format: (v) => v.toFixed(2),
    tooltip:
      "At 'Precise', the AI stays as close as possible to the document's exact wording — best for compliance and legal review. At 'Creative', it interprets, infers, and connects ideas more freely — better for exploration and discovery.",
  },
];

function SliderRow({ sliderConfig, value, onChange }) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const { key, question, leftLabel, rightLabel, leftSub, rightSub, min, max, step, format, tooltip } = sliderConfig;

  return (
    <div className="mb-5">
      {/* Question label + info icon */}
      <div className="flex items-center gap-1.5 mb-2 relative">
        <span className="font-medium text-gray-700 text-sm">{question}</span>
        <div className="relative inline-block">
          <button
            className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
            onMouseEnter={() => setTooltipVisible(true)}
            onMouseLeave={() => setTooltipVisible(false)}
            aria-label="More info"
            type="button"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          </button>
          {/* Tooltip */}
          <div
            className="absolute left-6 top-0 z-50 max-w-[260px] bg-gray-900 text-white text-xs rounded-lg p-2.5 pointer-events-none"
            style={{
              opacity: tooltipVisible ? 1 : 0,
              transition: 'opacity 0.15s ease',
              width: '260px',
            }}
          >
            {tooltip}
          </div>
        </div>
      </div>

      {/* Slider row: left label + input + right label */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 w-12 text-right flex-shrink-0">{leftLabel}</span>
        <input
          type="range"
          className="docmind-slider flex-1"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const raw = parseFloat(e.target.value);
            onChange(key, key === 'top_k' ? Math.round(raw) : raw);
          }}
        />
        <span className="text-xs text-gray-400 w-12 flex-shrink-0">{rightLabel}</span>
      </div>

      {/* Sub-labels row */}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-gray-400 italic w-12 text-right flex-shrink-0">{leftSub}</span>
        <div className="flex-1" />
        <span className="text-xs text-gray-400 italic w-12 flex-shrink-0text-right">{rightSub}</span>
      </div>
    </div>
  );
}

export default function SettingsPanel({ settings, onChange, onClose, isOpen }) {
  // Detect active preset by comparing current settings to each preset's values
  const activePreset = PRESETS.find(
    (p) =>
      p.values.similarity_threshold === settings.similarity_threshold &&
      p.values.top_k === settings.top_k &&
      p.values.temperature === settings.temperature
  );

  const handleSliderChange = (key, value) => {
    onChange({ ...settings, [key]: value });
  };

  const applyPreset = (preset) => {
    onChange({ ...preset.values });
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-30"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-40 flex flex-col transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚙️</span>
            <h2 className="font-semibold text-gray-800 text-sm">Query Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Close settings"
            type="button"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Presets section */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Presets</p>
              {!activePreset && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100">
                  Custom
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {PRESETS.map((preset) => {
                const isActive = activePreset?.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => applyPreset(preset)}
                    type="button"
                    className={`flex-1 flex flex-col items-center gap-0.5 px-2 py-2.5 rounded-xl border text-center transition-all ${
                      isActive
                        ? 'border-blue-400 bg-blue-50 text-blue-700'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-base leading-none">{preset.emoji}</span>
                    <span className="text-xs font-semibold leading-tight mt-1">{preset.name}</span>
                    <span className="text-[10px] text-gray-400 leading-tight">{preset.subtitle}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-100 mb-5" />

          {/* Sliders */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-4">
              Fine-tune
            </p>
            {SLIDERS.map((sliderConfig) => (
              <SliderRow
                key={sliderConfig.key}
                sliderConfig={sliderConfig}
                value={settings[sliderConfig.key]}
                onChange={handleSliderChange}
              />
            ))}
          </div>
        </div>

        {/* Live values footer */}
        <div className="px-5 py-4 border-t border-gray-100">
          <div className="font-mono text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
            Threshold: {settings.similarity_threshold.toFixed(2)} · Context: {settings.top_k} chunks · Temperature: {settings.temperature.toFixed(2)}
          </div>
        </div>
      </div>
    </>
  );
}
