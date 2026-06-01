import React from 'react';
import { cn } from '../../lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'outline' | 'scada';
  className?: string;
  size?: 'xs' | 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({ 
  children, 
  variant = 'default', 
  className,
  size = 'sm'
}) => {
  const variants = {
    default: "bg-slate-100 text-slate-800 dark:bg-gray-800 dark:text-gray-200 border-slate-200 dark:border-gray-700",
    success: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/30",
    warning: "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-100 dark:border-amber-900/30",
    error: "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400 border-rose-100 dark:border-rose-900/30",
    info: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 border-blue-100 dark:border-blue-900/30",
    outline: "bg-transparent border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400",
    scada: "bg-slate-100 text-slate-800 dark:bg-black dark:text-white border-slate-300 dark:border-gray-800 font-mono tracking-tighter"
  };

  const sizes = {
    xs: "px-1.5 py-0.5 text-[8px]",
    sm: "px-2 py-0.5 text-[10px]",
    md: "px-2.5 py-1 text-xs"
  };

  return (
    <span className={cn(
      "inline-flex items-center font-black uppercase tracking-widest rounded-full border",
      variants[variant],
      sizes[size],
      className
    )}>
      {children}
    </span>
  );
};
