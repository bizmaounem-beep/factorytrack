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
    const mapUser = (model: any): User | null => {
      if (!model) return null;
      return {
        id: model.id,
        name: model.name || model.username || 'User',
        pin: model.pin || '',
        role: model.role || 'OPERATOR'
      } as User;
    };

    // Check for persisted user session
    if (pb.authStore.isValid) {
      setUser(mapUser(pb.authStore.model));
    }
    setLoading(false);

    // Listen to auth changes
    return pb.authStore.onChange((token, model) => {
      setUser(mapUser(model));
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
        const record = authData.record;
        const fullUser = {
          id: record.id,
          name: record.name || record.username || 'User',
          pin: (record as any).pin || '',
          role: (record as any).role || 'OPERATOR'
        } as User;
        
        setUser(fullUser);
        return true;
      }
      return false;
    } catch (error: any) {
      // Detailed error logging for migration debugging
      console.error('Full PocketBase Error Object:', error);
      
      if (error?.status) {
        const errorMsg = error.data?.message || error.message || 'Unknown error';
        console.log(`PocketBase Auth Error [${error.status}]:`, errorMsg);
        
        if (error.status === 400) {
          console.error("Login Result: 400 Bad Request. (Usually Identity/Password mismatch, password too short, or 'Username' not allowed as identity). Check if your User in PocketBase has username == password == PIN.");
          if (error.data) console.error("Validation details:", JSON.stringify(error.data, null, 2));
        } else if (error.status === 404) {
          console.error("Login Result: 404 Not Found. (Check if 'users' collection exists and is an auth type)");
        } else if (error.status === 403) {
          console.error("Login Result: 403 Forbidden. (Check collection API rules)");
        }
      } else if (error?.originalError?.message === 'Failed to fetch' || error?.message?.includes('Failed to fetch') || error?.isAbort) {
        console.error('CONNECTION ERROR: Could not reach PocketBase server at ' + pb.baseUrl + '. \n1. Check if PocketBase is running.\n2. Ensure your firewall allows port 8090.\n3. Make sure you are on the same local network.');
      } else {
        console.error('Unexpected Login Error:', error?.message || error);
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
