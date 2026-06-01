import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children?: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error caught by ErrorBoundary:", error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full flex flex-col items-center justify-center p-6 bg-red-50 dark:bg-slate-950 text-slate-900 dark:text-gray-100">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl p-8 border border-red-100 dark:border-red-950/50 shadow-2xl space-y-6 text-center">
            <div className="w-16 h-16 bg-red-50 dark:bg-red-950/20 rounded-full flex items-center justify-center mx-auto text-red-500 dark:text-red-400">
              <AlertTriangle size={36} />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-black uppercase tracking-tight text-red-600 dark:text-red-400">
                {this.props.fallbackTitle || "ERREUR D'AFFICHAGE"}
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed font-semibold">
                Une erreur inattendue est survenue lors de l'affichage de cet écran. Essayez de recharger ou de réinitialiser l'application.
              </p>
            </div>
            
            {this.state.error && (
              <div className="text-left bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-100 dark:border-slate-800 text-[10px] font-mono whitespace-pre-wrap overflow-x-auto max-h-40 text-red-500 scrollbar-thin">
                <strong>Error:</strong> {this.state.error.toString()}
                {this.state.error.stack && (
                  <div className="mt-2 text-slate-400 select-all">{this.state.error.stack}</div>
                )}
              </div>
            )}

            <div className="flex gap-3 justify-center">
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null, errorInfo: null });
                  window.location.reload();
                }}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black rounded-xl transition-all shadow-lg shadow-blue-500/20 active:scale-95 flex items-center gap-2"
              >
                <RefreshCw size={14} />
                RECHARGER LA PAGE
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
