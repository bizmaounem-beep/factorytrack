import { useState, useEffect, useRef, useMemo } from 'react';
import { localApi } from '../lib/localApi';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useLanguage } from '../contexts/LanguageContext';
import { Line, Shift } from '../types';
import { format, parseISO, isToday } from 'date-fns';
import { 
  Play, Square, Settings, Timer, Package, AlertCircle, 
  CheckCircle, Factory, Monitor, Activity, Plus, Minus, 
  ArrowLeft, X, Clock, Check, Edit, Trash2, History,
  ChevronRight, ChevronLeft, Info
} from 'lucide-react';
import { formatDuration, formatDowntimeDisplay, cn } from '../lib/utils';
import { getCurrentShiftId } from '../lib/shiftUtils';
import { motion, AnimatePresence } from 'motion/react';

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
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const { scrollLeft, clientWidth } = scrollRef.current;
      const scrollTo = direction === 'left' ? scrollLeft - clientWidth / 2 : scrollLeft + clientWidth / 2;
      scrollRef.current.scrollTo({ left: scrollTo, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (selectedMachineId) sessionStorage.setItem('op_selected_machine', selectedMachineId);
    else sessionStorage.removeItem('op_selected_machine');
  }, [selectedMachineId]);

  useEffect(() => {
    if (selectedLineId) sessionStorage.setItem('op_selected_line', selectedLineId);
    else sessionStorage.removeItem('op_selected_line');
  }, [selectedLineId]);
  
  const [timer, setTimer] = useState(0);
  const [isPostProduction, setIsPostProduction] = useState(false);
  const [isInitialSelection, setIsInitialSelection] = useState(false);
  const [selectedStopType, setSelectedStopType] = useState<string | null>(null);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [showManualStopModal, setShowManualStopModal] = useState(false);
  const [showStopConfirmation, setShowStopConfirmation] = useState(false);
  const [selectedProgrammeForChange, setSelectedProgrammeForChange] = useState<string | null>(null);
  const [palletInput, setPalletInput] = useState('1');
  const [downtimeDescription, setDowntimeDescription] = useState('');

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
      setIsInitialSelection(true);
    } catch (error) {
      console.error('Error starting downtime flow:', error);
    }
  };

  const handleConfirmStartDowntime = async (typeId: string) => {
    if (!selectedLineId || !user || !activeLine) return;

    const selectedType = downtimeTypes.find(t => t.id === typeId);
    const nameUpper = selectedType?.name?.toUpperCase() || '';
    const isChangeProg = nameUpper === 'CHANGEMENT FORMAT' || nameUpper === 'CHANGEMENT DE FORMAT' || nameUpper.includes('FORMAT');
    const isOther = nameUpper === 'AUTRE';

    // If change format or other and not yet filled, just step through
    if ((isChangeProg && !selectedProgrammeForChange) || (isOther && !downtimeDescription.trim())) {
      setSelectedStopType(typeId);
      return;
    }

    try {
      const logData: any = {
        machineId: activeLine.machineId,
        lineId: activeLine.id,
        typeId,
        description: isChangeProg 
          ? `Chang. vers: ${availableProgrammes.find(p => p.id === selectedProgrammeForChange)?.name}` 
          : (downtimeDescription.trim() || undefined),
        operatorId: user.id,
        shiftId: currentShiftId,
        startTime: new Date().toISOString()
      };

      const docRef = await localApi.addDoc('downtime_logs', logData);

      await localApi.updateDoc('lines', selectedLineId, {
        status: 'STOPPED',
        activeDowntimeId: docRef.id
      });
      
      setIsInitialSelection(false);
      setSelectedStopType(null);
      setSelectedProgrammeForChange(null);
      setDowntimeDescription('');
    } catch (error) {
      console.error('Error starting qualified downtime:', error);
      alert('Erreur: Impossible de démarrer l\'arrêt.');
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
    // Be more specific: only trigger if it's the specific format change type
    const nameUpper = selectedType?.name?.toUpperCase() || '';
    const isChangeProg = nameUpper === 'CHANGEMENT FORMAT' || nameUpper === 'CHANGEMENT DE FORMAT' || nameUpper.includes('FORMAT');
    const isOther = nameUpper === 'AUTRE';

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

      const payload = {
        machineId: activeLine.machineId,
        lineId: activeLine.id,
        typeId: data.typeId,
        description: data.description,
        operatorId: user.id,
        shiftId: currentShiftId,
        startTime: new Date(data.startTime).toISOString(),
        endTime: new Date(data.endTime).toISOString(),
        duration: Math.floor(durationMs / 1000)
      };

      if (editingLogId) {
        await localApi.updateDoc('downtime_logs', editingLogId, payload);
      } else {
        await localApi.addDoc('downtime_logs', payload);
      }

      setShowManualStopModal(false);
      setEditingLogId(null);
      setManualStopForm({
        typeId: '',
        startTime: format(new Date(Date.now() - 15 * 60000), "yyyy-MM-dd'T'HH:mm"),
        endTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        description: ''
      });
    } catch (error) {
      console.error('Error adding/updating manual stop:', error);
      alert('Erreur lors de l\'enregistrement.');
    }
  };

  const handleDeleteStop = async (id: string) => {
    if (!window.confirm('Supprimer cet arrêt ?')) return;
    try {
      await localApi.deleteDoc('downtime_logs', id);
    } catch (error) {
      console.error('Error deleting stop:', error);
    }
  };

  const handleEditStopRequest = (log: any) => {
    setEditingLogId(log.id);
    setManualStopForm({
      typeId: log.typeId,
      startTime: format(parseISO(log.startTime), "yyyy-MM-dd'T'HH:mm"),
      endTime: log.endTime ? format(parseISO(log.endTime), "yyyy-MM-dd'T'HH:mm") : format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      description: log.description || ''
    });
    setShowManualStopModal(true);
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
    <div className="min-h-screen bg-[#0a0c10] text-slate-100 font-sans selection:bg-blue-500/30 flex flex-col overflow-hidden">
      <header className="sticky top-0 z-50 bg-[#0a0c10]/80 backdrop-blur-xl border-b border-white/5 px-4 py-3 shrink-0">
        <div className="max-w-xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Factory size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tighter italic leading-none">
                PILOT<span className="text-blue-500">CLOUD</span>
              </h1>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mt-1">Operator Hub</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end leading-none">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{user?.name}</span>
              <span className="text-[8px] font-bold text-blue-500/80 uppercase tracking-widest">{activeLine?.name}</span>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-white transition-colors"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-6 pb-24">
        {!selectedLineId ? (
          <div className="grid grid-cols-1 gap-4 py-8 max-w-xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest text-center">{t('select_line')}</h2>
            {lines.filter(l => l.isActive !== false).map((line) => (
              <button
                key={line.id}
                onClick={() => handleSelectLine(line)}
                className="group relative overflow-hidden p-6 bg-slate-900/50 border border-white/5 rounded-3xl text-left hover:border-blue-500/50 transition-all hover:bg-slate-900 shadow-2xl"
              >
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/5 blur-3xl group-hover:bg-blue-600/10 transition-colors" />
                <div className="flex justify-between items-center relative z-10">
                  <div>
                    <h3 className="text-2xl font-black text-white italic tracking-tighter mb-1">{line.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "w-2 h-2 rounded-full animate-pulse",
                        line.status === 'RUNNING' ? "bg-emerald-500" : "bg-rose-500"
                      )} />
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{line.status}</span>
                    </div>
                  </div>
                  <ChevronRight size={24} className="text-slate-600 group-hover:text-blue-500 group-hover:translate-x-2 transition-all" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-6 max-w-xl mx-auto animate-in fade-in duration-500">
            <button 
              onClick={handleGoBackFromLine}
              className="flex items-center gap-2 text-slate-500 hover:text-white transition-colors group"
            >
              <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
              <span className="text-[10px] font-black uppercase tracking-widest">{t('back_to_selection')}</span>
            </button>

            {/* MAIN STATUS CARD */}
            <div className={cn(
              "relative overflow-hidden p-8 rounded-[2.5rem] border transition-all duration-700 shadow-2xl",
              activeLine?.status === 'RUNNING' 
                ? "bg-emerald-500/10 border-emerald-500/20 shadow-emerald-500/5" 
                : "bg-rose-500/10 border-rose-500/20 shadow-rose-500/5"
            )}>
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
              
              <div className="flex flex-col items-center text-center relative z-10">
                <div className={cn(
                  "w-16 h-16 rounded-3xl flex items-center justify-center mb-6 shadow-2xl transform transition-transform duration-500 hover:scale-110",
                  activeLine?.status === 'RUNNING' ? "bg-emerald-500 shadow-emerald-500/40" : "bg-rose-500 shadow-rose-500/40"
                )}>
                  {activeLine?.status === 'RUNNING' ? <Activity size={32} /> : <AlertCircle size={32} />}
                </div>

                <h2 className="text-4xl font-black text-white italic tracking-tighter mb-2 leading-none uppercase">
                  {activeLine?.name}
                </h2>
                <div className="flex items-center gap-2 px-4 py-1.5 bg-black/20 rounded-full border border-white/5 backdrop-blur-md mb-8">
                  <span className={cn(
                    "text-[10px] font-black uppercase tracking-[0.2em]",
                    activeLine?.status === 'RUNNING' ? "text-emerald-400" : "text-rose-400"
                  )}>
                    {activeLine?.status === 'RUNNING' ? 'Machine Operationnelle' : 'Ligne à l\'Arrêt'}
                  </span>
                </div>

                {activeDowntime ? (
                  <div className="space-y-4 w-full">
                    <div className="bg-black/40 rounded-[2rem] p-6 border border-white/5 backdrop-blur-3xl shadow-inner">
                      <div className="flex items-center justify-center gap-3 text-rose-500 mb-2">
                        <Timer size={20} className="animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-widest">Temps Écoulé</span>
                      </div>
                      <p className="text-5xl font-black tracking-tighter tabular-nums text-white">
                        {formatDowntimeDisplay(timer)}
                      </p>
                      {activeDowntime.typeId && activeDowntime.typeId !== 'PENDING' && (
                        <p className="mt-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest bg-white/5 py-1 px-3 rounded-full inline-block">
                           {downtimeTypes.find(t => t.id === activeDowntime.typeId)?.name}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={handleStopDowntime}
                      className="w-full py-5 bg-white text-black rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3 hover:bg-emerald-50"
                    >
                      <Play size={20} /> Relancer la Ligne
                    </button>
                  </div>
                ) : (
                  <div className="w-full flex flex-col gap-3">
                    <button
                      onClick={handleStartDowntime}
                      disabled={isInitialSelection}
                      className="w-full py-5 bg-rose-600 text-white rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-xl shadow-rose-600/20 active:scale-95 transition-all flex items-center justify-center gap-3 hover:bg-rose-500 disabled:opacity-50"
                    >
                      <Square size={20} /> Arrêt Machine
                    </button>
                    {!activeLine?.currentProgrammeId && (
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center mt-2">
                        {t('no_programme')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* DOWNTIME CHOICES SLIDER */}
            <AnimatePresence mode="wait">
              {(isInitialSelection || categorizingLogId) && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className="bg-slate-900 rounded-[2.5rem] p-6 border border-white/5 shadow-3xl"
                >
                  <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-2">
                       <Info size={14} className="text-blue-500" />
                       <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                         {isInitialSelection ? 'Démarrer l\'arrêt' : 'Qualifier l\'arrêt'}
                       </h3>
                    </div>
                    {isInitialSelection && (
                      <button 
                        onClick={() => setIsInitialSelection(false)}
                        className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center text-slate-500 hover:text-white transition-colors"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>

                  {!selectedStopType ? (
                    <div className="relative group">
                      <div 
                        ref={scrollRef}
                        className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory px-2"
                      >
                        {downtimeTypes.map((type) => (
                          <button
                            key={type.id}
                            onClick={() => isInitialSelection ? handleConfirmStartDowntime(type.id) : handleCategorizeStop(type.id)}
                            className="flex-shrink-0 w-[45%] aspect-[4/5] bg-slate-800/50 rounded-3xl border border-white/5 flex flex-col items-center justify-center gap-4 transition-all hover:bg-blue-600 hover:border-blue-500 group snap-center"
                          >
                            <div className="w-14 h-14 rounded-2xl bg-slate-900/50 flex items-center justify-center text-3xl group-hover:bg-white/20 transition-all shadow-inner">
                              {type.icon || '⚠️'}
                            </div>
                            <span className="text-[10px] font-black uppercase tracking-widest text-center px-4 leading-tight">
                              {type.name}
                            </span>
                          </button>
                        ))}
                      </div>
                      
                      <div className="absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-slate-900 to-transparent pointer-events-none" />
                      <div className="absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-slate-900 to-transparent pointer-events-none" />
                      
                      <button 
                        onClick={() => scroll('left')}
                        className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 w-10 h-10 rounded-full bg-slate-900 border border-white/5 flex items-center justify-center shadow-xl opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ChevronLeft size={20} />
                      </button>
                      <button 
                        onClick={() => scroll('right')}
                        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 w-10 h-10 rounded-full bg-slate-900 border border-white/5 flex items-center justify-center shadow-xl opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <ChevronRight size={20} />
                      </button>
                    </div>
                  ) : (
                    <motion.div 
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="space-y-4"
                    >
                      <div className="flex items-center gap-3 bg-white/5 p-4 rounded-2xl border border-white/5">
                        <div className="text-2xl">{downtimeTypes.find(t => t.id === selectedStopType)?.icon}</div>
                        <div>
                           <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Type sélectionné</p>
                           <p className="text-xs font-black text-white uppercase">{downtimeTypes.find(t => t.id === selectedStopType)?.name}</p>
                        </div>
                      </div>

                      {downtimeTypes.find(t => t.id === selectedStopType)?.name?.toUpperCase().includes('AUTRE') ? (
                        <div className="space-y-4">
                          <textarea 
                            className="w-full p-6 bg-slate-800/50 border border-white/5 rounded-3xl text-sm font-bold text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-slate-600"
                            placeholder="Décrivez la raison..."
                            value={downtimeDescription}
                            onChange={e => setDowntimeDescription(e.target.value)}
                            rows={3}
                          />
                          <button 
                            onClick={() => isInitialSelection ? handleConfirmStartDowntime(selectedStopType!) : handleCategorizeStop(selectedStopType!)}
                            disabled={!downtimeDescription.trim()}
                            className="w-full py-5 bg-blue-600 text-white rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-xl shadow-blue-600/20 active:scale-95 transition-all disabled:opacity-50"
                          >
                            Confirmer
                          </button>
                        </div>
                      ) : (
                        <div className="grid gap-2">
                           <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest px-2">Choisir le programme cible</p>
                           {availableProgrammes.filter(p => (p.lineId === selectedLineId || !p.lineId) && p.status === 'ACTIVE').map(p => (
                            <button 
                              key={p.id}
                              onClick={() => {
                                setSelectedProgrammeForChange(p.id);
                                setTimeout(() => {
                                  if (isInitialSelection) handleConfirmStartDowntime(selectedStopType!);
                                  else handleCategorizeStop(selectedStopType!);
                                }, 0);
                              }}
                              className="p-4 bg-slate-800/50 hover:bg-blue-600 border border-white/5 rounded-2xl font-black text-[10px] text-white transition-all flex items-center justify-between group"
                            >
                              <span className="uppercase italic tracking-tight">{p.name}</span>
                              <Plus size={14} className="text-slate-500 group-hover:text-white" />
                            </button>
                          ))}
                        </div>
                      )}
                      
                      <button 
                         onClick={() => {
                           setSelectedStopType(null);
                           setSelectedProgrammeForChange(null);
                         }}
                         className="w-full py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest hover:text-white transition-colors"
                      >
                         ← Retour aux catégories
                      </button>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* PRODUCTION CONTROLS */}
            <div className="grid grid-cols-1 gap-4">
              <div className="bg-slate-900 rounded-[2.5rem] p-6 border border-white/5 shadow-2xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-32 h-32 bg-purple-600/5 blur-3xl" />
                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-2">
                    <Package size={16} className="text-purple-500" />
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Production</h3>
                  </div>
                  {activeLine?.status === 'RUNNING' && (
                    <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-[8px] font-black text-emerald-400 uppercase tracking-widest">En Cours</span>
                    </div>
                  )}
                </div>

                {!activeProgramme ? (
                  <div className="text-center py-8 bg-black/20 rounded-3xl border border-dashed border-white/5">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{t('no_programme')}</p>
                    <div className="grid grid-cols-1 gap-2 mt-4 px-4">
                      {availableProgrammes.filter(p => (p.lineId === selectedLineId || !p.lineId) && p.status === 'ACTIVE').map(p => (
                        <button
                          key={p.id}
                          onClick={() => handleSelectProgramme(p.id)}
                          className="w-full p-4 bg-slate-800 rounded-2xl border border-white/5 text-left flex justify-between items-center group/btn hover:bg-blue-600 transition-all font-black"
                        >
                          <span className="text-[10px] uppercase italic tracking-tight">{p.name}</span>
                          <Play size={14} className="text-slate-600 group-hover/btn:text-white" fill="currentColor" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex justify-between items-end">
                      <div className="space-y-1">
                        <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Programme Actuel</p>
                        <h4 className="text-xl font-black text-white italic tracking-tighter truncate max-w-[200px]">{activeProgramme.name}</h4>
                      </div>
                      <div className="text-right">
                        <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Palettes</p>
                        <p className="text-3xl font-black text-white font-mono">{activeProgramme.producedPallets || 0}</p>
                      </div>
                    </div>

                    {(activeLine?.status === 'RUNNING' || activeLine?.status === 'STOPPED') && (
                      <div className="space-y-4 pt-4 border-t border-white/5">
                        <div className="flex items-center gap-4">
                          <input 
                            type="number"
                            className="flex-1 bg-black/40 border border-white/5 rounded-2xl px-6 py-4 text-2xl font-black text-white text-center font-mono outline-none focus:border-blue-500 transition-all shadow-inner"
                            value={palletInput}
                            onChange={e => setPalletInput(e.target.value)}
                            placeholder="0"
                          />
                          <button 
                            onClick={handleAddPallets}
                            className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20 active:scale-95 transition-all"
                          >
                            <Plus size={24} />
                          </button>
                        </div>
                        <button 
                          onClick={() => setShowStopConfirmation(true)}
                          className="w-full py-5 bg-slate-800 text-slate-400 rounded-[2rem] font-black text-xs uppercase tracking-widest hover:bg-rose-600 hover:text-white transition-all group"
                        >
                          <Square size={16} fill="currentColor" className="inline-block mr-2" /> {t('stop_prod')}
                        </button>
                      </div>
                    )}

                    {activeLine?.status === 'IDLE' && (
                      <div className="space-y-3">
                         <button 
                          onClick={handleStartProduction}
                          className="w-full py-5 bg-emerald-600 text-white rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-xl shadow-emerald-600/20 active:scale-95 transition-all"
                        >
                          <Play size={20} fill="currentColor" className="inline-block mr-2" /> Démarrer Production
                        </button>
                        <button 
                          onClick={() => handleSelectProgramme('')}
                          className="w-full text-center text-[10px] font-black text-slate-500 uppercase tracking-widest hover:text-white transition-colors"
                        >
                          Changer de Programme
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* HISTORY SECTION */}
              <div className="bg-slate-900 rounded-[2.5rem] p-6 border border-white/5 shadow-2xl relative overflow-hidden">
                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-2">
                    <History size={16} className="text-blue-500" />
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Historique d'Arrêts</h3>
                  </div>
                  <button 
                    onClick={() => setShowManualStopModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1 bg-blue-600/10 text-blue-500 rounded-full border border-blue-500/20 hover:bg-blue-600 hover:text-white transition-all"
                  >
                    <Plus size={10} />
                    <span className="text-[8px] font-black uppercase tracking-widest">Saisie Manuelle</span>
                  </button>
                </div>

                <div className="space-y-3 max-h-[400px] overflow-y-auto scrollbar-hide pr-1">
                  {downtimeLogs
                    .filter(d => d.operatorId === user?.id && d.lineId === selectedLineId && isToday(parseISO(d.startTime)))
                    .sort((a,b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
                    .map(log => {
                      const type = downtimeTypes.find(t => t.id === log.typeId);
                      return (
                        <div key={log.id} className="group relative bg-black/20 rounded-3xl p-4 border border-white/5 hover:border-blue-500/50 transition-all flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center text-2xl shadow-inner group-hover:scale-110 transition-transform">
                              {type?.icon || '⚠️'}
                            </div>
                            <div>
                               <p className="text-[10px] font-black text-white uppercase tracking-tighter italic leading-none mb-1">
                                 {type?.name || 'Inconnu'}
                               </p>
                               <div className="flex items-center gap-2">
                                 <Clock size={10} className="text-slate-500" />
                                 <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                                   {format(parseISO(log.startTime), 'HH:mm')} - {log.endTime ? format(parseISO(log.endTime), 'HH:mm') : '--:--'}
                                   <span className="ml-2 text-blue-500/80">
                                     {log.duration ? formatDowntimeDisplay(log.duration) : 'En cours'}
                                   </span>
                                 </p>
                               </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => handleEditStopRequest(log)}
                              className="p-2 text-slate-500 hover:text-blue-500 hover:bg-blue-500/10 rounded-xl transition-all"
                            >
                              <Edit size={14} />
                            </button>
                            <button 
                              onClick={() => handleDeleteStop(log.id)}
                              className="p-2 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-xl transition-all"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  {downtimeLogs.filter(d => d.operatorId === user?.id && d.lineId === selectedLineId && isToday(parseISO(d.startTime))).length === 0 && (
                    <div className="py-12 text-center">
                       <Activity size={24} className="mx-auto text-slate-800 mb-2 opacity-20" />
                       <p className="text-[9px] font-black uppercase text-slate-700 tracking-[0.2em] italic">Aucune donnée</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* FLOATING STATUS BAR */}
      <AnimatePresence>
        {selectedLineId && (
          <motion.footer 
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            className="fixed bottom-0 inset-x-0 bg-black/80 backdrop-blur-2xl border-t border-white/5 px-6 py-4 z-40"
          >
            <div className="max-w-xl mx-auto flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-3 h-3 rounded-full animate-pulse",
                  activeLine?.status === 'RUNNING' ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]" : "bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.5)]"
                )} />
                <div className="leading-none">
                  <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-0.5">Status Ligne</p>
                  <p className="text-xs font-black text-white uppercase italic tracking-tighter">
                    {activeLine?.status === 'RUNNING' ? 'Production Active' : 'Arrêt Détecté'}
                  </p>
                </div>
              </div>
              
              <div className="flex gap-4">
                 <div className="text-right leading-none">
                    <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-0.5">Performance</p>
                    <p className="text-xs font-black text-white italic">94% <span className="text-[8px] text-emerald-500 font-bold ml-1">OEE</span></p>
                 </div>
              </div>
            </div>
          </motion.footer>
        )}
      </AnimatePresence>

      {/* ADMIN NAV ACCESS */}
      <div className="hidden sm:flex absolute bottom-4 right-4">
         <button onClick={handleLogout} className="p-3 bg-white/80 backdrop-blur rounded-full shadow-lg border border-gray-100 text-gray-400 hover:text-red-500 transition-colors">
             <span className="text-[10px] font-black uppercase">{t('logout')}</span>
         </button>
      </div>

      {/* MANUAL STOP MODAL */}
      <AnimatePresence>
        {showManualStopModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-slate-950 rounded-[3rem] w-full max-w-md shadow-3xl overflow-hidden border border-white/10"
            >
              <div className="bg-slate-900 px-8 py-6 border-b border-white/5 flex justify-between items-center">
                 <h3 className="text-sm font-black uppercase tracking-widest italic">{editingLogId ? 'Modifier l\'arrêt' : t('add_manual_stop')}</h3>
                 <button onClick={() => {
                   setShowManualStopModal(false);
                   setEditingLogId(null);
                 }} className="text-slate-500 hover:text-white transition-colors">
                   <X size={20} />
                 </button>
              </div>

              <div className="p-8 space-y-6">
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('start_time')}</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-4 bg-slate-900 border border-white/5 rounded-2xl text-xs font-black text-white outline-none focus:border-blue-500"
                      value={manualStopForm.startTime}
                      onChange={e => setManualStopForm({...manualStopForm, startTime: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('end_time')}</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-4 bg-slate-900 border border-white/5 rounded-2xl text-xs font-black text-white outline-none focus:border-blue-500"
                      value={manualStopForm.endTime}
                      onChange={e => setManualStopForm({...manualStopForm, endTime: e.target.value})}
                    />
                  </div>
                </div>

                <div className="bg-blue-600/10 p-4 rounded-2xl border border-blue-500/20 flex items-center justify-between">
                  <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">{t('total_duration')}</p>
                  <p className="text-xl font-black text-white font-mono">{calculateManualDuration()}</p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{t('reason')}</label>
                  <select 
                    className="w-full p-4 bg-slate-900 border border-white/5 rounded-2xl text-xs font-black text-white outline-none focus:border-blue-500 appearance-none"
                    value={manualStopForm.typeId}
                    onChange={e => setManualStopForm({...manualStopForm, typeId: e.target.value})}
                  >
                    <option value="">{t('select_reason')}...</option>
                    {downtimeTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => {
                      if (!manualStopForm.typeId || !manualStopForm.startTime || !manualStopForm.endTime) {
                        return alert(t('missing_fields'));
                      }
                      handleManualStop(manualStopForm);
                    }}
                    className="flex-1 bg-blue-600 text-white font-black uppercase py-4 rounded-2xl text-xs shadow-xl active:scale-95 transition-all tracking-widest hover:bg-blue-500"
                  >
                    {editingLogId ? 'Enregistrer' : t('validate')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* STOP PROD CONFIRMATION */}
      <AnimatePresence>
        {showStopConfirmation && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="bg-slate-950 rounded-[3rem] w-full max-w-sm shadow-3xl overflow-hidden border border-white/10"
            >
              <div className="p-10 text-center space-y-8">
                <div className="w-24 h-24 bg-rose-600/10 rounded-full flex items-center justify-center mx-auto text-rose-500 border border-rose-500/20">
                  <AlertCircle size={48} />
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-3xl font-black text-white uppercase tracking-tighter italic leading-none">Arrêter Production ?</h3>
                  <p className="text-slate-500 font-bold text-sm leading-relaxed">
                    Cette action va clôturer la session de production actuelle.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => {
                      handleStopProduction();
                      setShowStopConfirmation(false);
                    }}
                    className="w-full bg-rose-600 hover:bg-rose-500 text-white py-5 rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-xl active:scale-95 transition-all"
                  >
                    Confirmer l'arrêt
                  </button>
                  <button 
                    onClick={() => setShowStopConfirmation(false)}
                    className="w-full py-4 text-slate-500 font-black uppercase text-xs tracking-widest hover:text-white transition-colors"
                  >
                    Annuler
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
