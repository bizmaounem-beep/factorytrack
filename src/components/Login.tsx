import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { motion } from 'motion/react';
import { Lock, Delete, ArrowRight, User as UserIcon, Key } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

export default function Login() {
  const { t } = useLanguage();
  const [loginMode, setLoginMode] = useState<'PIN' | 'PASSWORD'>('PASSWORD');
  const [pin, setPin] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { login } = useAuth();

  const handleKeyPress = (num: string) => {
    if (pin.length < 4) {
      setPin(prev => prev + num);
      setError(null);
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleSubmit = async () => {
    try {
      setError(null);
      let success = false;
      if (loginMode === 'PIN') {
        if (pin.length === 4) {
          success = await login({ pin });
        }
      } else {
        if (username && password) {
          success = await login({ username, password });
        } else {
          setError('Veuillez remplir tous les champs');
          return;
        }
      }
      
      if (!success) {
        setError(loginMode === 'PIN' ? 'Code PIN incorrect' : 'Identifiants invalides');
        if (loginMode === 'PIN') setPin('');
      }
    } catch (err) {
      setError((err as Error).message);
      if (loginMode === 'PIN') setPin('');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gray-50">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-white p-8 rounded-[32px] shadow-2xl space-y-6 border border-gray-100"
      >
        <div className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-200 mb-2">
            <Lock size={28} />
          </div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tighter italic">PILOT<span className="text-blue-600">CLOUD</span></h1>
          <p className="text-[10px] uppercase font-black text-gray-400 tracking-widest">{loginMode === 'PIN' ? 'Mode Hérité : Code PIN' : 'Connexion Sécurisée'}</p>
        </div>

        {/* Toggle between modes */}
        <div className="flex p-1 bg-gray-100 rounded-xl">
          <button 
            onClick={() => { setLoginMode('PASSWORD'); setError(null); }}
            className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${loginMode === 'PASSWORD' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >
            Utilisateur
          </button>
          <button 
            onClick={() => { setLoginMode('PIN'); setError(null); }}
            className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${loginMode === 'PIN' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >
            Code PIN
          </button>
        </div>

        {loginMode === 'PASSWORD' ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Identifiant</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                  <UserIcon size={18} />
                </div>
                <input 
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full pl-11 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold transition-all"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Mot de passe</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-400">
                  <Key size={18} />
                </div>
                <input 
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  placeholder="••••••••"
                  className="w-full pl-11 pr-4 py-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none font-bold transition-all"
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex justify-center gap-3 py-2">
              {[...Array(4)].map((_, i) => (
                <div 
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                    pin.length > i 
                      ? 'bg-blue-600 border-blue-600 scale-110' 
                      : error ? 'border-red-400' : 'border-gray-200'
                  }`}
                />
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  onClick={() => handleKeyPress(num.toString())}
                  className="h-14 rounded-2xl text-xl font-black bg-gray-50 text-gray-900 hover:bg-blue-50 hover:text-blue-600 active:scale-95 transition-all border border-gray-100"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={handleDelete}
                className="h-14 rounded-2xl flex items-center justify-center bg-gray-50 text-gray-400 hover:bg-red-50 hover:text-red-500 active:scale-95 transition-all border border-gray-100"
              >
                <Delete size={22} />
              </button>
              <button
                onClick={() => handleKeyPress('0')}
                className="h-14 rounded-2xl text-xl font-black bg-gray-50 text-gray-900 hover:bg-blue-50 hover:text-blue-600 active:scale-95 transition-all border border-gray-100"
              >
                0
              </button>
              <div className="flex items-center justify-center">
                <div className="w-1.5 h-1.5 bg-gray-200 rounded-full" />
              </div>
            </div>
          </>
        )}

        {error && (
          <p className="text-center text-red-500 text-[10px] font-black uppercase bg-red-50 py-2 rounded-lg border border-red-100">
            {error}
          </p>
        )}

        <button
          onClick={handleSubmit}
          className="w-full h-16 rounded-2xl flex items-center justify-center bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98] transition-all shadow-xl shadow-blue-200 font-black text-xs uppercase tracking-widest space-x-2"
        >
          <span>Connexion</span>
          <ArrowRight size={20} />
        </button>

        <p className="text-center text-[9px] text-gray-400 font-medium px-4">
          Le mode PIN sera désactivé après votre première migration vers Identifiant + Mot de passe.
        </p>
      </motion.div>
    </div>
  );
}
