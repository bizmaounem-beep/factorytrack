import { useState, useEffect } from 'react';
import { pb } from '../lib/pocketbase';
import { useAuth } from '../contexts/AuthContext';
import { Machine, Line, Programme, DowntimeType, DowntimeLog } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Square, Settings, Timer, Package, AlertCircle } from 'lucide-react';
import { formatDuration, cn } from '../lib/utils';

export default function OperatorScreen() {
  const { user, logout } = useAuth();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [downtimeTypes, setDowntimeTypes] = useState<DowntimeType[]>([]);
  const [availableProgrammes, setAvailableProgrammes] = useState<Programme[]>([]);
  
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
    // Fetch initial data
    const initData = async () => {
      const machineList = await pb.collection('machines').getFullList<Machine>();
      setMachines(machineList);
      
      const typeList = await pb.collection('downtime_types').getFullList<DowntimeType>();
      setDowntimeTypes(typeList);
    };
    initData();

    // Subscribe to changes
    pb.collection('machines').subscribe<Machine>('*', (e) => {
      if (e.action === 'create') setMachines(prev => [...prev, e.record]);
      if (e.action === 'update') setMachines(prev => prev.map(m => m.id === e.record.id ? e.record : m));
      if (e.action === 'delete') setMachines(prev => prev.filter(m => m.id !== e.record.id));
    });

    pb.collection('downtime_types').subscribe<DowntimeType>('*', (e) => {
      if (e.action === 'create') setDowntimeTypes(prev => [...prev, e.record]);
      if (e.action === 'update') setDowntimeTypes(prev => prev.map(t => t.id === e.record.id ? e.record : t));
      if (e.action === 'delete') setDowntimeTypes(prev => prev.filter(t => t.id !== e.record.id));
    });

    return () => {
      pb.collection('machines').unsubscribe();
      pb.collection('downtime_types').unsubscribe();
    };
  }, []);

  // Listen to lines based on selected machine
  useEffect(() => {
    if (!selectedMachineId) return;
    
    const fetchLines = async () => {
      const records = await pb.collection('lines').getFullList<Line>({
        filter: `machineId = "${selectedMachineId}"`
      });
      setLines(records);
    };
    fetchLines();

    pb.collection('lines').subscribe<Line>('*', (e) => {
      if (e.record.machineId === selectedMachineId) {
        if (e.action === 'create') setLines(prev => [...prev, e.record]);
        if (e.action === 'update') setLines(prev => prev.map(l => l.id === e.record.id ? e.record : l));
        if (e.action === 'delete') setLines(prev => prev.filter(l => l.id !== e.record.id));
      }
    }, { filter: `machineId = "${selectedMachineId}"` });

    return () => pb.collection('lines').unsubscribe();
  }, [selectedMachineId]);

  // Listen to available programmes for the selected line
  useEffect(() => {
    if (!selectedLineId) {
      setAvailableProgrammes([]);
      return;
    }
    
    const fetchProgs = async () => {
      const records = await pb.collection('programmes').getFullList<Programme>({
        filter: `lineId = "${selectedLineId}" && status = "ACTIVE"`
      });
      setAvailableProgrammes(records);
    };
    fetchProgs();

    pb.collection('programmes').subscribe<Programme>('*', (e) => {
      if (e.record.lineId === selectedLineId) {
        if (e.action === 'create' && e.record.status === 'ACTIVE') setAvailableProgrammes(prev => [...prev, e.record]);
        if (e.action === 'update') {
          setAvailableProgrammes(prev => {
            const exists = prev.some(p => p.id === e.record.id);
            if (e.record.status === 'ACTIVE') {
              return exists ? prev.map(p => p.id === e.record.id ? e.record : p) : [...prev, e.record];
            }
            return prev.filter(p => p.id !== e.record.id);
          });
        }
        if (e.action === 'delete') setAvailableProgrammes(prev => prev.filter(p => p.id !== e.record.id));
      }
    });

    return () => pb.collection('programmes').unsubscribe();
  }, [selectedLineId]);

  // Listen to active line details and related records
  useEffect(() => {
    if (!selectedLineId) {
      setActiveLine(null);
      setActiveProgramme(null);
      setActiveDowntime(null);
      return;
    }

    let currentProgId: string | null = null;
    let currentDownId: string | null = null;

    const fetchActiveLine = async () => {
      try {
        const record = await pb.collection('lines').getOne<Line>(selectedLineId);
        handleLineUpdate(record);
      } catch (err) {
        console.error('Line not found');
      }
    };

    const handleLineUpdate = async (lineData: Line) => {
      setActiveLine(lineData);

      // Handle Programme Subscription
      if (lineData.currentProgrammeId) {
        if (lineData.currentProgrammeId !== currentProgId) {
          currentProgId = lineData.currentProgrammeId;
          const prog = await pb.collection('programmes').getOne<Programme>(lineData.currentProgrammeId);
          setActiveProgramme(prog);
          
          pb.collection('programmes').subscribe<Programme>(lineData.currentProgrammeId, (e) => {
            setActiveProgramme(e.record);
          });
        }
      } else {
        if (currentProgId) pb.collection('programmes').unsubscribe(currentProgId);
        currentProgId = null;
        setActiveProgramme(null);
      }

      // Handle Downtime Subscription
      if (lineData.activeDowntimeId) {
        if (lineData.activeDowntimeId !== currentDownId) {
          currentDownId = lineData.activeDowntimeId;
          const down = await pb.collection('downtime_logs').getOne<DowntimeLog>(lineData.activeDowntimeId);
          setActiveDowntime(down);
          
          pb.collection('downtime_logs').subscribe<DowntimeLog>(lineData.activeDowntimeId, (e) => {
            setActiveDowntime(e.record);
          });
        }
      } else {
        if (currentDownId) pb.collection('downtime_logs').unsubscribe(currentDownId);
        currentDownId = null;
        setActiveDowntime(null);
      }
    };

    fetchActiveLine();
    pb.collection('lines').subscribe<Line>(selectedLineId, (e) => {
      handleLineUpdate(e.record);
    });

    return () => {
      pb.collection('lines').unsubscribe(selectedLineId);
      if (currentProgId) pb.collection('programmes').unsubscribe(currentProgId);
      if (currentDownId) pb.collection('downtime_logs').unsubscribe(currentDownId);
    };
  }, [selectedLineId]);

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
    await pb.collection('lines').update(selectedLineId, {
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
    await pb.collection('lines').update(selectedLineId, {
      status: 'IDLE'
    });
  };

  const handleAddPallets = async () => {
    const count = parseInt(palletInput);
    if (isNaN(count) || count <= 0 || !activeProgramme || !user) return;

    // Log production
    await pb.collection('production_logs').create({
      programmeId: activeProgramme.id,
      operatorId: user.id,
      machineId: activeLine?.machineId,
      lineId: activeLine?.id,
      count,
      timestamp: new Date().toISOString()
    });

    // Update programme total
    await pb.collection('programmes').update(activeProgramme.id, {
      producedPallets: activeProgramme.producedPallets + count
    });

    setPalletInput('');
  };

  const handleStartDowntime = async (typeId: string) => {
    if (!selectedLineId || !user || !activeLine) return;

    try {
      // Create log
      const log = await pb.collection('downtime_logs').create({
        machineId: activeLine.machineId,
        lineId: activeLine.id,
        typeId,
        description: downtimeDescription,
        operatorId: user.id,
        startTime: new Date().toISOString()
      });

      // Update line
      await pb.collection('lines').update(selectedLineId, {
        status: 'STOPPED',
        activeDowntimeId: log.id
      });
      
      setDowntimeDescription('');
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
    await pb.collection('downtime_logs').update(activeDowntime.id, {
      endTime,
      duration
    });

    // Update line
    await pb.collection('lines').update(selectedLineId, {
      activeDowntimeId: null,
      status: 'IDLE'
    });
  };

  const handleSelectProgramme = async (progId: string) => {
    if (!selectedLineId) return;
    const updates: any = {
      currentProgrammeId: progId
    };
    if (!progId) {
      updates.status = 'IDLE';
    }
    await pb.collection('lines').update(selectedLineId, updates);
  };

  if (!selectedMachineId) {
    return (
      <div className="p-4 space-y-4">
        <h2 className="text-xl font-bold">Sélectionner Machine</h2>
        <div className="grid gap-3">
          {machines.map(m => (
            <button
              key={m.id}
              onClick={() => setSelectedMachineId(m.id)}
              className="p-6 bg-white rounded-xl shadow-sm border border-gray-100 text-left font-medium active:bg-gray-50"
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!selectedLineId) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setSelectedMachineId(null)} className="text-blue-600 font-medium">← Back</button>
          <h2 className="text-xl font-bold">Sélectionner Ligne</h2>
        </div>
        <div className="grid gap-3">
          {lines.map(l => (
            <button
              key={l.id}
              onClick={() => setSelectedLineId(l.id)}
              className="p-6 bg-white rounded-xl shadow-sm border border-gray-100 text-left font-medium active:bg-gray-50"
            >
              {l.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6] flex flex-col overflow-hidden">
      {/* HEADER */}
      <header className="bg-white border-b border-gray-200 px-4 py-4 flex justify-between items-center shadow-sm shrink-0">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Opérateur</p>
            <p className="text-sm font-bold text-gray-900">{user?.name}</p>
          </div>
          <div className="h-8 w-px bg-gray-200 mx-1" />
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">Poste</p>
            <p className="text-sm font-bold text-gray-900">
              {machines.find(m => m.id === activeLine?.machineId)?.name} 
              <span className="text-blue-600"> | {activeLine?.name}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5",
            activeLine?.status === 'RUNNING' ? "bg-status-running-bg text-status-running-text" :
            activeLine?.status === 'STOPPED' ? "bg-status-stopped-bg text-status-stopped-text" : 
            "bg-status-idle-bg text-status-idle-text"
          )}>
            <span className={cn(
              "w-2 h-2 rounded-full",
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
              <div className="card p-6 flex flex-col gap-4 border-l-4 border-blue-500">
                {!activeProgramme ? (
                  <div className="py-2 space-y-4">
                    <div className="flex items-center gap-2 text-gray-400">
                      <Package size={20} />
                      <h2 className="text-xs font-bold uppercase tracking-widest">Choisir un Programme</h2>
                    </div>
                    {availableProgrammes.length > 0 ? (
                      <div className="grid gap-2">
                        {availableProgrammes.map(p => (
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
                        <p className="text-gray-400 font-medium italic">Aucun programme actif pour cette ligne</p>
                        <p className="text-[10px] font-bold text-gray-300 uppercase mt-1">Contactez un administrateur</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-start">
                      <div>
                        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest leading-none mb-1">Programme en cours</h2>
                        <h1 className="text-xl font-bold text-gray-800">{activeProgramme.name}</h1>
                      </div>
                      <div className="text-right flex flex-col items-end gap-1">
                        {activeLine?.status !== 'RUNNING' && (
                          <button 
                            onClick={() => handleSelectProgramme('')} 
                            className="text-[9px] font-black uppercase text-blue-600 hover:underline mb-1"
                          >
                            Changer
                          </button>
                        )}
                        <div>
                          <p className="text-xs text-gray-400 uppercase font-bold tracking-tight">Cible</p>
                          <p className="text-lg font-bold text-gray-900">{activeProgramme.targetPallets}</p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-3 mt-1">
                      <div className="bg-gray-50 p-2.5 rounded">
                        <p className="text-[10px] text-gray-500 uppercase font-bold">Produit</p>
                        <p className="text-lg font-bold text-blue-600">
                          {activeProgramme.producedPallets} <span className="text-xs font-normal text-gray-400">pal</span>
                        </p>
                      </div>
                      <div className="bg-gray-50 p-2.5 rounded">
                        <p className="text-[10px] text-gray-500 uppercase font-bold">Reste</p>
                        <p className="text-lg font-bold text-orange-600">
                          {Math.max(0, activeProgramme.targetPallets - activeProgramme.producedPallets)} <span className="text-xs font-normal text-gray-400">pal</span>
                        </p>
                      </div>
                      <div className="bg-gray-50 p-2.5 rounded">
                        <p className="text-[10px] text-gray-500 uppercase font-bold">Efficacité</p>
                        <p className="text-lg font-bold text-green-600">
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
                <div className="card p-6 flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4">
                  <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest leading-none">Saisie de Production</h2>
                  <div className="flex gap-3">
                    <input 
                      type="number"
                      value={palletInput}
                      onChange={e => setPalletInput(e.target.value)}
                      placeholder="Entrer palettes"
                      className="flex-1 border-2 border-gray-200 rounded-lg px-4 py-3 text-lg font-bold focus:border-blue-500 outline-none transition-colors"
                      autoFocus
                    />
                    <button 
                      onClick={handleAddPallets}
                      className="bg-[#3B82F6] text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 transition-all shadow-md active:scale-95"
                    >
                      + Ajouter
                    </button>
                  </div>
                </div>
              )}

              {/* ACTIONS */}
              <div className="mt-auto flex gap-4 min-h-[80px]">
                {activeLine?.status !== 'RUNNING' ? (
                  <button 
                    disabled={!activeProgramme || !!activeDowntime}
                    onClick={handleStartProduction}
                    className="flex-1 border-2 border-[#22C55E] text-[#15803D] bg-green-50/50 rounded-lg flex items-center justify-center gap-3 font-bold text-lg hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                  >
                    <Play size={24} fill="currentColor" /> START PRODUCTION
                  </button>
                ) : (
                  <button 
                    onClick={handleStopProduction}
                    className="flex-1 border-2 border-[#EF4444] text-[#B91C1C] bg-red-50 rounded-lg flex items-center justify-center gap-3 font-bold text-lg hover:bg-red-100 transition-colors shadow-sm"
                  >
                    <Square size={24} fill="currentColor" /> FIN PRODUCTION
                  </button>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN: DOWNTIME */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              <div className="card p-5 flex-1 flex flex-col min-h-[300px]">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Déclarer un Arrêt (Downtime)</h2>
                {activeDowntime ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-6 bg-orange-50/30 rounded-2xl border border-orange-100/50">
                    <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 animate-pulse">
                      <Timer size={40} />
                    </div>
                    <div className="w-full">
                      <p className="text-xs uppercase font-bold text-gray-400">Arrêt Actif</p>
                      <h4 className="text-xl font-bold text-orange-900 group-hover:text-orange-950 transition-colors">
                        {downtimeTypes.find(t => t.id === activeDowntime.typeId)?.name || 'Arrêt en cours'}
                      </h4>
                      {activeDowntime.description && (
                         <p className="text-xs bg-orange-50 text-orange-700 px-3 py-1.5 rounded-lg inline-block mt-2 font-bold max-w-full truncate">{activeDowntime.description}</p>
                      )}
                      
                      <div className="mt-4 w-full">
                        <h3 className="text-[10px] font-bold text-orange-400 uppercase tracking-widest mb-1.5 text-center">Note additionnelle</h3>
                        <input 
                          type="text"
                          placeholder="Ex: Bourrage sortie, Panne élec..."
                          className="w-full text-xs p-4 bg-white border border-orange-100 rounded-xl outline-none focus:ring-2 focus:ring-orange-500 font-bold text-center shadow-inner"
                          defaultValue={activeDowntime.description || ''}
                          onBlur={async (e) => {
                            if (e.target.value !== activeDowntime.description) {
                              await pb.collection('downtime_logs').update(activeDowntime.id, {
                                description: e.target.value
                              });
                            }
                          }}
                        />
                      </div>

                      <p className="text-4xl font-mono font-black text-orange-600 mt-2">
                        {formatDuration(timer)}
                      </p>
                    </div>
                    <button 
                      onClick={handleStopDowntime}
                      className="w-full bg-orange-600 text-white py-4 rounded-xl font-black text-lg shadow-xl shadow-orange-200 active:scale-95 transition-all uppercase tracking-widest"
                    >
                      Stop Arrêt / Reprendre
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col gap-4 overflow-hidden">
                    <div className="flex-1 overflow-y-auto pr-1">
                      <div className="grid grid-cols-2 gap-3 pb-4">
                        {downtimeTypes.map((type) => (
                          <button
                            key={type.id}
                            onClick={() => handleStartDowntime(type.id)}
                            className="border border-orange-100 rounded-xl p-4 text-left hover:bg-orange-50 transition-all flex flex-col gap-2 active:scale-95 shadow-sm bg-white"
                          >
                            <span className="text-2xl">{type.icon || '⚠️'}</span>
                            <span className="text-[10px] font-bold text-gray-700 leading-tight uppercase tracking-widest">{type.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="pt-2 border-t border-gray-50">
                      <h3 className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1 shadow-sm inline-block px-2 bg-gray-50 rounded">Précisions avant arrêt (Optionnel)</h3>
                      <input 
                        type="text"
                        placeholder="Ex: Bourrage sortie..."
                        className="w-full text-xs p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500 font-bold transition-all"
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
