import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where, getDocs, doc, updateDoc, addDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { Machine, Line, Programme, User as AppUser, DowntimeType, DowntimeLog } from '../types';
import { motion } from 'motion/react';
import { Monitor, LayoutGrid, Package, Users, Activity, ExternalLink, Plus } from 'lucide-react';
import { cn, formatDuration } from '../lib/utils';

export default function PilotScreen() {
  const { user, logout } = useAuth();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachineId, setSelectedMachineId] = useState<string>('');
  const [lines, setLines] = useState<Line[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [downtimeTypes, setDowntimeTypes] = useState<DowntimeType[]>([]);
  const [activeDowntimes, setActiveDowntimes] = useState<Record<string, DowntimeLog>>({});

  const [isAssigning, setIsAssigning] = useState<string | null>(null);
  const [showCreateNew, setShowCreateNew] = useState(false);
  const [newProgName, setNewProgName] = useState('');
  const [newProgTarget, setNewProgTarget] = useState('100');

  useEffect(() => {
    onSnapshot(collection(db, 'machines'), shot => setMachines(shot.docs.map(d => ({id: d.id, ...d.data()} as Machine))));
    onSnapshot(collection(db, 'users'), shot => setUsers(shot.docs.map(d => ({id: d.id, ...d.data()} as AppUser))));
    onSnapshot(collection(db, 'downtime_types'), shot => setDowntimeTypes(shot.docs.map(d => ({id: d.id, ...d.data()} as DowntimeType))));
  }, []);

  useEffect(() => {
    if (!selectedMachineId) return;
    const unsubLines = onSnapshot(query(collection(db, 'lines'), where('machineId', '==', selectedMachineId)), shot => {
      setLines(shot.docs.map(d => ({id: d.id, ...d.data()} as Line)));
    });
    const unsubProgs = onSnapshot(query(collection(db, 'programmes'), where('machineId', '==', selectedMachineId), where('status', '==', 'ACTIVE')), shot => {
      setProgrammes(shot.docs.map(d => ({id: d.id, ...d.data()} as Programme)));
    });
    return () => {
      unsubLines();
      unsubProgs();
    };
  }, [selectedMachineId]);

  // Sync active downtimes
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'downtime_logs'), shot => {
      const active: Record<string, DowntimeLog> = {};
      shot.docs.forEach(d => {
        const data = d.data() as DowntimeLog;
        if (!data.endTime) {
          active[data.lineId] = { id: d.id, ...data };
        }
      });
      setActiveDowntimes(active);
    });
    return unsub;
  }, []);

  const handleAssignProgramme = async () => {
    if (!isAssigning || !newProgName || !newProgTarget) return;

    const target = parseInt(newProgTarget);
    if (isNaN(target)) return;

    // Create new programme
    const progRef = await addDoc(collection(db, 'programmes'), {
      name: newProgName,
      machineId: selectedMachineId,
      lineId: isAssigning,
      targetPallets: target,
      producedPallets: 0,
      status: 'ACTIVE',
      createdAt: new Date().toISOString()
    });

    // Update line
    await updateDoc(doc(db, 'lines', isAssigning), {
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
    await updateDoc(doc(db, 'lines', isAssigning), {
      currentProgrammeId: progId,
      status: 'IDLE'
    });
    setIsAssigning(null);
  };

  // Filter programmes that are already assigned to other lines
  const assignedProgIds = lines.map(l => l.currentProgrammeId).filter(Boolean);
  const availableProgs = programmes.filter(p => !assignedProgIds.includes(p.id));

  return (
    <div className="min-h-screen bg-[#F3F4F6] pb-20">
      <div className="bg-white p-4 shadow-sm flex flex-col gap-4 sticky top-0 z-20 border-b border-gray-200">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Monitor className="text-blue-600" size={24} />
            <h1 className="font-black text-xl tracking-tighter">PILOT MONITOR</h1>
          </div>
          <button onClick={logout} className="text-[10px] font-black text-gray-400 uppercase tracking-widest border border-gray-200 px-2 py-1 rounded">Logout</button>
        </div>
        
        <select 
          value={selectedMachineId}
          onChange={e => setSelectedMachineId(e.target.value)}
          className="w-full p-3 bg-gray-50 rounded-xl font-bold border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-inner text-gray-700"
        >
          <option value="">Sélectionner une machine...</option>
          {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>

      {!selectedMachineId ? (
        <div className="flex flex-col items-center justify-center p-12 text-center space-y-4">
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-blue-300">
             <LayoutGrid size={32} />
          </div>
          <p className="text-gray-400 font-bold uppercase text-xs tracking-widest">Choisir une machine pour monitorer les lignes</p>
        </div>
      ) : (
        <div className="p-4 space-y-4 max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
          {lines.map(line => {
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

                <div className="p-4 grid grid-cols-2 gap-4 flex-1">
                  <div className="space-y-1">
                    <p className="text-[9px] text-gray-400 font-black uppercase tracking-widest">Programme Actif</p>
                    <p className={cn(
                      "text-sm font-black",
                      prog ? "text-blue-900" : "text-gray-300 italic"
                    )}>
                      {prog ? prog.name : 'Aucun programme'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[9px] text-gray-400 font-black uppercase tracking-widest">Opérateur</p>
                    <p className={cn(
                      "text-sm font-bold",
                      op ? "text-gray-800" : "text-gray-300 italic"
                    )}>
                      {op ? op.name : 'Non assigné'}
                    </p>
                  </div>
                  
                  <div className="col-span-2 space-y-2 mt-2">
                    <div className="flex justify-between items-end">
                      <div className="space-y-0.5">
                        <p className="text-[9px] text-gray-400 font-black uppercase tracking-widest">Progression Réelle</p>
                        <div className="flex items-baseline gap-1">
                          <p className="text-2xl font-black text-blue-600 leading-none">
                            {prog ? prog.producedPallets : '0'}
                          </p>
                          <p className="text-xs font-bold text-gray-400">/ {prog ? prog.targetPallets : '0'} palettes</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-black text-blue-900 leading-none">
                           {prog ? `${Math.round((prog.producedPallets / prog.targetPallets) * 100)}%` : '0%'}
                        </p>
                      </div>
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden border border-gray-200/50 shadow-inner">
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
                    <span className="text-[10px] font-mono font-bold text-orange-800 bg-white/40 px-2 py-0.5 rounded">
                       Depuis {new Date(down.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}
              </motion.div>
            );
          })}
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
