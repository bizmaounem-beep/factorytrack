import { useAuth } from './contexts/AuthContext';
import { useLanguage } from './contexts/LanguageContext';
import Login from './components/Login';
import OperatorScreen from './components/OperatorScreen';
import PilotScreen from './components/PilotScreen';
import AdminPanel from './components/AdminPanel';
import { useEffect, useState } from 'react';
import { Terminal, Download, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

export default function App() {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const [initializing] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setShowInstallBanner(false);
    }
  };

  if (loading || initializing) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center p-8 bg-gray-50 space-y-4">
        <Terminal className="text-blue-600 animate-pulse" size={48} />
        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-900 italic">{t('initialization')}</h2>
          <p className="text-sm text-gray-500">{t('system_prep')}</p>
        </div>
      </div>
    );
  }

  const renderContent = () => {
    if (!user) return <Login />;

    const userRole = user.role ? user.role.toUpperCase() : '';

    if (userRole === 'ADMIN') {
      return (
        <ErrorBoundary fallbackTitle="PANEL ADMIN">
          <AdminPanel />
        </ErrorBoundary>
      );
    }
    if (userRole === 'OPERATOR') {
      return (
        <ErrorBoundary fallbackTitle="ÉCRAN OPÉRATEUR">
          <OperatorScreen />
        </ErrorBoundary>
      );
    }
    if (userRole === 'PILOT') {
      return (
        <ErrorBoundary fallbackTitle="ÉCRAN PILOTE">
          <PilotScreen />
        </ErrorBoundary>
      );
    }

    return (
      <div className="p-8 text-center bg-red-50 rounded-2xl m-4 text-red-600 font-bold border-2 border-red-100">
         {t('access_denied')}
      </div>
    );
  };

  return (
    <>
      {renderContent()}

      <AnimatePresence>
        {showInstallBanner && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-md"
          >
            <div className="bg-white text-slate-900 p-4 rounded-2xl shadow-2xl flex items-center justify-between border border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-inner">
                  <Download size={20} className="text-white" />
                </div>
                <div>
                  <h4 className="text-sm font-bold leading-tight font-sans">Installer Team Maintenance</h4>
                  <p className="text-[10px] text-gray-500 font-medium">Pour un accès rapide et hors-ligne</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleInstall}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black rounded-lg transition-colors shadow-lg shadow-blue-500/20"
                >
                  INSTALLER
                </button>
                <button 
                  onClick={() => setShowInstallBanner(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
