import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../types';
import { loginLocal } from '../lib/localApi';

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<boolean>;
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
      try {
        const parsed = JSON.parse(savedUser);
        if (parsed && parsed.role) {
          parsed.role = parsed.role.toUpperCase() as any;
        }
        setUser(parsed);
      } catch (err) {
        console.error('Error parsing loaded user', err);
      }
    }
    setLoading(false);
  }, []);

  const login = async (username: string, password: string) => {
    try {
      const foundUser = await loginLocal(username, password);
      
      if (foundUser) {
        // Normalize role to uppercase in login response handler
        if (foundUser.role) {
          foundUser.role = foundUser.role.toUpperCase();
        }
        // Save token separately for API auth headers
        if (foundUser.token) {
          localStorage.setItem('factory_token', foundUser.token);
        }
        // Save user without the token in the user state
        const { token, ...userWithoutToken } = foundUser;
        setUser(userWithoutToken);
        localStorage.setItem('factory_user', JSON.stringify(userWithoutToken));
        return true;
      }
      return false;
    } catch (error) {
      // Re-throw the friendly error message
      throw error;
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('factory_user');
    localStorage.removeItem('factory_token');
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
