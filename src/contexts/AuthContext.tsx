import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { pb } from '../lib/pocketbase';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  login: (pin: string) => Promise<boolean>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for persisted user session
    if (pb.authStore.isValid) {
      setUser(pb.authStore.model as unknown as User);
    }
    setLoading(false);

    // Listen to auth changes
    return pb.authStore.onChange((token, model) => {
      setUser(model as unknown as User);
    });
  }, []);

  const login = async (pin: string) => {
    try {
      // Assuming PIN is both username and password for simplicity in this offline environment
      // Or you can configure your PocketBase users to have username='admin' password='pin'
      const authData = await pb.collection('users').authWithPassword(pin, pin);
      
      if (authData.record) {
        setUser(authData.record as unknown as User);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  };

  const logout = () => {
    pb.authStore.clear();
    setUser(null);
    localStorage.removeItem('factory_user');
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
