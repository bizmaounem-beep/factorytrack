import { useAuth } from './contexts/AuthContext';
import { useLanguage } from './contexts/LanguageContext';
import Login from './components/Login';
import OperatorScreen from './components/OperatorScreen';
import PilotScreen from './components/PilotScreen';
import AdminPanel from './components/AdminPanel';
import { localApi } from './lib/localApi';
import { useEffect, useState } from 'react';
import { Terminal } from 'lucide-react';

export default function App() {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const [initializing, setInitializing] = useState(false);

  // Auto-bootstrap check removed - Handled by server seeding
  useEffect(() => {
    // We could still check if DB is ready here if needed
  }, []);

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

  if (!user) {
    return <Login />;
  }

  switch (user.role) {
    case 'ADMIN':
      return <AdminPanel />;
    case 'PILOT':
      return <PilotScreen />;
    case 'OPERATOR':
      return <OperatorScreen />;
    default:
      return (
        <div className="p-8 text-center bg-red-50 rounded-2xl m-4 text-red-600 font-bold border-2 border-red-100">
           {t('access_denied')}
        </div>
      );
  }
}
