import { useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import OperatorScreen from './components/OperatorScreen';
import PilotScreen from './components/PilotScreen';
import AdminPanel from './components/AdminPanel';
import { pb } from './lib/pocketbase';
import { useEffect, useState } from 'react';
import { Terminal } from 'lucide-react';

export default function App() {
  const { user, loading } = useAuth();
  const [initializing, setInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-bootstrap empty DB
  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      try {
        // We use getList on users to verify connectivity and check if the database is fresh
        const snap = await pb.collection('users').getList(1, 1, { 
          requestKey: 'bootstrap',
          // Set a short timeout for the connection check
          $timeout: 5000 
        });

        if (snap.totalItems === 0 && isMounted) {
          setInitializing(true);
          console.log('Database appears empty, starting bootstrap...');
          
          // Add default admin
          try {
            await pb.collection('users').create({
              name: 'Super Admin',
              pin: '0000',
              role: 'ADMIN',
              username: 'admin0000',
              password: 'password123',
              passwordConfirm: 'password123',
              emailVisibility: true
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
              await pb.collection('downtime_types').create(t);
            }

            // Add a default machine/line
            const machine = await pb.collection('machines').create({ name: 'Machine Central' });
            await pb.collection('lines').create({ 
              name: 'Ligne Alpha', 
              machineId: machine.id, 
              status: 'IDLE' 
            });

            console.log('Bootstrap complete!');
            if (isMounted) window.location.reload();
          } catch (createErr: any) {
            console.error('Failed to create bootstrap data:', createErr);
            setError("Erreur lors de l'initialisation des données. Vérifiez que vos collections existantes sont vides ou correspondent au schéma (champs: pin, role, etc.).");
            setInitializing(false);
          }
        }
      } catch (err: any) {
        if (err.isAbort) return;
        
        console.error('PocketBase connection error:', err);
        
        let message = "Impossible de contacter le serveur PocketBase.";
        if (err.status === 0) {
          message = `Connexion refusée sur ${pb.baseUrl}. Vérifiez que PocketBase est lancé et que le port est ouvert.`;
        } else if (err.status === 404) {
          message = "La collection 'users' n'existe pas dans PocketBase. Créez-la d'abord.";
        } else if (err.message) {
          message = `Erreur serveur : ${err.message}`;
        }
        
        setError(message);
      }
    };
    bootstrap();

    return () => { isMounted = false; };
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4">
          <Terminal size={32} />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Erreur de Connexion</h1>
        <p className="text-gray-500 max-w-xs">{error}</p>
        <button 
          onClick={() => window.location.reload()}
          className="mt-6 px-6 py-2 bg-blue-600 text-white rounded-lg font-bold"
        >
          Réessayer
        </button>
      </div>
    );
  }

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
