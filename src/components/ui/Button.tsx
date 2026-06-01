import React from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'outline' | 'scada';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  isLoading, 
  className,
  disabled,
  ...props 
}) => {
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-500/10 active:scale-95",
    secondary: "bg-slate-100 text-slate-800 dark:bg-gray-800 dark:text-gray-200 hover:bg-slate-200 dark:hover:bg-gray-700 active:scale-95",
    danger: "bg-rose-600 text-white hover:bg-rose-700 shadow-md shadow-rose-500/10 active:scale-95",
    success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-md shadow-emerald-500/10 active:scale-95",
    ghost: "bg-transparent hover:bg-slate-100 dark:hover:bg-gray-800 text-slate-600 dark:text-gray-400 active:scale-95",
    outline: "bg-transparent border border-slate-200 dark:border-gray-700 hover:border-slate-300 dark:hover:border-gray-600 text-slate-700 dark:text-gray-300 active:scale-95",
    scada: "bg-slate-100 text-slate-900 dark:bg-black dark:text-white border border-slate-300 dark:border-gray-800 hover:bg-slate-200 dark:hover:bg-slate-900 font-mono tracking-tighter shadow-md active:scale-[0.98]"
  };

  const sizes = {
    sm: "h-8 px-3 text-[10px]",
    md: "h-11 px-6 text-[12px] md:h-12 md:px-8 md:text-sm",
    lg: "h-14 px-10 text-sm md:text-base md:h-16",
    icon: "h-10 w-10 p-0 md:h-12 md:w-12 transition-all"
  };

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-black uppercase tracking-widest transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className
      )}
      disabled={isLoading || disabled}
      {...props}
    >
      {isLoading ? (
        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : children}
    </button>
  );
};
