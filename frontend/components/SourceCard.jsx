'use client';

import { useState } from 'react';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';

function ScorePill({ score }) {
  const num = parseInt(score);
  let color = 'bg-orange-100 text-orange-700';
  if (num >= 80) color = 'bg-green-100 text-green-700';
  else if (num >= 60) color = 'bg-yellow-100 text-yellow-700';

  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>{score}</span>
  );
}

export default function SourceCard({ source }) {
  const [expanded, setExpanded] = useState(false);
  const preview = source.preview?.slice(0, 150) || '';
  const full = source.preview || '';

  return (
    <div className="border border-gray-100 rounded-xl p-3 bg-gray-50 text-sm">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded text-white text-xs font-bold flex-shrink-0"
            style={{ backgroundColor: '#4472C4' }}
          >
            {source.index}
          </span>
          <div className="flex items-center gap-1.5 text-gray-500">
            <FileText size={12} />
            <span className="text-xs truncate max-w-[140px]">{source.filename}</span>
          </div>
        </div>
        <ScorePill score={source.score} />
      </div>

      <p className="text-xs text-gray-600 leading-relaxed">
        {expanded ? full : preview}
        {full.length > 150 && !expanded && '…'}
      </p>

      {full.length > 150 && (
        <button
          onClick={() => setExpanded((p) => !p)}
          className="mt-1.5 flex items-center gap-1 text-xs font-medium"
          style={{ color: '#4472C4' }}
        >
          {expanded ? (
            <>
              <ChevronUp size={12} /> Show less
            </>
          ) : (
            <>
              <ChevronDown size={12} /> Show more
            </>
          )}
        </button>
      )}
    </div>
  );
}
