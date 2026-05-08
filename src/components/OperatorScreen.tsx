import { useState, useEffect } from 'react';
import { localApi } from '../lib/localApi';
import { useAuth } from '../contexts/AuthContext';
import { Machine, Line, Programme, DowntimeType, DowntimeLog } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Square, Settings, Timer, Package, AlertCircle, CheckCircle, Factory, Monitor, Activity, Plus, Minus, ArrowLeft } from 'lucide-react';
import { formatDuration, cn } from '../lib/utils';

export default function OperatorScreen() {
  const { user, logout } = useAuth();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
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
    
    return () => {
      unsubMachines();
      unsubDowntimeTypes();
      unsubLines();
      unsubProgs();
      unsubDown();
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

  const handleStartProduction = async () => {
    if (!selectedLineId || !activeProgramme) return;
    await localApi.updateDoc('lines', selectedLineId, {
      status: 'RUNNING',
      currentOperatorId: user?.id
    });
  };

  const handleStopProduction = async () => {
    if (!selectedLineId) return;

    const count = parseInt(palletInput);
    if (isNaN(count) || count <= 0) {
      alert('Veuillez saisir le nombre final de palettes avant de terminer la production.');
      return;
    }

    // Declare the final pellets
    await handleAddPallets();

    // Stop production
    await localApi.updateDoc('lines', selectedLineId, {
      status: 'IDLE'
    });
  };

  const handleFinishProgramme = async () => {
    if (!selectedLineId || !activeProgramme) return;
    
    if (window.confirm('Voulez-vous vraiment clôturer ce programme ? Il ne sera plus modifiable par les opérateurs.')) {
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
          staggerChildren: 0.05
        }
      }
    };

    const item = {
      hidden: { opacity: 0, y: 10 },
      show: { opacity: 1, y: 0 }
    };

    return (
      <div className="min-h-screen bg-[#F8FAFC] p-4 flex flex-col items-center justify-center space-y-8">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center space-y-2"
        >
          <div className="w-16 h-16 bg-blue-600 text-white rounded-2xl flex items-center justify-center mx-auto shadow-xl shadow-blue-100">
            <Factory size={32} />
          </div>
          <h2 className="text-2xl font-black text-slate-900 uppercase italic tracking-tight">Sélectionner Machine</h2>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] leading-none">Choisissez un poste de travail</p>
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
                <Settings size={20} sm:size={24} />
              </div>
              <span className="font-bold text-slate-800 text-base sm:text-lg uppercase tracking-tight">{m.name}</span>
            </motion.button>
          ))}
        </motion.div>
      </div>
    );
  }

  if (!selectedLineId) {
    const container = {
      hidden: { opacity: 0 },
      show: {
        opacity: 1,
        transition: {
          staggerChildren: 0.05
        }
      }
    };

    const item = {
      hidden: { opacity: 0, y: 10 },
      show: { opacity: 1, y: 0 }
    };

    return (
      <div className="min-h-screen bg-[#F8FAFC] p-4 flex flex-col items-center justify-center space-y-8">
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
          <h2 className="text-2xl font-black text-slate-900 uppercase italic tracking-tight">Sélectionner Ligne</h2>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em] leading-none">
            Poste: {machines.find(m => m.id === selectedMachineId)?.name}
          </p>
        </div>
        <motion.div 
          variants={container}
          initial="hidden"
          animate="show"
          className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-lg"
        >
          {lines.filter(l => l.machineId === selectedMachineId).map(l => (
            <motion.button
              key={l.id}
              variants={item}
              onClick={() => setSelectedLineId(l.id)}
              className="p-5 sm:p-8 bg-white rounded-2xl sm:rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center gap-2 sm:gap-3 transition-all active:scale-[0.98] hover:shadow-md hover:border-blue-200 group"
            >
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-50 rounded-xl sm:rounded-2xl flex items-center justify-center text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                 <Activity size={20} sm:size={24} />
              </div>
              <span className="font-bold text-slate-800 text-base sm:text-lg uppercase tracking-tight">{l.name}</span>
            </motion.button>
          ))}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6] flex flex-col overflow-hidden">
      {/* HEADER */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex flex-col sm:flex-row justify-between items-center gap-3 shadow-sm shrink-0">
        <div className="flex items-center gap-3 w-full sm:w-auto overflow-hidden">
          <button 
            onClick={() => {
              if (selectedLineId) setSelectedLineId('');
              else setSelectedMachineId('');
            }}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors shrink-0"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="shrink-0">
            <p className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold leading-none">Opérateur</p>
            <p className="text-xs font-bold text-gray-900 truncate max-w-[120px]">{user?.name}</p>
          </div>
          <div className="h-6 w-px bg-gray-200" />
          <div className="overflow-hidden">
            <p className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold leading-none">Poste</p>
            <p className="text-xs font-bold text-gray-900 truncate">
              {machines.find(m => m.id === activeLine?.machineId)?.name} 
              <span className="text-blue-600"> | {activeLine?.name}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end w-full sm:w-auto">
          <span className={cn(
            "px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest flex items-center gap-1.5",
            activeLine?.status === 'RUNNING' ? "bg-status-running-bg text-status-running-text" :
            activeLine?.status === 'STOPPED' ? "bg-status-stopped-bg text-status-stopped-text" : 
            "bg-status-idle-bg text-status-idle-text"
          )}>
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              activeLine?.status === 'RUNNING' ? "bg-green-600 animate-pulse" :
              activeLine?.status === 'STOPPED' ? "bg-red-600" : "bg-gray-400"
            )} />
            {activeLine?.status}
          </span>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-2 sm:p-4 md:p-6 lg:grid lg:grid-cols-12 lg:gap-6">
        <div className="lg:col-span-12 max-w-4xl mx-auto w-full space-y-3 sm:space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-6">
            
            {/* MAIN AREA: DOWNTIME (Priority when running) */}
            <div className="lg:col-span-12 flex flex-col gap-3 sm:gap-4">
              <div className="card p-3 sm:p-5 flex-1 flex flex-col min-h-[180px] sm:min-h-[300px] border-l-4 border-orange-500">
                <div className="flex justify-between items-center mb-2 sm:mb-3">
                  <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    {activeDowntime ? "Arrêt en cours" : "Déclarer un Arrêt"}
                  </h2>
                  {activeLine?.status === 'RUNNING' && (
                    <div className="flex items-center gap-1.5 sm:gap-2">
                       <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                       <span className="text-[9px] sm:text-[10px] font-bold text-green-600 uppercase">En Prod</span>
                    </div>
                  )}
                </div>

                {activeLine?.status !== 'RUNNING' && !activeDowntime && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-3 sm:p-6 space-y-2 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100 mb-2 sm:mb-4">
                    <AlertCircle className="text-gray-300" size={24} sm:size={32} />
                    <div className="space-y-1">
                      <p className="text-gray-400 font-bold text-[10px] sm:text-sm uppercase tracking-tight leading-none mb-1">Production non lancée</p>
                      <p className="text-[8px] text-gray-300 font-medium uppercase leading-tight">Lancez la production pour déclarer un arrêt</p>
                    </div>
                  </div>
                )}
                {activeDowntime ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-3 sm:p-6 space-y-3 sm:space-y-6 bg-orange-50/30 rounded-2xl border border-orange-100/50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-6 w-full items-center">
                      <div className="flex sm:flex-col items-center justify-center gap-3 sm:gap-4">
                        <div className="w-12 h-12 sm:w-20 sm:h-20 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 animate-pulse shadow-inner">
                          <Timer size={24} sm:size={40} />
                        </div>
                        <div className="text-left sm:text-center">
                           <p className="text-[9px] sm:text-[10px] uppercase font-bold text-gray-400 mb-0.5 sm:mb-1">Motif</p>
                           <h4 className="text-base sm:text-2xl font-black text-orange-900 leading-tight">
                            {downtimeTypes.find(t => t.id === activeDowntime.typeId)?.name || 'En cours'}
                          </h4>
                        </div>
                      </div>

                      <div className="flex flex-col items-center gap-1">
                         <p className="text-[9px] sm:text-[10px] uppercase font-bold text-gray-400">Chrono</p>
                         <p className="text-3xl sm:text-6xl font-mono font-black text-orange-600 tabular-nums leading-none">
                          {formatDuration(timer)}
                        </p>
                      </div>
                    </div>

                    <div className="w-full max-w-sm space-y-3">
                      <input 
                        type="text"
                        placeholder="Note additionnelle..."
                        className="w-full text-xs sm:text-sm p-3 sm:p-4 bg-white border-2 border-orange-100 rounded-xl sm:rounded-2xl outline-none focus:border-orange-500 font-bold text-center shadow-sm"
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
                        className="w-full bg-orange-600 text-white py-3 sm:py-5 rounded-xl sm:rounded-2xl font-black text-lg sm:text-xl shadow-lg shadow-orange-200 active:scale-95 transition-all uppercase tracking-widest flex items-center justify-center gap-2 sm:gap-3"
                      >
                        <Play size={20} sm:size={24} fill="currentColor" /> REPRENDRE
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col gap-3 sm:gap-4 overflow-hidden">
                    {activeLine?.status === 'RUNNING' && (
                      <div className="bg-orange-50/50 p-2 sm:p-3 rounded-xl border border-orange-100 mb-1">
                        <p className="text-[8px] font-bold text-orange-600 uppercase mb-1 ml-1 tracking-widest">Note de l'arrêt (Optionnel)</p>
                        <input 
                          type="text"
                          placeholder="Décrivez le problème ici AVANT de cliquer sur un motif..."
                          className="w-full text-xs p-2.5 sm:p-3 bg-white border border-orange-100 rounded-lg outline-none focus:border-orange-500 font-bold shadow-sm"
                          value={downtimeDescription}
                          onChange={e => setDowntimeDescription(e.target.value)}
                        />
                      </div>
                    )}
                    <div className="flex-1 overflow-y-auto pr-1">
                      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3 pb-3 sm:pb-4">
                        {downtimeTypes.map((type) => (
                          <button
                            key={type.id}
                            disabled={activeLine?.status !== 'RUNNING'}
                            onClick={() => handleStartDowntime(type.id)}
                            className={cn(
                              "border-2 rounded-xl sm:rounded-2xl p-2 sm:p-4 text-left transition-all flex flex-col items-center text-center gap-1.5 sm:gap-3 active:scale-95 shadow-sm group",
                              activeLine?.status !== 'RUNNING' 
                                ? "bg-gray-50 border-gray-100 opacity-40 cursor-not-allowed grayscale" 
                                : "bg-white border-orange-50 hover:bg-orange-50 hover:border-orange-200"
                            )}
                          >
                            <span className="text-xl sm:text-3xl transition-transform group-hover:scale-110">{type.icon || '⚠️'}</span>
                            <span className="text-[8px] sm:text-[10px] font-black text-gray-700 leading-tight uppercase tracking-tight">{type.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* SECONDARY AREA: PRODUCTION & PROGRAMME */}
            <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-6">
              {/* PROGRAMME CARD */}
              <div className="card p-4 sm:p-6 flex flex-col gap-3 sm:gap-4 border-l-4 border-blue-500">
                {!activeProgramme ? (
                  <div className="py-1 sm:py-2 space-y-3 sm:space-y-4">
                    <div className="flex items-center gap-2 text-gray-400">
                      <Package size={18} sm:size={20} />
                      <h2 className="text-[10px] sm:text-xs font-bold uppercase tracking-widest">Choisir Programme</h2>
                    </div>
                    {availableProgrammes.filter(p => p.lineId === selectedLineId && p.status === 'ACTIVE').length > 0 ? (
                      <div className="grid gap-1.5 sm:gap-2">
                        {availableProgrammes.filter(p => p.lineId === selectedLineId && p.status === 'ACTIVE').map(p => (
                          <button
                            key={p.id}
                            disabled={activeLine?.status === 'RUNNING'}
                            onClick={() => handleSelectProgramme(p.id)}
                            className={cn(
                              "w-full p-3 sm:p-4 border rounded-xl text-left transition-all group",
                              activeLine?.status === 'RUNNING' 
                                ? "bg-gray-50 border-gray-100 opacity-50 cursor-not-allowed" 
                                : "bg-gray-50 hover:bg-blue-50 border-gray-100 hover:border-blue-200"
                            )}
                          >
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="text-xs sm:text-base font-black text-gray-900 group-hover:text-blue-700">{p.name}</p>
                                <p className="text-[8px] sm:text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mt-0.5 sm:mt-1">Production active</p>
                              </div>
                              <Play size={14} sm:size={16} className="text-gray-300 group-hover:text-blue-500" fill="currentColor" />
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="py-6 sm:py-8 text-center bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100">
                        <p className="text-gray-400 font-medium italic text-xs sm:text-sm">Aucun programme actif</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-start">
                      <div className="overflow-hidden text-left">
                        <h2 className="text-[9px] sm:text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-0.5 sm:mb-1">Programme</h2>
                        <h1 className="text-sm sm:text-xl font-bold text-gray-800 truncate">{activeProgramme.name}</h1>
                      </div>
                      <div className="text-right flex flex-col items-end gap-1 shrink-0">
                        {activeLine?.status !== 'RUNNING' && (
                          <button 
                            onClick={() => handleSelectProgramme('')} 
                            className="text-[8px] sm:text-[9px] font-black uppercase text-blue-600 hover:underline"
                          >
                            Changer
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {activeLine?.tracksProduction !== 0 && (
                      <div className="grid grid-cols-1 gap-2">
                        <motion.div 
                          animate={flashFeedback ? { scale: [1, 1.05, 1], backgroundColor: ['rgb(249, 250, 251)', 'rgb(219, 234, 254)', 'rgb(249, 250, 251)'] } : {}}
                          className="bg-gray-50 p-2 sm:p-4 rounded-xl sm:rounded-3xl border border-blue-50 text-center transition-colors"
                        >
                          <p className="text-[8px] sm:text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-0.5 sm:mb-1">Total Produit</p>
                          <p className="text-2xl sm:text-4xl font-black text-blue-600 italic leading-none">
                            {activeProgramme.producedPallets} <span className="text-[10px] sm:text-sm font-bold text-slate-400 not-italic uppercase tracking-tight">Palettes</span>
                          </p>
                        </motion.div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* SAISIE CARD */}
              {activeLine?.status === 'RUNNING' && activeProgramme && activeLine?.tracksProduction !== 0 ? (
                <div className="card p-3 sm:p-5 flex flex-col gap-2 sm:gap-4 border-l-4 border-blue-600 bg-blue-50/20">
                  <h2 className="text-[9px] sm:text-[10px] font-black text-blue-600 uppercase tracking-widest leading-none">Ajuster Production</h2>
                  <div className="flex items-center gap-2 sm:gap-3">
                    <div className="flex bg-white rounded-xl sm:rounded-2xl shadow-inner border-2 border-blue-100 overflow-hidden flex-1 shrink-0">
                      <button 
                        onClick={() => {
                          const val = (parseInt(palletInput) || 1) - 1;
                          setPalletInput(Math.max(1, val).toString());
                        }}
                        className="p-3 sm:p-4 bg-gray-50 hover:bg-gray-100 text-gray-400 transition-colors border-r border-gray-100"
                      >
                        <Minus size={16} sm:size={20} />
                      </button>
                      <input 
                        type="number"
                        value={palletInput}
                        onChange={e => setPalletInput(e.target.value)}
                        className="w-full px-2 sm:px-4 py-2 sm:py-3 text-lg sm:text-2xl font-black text-center outline-none bg-transparent text-gray-900"
                      />
                      <button 
                        onClick={() => {
                          const val = (parseInt(palletInput) || 0) + 1;
                          setPalletInput(val.toString());
                        }}
                        className="p-3 sm:p-4 bg-gray-50 hover:bg-gray-100 text-gray-400 transition-colors border-l border-gray-100"
                      >
                        <Plus size={16} sm:size={20} />
                      </button>
                    </div>

                    <button 
                      onClick={() => handleAddPallets()}
                      className="h-[48px] sm:h-[60px] px-4 sm:px-8 bg-blue-600 text-white rounded-xl sm:rounded-2xl font-black hover:bg-blue-700 transition-all shadow-md active:scale-95 flex items-center gap-2 uppercase tracking-widest text-xs sm:text-sm"
                    >
                      OK
                    </button>
                  </div>
                  <div className="flex justify-center gap-4 text-gray-400">
                     <button onClick={() => handleAddPallets(1)} className="text-[9px] sm:text-[10px] hover:text-blue-600 font-bold uppercase transition-colors">+1 RAPIDE</button>
                     <div className="w-px h-3 bg-gray-200 mt-0.5 sm:mt-1" />
                     <button onClick={() => handleAddPallets(-1)} className="text-[9px] sm:text-[10px] hover:text-red-500 font-bold uppercase transition-colors">-1 (ERR)</button>
                  </div>
                </div>
              ) : (
                <div className="card p-4 sm:p-5 flex flex-col items-center justify-center border-2 border-dashed border-gray-100 bg-gray-50/50 text-gray-300">
                   <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest">Saisie Production</p>
                   <p className="text-[8px] font-bold uppercase tracking-tight text-center mt-1">Désactivé</p>
                </div>
              )}
            </div>

            {/* ACTIONS */}
            <div className="lg:col-span-12 mt-2 sm:mt-4">
              <div className="flex gap-2 sm:gap-4 min-h-[50px] sm:min-h-[80px]">
                {activeLine?.status !== 'RUNNING' ? (
                  <div className="flex gap-2 w-full">
                    <button 
                      disabled={!activeProgramme || !!activeDowntime}
                      onClick={handleStartProduction}
                      className="flex-[3] border-2 border-[#22C55E] text-[#15803D] bg-green-50/50 rounded-xl sm:rounded-2xl flex items-center justify-center gap-2 sm:gap-3 font-black text-sm sm:text-2xl hover:bg-green-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow-sm uppercase italic tracking-tighter"
                    >
                      <Play size={18} sm:size={24} fill="currentColor" /> LANCER PROD
                    </button>
                    {activeProgramme && !activeDowntime && (
                      <button 
                        onClick={handleFinishProgramme}
                        className="flex-1 border-2 border-gray-400 text-gray-600 bg-gray-50 rounded-xl sm:rounded-2xl flex flex-col items-center justify-center gap-0.5 sm:gap-1 font-black px-2 shadow-sm uppercase tracking-tighter hover:bg-white hover:border-blue-400 hover:text-blue-600 transition-all group"
                      >
                        <CheckCircle size={16} sm:size={18} className="text-gray-400 group-hover:text-blue-500" />
                        <span className="text-[7px] sm:text-[10px]">Clôturer</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <button 
                    onClick={handleStopProduction}
                    className="flex-1 border-2 border-[#EF4444] text-[#B91C1C] bg-red-50 rounded-xl sm:rounded-2xl flex items-center justify-center gap-2 sm:gap-3 font-black text-sm sm:text-2xl hover:bg-red-100 transition-colors shadow-sm uppercase italic tracking-tighter"
                  >
                    <Square size={20} sm:size={24} fill="currentColor" /> TERMINER MISSION
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
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
         <button onClick={() => { setSelectedLineId(null); }} className="p-3 bg-white/80 backdrop-blur rounded-full shadow-lg border border-gray-100 text-gray-400 hover:text-blue-600 transition-colors">
             <Settings size={18} />
         </button>
         <button onClick={logout} className="p-3 bg-white/80 backdrop-blur rounded-full shadow-lg border border-gray-100 text-gray-400 hover:text-red-500 transition-colors">
             <span className="text-[10px] font-black uppercase">OFF</span>
         </button>
      </div>
    </div>
  );
}
