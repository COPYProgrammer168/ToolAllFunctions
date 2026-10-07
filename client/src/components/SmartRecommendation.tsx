import React from 'react';
import { Sparkles, CheckCircle2 } from 'lucide-react';
import type { OptimizationReport } from '../types';

interface SmartRecommendationProps {
  report: OptimizationReport;
  onApply: () => void;
  onCustomize: () => void;
}

export const SmartRecommendation: React.FC<SmartRecommendationProps> = ({ report, onApply, onCustomize }) => {
  return (
    <div className="glass-panel rounded-2xl border border-white/20 overflow-hidden">
      <div className="bg-gradient-to-r from-white/10 via-white/10 to-transparent p-5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-white" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-white">Recommended Optimization</h3>
        </div>
        <p className="text-xs text-neutral-400 mt-2 leading-relaxed">{report.recommendations.summary}</p>
      </div>

      <div className="p-5 space-y-3">
        <div className="grid grid-cols-1 gap-2">
          {report.recommendations.details.map((detail: string, idx: number) => (
            <div key={idx} className="flex items-start gap-2.5 text-sm">
              <CheckCircle2 className="w-4 h-4 text-white shrink-0 mt-0.5" />
              <span className="text-neutral-300 leading-snug">{detail}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-3">
          <button
            onClick={onApply}
            className="flex-1 py-3 px-4 rounded-xl bg-white hover:bg-neutral-200 text-black font-bold text-sm transition-all shadow-lg shadow-white/20"
          >
            Apply Recommendation
          </button>
          <button
            onClick={onCustomize}
            className="py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-neutral-200 font-medium text-sm transition-all"
          >
            Customize Settings
          </button>
        </div>
      </div>
    </div>
  );
};

