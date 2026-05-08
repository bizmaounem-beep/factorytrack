import { useState, useEffect } from 'react';
import { localApi } from '../lib/localApi';
import { useAuth } from '../contexts/AuthContext';
import { Machine, Line, Programme, DowntimeType, DowntimeLog } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Square, Settings, Timer, Package, AlertCircle, CheckCircle, Factory, Monitor, Activity, Plus, Minus } from 'lucide-react';
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
            
            {/* MAIN AREA: DOWNTIME (Priority when running) */}
            <div className="lg:col-span-12 flex flex-col gap-4">
              <div className="card p-4 sm:p-5 flex-1 flex flex-col min-h-[250px] sm:min-h-[300px] border-l-4 border-orange-500">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    {activeDowntime ? "Arrêt en cours" : "Déclarer un Arrêt"}
                  </h2>
                  {activeLine?.status === 'RUNNING' && (
                    <div className="flex items-center gap-2">
                       <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                       <span className="text-[10px] font-bold text-green-600 uppercase">Production Active</span>
                    </div>
                  )}
                </div>

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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full items-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-16 h-16 sm:w-20 sm:h-20 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 animate-pulse shadow-inner">
                          <Timer size={32} sm:size={40} />
                        </div>
                        <div className="text-center">
                           <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Motif d'arrêt</p>
                           <h4 className="text-xl sm:text-2xl font-black text-orange-900 leading-tight">
                            {downtimeTypes.find(t => t.id === activeDowntime.typeId)?.name || 'En cours'}
                          </h4>
                        </div>
                      </div>

                      <div className="flex flex-col items-center gap-2">
                         <p className="text-[10px] uppercase font-bold text-gray-400 mb-1">Temps écoulé</p>
                         <p className="text-4xl sm:text-6xl font-mono font-black text-orange-600 tabular-nums">
                          {formatDuration(timer)}
                        </p>
                      </div>
                    </div>

                    <div className="w-full max-w-sm space-y-4">
                      <input 
                        type="text"
                        placeholder="Note additionnelle (optionnel)..."
                        className="w-full text-sm p-4 bg-white border-2 border-orange-100 rounded-2xl outline-none focus:border-orange-500 font-bold text-center shadow-sm transition-all"
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
                        className="w-full bg-orange-600 text-white py-5 rounded-2xl font-black text-xl shadow-xl shadow-orange-200 active:scale-95 transition-all uppercase tracking-widest flex items-center justify-center gap-3"
                      >
                        <Play size={24} fill="currentColor" /> REPRENDRE
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col gap-4 overflow-hidden">
                    <div className="flex-1 overflow-y-auto pr-1">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 pb-4">
                        {downtimeTypes.map((type) => (
                          <button
                            key={type.id}
                            disabled={activeLine?.status !== 'RUNNING'}
                            onClick={() => handleStartDowntime(type.id)}
                            className={cn(
                              "border-2 rounded-2xl p-4 text-left transition-all flex flex-col items-center text-center gap-3 active:scale-95 shadow-sm group",
                              activeLine?.status !== 'RUNNING' 
                                ? "bg-gray-50 border-gray-100 opacity-40 cursor-not-allowed grayscale" 
                                : "bg-white border-orange-50 hover:bg-orange-50 hover:border-orange-200"
                            )}
                          >
                            <span className="text-3xl transition-transform group-hover:scale-110">{type.icon || '⚠️'}</span>
                            <span className="text-[10px] font-black text-gray-700 leading-tight uppercase tracking-widest">{type.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    {activeLine?.status === 'RUNNING' && (
                      <div className="pt-4 border-t border-gray-100 max-w-md mx-auto w-full">
                        <input 
                          type="text"
                          placeholder="Note de panne avant de cliquer sur un motif..."
                          className="w-full text-sm p-4 bg-gray-50 border-2 border-gray-100 rounded-2xl outline-none focus:border-orange-500 focus:bg-white font-bold transition-all shadow-inner"
                          value={downtimeDescription}
                          onChange={e => setDowntimeDescription(e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* SECONDARY AREA: PRODUCTION & PROGRAMME */}
            <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-2 gap-6">
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
                                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mt-1">Programme de production</p>
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
                      <div className="overflow-hidden text-left">
                        <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Programme en cours</h2>
                        <h1 className="text-lg sm:text-xl font-bold text-gray-800 truncate">{activeProgramme.name}</h1>
                      </div>
                      <div className="text-right flex flex-col items-end gap-1 shrink-0">
                        {activeLine?.status !== 'RUNNING' && (
                          <button 
                            onClick={() => handleSelectProgramme('')} 
                            className="text-[9px] font-black uppercase text-blue-600 hover:underline"
                          >
                            Changer
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {activeLine?.tracksProduction !== 0 && (
                      <div className="grid grid-cols-1 gap-2 mt-1">
                        <div className="bg-gray-50 p-4 rounded-xl border border-blue-50 text-center">
                          <p className="text-[10px] text-gray-500 uppercase font-bold tracking-widest mb-1">Total Produit</p>
                          <p className="text-4xl font-black text-blue-600 italic leading-none">
                            {activeProgramme.producedPallets} <span className="text-sm font-bold text-gray-400 not-italic uppercase tracking-tight">Palettes</span>
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* SAISIE CARD */}
              {activeLine?.status === 'RUNNING' && activeProgramme && activeLine?.tracksProduction !== 0 ? (
                <div className="card p-5 flex flex-col gap-4 border-l-4 border-blue-600 bg-blue-50/20">
                  <h2 className="text-[10px] font-black text-blue-600 uppercase tracking-widest leading-none">Ajuster Production</h2>
                  <div className="flex items-center gap-3">
                    <div className="flex bg-white rounded-2xl shadow-inner border-2 border-blue-100 overflow-hidden flex-1 shrink-0">
                      <button 
                        onClick={() => {
                          const val = (parseInt(palletInput) || 1) - 1;
                          setPalletInput(Math.max(1, val).toString());
                        }}
                        className="p-4 bg-gray-50 hover:bg-gray-100 text-gray-400 transition-colors border-r border-gray-100"
                      >
                        <Minus size={20} />
                      </button>
                      <input 
                        type="number"
                        value={palletInput}
                        onChange={e => setPalletInput(e.target.value)}
                        className="w-full px-4 py-3 text-2xl font-black text-center outline-none bg-transparent text-gray-900"
                      />
                      <button 
                        onClick={() => {
                          const val = (parseInt(palletInput) || 0) + 1;
                          setPalletInput(val.toString());
                        }}
                        className="p-4 bg-gray-50 hover:bg-gray-100 text-gray-400 transition-colors border-l border-gray-100"
                      >
                        <Plus size={20} />
                      </button>
                    </div>

                    <button 
                      onClick={() => handleAddPallets()}
                      className="h-[60px] px-8 bg-blue-600 text-white rounded-2xl font-black hover:bg-blue-700 transition-all shadow-lg active:scale-95 flex items-center gap-2 uppercase tracking-widest text-sm"
                    >
                      VALIDER
                    </button>
                  </div>
                  <div className="flex justify-center gap-4 text-gray-400">
                     <button onClick={() => handleAddPallets(1)} className="text-[10px] hover:text-blue-600 font-bold uppercase transition-colors">+1 RAPIDE</button>
                     <div className="w-px h-3 bg-gray-200 mt-1" />
                     <button onClick={() => handleAddPallets(-1)} className="text-[10px] hover:text-red-500 font-bold uppercase transition-colors">-1 (ERREUR)</button>
                  </div>
                </div>
              ) : (
                <div className="card p-5 flex flex-col items-center justify-center border-2 border-dashed border-gray-100 bg-gray-50/50 text-gray-300">
                   <p className="text-[10px] font-black uppercase tracking-widest">Saisie Production</p>
                   <p className="text-[8px] font-bold uppercase tracking-tight text-center mt-1">Désactivé ou Production non lancée</p>
                </div>
              )}
            </div>

            {/* ACTIONS */}
            <div className="lg:col-span-12 mt-4">
              <div className="flex gap-3 sm:gap-4 min-h-[60px] sm:min-h-[80px]">
                {activeLine?.status !== 'RUNNING' ? (
                  <div className="flex gap-2 sm:gap-4 w-full">
                    <button 
                      disabled={!activeProgramme || !!activeDowntime}
                      onClick={handleStartProduction}
                      className="flex-[3] border-2 border-[#22C55E] text-[#15803D] bg-green-50/50 rounded-2xl flex items-center justify-center gap-2 sm:gap-3 font-black text-sm sm:text-2xl hover:bg-green-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shadow-sm uppercase italic tracking-tighter"
                    >
                      <Play size={24} fill="currentColor" /> START PRODUCTION
                    </button>
                    {activeProgramme && !activeDowntime && (
                      <button 
                        onClick={handleFinishProgramme}
                        className="flex-1 border-2 border-gray-400 text-gray-600 bg-gray-50 rounded-2xl flex flex-col items-center justify-center gap-1 font-black px-2 shadow-sm uppercase tracking-tighter hover:bg-white hover:border-blue-400 hover:text-blue-600 transition-all group"
                      >
                        <CheckCircle size={18} className="text-gray-400 group-hover:text-blue-500" />
                        <span className="text-[8px] sm:text-[10px]">Clôturer</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <button 
                    onClick={handleStopProduction}
                    className="flex-1 border-2 border-[#EF4444] text-[#B91C1C] bg-red-50 rounded-2xl flex items-center justify-center gap-2 sm:gap-3 font-black text-sm sm:text-2xl hover:bg-red-100 transition-colors shadow-sm uppercase italic tracking-tighter"
                  >
                    <Square size={24} fill="currentColor" /> TERMINER SESSION
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
