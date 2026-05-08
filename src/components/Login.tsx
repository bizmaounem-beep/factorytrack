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
        className="w-full max-w-xs bg-white p-6 rounded-2xl shadow-xl space-y-4 border border-gray-100"
      >
        <div className="text-center space-y-1">
          <div className="mx-auto w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 mb-2">
            <Lock size={20} />
          </div>
          <h1 className="text-xl font-black text-gray-900 tracking-tighter italic">PILOT<span className="text-blue-600">CLOUD</span></h1>
          <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest">Enter PIN</p>
        </div>

        <div className="flex justify-center gap-3 py-2">
          {[...Array(4)].map((_, i) => (
            <div 
              key={i}
              className={`w-3 h-3 rounded-full border-2 transition-all duration-200 ${
                pin.length > i 
                  ? 'bg-blue-600 border-blue-600' 
                  : error ? 'border-red-400' : 'border-gray-200'
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="text-center text-red-500 text-[10px] font-black uppercase animate-pulse">
            PIN INCORRECT
          </p>
        )}

        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              onClick={() => handleKeyPress(num.toString())}
              className="h-12 rounded-lg text-lg font-black bg-gray-50 text-gray-900 hover:bg-gray-100 active:scale-95 transition-all border border-gray-100"
            >
              {num}
            </button>
          ))}
          <button
            onClick={handleDelete}
            className="h-12 rounded-lg flex items-center justify-center bg-gray-50 text-gray-400 hover:bg-gray-100 active:scale-95 transition-all border border-gray-100"
          >
            <Delete size={18} />
          </button>
          <button
            onClick={() => handleKeyPress('0')}
            className="h-12 rounded-lg text-lg font-black bg-gray-50 text-gray-900 hover:bg-gray-100 active:scale-95 transition-all border border-gray-100"
          >
            0
          </button>
          <button
            onClick={handleSubmit}
            disabled={pin.length < 4}
            className="h-12 rounded-lg flex items-center justify-center bg-blue-600 text-white disabled:bg-gray-200 hover:bg-blue-700 active:scale-95 transition-all shadow-md shadow-blue-100"
          >
            <ArrowRight size={20} />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
