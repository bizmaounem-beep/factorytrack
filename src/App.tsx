import { useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import OperatorScreen from './components/OperatorScreen';
import PilotScreen from './components/PilotScreen';
import AdminPanel from './components/AdminPanel';
import { localApi } from './lib/localApi';
import { useEffect, useState } from 'react';
import { Terminal } from 'lucide-react';

export default function App() {
  const { user, loading } = useAuth();
  const [initializing, setInitializing] = useState(false);

  // Auto-bootstrap empty DB
  useEffect(() => {
    const bootstrap = async () => {
      try {
        const users = await localApi.getCollection('users');
        if (users.length === 0) {
          setInitializing(true);
          // Add default admin
          const adminRef = await localApi.addDoc('users', {
            name: 'Super Admin',
            pin: '0000',
            role: 'ADMIN'
          });
          
          // Add some types
          const types = [
            { id: '1', name: 'Panne technique', icon: '🛠️' },
            { id: '2', name: 'Changement programme', icon: '📦' },
            { id: '3', name: 'Manque matière', icon: '🏗️' },
            { id: '4', name: 'Pause repas', icon: '☕' },
            { id: '5', name: 'Attente produit', icon: '⏳' },
            { id: '6', name: 'Bourrage ligne', icon: '🛑' },
            { id: '7', name: 'Problème traçabilité', icon: '🔎' }
          ];
          for (const t of types) {
            await localApi.addDoc('downtime_types', t);
          }

          // Add a default machine/line
          const machRef = await localApi.addDoc('machines', { id: 'm1', name: 'Machine Central' });
          await localApi.addDoc('lines', { 
            id: 'l1',
            name: 'Ligne Alpha', 
            machineId: machRef.id, 
            status: 'IDLE' 
          });

          window.location.reload();
        }
      } catch (e) {
        console.error('Bootstrap error:', e);
      }
    };
    bootstrap();
  }, []);

  if (loading || initializing) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center p-8 bg-gray-50 space-y-4">
        <Terminal className="text-blue-600 animate-pulse" size={48} />
        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-900 italic">Initialisation...</h2>
          <p className="text-sm text-gray-500">Préparation du système industriel</p>
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
           Accès Refusé: Rôle inconnu
        </div>
      );
  }
}
