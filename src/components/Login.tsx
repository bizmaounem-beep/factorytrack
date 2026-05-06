import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { motion } from 'motion/react';
import { Lock, Delete, ArrowRight } from 'lucide-react';

export default function Login() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const { login } = useAuth();

  const handleKeyPress = (num: string) => {
    if (pin.length < 4) {
      setPin(prev => prev + num);
      setError(false);
    }
  };

  const handleDelete = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleSubmit = async () => {
    if (pin.length === 4) {
      const success = await login(pin);
      if (!success) {
        setError(true);
        setPin('');
      }
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-white p-8 rounded-2xl shadow-xl space-y-8 border border-gray-100"
      >
        <div className="text-center space-y-2">
          <div className="mx-auto w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 mb-4">
            <Lock size={24} />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">FactoryTrack Pro</h1>
          <p className="text-sm text-gray-500">Entrez votre code PIN pour continuer</p>
        </div>

        <div className="flex justify-center gap-4 py-4">
          {[...Array(4)].map((_, i) => (
            <div 
              key={i}
              className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                pin.length > i 
                  ? 'bg-blue-600 border-blue-600' 
                  : error ? 'border-red-400' : 'border-gray-300'
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="text-center text-red-500 text-sm font-medium animate-pulse">
            Code PIN incorrect
          </p>
        )}

        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              onClick={() => handleKeyPress(num.toString())}
              className="h-16 rounded-xl text-xl font-semibold bg-gray-50 text-gray-700 hover:bg-gray-100 active:scale-95 transition-all"
            >
              {num}
            </button>
          ))}
          <button
            onClick={handleDelete}
            className="h-16 rounded-xl flex items-center justify-center bg-gray-50 text-gray-500 hover:bg-gray-100 active:scale-95 transition-all"
          >
            <Delete size={24} />
          </button>
          <button
            onClick={() => handleKeyPress('0')}
            className="h-16 rounded-xl text-xl font-semibold bg-gray-50 text-gray-700 hover:bg-gray-100 active:scale-95 transition-all"
          >
            0
          </button>
          <button
            onClick={handleSubmit}
            disabled={pin.length < 4}
            className="h-16 rounded-xl flex items-center justify-center bg-blue-600 text-white disabled:bg-gray-300 hover:bg-blue-700 active:scale-95 transition-all"
          >
            <ArrowRight size={24} />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
