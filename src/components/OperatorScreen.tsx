import { useState, useEffect } from 'react';
import { localApi } from '../lib/localApi';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useLanguage } from '../contexts/LanguageContext';
import { Line, Shift } from '../types';
import { format, parseISO } from 'date-fns';
import { Play, Square, Settings, Timer, Package, AlertCircle, CheckCircle, Factory, Monitor, Activity, Plus, Minus, ArrowLeft, X, Clock, Check } from 'lucide-react';
import { formatDuration, formatDowntimeDisplay, cn } from '../lib/utils';
import { getCurrentShiftId } from '../lib/shiftUtils';

export default function OperatorScreen() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const { 
    machines, 
    lines, 
    users, 
    downtimeTypes, 
    programmes: availableProgrammes, 
    downtimeLogs,
    shifts 
  } = useData();
  
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(() => sessionStorage.getItem('op_selected_machine') || null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(() => sessionStorage.getItem('op_selected_line') || null);

  useEffect(() => {
    if (selectedMachineId) sessionStorage.setItem('op_selected_machine', selectedMachineId);
    else sessionStorage.removeItem('op_selected_machine');
  }, [selectedMachineId]);

  useEffect(() => {
    if (selectedLineId) sessionStorage.setItem('op_selected_line', selectedLineId);
    else sessionStorage.removeItem('op_selected_line');
  }, [selectedLineId]);
  
  const [selectedStopType, setSelectedStopType] = useState<string | null>(null);
  const [showManualStopModal, setShowManualStopModal] = useState(false);
  const [showStopConfirmation, setShowStopConfirmation] = useState(false);
  const [selectedProgrammeForChange, setSelectedProgrammeForChange] = useState<string | null>(null);
  
  const [palletInput, setPalletInput] = useState('1');
  const [downtimeDescription, setDowntimeDescription] = useState('');
  const [timer, setTimer] = useState(0);
  const [isPostProduction, setIsPostProduction] = useState(false);

  const activeLine = lines.find(l => l.id === selectedLineId) || null;
  const activeProgramme = activeLine ? availableProgrammes.find(p => p.id === activeLine.currentProgrammeId) || null : null;
  const activeDowntime = activeLine?.activeDowntimeId ? downtimeLogs.find(d => d.id === activeLine.activeDowntimeId) || null : null;

  const currentShiftId = getCurrentShiftId(shifts);

  // Derive categorizing log
  const categorizingLog = !activeDowntime && activeLine 
    ? downtimeLogs.find(d => d.lineId === activeLine.id && d.operatorId === user?.id && d.typeId === 'PENDING' && d.endTime) || null 
    : null;
  const categorizingLogId = categorizingLog?.id || null;

  const [flashFeedback, setFlashFeedback] = useState(false);

  // Manual Stop Form State
  const [manualStopForm, setManualStopForm] = useState({
    typeId: '',
    startTime: format(new Date(Date.now() - 15 * 60000), "yyyy-MM-dd'T'HH:mm"),
    endTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    description: ''
  });

  // Session Persistence
  useEffect(() => {
    if (!user || selectedLineId || lines.length === 0) return;
    const activeLines = lines;
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
        setTimer(Math.floor((Date.now() - start) / 1000));
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
      const errorMessage = e instanceof Error ? e.message : String(e);
      alert(`${t('error_saving')}\n\n${errorMessage}`);
    }
  };

  const handleStopProduction = async () => {
    if (!selectedLineId) return;

    try {
      const count = parseInt(palletInput) || 0;
      if (count > 0 && activeProgramme && user) {
        // Log production
        await localApi.addDoc('production_logs', {
          programmeId: activeProgramme.id,
          operatorId: user.id,
          machineId: activeLine?.machineId,
          lineId: activeLine?.id,
          shiftId: currentShiftId,
          count,
          timestamp: new Date().toISOString()
        });

        // Update programme total
        await localApi.updateDoc('programmes', activeProgramme.id, {
          producedPallets: (activeProgramme.producedPallets || 0) + count,
        });
      }

      await localApi.updateDoc('lines', selectedLineId, {
        status: 'IDLE',
      });
      setIsPostProduction(true);
      setPalletInput('0');
      setFlashFeedback(true);
      setTimeout(() => setFlashFeedback(false), 500);
    } catch (e) {
      console.error(e);
      const errorMessage = e instanceof Error ? e.message : String(e);
      alert(`${t('error_saving')}\n\n${errorMessage}`);
    }
  };

  const handlePalletTick = async () => {
    if (!activeProgramme || !user || !selectedLineId) return;
    try {
      // Log production
      await localApi.addDoc('production_logs', {
        programmeId: activeProgramme.id,
        operatorId: user.id,
        machineId: activeLine?.machineId,
        lineId: activeLine?.id,
        shiftId: currentShiftId,
        count: 1,
        timestamp: new Date().toISOString()
      });

      // Update programme total (don't finish)
      await localApi.updateDoc('programmes', activeProgramme.id, {
        producedPallets: (activeProgramme.producedPallets || 0) + 1
      });
      
      // Visual feedback
      setFlashFeedback(true);
      setTimeout(() => setFlashFeedback(false), 500);
    } catch (e) {
      console.error(e);
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
        shiftId: currentShiftId,
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
      const errorMessage = e instanceof Error ? e.message : String(e);
      alert(`${t('error_saving')}\n\n${errorMessage}`);
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
        shiftId: currentShiftId,
        startTime: new Date().toISOString()
      });

      await localApi.updateDoc('lines', selectedLineId, {
        status: 'STOPPED',
        activeDowntimeId: docRef.id
      });
      
      setDowntimeDescription('');
    } catch (error) {
      console.error('Error starting downtime:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`Erreur: Impossible de démarrer l'arrêt.\n\n${errorMessage}`);
    }
  };

  const handleStopDowntime = async () => {
    if (!selectedLineId || !activeDowntime) return;

    const endTime = new Date().toISOString();
    const startTime = new Date(activeDowntime.startTime).getTime();
    const duration = Math.floor((Date.now() - startTime) / 1000);

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
    const isOther = selectedType?.name?.toUpperCase() === 'AUTRE';

    if (isChangeProg && !selectedProgrammeForChange) {
      setSelectedStopType(typeId);
      return;
    }

    if (isOther && !downtimeDescription.trim() && !categorizingLog?.description?.trim()) {
      setSelectedStopType(typeId);
      return;
    }

    try {
      const updateData: any = {
        typeId,
        description: isChangeProg 
          ? `Chang. vers: ${availableProgrammes.find(p => p.id === selectedProgrammeForChange)?.name}` 
          : (downtimeDescription.trim() || categorizingLog?.description || undefined)
      };

      if (user) {
        updateData.operatorId = user.id;
      }

      await localApi.updateDoc('downtime_logs', categorizingLogId, updateData);

      if (isChangeProg && selectedProgrammeForChange && selectedLineId) {
        // Mark old programme as finished
        if (activeLine?.currentProgrammeId && activeLine.currentProgrammeId !== selectedProgrammeForChange) {
          await localApi.updateDoc('programmes', activeLine.currentProgrammeId, {
            status: 'FINISHED'
          });
        }

        // Find if the operator is currently on this line
        await localApi.updateDoc('lines', selectedLineId, {
          currentProgrammeId: selectedProgrammeForChange
        });
        setSelectedProgrammeForChange(null);
      }

      setSelectedStopType(null);
      setDowntimeDescription('');
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
        shiftId: currentShiftId,
        startTime: new Date(data.startTime).toISOString(),
        endTime: new Date(data.endTime).toISOString(),
        duration: Math.floor(durationMs / 1000)
      });
      setShowManualStopModal(false);
      setManualStopForm({
        typeId: '',
        startTime: format(new Date(Date.now() - 15 * 60000), "yyyy-MM-dd'T'HH:mm"),
        endTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        description: ''
      });
    } catch (error) {
      console.error('Error adding manual stop:', error);
      alert('Erreur lors de l\'ajout manuel.');
    }
  };

  const calculateManualDuration = () => {
    const start = new Date(manualStopForm.startTime).getTime();
    const end = new Date(manualStopForm.endTime).getTime();
    const diff = end - start;
    if (diff <= 0) return '0 min';
    return formatDowntimeDisplay(Math.floor(diff / 1000));
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
        <header className="h-16 bg-slate-900 text-white flex items-center justify-between px-6 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white font-black text-[10px]">
              A
            </div>
            <span className="text-[14px] font-black uppercase tracking-widest italic">FACTORY<span className="text-blue-400">CLOUD</span></span>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={handleLogout} className="bg-white/10 hover:bg-red-600 px-4 py-1.5 rounded font-black text-[12px] uppercase tracking-widest transition-colors">{t('logout')}</button>
          </div>
        </header>

        <main className="flex-1 p-4 overflow-y-auto">
          <div className="max-w-full mx-auto space-y-4">
            <h2 className="text-[14px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-200 pb-2">{t('machine_select')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
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
        <header className="h-16 bg-slate-900 text-white flex items-center justify-between px-6 border-b border-white/10 shrink-0">
          <button onClick={() => {
            if (selectedLineId) handleGoBackFromLine();
            else setSelectedMachineId(null);
          }} className="hover:text-blue-400 transition-colors">
            <ArrowLeft size={24} />
          </button>
          <span className="text-[15px] font-black uppercase tracking-widest">{machines.find(m => m.id === selectedMachineId)?.name}</span>
          <div className="flex items-center gap-4">
            <button onClick={handleLogout} className="bg-white/10 hover:bg-red-600 px-4 py-1.5 rounded font-black text-[12px] uppercase tracking-widest transition-colors">{t('logout')}</button>
          </div>
        </header>

        <main className="flex-1 p-4 overflow-y-auto">
          <div className="max-w-full mx-auto space-y-4">
             <h2 className="text-[14px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-200 pb-2">{t('line_select')}</h2>
             <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {lines.filter(l => l.machineId === selectedMachineId).map(l => {
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
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex flex-row justify-between items-center gap-2 shadow-sm shrink-0">
        <div className="flex items-center gap-3 overflow-hidden">
          {!activeLine?.status || activeLine?.status === 'IDLE' ? (
            <button 
              onClick={handleGoBackFromLine}
              className="p-2 hover:bg-gray-100 rounded text-gray-500 transition-colors shrink-0"
            >
              <ArrowLeft size={22} />
            </button>
          ) : (
            <div className="p-2 text-gray-100 cursor-not-allowed shrink-0">
              <ArrowLeft size={22} />
            </div>
          )}
          <div className="shrink-0 leading-none">
            <p className="text-[9px] text-gray-400 uppercase tracking-tight font-semibold">Op</p>
            <p className="text-[13px] font-black text-gray-900 truncate max-w-[120px]">{user?.name}</p>
          </div>
          <div className="h-6 w-px bg-gray-200" />
          <div className="overflow-hidden leading-none">
            <p className="text-[9px] text-gray-400 uppercase tracking-tight font-semibold">Poste</p>
            <p className="text-[13px] font-black text-gray-900 truncate">
              {machines.find(m => m.id === activeLine?.machineId)?.name} 
              <span className="text-blue-600"> | {activeLine?.name}</span>
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <span className={cn(
            "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tight flex items-center gap-2",
            activeLine?.status === 'RUNNING' ? "bg-status-running-bg text-status-running-text" :
            activeLine?.status === 'STOPPED' ? "bg-status-stopped-bg text-status-stopped-text" : 
            "bg-status-idle-bg text-status-idle-text"
          )}>
            <span className={cn(
              "w-2 h-2 rounded-full",
              activeLine?.status === 'RUNNING' ? "bg-green-600 animate-pulse" :
              activeLine?.status === 'STOPPED' ? "bg-red-600" : "bg-gray-400"
            )} />
            {activeLine?.status === 'RUNNING' ? t('production_label_short') : 
             activeLine?.status === 'STOPPED' ? t('stop_label_short') : t('wait_label_short')}
          </span>
          <button onClick={handleLogout} className="p-1.5 bg-red-50 rounded text-red-500 font-black text-[11px] uppercase px-3 border border-red-100">
             {t('out')}
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-1 bg-slate-50/50">
        <div className="max-w-full mx-auto space-y-1">
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
                    {activeDowntime ? t('stop_label_short') : t('manage_stops')}
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
                    <p className="text-slate-400 font-black text-[8px] uppercase tracking-widest">{t('waiting_start')}</p>
                  </div>
                )}

                {categorizingLogId && (
                  <div className="flex-1 flex flex-col gap-4 p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                    <div className="flex justify-between items-end border-b border-blue-100 pb-2">
                      <div className="space-y-0.5">
                        <h3 className="text-[11px] sm:text-lg font-black text-blue-900 uppercase italic leading-none">
                          {selectedStopType ? t('details') : t('qualify_stop')}
                        </h3>
                        <p className="text-[9px] font-bold text-blue-500/80 uppercase tracking-widest leading-none">
                          {selectedStopType ? t('choose_target_prog') : t('indicate_cause')}
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
                        {downtimeTypes.find(t => t.id === selectedStopType)?.name?.toUpperCase() === 'AUTRE' ? (
                          <div className="space-y-3">
                            <p className="text-[10px] font-black text-blue-900 uppercase tracking-widest">{t('describe_reason')}</p>
                            <textarea 
                              className="w-full p-4 bg-white border border-blue-200 rounded-2xl text-sm font-bold text-blue-900 outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="..."
                              value={downtimeDescription}
                              onChange={e => setDowntimeDescription(e.target.value)}
                              rows={3}
                            />
                            <button 
                              onClick={() => handleCategorizeStop(selectedStopType!)}
                              disabled={!downtimeDescription.trim()}
                              className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 active:scale-95 transition-all disabled:opacity-50"
                            >
                              {t('validate')}
                            </button>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {availableProgrammes.filter(p => (p.lineId === selectedLineId || !p.lineId) && p.status === 'ACTIVE').map(p => (
                              <button 
                                key={p.id}
                                onClick={() => {
                                  setSelectedProgrammeForChange(p.id);
                                  handleCategorizeStop(selectedStopType!);
                                }}
                                className="p-3 bg-white border border-blue-100 rounded font-black text-[10px] text-blue-900 hover:bg-blue-600 hover:text-white transition-all shadow-sm flex items-center justify-between"
                              >
                                <span>{p.name}</span>
                                <Plus size={14} className="text-blue-300" />
                              </button>
                            ))}
                          </div>
                        )}
                        <button 
                          onClick={() => {
                            setSelectedStopType(null);
                            setSelectedProgrammeForChange(null);
                          }}
                          className="self-center px-4 py-1.5 bg-white border border-blue-200 rounded-full text-[9px] font-black text-blue-400 uppercase tracking-widest hover:bg-blue-50"
                        >
                          ← {t('back')}
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
                            <p className="text-[7px] uppercase font-black text-orange-300 tracking-widest leading-none">{t('stopped')}</p>
                            <p className="text-xl sm:text-3xl font-mono font-black text-orange-600 tabular-nums leading-none tracking-tighter">
                              {formatDowntimeDisplay(timer)}
                            </p>
                         </div>
                    </div>

                    <div className="w-full max-w-sm">
                      <button 
                        onClick={handleStopDowntime}
                        className="w-full bg-orange-600 hover:bg-orange-700 text-white py-1.5 rounded font-black text-[10px] sm:text-xs shadow active:scale-95 transition-all uppercase tracking-widest flex items-center justify-center gap-1.5"
                      >
                        <Square size={12} fill="currentColor" /> {t('stop')}
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
                          {t('declare_downtime')}
                        </button>
                        
                        <button 
                          onClick={() => setShowManualStopModal(true)}
                          className="px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-full text-[8px] font-black text-slate-500 uppercase tracking-widest transition-all flex items-center gap-1 shadow-sm"
                        >
                          <Plus size={10} /> {t('manual_add')}
                        </button>
                      </div>
                    ) : (
                      <div className="text-center py-4 opacity-30">
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-[0.2em] italic">{t('waiting_start')}...</p>
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
                  <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('programmes')}</h2>
                </div>
                {!activeProgramme ? (
                  <div className="space-y-2">
                    <p className="text-slate-300 text-[8px] font-black uppercase tracking-widest text-center py-3 bg-slate-50 rounded-lg border border-dashed border-slate-100">{t('no_programme')}</p>
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
                        {t('error_change_prog')}
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

                  <div className="flex-1 flex flex-col justify-center gap-2 py-1">
                    {/* MANUAL ENTRY & STOP PRODUCTION MERGED */}
                    {(activeLine?.status === 'RUNNING' || activeLine?.status === 'STOPPED') && (
                      <div className="p-3 bg-purple-50/50 rounded-xl border border-purple-100 space-y-3 animate-in zoom-in-95 duration-300">
                        <div className="space-y-1">
                          <p className="text-[8px] font-black text-purple-400 uppercase tracking-widest text-center">{t('register_production')}</p>
                          <input 
                            type="number"
                            className="w-full bg-white border-2 border-purple-100 rounded-lg px-2 py-2 text-xl font-black text-purple-900 text-center font-mono outline-none focus:border-purple-500 transition-all shadow-inner"
                            value={palletInput}
                            onChange={e => setPalletInput(e.target.value)}
                            placeholder="0"
                          />
                        </div>
                        
                        <button 
                          onClick={() => setShowStopConfirmation(true)}
                          className="w-full py-3 bg-slate-800 hover:bg-black text-white rounded-lg font-black text-xs uppercase tracking-widest shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-3"
                        >
                          <Square size={16} fill="currentColor" /> {t('stop_prod')}
                        </button>
                      </div>
                    )}

                    <div className="space-y-2">
                      {activeLine?.status === 'IDLE' ? (
                        <div className="flex flex-col gap-2 px-1">
                          {isPostProduction && (
                            <div className="flex flex-col items-center gap-0.5 animate-in fade-in slide-in-from-top-1 duration-300">
                              <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest leading-none">{t('register_production')}</p>
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
                            <Play size={14} fill="currentColor" /> {t('start_prod')}
                          </button>
                          
                          {isPostProduction && (
                            <button 
                              onClick={() => handleAddPallets()}
                              className="text-purple-600 font-black text-[8px] uppercase tracking-widest text-center hover:opacity-70 transition-opacity animate-in fade-in slide-in-from-bottom-1 duration-300"
                            >
                              {t('finish_mission')}
                            </button>
                          )}
                        </div>
                      ) : activeLine?.status === 'STOPPED' && (
                        <div className="flex flex-col items-center gap-1 opacity-80 mt-1">
                           <p className="text-[7px] font-black text-orange-400 uppercase tracking-widest italic">{t('stop_prod_caution')}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* FOOTER ALERT */}
      {(activeLine?.status === 'STOPPED' || (timer > 15 * 60)) && (
        <div className="bg-red-600 text-white flex items-center justify-center py-1 gap-2 shrink-0">
          <AlertCircle size={14} className="animate-pulse" />
          <span className="font-bold tracking-tight uppercase text-[9px]">
            {timer > 15 * 60 
              ? `Alerte : Durée Arrêt > 15m (${formatDuration(timer)})` 
              : t('stopped')}
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
                {activeLine?.status === 'RUNNING' && !activeDowntime ? t('active_prod_label') : 
                 activeLine?.status === 'STOPPED' || activeDowntime ? t('stopped') : t('waiting_label')}
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
             <span className="text-[10px] font-black uppercase">{t('logout')}</span>
         </button>
      </div>

      {/* MANUAL STOP MODAL */}
      {showManualStopModal && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-2">
          <div className="bg-white rounded-xl w-full max-w-md shadow-2xl overflow-hidden border border-slate-300">
            <div className="bg-slate-900 px-4 py-2 text-white flex justify-between items-center shrink-0">
               <h3 className="text-[10px] font-black uppercase tracking-widest italic">{t('add_manual_stop')}</h3>
               <button onClick={() => setShowManualStopModal(false)} className="hover:text-red-400">
                 <X size={16} />
               </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{t('start_time')}</label>
                  <input 
                    type="datetime-local"
                    className="w-full p-2 bg-slate-50 border rounded text-[10px] font-black text-slate-900 outline-none focus:border-blue-500"
                    value={manualStopForm.startTime}
                    onChange={e => setManualStopForm({...manualStopForm, startTime: e.target.value})}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{t('end_time')}</label>
                  <input 
                    type="datetime-local"
                    className="w-full p-2 bg-slate-50 border rounded text-[10px] font-black text-slate-900 outline-none focus:border-blue-500"
                    value={manualStopForm.endTime}
                    onChange={e => setManualStopForm({...manualStopForm, endTime: e.target.value})}
                  />
                </div>
              </div>

              <div className="bg-blue-50 p-2 rounded border border-blue-100 flex items-center justify-between">
                <p className="text-[8px] font-black text-blue-400 uppercase tracking-widest">{t('total_duration')}</p>
                <p className="text-xs font-black text-blue-900 font-mono italic">{calculateManualDuration()}</p>
              </div>

              <div className="space-y-1">
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{t('reason')}</label>
                <select 
                  className="w-full p-2 bg-slate-50 border rounded text-[10px] font-black text-slate-900 outline-none focus:border-blue-500"
                  value={manualStopForm.typeId}
                  onChange={e => setManualStopForm({...manualStopForm, typeId: e.target.value})}
                >
                  <option value="">{t('select_reason')}...</option>
                  {downtimeTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{t('comments')}</label>
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
                  {t('cancel')}
                </button>
                <button 
                  onClick={() => {
                    if (!manualStopForm.typeId || !manualStopForm.startTime || !manualStopForm.endTime) {
                      return alert(t('missing_fields'));
                    }
                    handleManualStop(manualStopForm);
                  }}
                  className="flex-[2] bg-blue-600 text-white font-black uppercase py-2 rounded text-[10px] shadow active:scale-95 transition-all tracking-widest hover:bg-blue-700"
                >
                  {t('validate')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* STOP PRODUCTION CONFIRMATION MODAL */}
      {showStopConfirmation && (
        <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-8 text-center space-y-6">
              <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
                <AlertCircle size={40} />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tighter italic">Arrêter la production ?</h3>
                <p className="text-gray-500 font-bold text-sm leading-relaxed px-4">
                  Êtes-vous sûr de vouloir arrêter la ligne ? Cette action sera enregistrée dans l'historique.
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-4">
                <button 
                  onClick={() => {
                    handleStopProduction();
                    setShowStopConfirmation(false);
                  }}
                  className="w-full bg-red-600 hover:bg-red-700 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-red-200 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  <Square size={16} fill="currentColor" /> Confirmer l'arrêt
                </button>
                <button 
                  onClick={() => setShowStopConfirmation(false)}
                  className="w-full bg-gray-100 hover:bg-gray-200 text-gray-600 py-4 rounded-2xl font-black text-xs uppercase tracking-widest active:scale-[0.98] transition-all"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
