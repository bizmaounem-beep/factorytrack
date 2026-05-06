import { useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import OperatorScreen from './components/OperatorScreen';
import PilotScreen from './components/PilotScreen';
import AdminPanel from './components/AdminPanel';
import { db } from './lib/firebase';
import { collection, getDocs, addDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Terminal, Database } from 'lucide-react';

export default function App() {
  const { user, loading } = useAuth();
  const [initializing, setInitializing] = useState(false);

  // Auto-bootstrap empty DB
  useEffect(() => {
    const bootstrap = async () => {
      const snap = await getDocs(collection(db, 'users'));
      if (snap.empty) {
        setInitializing(true);
        // Add default admin
        const adminRef = await addDoc(collection(db, 'users'), {
          name: 'Super Admin',
          pin: '0000',
          role: 'ADMIN'
        });
        
        // Add some types
        const types = [
          { name: 'Panne technique', icon: '🛠️' },
          { name: 'Changement programme', icon: '📦' },
          { name: 'Manque matière', icon: '🏗️' },
          { name: 'Pause repas', icon: '☕' },
          { name: 'Attente produit', icon: '⏳' },
          { name: 'Bourrage ligne', icon: '🛑' },
          { name: 'Problème traçabilité', icon: '🔎' }
        ];
        for (const t of types) {
          await addDoc(collection(db, 'downtime_types'), t);
        }

        // Add a default machine/line
        const machRef = await addDoc(collection(db, 'machines'), { name: 'Machine Central' });
        await addDoc(collection(db, 'lines'), { 
          name: 'Ligne Alpha', 
          machineId: machRef.id, 
          status: 'IDLE' 
        });

        window.location.reload();
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
