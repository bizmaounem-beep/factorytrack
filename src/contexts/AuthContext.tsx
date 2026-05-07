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
      // PocketBase authWithPassword(identity, password) 
      // Identity can be either 'username' or 'email'
      // We are treating the PIN as both the Username identity and the Password
      const authData = await pb.collection('users').authWithPassword(pin, pin);
      
      if (authData.record) {
        // Successful login
        setUser(authData.record as unknown as User);
        return true;
      }
      return false;
    } catch (error: any) {
      // Detailed error logging for migration debugging
      if (error?.status) {
        console.log(`PocketBase Auth Error [${error.status}]:`, error.data || error.message);
        
        if (error.status === 400) {
          console.error("Login Result: 400 Bad Request. (Usually Identity/Password mismatch or password too short)");
        } else if (error.status === 404) {
          console.error("Login Result: 404 Not Found. (Check if 'users' collection exists and is an auth type)");
        }
      } else {
        console.error('Unexpected Login Error:', error);
      }
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
