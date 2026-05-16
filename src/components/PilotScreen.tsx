import { useState, useEffect, useMemo } from 'react';
import { localApi } from '../lib/localApi';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useLanguage } from '../contexts/LanguageContext';
import { DowntimeLog, Shift } from '../types';
import { format, parseISO, isToday } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Monitor, LayoutGrid, Package, Users, Activity, 
  ExternalLink, Plus, History, Timer, Pencil, 
  Trash2, Menu, X, ArrowLeft, Clock, Square, 
  Play, TrendingUp, AlertTriangle, CheckCircle2,
  Box, LayoutDashboard, Info
} from 'lucide-react';
import { cn, formatDuration, formatDowntimeDisplay, getLogDurationSec } from '../lib/utils';
import { getCurrentShiftId } from '../lib/shiftUtils';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';

export default function PilotScreen() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const { 
    machines, 
    users, 
    downtimeTypes, 
    productionLogs: prodLogs, 
    downtimeLogs: downLogs, 
    lines, 
    programmes,
    shifts 
  } = useData();

  const [historyLineFilter, setHistoryLineFilter] = useState<string>(() => sessionStorage.getItem('pilot_history_line') || '');
  const [historyDateFilter, setHistoryDateFilter] = useState<string>(() => sessionStorage.getItem('pilot_history_date') || '');
  const [historyLogType, setHistoryLogType] = useState<'production' | 'downtime'>(() => (sessionStorage.getItem('pilot_history_type') as any) || 'production');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'monitor' | 'history'>(() => (sessionStorage.getItem('pilot_active_tab') as any) || 'dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [selectedMachineId, setSelectedMachineId] = useState<string>(() => sessionStorage.getItem('pilot_selected_machine') || '');
  const [globalTimer, setGlobalTimer] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setGlobalTimer(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Analytics Calculations (Filtered for current shift)
  const currentShiftId = useMemo(() => getCurrentShiftId(shifts), [shifts]);
  const currentShift = useMemo(() => shifts.find(s => s.id === currentShiftId), [shifts, currentShiftId]);

  const analytics = useMemo(() => {
    const today = new Date();
    const start = startOfDay(today);
    const end = endOfDay(today);

    function logDate(iso: string) {
      return iso.includes('T') ? iso : new Date(iso).toISOString();
    }

    // Filter logs for TODAY AND the CURRENT SHIFT
    const todayProd = prodLogs.filter(l => 
      l.shiftId === currentShiftId && 
      isWithinInterval(parseISO(logDate(l.timestamp)), { start, end })
    );

    const todayDown = downLogs.filter(l => 
      l.shiftId === currentShiftId && 
      isWithinInterval(parseISO(logDate(l.startTime)), { start, end })
    );

    const totalPallets = todayProd.reduce((acc, l) => acc + l.count, 0);
    const totalDowntimeSec = todayDown.reduce((acc, l) => acc + getLogDurationSec(l), 0);
    
    const activeLines = lines.filter(l => l.isActive !== false && l.machineId === selectedMachineId);
    
    // Calculate availability based on elapsed time in current shift
    // Defaulting to 8 hours if no shift found
    const shiftHours = 8;
    const totalPossibleTime = activeLines.length * shiftHours * 60 * 60; 
    const uptimeSec = Math.max(0, totalPossibleTime - totalDowntimeSec);
    const availability = totalPossibleTime > 0 ? (uptimeSec / totalPossibleTime) * 100 : 0;

    // Frequent Stops Aggregation
    const stopStats: Record<string, { count: number, totalTime: number }> = {};
    todayDown.forEach(log => {
      if (!stopStats[log.typeId]) {
        stopStats[log.typeId] = { count: 0, totalTime: 0 };
      }
      stopStats[log.typeId].count += 1;
      stopStats[log.typeId].totalTime += getLogDurationSec(log);
    });

    const frequentStops = Object.entries(stopStats)
      .map(([typeId, stats]) => ({
        typeId,
        typeName: downtimeTypes.find(t => t.id === typeId)?.name || 'Inconnu',
        icon: downtimeTypes.find(t => t.id === typeId)?.icon || '⚠️',
        ...stats
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const teamPerformance = users
      .filter(u => u.role === 'operator')
      .map(u => {
        const pallets = todayProd
          .filter(l => l.operatorId === u.id)
          .reduce((acc, l) => acc + l.count, 0);
        const downtime = todayDown
          .filter(l => l.operatorId === u.id)
          .reduce((acc, l) => acc + getLogDurationSec(l), 0);
        
        return {
          id: u.id,
          name: u.name,
          pallets,
          downtime: Math.round(downtime / 60)
        };
      })
      .filter(p => p.pallets > 0 || p.downtime > 0)
      .sort((a, b) => b.pallets - a.pallets);

    return {
      totalPallets,
      totalDowntimeSec,
      availability,
      frequentStops,
      teamPerformance
    };
  }, [prodLogs, downLogs, lines, currentShiftId, downtimeTypes, users, selectedMachineId]);

  useEffect(() => {
    sessionStorage.setItem('pilot_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    sessionStorage.setItem('pilot_selected_machine', selectedMachineId);
  }, [selectedMachineId]);

  useEffect(() => {
    sessionStorage.setItem('pilot_history_line', historyLineFilter);
    sessionStorage.setItem('pilot_history_date', historyDateFilter);
    sessionStorage.setItem('pilot_history_type', historyLogType);
  }, [historyLineFilter, historyDateFilter, historyLogType]);
  const [activeDowntimes, setActiveDowntimes] = useState<Record<string, DowntimeLog>>({});

  const [isAssigning, setIsAssigning] = useState<string | null>(null);
  const [showCreateNew, setShowCreateNew] = useState(false);
  const [newProgName, setNewProgName] = useState('');
  const [newProgParams, setNewProgParams] = useState('');

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editModalType, setEditModalType] = useState<'prod' | 'down'>('prod');
  const [editModalData, setEditModalData] = useState<any>({});
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{col: string, id: string, name: string} | null>(null);
  const [showFeatureInfo, setShowFeatureInfo] = useState(false);
  const [declaringDowntimeLineId, setDeclaringDowntimeLineId] = useState<string | null>(null);
  const [showManualStopModal, setShowManualStopModal] = useState(false);
  const [manualStopForm, setManualStopForm] = useState({
    typeId: '',
    startTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    endTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    description: '',
    lineId: ''
  });

  // Auto-select machine if pilot is already assigned in DB
  useEffect(() => {
    if (!user || selectedMachineId) return;
    const myMachine = machines.find(m => m.currentPilotId === user.id);
    if (myMachine) {
       setSelectedMachineId(myMachine.id);
    }
  }, [machines, user, selectedMachineId]);

  const handleMachineSelect = async (machineId: string) => {
    if (!user) return;
    
    try {
      // Release current machine if selected
      if (selectedMachineId && selectedMachineId !== machineId) {
        await localApi.updateDoc('machines', selectedMachineId, { currentPilotId: null });
      }

      // Assign new machine if machineId is provided
      if (machineId) {
        await localApi.updateDoc('machines', machineId, { currentPilotId: user.id });
      }
      
      setSelectedMachineId(machineId);
    } catch (e) {
      console.error("Error updating machine assignment:", e);
      alert("Erreur lors de l'assignation de la machine");
    }
  };

  const handleLogout = async () => {
    if (selectedMachineId) {
      try {
        await localApi.updateDoc('machines', selectedMachineId, { currentPilotId: null });
      } catch (e) {
        console.error("Error releasing machine on logout:", e);
      }
    }
    logout();
  };

  useEffect(() => {
    if (!selectedMachineId) return;
    // Data is already handled by the global onSnapshot polling in the main effect
  }, [selectedMachineId]);

  // Sync active downtimes
  useEffect(() => {
    const active: Record<string, DowntimeLog> = {};
    downLogs.forEach(log => {
      if (!log.endTime) active[log.lineId] = log;
    });
    setActiveDowntimes(active);
  }, [downLogs]);

  const handleAssignProgramme = async () => {
    if (!isAssigning || !newProgName) return;

    try {
      const line = lines.find(l => l.id === isAssigning);
      
      // Mark current programme as finished if it exists
      if (line?.currentProgrammeId) {
        await localApi.updateDoc('programmes', line.currentProgrammeId, {
          status: 'FINISHED'
        });
      }

      // Create new programme
      const newProg = {
        name: newProgName,
        machineId: selectedMachineId,
        lineId: isAssigning,
        producedPallets: 0,
        status: 'ACTIVE' as const,
        createdAt: new Date().toISOString(),
        parameters: newProgParams
      };
      const progRef = await localApi.addDoc('programmes', newProg);

      // Update line
      await localApi.updateDoc('lines', isAssigning, {
        currentProgrammeId: progRef.id,
        status: 'IDLE',
        currentOperatorId: null
      });

      setIsAssigning(null);
      setNewProgName('');
      setNewProgParams('');
    } catch (e) {
      console.error(e);
      alert('Erreur lors de l\'assignation du programme');
    }
  };

  const handleSelectExistingProgramme = async (progId: string) => {
    if (!isAssigning) return;
    try {
      const line = lines.find(l => l.id === isAssigning);
      
      // Mark current programme as finished if it exists
      if (line?.currentProgrammeId && line.currentProgrammeId !== progId) {
        await localApi.updateDoc('programmes', line.currentProgrammeId, {
          status: 'FINISHED'
        });
      }

      await localApi.updateDoc('lines', isAssigning, {
        currentProgrammeId: progId,
        status: 'IDLE',
        currentOperatorId: null
      });
      setIsAssigning(null);
    } catch (e) {
      console.error(e);
      alert('Erreur lors de la sélection du programme');
    }
  };

  const handleReleaseLine = async (lineId: string) => {
    try {
      const line = lines.find(l => l.id === lineId);
      
      // Mark current programme as finished if it exists
      if (line?.currentProgrammeId) {
        await localApi.updateDoc('programmes', line.currentProgrammeId, {
          status: 'FINISHED'
        });
      }

      await localApi.updateDoc('lines', lineId, {
        currentProgrammeId: null,
        currentOperatorId: null,
        status: 'IDLE'
      });
    } catch (e) {
      console.error(e);
      alert('Erreur lors de la libération de la ligne');
    }
  };

  const openEditModal = (type: 'prod' | 'down', log: any) => {
    setEditModalType(type);
    setEditModalData({ ...log });
    setEditingLogId(log.id);
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async () => {
    if (!editingLogId) return;
    try {
      const col = editModalType === 'prod' ? 'production_logs' : 'downtime_logs';
      const data = { ...editModalData };
      delete data.id;

      if (editModalType === 'prod') {
        const oldLog = prodLogs.find(l => l.id === editingLogId);
        data.count = parseInt(data.count);
        if (oldLog && oldLog.count !== data.count) {
          const diff = data.count - oldLog.count;
          const prog = programmes.find(p => p.id === oldLog.programmeId);
          if (prog) {
            await localApi.updateDoc('programmes', oldLog.programmeId, {
              producedPallets: (prog.producedPallets || 0) + diff
            });
          }
        }
      } else {
        if (data.duration) data.duration = parseInt(data.duration);
      }

      await localApi.updateDoc(col, editingLogId, data);
      setIsEditModalOpen(false);
      setEditingLogId(null);
    } catch (e) {
      console.error(e);
      alert('Erreur lors de la modification');
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      if (confirmDelete.col === 'production_logs') {
        const logData = prodLogs.find(l => l.id === confirmDelete.id);
        if (logData) {
          const prog = programmes.find(p => p.id === logData.programmeId);
          if (prog) {
            await localApi.updateDoc('programmes', logData.programmeId, {
              producedPallets: (prog.producedPallets || 0) - logData.count
            });
          }
        }
      }

      if (confirmDelete.col === 'downtime_logs') {
        const logData = downLogs.find(l => l.id === confirmDelete.id);
        if (logData) {
          if (!logData.endTime) {
            await localApi.updateDoc('lines', logData.lineId, {
              activeDowntimeId: null,
              status: 'IDLE'
            });
          }
        }
      }

      await localApi.deleteDoc(confirmDelete.col, confirmDelete.id);
      setConfirmDelete(null);
    } catch (e) {
      console.error(e);
      alert('Erreur lors de la suppression');
    }
  };

  const handleResumeMachine = async () => {
    if (!selectedMachineId) return;
    try {
      const machineLines = lines.filter(l => l.machineId === selectedMachineId);
      for (const line of machineLines) {
        if (line.activeDowntimeId) {
          const log = downLogs.find(l => l.id === line.activeDowntimeId);
          if (log && !log.endTime) {
            const endTime = new Date().toISOString();
            const duration = Math.floor((new Date(endTime).getTime() - new Date(log.startTime).getTime()) / 1000);
            await localApi.updateDoc('downtime_logs', log.id, { endTime, duration });
          }
          await localApi.updateDoc('lines', line.id, {
            activeDowntimeId: null,
            status: 'IDLE'
          });
        }
      }
    } catch (e) {
      console.error(e);
      alert('Erreur lors du redémarrage de la machine');
    }
  };

  const handleStopSpecificDowntime = async (lineId: string) => {
    try {
      const line = lines.find(l => l.id === lineId);
      if (line && line.activeDowntimeId) {
        const log = downLogs.find(l => l.id === line.activeDowntimeId);
        if (log && !log.endTime) {
          const endTime = new Date().toISOString();
          const duration = Math.floor((new Date(endTime).getTime() - new Date(log.startTime).getTime()) / 1000);
          await localApi.updateDoc('downtime_logs', log.id, { endTime, duration });
        }
        await localApi.updateDoc('lines', line.id, {
          activeDowntimeId: null,
          status: 'IDLE'
        });
      }
    } catch (e) {
      console.error(e);
      alert('Erreur lors du redémarrage de la ligne');
    }
  };

  const handleStartDowntime = async (lineId: string | null | 'global', typeId: string) => {
    if (!user || !selectedMachineId) return;
    try {
      const startTime = new Date().toISOString();
      const currentShiftId = getCurrentShiftId(shifts);

      // --- CONSOLIDATED STOP LOGIC ---
      // Requirement: "IF the same ARRET HAS set in all lines in the same time or even close in time 
      // they will be set as one arret for the whole machine"
      // Wait for a small window to see if another line already started this same downtime type
      const machineLines = lines.filter(l => l.machineId === selectedMachineId);
      const windowMs = 2 * 60 * 1000; // 2 minutes
      const now = new Date().getTime();

      const existingRecentDowntime = downLogs.find(log => 
        log.machineId === selectedMachineId && 
        log.typeId === typeId && 
        !log.endTime && 
        (now - new Date(log.startTime).getTime()) < windowMs
      );

      if (lineId && lineId !== 'global') {
        // Specific line stop
        const logId = existingRecentDowntime ? existingRecentDowntime.id : (await localApi.addDoc('downtime_logs', {
          machineId: selectedMachineId,
          lineId: lineId,
          typeId,
          operatorId: user.id,
          shiftId: currentShiftId,
          startTime,
        })).id;

        await localApi.updateDoc('lines', lineId, {
          activeDowntimeId: logId,
          status: 'STOPPED'
        });
      } else {
        // Global machine stop (all lines)
        const logId = existingRecentDowntime ? existingRecentDowntime.id : (await localApi.addDoc('downtime_logs', {
          machineId: selectedMachineId,
          lineId: 'MACHINE_LEVEL', // Using a marker for machine level if needed or just first line
          typeId,
          operatorId: user.id,
          shiftId: currentShiftId,
          startTime,
        })).id;

        for (const line of machineLines) {
          await localApi.updateDoc('lines', line.id, {
            activeDowntimeId: logId,
            status: 'STOPPED'
          });
        }
      }
      
      setDeclaringDowntimeLineId(null);
    } catch (e) {
      console.error(e);
      alert('Erreur lors de la déclaration de l\'arrêt');
    }
  };

  const handleManualStop = async (data: typeof manualStopForm) => {
    if (!user || !selectedMachineId || !data.lineId) return;

    try {
      const start = new Date(data.startTime).getTime();
      const end = new Date(data.endTime).getTime();
      const durationMs = end - start;

      if (durationMs <= 0) {
        alert('L\'heure de fin doit être après l\'heure de début.');
        return;
      }

      if (!isToday(new Date(data.startTime)) || !isToday(new Date(data.endTime))) {
        alert("Le pilote ne peut ajouter des arrêts que pour la journée en cours.");
        return;
      }

      const currentShiftId = getCurrentShiftId(shifts);

      await localApi.addDoc('downtime_logs', {
        machineId: selectedMachineId,
        lineId: data.lineId,
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
        ...manualStopForm,
        typeId: '',
        startTime: format(new Date(Date.now() - 15 * 60000), "yyyy-MM-dd'T'HH:mm"),
        endTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        description: '',
        lineId: ''
      });
    } catch (error) {
      console.error('Error adding manual downtime:', error);
      alert('Erreur lors de l\'ajout de l\'arrêt manuel');
    }
  };

  const handlePalletTick = async (lineId: string, progId: string) => {
    if (!user || !selectedMachineId) return;
    try {
      const currentShiftId = getCurrentShiftId(shifts);
      await localApi.addDoc('production_logs', {
        programmeId: progId,
        operatorId: user.id,
        machineId: selectedMachineId,
        lineId,
        shiftId: currentShiftId,
        count: 1,
        timestamp: new Date().toISOString()
      });
      const prog = programmes.find(p => p.id === progId);
      if (prog) {
        await localApi.updateDoc('programmes', progId, {
          producedPallets: (prog.producedPallets || 0) + 1
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const calculateManualDuration = () => {
    const start = new Date(manualStopForm.startTime).getTime();
    const end = new Date(manualStopForm.endTime).getTime();
    const diff = end - start;
    if (diff <= 0) return '0 min';
    return formatDowntimeDisplay(Math.floor(diff / 1000));
  };
  const sortedProdLogs = useMemo(() => [...prodLogs]
    .filter(log => log.machineId === selectedMachineId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()), [prodLogs, selectedMachineId]);

  const sortedDownLogs = useMemo(() => [...downLogs]
    .filter(log => log.machineId === selectedMachineId)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()), [downLogs, selectedMachineId]);

  // Filter machines available for this pilot (not assigned or assigned to them)
  const availableMachines = useMemo(() => machines.filter(m => !m.currentPilotId || m.currentPilotId === user?.id), [machines, user]);

  // Filter programmes that are already assigned to other lines
  const assignedProgIds = useMemo(() => lines.map(l => l.currentProgrammeId).filter(Boolean), [lines]);
  const availableProgs = useMemo(() => programmes.filter(p => p.machineId === selectedMachineId && p.status === 'ACTIVE' && !assignedProgIds.includes(p.id)), [programmes, selectedMachineId, assignedProgIds]);

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
    <div className="min-h-screen bg-[#F8FAFC] pb-20">
      {/* MOBILE HEADER */}
      <header className="sm:hidden bg-white border-b border-gray-100 px-2 py-0.5 flex justify-between items-center sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-1">
          {selectedMachineId ? (
            <button 
              onClick={() => handleMachineSelect('')}
              className="p-1 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors mr-0.5"
            >
              <ArrowLeft size={14} />
            </button>
          ) : (
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-1 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {isMobileMenuOpen ? <X size={14} /> : <Menu size={14} />}
            </button>
          )}
              <div className="flex items-center gap-1">
                <button 
                  onClick={() => setShowFeatureInfo(true)}
                  className="p-1.5 text-gray-400 hover:bg-blue-600 hover:text-white rounded-lg transition-colors mr-1"
                  title="Description des fonctionnalités intelligentes"
                >
                  <Info size={14} />
                </button>
                <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white font-black text-[10px]">
                  A
                </div>
            <h1 className="font-black text-xs tracking-tighter text-gray-900 leading-none">PILOT<span className="text-blue-600">CLOUD</span></h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleLogout}
            className="p-1 px-1.5 border border-red-50 text-red-500 bg-red-50 rounded-lg transition-colors font-black text-[7px] uppercase"
          >
            {t('logout')}
          </button>
        </div>
      </header>

      {/* SLIDING MENU */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] sm:hidden"
            />
            
            {/* Drawer */}
            <motion.aside 
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="fixed inset-y-0 left-0 w-[260px] bg-white z-[70] p-4 flex flex-col gap-6 shadow-2xl sm:hidden"
            >
              <div className="flex items-center gap-2 px-1">
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-black text-sm shadow-lg shadow-blue-200">
                  A
                </div>
                <h1 className="font-black text-lg tracking-tighter text-gray-900 leading-none capitalize italic">PILOT<span className="text-blue-600">CLOUD</span></h1>
              </div>
              
              <nav className="flex flex-col gap-1.5 flex-1">
                <button
                  onClick={() => { setActiveTab('dashboard'); setIsMobileMenuOpen(false); }}
                  className={cn(
                    "flex items-center gap-3 px-3 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                    activeTab === 'dashboard' ? "bg-blue-600 text-white shadow-md" : "text-gray-400 hover:bg-gray-50"
                  )}
                >
                  <LayoutDashboard size={16} />
                  Dashboard
                </button>
                <button
                  onClick={() => { setActiveTab('monitor'); setIsMobileMenuOpen(false); }}
                  className={cn(
                    "flex items-center gap-3 px-3 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                    activeTab === 'monitor' ? "bg-blue-600 text-white shadow-md" : "text-gray-400 hover:bg-gray-50"
                  )}
                >
                  <Monitor size={16} />
                  Monitor
                </button>
                <button
                  onClick={() => { setActiveTab('history'); setIsMobileMenuOpen(false); }}
                  className={cn(
                    "flex items-center gap-3 px-3 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                    activeTab === 'history' ? "bg-blue-600 text-white shadow-md" : "text-gray-400 hover:bg-gray-50"
                  )}
                >
                  <History size={16} />
                  Historique
                </button>

                <div className="mt-auto pt-4 border-t border-gray-100">
                  <button 
                    onClick={handleLogout}
                    className="flex items-center gap-3 px-3 py-3 rounded-lg text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-50 w-full transition-colors"
                  >
                    <Trash2 size={16} />
                    QUITTER
                  </button>
                </div>
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="bg-white p-4 shadow-sm flex flex-col gap-4 sticky top-0 sm:top-0 z-20 border-b border-gray-200 hidden sm:block">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Monitor className="text-blue-600" size={24} />
            <h1 className="font-black text-xl tracking-tighter uppercase italic">Pilot Monitor</h1>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={cn(
                "flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                activeTab === 'dashboard' ? "bg-blue-600 text-white shadow-lg" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              )}
            >
              <LayoutDashboard size={14} />
              {t('dashboard')}
            </button>
            <button 
              onClick={() => setActiveTab('monitor')}
              className={cn(
                "flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                activeTab === 'monitor' ? "bg-blue-600 text-white shadow-lg" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              )}
            >
              <Monitor size={14} />
              {t('monitor')}
            </button>
            <button 
              onClick={() => setActiveTab('history')}
              className={cn(
                "flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                activeTab === 'history' ? "bg-blue-600 text-white shadow-lg" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              )}
            >
              <History size={14} />
              {t('history')}
            </button>
            <button 
              onClick={handleLogout} 
              className="p-1 px-1.5 text-red-500 bg-red-50 rounded-lg transition-colors font-black text-[8px] uppercase border border-red-50 hover:bg-red-500 hover:text-white shrink-0"
            >
              {t('logout')}
            </button>
          </div>
        </div>
        
        {activeTab === 'monitor' && selectedMachineId && (
          <div className="flex justify-between items-center bg-gray-50/50 p-2 sm:p-4 rounded-2xl border border-gray-100 mb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-blue-600 shadow-sm border border-blue-50">
                <LayoutGrid size={20} />
              </div>
              <div>
                <p className="text-[9px] text-gray-400 font-black uppercase tracking-widest leading-none mb-1">Status Machine</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-black text-gray-800">{machines.find(m => m.id === selectedMachineId)?.name}</p>
                  <button 
                    onClick={() => handleMachineSelect('')}
                    className="text-[8px] font-bold text-blue-600 uppercase hover:underline"
                  >
                    ({t('change')})
                  </button>
                </div>
              </div>
            </div>
            {lines.filter(l => l.machineId === selectedMachineId).some(l => l.status === 'RUNNING') ? (
              <button 
                onClick={() => setDeclaringDowntimeLineId('global')}
                className="flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-red-100 hover:bg-red-700 active:scale-95 transition-all animate-in fade-in zoom-in"
              >
                <Activity size={16} className="animate-pulse" />
                {t('stop_machine')}
              </button>
            ) : lines.filter(l => l.machineId === selectedMachineId).some(l => l.activeDowntimeId) ? (
              <button 
                onClick={handleResumeMachine}
                className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-green-100 hover:bg-green-700 active:scale-95 transition-all animate-in fade-in zoom-in"
              >
                <Activity size={16} />
                {t('start_machine')}
              </button>
            ) : null}
          </div>
        )}

        {activeTab === 'monitor' && (
          <select 
            value={selectedMachineId}
            onChange={e => handleMachineSelect(e.target.value)}
            className="w-full p-4 bg-gray-50/50 rounded-2xl font-bold border border-gray-100 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-inner text-gray-700 appearance-none cursor-pointer"
          >
            <option value="">{t('machine_select')}...</option>
            {availableMachines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
      </div>

      {/* Mobile-only machine selector when in monitor tab */}
      {activeTab === 'monitor' && (
        <div className="px-2 py-1 sm:hidden bg-white border-b border-gray-100 space-y-1 shadow-sm">
           {selectedMachineId && (
             <div className="flex gap-1">
                {lines.filter(l => l.machineId === selectedMachineId).some(l => l.status === 'RUNNING') ? (
                  <button 
                    onClick={() => setDeclaringDowntimeLineId('global')}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-red-600 text-white rounded-lg font-black text-[8px] uppercase tracking-tight shadow-md shadow-red-50 active:scale-95 transition-all"
                  >
                    <Activity size={10} className="animate-pulse" />
                    ARRÊT
                  </button>
                ) : lines.filter(l => l.machineId === selectedMachineId).some(l => l.activeDowntimeId) ? (
                  <button 
                    onClick={handleResumeMachine}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-green-600 text-white rounded-lg font-black text-[8px] uppercase tracking-tight shadow-md shadow-green-50 active:scale-95 transition-all"
                  >
                    <Activity size={10} />
                    RELANCER
                  </button>
                ) : null}
                <button 
                  onClick={() => handleMachineSelect('')}
                  className="px-1.5 py-1 bg-gray-50 text-gray-400 border border-gray-100 rounded-lg font-black text-[7px] uppercase tracking-widest shrink-0"
                >
                  CHANGE
                </button>
             </div>
           )}
           {!selectedMachineId && (
             <select 
              value={selectedMachineId}
              onChange={e => handleMachineSelect(e.target.value)}
              className="w-full p-1.5 bg-gray-50/50 rounded-lg font-black border border-gray-100 focus:ring-1 focus:ring-blue-500 outline-none transition-all text-gray-700 text-[9px] appearance-none"
            >
              <option value="">SÉLECTIONNER MACHINE...</option>
              {availableMachines.map(m => <option key={m.id} value={m.id}>{m.name.toUpperCase()}</option>)}
            </select>
           )}
        </div>
      )}

      {activeTab === 'dashboard' ? (
        <div className="p-2 sm:p-6 space-y-4 md:space-y-6 animate-in fade-in duration-300">
          <div className="flex justify-between items-end px-1">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="bg-blue-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest">{currentShift?.name || 'Shift Actif'}</span>
                {selectedMachineId && (
                  <span className="bg-gray-100 text-gray-400 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest">{machines.find(m => m.id === selectedMachineId)?.name}</span>
                )}
              </div>
              <h2 className="text-base md:text-xl font-black tracking-tighter text-gray-900 leading-none">
                {t('dashboard')} <span className="text-blue-600 uppercase text-[10px] md:text-xs tracking-widest ml-1">Pilot Intelligence</span>
              </h2>
              <p className="text-[8px] md:text-[10px] font-bold text-gray-400 uppercase mt-1 italic">Stats de l'équipe • Direct {currentShift?.name}</p>
            </div>
            <div className="text-right flex flex-col items-end">
              <div className="flex items-center gap-1.5 bg-blue-50 px-2 py-1 rounded-full border border-blue-100 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                <p className="text-[8px] md:text-[10px] font-black text-blue-700 uppercase tracking-tight">Analyse Active</p>
              </div>
            </div>
          </div>

          {/* KPI CARDS */}
          <motion.div 
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4"
          >
             {[
               { label: 'OEE Shift', val: `${analytics.availability.toFixed(1)}%`, sub: 'Dispo. de votre équipe', icon: TrendingUp, color: 'blue', trend: '+2.1%' },
               { label: 'Palettes Équipe', val: analytics.totalPallets, sub: 'Sur ce shift', icon: Box, color: 'green', trend: '+12' },
               { label: 'Temps d\'Arrêt', val: formatDowntimeDisplay(analytics.totalDowntimeSec), sub: 'Total Shift', icon: Timer, color: 'orange', trend: '-5%' },
               { label: 'Alertes Actives', val: lines.filter(l => l.machineId === selectedMachineId && !!l.activeDowntimeId).length, sub: 'Sur votre machine', icon: AlertTriangle, color: 'red', trend: 'Live' },
             ].map(stat => (
               <motion.div 
                variants={item}
                key={stat.label} 
                className="card p-2 md:p-4 flex flex-col gap-2 md:gap-3 hover:shadow-xl transition-all group relative overflow-hidden bg-white"
               >
                 <div className={cn(
                   "absolute -right-2 -top-2 w-16 h-16 opacity-5 transition-transform group-hover:scale-150 rotate-12",
                   stat.color === 'blue' ? "text-blue-600" :
                   stat.color === 'green' ? "text-green-600" :
                   stat.color === 'orange' ? "text-orange-600" : "text-red-600"
                 )}>
                   <stat.icon className="w-full h-full" />
                 </div>
                 <div className="flex justify-between items-start">
                   <div className={cn(
                     "w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl flex items-center justify-center shadow-lg border border-white/20 shrink-0",
                     stat.color === 'blue' ? "bg-blue-600 text-white shadow-blue-200" :
                     stat.color === 'green' ? "bg-green-600 text-white shadow-green-200" :
                     stat.color === 'orange' ? "bg-orange-600 text-white shadow-orange-200" : "bg-red-600 text-white shadow-red-200"
                   )}>
                     <stat.icon className="w-4 h-4 md:w-5 md:h-5" strokeWidth={2.5} />
                   </div>
                   <span className={cn(
                     "text-[8px] md:text-[10px] font-black px-1.5 py-0.5 rounded italic",
                     stat.color === 'blue' ? "bg-blue-50 text-blue-600" :
                     stat.color === 'green' ? "bg-green-50 text-green-600" :
                     stat.color === 'orange' ? "bg-orange-50 text-orange-600" : "bg-red-50 text-red-600"
                   )}>
                     {stat.trend}
                   </span>
                 </div>
                 <div>
                   <p className="text-[7px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-0.5 leading-none">{stat.label}</p>
                   <p className="text-sm md:text-2xl font-black text-slate-900 leading-none mt-1 tabular-nums">{stat.val}</p>
                   <p className="text-[7px] md:text-[9px] font-bold text-slate-400 mt-1">{stat.sub}</p>
                 </div>
               </motion.div>
             ))}
          </motion.div>

          {/* BOTTOM ROW: FREQUENT STOPS & TEAM PERFORMANCE */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            
            {/* FREQUENT STOPS */}
            <motion.div variants={item} className="card p-4 bg-white flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-gray-900 flex items-center gap-2">
                  <AlertTriangle size={16} className="text-orange-500" /> Arrêts Fréquents (Shift)
                </h3>
                <span className="text-[8px] font-bold text-gray-400 uppercase">Top 5 récurrents</span>
              </div>
              
              <div className="space-y-2 flex-1">
                {analytics.frequentStops.length > 0 ? (
                  analytics.frequentStops.map((stop, idx) => (
                    <div key={stop.typeId} className="flex items-center gap-3 p-2 bg-gray-50 rounded-xl border border-gray-100 group hover:border-orange-200 transition-all">
                      <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-lg shadow-sm border border-gray-100 group-hover:scale-110 transition-transform">
                        {stop.icon}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-center mb-1">
                           <span className="text-[10px] font-black text-gray-800 uppercase tracking-tight">{stop.typeName}</span>
                           <span className="text-[10px] font-black text-orange-600 italic">{stop.count} fois</span>
                        </div>
                        <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
                           <div 
                             className="h-full bg-orange-500 rounded-full" 
                             style={{ width: `${(stop.count / (analytics.frequentStops[0]?.count || 1)) * 100}%` }} 
                           />
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="h-full flex flex-col items-center justify-center py-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                    <CheckCircle2 size={24} className="text-green-300 mb-2" />
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Aucun arrêt enregistré sur ce shift</p>
                  </div>
                )}
              </div>
            </motion.div>

            {/* TEAM PERFORMANCE (PILOT'S OPERATORS) */}
            <motion.div variants={item} className="card p-4 bg-white">
              <h3 className="text-xs font-black uppercase tracking-widest text-gray-900 mb-4 flex items-center gap-2">
                <Users size={16} className="text-blue-500" /> Performance des Opérateurs
              </h3>
              <div className="space-y-3">
                {analytics.teamPerformance.map(op => (
                  <div key={op.id} className="p-3 bg-gray-50 rounded-xl border border-gray-100 group hover:bg-white transition-all">
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-[10px] font-black text-blue-600 uppercase">
                          {op.name.charAt(0)}
                        </div>
                        <span className="text-[10px] font-black text-gray-900 uppercase italic">{op.name}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                       <div>
                          <p className="text-[7px] font-black text-gray-400 uppercase tracking-tighter">Production</p>
                          <p className="text-xs font-black text-gray-800">{op.pallets} <span className="opacity-50 text-[8px]">Pal.</span></p>
                       </div>
                       <div className="text-right">
                          <p className="text-[7px] font-black text-gray-400 uppercase tracking-tighter">Temps d'Arrêt</p>
                          <p className="text-xs font-black text-red-600">{op.downtime} <span className="opacity-50 text-[8px]">min</span></p>
                       </div>
                    </div>
                    <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                       <div 
                        className="h-full bg-blue-600 rounded-full" 
                        style={{ width: `${Math.min(100, (op.pallets / (analytics.totalPallets || 1)) * 100)}%` }} 
                       />
                    </div>
                  </div>
                ))}
                {analytics.teamPerformance.length === 0 && (
                  <p className="text-center py-6 text-[10px] font-black text-gray-300 uppercase tracking-widest italic">Aucun opérateur actif</p>
                )}
              </div>
            </motion.div>
          </div>

          {/* REAL TIME STOPS / ACTIVE ALERTS (ONLY FOR THIS MACHINE) */}
          <div className="card overflow-hidden bg-white mt-4">
             <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
               <h3 className="text-sm font-black uppercase tracking-widest text-gray-900 flex items-center gap-2">
                  <Activity size={16} className="text-red-500 animate-pulse" /> Arrêts en Temps Réel
               </h3>
               <div className="flex items-center gap-1">
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-tighter">Live Monitor</span>
               </div>
             </div>
             <div className="overflow-x-auto">
               <table className="w-full text-left">
                  <thead className="bg-white text-[10px] text-gray-400 font-black uppercase tracking-[0.2em] border-b border-gray-100">
                    <tr>
                      <th className="px-6 py-5 whitespace-nowrap">Ligne</th>
                      <th className="px-6 py-5 whitespace-nowrap">Motif de l'arrêt</th>
                      <th className="px-6 py-5 whitespace-nowrap">Début</th>
                      <th className="px-6 py-5 whitespace-nowrap text-right">Action</th>
                    </tr>
                  </thead>
                 <tbody className="divide-y divide-gray-50">
                    {lines
                      .filter(l => l.machineId === selectedMachineId && !!l.activeDowntimeId)
                      .map(l => {
                        const down = downLogs.find(d => d.id === l.activeDowntimeId);
                        const type = downtimeTypes.find(t => t.id === down?.typeId);
                        return (
                          <tr key={l.id} className="text-sm hover:bg-red-50/30 transition-all group/line animate-in slide-in-from-left duration-300">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
                                  <AlertTriangle size={16} />
                                </div>
                                <p className="font-black text-gray-900 leading-none">{l.name}</p>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                               <div className="flex items-center gap-2">
                                  <span className="text-lg">{type?.icon}</span>
                                  <span className="font-black text-red-700 uppercase italic text-[11px]">{type?.name}</span>
                               </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-[10px] font-mono font-black text-gray-500 italic">
                                {down ? format(parseISO(down.startTime), 'HH:mm:ss') : '—'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                               <button 
                                onClick={() => handleStopSpecificDowntime(l.id)}
                                className="px-3 py-1 bg-green-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest shadow-lg shadow-green-100 hover:scale-105 transition-all"
                               >
                                 Relancer
                               </button>
                            </td>
                          </tr>
                        );
                      })}
                      {lines.filter(l => l.machineId === selectedMachineId && !!l.activeDowntimeId).length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-6 py-10 text-center">
                             <div className="flex flex-col items-center justify-center text-green-500/40">
                               <CheckCircle2 size={32} className="mb-2" />
                               <p className="text-[10px] font-black uppercase tracking-[0.2em] italic">Tout fonctionne normalement</p>
                             </div>
                          </td>
                        </tr>
                      )}
                 </tbody>
               </table>
             </div>
          </div>
        </div>
      ) : activeTab === 'monitor' ? (
        !selectedMachineId ? (
        <div className="flex flex-col items-center justify-center p-6 text-center space-y-2">
          <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center text-blue-300">
             <LayoutGrid size={20} />
          </div>
          <p className="text-gray-400 font-bold uppercase text-[9px] tracking-widest">{t('machine_select')}</p>
        </div>
      ) : (
        <motion.div 
          variants={container}
          initial="hidden"
          animate="show"
          className="p-1 sm:p-4 gap-2 sm:gap-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
        >
          {lines.filter(l => l.machineId === selectedMachineId).map(line => {
            const prog = programmes.find(p => p.id === line.currentProgrammeId);
            const op = users.find(u => u.id === line.currentOperatorId);
            const down = activeDowntimes[line.id];
            const downType = downtimeTypes.find(t => t.id === down?.typeId);
            return (
              <motion.div 
                key={line.id}
                variants={item}
                layout
                className="card transition-colors flex flex-col overflow-hidden border-l-4 border-slate-200 hover:border-blue-500 bg-white"
              >
                <div className="px-3 py-2 flex justify-between items-center border-b border-slate-50 shrink-0">
                  <div className="leading-none">
                    <h3 className="font-black text-xs text-slate-900 truncate max-w-[100px]">{line.name}</h3>
                    <div className="flex items-center gap-1 mt-1">
                       <span className={cn(
                        "px-1 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest flex items-center gap-0.5",
                        line.status === 'RUNNING' ? "bg-emerald-50 text-emerald-600" :
                        line.status === 'STOPPED' ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-400"
                      )}>
                        <span className={cn(
                          "w-1 h-1 rounded-full",
                          line.status === 'RUNNING' ? "bg-emerald-500 animate-pulse" : line.status === 'STOPPED' ? "bg-rose-500" : "bg-slate-400"
                        )} />
                        {line.status === 'RUNNING' ? t('running') : 
                         line.status === 'STOPPED' ? t('stopped') : t('idle')}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {line.status === 'STOPPED' || down ? (
                      <button 
                        onClick={() => handleStopSpecificDowntime(line.id)}
                        className="p-1.5 text-emerald-600 bg-emerald-50 rounded-lg active:scale-95 hover:bg-emerald-100 transition-all shadow-sm flex items-center gap-1 border border-emerald-100 h-7"
                      >
                        <Play className="w-3 h-3" strokeWidth={3} />
                        <span className="text-[9px] font-black uppercase tracking-tight">RELANCER</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => setDeclaringDowntimeLineId(line.id)}
                          className="p-1 px-1.5 text-red-600 bg-red-50 rounded-lg active:scale-95 hover:bg-red-100 transition-all shadow-sm flex flex-col items-center justify-center border border-red-100 h-7 leading-none"
                        >
                          <Square size={8} fill="currentColor" />
                          <span className="text-[7px] font-black uppercase tracking-tight mt-0.5">AUTO</span>
                        </button>
                        <button 
                          onClick={() => {
                             setManualStopForm({
                               ...manualStopForm,
                               lineId: line.id,
                               startTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
                               endTime: format(new Date(), "yyyy-MM-dd'T'HH:mm")
                             });
                             setShowManualStopModal(true);
                          }}
                          className="p-1 px-1.5 text-slate-600 bg-slate-50 rounded-lg active:scale-95 hover:bg-slate-100 transition-all shadow-sm flex flex-col items-center justify-center border border-slate-200 h-7 leading-none"
                        >
                          <Clock size={8} />
                          <span className="text-[7px] font-black uppercase tracking-tight mt-0.5">MANU</span>
                        </button>
                      </div>
                    )}
                    {prog && (
                      <button 
                        onClick={() => handleReleaseLine(line.id)}
                        className="p-1.5 text-red-500 bg-red-50 rounded-lg active:scale-95 hover:bg-red-100 transition-all border border-red-100 h-7"
                      >
                        <X className="w-3 h-3" strokeWidth={3} />
                      </button>
                    )}
                    <button 
                      onClick={() => setIsAssigning(line.id)}
                      className="p-1 px-1.5 text-blue-600 bg-blue-50 rounded-lg active:scale-95 hover:bg-blue-100 transition-all shadow-sm flex items-center gap-1 border border-blue-100 h-7"
                    >
                      <Plus className="w-3 h-3" strokeWidth={3} />
                      <span className="text-[9px] font-black uppercase tracking-tight italic">
                        {prog ? 'CHG' : 'ASS'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="p-3 grid grid-cols-2 gap-3 flex-1">
                  <div className="space-y-0 text-left">
                    <p className="text-[8px] text-slate-400 font-black uppercase tracking-widest mb-0.5">Programme</p>
                    <p className={cn(
                      "text-[10px] font-black truncate leading-tight uppercase italic",
                      prog ? "text-blue-900" : "text-slate-300"
                    )}>
                      {prog ? prog.name : '—'}
                    </p>
                  </div>
                  <div className="space-y-0 text-left">
                    <p className="text-[8px] text-slate-400 font-black uppercase tracking-widest mb-0.5">Opérateur</p>
                    <div className="flex items-center gap-1">
                      {op && <div className="w-3 h-3 rounded-full bg-slate-100 flex items-center justify-center text-[7px] font-black text-slate-400 uppercase">{op.name.charAt(0)}</div>}
                      <p className={cn(
                        "text-[10px] font-bold truncate leading-tight",
                        op ? "text-slate-800" : "text-slate-300 italic"
                      )}>
                        {op ? op.name : 'Vacent'}
                      </p>
                    </div>
                  </div>
                  
                  {line.tracksProduction !== 0 && (
                    <div className="col-span-2">
                    <div className="flex justify-between items-center bg-blue-50/40 p-2 rounded-xl border border-blue-100/50 group/prod">
                        <div>
                          <p className="text-[8px] text-slate-400 font-black uppercase tracking-widest leading-none mb-1">Production</p>
                          <p className="text-xl font-black text-blue-600 leading-none tabular-nums group-hover/prod:scale-105 transition-transform origin-left">
                            {prog ? prog.producedPallets : '0'}<span className="text-[9px] ml-1 text-blue-300 font-black">PAL.</span>
                          </p>
                        </div>
                        {prog && (
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePalletTick(line.id, prog.id);
                            }}
                            className="bg-blue-600 text-white rounded-xl px-2 py-1 flex items-center gap-1 shadow-lg shadow-blue-500/20 active:scale-90 hover:bg-blue-500 transition-all border border-blue-400"
                          >
                            <Plus size={14} strokeWidth={3} />
                            <span className="text-[9px] font-black uppercase italic tracking-tighter">AJOUTER</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {down && (
                  <div className="px-3 pb-3">
                     <div className="bg-rose-50 p-2 rounded-xl flex justify-between items-center border border-rose-100 animate-in fade-in duration-300">
                        <div className="flex items-center gap-2 text-rose-600 leading-none">
                          <Activity size={14} className="animate-pulse" />
                          <span className="text-[9px] font-black uppercase tracking-tight truncate max-w-[120px] italic">{downType?.name || 'Arrêt'}</span>
                        </div>
                        <span className="text-[9px] font-mono font-black text-white bg-rose-500 px-1.5 py-0.5 rounded shadow-sm">
                          {formatDowntimeDisplay(Math.floor((globalTimer - new Date(down.startTime).getTime()) / 1000))}
                        </span>
                      </div>
                      {lines.filter(otherL => otherL.machineId === selectedMachineId && otherL.activeDowntimeId === down.id).length > 1 && (
                        <div className="pt-2 flex justify-center">
                          <span className="bg-blue-600/10 text-blue-600 px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest flex items-center gap-1 animate-pulse">
                            <Activity size={8} /> Arrêt Groupé
                          </span>
                        </div>
                      )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </motion.div>
      )
    ) : (
      !selectedMachineId ? (
        <div className="flex flex-col items-center justify-center p-12 text-center space-y-4">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-blue-300">
             <History size={32} />
          </div>
          <div className="space-y-1">
            <h3 className="text-xl font-black text-gray-900 uppercase italic">Aucune machine sélectionnée</h3>
            <p className="text-sm text-gray-500 font-medium max-w-xs mx-auto">Veuillez sélectionner une machine dans le menu pour voir son historique.</p>
          </div>
        </div>
      ) : (
        <div className="p-2 space-y-4 max-w-full mx-auto animate-in fade-in duration-300">
              <div className="flex flex-col gap-4 px-1">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <h2 className="text-xl font-black text-gray-900 tracking-tight uppercase italic leading-none">{t('history')}</h2>
                  
                  <div className="flex bg-gray-100 p-1 rounded-xl w-full sm:w-auto shadow-inner">
                    <button 
                      onClick={() => setHistoryLogType('production')}
                      className={cn(
                        "flex-1 sm:flex-none px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                        historyLogType === 'production' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                      )}
                    >
                      {t('production_log').split(' ')[2] || 'Production'}
                    </button>
                    <button 
                      onClick={() => setHistoryLogType('downtime')}
                      className={cn(
                        "flex-1 sm:flex-none px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                        historyLogType === 'downtime' ? "bg-white text-red-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                      )}
                    >
                      {t('downtime_log').split(' ')[2] || 'Arrêts'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-1">
                  <div className="space-y-1">
                     <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('line')}</p>
                     <select 
                      value={historyLineFilter}
                      onChange={e => setHistoryLineFilter(e.target.value)}
                      className="w-full p-2.5 bg-white border border-gray-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                     >
                       <option value="">{t('all_lines')}</option>
                       {lines
                        .filter(l => l.machineId === selectedMachineId)
                        .map(l => (
                         <option key={l.id} value={l.id}>{l.name}</option>
                       ))}
                     </select>
                  </div>

                  <div className="space-y-1">
                     <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('date')}</p>
                     <input 
                      type="date"
                      value={historyDateFilter}
                      onChange={e => setHistoryDateFilter(e.target.value)}
                      className="w-full p-2 bg-white border border-gray-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm h-[38px]"
                     />
                  </div>
                </div>
              </div>

          <div className="space-y-8">
            {historyLogType === 'production' ? (
              <div className="space-y-4 animate-in fade-in zoom-in-95 duration-300">
                <h3 className="text-sm md:text-base font-black text-gray-900 flex items-center gap-2 uppercase tracking-widest">
                  <Package className="text-blue-600" size={16} />
                  {t('production_log').toUpperCase()}
                </h3>
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-gray-50 text-[8px] md:text-[9px] text-gray-400 font-black uppercase tracking-widest border-b border-gray-100">
                          <tr>
                            <th className="px-2 md:px-5 py-2 md:py-3 text-left">{t('date')}</th>
                            <th className="px-2 md:px-5 py-2 md:py-3 text-left">{t('line')}</th>
                            <th className="px-2 md:px-5 py-2 md:py-3 hidden sm:table-cell text-left">{t('operator')}</th>
                            <th className="px-2 md:px-5 py-2 md:py-3 text-center">Qté</th>
                            <th className="px-2 md:px-5 py-2 md:py-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 text-[10px] md:text-xs">
                          <AnimatePresence mode="popLayout">
                            {sortedProdLogs
                              .filter(log => {
                                const matchLine = !historyLineFilter || log.lineId === historyLineFilter;
                                const matchDate = !historyDateFilter || log.timestamp.startsWith(historyDateFilter);
                                return matchLine && matchDate;
                              })
                              .slice(0, 100).map(log => (
                                <motion.tr 
                                  key={log.id} 
                                  initial={{ opacity: 1 }}
                                  exit={{ opacity: 0, x: -20, backgroundColor: 'rgba(254, 226, 226, 0.5)' }}
                                  transition={{ duration: 0.2 }}
                                  className="hover:bg-gray-50/50"
                                >
                                  <td className="px-2 md:px-5 py-2 md:py-3 font-bold text-gray-900 whitespace-nowrap">
                                    {new Date(log.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                  </td>
                                  <td className="px-2 md:px-5 py-2 md:py-3">
                                    <p className="font-bold text-gray-700 truncate max-w-[60px] md:max-w-none">{lines.find(l => l.id === log.lineId)?.name || '—'}</p>
                                    <p className="text-[7px] md:text-[9px] font-bold text-gray-400 uppercase">{machines.find(m => m.id === log.machineId)?.name || '—'}</p>
                                  </td>
                                  <td className="px-2 md:px-5 py-2 md:py-3 font-medium text-gray-600 hidden sm:table-cell">
                                    {users.find(u => u.id === log.operatorId)?.name || '—'}
                                  </td>
                                  <td className="px-2 md:px-5 py-2 md:py-3 text-center">
                                    <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-black">{log.count}</span>
                                  </td>
                                  <td className="px-2 md:px-5 py-2 md:py-3 text-right">
                                    <div className="flex justify-end gap-1">
                                      <button onClick={() => openEditModal('prod', log)} className="text-gray-400 hover:text-blue-600 p-1 md:p-2"><Pencil className="w-3.5 h-3.5 md:w-4 md:h-4" /></button>
                                      <button onClick={() => setConfirmDelete({col: 'production_logs', id: log.id, name: `Production ${log.count} pal`})} className="text-gray-400 hover:text-red-500 p-1 md:p-2"><Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4" /></button>
                                    </div>
                                  </td>
                                </motion.tr>
                              ))}
                          </AnimatePresence>
                        </tbody>
                      </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4 animate-in fade-in zoom-in-95 duration-300">
                <h3 className="text-sm md:text-base font-black text-gray-900 flex items-center gap-2 uppercase tracking-widest">
                  <Timer className="text-orange-600" size={16} />
                  LOG DES ARRÊTS
                </h3>
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 text-[8px] md:text-[9px] text-gray-400 font-black uppercase tracking-widest border-b border-gray-100">
                        <tr>
                          <th className="px-2 md:px-5 py-2 md:py-3">Début</th>
                          <th className="px-2 md:px-5 py-2 md:py-3">Durée</th>
                          <th className="px-2 md:px-5 py-2 md:py-3">Opérateur</th>
                          <th className="px-2 md:px-5 py-2 md:py-3">Motif</th>
                          <th className="px-2 md:px-5 py-2 md:py-3 hidden sm:table-cell">Ligne</th>
                          <th className="px-2 md:px-5 py-2 md:py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-[10px] md:text-xs">
                        <AnimatePresence mode="popLayout">
                          {sortedDownLogs
                            .filter(log => {
                              const matchLine = !historyLineFilter || log.lineId === historyLineFilter;
                              const matchDate = !historyDateFilter || log.startTime.startsWith(historyDateFilter);
                              return matchLine && matchDate;
                            })
                            .slice(0, 100).map(log => (
                              <motion.tr 
                                key={log.id} 
                                initial={{ opacity: 1 }}
                                exit={{ opacity: 0, x: -20, backgroundColor: 'rgba(254, 226, 226, 0.5)' }}
                                transition={{ duration: 0.2 }}
                                className="hover:bg-gray-50/50"
                              >
                                <td className="px-2 md:px-5 py-2 md:py-3 font-bold text-gray-900">
                                  {new Date(log.startTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                </td>
                                <td className="px-2 md:px-5 py-2 md:py-3">
                                  {log.duration || !log.endTime ? (
                                    <span className="font-mono font-bold bg-blue-50 px-2 py-0.5 rounded text-blue-700 border border-blue-100">
                                      {formatDowntimeDisplay(getLogDurationSec(log))}
                                    </span>
                                  ) : <span className="text-orange-500 font-black uppercase bg-orange-50 px-2 py-0.5 rounded border border-orange-100 animate-pulse">En cours</span>}
                                </td>
                                <td className="px-2 md:px-5 py-2 md:py-3 italic">
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-5 h-5 bg-gray-100 rounded-full flex items-center justify-center text-[10px] font-black uppercase text-gray-500 border border-gray-200">
                                      {users.find(u => u.id === log.operatorId)?.name.charAt(0) || '—'}
                                    </div>
                                    <span className="font-black text-gray-600 truncate max-w-[80px] md:max-w-none">
                                      {users.find(u => u.id === log.operatorId)?.name || '—'}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-2 md:px-5 py-2 md:py-3">
                                  <div className="flex items-center gap-2">
                                    <span className="text-base">{downtimeTypes.find(t => t.id === log.typeId)?.icon || '⚠️'}</span>
                                    <p className="font-bold text-gray-700 leading-tight">{downtimeTypes.find(t => t.id === log.typeId)?.name || '—'}</p>
                                  </div>
                                </td>
                                <td className="px-2 md:px-5 py-2 md:py-3">
                                  <p className="font-bold text-gray-700">{lines.find(l => l.id === log.lineId)?.name || '—'}</p>
                                </td>
                                <td className="px-2 md:px-5 py-2 md:py-3 text-right">
                                  <div className="flex justify-end gap-1">
                                    <button onClick={() => openEditModal('down', log)} className="text-gray-400 hover:text-blue-600 p-1 md:p-2"><Pencil className="w-3.5 h-3.5 md:w-4 md:h-4" /></button>
                                    <button onClick={() => setConfirmDelete({col: 'downtime_logs', id: log.id, name: `Arrêt ${downtimeTypes.find(t => t.id === log.typeId)?.name}`})} className="text-gray-400 hover:text-red-500 p-1 md:p-2"><Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4" /></button>
                                  </div>
                                </td>
                              </motion.tr>
                            ))}
                        </AnimatePresence>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )
    )}

    {/* DELETE CONFIRMATION */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
          <div className="bg-white rounded-[32px] p-6 max-w-xs w-full space-y-4 shadow-2xl">
             <div className="w-12 h-12 bg-red-50 text-red-600 rounded-xl flex items-center justify-center mx-auto">
               <Trash2 size={24} />
             </div>
             <div className="text-center space-y-1">
               <h3 className="text-lg font-black text-gray-900 italic uppercase">Supprimer ?</h3>
               <p className="text-[11px] text-gray-500 font-medium leading-tight">Voulez-vous supprimer cet enregistrement ?<br/><span className="text-gray-900 font-bold">{confirmDelete.name}</span></p>
             </div>
             <div className="flex gap-2.5 mt-2">
                <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2.5 font-bold text-gray-400 hover:bg-gray-50 rounded-xl transition-all uppercase text-[9px] tracking-widest">Annuler</button>
                <button onClick={handleDelete} className="flex-1 py-2.5 bg-red-600 text-white font-black rounded-xl shadow-lg shadow-red-50 active:scale-95 transition-all text-[9px] tracking-widest uppercase">Supprimer</button>
             </div>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-[32px] p-6 max-w-sm w-full space-y-4 shadow-2xl border border-gray-100"
          >
            <div className="space-y-0.5">
              <h3 className="text-lg font-black text-gray-900 uppercase italic">Corriger</h3>
              <p className="text-[7px] text-gray-400 font-black uppercase tracking-widest">Enregistrement manuel</p>
            </div>

            <div className="space-y-4">
              {editModalType === 'prod' ? (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Quantité</label>
                    <input 
                      type="number"
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={editModalData.count || ''}
                      onChange={e => setEditModalData({...editModalData, count: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Date</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={editModalData.timestamp ? new Date(editModalData.timestamp).toISOString().slice(0, 16) : ''}
                      onChange={e => setEditModalData({...editModalData, timestamp: new Date(e.target.value).toISOString()})}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Motif</label>
                    <select 
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={editModalData.typeId || ''}
                      onChange={e => setEditModalData({...editModalData, typeId: e.target.value})}
                    >
                      {downtimeTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Début</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={editModalData.startTime ? format(new Date(editModalData.startTime), "yyyy-MM-dd'T'HH:mm") : ''}
                      onChange={e => {
                        try {
                          const localVal = e.target.value;
                          if (!localVal) return;
                          const newStart = new Date(localVal).toISOString();
                          const durMs = editModalData.endTime ? (new Date(editModalData.endTime).getTime() - new Date(newStart).getTime()) : (editModalData.duration * 1000 || 0);
                          setEditModalData({...editModalData, startTime: newStart, duration: Math.floor(durMs / 1000)});
                        } catch (err) {
                          console.error('Invalid date', err);
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Fin</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={editModalData.endTime ? format(new Date(editModalData.endTime), "yyyy-MM-dd'T'HH:mm") : ''}
                      onChange={e => {
                        try {
                          const localVal = e.target.value;
                          if (!localVal) return;
                          const newEnd = new Date(localVal).toISOString();
                          const durMs = new Date(newEnd).getTime() - new Date(editModalData.startTime).getTime();
                          setEditModalData({...editModalData, endTime: newEnd, duration: Math.floor(durMs / 1000)});
                        } catch (err) {
                          console.error('Invalid date', err);
                        }
                      }}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <button onClick={() => setIsEditModalOpen(false)} className="flex-1 py-4 font-bold text-gray-500 hover:bg-gray-100 rounded-2xl transition-all uppercase text-[10px] tracking-widest">Annuler</button>
              <button 
                onClick={handleEditSubmit}
                className="flex-1 py-4 bg-blue-600 text-white font-black rounded-2xl shadow-xl shadow-blue-100 transition-all uppercase text-[10px] tracking-widest"
              >
                Sauvegarder
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* ASSIGN MODAL */}
      {isAssigning && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            <div className="p-4 bg-blue-600 text-white flex justify-between items-center">
              <div className="space-y-0.5">
                <h2 className="text-lg font-black tracking-tight uppercase leading-none italic">{t('assign_program')}</h2>
                <p className="text-blue-100 text-[8px] font-black uppercase tracking-widest opacity-80 leading-none">
                  {t('line')}: {lines.find(l => l.id === isAssigning)?.name}
                </p>
              </div>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              <div className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-200">
                  <h3 className="text-[10px] font-black text-gray-700 uppercase tracking-widest mb-3">{t('new_program')}</h3>
                  <div className="flex flex-col gap-2">
                    <input 
                      type="text"
                      value={newProgName}
                      onChange={e => setNewProgName(e.target.value)}
                      placeholder={t('program_name') + "..."}
                      className="w-full p-3 bg-white rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-sm"
                    />
                    <div className="space-y-1">
                      <label className="text-[8px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('technical_parameters')}</label>
                      <textarea 
                        value={newProgParams}
                        onChange={e => setNewProgParams(e.target.value)}
                        placeholder="Vitesse, Pression, etc..."
                        rows={2}
                        className="w-full p-3 bg-white rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-xs"
                      />
                    </div>
                    <button 
                      disabled={!newProgName}
                      onClick={handleAssignProgramme}
                      className="w-full py-3 bg-blue-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest disabled:opacity-50 active:scale-95 transition-all shadow-md shadow-blue-100"
                    >
                      {t('save_assign').toUpperCase()}
                    </button>
                  </div>
                </div>


              </div>
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button 
                onClick={() => {
                  setIsAssigning(null);
                  setShowCreateNew(false);
                }}
                className="flex-1 py-4 font-bold text-gray-500 hover:bg-gray-100 rounded-2xl transition-colors uppercase text-xs tracking-widest"
              >
                {t('cancel')}
              </button>
              {showCreateNew && (
                <button 
                  onClick={handleAssignProgramme}
                  className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-200 uppercase text-xs tracking-widest active:scale-95 transition-all"
                >
                  Créer & Assigner
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
      {/* DOWNTIME PICKER MODAL */}
      {declaringDowntimeLineId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl flex flex-col"
          >
            <div className="p-6 bg-orange-600 text-white">
              <h2 className="text-xl font-black tracking-tight uppercase italic">{t('machine_stop')}</h2>
              <p className="text-orange-100 text-[10px] font-bold uppercase tracking-widest opacity-80">
                {declaringDowntimeLineId === 'global' ? t('general_stop') : `${t('line')} ${lines.find(l => l.id === declaringDowntimeLineId)?.name}`}
              </p>
            </div>
            <div className="p-4 grid grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto">
              {downtimeTypes.map(type => (
                <button
                  key={type.id}
                  onClick={() => handleStartDowntime(declaringDowntimeLineId, type.id)}
                  className="p-4 border border-orange-50 rounded-2xl flex flex-col items-center gap-2 hover:bg-orange-50 transition-all group shadow-sm bg-white"
                >
                  <span className="text-2xl group-hover:scale-110 transition-transform">{type.icon}</span>
                  <span className="text-[9px] font-black uppercase text-gray-700 text-center leading-tight">{type.name}</span>
                </button>
              ))}
            </div>
            <div className="p-4 bg-gray-50 flex gap-3">
              <button 
                onClick={() => setDeclaringDowntimeLineId(null)}
                className="w-full py-4 text-xs font-black uppercase tracking-widest text-gray-400 hover:bg-gray-100 rounded-2xl"
              >
                Annuler
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* MANUAL STOP MODAL */}
      {showManualStopModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl flex flex-col"
          >
            <div className="p-6 bg-blue-600 text-white">
              <h2 className="text-xl font-black tracking-tight uppercase italic">Saisie Manuelle</h2>
              <p className="text-blue-100 text-[10px] font-bold uppercase tracking-widest leading-none mt-1">
                Ligne: {lines.find(l => l.id === manualStopForm.lineId)?.name}
              </p>
            </div>
            <div className="p-4 space-y-4">
               <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Début</label>
                    <input 
                      type="datetime-local"
                      min={format(startOfDay(new Date()), "yyyy-MM-dd'T'HH:mm")}
                      max={format(endOfDay(new Date()), "yyyy-MM-dd'T'HH:mm")}
                      className="w-full p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-black text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      value={manualStopForm.startTime}
                      onChange={e => setManualStopForm({...manualStopForm, startTime: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Fin</label>
                    <input 
                      type="datetime-local"
                      min={format(startOfDay(new Date()), "yyyy-MM-dd'T'HH:mm")}
                      max={format(endOfDay(new Date()), "yyyy-MM-dd'T'HH:mm")}
                      className="w-full p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-black text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      value={manualStopForm.endTime}
                      onChange={e => setManualStopForm({...manualStopForm, endTime: e.target.value})}
                    />
                  </div>
               </div>

               <div className="flex justify-between items-center bg-blue-50/50 p-2 rounded-xl border border-blue-100">
                  <p className="text-[8px] font-black text-blue-400 uppercase tracking-widest leading-none">Durée totale</p>
                  <p className="text-sm font-black text-blue-900 font-mono italic">{calculateManualDuration()}</p>
               </div>

               <div className="space-y-1">
                 <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Motif de l'arrêt</label>
                 <select 
                   className="w-full p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-black text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                   value={manualStopForm.typeId}
                   onChange={e => setManualStopForm({...manualStopForm, typeId: e.target.value})}
                 >
                   <option value="">Sélectionner un motif...</option>
                   {downtimeTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                 </select>
               </div>

               <div className="space-y-1">
                 <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest ml-1">Description / Commentaire</label>
                 <textarea 
                   className="w-full p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-bold text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                   placeholder="..."
                   rows={2}
                   value={manualStopForm.description}
                   onChange={e => setManualStopForm({...manualStopForm, description: e.target.value})}
                 />
               </div>
            </div>
            <div className="p-4 bg-gray-50 flex gap-3">
              <button 
                onClick={() => setShowManualStopModal(false)}
                className="flex-1 py-4 text-xs font-black uppercase tracking-widest text-gray-400 hover:bg-gray-100 rounded-2xl transition-all"
              >
                Annuler
              </button>
              <button 
                onClick={() => handleManualStop(manualStopForm)}
                className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-200 uppercase text-xs tracking-widest active:scale-95 transition-all"
              >
                Valider Saisie
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {/* FEATURE INFO MODAL */}
      <AnimatePresence>
        {showFeatureInfo && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-[2.5rem] w-full max-w-2xl shadow-3xl overflow-hidden"
            >
              <div className="p-8 space-y-8 max-h-[85vh] overflow-y-auto custom-scrollbar">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                      <Activity size={24} className="text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-gray-900 tracking-tighter uppercase italic leading-none mb-1">Arrêts Groupés Intelligents</h2>
                      <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.2em]">Pilot Hub Feature</p>
                    </div>
                  </div>
                  <button onClick={() => setShowFeatureInfo(false)} className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 hover:text-gray-900 transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-6">
                  <section className="p-5 bg-blue-50 rounded-2xl border border-blue-100">
                    <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                       <TrendingUp size={14} /> Détection de Proximité Temporelle
                    </h4>
                    <p className="text-xs font-bold text-gray-700 leading-relaxed italic">
                      "Comment le système identifie que des arrêts sur différentes lignes sont liés."
                    </p>
                    <p className="text-xs text-gray-600 mt-2 leading-relaxed">
                      L'algorithme AgroSync analyse les flags d'arrêts en temps réel. Si plusieurs lignes déclarent le même incident dans une fenêtre critique (moins de 2 minutes), le système fusionne ces données pour refléter la réalité de la panne machine globale.
                    </p>
                  </section>

                  <section className="p-5 bg-gray-50 rounded-2xl border border-gray-100">
                    <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                       <Users size={14} /> Propagation de l'Action de Groupe
                    </h4>
                    <p className="text-xs font-bold text-gray-700 leading-relaxed italic">
                      "Le premier opérateur qui déclare l'arrêt propage l'état."
                    </p>
                    <p className="text-xs text-gray-600 mt-2 leading-relaxed">
                      Fini les doubles saisies. Dès qu'un arrêt est qualifié sur une ligne, le système peut propager automatiquement cet état aux autres lignes de la machine. Cela assure une synchronisation parfaite entre les opérateurs et le Pilot.
                    </p>
                  </section>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-5 bg-emerald-50 rounded-2xl border border-emerald-100">
                      <h4 className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <Box size={14} /> Consolidation
                      </h4>
                      <p className="text-[11px] text-emerald-800/80 leading-relaxed font-bold">
                        Un seul événement en base de données pour toute la machine. Rapports simplifiés et statistiques OEE fiables.
                      </p>
                    </div>
                    <div className="p-5 bg-orange-50 rounded-2xl border border-orange-100">
                      <h4 className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <Activity size={14} /> Avantage Industriel
                      </h4>
                      <p className="text-[11px] text-orange-800/80 leading-relaxed font-bold">
                        Réduction de 40% de la charge administrative des opérateurs et précision accrue du suivi des temps d'arrêt.
                      </p>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setShowFeatureInfo(false)}
                  className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl active:scale-95 transition-all"
                >
                  FERMER
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
