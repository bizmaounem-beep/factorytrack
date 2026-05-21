import React from 'react';
import { cn } from '../../lib/utils';
import { motion } from 'motion/react';

interface StatusIndicatorProps {
  status: 'running' | 'fault' | 'warning' | 'stopped' | 'idle';
  label?: string;
  className?: string;
  animate?: boolean;
}

export const StatusIndicator: React.FC<StatusIndicatorProps> = ({ 
  status, 
  label, 
  className,
  animate = true
}) => {
  const configs = {
    running: {
      color: "bg-emerald-500",
      bg: "bg-emerald-500/10",
      text: "text-emerald-500",
      label: "Running"
    },
    fault: {
      color: "bg-rose-500",
      bg: "bg-rose-500/10",
      text: "text-rose-500",
      label: "Fault"
    },
    warning: {
      color: "bg-amber-500",
      bg: "bg-amber-500/10",
      text: "text-amber-500",
      label: "Warning"
    },
    stopped: {
      color: "bg-slate-500",
      bg: "bg-slate-500/10",
      text: "text-slate-500",
      label: "Stopped"
    },
    idle: {
      color: "bg-blue-400",
      bg: "bg-blue-400/10",
      text: "text-blue-400",
      label: "Idle"
    }
  };

  const config = configs[status];

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div className={cn(
        "relative flex items-center justify-center w-3 h-3 rounded-full",
        config.bg
      )}>
        <div className={cn("w-1.5 h-1.5 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.1)]", config.color)} />
        {animate && (status === 'running' || status === 'fault') && (
          <motion.div
            initial={{ scale: 0.5, opacity: 0.8 }}
            animate={{ scale: 2.2, opacity: 0 }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeOut" }}
            className={cn("absolute w-full h-full rounded-full", config.color)}
          />
        )}
      </div>
      {label && (
        <span className={cn("text-[9px] font-black uppercase tracking-widest", config.text)}>
          {label || config.label}
        </span>
      )}
    </div>
  );
};
