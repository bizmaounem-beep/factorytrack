import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, User, Eye, EyeOff, Loader2, Sun, Moon } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    setIsLoading(true);
    setError(null);

    try {
      const success = await login(username, password);
      if (!success) {
        setError('Identifiants incorrects');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center p-4 transition-colors duration-300">
      <div className="absolute top-4 right-4">
        <button 
          onClick={toggleTheme}
          className="w-12 h-12 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-900 rounded-full transition-all shadow-sm dark:shadow-none border border-transparent hover:border-gray-100 dark:hover:border-gray-800"
          title="Changer le thème"
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-white dark:bg-gray-900 p-8 rounded-2xl shadow-xl dark:shadow-none space-y-6 border border-gray-100 dark:border-gray-800"
      >
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center text-blue-600 mb-2">
            <Lock size={24} />
          </div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tighter italic uppercase">FACTORY<span className="text-blue-600">CLOUD</span></h1>
          <p className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 tracking-widest">Connectez-vous à votre session</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[9px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">Utilisateur</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400 dark:text-gray-500 group-focus-within:text-blue-500 transition-colors">
                <User size={18} />
              </div>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-11 pr-4 h-14 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-800 rounded-2xl text-sm font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600"
                placeholder="Nom d'utilisateur"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[9px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">Mot de passe</label>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400 dark:text-gray-500 group-focus-within:text-blue-500 transition-colors">
                <Lock size={18} />
              </div>
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-11 pr-12 h-14 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-800 rounded-2xl text-sm font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600"
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 w-12 flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors rounded-r-2xl"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 rounded-xl p-3"
              >
                <p className="text-center text-red-500 dark:text-red-400 text-[10px] font-black uppercase tracking-tight">
                  {error}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="submit"
            disabled={!username || !password || isLoading}
            className="w-full h-12 rounded-full flex items-center justify-center bg-blue-600 text-white font-black uppercase text-xs tracking-widest disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 hover:bg-blue-700 active:scale-[0.98] transition-all shadow-lg shadow-blue-500/20 disabled:shadow-none"
          >
            {isLoading ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              "Se Connecter"
            )}
          </button>
        </form>
      </motion.div>
      <p className="mt-8 text-[9px] font-black text-gray-300 dark:text-gray-700 uppercase tracking-widest">
        &copy; {new Date().getFullYear()} FACTORYCLOUD System
      </p>
    </div>
  );
}

