import { useState, useEffect } from 'react';
import { localApi } from '../lib/localApi';
import { useAuth } from '../contexts/AuthContext';
import { Machine, Line, Programme, DowntimeType, DowntimeLog, User } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Square, Settings, Timer, Package, AlertCircle, CheckCircle, Factory, Monitor, Activity, Plus, Minus, ArrowLeft } from 'lucide-react';
import { formatDuration, cn } from '../lib/utils';

export default function OperatorScreen() {
  const { user, logout } = useAuth();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [downtimeTypes, setDowntimeTypes] = useState<DowntimeType[]>([]);
  const [availableProgrammes, setAvailableProgrammes] = useState<Programme[]>([]);
  const [downtimeLogs, setDowntimeLogs] = useState<DowntimeLog[]>([]);
  
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  
  const [activeLine, setActiveLine] = useState<Line | null>(null);
  const [activeProgramme, setActiveProgramme] = useState<Programme | null>(null);
  const [activeDowntime, setActiveDowntime] = useState<DowntimeLog | null>(null);
  
  const [palletInput, setPalletInput] = useState('1');
  const [downtimeDescription, setDowntimeDescription] = useState('');
  const [timer, setTimer] = useState(0);

  // Initialize data
  useEffect(() => {
    const unsubMachines = localApi.onSnapshot('machines', setMachines);
    const unsubDowntimeTypes = localApi.onSnapshot('downtime_types', setDowntimeTypes);
    const unsubLines = localApi.onSnapshot('lines', setLines);
    const unsubProgs = localApi.onSnapshot('programmes', setAvailableProgrammes);
    const unsubDown = localApi.onSnapshot('downtime_logs', setDowntimeLogs);
    const unsubUsers = localApi.onSnapshot('users', setUsers);
    
    return () => {
      unsubMachines();
      unsubDowntimeTypes();
      unsubLines();
      unsubProgs();
      unsubDown();
      unsubUsers();
    };
  }, []);

  const [flashFeedback, setFlashFeedback] = useState(false);

  // Handle active line and related records summary
  useEffect(() => {
    if (!selectedLineId) {
      setActiveLine(null);
      setActiveProgramme(null);
      setActiveDowntime(null);
      return;
    }

    const line = lines.find(l => l.id === selectedLineId);
    if (line) {
      // Logic for flash feedback on production change
      if (activeProgramme && line.currentProgrammeId === activeProgramme.id) {
         const newProg = availableProgrammes.find(p => p.id === line.currentProgrammeId);
         if (newProg && newProg.producedPallets !== activeProgramme.producedPallets) {
            setFlashFeedback(true);
            setTimeout(() => setFlashFeedback(false), 300);
         }
      }

      setActiveLine(line);
      const prog = availableProgrammes.find(p => p.id === line.currentProgrammeId);
      setActiveProgramme(prog || null);

      if (line.activeDowntimeId) {
        const dLog = downtimeLogs.find(d => d.id === line.activeDowntimeId);
        setActiveDowntime(dLog || null);
      } else {
        setActiveDowntime(null);
      }

      // Reset timer if line or programme changes
      setTimer(0);
    }
  }, [selectedLineId, lines, availableProgrammes, downtimeLogs]);

  // Timer logic for downtime
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (activeDowntime && !activeDowntime.endTime) {
      interval = setInterval(() => {
        const start = new Date(activeDowntime.startTime).getTime();
        setTimer(Date.now() - start);
      }, 1000);
    } else {
      setTimer(0);
    }
    return () => clearInterval(interval);
  }, [activeDowntime]);

  const handleLogout = async () => {
    try {
      const heldLines = lines.filter(l => l.currentOperatorId === user?.id);
      for (const line of heldLines) {
        await localApi.updateDoc('lines', line.id, {
          currentOperatorId: null,
          status: 'IDLE'
        });
      }
    } catch (e) {
      console.error("Error releasing lines on logout:", e);
    }
    logout();
  };

  const handleStartProduction = async () => {
    if (!selectedLineId || !activeProgramme) return;
    try {
      await localApi.updateDoc('lines', selectedLineId, {
        status: 'RUNNING',
        currentOperatorId: user?.id
      });
    } catch (e) {
      console.error(e);
      alert('Erreur lors du lancement de la production. Réessayez.');
    }
  };

  const handleStopProduction = async () => {
    if (!selectedLineId) return;

    const count = parseInt(palletInput);
    if (isNaN(count) || count <= 0) {
      alert('Veuillez saisir le nombre final de palettes avant de terminer la production.');
      return;
    }

    try {
      // Declare the final pellets
      await handleAddPallets();

      // Stop production
      await localApi.updateDoc('lines', selectedLineId, {
        status: 'IDLE',
        currentOperatorId: null
      });
      
      setSelectedLineId(null);
    } catch (e) {
      console.error(e);
      alert('Erreur lors de l\'arrêt de la production. Vérifiez votre connexion.');
    }
  };

  const handleFinishProgramme = async () => {
    if (!selectedLineId || !activeProgramme) return;
    
    if (window.confirm('Voulez-vous vraiment clôturer ce programme ? Il ne sera plus modifiable par les opérateurs.')) {
      try {
        // Mark programme as FINISHED
        await localApi.updateDoc('programmes', activeProgramme.id, {
          status: 'FINISHED'
        });
        
        // Clear line
        await localApi.updateDoc('lines', selectedLineId, {
          currentProgrammeId: null,
          status: 'IDLE',
          currentOperatorId: null // Clear operator as well
        });

        setSelectedLineId(null);
      } catch (e) {
        console.error(e);
        alert('Erreur lors de la clôture du programme.');
      }
    }
  };

  const handleAddPallets = async (overrideCount?: number) => {
    let count = typeof overrideCount === 'number' ? overrideCount : parseInt(palletInput);
    if (isNaN(count) || count === 0 || !activeProgramme || !user) return;

    // Log production
    await localApi.addDoc('production_logs', {
      programmeId: activeProgramme.id,
      operatorId: user.id,
      machineId: activeLine?.machineId,
      lineId: activeLine?.id,
      count, // can be negative for removal
      timestamp: new Date().toISOString()
    });

    // Update programme total
    await localApi.updateDoc('programmes', activeProgramme.id, {
      producedPallets: (activeProgramme.producedPallets || 0) + count
    });
  };

  const handleStartDowntime = async (typeId: string) => {
    console.log('Attempting to start downtime:', { typeId, selectedLineId, userId: user?.id, activeLine });
    if (!selectedLineId || !user || !activeLine) {
      console.warn('Cannot start downtime: Missing dependencies');
      return;
    }

    if (activeLine.status !== 'RUNNING') {
      alert('La production doit être lancée (RUNNING) pour déclarer un arrêt.');
      return;
    }

    try {
      // Create log
      const docRef = await localApi.addDoc('downtime_logs', {
        machineId: activeLine.machineId,
        lineId: activeLine.id,
        typeId,
        description: downtimeDescription,
        operatorId: user.id,
        startTime: new Date().toISOString()
      });

      console.log('Downtime log created:', docRef.id);

      // Update line
      await localApi.updateDoc('lines', selectedLineId, {
        status: 'STOPPED',
        activeDowntimeId: docRef.id
      });
      
      setDowntimeDescription('');
      console.log('Line status updated to STOPPED');
    } catch (error) {
      console.error('Error starting downtime:', error);
      alert('Erreur: Impossible de démarrer l\'arrêt. Vérifiez votre connexion.');
    }
  };

  const handleStopDowntime = async () => {
    if (!selectedLineId || !activeDowntime) return;

    const endTime = new Date().toISOString();
    const startTime = new Date(activeDowntime.startTime).getTime();
    const duration = Date.now() - startTime;

    // Update log
    await localApi.updateDoc('downtime_logs', activeDowntime.id, {
      endTime,
      duration
    });

    // Update line
    await localApi.updateDoc('lines', selectedLineId, {
      activeDowntimeId: null,
      status: 'RUNNING'
    });
  };

  const handleSelectProgramme = async (progId: string) => {
    if (!selectedLineId) return;
    const updates: any = {
      currentProgrammeId: progId
    };
    // If we're clearing the programme, stop production
    if (!progId) {
      updates.status = 'IDLE';
    }
    await localApi.updateDoc('lines', selectedLineId, updates);
  };

  if (!selectedMachineId) {
    const container = {
      hidden: { opacity: 0 },
      show: {
        opacity: 1,
        transition: {
          staggerChildren: 0.01
        }
      }
    };

    const item = {
      hidden: { opacity: 0, y: 3 },
      show: { opacity: 1, y: 0, transition: { duration: 0.12, ease: "easeOut" } }
    };

    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col">
        <header className="flex justify-between items-center p-4 bg-white border-b border-gray-100 shadow-sm sm:hidden">
          <div className="flex items-center gap-2">
            <div className="bg-blue-600 p-1.5 rounded-lg text-white">
              <Factory size={16} />
            </div>
            <h1 className="font-black text-sm tracking-tighter text-gray-900 leading-none">FACTORY<span className="text-blue-600">CLOUD</span></h1>
          </div>
          <button onClick={handleLogout} className="p-2 text-red-500 bg-red-50 rounded-lg font-black text-[10px] uppercase px-3">
             LOGOUT
          </button>
        </header>

        <div className="flex-1 p-4 flex flex-col items-center justify-center space-y-8">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center space-y-2"
          >
            <div className="w-16 h-16 bg-blue-600 text-white rounded-2xl flex items-center justify-center mx-auto shadow-xl shadow-blue-100">
              <Factory size={32} />
            </div>
            <h2 className="text-lg md:text-xl font-black text-slate-900 uppercase italic tracking-tight">Sélectionner Machine</h2>
            <p className="text-[7px] md:text-[8px] text-slate-400 font-black uppercase tracking-[0.2em] leading-none">Poste de travail</p>
          </motion.div>
          <motion.div 
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg"
          >
            {machines.map(m => (
              <motion.button
                key={m.id}
                variants={item}
                onClick={() => setSelectedMachineId(m.id)}
                className="p-5 sm:p-8 bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center gap-2 sm:gap-3 transition-all active:scale-[0.98] hover:shadow-md hover:border-blue-200 group"
              >
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-50 rounded-xl sm:rounded-2xl flex items-center justify-center text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                  <Factory className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <span className="font-bold text-slate-800 text-base sm:text-lg uppercase tracking-tight">{m.name}</span>
              </motion.button>
            ))}
          </motion.div>
        </div>
        
        {/* Desktop Logout Shortcut */}
        <div className="hidden sm:block absolute bottom-4 right-4">
           <button onClick={logout} className="p-3 bg-white/80 backdrop-blur rounded-full shadow-lg border border-gray-100 text-gray-400 hover:text-red-500 transition-colors">
               <span className="text-[10px] font-black uppercase">LOGOUT</span>
           </button>
        </div>
      </div>
    );
  }

  if (!selectedLineId) {
    const container = {
      hidden: { opacity: 0 },
      show: {
        opacity: 1,
        transition: {
          staggerChildren: 0.01
        }
      }
    };

    const item = {
      hidden: { opacity: 0, y: 3 },
      show: { opacity: 1, y: 0, transition: { duration: 0.12, ease: "easeOut" } }
    };

    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col">
        <header className="flex justify-between items-center p-4 bg-white border-b border-gray-100 shadow-sm sm:hidden">
          <button 
            onClick={() => setSelectedMachineId(null)}
            className="p-2 bg-gray-50 rounded-lg text-gray-500"
          >
            <ArrowLeft size={20} />
          </button>
          <button onClick={handleLogout} className="p-2 text-red-500 bg-red-50 rounded-lg font-black text-[10px] uppercase px-3">
             LOGOUT
          </button>
        </header>

        <div className="flex-1 p-4 flex flex-col items-center justify-center space-y-8">
          <div className="text-center space-y-2">
            <motion.button 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={() => { setSelectedMachineId(null); setSelectedLineId(null); }} 
              className="text-[10px] font-black text-blue-600 mb-6 flex items-center gap-1.5 mx-auto hover:bg-blue-50 px-4 py-2 rounded-full transition-all uppercase tracking-widest group"
            >
              <ArrowLeft size={16} className="transition-transform group-hover:-translate-x-1" /> Retour aux machines
            </motion.button>
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-16 h-16 bg-blue-600 text-white rounded-2xl flex items-center justify-center mx-auto shadow-xl shadow-blue-100"
            >
              <Monitor size={32} />
            </motion.div>
            <h2 className="text-lg md:text-xl font-black text-slate-900 uppercase italic tracking-tight">Sélectionner Ligne</h2>
            <p className="text-[7px] md:text-[8px] text-slate-400 font-black uppercase tracking-[0.2em] leading-none">
              Poste: {machines.find(m => m.id === selectedMachineId)?.name}
            </p>
          </div>
          <motion.div 
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg"
          >
            {lines.filter(l => l.machineId === selectedMachineId).map(l => {
              const isBusy = (l.status !== 'IDLE' || !!l.currentOperatorId) && l.currentOperatorId !== user?.id;
              const operatorName = users.find(u => u.id === l.currentOperatorId)?.name;

              return (
                <motion.button
                  key={l.id}
                  variants={item}
                  disabled={isBusy}
                  onClick={() => setSelectedLineId(l.id)}
                  className={cn(
                    "p-5 sm:p-8 bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center gap-2 sm:gap-3 transition-all active:scale-[0.98] group relative overflow-hidden",
                    isBusy ? "opacity-60 cursor-not-allowed grayscale" : "hover:shadow-md hover:border-blue-200"
                  )}
                >
                  {isBusy && (
                    <div className="absolute top-2 right-2 flex items-center gap-1 bg-red-50 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
                      <span className="text-[8px] font-black text-red-600 uppercase tracking-tighter">Occupé</span>
                    </div>
                  )}
                  <div className={cn(
                    "w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl flex items-center justify-center transition-colors",
                    isBusy ? "bg-red-50 text-red-300" : "bg-slate-50 text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600"
                  )}>
                     <Activity className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                  <div className="text-center">
                    <span className="font-bold text-slate-800 text-base sm:text-lg uppercase tracking-tight block">{l.name}</span>
                    {isBusy && operatorName && (
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest italic">{operatorName}</span>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </motion.div>
        </div>
        
        {/* Desktop Logout Shortcut */}
        <div className="hidden sm:block absolute bottom-4 right-4">
           <button onClick={logout} className="p-3 bg-white/80 backdrop-blur rounded-full shadow-lg border border-gray-100 text-gray-400 hover:text-red-500 transition-colors">
               <span className="text-[10px] font-black uppercase">LOGOUT</span>
           </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#F3F4F6] flex flex-col overflow-hidden">
      {/* HEADER */}
      <header className="bg-white border-b border-gray-200 px-2 py-0.5 flex flex-col sm:flex-row justify-between items-center gap-0.5 shadow-sm shrink-0">
        <div className="flex items-center gap-1 w-full sm:w-auto overflow-hidden">
          {!activeLine?.status || activeLine?.status === 'IDLE' ? (
            <button 
              onClick={() => {
                if (selectedLineId) setSelectedLineId(null);
                else setSelectedMachineId(null);
              }}
              className="p-0.5 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors shrink-0"
            >
              <ArrowLeft size={14} />
            </button>
          ) : (
            <div className="p-0.5 text-gray-100 cursor-not-allowed shrink-0" title="Production en cours">
              <ArrowLeft size={14} />
            </div>
          )}
          <div className="shrink-0 leading-none">
            <p className="text-[6px] text-gray-400 uppercase tracking-tight font-semibold">Opérateur</p>
            <p className="text-[9px] font-black text-gray-900 truncate max-w-[80px]">{user?.name}</p>
          </div>
          <div className="h-3 w-px bg-gray-200" />
          <div className="overflow-hidden leading-none">
            <p className="text-[6px] text-gray-400 uppercase tracking-tight font-semibold">Poste</p>
            <p className="text-[9px] font-black text-gray-900 truncate">
              {machines.find(m => m.id === activeLine?.machineId)?.name} 
              <span className="text-blue-600"> | {activeLine?.name}</span>
            </p>
          </div>
        </div>
        
        <div className="flex items-center justify-between w-full sm:w-auto gap-1">
          <span className={cn(
            "px-1 py-0.5 rounded-full text-[6px] font-black uppercase tracking-tight flex items-center gap-0.5",
            activeLine?.status === 'RUNNING' ? "bg-status-running-bg text-status-running-text" :
            activeLine?.status === 'STOPPED' ? "bg-status-stopped-bg text-status-stopped-text" : 
            "bg-status-idle-bg text-status-idle-text"
          )}>
            <span className={cn(
              "w-0.5 h-0.5 rounded-full",
              activeLine?.status === 'RUNNING' ? "bg-green-600 animate-pulse" :
              activeLine?.status === 'STOPPED' ? "bg-red-600" : "bg-gray-400"
            )} />
            {activeLine?.status === 'RUNNING' ? "PROD" : 
             activeLine?.status === 'STOPPED' ? "ARRÊT" : "ATTENTE"}
          </span>
          
          <div className="sm:hidden flex items-center gap-1">
             <button onClick={handleLogout} className="p-1 bg-red-50 rounded-lg text-red-500 font-black text-[8px] uppercase px-1.5 border border-red-100">
                 OUT
             </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-1 sm:p-2 lg:grid lg:grid-cols-12 lg:gap-3">
        <div className="lg:col-span-12 max-w-4xl mx-auto w-full space-y-1 sm:space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-1 sm:gap-3">
            
            {/* MAIN AREA: DOWNTIME (Priority when running) */}
            <div className="lg:col-span-12 flex flex-col gap-1 sm:gap-4">
              <div className="card p-1 sm:p-4 flex-1 flex flex-col min-h-0 sm:min-h-[280px] border-l-4 border-orange-500 overflow-hidden">
                <div className="flex justify-between items-center mb-0.5 sm:mb-2">
                  <h2 className="text-[7px] font-black text-gray-400 uppercase tracking-widest leading-none">
                    {activeDowntime ? "Arrêt en cours" : "Déclarer un Arrêt"}
                  </h2>
                  {activeLine?.status === 'RUNNING' && (
                    <div className="flex items-center gap-0.5">
                       <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
                       <span className="text-[6px] sm:text-[9px] font-bold text-green-600 uppercase leading-none">Production</span>
                    </div>
                  )}
                </div>

                {activeLine?.status !== 'RUNNING' && !activeDowntime && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-1.5 sm:p-6 space-y-0.5 sm:space-y-2 bg-gray-50 rounded-lg border-2 border-dashed border-gray-100 mb-1 sm:mb-4">
                    <AlertCircle className="text-gray-300 w-4 h-4 sm:w-8 sm:h-8" />
                    <div className="space-y-0">
                      <p className="text-gray-400 font-bold text-[8px] sm:text-sm uppercase tracking-tight leading-none mb-0.5">Production non lancée</p>
                    </div>
                  </div>
                )}
                {activeDowntime ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-1.5 sm:p-6 space-y-1.5 sm:space-y-6 bg-orange-50/30 rounded-lg border border-orange-100/50">
                    <div className="grid grid-cols-2 md:grid-cols-2 gap-1.5 sm:gap-6 w-full items-center">
                      <div className="flex items-center justify-center gap-1.5 sm:gap-4">
                        <div className="w-8 h-8 sm:w-20 sm:h-20 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 animate-pulse shadow-inner">
                          <Timer className="w-4 h-4 sm:w-10 sm:h-10" />
                        </div>
                        <div className="text-left">
                           <p className="text-[7px] sm:text-[10px] uppercase font-bold text-gray-400">Motif</p>
                           <h4 className="text-[9px] sm:text-base font-black text-orange-900 leading-tight">
                            {downtimeTypes.find(t => t.id === activeDowntime.typeId)?.name || 'En cours'}
                          </h4>
                        </div>
                      </div>

                      <div className="flex flex-col items-center gap-0">
                         <p className="text-[7px] sm:text-[10px] uppercase font-bold text-gray-400">Chrono</p>
                         <p className="text-lg sm:text-4xl font-mono font-black text-orange-600 tabular-nums leading-none">
                          {formatDuration(timer)}
                        </p>
                      </div>
                    </div>

                    <div className="w-full max-w-sm space-y-1.5">
                      <input 
                        type="text"
                        placeholder="Note..."
                        className="w-full text-[10px] sm:text-sm p-1.5 sm:p-4 bg-white border-2 border-orange-100 rounded-lg sm:rounded-2xl outline-none focus:border-orange-500 font-bold text-center shadow-sm"
                        defaultValue={activeDowntime.description || ''}
                        onBlur={async (e) => {
                          if (e.target.value !== activeDowntime.description) {
                            await localApi.updateDoc('downtime_logs', activeDowntime.id, {
                              description: e.target.value
                            });
                          }
                        }}
                      />
                      <button 
                        onClick={handleStopDowntime}
                        className="w-full bg-orange-600 text-white py-2 sm:py-5 rounded-lg sm:rounded-2xl font-black text-sm sm:text-xl shadow-lg shadow-orange-200 active:scale-95 transition-all uppercase tracking-widest flex items-center justify-center gap-1.5"
                      >
                        <Play className="w-4 h-4 sm:w-6 sm:h-6" fill="currentColor" /> REPRENDRE
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col gap-1 sm:gap-4 overflow-hidden">
                    {activeLine?.status === 'RUNNING' && (
                      <div className="bg-orange-50/50 p-1 sm:p-3 rounded-lg border border-orange-100 mb-0.5">
                        <input 
                          type="text"
                          placeholder="Note de l'arrêt (Optionnel)..."
                          className="w-full text-[9px] p-1.5 sm:p-3 bg-white border border-orange-100 rounded-lg outline-none focus:border-orange-500 font-bold shadow-sm"
                          value={downtimeDescription}
                          onChange={e => setDowntimeDescription(e.target.value)}
                        />
                      </div>
                    )}
                    <div className="flex-1 overflow-y-auto pr-0.5">
                      <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-6 gap-1 sm:gap-2 pb-1 sm:pb-4">
                        {downtimeTypes.map((type) => (
                          <button
                            key={type.id}
                            disabled={activeLine?.status !== 'RUNNING'}
                            onClick={() => handleStartDowntime(type.id)}
                            className={cn(
                              "border rounded-lg sm:rounded-xl p-0.5 sm:p-3 text-left transition-all flex flex-col items-center text-center gap-0.5 sm:gap-2 active:scale-95 shadow-sm group font-black",
                              activeLine?.status !== 'RUNNING' 
                                ? "bg-gray-50 border-gray-100 opacity-40 cursor-not-allowed" 
                                : "bg-white border-orange-50 hover:bg-orange-50 hover:border-orange-200"
                            )}
                          >
                            <span className="text-base sm:text-2xl transition-transform group-hover:scale-110 leading-none">{type.icon || '⚠️'}</span>
                            <span className="text-[6px] sm:text-[9px] leading-tight uppercase tracking-tighter text-gray-700">{type.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* SECONDARY AREA: PRODUCTION & PROGRAMME */}
            <div className="lg:col-span-12 grid grid-cols-2 md:grid-cols-2 gap-1 sm:gap-6">
              {/* PROGRAMME CARD */}
              <div className="card p-1.5 sm:p-6 flex flex-col gap-1 sm:gap-4 border-l-4 border-blue-500 overflow-hidden">
                {!activeProgramme ? (
                  <div className="py-0.5 sm:py-2 space-y-1 sm:space-y-4">
                    <h2 className="text-[7px] sm:text-xs font-bold uppercase tracking-widest text-gray-400 leading-none">Prog.</h2>
                    {availableProgrammes.filter(p => p.lineId === selectedLineId && p.status === 'ACTIVE').length > 0 ? (
                      <div className="grid gap-1 sm:gap-2">
                        {availableProgrammes.filter(p => p.lineId === selectedLineId && p.status === 'ACTIVE').map(p => (
                          <button
                            key={p.id}
                            disabled={activeLine?.status === 'RUNNING'}
                            onClick={() => handleSelectProgramme(p.id)}
                            className={cn(
                              "w-full p-1 sm:p-4 border rounded-lg text-left transition-all group",
                              activeLine?.status === 'RUNNING' 
                                ? "bg-gray-50 border-gray-100 opacity-50 cursor-not-allowed" 
                                : "bg-gray-50 hover:bg-blue-50 border-gray-100 hover:border-blue-200"
                            )}
                          >
                            <div className="flex justify-between items-center">
                              <p className="text-[9px] sm:text-base font-black text-gray-900 truncate group-hover:text-blue-700 leading-none">{p.name}</p>
                              <Play className="w-2.5 h-2.5 sm:w-4 sm:h-4 text-gray-300 group-hover:text-blue-500" fill="currentColor" />
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="py-2 sm:py-8 text-center bg-gray-50 rounded-lg border-2 border-dashed border-gray-100">
                        <p className="text-gray-300 text-[8px] sm:text-sm italic">Aucun</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-start">
                      <div className="overflow-hidden text-left leading-none">
                        <h2 className="text-[7px] sm:text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">Prog.</h2>
                        <h1 className="text-[10px] sm:text-xl font-black text-gray-800 truncate mb-1">{activeProgramme.name}</h1>
                        <button 
                          disabled={activeLine?.status === 'RUNNING'}
                          onClick={() => handleSelectProgramme('')} 
                          className="text-[7px] sm:text-[9px] font-black uppercase text-blue-600 hover:underline disabled:opacity-30"
                        >
                          Changer
                        </button>
                      </div>
                    </div>
                    
                    {activeLine?.tracksProduction !== 0 && (
                      <div className="mt-auto">
                        <motion.div 
                          animate={flashFeedback ? { scale: [1, 1.05, 1], backgroundColor: ['rgb(249, 250, 251)', 'rgb(219, 234, 254)', 'rgb(249, 250, 251)'] } : {}}
                          className="bg-blue-50/30 p-1 sm:p-4 rounded-lg sm:rounded-3xl border border-blue-50 text-center"
                        >
                          <p className="text-[7px] sm:text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none">Produit</p>
                          <p className="text-base sm:text-4xl font-black text-blue-600 italic leading-none">
                            {activeProgramme.producedPallets}<span className="text-[7px] sm:text-sm font-bold text-slate-400 not-italic uppercase ml-0.5">P.</span>
                          </p>
                        </motion.div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* SAISIE CARD */}
              <div className="card p-1.5 sm:p-5 flex flex-col gap-1 sm:gap-4 border-l-4 border-blue-600 bg-blue-50/20 overflow-hidden">
                <h2 className="text-[7px] sm:text-[10px] font-black text-blue-600 uppercase tracking-widest leading-none">Saisie</h2>
                <div className="flex flex-col gap-1 flex-1 justify-center">
                  <div className="flex bg-white rounded-lg sm:rounded-2xl shadow-inner border border-blue-100 overflow-hidden shrink-0 h-6 sm:h-auto">
                    <button 
                      disabled={activeLine?.status !== 'RUNNING'}
                      onClick={() => {
                        const val = (parseInt(palletInput) || 1) - 1;
                        setPalletInput(Math.max(1, val).toString());
                      }}
                      className="px-1.5 sm:px-4 bg-gray-50 hover:bg-gray-100 text-gray-400 transition-colors border-r border-gray-100 disabled:opacity-30"
                    >
                      <Minus className="w-2.5 h-2.5 sm:w-5 sm:h-5" />
                    </button>
                    <input 
                      type="number"
                      disabled={activeLine?.status !== 'RUNNING'}
                      value={palletInput}
                      onChange={e => setPalletInput(e.target.value)}
                      className="w-full text-xs sm:text-2xl font-black text-center outline-none bg-transparent text-gray-900 disabled:opacity-30 leading-none h-full"
                    />
                    <button 
                      disabled={activeLine?.status !== 'RUNNING'}
                      onClick={() => {
                        const val = (parseInt(palletInput) || 0) + 1;
                        setPalletInput(val.toString());
                      }}
                      className="px-1.5 sm:px-4 bg-gray-50 hover:bg-gray-100 text-gray-400 transition-colors border-l border-gray-100 disabled:opacity-30"
                    >
                      <Plus className="w-2.5 h-2.5 sm:w-5 sm:h-5" />
                    </button>
                  </div>

                  <button 
                    disabled={activeLine?.status !== 'RUNNING'}
                    onClick={() => handleAddPallets()}
                    className="h-6 sm:h-[60px] w-full bg-blue-600 text-white rounded-lg sm:rounded-2xl font-black hover:bg-blue-700 transition-all shadow-md active:scale-95 text-[9px] sm:text-sm uppercase tracking-widest disabled:opacity-30 leading-none"
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>

            {/* ACTIONS */}
            <div className="lg:col-span-12">
              <div className="flex gap-1 sm:gap-4 min-h-[36px] sm:min-h-[80px]">
                {activeLine?.status !== 'RUNNING' ? (
                  <div className="flex gap-1 w-full">
                    <button 
                      disabled={!activeProgramme || !!activeDowntime}
                      onClick={handleStartProduction}
                      className="flex-[3] border-2 border-[#22C55E] text-[#15803D] bg-green-50/50 rounded-lg sm:rounded-2xl flex items-center justify-center gap-1.5 font-black text-xs sm:text-2xl hover:bg-green-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow-sm uppercase italic tracking-tighter"
                    >
                      <Play className="w-4 h-4 sm:w-6 sm:h-6" fill="currentColor" /> LANCER PROD
                    </button>
                    {activeProgramme && !activeDowntime && (
                      <button 
                        onClick={handleFinishProgramme}
                        className="flex-1 border border-gray-400 text-gray-600 bg-gray-50 rounded-lg sm:rounded-2xl flex flex-col items-center justify-center gap-0 font-black px-1 shadow-sm uppercase tracking-tighter hover:bg-white hover:border-blue-400 hover:text-blue-600 transition-all group shrink-0"
                      >
                        <CheckCircle className="w-2.5 h-2.5 sm:w-4.5 sm:h-4.5 text-gray-400 group-hover:text-blue-500" />
                        <span className="text-[6px] sm:text-[10px]">Clôturer</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <button 
                    onClick={handleStopProduction}
                    className="flex-1 border-2 border-[#EF4444] text-[#B91C1C] bg-red-50 rounded-lg sm:rounded-2xl flex items-center justify-center gap-2 font-black text-xs sm:text-2xl hover:bg-red-100 transition-colors shadow-sm uppercase italic tracking-tighter"
                  >
                    <Square className="w-4 h-4 sm:w-6 sm:h-6" fill="currentColor" /> TERMINER MISSION
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* FOOTER ALERT */}
      <AnimatePresence>
        {(activeLine?.status === 'STOPPED' || (timer > 15 * 60 * 1000)) && (
          <motion.footer 
            initial={{ y: 50 }}
            animate={{ y: 0 }}
            exit={{ y: 50 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="bg-red-600 text-white flex items-center justify-center py-3 gap-3 shrink-0"
          >
            <AlertCircle size={20} fill="currentColor" className="animate-pulse" />
            <span className="font-bold tracking-tight uppercase text-xs sm:text-sm">
              {timer > 15 * 60 * 1000 
                ? `Alerte : Ligne arrêtée depuis plus de 15 minutes (${formatDuration(timer)})` 
                : 'Alerte : Ligne à l\'arrêt'}
            </span>
          </motion.footer>
        )}
      </AnimatePresence>

      {/* ADMIN NAV ACCESS */}
      <div className="hidden sm:flex absolute bottom-4 right-4">
         <button onClick={handleLogout} className="p-3 bg-white/80 backdrop-blur rounded-full shadow-lg border border-gray-100 text-gray-400 hover:text-red-500 transition-colors">
             <span className="text-[10px] font-black uppercase">LOGOUT</span>
         </button>
      </div>
    </div>
  );
}
