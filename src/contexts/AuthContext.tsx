import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../types';
import { loginLocal, setupSecurityLocal } from '../lib/localApi';

interface AuthContextType {
  user: User | null;
  login: (credentials: { pin?: string; username?: string; password?: string }) => Promise<boolean>;
  setupSecurity: (username: string, password?: string) => Promise<boolean>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for persisted user session
    const savedUser = localStorage.getItem('factory_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  const login = async (credentials: { pin?: string; username?: string; password?: string }) => {
    try {
      const foundUser = await loginLocal(credentials);
      
      if (foundUser) {
        setUser(foundUser);
        localStorage.setItem('factory_user', JSON.stringify(foundUser));
        return true;
      }
      return false;
    } catch (error) {
      // Re-throw the friendly error message
      throw error;
    }
  };

  const setupSecurity = async (username: string, password?: string) => {
    if (!user) return false;
    try {
      const result = await setupSecurityLocal({ userId: user.id, username, password });
      if (result.success) {
        // Refresh local user state
        const updatedUser = { ...user, username, password_hash: 'SET', pin: undefined };
        setUser(updatedUser);
        localStorage.setItem('factory_user', JSON.stringify(updatedUser));
        return true;
      }
      return false;
    } catch (error) {
      throw error;
    }
  };

  const logout = () => {
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
