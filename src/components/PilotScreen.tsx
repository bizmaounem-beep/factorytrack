import { useState, useEffect } from 'react';
import { localApi } from '../lib/localApi';
import { useAuth } from '../contexts/AuthContext';
import { Machine, Line, Programme, User as AppUser, DowntimeType, DowntimeLog, ProductionLog } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Monitor, LayoutGrid, Package, Users, Activity, ExternalLink, Plus, History, Timer, Pencil, Trash2, Menu, X } from 'lucide-react';
import { cn, formatDuration } from '../lib/utils';

export default function PilotScreen() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'monitor' | 'history'>('monitor');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState<string>('');
  const [lines, setLines] = useState<Line[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [downtimeTypes, setDowntimeTypes] = useState<DowntimeType[]>([]);
  const [activeDowntimes, setActiveDowntimes] = useState<Record<string, DowntimeLog>>({});
  const [prodLogs, setProdLogs] = useState<ProductionLog[]>([]);
  const [downLogs, setDownLogs] = useState<DowntimeLog[]>([]);

  const [isAssigning, setIsAssigning] = useState<string | null>(null);
  const [showCreateNew, setShowCreateNew] = useState(false);
  const [newProgName, setNewProgName] = useState('');
  const [newProgTarget, setNewProgTarget] = useState('100');

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editModalType, setEditModalType] = useState<'prod' | 'down'>('prod');
  const [editModalData, setEditModalData] = useState<any>({});
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{col: string, id: string, name: string} | null>(null);

  useEffect(() => {
    const u1 = localApi.onSnapshot('machines', setMachines);
    const u2 = localApi.onSnapshot('users', setUsers);
    const u3 = localApi.onSnapshot('downtime_types', setDowntimeTypes);
    const u4 = localApi.onSnapshot('production_logs', setProdLogs);
    const u5 = localApi.onSnapshot('downtime_logs', setDownLogs);
    const u6 = localApi.onSnapshot('lines', setLines);
    const u7 = localApi.onSnapshot('programmes', setProgrammes);
    
    return () => {
      u1(); u2(); u3(); u4(); u5(); u6(); u7();
    };
  }, []);

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
    if (!isAssigning || !newProgName || !newProgTarget) return;

    const target = parseInt(newProgTarget);
    if (isNaN(target)) return;

    // Create new programme
    const newProg = {
      name: newProgName,
      machineId: selectedMachineId,
      lineId: isAssigning,
      targetPallets: target,
      producedPallets: 0,
      status: 'ACTIVE' as const,
      createdAt: new Date().toISOString()
    };
    const progRef = await localApi.addDoc('programmes', newProg);

    // Update line
    await localApi.updateDoc('lines', isAssigning, {
      currentProgrammeId: progRef.id,
      status: 'IDLE'
    });

    setIsAssigning(null);
    setShowCreateNew(false);
    setNewProgName('');
    setNewProgTarget('100');
  };

  const handleSelectExistingProgramme = async (progId: string) => {
    if (!isAssigning) return;
    await localApi.updateDoc('lines', isAssigning, {
      currentProgrammeId: progId,
      status: 'IDLE'
    });
    setIsAssigning(null);
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

  // Filter logs for the selected machine
  const filteredProdLogs = prodLogs.filter(log => log.machineId === selectedMachineId);
  const filteredDownLogs = downLogs.filter(log => log.machineId === selectedMachineId);

  // Filter machines available for this pilot (not assigned or assigned to them)
  const availableMachines = machines.filter(m => !m.currentPilotId || m.currentPilotId === user?.id);

  // Filter programmes that are already assigned to other lines
  const assignedProgIds = lines.map(l => l.currentProgrammeId).filter(Boolean);
  const availableProgs = programmes.filter(p => p.machineId === selectedMachineId && !assignedProgIds.includes(p.id));

  return (
    <div className="min-h-screen bg-[#F3F4F6] pb-20">
      {/* MOBILE HEADER */}
      <header className="sm:hidden bg-white border-b border-gray-200 px-4 py-3 flex justify-between items-center sticky top-0 z-40 shadow-sm">
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
        >
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-1.5 rounded-lg text-white">
            <Monitor size={18} />
          </div>
          <h1 className="font-black text-lg tracking-tighter text-gray-900 leading-none">PILOT<span className="text-blue-600">CLOUD</span></h1>
        </div>
      </header>

      {/* MOBILE SLIDING MENU */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 sm:hidden"
            />
            
            {/* Drawer */}
            <motion.aside 
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-[280px] bg-white z-50 p-6 flex flex-col gap-8 shadow-2xl sm:hidden"
            >
              <div className="flex items-center gap-3 px-2">
                <div className="bg-blue-600 p-2 rounded-lg text-white">
                  <Monitor size={20} />
                </div>
                <h1 className="font-black text-xl tracking-tighter text-gray-900 leading-none capitalize italic">PILOT<br/><span className="text-blue-600">CLOUD</span></h1>
              </div>
              
              <nav className="flex flex-col gap-2 flex-1">
                <button
                  onClick={() => { setActiveTab('monitor'); setIsMobileMenuOpen(false); }}
                  className={cn(
                    "flex items-center gap-4 px-4 py-3.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                    activeTab === 'monitor' ? "bg-blue-600 text-white shadow-lg" : "text-gray-400 hover:bg-gray-50"
                  )}
                >
                  <Monitor size={20} />
                  Machine Monitor
                </button>
                <button
                  onClick={() => { setActiveTab('history'); setIsMobileMenuOpen(false); }}
                  className={cn(
                    "flex items-center gap-4 px-4 py-3.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                    activeTab === 'history' ? "bg-blue-600 text-white shadow-lg" : "text-gray-400 hover:bg-gray-50"
                  )}
                >
                  <History size={20} />
                  Historique
                </button>

                <div className="mt-auto pt-8 border-t border-gray-100">
                  <button 
                    onClick={handleLogout}
                    className="flex items-center gap-4 px-4 py-3.5 rounded-xl text-xs font-black uppercase tracking-widest text-red-500 hover:bg-red-50 w-full transition-colors"
                  >
                    <Trash2 size={20} />
                    Logout
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
              {activeTab === 'monitor' ? 'Historique' : 'Monitor'}
            </button>
            <button onClick={handleLogout} className="text-[10px] font-black text-gray-400 uppercase tracking-widest border border-gray-200 px-2 py-1 rounded">Logout</button>
          </div>
        </div>
        
        {activeTab === 'monitor' && (
          <select 
            value={selectedMachineId}
            onChange={e => handleMachineSelect(e.target.value)}
            className="w-full p-3 bg-gray-50 rounded-xl font-bold border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-inner text-gray-700"
          >
            <option value="">Sélectionner une machine...</option>
            {availableMachines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
      </div>

      {/* Mobile-only machine selector when in monitor tab */}
      {activeTab === 'monitor' && (
        <div className="p-4 sm:hidden bg-white border-b border-gray-100">
          <select 
            value={selectedMachineId}
            onChange={e => handleMachineSelect(e.target.value)}
            className="w-full p-3 bg-gray-50 rounded-xl font-bold border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-inner text-gray-700"
          >
            <option value="">Sélectionner une machine...</option>
            {availableMachines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      )}

      {activeTab === 'monitor' ? (
        !selectedMachineId ? (
        <div className="flex flex-col items-center justify-center p-12 text-center space-y-4">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-blue-300">
             <LayoutGrid size={32} />
          </div>
          <p className="text-gray-400 font-bold uppercase text-xs tracking-widest">Choisir une machine pour monitorer les lignes</p>
        </div>
      ) : (
        <div className="p-4 space-y-4 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
          {lines.filter(l => l.machineId === selectedMachineId).map(line => {
            const prog = programmes.find(p => p.id === line.currentProgrammeId);
            const op = users.find(u => u.id === line.currentOperatorId);
            const down = activeDowntimes[line.id];
            const downType = downtimeTypes.find(t => t.id === down?.typeId);

            return (
              <motion.div 
                key={line.id}
                layout
                className="card border-l-4 border-gray-200 hover:border-blue-500 transition-colors flex flex-col"
              >
                <div className="p-4 flex justify-between items-start border-b border-gray-50">
                  <div>
                    <h3 className="font-bold text-gray-900 leading-none">{line.name}</h3>
                    <div className="flex items-center gap-2 mt-2">
                       <span className={cn(
                        "px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1",
                        line.status === 'RUNNING' ? "bg-status-running-bg text-status-running-text" :
                        line.status === 'STOPPED' ? "bg-status-stopped-bg text-status-stopped-text" : "bg-status-idle-bg text-status-idle-text"
                      )}>
                        <span className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          line.status === 'RUNNING' ? "bg-green-600 animate-pulse" : line.status === 'STOPPED' ? "bg-red-600" : "bg-gray-400"
                        )} />
                        {line.status}
                      </span>
                    </div>
                  </div>
                  <button 
                    onClick={() => setIsAssigning(line.id)}
                    className="p-2 text-blue-600 bg-blue-50 rounded-lg active:scale-95 hover:bg-blue-100 transition-all shadow-sm flex items-center gap-1 border border-blue-100"
                  >
                    <Plus size={16} strokeWidth={3} />
                    <span className="text-[10px] font-black uppercase tracking-tight">
                      {prog ? 'Changer' : 'Assigner'}
                    </span>
                  </button>
                </div>

                <div className="p-3 sm:p-4 grid grid-cols-2 gap-3 sm:gap-4 flex-1">
                  <div className="space-y-0.5">
                    <p className="text-[8px] sm:text-[9px] text-gray-400 font-black uppercase tracking-widest">Programme Actif</p>
                    <p className={cn(
                      "text-xs sm:text-sm font-black truncate",
                      prog ? "text-blue-900" : "text-gray-300 italic"
                    )}>
                      {prog ? prog.name : 'Aucun'}
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[8px] sm:text-[9px] text-gray-400 font-black uppercase tracking-widest">Opérateur</p>
                    <p className={cn(
                      "text-xs sm:text-sm font-bold truncate",
                      op ? "text-gray-800" : "text-gray-300 italic"
                    )}>
                      {op ? op.name : 'Non assigné'}
                    </p>
                  </div>
                  
                  <div className="col-span-2 space-y-2 mt-1">
                    <div className="flex justify-between items-end">
                      <div className="space-y-0">
                        <p className="text-[8px] sm:text-[9px] text-gray-400 font-black uppercase tracking-widest">Progression</p>
                        <div className="flex items-baseline gap-1">
                          <p className="text-xl sm:text-2xl font-black text-blue-600 leading-none">
                            {prog ? prog.producedPallets : '0'}
                          </p>
                          <p className="text-[10px] font-bold text-gray-400">/ {prog ? prog.targetPallets : '0'}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-base sm:text-lg font-black text-blue-900 leading-none">
                           {prog ? `${Math.round((prog.producedPallets / prog.targetPallets) * 100)}%` : '0%'}
                        </p>
                      </div>
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="w-full h-1.5 sm:h-2 bg-gray-100 rounded-full overflow-hidden border border-gray-200/50 shadow-inner">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: prog ? `${Math.min((prog.producedPallets / prog.targetPallets) * 100, 100)}%` : '0%' }}
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          line.status === 'RUNNING' ? "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" : "bg-gray-400"
                        )}
                      />
                    </div>
                  </div>
                </div>

                {down && (
                  <div className="bg-status-downtime-bg p-3 mx-4 mb-4 rounded-lg flex justify-between items-center border border-orange-100 shadow-inner">
                    <div className="flex items-center gap-2 text-status-downtime-text">
                      <Activity size={14} className="animate-pulse" />
                      <span className="text-xs font-bold uppercase tracking-tighter">{downType?.name || 'Arrêt'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                       <span className="text-[10px] font-mono font-bold text-orange-800 bg-white/40 px-2 py-0.5 rounded">
                          Depuis {new Date(down.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                       </span>
                       <button 
                         onClick={() => setConfirmDelete({col: 'downtime_logs', id: down.id, name: `Arrêt actif: ${downType?.name}`})}
                         className="p-1.5 text-red-600 bg-white/40 rounded hover:bg-red-50 transition-colors"
                         title="Supprimer cet arrêt"
                       >
                         <Trash2 size={12} />
                       </button>
                    </div>
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
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
        <div className="p-4 space-y-8 max-w-5xl mx-auto animate-in fade-in duration-500">
          <div className="flex justify-between items-end">
            <div>
              <h2 className="text-2xl font-black tracking-tight text-gray-900 uppercase">Historique Production & Arrêts</h2>
              <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">Gérez les données enregistrées</p>
            </div>
          </div>

          <div className="space-y-12">
            {/* Production History */}
            <div className="space-y-4">
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Package className="text-blue-600" size={18} />
                PRODUCTION
              </h3>
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 text-[8px] md:text-[9px] text-gray-400 font-black uppercase tracking-widest border-b border-gray-100">
                        <tr>
                          <th className="px-3 md:px-5 py-3 md:py-4">Moment</th>
                          <th className="px-3 md:px-5 py-3 md:py-4">Ligne</th>
                          <th className="px-3 md:px-5 py-3 md:py-4 hidden sm:table-cell">Opérateur</th>
                          <th className="px-3 md:px-5 py-3 md:py-4 text-center">Qté</th>
                          <th className="px-3 md:px-5 py-3 md:py-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-[10px] md:text-xs">
                        <AnimatePresence mode="popLayout">
                          {filteredProdLogs.slice(0, 50).map(log => (
                            <motion.tr 
                              key={log.id} 
                              initial={{ opacity: 1 }}
                              exit={{ opacity: 0, x: -20, backgroundColor: 'rgba(254, 226, 226, 0.5)' }}
                              transition={{ duration: 0.2 }}
                              className="hover:bg-gray-50/50"
                            >
                              <td className="px-3 md:px-5 py-3 md:py-4 font-bold text-gray-900">
                                {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="px-3 md:px-5 py-3 md:py-4">
                                <p className="font-bold text-gray-700 truncate max-w-[60px] md:max-w-none">{lines.find(l => l.id === log.lineId)?.name || '—'}</p>
                                <p className="text-[7px] md:text-[9px] font-bold text-gray-400 uppercase">{machines.find(m => m.id === log.machineId)?.name || '—'}</p>
                              </td>
                              <td className="px-3 md:px-5 py-3 md:py-4 font-medium text-gray-600 hidden sm:table-cell">
                                {users.find(u => u.id === log.operatorId)?.name || '—'}
                              </td>
                              <td className="px-3 md:px-5 py-3 md:py-4 text-center">
                                <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-black">{log.count}</span>
                              </td>
                              <td className="px-3 md:px-5 py-3 md:py-4 text-right">
                                <div className="flex justify-end gap-1">
                                  <button onClick={() => openEditModal('prod', log)} className="text-gray-400 hover:text-blue-600 p-1 md:p-2"><Pencil size={14} md:size={16} /></button>
                                  <button onClick={() => setConfirmDelete({col: 'production_logs', id: log.id, name: `Production ${log.count} pal`})} className="text-gray-400 hover:text-red-500 p-1 md:p-2"><Trash2 size={14} md:size={16} /></button>
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

            {/* Downtime History */}
            <div className="space-y-4">
              <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                <Timer className="text-orange-600" size={18} />
                ARRÊTS (HISTORY)
              </h3>
              <div className="card overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-gray-50 text-[8px] md:text-[9px] text-gray-400 font-black uppercase tracking-widest border-b border-gray-100">
                      <tr>
                        <th className="px-3 md:px-5 py-3 md:py-4">Début</th>
                        <th className="px-3 md:px-5 py-3 md:py-4">Durée</th>
                        <th className="px-3 md:px-5 py-3 md:py-4">Motif</th>
                        <th className="px-3 md:px-5 py-3 md:py-4 hidden sm:table-cell">Ligne</th>
                        <th className="px-3 md:px-5 py-3 md:py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 text-[10px] md:text-xs">
                      <AnimatePresence mode="popLayout">
                        {filteredDownLogs.slice(0, 50).map(log => (
                          <motion.tr 
                            key={log.id} 
                            initial={{ opacity: 1 }}
                            exit={{ opacity: 0, x: -20, backgroundColor: 'rgba(254, 226, 226, 0.5)' }}
                            transition={{ duration: 0.2 }}
                            className="hover:bg-gray-50/50"
                          >
                            <td className="px-5 py-4 font-bold text-gray-900">
                              {new Date(log.startTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                            </td>
                            <td className="px-5 py-4">
                              {log.duration ? (
                                <span className="font-mono font-bold bg-gray-100 px-2 py-0.5 rounded text-gray-700">
                                  {formatDuration(log.duration)}
                                </span>
                              ) : <span className="text-orange-500 font-black uppercase">En cours</span>}
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-2">
                                <span className="text-base">{downtimeTypes.find(t => t.id === log.typeId)?.icon || '⚠️'}</span>
                                <p className="font-bold text-gray-700">{downtimeTypes.find(t => t.id === log.typeId)?.name || '—'}</p>
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <p className="font-bold text-gray-700">{lines.find(l => l.id === log.lineId)?.name || '—'}</p>
                            </td>
                            <td className="px-5 py-4 text-right">
                              <div className="flex justify-end gap-1">
                                <button onClick={() => openEditModal('down', log)} className="text-gray-400 hover:text-blue-600 p-2"><Pencil size={16} /></button>
                                <button onClick={() => setConfirmDelete({col: 'downtime_logs', id: log.id, name: `Arrêt ${downtimeTypes.find(t => t.id === log.typeId)?.name}`})} className="text-gray-400 hover:text-red-500 p-2"><Trash2 size={16} /></button>
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
          </div>
        </div>
      )
    )}

    {/* DELETE CONFIRMATION */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full space-y-6 shadow-2xl">
             <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto">
               <Trash2 size={32} />
             </div>
             <div className="text-center space-y-2">
               <h3 className="text-xl font-black text-gray-900">Confirmer la suppression</h3>
               <p className="text-sm text-gray-500 font-medium leading-relaxed">Voulez-vous vraiment supprimer cet enregistrement ?<br/><span className="text-gray-900 font-bold">{confirmDelete.name}</span></p>
             </div>
             <div className="flex gap-3 mt-4">
                <button onClick={() => setConfirmDelete(null)} className="flex-1 py-3 font-bold text-gray-500 hover:bg-gray-100 rounded-xl transition-all uppercase text-[10px] tracking-widest">Annuler</button>
                <button onClick={handleDelete} className="flex-1 py-3 bg-red-600 text-white font-black rounded-xl shadow-lg shadow-red-100 active:scale-95 transition-all text-[10px] tracking-widest uppercase">Supprimer</button>
             </div>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl border border-gray-100"
          >
            <h3 className="text-2xl font-black text-gray-900 uppercase italic">Corriger Enregistrement</h3>
            
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
            <div className="p-6 bg-blue-600 text-white">
              <h2 className="text-2xl font-black tracking-tight">Assigner un Programme</h2>
              <p className="text-blue-100 text-sm font-medium opacity-80">
                Ligne: {lines.find(l => l.id === isAssigning)?.name}
              </p>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {!showCreateNew ? (
                <>
                  <div className="space-y-3">
                    <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Programmes Disponibles</h3>
                    {availableProgs.length > 0 ? (
                      <div className="grid gap-2">
                        {availableProgs.map(p => (
                          <button
                            key={p.id}
                            onClick={() => handleSelectExistingProgramme(p.id)}
                            className="w-full p-4 bg-gray-50 hover:bg-blue-50 border border-gray-100 hover:border-blue-200 rounded-2xl text-left transition-all group flex justify-between items-center"
                          >
                            <div>
                              <p className="font-bold text-gray-900 group-hover:text-blue-700">{p.name}</p>
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cible: {p.targetPallets} palettes</p>
                            </div>
                            <div className="w-8 h-8 bg-white border border-gray-100 rounded-full flex items-center justify-center text-gray-300 group-hover:text-blue-500 group-hover:border-blue-200 transition-all">
                              <Plus size={16} />
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="p-8 text-center bg-gray-50 border-2 border-dashed border-gray-100 rounded-3xl">
                        <p className="text-gray-400 font-medium italic">Aucun programme disponible</p>
                      </div>
                    )}
                  </div>

                  <div className="pt-2">
                    <button 
                      onClick={() => setShowCreateNew(true)}
                      className="w-full p-4 bg-blue-50 text-blue-700 rounded-2xl font-black text-xs uppercase tracking-widest border border-blue-100 hover:bg-blue-100 transition-colors shadow-sm"
                    >
                      + Créer un nouveau programme
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-black text-gray-700 uppercase tracking-widest ml-1">Nouveau Programme</h3>
                    <button onClick={() => setShowCreateNew(false)} className="text-[10px] font-bold text-blue-600 hover:underline">Retour à la liste</button>
                  </div>
                  
                  <div className="space-y-4 pt-1">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Nom du programme</label>
                      <input 
                        type="text"
                        value={newProgName}
                        onChange={e => setNewProgName(e.target.value)}
                        placeholder="ex: PAL-2026-X"
                        className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Objectif palettes</label>
                      <input 
                        type="number"
                        value={newProgTarget}
                        onChange={e => setNewProgTarget(e.target.value)}
                        className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold text-xl"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 bg-gray-50 border-t border-gray-100 flex gap-3">
              <button 
                onClick={() => {
                  setIsAssigning(null);
                  setShowCreateNew(false);
                }}
                className="flex-1 py-4 font-bold text-gray-500 hover:bg-gray-100 rounded-2xl transition-colors uppercase text-xs tracking-widest"
              >
                Annuler
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
    </div>
  );
}
