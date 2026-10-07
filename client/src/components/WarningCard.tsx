import React from 'react';
import { AlertTriangle, Info, XCircle } from 'lucide-react';

export type WarningLevel = 'info' | 'warning' | 'error';

interface WarningCardProps {
  level: WarningLevel;
  title: string;
  message: string;
  onDismiss?: () => void;
}

export const WarningCard: React.FC<WarningCardProps> = ({ level, title, message, onDismiss }) => {
  const config = {
    info: {
      icon: Info,
      border: 'border-white/30',
      bg: 'bg-white/5',
      iconColor: 'text-neutral-300',
      titleColor: 'text-neutral-200',
      messageColor: 'text-neutral-300',
    },
    warning: {
      icon: AlertTriangle,
      border: 'border-white/30',
      bg: 'bg-white/5',
      iconColor: 'text-white',
      titleColor: 'text-neutral-200',
      messageColor: 'text-neutral-300',
    },
    error: {
      icon: XCircle,
      border: 'border-white/30',
      bg: 'bg-white/5',
      iconColor: 'text-white',
      titleColor: 'text-neutral-200',
      messageColor: 'text-neutral-300',
    },
  }[level];

  const Icon = config.icon;

  return (
    <div className={`rounded-xl border ${config.border} ${config.bg} p-4 flex gap-3`}>
      <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${config.iconColor}`} />
      <div className="flex-1 min-w-0">
        <h4 className={`text-sm font-semibold ${config.titleColor}`}>{title}</h4>
        <p className={`text-xs mt-1 leading-relaxed ${config.messageColor}`}>{message}</p>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-neutral-500 hover:text-neutral-300 transition-colors shrink-0">
          <XCircle className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

