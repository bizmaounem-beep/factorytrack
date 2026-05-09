import { useState, useEffect } from 'react';
import { localApi } from '../lib/localApi';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Line } from '../types';
import { Play, Square, Settings, Timer, Package, AlertCircle, CheckCircle, Factory, Monitor, Activity, Plus, Minus, ArrowLeft, X } from 'lucide-react';
import { formatDuration, cn } from '../lib/utils';

export default function OperatorScreen() {
  const { user, logout } = useAuth();
  const { 
    machines, 
    lines, 
    users, 
    downtimeTypes, 
    programmes: availableProgrammes, 
    downtimeLogs 
  } = useData();
  
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  
  const [selectedStopType, setSelectedStopType] = useState<string | null>(null);
  const [showManualStopModal, setShowManualStopModal] = useState(false);
  const [selectedProgrammeForChange, setSelectedProgrammeForChange] = useState<string | null>(null);
  
  const [palletInput, setPalletInput] = useState('1');
  const [downtimeDescription, setDowntimeDescription] = useState('');
  const [timer, setTimer] = useState(0);
  const [isPostProduction, setIsPostProduction] = useState(false);

  const activeLine = lines.find(l => l.id === selectedLineId) || null;
  const activeProgramme = activeLine ? availableProgrammes.find(p => p.id === activeLine.currentProgrammeId) || null : null;
  const activeDowntime = activeLine?.activeDowntimeId ? downtimeLogs.find(d => d.id === activeLine.activeDowntimeId) || null : null;

  // Derive categorizing log
  const categorizingLog = !activeDowntime && activeLine 
    ? downtimeLogs.find(d => d.lineId === activeLine.id && d.operatorId === user?.id && d.typeId === 'PENDING' && d.endTime) || null 
    : null;
  const categorizingLogId = categorizingLog?.id || null;

  const [flashFeedback, setFlashFeedback] = useState(false);

  // Session Persistence
  useEffect(() => {
    if (!user || selectedLineId || lines.length === 0) return;
    const activeLines = lines.filter(l => l.isActive !== false);
    const myActiveLine = activeLines.find(l => l.currentOperatorId === user.id);
    if (myActiveLine) {
      setSelectedMachineId(myActiveLine.machineId);
      setSelectedLineId(myActiveLine.id);
    }
  }, [user, lines]);

  // Flash feedback on production change
  useEffect(() => {
    if (activeProgramme) {
      // We rely on previous value of producedPallets via a ref or just skip for now to simplify
    }
  }, [activeProgramme?.producedPallets]);

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
      // Release any line held by this operator that isn't actively running
      const heldLines = lines.filter(l => l.currentOperatorId === user?.id && l.status !== 'RUNNING');
      for (const line of heldLines) {
        await localApi.updateDoc('lines', line.id, {
          currentOperatorId: null
        });
      }
    } catch (e) {
      console.error("Error releasing lines on logout:", e);
    }
    logout();
  };

  const handleSelectLine = async (line: Line) => {
    if (!user) return;
    
    try {
      // Claim the line in the DB so others see it as occupied
      await localApi.updateDoc('lines', line.id, {
        currentOperatorId: user.id
      });
      setSelectedLineId(line.id);
    } catch (e) {
      console.error("Error claiming line:", e);
      // Still set it locally in case of minor network issues, or handle error
      setSelectedLineId(line.id);
    }
  };

  const handleGoBackFromLine = async () => {
    if (selectedLineId && user) {
      const line = lines.find(l => l.id === selectedLineId);
      // Only release if it's currently IDLE (not running, not stopped)
      if (line && line.status === 'IDLE') {
        try {
          await localApi.updateDoc('lines', selectedLineId, {
            currentOperatorId: null
          });
        } catch (e) {
          console.error("Error releasing line on back:", e);
        }
      }
    }
    setSelectedLineId(null);
  };

  const handleStartProduction = async () => {
    if (!selectedLineId || !activeProgramme) return;
    try {
      await localApi.updateDoc('lines', selectedLineId, {
        status: 'RUNNING',
        currentOperatorId: user?.id
      });
      setIsPostProduction(false);
    } catch (e) {
      console.error(e);
      alert('Erreur lors du lancement de la production. Réessayez.');
    }
  };

  const handleStopProduction = async () => {
    if (!selectedLineId) return;

    try {
      await localApi.updateDoc('lines', selectedLineId, {
        status: 'IDLE',
      });
      setIsPostProduction(true);
    } catch (e) {
      console.error(e);
      alert('Erreur lors de l\'arrêt de la production.');
    }
  };

  const handleAddPallets = async (overrideCount?: number) => {
    let count = typeof overrideCount === 'number' ? overrideCount : parseInt(palletInput);
    if (isNaN(count) || !activeProgramme || !user || !selectedLineId) return;

    try {
      // Log production
      await localApi.addDoc('production_logs', {
        programmeId: activeProgramme.id,
        operatorId: user.id,
        machineId: activeLine?.machineId,
        lineId: activeLine?.id,
        count, // can be negative for removal
        timestamp: new Date().toISOString()
      });

      // Update programme total and mark as finished
      await localApi.updateDoc('programmes', activeProgramme.id, {
        producedPallets: (activeProgramme.producedPallets || 0) + count,
        status: 'FINISHED'
      });

      // Clear the line's current programme and operator so it's ready for the next one
      await localApi.updateDoc('lines', selectedLineId, {
        currentProgrammeId: null,
        currentOperatorId: null,
        status: 'IDLE'
      });

      setPalletInput('1');
      setIsPostProduction(false);
    } catch (e) {
      console.error(e);
    }
  };

  const handleStartDowntime = async () => {
    if (!selectedLineId || !user || !activeLine) return;

    if (activeLine.status !== 'RUNNING') {
      alert('La production doit être lancée pour déclarer un arrêt.');
      return;
    }

    try {
      const docRef = await localApi.addDoc('downtime_logs', {
        machineId: activeLine.machineId,
        lineId: activeLine.id,
        typeId: 'PENDING',
        description: downtimeDescription,
        operatorId: user.id,
        startTime: new Date().toISOString()
      });

      await localApi.updateDoc('lines', selectedLineId, {
        status: 'STOPPED',
        activeDowntimeId: docRef.id
      });
      
      setDowntimeDescription('');
    } catch (error) {
      console.error('Error starting downtime:', error);
      alert('Erreur: Impossible de démarrer l\'arrêt.');
    }
  };

  const handleStopDowntime = async () => {
    if (!selectedLineId || !activeDowntime) return;

    const endTime = new Date().toISOString();
    const startTime = new Date(activeDowntime.startTime).getTime();
    const duration = Date.now() - startTime;

    try {
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
    } catch (error) {
      console.error('Error stopping downtime:', error);
    }
  };

  const handleCategorizeStop = async (typeId: string) => {
    if (!categorizingLogId) return;

    const selectedType = downtimeTypes.find(t => t.id === typeId);
    const isChangeProg = selectedType?.name?.toUpperCase().includes('CHANGEMENT') || selectedType?.name?.toUpperCase().includes('PROGRAMME');

    if (isChangeProg && !selectedProgrammeForChange) {
      setSelectedStopType(typeId);
      return;
    }

    try {
      await localApi.updateDoc('downtime_logs', categorizingLogId, {
        typeId,
        description: isChangeProg ? `Chang. vers: ${availableProgrammes.find(p => p.id === selectedProgrammeForChange)?.name}` : undefined
      });

      if (isChangeProg && selectedProgrammeForChange && selectedLineId) {
        // Find if the operator is currently on this line
        await localApi.updateDoc('lines', selectedLineId, {
          currentProgrammeId: selectedProgrammeForChange
        });
        setSelectedProgrammeForChange(null);
      }

      setSelectedStopType(null);
    } catch (error) {
      console.error('Error categorizing downtime:', error);
    }
  };

  const handleManualStop = async (data: { typeId: string, startTime: string, endTime: string, description: string }) => {
    if (!selectedLineId || !user || !activeLine) return;

    try {
      const start = new Date(data.startTime).getTime();
      const end = new Date(data.endTime).getTime();
      const durationMs = end - start;

      if (durationMs <= 0) {
        alert('L\'heure de fin doit être après l\'heure de début.');
        return;
      }

      await localApi.addDoc('downtime_logs', {
        machineId: activeLine.machineId,
        lineId: activeLine.id,
        typeId: data.typeId,
        description: data.description,
        operatorId: user.id,
        startTime: data.startTime,
        endTime: data.endTime,
        duration: durationMs
      });
      setShowManualStopModal(false);
      setManualStopForm({
        typeId: '',
        startTime: new Date(Date.now() - 15 * 60000).toISOString().slice(0, 16),
        endTime: new Date().toISOString().slice(0, 16),
        description: ''
      });
    } catch (error) {
      console.error('Error adding manual stop:', error);
      alert('Erreur lors de l\'ajout manuel.');
    }
  };

  const [manualStopForm, setManualStopForm] = useState({
    typeId: '',
    startTime: new Date(Date.now() - 15 * 60000).toISOString().slice(0, 16),
    endTime: new Date().toISOString().slice(0, 16),
    description: ''
  });

  const calculateManualDuration = () => {
    const start = new Date(manualStopForm.startTime).getTime();
    const end = new Date(manualStopForm.endTime).getTime();
    const diff = end - start;
    if (diff <= 0) return '0 min';
    const mins = Math.floor(diff / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    return `${mins} min ${secs}s`;
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
    setIsPostProduction(false);
  };

  if (!selectedMachineId) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col">
        <header className="h-10 bg-slate-900 text-white flex items-center justify-between px-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Factory size={14} className="text-slate-400" />
            <span className="text-[10px] font-black uppercase tracking-widest italic">FACTORYTRACK <span className="text-blue-500 font-bold">OPERATOR</span></span>
          </div>
          <button onClick={handleLogout} className="bg-white/10 hover:bg-red-600 px-2 py-0.5 rounded font-black text-[8px] uppercase tracking-widest transition-colors">Logout</button>
        </header>

        <main className="flex-1 p-3 overflow-y-auto">
          <div className="max-w-2xl mx-auto space-y-3">
            <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-200 pb-1.5">Sélectionner Machine</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {machines.map(m => (
                <button
                  key={m.id}
                  onClick={() => setSelectedMachineId(m.id)}
                  className="p-3 bg-white border border-slate-200 rounded flex flex-col items-center gap-1.5 hover:border-blue-500 transition-all text-center group shadow-sm"
                >
                  <Factory size={20} className="text-slate-300 group-hover:text-blue-500" />
                  <span className="text-[11px] font-black text-slate-800 uppercase truncate w-full">{m.name}</span>
                </button>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!selectedLineId) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col">
        <header className="h-10 bg-slate-900 text-white flex items-center justify-between px-3 border-b border-white/10 shrink-0">
          <button onClick={() => {
            if (selectedLineId) handleGoBackFromLine();
            else setSelectedMachineId(null);
          }} className="hover:text-blue-400 transition-colors">
            <ArrowLeft size={16} />
          </button>
          <span className="text-[10px] font-black uppercase tracking-widest">{machines.find(m => m.id === selectedMachineId)?.name}</span>
          <button onClick={handleLogout} className="bg-white/10 hover:bg-red-600 px-2 py-0.5 rounded font-black text-[8px] uppercase tracking-widest transition-colors">Logout</button>
        </header>

        <main className="flex-1 p-3 overflow-y-auto">
          <div className="max-w-2xl mx-auto space-y-3">
             <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-200 pb-1.5">Sélectionner Ligne</h2>
             <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {lines.filter(l => l.machineId === selectedMachineId && l.isActive !== false).map(l => {
                // A line is ONLY busy if it is actively RUNNING or in an ARRÊT (STOPPED) by someone else
                // If it's IDLE, anyone can take it, even if someone else's ID is still there (stale session)
                const isBusy = l.status !== 'IDLE' && l.currentOperatorId !== user?.id;
                const operatorName = users.find(u => u.id === l.currentOperatorId)?.name;

                return (
                  <button
                    key={l.id}
                    disabled={isBusy}
                    onClick={() => handleSelectLine(l)}
                    className={cn(
                      "p-4 bg-white rounded-xl border-2 transition-all shadow-sm flex flex-col items-center justify-center gap-1.5 relative group",
                      isBusy ? "opacity-40 cursor-not-allowed bg-slate-50 border-slate-100" : "hover:border-blue-500 border-slate-100"
                    )}
                  >
                    <div className="absolute top-2 right-2">
                      <span className={cn(
                        "w-2 h-2 rounded-full",
                        l.status === 'RUNNING' ? "bg-green-500 animate-pulse" : 
                        l.status === 'STOPPED' ? "bg-red-500" : "bg-slate-300"
                      )} />
                    </div>
                    <Monitor size={24} className={cn("text-slate-300", !isBusy && "group-hover:text-blue-500 transition-colors")} />
                    <div className="text-center">
                      <p className="text-[11px] font-black text-slate-800 uppercase truncate max-w-[100px]">{l.name}</p>
                      {isBusy && (
                        <p className="text-[8px] font-bold text-red-500 uppercase mt-0.5 animate-in fade-in">
                          {operatorName || (l.status === 'STOPPED' ? 'Arrêt Machine' : 'Occupé')}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#F3F4F6] flex flex-col overflow-hidden">
      {/* HEADER */}
      <header className="bg-white border-b border-gray-200 px-2 py-0.5 flex flex-row justify-between items-center gap-0.5 shadow-sm shrink-0">
        <div className="flex items-center gap-1 overflow-hidden">
          {!activeLine?.status || activeLine?.status === 'IDLE' ? (
            <button 
              onClick={handleGoBackFromLine}
              className="p-0.5 hover:bg-gray-100 rounded text-gray-500 transition-colors shrink-0"
            >
              <ArrowLeft size={12} />
            </button>
          ) : (
            <div className="p-0.5 text-gray-100 cursor-not-allowed shrink-0">
              <ArrowLeft size={12} />
            </div>
          )}
          <div className="shrink-0 leading-none">
            <p className="text-[5px] text-gray-400 uppercase tracking-tight font-semibold">Op</p>
            <p className="text-[8px] font-black text-gray-900 truncate max-w-[60px]">{user?.name}</p>
          </div>
          <div className="h-2 w-px bg-gray-200" />
          <div className="overflow-hidden leading-none">
            <p className="text-[5px] text-gray-400 uppercase tracking-tight font-semibold">Poste</p>
            <p className="text-[8px] font-black text-gray-900 truncate">
              {machines.find(m => m.id === activeLine?.machineId)?.name} 
              <span className="text-blue-600"> | {activeLine?.name}</span>
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          <span className={cn(
            "px-1 py-0 rounded-full text-[5px] font-black uppercase tracking-tight flex items-center gap-0.5",
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
             activeLine?.status === 'STOPPED' ? "ARRÊT" : "WAIT"}
          </span>
          <button onClick={handleLogout} className="p-0.5 bg-red-50 rounded text-red-500 font-black text-[7px] uppercase px-1 border border-red-100">
             OUT
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-1.5 sm:p-2 bg-slate-50/50">
        <div className="max-w-5xl mx-auto space-y-2">
          <div className="grid grid-cols-1 gap-2">
            
            {/* MAIN AREA: DOWNTIME */}
            <div className={cn(
              "bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden flex flex-col",
              activeDowntime ? "ring-1 ring-orange-500 border-orange-500 shadow-md" : ""
            )}>
              <div className="p-1.5 sm:p-2 flex flex-col gap-1.5">
                <div className="flex justify-between items-center border-b border-slate-50 pb-1">
                  <h2 className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                    <Activity size={10} className={activeDowntime ? "text-orange-500" : "text-slate-300"} />
                    {activeDowntime ? "Arrêt" : "Gestion Arrêts"}
                  </h2>
                  {activeLine?.status === 'RUNNING' && (
                    <div className="flex items-center gap-1 bg-green-50 px-1 py-0 rounded border border-green-100">
                       <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
                       <span className="text-[6px] font-black text-green-700 uppercase tracking-tight">Prod OK</span>
                    </div>
                  )}
                </div>

                {activeLine?.status !== 'RUNNING' && !activeDowntime && !categorizingLogId && (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-3 space-y-1 bg-slate-50 rounded border border-dashed border-slate-200">
                    <AlertCircle size={16} className="text-slate-300" />
                    <p className="text-slate-400 font-black text-[8px] uppercase tracking-widest">En attente lancement</p>
                  </div>
                )}

                {categorizingLogId && (
                  <div className="flex-1 flex flex-col gap-4 p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                    <div className="flex justify-between items-end border-b border-blue-100 pb-2">
                      <div className="space-y-0.5">
                        <h3 className="text-[11px] sm:text-lg font-black text-blue-900 uppercase italic leading-none">
                          {selectedStopType ? "Détails" : "Qualifier l'Arrêt"}
                        </h3>
                        <p className="text-[9px] font-bold text-blue-500/80 uppercase tracking-widest leading-none">
                          {selectedStopType ? "Choisir programme cible" : "Veuillez indiquer la cause"}
                        </p>
                      </div>
                    </div>

                    {!selectedStopType ? (
                      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5 overflow-y-auto max-h-[160px] p-0.5">
                        {downtimeTypes.map((type) => (
                          <button
                            key={type.id}
                            onClick={() => handleCategorizeStop(type.id)}
                            className="aspect-square border rounded flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 shadow-sm font-black text-center bg-white border-blue-100 hover:bg-blue-600 hover:text-white group"
                          >
                            <span className="text-lg sm:text-xl leading-none">{type.icon || '⚠️'}</span>
                            <span className="text-[7px] uppercase leading-tight tracking-tighter px-0.5 truncate w-full">{type.name}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {availableProgrammes.filter(p => (p.lineId === selectedLineId || !p.lineId) && p.status === 'ACTIVE').map(p => (
                            <button 
                              key={p.id}
                              onClick={() => {
                                setSelectedProgrammeForChange(p.id);
                                handleCategorizeStop(selectedStopType);
                              }}
                              className="p-3 bg-white border border-blue-100 rounded font-black text-[10px] text-blue-900 hover:bg-blue-600 hover:text-white transition-all shadow-sm flex items-center justify-between"
                            >
                              <span>{p.name}</span>
                              <Plus size={14} className="text-blue-300" />
                            </button>
                          ))}
                        </div>
                        <button 
                          onClick={() => setSelectedStopType(null)}
                          className="self-center px-4 py-1.5 bg-white border border-blue-200 rounded-full text-[9px] font-black text-blue-400 uppercase tracking-widest hover:bg-blue-50"
                        >
                          ← Retour
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {activeDowntime ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center p-1.5 space-y-2">
                    <div className="flex flex-col items-center gap-1.5">
                         <div className="w-10 h-10 bg-orange-50 rounded-full flex items-center justify-center text-orange-500 animate-pulse border border-orange-100">
                           <Timer size={18} />
                         </div>
                         <div className="flex flex-col items-center gap-0">
                            <p className="text-[7px] uppercase font-black text-orange-300 tracking-widest leading-none">Temps Arrêt</p>
                            <p className="text-xl sm:text-3xl font-mono font-black text-orange-600 tabular-nums leading-none tracking-tighter">
                             {formatDuration(timer)}
                            </p>
                         </div>
                    </div>

                    <div className="w-full max-w-sm">
                      <button 
                        onClick={handleStopDowntime}
                        className="w-full bg-orange-600 hover:bg-orange-700 text-white py-1.5 rounded font-black text-[10px] sm:text-xs shadow active:scale-95 transition-all uppercase tracking-widest flex items-center justify-center gap-1.5"
                      >
                        <Square size={12} fill="currentColor" /> Fin d'Arrêt
                      </button>
                    </div>
                  </div>
                ) : !categorizingLogId && (
                  <div className="flex-1 flex flex-col justify-center items-center py-1 sm:py-2">
                    {activeLine?.status === 'RUNNING' ? (
                      <div className="flex flex-col items-center gap-2 w-full max-w-lg">
                        <button 
                          onClick={handleStartDowntime}
                          className="w-full h-16 sm:h-20 bg-white border border-orange-500 text-orange-600 rounded-lg font-black text-sm sm:text-base shadow-sm active:scale-[0.98] transition-all uppercase tracking-widest flex flex-col items-center justify-center gap-1 hover:bg-orange-50/20"
                        >
                          <AlertCircle size={24} />
                          DÉCLARER ARRÊT
                        </button>
                        
                        <button 
                          onClick={() => setShowManualStopModal(true)}
                          className="px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-full text-[8px] font-black text-slate-500 uppercase tracking-widest transition-all flex items-center gap-1 shadow-sm"
                        >
                          <Plus size={10} /> Ajout manuel
                        </button>
                      </div>
                    ) : (
                      <div className="text-center py-4 opacity-30">
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-[0.2em] italic">Attente production...</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* SECONDARY AREA: PRODUCTION & PROGRAMME */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* PROGRAMME CARD */}
              <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-2 sm:p-3 flex flex-col gap-2 border-l-4 border-blue-500">
                <div className="flex items-center gap-2 border-b border-slate-50 pb-1">
                  <Package size={14} className="text-blue-500" />
                  <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Programme Actuel</h2>
                </div>
                {!activeProgramme ? (
                  <div className="space-y-2">
                    <p className="text-slate-300 text-[8px] font-black uppercase tracking-widest text-center py-3 bg-slate-50 rounded-lg border border-dashed border-slate-100">Aucun programme</p>
                    <div className="grid gap-1">
                      {availableProgrammes.filter(p => (p.lineId === selectedLineId || !p.lineId) && p.status === 'ACTIVE').map(p => (
                        <button
                          key={p.id}
                          disabled={activeLine?.status === 'RUNNING'}
                          onClick={() => handleSelectProgramme(p.id)}
                          className={cn(
                            "w-full p-2 border rounded-lg text-left transition-all group flex items-center justify-between",
                            activeLine?.status === 'RUNNING' 
                              ? "bg-slate-50 border-slate-100 opacity-50 cursor-not-allowed" 
                              : "bg-white hover:bg-blue-50 border-slate-100 hover:border-blue-200"
                          )}
                        >
                          <span className="text-[10px] font-black text-slate-800 uppercase group-hover:text-blue-700 truncate mr-1">{p.name}</span>
                          <Play size={12} className="text-blue-200 group-hover:text-blue-500" fill="currentColor" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center bg-blue-50/50 p-2 rounded border border-blue-100">
                      <div className="space-y-0.5">
                        <p className="text-[7px] font-black text-blue-400 uppercase tracking-widest leading-none">Produit Actuel</p>
                        <h1 className="text-[10px] font-black text-blue-900 uppercase tracking-tight italic leading-none truncate max-w-[120px]">{activeProgramme.name}</h1>
                      </div>
                      <div className="text-right">
                        <p className="text-[7px] font-black text-blue-400 uppercase tracking-widest leading-none mb-0.5">Palettes</p>
                        <p className="text-sm font-black text-blue-600 font-mono italic leading-none">{activeProgramme.producedPallets || 0}</p>
                      </div>
                    </div>
                    
                    {activeLine?.status !== 'RUNNING' && (
                      <button 
                        onClick={() => handleSelectProgramme('')} 
                        className="w-full mt-1 py-1 text-slate-300 hover:text-blue-500 font-black uppercase text-[7px] tracking-widest transition-all"
                      >
                        Erreur ? Changer le programme
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* SAISIE CARD */}
              {activeProgramme && (
                <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-2 sm:p-3 flex flex-col gap-2 border-l-4 border-purple-500">
                  <div className="flex items-center gap-2 border-b border-slate-50 pb-1">
                    <Monitor size={14} className="text-purple-500" />
                    <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Saisie Production</h2>
                  </div>

                  <div className="flex-1 flex flex-col justify-center gap-1 py-1">
                    {activeLine?.status === 'RUNNING' ? (
                      <button 
                        onClick={handleStopProduction}
                        className="w-full py-2 bg-slate-800 hover:bg-black text-white rounded-lg font-black text-[10px] uppercase tracking-widest shadow active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                      >
                        <Square size={12} fill="currentColor" /> Arrêt Prod
                      </button>
                    ) : activeLine?.status === 'IDLE' ? (
                      <div className="flex flex-col gap-2 px-1">
                        {isPostProduction && (
                          <div className="flex flex-col items-center gap-0.5 animate-in fade-in slide-in-from-top-1 duration-300">
                            <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest leading-none">Déclarer Palettes</p>
                            <div className="flex items-center gap-1.5 w-full max-w-[110px]">
                              <button 
                                onClick={() => setPalletInput((parseInt(palletInput) - 1).toString())}
                                className="w-6 h-6 bg-slate-50 hover:bg-slate-100 rounded flex items-center justify-center text-slate-400 transition-all border"
                              >
                                <Minus size={10} />
                              </button>
                              <input 
                                type="number"
                                className="flex-1 bg-white border-b border-slate-100 p-0 text-[10px] font-black text-slate-900 text-center font-mono outline-none focus:border-purple-500 transition-all leading-none"
                                value={palletInput}
                                onChange={e => setPalletInput(e.target.value)}
                              />
                              <button 
                                onClick={() => setPalletInput((parseInt(palletInput) + 1).toString())}
                                className="w-6 h-6 bg-slate-50 hover:bg-slate-100 rounded flex items-center justify-center text-purple-600 transition-all border"
                              >
                                <Plus size={10} />
                              </button>
                            </div>
                          </div>
                        )}

                        <button 
                          onClick={handleStartProduction}
                          disabled={!activeProgramme}
                          className={cn(
                            "w-full py-2.5 rounded-lg font-black text-[11px] shadow active:scale-[0.98] transition-all flex items-center justify-center gap-2 uppercase tracking-widest",
                            !activeProgramme 
                              ? "bg-slate-100 text-slate-300 cursor-not-allowed" 
                              : "bg-green-600 hover:bg-green-700 text-white"
                          )}
                        >
                          <Play size={14} fill="currentColor" /> Démarrer Production
                        </button>
                        
                        {isPostProduction && (
                          <button 
                            onClick={() => handleAddPallets()}
                            className="text-purple-600 font-black text-[8px] uppercase tracking-widest text-center hover:opacity-70 transition-opacity animate-in fade-in slide-in-from-bottom-1 duration-300"
                          >
                            Terminer & Clôturer Mission
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-center opacity-30 py-2">
                         <p className="text-[7px] font-black text-slate-400 uppercase italic">Ligne à l'arrêt...</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* FOOTER ALERT */}
      {(activeLine?.status === 'STOPPED' || (timer > 15 * 60 * 1000)) && (
        <div className="bg-red-600 text-white flex items-center justify-center py-1 gap-2 shrink-0">
          <AlertCircle size={14} className="animate-pulse" />
          <span className="font-bold tracking-tight uppercase text-[9px]">
            {timer > 15 * 60 * 1000 
              ? `Alerte : Durée Arrêt > 15m (${formatDuration(timer)})` 
              : 'Ligne à l\'arrêt'}
          </span>
        </div>
      )}

      {/* FOOTER STATUS BAR */}
      <footer className={cn(
        "shrink-0 h-10 sm:h-12 flex items-center px-4 transition-all duration-300 border-t",
        activeLine?.status === 'RUNNING' && !activeDowntime ? "bg-green-600 text-white" : 
        activeLine?.status === 'STOPPED' || activeDowntime ? "bg-red-600 text-white" : "bg-slate-900 text-white"
      )}>
        <div className="max-w-4xl mx-auto w-full flex items-center justify-between">
           <div className="flex items-center gap-3">
              <div className="w-6 h-6 bg-white/20 rounded-full flex items-center justify-center">
                 <div className={cn(
                   "w-2 h-2 rounded-full",
                   activeLine?.status === 'RUNNING' ? "bg-green-300 animate-pulse" : "bg-white"
                 )} />
              </div>
              <p className="font-black text-[10px] sm:text-sm uppercase italic tracking-tight">
                {activeLine?.status === 'RUNNING' && !activeDowntime ? "Production Active" : 
                 activeLine?.status === 'STOPPED' || activeDowntime ? "Ligne à l'arrêt" : "En Attente"}
              </p>
           </div>
           
           <div className="flex items-center gap-4 text-[9px] sm:text-[11px]">
              <div className="text-right">
                 <p className="font-black leading-none">{activeLine?.name || '---'}</p>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="text-right">
                 <p className="font-black leading-none uppercase">{user?.name}</p>
              </div>
           </div>
        </div>
      </footer>

      {/* ADMIN NAV ACCESS */}
      <div className="hidden sm:flex absolute bottom-4 right-4">
         <button onClick={handleLogout} className="p-3 bg-white/80 backdrop-blur rounded-full shadow-lg border border-gray-100 text-gray-400 hover:text-red-500 transition-colors">
             <span className="text-[10px] font-black uppercase">LOGOUT</span>
         </button>
      </div>

      {/* MANUAL STOP MODAL */}
      {showManualStopModal && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-2">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden border border-slate-300">
            <div className="bg-slate-900 px-4 py-2 text-white flex justify-between items-center shrink-0">
               <h3 className="text-[10px] font-black uppercase tracking-widest italic">Ajouter Arret Manuel</h3>
               <button onClick={() => setShowManualStopModal(false)} className="hover:text-red-400">
                 <X size={16} />
               </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Début</label>
                  <input 
                    type="datetime-local"
                    className="w-full p-2 bg-slate-50 border rounded text-[10px] font-black text-slate-900 outline-none focus:border-blue-500"
                    value={manualStopForm.startTime}
                    onChange={e => setManualStopForm({...manualStopForm, startTime: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Fin</label>
                  <input 
                    type="datetime-local"
                    className="w-full p-2 bg-slate-50 border rounded text-[10px] font-black text-slate-900 outline-none focus:border-blue-500"
                    value={manualStopForm.endTime}
                    onChange={e => setManualStopForm({...manualStopForm, endTime: e.target.value})}
                  />
                </div>
              </div>

              <div className="bg-blue-50 p-2 rounded border border-blue-100 flex items-center justify-between">
                <p className="text-[8px] font-black text-blue-400 uppercase tracking-widest">Durée Totale</p>
                <p className="text-xs font-black text-blue-900 font-mono italic">{calculateManualDuration()}</p>
              </div>

              <div className="space-y-1">
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Motif</label>
                <select 
                  className="w-full p-2 bg-slate-50 border rounded text-[10px] font-black text-slate-900 outline-none focus:border-blue-500"
                  value={manualStopForm.typeId}
                  onChange={e => setManualStopForm({...manualStopForm, typeId: e.target.value})}
                >
                  <option value="">Sélectionner...</option>
                  {downtimeTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Commentaires</label>
                <textarea 
                  className="w-full p-2 bg-slate-50 border rounded text-[10px] font-bold text-slate-900 outline-none focus:border-blue-500"
                  placeholder="..."
                  rows={2}
                  value={manualStopForm.description}
                  onChange={e => setManualStopForm({...manualStopForm, description: e.target.value})}
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button 
                  onClick={() => setShowManualStopModal(false)}
                  className="flex-1 py-2 font-black uppercase text-[10px] text-slate-400 hover:bg-slate-50 rounded tracking-widest"
                >
                  Annuler
                </button>
                <button 
                  onClick={() => {
                    if (!manualStopForm.typeId || !manualStopForm.startTime || !manualStopForm.endTime) {
                      return alert('Champs obligatoires manquants.');
                    }
                    handleManualStop(manualStopForm);
                  }}
                  className="flex-[2] bg-blue-600 text-white font-black uppercase py-2 rounded text-[10px] shadow active:scale-95 transition-all tracking-widest hover:bg-blue-700"
                >
                  Valider
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
