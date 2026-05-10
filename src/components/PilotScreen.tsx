import { useState, useEffect } from 'react';
import { localApi } from '../lib/localApi';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useLanguage } from '../contexts/LanguageContext';
import { DowntimeLog, Shift } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Monitor, LayoutGrid, Package, Users, Activity, ExternalLink, Plus, History, Timer, Pencil, Trash2, Menu, X, ArrowLeft } from 'lucide-react';
import { cn, formatDuration } from '../lib/utils';
import { getCurrentShiftId } from '../lib/shiftUtils';

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

  const [historyLineFilter, setHistoryLineFilter] = useState<string>('');
  const [historyDateFilter, setHistoryDateFilter] = useState<string>('');
  const [historyLogType, setHistoryLogType] = useState<'production' | 'downtime'>('production');
  const [activeTab, setActiveTab] = useState<'monitor' | 'history'>('monitor');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [selectedMachineId, setSelectedMachineId] = useState<string>('');
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
  const [declaringDowntimeLineId, setDeclaringDowntimeLineId] = useState<string | null>(null);

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

  const handleStartDowntime = async (lineId: string | null, typeId: string) => {
    if (!user || !selectedMachineId) return;
    try {
      const machineLines = lines.filter(l => l.machineId === selectedMachineId);
      const startTime = new Date().toISOString();
      const currentShiftId = getCurrentShiftId(shifts);

      for (const line of machineLines) {
        const log = await localApi.addDoc('downtime_logs', {
          machineId: selectedMachineId,
          lineId: line.id,
          typeId,
          operatorId: user.id,
          shiftId: currentShiftId,
          startTime,
        });

        await localApi.updateDoc('lines', line.id, {
          activeDowntimeId: log.id,
          status: 'STOPPED'
        });
      }
      
      setDeclaringDowntimeLineId(null);
    } catch (e) {
      console.error(e);
      alert('Erreur lors de la déclaration de l\'arrêt machine');
    }
  };

  const toggleLineActive = async (lineId: string, currentStatus: boolean | undefined) => {
    try {
      await localApi.updateDoc('lines', lineId, { isActive: !currentStatus });
    } catch (e) {
      console.error(e);
      alert('Erreur lors du changement de statut de la ligne');
    }
  };

  // Sort and filter logs for the selected machine
  const sortedProdLogs = [...prodLogs]
    .filter(log => log.machineId === selectedMachineId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const sortedDownLogs = [...downLogs]
    .filter(log => log.machineId === selectedMachineId)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  // Filter machines available for this pilot (not assigned or assigned to them)
  const availableMachines = machines.filter(m => !m.currentPilotId || m.currentPilotId === user?.id);

  // Filter programmes that are already assigned to other lines
  const assignedProgIds = lines.map(l => l.currentProgrammeId).filter(Boolean);
  const availableProgs = programmes.filter(p => p.machineId === selectedMachineId && p.status === 'ACTIVE' && !assignedProgIds.includes(p.id));

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
              onClick={() => setActiveTab(activeTab === 'monitor' ? 'history' : 'monitor')}
              className={cn(
                "flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                activeTab === 'history' ? "bg-blue-600 text-white shadow-lg" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              )}
            >
              {activeTab === 'monitor' ? <History size={14} /> : <Monitor size={14} />}
              {activeTab === 'monitor' ? t('history') : t('monitor')}
            </button>
            <button onClick={handleLogout} className="text-[10px] font-black text-gray-400 uppercase tracking-widest border border-gray-200 px-2 py-1 rounded">{t('logout')}</button>
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

      {activeTab === 'monitor' ? (
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
          className="p-1 sm:p-4 space-y-1 sm:space-y-4 max-w-full mx-auto grid grid-cols-1 md:grid-cols-2 gap-1 sm:gap-4"
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
                className={cn(
                  "card transition-colors flex flex-col overflow-hidden",
                  line.isActive === false ? "border-l-4 border-red-500 bg-red-50/20" : "border-l-4 border-slate-200 hover:border-blue-500"
                )}
              >
                <div className="px-2 py-1.5 sm:p-4 flex justify-between items-center border-b border-slate-50 shrink-0">
                  <div className="leading-none">
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-black text-[10px] sm:text-sm text-slate-900">{line.name}</h3>
                      {line.isActive === false && <span className="text-[7px] font-black text-red-600 bg-red-100 px-1 rounded uppercase tracking-widest border border-red-200 animate-pulse">{t('out_of_service')}</span>}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 sm:mt-2">
                       <span className={cn(
                        "px-1 py-0.5 rounded-full text-[6px] sm:text-[9px] font-black uppercase tracking-widest flex items-center gap-0.5",
                        line.status === 'RUNNING' ? "bg-status-running-bg text-status-running-text" :
                        line.status === 'STOPPED' ? "bg-status-stopped-bg text-status-stopped-text" : "bg-status-idle-bg text-status-idle-text"
                      )}>
                        <span className={cn(
                          "w-1 h-1 rounded-full",
                          line.status === 'RUNNING' ? "bg-green-600 animate-pulse" : line.status === 'STOPPED' ? "bg-red-600" : "bg-slate-400"
                        )} />
                        {line.status === 'RUNNING' ? t('running') : 
                         line.status === 'STOPPED' ? t('stopped') : t('idle')}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => toggleLineActive(line.id, line.isActive !== false)}
                      className={cn(
                        "p-1 sm:p-1.5 rounded-lg active:scale-95 transition-all shadow-sm flex items-center gap-1 border shrink-0 h-6 sm:h-auto",
                        line.isActive !== false ? "text-orange-600 bg-orange-50 border-orange-100" : "text-green-600 bg-green-50 border-green-100"
                      )}
                      title={line.isActive !== false ? t('deactivate') : t('activate')}
                    >
                      {line.isActive !== false ? <Timer size={10} /> : <Activity size={10} />}
                      <span className="text-[7px] sm:text-[9px] font-black uppercase tracking-tight">
                        {line.isActive !== false ? t('deactivate') : t('activate')}
                      </span>
                    </button>
                    {prog && (
                      <button 
                        onClick={() => handleReleaseLine(line.id)}
                        className="p-1 sm:p-2 text-red-600 bg-red-50 rounded-lg active:scale-95 hover:bg-red-100 transition-all shadow-sm flex items-center gap-1 border border-red-100 shrink-0 h-6 sm:h-auto"
                        title="Libérer la ligne"
                      >
                        <X className="w-2.5 h-2.5 sm:w-4 sm:h-4" strokeWidth={3} />
                      </button>
                    )}
                    <button 
                      onClick={() => setIsAssigning(line.id)}
                      className="p-1 sm:p-2 text-blue-600 bg-blue-50 rounded-lg active:scale-95 hover:bg-blue-100 transition-all shadow-sm flex items-center gap-1 border border-blue-100 shrink-0 h-6 sm:h-auto"
                    >
                      <Plus className="w-2.5 h-2.5 sm:w-4 sm:h-4" strokeWidth={3} />
                      <span className="text-[8px] sm:text-[11px] font-black uppercase tracking-tight">
                        {prog ? 'CHG.' : 'ASS.'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="p-1.5 sm:p-4 grid grid-cols-2 gap-1 sm:gap-4 flex-1">
                  <div className="space-y-0 text-left leading-none">
                    <p className="text-[7px] sm:text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-0.5">Prog.</p>
                    <p className={cn(
                      "text-[9px] sm:text-sm font-black truncate",
                      prog ? "text-blue-900" : "text-slate-300 italic"
                    )}>
                      {prog ? prog.name : '—'}
                    </p>
                  </div>
                  <div className="space-y-0 text-left leading-none">
                    <p className="text-[7px] sm:text-[9px] text-slate-400 font-bold uppercase tracking-widest mb-0.5">Op.</p>
                    <p className={cn(
                      "text-[9px] sm:text-sm font-bold truncate",
                      op ? "text-slate-800" : "text-slate-300 italic"
                    )}>
                      {op ? op.name : '—'}
                    </p>
                  </div>
                  
                  {line.tracksProduction !== 0 && (
                    <div className="col-span-2 mt-0.5">
                      <div className="flex justify-between items-center bg-blue-50/20 p-1 sm:p-4 rounded-lg border border-blue-100/10">
                        <p className="text-[7px] sm:text-[9px] text-slate-400 font-bold uppercase tracking-tight">Produit</p>
                        <p className="text-sm sm:text-3xl font-black text-blue-600 leading-none">
                          {prog ? prog.producedPallets : '0'}<span className="text-[7px] ml-0.5 text-slate-300 not-italic">P.</span>
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {down && (
                  <div className="px-1.5 pb-1.5">
                     <div className="bg-status-downtime-bg/40 p-1 rounded-lg flex justify-between items-center border border-orange-100/50">
                        <div className="flex items-center gap-1 text-status-downtime-text leading-none">
                          <Activity size={10} className="animate-pulse" />
                          <span className="text-[8px] font-black uppercase tracking-tight truncate max-w-[80px]">{downType?.name || 'Arrêt'}</span>
                        </div>
                        <span className="text-[7px] font-mono font-bold text-orange-800 bg-white/40 px-1 rounded border border-orange-100/30">
                              {new Date(down.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
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
                                  {log.duration ? (
                                    <span className="font-mono font-bold bg-gray-100 px-2 py-0.5 rounded text-gray-700">
                                      {formatDuration(log.duration)}
                                    </span>
                                  ) : <span className="text-orange-500 font-black uppercase">En cours</span>}
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
                      value={editModalData.startTime ? new Date(editModalData.startTime).toISOString().slice(0, 16) : ''}
                      onChange={e => {
                        const newStart = new Date(e.target.value).toISOString();
                        const dur = editModalData.endTime ? (new Date(editModalData.endTime).getTime() - new Date(newStart).getTime()) : editModalData.duration;
                        setEditModalData({...editModalData, startTime: newStart, duration: dur});
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Fin</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={editModalData.endTime ? new Date(editModalData.endTime).toISOString().slice(0, 16) : ''}
                      onChange={e => {
                        const newEnd = new Date(e.target.value).toISOString();
                        const dur = new Date(newEnd).getTime() - new Date(editModalData.startTime).getTime();
                        setEditModalData({...editModalData, endTime: newEnd, duration: dur});
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
              <button 
                onClick={() => {
                  const line = lines.find(l => l.id === isAssigning);
                  if (line) toggleLineActive(line.id, line.isActive !== false);
                }}
                className={cn(
                  "px-3 py-1.5 rounded-full font-black text-[8px] uppercase tracking-widest border transition-all active:scale-95",
                  lines.find(l => l.id === isAssigning)?.isActive !== false 
                    ? "bg-green-500/20 border-green-500/50 text-green-100" 
                    : "bg-red-500/20 border-red-500/50 text-red-100"
                )}
              >
                {lines.find(l => l.id === isAssigning)?.isActive !== false ? t('active_line') : t('inactive_line')}
              </button>
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

                <div className="space-y-3">
                  <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('or_choose_active')}</h3>
                  {availableProgs.length > 0 ? (
                    <div className="grid gap-2">
                      {availableProgs.map(p => (
                        <button
                          key={p.id}
                          onClick={() => handleSelectExistingProgramme(p.id)}
                          className="w-full p-4 bg-white hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-2xl text-left transition-all group flex justify-between items-center shadow-sm"
                        >
                          <div>
                            <p className="font-bold text-gray-900 group-hover:text-blue-700">{p.name}</p>
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none mt-1">{t('program_ready')}</p>
                          </div>
                          <div className="w-8 h-8 bg-white border border-gray-100 rounded-full flex items-center justify-center text-gray-300 group-hover:text-blue-500 group-hover:border-blue-200 transition-all">
                            <Plus size={16} />
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center bg-gray-50 border border-dashed border-gray-200 rounded-2xl italic text-gray-400 text-xs">
                      {t('no_program_available')}
                    </div>
                  )}
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
                {t('general_stop')}
              </p>
            </div>
            <div className="p-4 grid grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto">
              {downtimeTypes.map(type => (
                <button
                  key={type.id}
                  onClick={() => handleStartDowntime(null, type.id)}
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
    </div>
  );
}
