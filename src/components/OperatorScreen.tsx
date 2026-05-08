import { useState, useEffect } from 'react';
import { localApi } from '../lib/localApi';
import { useAuth } from '../contexts/AuthContext';
import { Machine, Line, Programme, DowntimeType, DowntimeLog } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Square, Settings, Timer, Package, AlertCircle, CheckCircle, Factory, Monitor, Activity } from 'lucide-react';
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
  
  const [palletInput, setPalletInput] = useState('');
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

  const handleAddPallets = async () => {
    const count = parseInt(palletInput);
    if (isNaN(count) || count <= 0 || !activeProgramme || !user) return;

    // Log production
    await localApi.addDoc('production_logs', {
      programmeId: activeProgramme.id,
      operatorId: user.id,
      machineId: activeLine?.machineId,
      lineId: activeLine?.id,
      count,
      timestamp: new Date().toISOString()
    });

    // Update programme total
    await localApi.updateDoc('programmes', activeProgramme.id, {
      producedPallets: (activeProgramme.producedPallets || 0) + count
    });

    setPalletInput('');
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
    return (
      <div className="min-h-screen bg-[#F3F4F6] p-4 flex flex-col items-center justify-center space-y-8">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-blue-600 text-white rounded-2xl flex items-center justify-center mx-auto shadow-xl shadow-blue-200">
            <Factory size={32} />
          </div>
          <h2 className="text-2xl font-black text-gray-900 uppercase italic tracking-tight">Sélectionner Machine</h2>
          <p className="text-sm text-gray-400 font-medium uppercase tracking-widest leading-none">Choisissez un poste de travail</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
          {machines.map(m => (
            <button
              key={m.id}
              onClick={() => setSelectedMachineId(m.id)}
              className="p-8 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center gap-3 transition-all active:scale-95 active:bg-gray-50 hover:border-blue-300 group"
            >
              <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center text-gray-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                <Settings size={24} />
              </div>
              <span className="font-bold text-gray-800 text-lg uppercase tracking-tight">{m.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!selectedLineId) {
    return (
      <div className="min-h-screen bg-[#F3F4F6] p-4 flex flex-col items-center justify-center space-y-8">
        <div className="text-center space-y-2">
          <button 
            onClick={() => { setSelectedMachineId(null); setSelectedLineId(null); }} 
            className="text-xs font-black text-blue-600 mb-4 flex items-center gap-1 mx-auto hover:underline uppercase tracking-widest"
          >
            ← Retour aux machines
          </button>
          <div className="w-16 h-16 bg-blue-600 text-white rounded-2xl flex items-center justify-center mx-auto shadow-xl shadow-blue-200">
            <Monitor size={32} />
          </div>
          <h2 className="text-2xl font-black text-gray-900 uppercase italic tracking-tight">Sélectionner Ligne</h2>
          <p className="text-sm text-gray-400 font-medium uppercase tracking-widest leading-none">
            Poste: {machines.find(m => m.id === selectedMachineId)?.name}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
          {lines.filter(l => l.machineId === selectedMachineId).map(l => (
            <button
              key={l.id}
              onClick={() => setSelectedLineId(l.id)}
              className="p-8 bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center gap-3 transition-all active:scale-95 active:bg-gray-50 hover:border-blue-300 group"
            >
              <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center text-gray-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                 <Activity size={24} />
              </div>
              <span className="font-bold text-gray-800 text-lg uppercase tracking-tight">{l.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6] flex flex-col overflow-hidden">
      {/* HEADER */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex flex-col sm:flex-row justify-between items-center gap-3 shadow-sm shrink-0">
        <div className="flex items-center gap-3 w-full sm:w-auto overflow-hidden">
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

      <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:grid lg:grid-cols-12 lg:gap-6">
        <div className="lg:col-span-12 max-w-4xl mx-auto w-full space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* LEFT COLUMN: PRODUCTION */}
            <div className="lg:col-span-7 space-y-6 flex flex-col">
              {/* PROGRAMME CARD */}
              <div className="card p-5 sm:p-6 flex flex-col gap-4 border-l-4 border-blue-500">
                {!activeProgramme ? (
                  <div className="py-2 space-y-4">
                    <div className="flex items-center gap-2 text-gray-400">
                      <Package size={20} />
                      <h2 className="text-xs font-bold uppercase tracking-widest">Choisir un Programme</h2>
                    </div>
                    {availableProgrammes.filter(p => p.lineId === selectedLineId && p.status === 'ACTIVE').length > 0 ? (
                      <div className="grid gap-2">
                        {availableProgrammes.filter(p => p.lineId === selectedLineId && p.status === 'ACTIVE').map(p => (
                          <button
                            key={p.id}
                            disabled={activeLine?.status === 'RUNNING'}
                            onClick={() => handleSelectProgramme(p.id)}
                            className={cn(
                              "w-full p-4 border rounded-xl text-left transition-all group",
                              activeLine?.status === 'RUNNING' 
                                ? "bg-gray-50 border-gray-100 opacity-50 cursor-not-allowed" 
                                : "bg-gray-50 hover:bg-blue-50 border-gray-100 hover:border-blue-200"
                            )}
                          >
                            <div className="flex justify-between items-center">
                              <div>
                                <p className="font-black text-gray-900 group-hover:text-blue-700">{p.name}</p>
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Objectif: {p.targetPallets} palettes</p>
                              </div>
                              <Play size={16} className="text-gray-300 group-hover:text-blue-500" fill="currentColor" />
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="py-8 text-center bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100">
                        <p className="text-gray-400 font-medium italic text-sm">Aucun programme actif pour cette ligne</p>
                        <p className="text-[10px] font-bold text-gray-300 uppercase mt-1">Contactez un administrateur</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-start">
                      <div className="overflow-hidden">
                        <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Programme en cours</h2>
                        <h1 className="text-lg sm:text-xl font-bold text-gray-800 truncate">{activeProgramme.name}</h1>
                      </div>
                      <div className="text-right flex flex-col items-end gap-1 shrink-0">
                        {activeLine?.status !== 'RUNNING' && (
                          <button 
                            onClick={() => handleSelectProgramme('')} 
                            className="text-[9px] font-black uppercase text-blue-600 hover:underline mb-1"
                          >
                            Changer
                          </button>
                        )}
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase font-bold tracking-tight">Cible</p>
                          <p className="text-base sm:text-lg font-bold text-gray-900">{activeProgramme.targetPallets}</p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mt-1">
                      <div className="bg-gray-50 p-2 rounded">
                        <p className="text-[8px] md:text-[10px] text-gray-500 uppercase font-bold">Produit</p>
                        <p className="text-sm md:text-lg font-bold text-blue-600">
                          {activeProgramme.producedPallets} <span className="text-[8px] md:text-xs font-normal text-gray-400">pal</span>
                        </p>
                      </div>
                      <div className="bg-gray-50 p-2 rounded border border-orange-50 lg:border-transparent">
                        <p className="text-[8px] md:text-[10px] text-gray-500 uppercase font-bold">Reste</p>
                        <p className="text-sm md:text-lg font-bold text-orange-600">
                          {Math.max(0, activeProgramme.targetPallets - activeProgramme.producedPallets)} <span className="text-[8px] md:text-xs font-normal text-gray-400">pal</span>
                        </p>
                      </div>
                      <div className="bg-gray-50 p-2 rounded col-span-2 lg:col-span-1 border border-green-50 lg:border-transparent">
                        <p className="text-[8px] md:text-[10px] text-gray-500 uppercase font-bold text-center lg:text-left">Efficacité</p>
                        <p className="text-sm md:text-lg font-bold text-green-600 text-center lg:text-left">
                          {activeProgramme.targetPallets > 0 
                            ? Math.round((activeProgramme.producedPallets / activeProgramme.targetPallets) * 100) 
                            : 0}%
                        </p>
                      </div>
                    </div>

                    <div className="w-full bg-gray-100 rounded-full h-2.5 mt-1 overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min((activeProgramme.producedPallets / activeProgramme.targetPallets) * 100, 100)}%` }}
                        className="h-full bg-blue-500 rounded-full shadow-inner"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* SAISIE CARD */}
              {activeLine?.status === 'RUNNING' && activeProgramme && (
                <div className="card p-4 sm:p-6 flex flex-col gap-3 sm:gap-4 animate-in fade-in slide-in-from-bottom-4">
                  <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">Saisie de Production</h2>
                  <div className="flex gap-2 sm:gap-3">
                    <input 
                      type="number"
                      value={palletInput}
                      onChange={e => setPalletInput(e.target.value)}
                      placeholder="0"
                      className="flex-1 border-2 border-gray-200 rounded-lg px-3 py-2 text-base sm:text-lg font-bold focus:border-blue-500 outline-none transition-colors shadow-inner"
                      autoFocus
                    />
                    <button 
                      onClick={handleAddPallets}
                      className="bg-[#3B82F6] text-white px-4 sm:px-6 py-2 rounded-lg font-bold hover:bg-blue-700 transition-all shadow-md active:scale-95 text-sm"
                    >
                      OK
                    </button>
                  </div>
                </div>
              )}

              {/* ACTIONS */}
              <div className="mt-auto flex gap-3 sm:gap-4 min-h-[60px] sm:min-h-[80px]">
                {activeLine?.status !== 'RUNNING' ? (
                  <button 
                    disabled={!activeProgramme || !!activeDowntime}
                    onClick={handleStartProduction}
                    className="flex-1 border-2 border-[#22C55E] text-[#15803D] bg-green-50/50 rounded-lg flex items-center justify-center gap-2 sm:gap-3 font-black text-sm sm:text-lg hover:bg-green-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow-sm uppercase italic tracking-tighter"
                  >
                    <Play size={20} sm:size={24} fill="currentColor" /> START
                  </button>
                ) : (
                  <button 
                    onClick={handleStopProduction}
                    className="flex-1 border-2 border-[#EF4444] text-[#B91C1C] bg-red-50 rounded-lg flex items-center justify-center gap-2 sm:gap-3 font-black text-sm sm:text-lg hover:bg-red-100 transition-colors shadow-sm uppercase italic tracking-tighter"
                  >
                    <Square size={20} sm:size={24} fill="currentColor" /> FIN
                  </button>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN: DOWNTIME */}
            <div className="lg:col-span-5 flex flex-col gap-4">
              <div className="card p-4 sm:p-5 flex-1 flex flex-col min-h-[250px] sm:min-h-[300px]">
                <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Déclarer un Arrêt</h2>
                {activeLine?.status !== 'RUNNING' && !activeDowntime && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-4 sm:p-6 space-y-2 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100 mb-4">
                    <AlertCircle className="text-gray-300" size={24} sm:size={32} />
                    <div className="space-y-1">
                      <p className="text-gray-400 font-bold text-[11px] sm:text-sm uppercase tracking-tight leading-none mb-1">Production non lancée</p>
                      <p className="text-[9px] text-gray-300 font-medium uppercase leading-tight">Lancez la production pour déclarer un arrêt</p>
                    </div>
                  </div>
                )}
                {activeDowntime ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-4 sm:p-6 space-y-4 sm:space-y-6 bg-orange-50/30 rounded-2xl border border-orange-100/50">
                    <div className="w-16 h-16 sm:w-20 sm:h-20 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 animate-pulse">
                      <Timer size={32} sm:size={40} />
                    </div>
                    <div className="w-full">
                      <p className="text-[10px] uppercase font-bold text-gray-400">Arrêt Actif</p>
                      <h4 className="text-lg sm:text-xl font-bold text-orange-900 truncate">
                        {downtimeTypes.find(t => t.id === activeDowntime.typeId)?.name || 'En cours'}
                      </h4>
                      {activeDowntime.description && (
                         <p className="text-[10px] bg-orange-50 text-orange-700 px-3 py-1 rounded-lg inline-block mt-1 font-bold max-w-full truncate">{activeDowntime.description}</p>
                      )}
                      
                      <div className="mt-3 w-full">
                        <input 
                          type="text"
                          placeholder="Note additionnelle..."
                          className="w-full text-[11px] p-3 bg-white border border-orange-100 rounded-xl outline-none focus:ring-2 focus:ring-orange-500 font-bold text-center shadow-inner"
                          defaultValue={activeDowntime.description || ''}
                          onBlur={async (e) => {
                            if (e.target.value !== activeDowntime.description) {
                              await localApi.updateDoc('downtime_logs', activeDowntime.id, {
                                description: e.target.value
                              });
                            }
                          }}
                        />
                      </div>

                      <p className="text-3xl sm:text-4xl font-mono font-black text-orange-600 mt-2">
                        {formatDuration(timer)}
                      </p>
                    </div>
                    <button 
                      onClick={handleStopDowntime}
                      className="w-full bg-orange-600 text-white py-3 sm:py-4 rounded-xl font-black text-base sm:text-lg shadow-xl shadow-orange-200 active:scale-95 transition-all uppercase tracking-widest"
                    >
                      REPRENDRE
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col gap-3 overflow-hidden">
                    <div className="flex-1 overflow-y-auto pr-1">
                      <div className="grid grid-cols-2 gap-2 sm:gap-3 pb-4">
                        {downtimeTypes.map((type) => (
                          <button
                            key={type.id}
                            disabled={activeLine?.status !== 'RUNNING'}
                            onClick={() => handleStartDowntime(type.id)}
                            className={cn(
                              "border border-orange-100 rounded-xl p-3 sm:p-4 text-left transition-all flex flex-col gap-1 sm:gap-2 active:scale-95 shadow-sm bg-white",
                              activeLine?.status !== 'RUNNING' ? "opacity-40 cursor-not-allowed grayscale" : "hover:bg-orange-50"
                            )}
                          >
                            <span className="text-xl sm:text-2xl">{type.icon || '⚠️'}</span>
                            <span className="text-[9px] sm:text-[10px] font-bold text-gray-700 leading-tight uppercase tracking-widest">{type.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="pt-2 border-t border-gray-50">
                      <input 
                        type="text"
                        placeholder="Note optionnelle..."
                        className="w-full text-[11px] p-2.5 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500 font-bold transition-all shadow-inner"
                        value={downtimeDescription}
                        onChange={e => setDowntimeDescription(e.target.value)}
                      />
                    </div>
                  </div>
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
