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
    console.log(`[Auth] Attempting login with identity: "${pin}" (treating PIN as Username)`);
    try {
      // Identity can be either 'username' or 'email'
      // password length must be at least 4 (as configured in PB)
      const authData = await pb.collection('users').authWithPassword(pin, pin);
      
      if (authData.record) {
        console.log('[Auth] Login successful for user:', authData.record.username);
        // User state will be updated via the onChange listener in useEffect
        return true;
      }
      return false;
    } catch (error: any) {
      console.error('[Auth] Login failed error details:', error);
      
      if (error?.status) {
        const errorMsg = error.data?.message || error.message || 'Unknown error';
        console.error(`PocketBase Response Error [${error.status}]:`, errorMsg);
        
        if (error.status === 400) {
          console.error("DEBUG TIP: 400 usually means password mismatch or identity not found. Verify you created a user in PocketBase with Username = Password = your PIN.");
          if (error.data) console.error("Server validation data:", JSON.stringify(error.data, null, 2));
        } else if (error.status === 404) {
          console.error("DEBUG TIP: 404 means the 'users' collection or auth endpoint was not found.");
        } else if (error.status === 403) {
          console.error("DEBUG TIP: 403 Forbidden. Check your collection API rules.");
        }
      } else if (error?.originalError?.message === 'Failed to fetch' || error?.message?.includes('Failed to fetch') || error?.isAbort) {
        console.error(`CONNECTION ERROR: Cannot reach PocketBase at ${pb.baseUrl}. If PB is local, ensure it's running and check browser CORS console errors.`);
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
