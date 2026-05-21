import React from 'react';
import { cn } from '../../lib/utils';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'flat' | 'outline' | 'glass' | 'scada';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card: React.FC<CardProps> = ({ 
  children, 
  className, 
  variant = 'default',
  padding = 'md'
}) => {
  const variants = {
    default: "bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 shadow-sm md:shadow-md",
    flat: "bg-gray-50/50 dark:bg-gray-800/50 border border-transparent",
    outline: "bg-transparent border border-slate-200 dark:border-gray-800",
    glass: "bg-white/70 dark:bg-gray-900/70 backdrop-blur-md border border-white/20 dark:border-gray-800/20",
    scada: "bg-slate-900 dark:bg-black border-l-4 border-l-blue-600 border-y border-r border-slate-800 dark:border-gray-800 shadow-[2px_2px_10px_rgba(0,0,0,0.1)]"
  };

  const paddings = {
    none: "p-0",
    sm: "p-2 md:p-3",
    md: "p-3 md:p-5",
    lg: "p-4 md:p-8"
  };

  return (
    <div className={cn(
      "rounded-2xl md:rounded-3xl transition-all duration-300",
      variants[variant],
      paddings[padding],
      className
    )}>
      {children}
    </div>
  );
};
