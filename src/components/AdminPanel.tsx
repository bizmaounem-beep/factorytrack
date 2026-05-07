import { useState, useEffect } from 'react';
import { collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc, query, orderBy, increment, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { User as AppUser, Machine, Line, Programme, DowntimeType, ProductionLog, DowntimeLog } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, Factory, Package, Timer, History, 
  Download, Plus, Trash2, PieChart, LayoutDashboard,
  Box, Terminal, Activity, Pencil
} from 'lucide-react';
import { cn } from '../lib/utils';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

export default function AdminPanel() {
  const { logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalType, setModalType] = useState<'user' | 'machine' | 'line' | 'downtime' | 'programme' | 'production_log' | 'downtime_log'>('user');
  const [modalData, setModalData] = useState<any>({});
  const [selectedMachineForLine, setSelectedMachineForLine] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{col: string, id: string, name: string} | null>(null);
  
  const [users, setUsers] = useState<AppUser[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [downtimeTypes, setDowntimeTypes] = useState<DowntimeType[]>([]);
  const [prodLogs, setProdLogs] = useState<ProductionLog[]>([]);
  const [downLogs, setDownLogs] = useState<DowntimeLog[]>([]);

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, 'users'), s => setUsers(s.docs.map(d => ({id: d.id, ...d.data()} as AppUser))));
    const unsubMachines = onSnapshot(collection(db, 'machines'), s => setMachines(s.docs.map(d => ({id: d.id, ...d.data()} as Machine))));
    const unsubLines = onSnapshot(collection(db, 'lines'), s => setLines(s.docs.map(d => ({id: d.id, ...d.data()} as Line))));
    const unsubProgs = onSnapshot(collection(db, 'programmes'), s => setProgrammes(s.docs.map(d => ({id: d.id, ...d.data()} as Programme))));
    const unsubTypes = onSnapshot(collection(db, 'downtime_types'), s => setDowntimeTypes(s.docs.map(d => ({id: d.id, ...d.data()} as DowntimeType))));
    const unsubProd = onSnapshot(query(collection(db, 'production_logs'), orderBy('timestamp', 'desc')), s => setProdLogs(s.docs.map(d => ({id: d.id, ...d.data()} as ProductionLog))));
    const unsubDown = onSnapshot(query(collection(db, 'downtime_logs'), orderBy('startTime', 'desc')), s => setDownLogs(s.docs.map(d => ({id: d.id, ...d.data()} as DowntimeLog))));
    
    return () => {
      unsubUsers(); unsubMachines(); unsubLines(); unsubProgs(); unsubTypes(); unsubProd(); unsubDown();
    };
  }, []);

  const openModal = (type: typeof modalType, data: any = {}) => {
    setModalType(type);
    setModalData(data);
    setEditingId(data.id || null);
    if (type === 'line' && data.machineId) {
      setSelectedMachineForLine(data.machineId);
    }
    setIsModalOpen(true);
  };

  const handleModalSubmit = async () => {
    try {
      const collectionName = 
        modalType === 'user' ? 'users' : 
        modalType === 'machine' ? 'machines' : 
        modalType === 'line' ? 'lines' : 
        modalType === 'programme' ? 'programmes' : 
        modalType === 'production_log' ? 'production_logs' :
        modalType === 'downtime_log' ? 'downtime_logs' : 'downtime_types';

      let finalData = { ...modalData };
      if (modalType === 'programme' && finalData.targetPallets) {
        finalData.targetPallets = parseInt(finalData.targetPallets);
      }
      if (modalType === 'production_log' && finalData.count) {
        finalData.count = parseInt(finalData.count);
      }
      if (modalType === 'downtime_log') {
        if (finalData.duration) finalData.duration = parseInt(finalData.duration);
      }
      if (modalType === 'downtime' && !finalData.icon) {
        finalData.icon = '⚠️';
      }
      if (modalType === 'line' && selectedMachineForLine) {
        finalData.machineId = selectedMachineForLine;
        if (!editingId) finalData.status = 'IDLE';
      }

      if (editingId) {
        const { id, ...dataToSave } = finalData;
        
        // Handle Production Log updates (integrity)
        if (modalType === 'production_log') {
          const oldLog = prodLogs.find(l => l.id === editingId);
          if (oldLog && oldLog.count !== dataToSave.count) {
            const diff = dataToSave.count - oldLog.count;
            await updateDoc(doc(db, 'programmes', oldLog.programmeId), {
              producedPallets: increment(diff)
            });
          }
        }

        await updateDoc(doc(db, collectionName, editingId), dataToSave);
        
        if (modalType === 'programme' && dataToSave.lineId) {
          await updateDoc(doc(db, 'lines', dataToSave.lineId), {
            currentProgrammeId: editingId
          });
        }
      } else {
        if (modalType === 'programme') {
          const progRef = await addDoc(collection(db, 'programmes'), {
            ...finalData,
            producedPallets: 0,
            status: 'ACTIVE',
            createdAt: new Date().toISOString()
          });
          if (finalData.lineId) {
            await updateDoc(doc(db, 'lines', finalData.lineId), {
              currentProgrammeId: progRef.id,
              status: 'IDLE'
            });
          }
        } else {
          await addDoc(collection(db, collectionName), finalData);
        }
      }
      setIsModalOpen(false);
      setEditingId(null);
    } catch (error) {
      console.error('Error saving item:', error);
      alert('Erreur lors de l\'enregistrement.');
    }
  };

  const deleteItem = async () => {
    if (!confirmDelete) return;
    const { col, id } = confirmDelete;

    try {
      if (col === 'production_logs') {
        const logDoc = await getDoc(doc(db, col, id));
        if (logDoc.exists()) {
          const logData = logDoc.data() as ProductionLog;
          await updateDoc(doc(db, 'programmes', logData.programmeId), {
            producedPallets: increment(-logData.count)
          });
        }
      }

      if (col === 'downtime_logs') {
        const logDoc = await getDoc(doc(db, col, id));
        if (logDoc.exists()) {
          const logData = logDoc.data() as DowntimeLog;
          if (!logData.endTime) {
            await updateDoc(doc(db, 'lines', logData.lineId), {
              activeDowntimeId: null,
              status: 'IDLE'
            });
          }
        }
      }

      await deleteDoc(doc(db, col, id));
      setConfirmDelete(null);
    } catch (error) {
      console.error('Error deleting document:', error);
      alert('Erreur: Impossible de supprimer cet élément.');
    }
  };

  const initiateDelete = (col: string, id: string | undefined, name: string) => {
    if (!id) return;
    setConfirmDelete({ col, id, name });
  };

  const formatDuration = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const exportToExcel = async (type: 'production' | 'downtime') => {
    const workbook = new ExcelJS.Workbook();
    const dataSheet = workbook.addWorksheet('Data');
    const dashboardSheet = workbook.addWorksheet('Dashboard');
    
    let fileName = "";
    let title = "";

    if (type === 'production') {
      title = "RAPPORT DE PRODUCTION - FACTORYTRACK PRO";
      fileName = `Production_${new Date().toISOString().split('T')[0]}.xlsx`;

      // Define columns for Data sheet
      dataSheet.columns = [
        { header: 'Date', key: 'date', width: 15 },
        { header: 'Machine', key: 'machine', width: 20 },
        { header: 'Ligne', key: 'line', width: 15 },
        { header: 'Programme', key: 'programme', width: 25 },
        { header: 'Palettes', key: 'pallets', width: 12 },
      ];

      // Add Data
      prodLogs.forEach(log => {
        dataSheet.addRow({
          date: new Date(log.timestamp).toLocaleDateString(),
          machine: machines.find(m => m.id === log.machineId)?.name || '—',
          line: lines.find(l => l.id === log.lineId)?.name || '—',
          programme: programmes.find(p => p.id === log.programmeId)?.name || '—',
          pallets: log.count
        });
      });

      // DASHBOARD - PRODUCTION
      dashboardSheet.getCell('A1').value = "DASHBOARD DE PRODUCTION";
      dashboardSheet.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF1D4ED8' } };
      dashboardSheet.getCell('A2').value = `Généré le : ${new Date().toLocaleString()}`;

      // Summary Table 1: Total Pallets per Machine
      dashboardSheet.getCell('A4').value = "Total Palettes par Machine";
      dashboardSheet.getCell('A4').font = { bold: true };
      dashboardSheet.getRow(5).values = ['Machine', 'Total Palettes'];
      dashboardSheet.getRow(5).font = { bold: true };
      
      const palletsPerMachine = machines.map(m => ({
        name: m.name,
        total: prodLogs.filter(l => l.machineId === m.id).reduce((acc, l) => acc + l.count, 0)
      })).filter(m => m.total > 0);

      let currentRow = 6;
      palletsPerMachine.forEach(m => {
        dashboardSheet.getRow(currentRow).values = [m.name, m.total];
        currentRow++;
      });
      
      const totalPallets = prodLogs.reduce((acc, l) => acc + l.count, 0);
      dashboardSheet.getRow(currentRow).values = ['TOTAL GÉNÉRAL', totalPallets];
      dashboardSheet.getRow(currentRow).font = { bold: true };
      dashboardSheet.getRow(currentRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      
      currentRow += 3;

      // Summary Table 2: Total Pallets per Programme
      dashboardSheet.getRow(currentRow).values = ["Production par Programme"];
      dashboardSheet.getRow(currentRow).font = { bold: true };
      currentRow++;
      dashboardSheet.getRow(currentRow).values = ['Programme', 'Cible', 'Réalisé', '%'];
      dashboardSheet.getRow(currentRow).font = { bold: true };
      currentRow++;

      programmes.filter(p => prodLogs.some(l => l.programmeId === p.id)).forEach(p => {
        const prod = prodLogs.filter(l => l.programmeId === p.id).reduce((acc, l) => acc + l.count, 0);
        dashboardSheet.getRow(currentRow).values = [
          p.name, 
          p.targetPallets, 
          prod, 
          prod / p.targetPallets
        ];
        dashboardSheet.getRow(currentRow).getCell(4).numFmt = '0%';
        currentRow++;
      });

    } else {
      title = "RAPPORT D'ARRÊT (DOWNTIME) - FACTORYTRACK PRO";
      fileName = `Downtime_${new Date().toISOString().split('T')[0]}.xlsx`;

      // Define columns for Data sheet
      dataSheet.columns = [
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Machine', key: 'machine', width: 20 },
        { header: 'Ligne', key: 'line', width: 15 },
        { header: 'Type', key: 'type', width: 20 },
        { header: 'Description', key: 'desc', width: 30 },
        { header: 'Début', key: 'start', width: 12 },
        { header: 'Fin', key: 'end', width: 12 },
        { header: 'Durée (Min)', key: 'duration', width: 15 },
      ];

      // Add Data
      downLogs.forEach(log => {
        const start = new Date(log.startTime);
        const end = log.endTime ? new Date(log.endTime) : null;
        const durationMin = log.duration ? Math.round(log.duration / 60000) : 0;
        
        dataSheet.addRow({
          date: start.toLocaleDateString(),
          machine: machines.find(m => m.id === log.machineId)?.name || '—',
          line: lines.find(l => l.id === log.lineId)?.name || '—',
          type: downtimeTypes.find(t => t.id === log.typeId)?.name || '—',
          desc: log.description || '—',
          start: start.toLocaleTimeString(),
          end: end ? end.toLocaleTimeString() : 'En cours',
          duration: durationMin
        });
      });

      // DASHBOARD - DOWNTIME
      dashboardSheet.getCell('A1').value = "ANALYSE DES ARRÊTS (DOWNTIME)";
      dashboardSheet.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FFEA580C' } };
      dashboardSheet.getCell('A2').value = `Généré le : ${new Date().toLocaleString()}`;

      let currentRow = 4;

      // Table 1: Duration per Type
      dashboardSheet.getRow(currentRow).values = ["Temps d'arrêt par Type (Minutes)"];
      dashboardSheet.getRow(currentRow).font = { bold: true };
      currentRow++;
      dashboardSheet.getRow(currentRow).values = ['Type d\'Arrêt', 'Durée Totale (Min)'];
      dashboardSheet.getRow(currentRow).font = { bold: true };
      currentRow++;

      downtimeTypes.forEach(t => {
        const total = downLogs.filter(l => l.typeId === t.id).reduce((acc, l) => acc + (l.duration || 0), 0);
        if (total > 0) {
          dashboardSheet.getRow(currentRow).values = [t.name, Math.round(total / 60000)];
          currentRow++;
        }
      });

      currentRow += 2;

      // Table 2: Duration per Machine
      dashboardSheet.getRow(currentRow).values = ["Performance par Machine (Arrêt Total)"];
      dashboardSheet.getRow(currentRow).font = { bold: true };
      currentRow++;
      dashboardSheet.getRow(currentRow).values = ['Machine', 'Arrêt Total (Min)', 'Nb d\'incidents'];
      dashboardSheet.getRow(currentRow).font = { bold: true };
      currentRow++;

      machines.forEach(m => {
        const logs = downLogs.filter(l => l.machineId === m.id);
        const total = logs.reduce((acc, l) => acc + (l.duration || 0), 0);
        if (total > 0 || logs.length > 0) {
          dashboardSheet.getRow(currentRow).values = [m.name, Math.round(total / 60000), logs.length];
          currentRow++;
        }
      });
    }

    // Apply Common Formatting to Data Sheet
    dataSheet.getRow(1).font = { bold: true };
    dataSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE5E7EB' }
    };
    
    // Borders for all data cells
    dataSheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        // Center text in headers
        if (rowNumber === 1) cell.alignment = { horizontal: 'center' };
      });
    });

    const columnLetter = (col: number) => {
      let s = "";
      while (col > 0) {
        let m = (col - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        col = Math.floor((col - m) / 26);
      }
      return s;
    };

    dataSheet.autoFilter = `A1:${columnLetter(dataSheet.columns?.length || 1)}1`;
    dataSheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Auto-size columns (rough estimate since exceljs auto-size is not integrated)
    dataSheet.columns?.forEach(column => {
      let maxColumnLength = 0;
      column.eachCell?.({ includeEmpty: true }, cell => {
        const columnLength = cell.value ? cell.value.toString().length : 10;
        if (columnLength > maxColumnLength) {
          maxColumnLength = columnLength;
        }
      });
      column.width = maxColumnLength < 10 ? 10 : maxColumnLength + 2;
    });

    // Formatting for Dashboard Sheet
    dashboardSheet.columns = [
      { key: 'A', width: 30 },
      { key: 'B', width: 20 },
      { key: 'C', width: 20 },
      { key: 'D', width: 15 },
    ];

    // Finalize and Download
    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(new Blob([buffer]), fileName);
  };

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'machines', label: 'Machines', icon: Factory },
    { id: 'programmes', label: 'Programmes', icon: Package },
    { id: 'types', label: 'Downtime', icon: Timer },
    { id: 'reports', label: 'Reports', icon: Download },
    { id: 'history', label: 'Historique', icon: History },
  ];

  return (
    <div className="min-h-screen bg-[#F3F4F6] flex flex-col md:flex-row">
      {/* SIDEBAR */}
      <aside className="bg-white w-full md:w-64 md:min-h-screen border-r border-gray-200 p-6 shrink-0 z-30 flex flex-col gap-8">
        <div className="flex items-center gap-3 px-2">
          <div className="bg-blue-600 p-2 rounded-lg text-white">
            <Terminal size={20} />
          </div>
          <h1 className="font-black text-xl tracking-tighter text-gray-900 leading-none">FACTORY<br/><span className="text-blue-600">CLOUD</span></h1>
        </div>
        
        <nav className="flex md:flex-col gap-1.5 overflow-x-auto md:overflow-visible pb-2 md:pb-0">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all whitespace-nowrap",
                activeTab === tab.id 
                  ? "bg-blue-600 text-white shadow-xl shadow-blue-100 translate-x-1" 
                  : "text-gray-400 hover:bg-gray-50 hover:text-gray-600"
              )}
            >
              <tab.icon size={16} strokeWidth={2.5} />
              {tab.label}
            </button>
          ))}
          <div className="mt-auto pt-8 border-t border-gray-100 hidden md:block">
            <button 
              onClick={logout}
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-red-500 hover:bg-red-50 w-full transition-colors"
            >
              <Trash2 size={16} strokeWidth={2.5} />
              Quitter
            </button>
          </div>
        </nav>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto">
        <div className="max-w-6xl mx-auto space-y-10">
          
          {activeTab === 'dashboard' && (
            <div className="space-y-8 animate-in fade-in duration-500">
              <div className="flex justify-between items-center">
                <h2 className="text-3xl font-black tracking-tighter text-gray-900">Dashboard Temps Réel</h2>
                <div className="text-right">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Dernière mise à jour</p>
                  <p className="text-sm font-bold text-blue-600">{new Date().toLocaleTimeString()}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                 {[
                   { label: 'Palettes / Jour', val: prodLogs.reduce((acc, l) => acc + l.count, 0), icon: Box, color: 'blue' },
                   { label: 'Lignes Actives', val: lines.filter(l => l.status === 'RUNNING').length, icon: Activity, color: 'green' },
                   { label: 'Arrêts en cours', val: lines.filter(l => !!l.activeDowntimeId).length, icon: Timer, color: 'orange' },
                   { label: 'Effectif total', val: users.length, icon: Users, color: 'gray' },
                 ].map(stat => (
                   <div key={stat.label} className="card p-6 flex flex-col justify-between hover:shadow-md transition-shadow group">
                     <div className={cn(
                       "w-12 h-12 rounded-2xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110",
                       stat.color === 'blue' ? "bg-blue-50 text-blue-600" :
                       stat.color === 'green' ? "bg-green-50 text-green-600" :
                       stat.color === 'orange' ? "bg-orange-50 text-orange-600" : "bg-gray-50 text-gray-600"
                     )}>
                       <stat.icon size={24} strokeWidth={2.5} />
                     </div>
                     <div>
                       <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{stat.label}</p>
                       <p className="text-3xl font-black text-gray-900 leading-none">{stat.val}</p>
                     </div>
                   </div>
                 ))}
              </div>

              <div className="card overflow-hidden">
                 <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                   <h3 className="text-sm font-black uppercase tracking-widest text-gray-900">Monitor de Production Live</h3>
                   <div className="flex gap-2">
                      <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" /><span className="text-[10px] font-bold text-gray-400 uppercase">Production</span></div>
                      <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /><span className="text-[10px] font-bold text-gray-400 uppercase">Arrêt</span></div>
                   </div>
                 </div>
                 <div className="overflow-x-auto">
                   <table className="w-full text-left">
                     <thead className="bg-white text-[10px] text-gray-400 font-black uppercase tracking-[0.2em] border-b border-gray-100">
                       <tr>
                         <th className="px-6 py-5">Identifiant</th>
                         <th className="px-6 py-5">Statut</th>
                         <th className="px-6 py-5">Progression</th>
                         <th className="px-6 py-5">Opérateur</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-50">
                        {lines.map(l => {
                          const prog = programmes.find(p => p.id === l.currentProgrammeId);
                          const op = users.find(u => u.id === l.currentOperatorId);
                          const mach = machines.find(m => m.id === l.machineId);
                          return (
                            <tr key={l.id} className="text-sm hover:bg-gray-50/50 transition-colors">
                              <td className="px-6 py-5">
                                <p className="font-black text-gray-900 leading-none mb-1">{l.name}</p>
                                <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">{mach?.name}</p>
                              </td>
                              <td className="px-6 py-5">
                                 <span className={cn(
                                   "px-2.5 py-1 rounded-md text-[9px] font-black uppercase tracking-widest",
                                   l.status === 'RUNNING' ? "bg-status-running-bg text-status-running-text" :
                                   l.status === 'STOPPED' ? "bg-status-stopped-bg text-status-stopped-text" : "bg-status-idle-bg text-status-idle-text"
                                 )}>{l.status}</span>
                              </td>
                              <td className="px-6 py-5">
                                <div className="space-y-1.5 max-w-[120px]">
                                  <div className="flex justify-between text-[10px] font-bold text-gray-400">
                                    <span>{prog ? `${prog.producedPallets}/${prog.targetPallets}` : '0/0'}</span>
                                    <span>{prog ? Math.round((prog.producedPallets/prog.targetPallets)*100) : 0}%</span>
                                  </div>
                                  <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                                     <div 
                                      className="h-full bg-blue-500 rounded-full" 
                                      style={{ width: `${prog ? Math.min((prog.producedPallets/prog.targetPallets)*100, 100) : 0}%` }}
                                     />
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-5">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-[10px] font-black text-gray-500">
                                    {op?.name?.substring(0, 2).toUpperCase() || '—'}
                                  </div>
                                  <span className="text-gray-600 font-bold">{op?.name || '—'}</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                     </tbody>
                   </table>
                 </div>
              </div>
            </div>
          )}

          {activeTab === 'users' && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-3xl font-black tracking-tighter text-gray-900">Utilisateurs</h2>
                  <p className="text-sm text-gray-500 font-medium">Gérez l'accès des opérateurs et pilotes</p>
                </div>
                <button 
                  onClick={() => openModal('user')}
                  className="bg-blue-600 text-white px-6 py-3 rounded-xl font-black shadow-xl shadow-blue-100 active:scale-95 transition-all text-xs tracking-widest flex items-center gap-2"
                >
                  <Plus size={16} strokeWidth={3} /> AJOUTER
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {users.map(u => (
                  <div key={u.id} className="card p-5 group flex justify-between items-center hover:border-blue-200 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center font-black",
                        u.role === 'ADMIN' ? "bg-red-50 text-red-600" :
                        u.role === 'PILOT' ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-600"
                      )}>
                        {u.name.substring(0, 1)}
                      </div>
                      <div>
                        <p className="font-black text-gray-900 leading-tight">{u.name}</p>
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">PIN: <span className="bg-gray-100 px-1 rounded text-gray-600">{u.pin}</span> • {u.role}</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => openModal('user', u)} className="text-gray-400 hover:text-blue-600 transition-colors p-2">
                        <Pencil size={18} />
                      </button>
                      <button onClick={() => initiateDelete('users', u.id, u.name)} className="text-gray-400 hover:text-red-500 transition-colors p-2">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'machines' && (
            <div className="space-y-10 animate-in slide-in-from-right-4 duration-300">
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-3xl font-black tracking-tighter text-gray-900">Parc Machine</h2>
                  <button 
                     onClick={() => openModal('machine')}
                     className="bg-blue-600 text-white px-6 py-3 rounded-xl font-black shadow-xl shadow-blue-100 active:scale-95 transition-all text-xs tracking-widest"
                  >
                     + MACHINE
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {machines.map(m => (
                    <div key={m.id} className="card p-6 flex flex-col gap-6">
                      <div className="flex justify-between items-center">
                        <h3 className="font-black text-xl italic tracking-tighter text-gray-900">{m.name}</h3>
                        <div className="flex gap-2">
                           <button 
                             onClick={() => openModal('line', { machineId: m.id })}
                             className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-100 transition-all"
                           >
                             + Ligne
                           </button>
                           <button onClick={() => openModal('machine', m)} className="text-gray-400 hover:text-blue-600 p-1 transition-colors"><Pencil size={18} /></button>
                           <button onClick={() => initiateDelete('machines', m.id, m.name)} className="text-gray-400 hover:text-red-500 p-1 transition-colors"><Trash2 size={18} /></button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">Pilote actuel</p>
                        <div className="flex items-center justify-between bg-blue-50/50 p-2 rounded-lg border border-blue-100">
                          <span className="text-sm font-bold text-blue-900">{users.find(u => u.id === m.currentPilotId)?.name || 'Libre'}</span>
                          {m.currentPilotId && (
                            <button 
                              onClick={() => updateDoc(doc(db, 'machines', m.id), { currentPilotId: null })}
                              className="text-[10px] font-black text-red-500 hover:underline uppercase"
                            >
                              Libérer
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Lignes rattachées</p>
                        <div className="flex flex-wrap gap-2">
                          {lines.filter(l => l.machineId === m.id).map(l => (
                            <div key={l.id} className="bg-gray-50 border border-gray-100 px-3 py-1.5 rounded-lg flex items-center gap-2 group/line">
                              <span className="text-xs font-bold text-gray-700">{l.name}</span>
                              <div className="flex gap-1 opacity-0 group-hover/line:opacity-100 transition-opacity">
                                <button onClick={() => openModal('line', l)} className="text-gray-400 hover:text-blue-500">
                                  <Pencil size={12} />
                                </button>
                                <button onClick={() => initiateDelete('lines', l.id, l.name)} className="text-gray-400 hover:text-red-500">
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                          {lines.filter(l => l.machineId === m.id).length === 0 && <p className="text-xs text-gray-300 font-medium italic">Aucune ligne configurée</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'programmes' && (
          <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-3xl font-black tracking-tighter text-gray-900">Programmes de Production</h2>
                <p className="text-sm text-gray-500 font-medium">Créez et assignez des ordres de fabrication</p>
              </div>
              <button 
                onClick={() => openModal('programme')}
                className="bg-blue-600 text-white px-6 py-3 rounded-xl font-black shadow-xl shadow-blue-100 active:scale-95 transition-all text-xs tracking-widest flex items-center gap-2"
              >
                <Plus size={16} strokeWidth={3} /> NOUVEAU
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {programmes.map(p => (
                <div key={p.id} className={cn(
                  "card p-5 border-l-4 transition-all",
                  p.status === 'ACTIVE' ? "border-blue-500" : "border-gray-300 opacity-60"
                )}>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{machines.find(m => m.id === p.machineId)?.name} • {lines.find(l => l.id === p.lineId)?.name}</p>
                      <h3 className="font-black text-lg text-gray-900 leading-tight">{p.name}</h3>
                    </div>
                    <span className={cn(
                      "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter",
                      p.status === 'ACTIVE' ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                    )}>{p.status}</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <span className="text-gray-500">{p.producedPallets} / {p.targetPallets} pal</span>
                      <span className="text-blue-600 font-black">{Math.round((p.producedPallets/p.targetPallets)*100)}%</span>
                    </div>
                    <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min((p.producedPallets/p.targetPallets)*100, 100)}%` }} />
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-gray-50 flex justify-between">
                     <p className="text-[10px] font-bold text-gray-400">Créé le {new Date(p.createdAt).toLocaleDateString()}</p>
                     <div className="flex gap-2">
                        <button onClick={() => openModal('programme', p)} className="text-gray-400 hover:text-blue-500"><Pencil size={14} /></button>
                        <button onClick={() => initiateDelete('programmes', p.id, p.name)} className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                     </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'types' && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-3xl font-black tracking-tighter text-gray-900">Motifs d'Arrêt</h2>
                  <p className="text-sm text-gray-500 font-medium">Standardisez les types de pannes pour l'analyse</p>
                </div>
                <button 
                  onClick={() => openModal('downtime')}
                  className="bg-blue-600 text-white px-6 py-3 rounded-xl font-black shadow-xl shadow-blue-100 active:scale-95 transition-all text-xs tracking-widest"
                >
                  NOUVEAU TYPE
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6">
                {downtimeTypes.map(t => (
                  <div key={t.id} className="card p-6 text-center animate-in zoom-in-95 group relative hover:border-orange-200 transition-all">
                    <div className="text-4xl mb-4 grayscale group-hover:grayscale-0 transition-all">{t.icon || '⚠️'}</div>
                    <p className="font-black text-xs uppercase tracking-widest text-gray-700 leading-tight">{t.name}</p>
                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      <button onClick={() => openModal('downtime', t)} className="text-gray-400 hover:text-blue-500 p-1">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => initiateDelete('downtime_types', t.id, t.name)} className="text-gray-400 hover:text-red-500 p-1">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-3xl font-black tracking-tighter text-gray-900">Historique complet</h2>
                  <p className="text-sm text-gray-500 font-medium">Modifiez ou supprimez les enregistrements passés</p>
                </div>
              </div>

              <div className="space-y-12">
                {/* Production Logs History */}
                <div className="space-y-4">
                  <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                    <Package className="text-blue-600" size={20} />
                    Production
                  </h3>
                  <div className="card overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-gray-50 text-[10px] text-gray-400 font-black uppercase tracking-wider border-b border-gray-100">
                          <tr>
                            <th className="px-6 py-4">Date & Heure</th>
                            <th className="px-6 py-4">Machine / Ligne</th>
                            <th className="px-6 py-4">Programme</th>
                            <th className="px-6 py-4">Opérateur</th>
                            <th className="px-6 py-4">Quantité</th>
                            <th className="px-6 py-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 text-sm">
                          <AnimatePresence mode="popLayout">
                            {prodLogs.map(log => (
                              <motion.tr 
                                key={log.id} 
                                initial={{ opacity: 1 }}
                                exit={{ opacity: 0, x: -20, backgroundColor: 'rgba(254, 226, 226, 0.5)' }}
                                transition={{ duration: 0.2 }}
                                className="hover:bg-gray-50/50"
                              >
                                <td className="px-6 py-4 font-medium text-gray-900">
                                  {new Date(log.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                </td>
                                <td className="px-6 py-4">
                                  <p className="font-bold text-gray-800">{machines.find(m => m.id === log.machineId)?.name || '—'}</p>
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">{lines.find(l => l.id === log.lineId)?.name || '—'}</p>
                                </td>
                                <td className="px-6 py-4 text-blue-600 font-bold">
                                  {programmes.find(p => p.id === log.programmeId)?.name || '—'}
                                </td>
                                <td className="px-6 py-4 font-medium">
                                  {users.find(u => u.id === log.operatorId)?.name || '—'}
                                </td>
                                <td className="px-6 py-4">
                                  <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded font-black">{log.count} pal</span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <div className="flex justify-end gap-1">
                                    <button onClick={() => openModal('production_log', log)} className="text-gray-400 hover:text-blue-600 p-2"><Pencil size={18} /></button>
                                    <button onClick={() => initiateDelete('production_logs', log.id, `Production de ${log.count} palettes`)} className="text-gray-400 hover:text-red-500 p-2"><Trash2 size={18} /></button>
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

                {/* Downtime Logs History */}
                <div className="space-y-4">
                  <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                    <Timer className="text-orange-600" size={20} />
                    Arrêts (Downtime)
                  </h3>
                  <div className="card overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-gray-50 text-[10px] text-gray-400 font-black uppercase tracking-wider border-b border-gray-100">
                          <tr>
                            <th className="px-6 py-4">Début</th>
                            <th className="px-6 py-4">Fin</th>
                            <th className="px-6 py-4">Durée</th>
                            <th className="px-6 py-4">Type / Motif</th>
                            <th className="px-6 py-4">Machine / Ligne</th>
                            <th className="px-6 py-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 text-sm">
                          <AnimatePresence mode="popLayout">
                            {downLogs.map(log => (
                              <motion.tr 
                                key={log.id} 
                                initial={{ opacity: 1 }}
                                exit={{ opacity: 0, x: -20, backgroundColor: 'rgba(254, 226, 226, 0.5)' }}
                                transition={{ duration: 0.2 }}
                                className="hover:bg-gray-50/50"
                              >
                                <td className="px-6 py-4 font-medium text-gray-900">
                                  {new Date(log.startTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                </td>
                                <td className="px-6 py-4 font-medium text-gray-600">
                                  {log.endTime ? new Date(log.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : <span className="text-orange-500 animate-pulse font-black uppercase text-[10px]">En cours</span>}
                                </td>
                                <td className="px-6 py-4">
                                  {log.duration ? (
                                    <span className="font-mono font-bold bg-gray-100 px-2 py-1 rounded text-gray-700">
                                      {formatDuration(log.duration)}
                                    </span>
                                  ) : '—'}
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-2">
                                    <span className="text-lg">{downtimeTypes.find(t => t.id === log.typeId)?.icon || '⚠️'}</span>
                                    <p className="font-bold text-gray-800">{downtimeTypes.find(t => t.id === log.typeId)?.name || '—'}</p>
                                  </div>
                                  {log.description && <p className="text-[10px] text-gray-400 italic mt-0.5">{log.description}</p>}
                                </td>
                                <td className="px-6 py-4">
                                  <p className="font-bold text-gray-800">{machines.find(m => m.id === log.machineId)?.name || '—'}</p>
                                  <p className="text-[10px] font-bold text-gray-400 uppercase">{lines.find(l => l.id === log.lineId)?.name || '—'}</p>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <div className="flex justify-end gap-1">
                                    <button onClick={() => openModal('downtime_log', log)} className="text-gray-400 hover:text-blue-600 p-2"><Pencil size={18} /></button>
                                    <button onClick={() => initiateDelete('downtime_logs', log.id, `Arrêt ${downtimeTypes.find(t => t.id === log.typeId)?.name}`)} className="text-gray-400 hover:text-red-500 p-2"><Trash2 size={18} /></button>
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
          )}
          {activeTab === 'reports' && (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <div className="space-y-1">
                <h2 className="text-3xl font-black tracking-tighter text-gray-900">Data Export</h2>
                <p className="text-sm text-gray-500 font-medium">Générez des rapports Excel pour analyse externe</p>
              </div>
              <div className="grid md:grid-cols-2 gap-8">
                 <div className="card p-8 flex flex-col gap-6 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 text-blue-50/50 group-hover:text-blue-100/50 transition-colors rotate-12">
                       <Package size={140} />
                    </div>
                    <div className="w-16 h-16 bg-blue-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-blue-100 relative z-10">
                       <History size={32} strokeWidth={2.5} />
                    </div>
                    <div className="relative z-10">
                      <h3 className="text-2xl font-black text-gray-900 tracking-tight mb-2">Production Logs</h3>
                      <p className="text-gray-500 text-sm font-medium leading-relaxed">Historique détaillé de chaque palette déclarée par ligne, opérateur et programme.</p>
                    </div>
                    <button 
                      onClick={() => exportToExcel('production')}
                      className="w-full py-4 bg-blue-600 text-white rounded-xl font-black shadow-xl shadow-blue-200 active:scale-95 transition-all flex items-center justify-center gap-3 relative z-10 text-xs tracking-[0.2em] uppercase"
                    >
                      <Download size={18} strokeWidth={3} />
                      Exporter Production
                    </button>
                 </div>

                 <div className="card p-8 flex flex-col gap-6 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 text-orange-50/50 group-hover:text-orange-100/50 transition-colors rotate-12">
                       <Timer size={140} />
                    </div>
                    <div className="w-16 h-16 bg-orange-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-orange-100 relative z-10">
                       <Activity size={32} strokeWidth={2.5} />
                    </div>
                    <div className="relative z-10">
                      <h3 className="text-2xl font-black text-gray-900 tracking-tight mb-2">Downtime Analysis</h3>
                      <p className="text-gray-500 text-sm font-medium leading-relaxed">Analyse des temps d'arrêt, pannes machines et maintenance préventive.</p>
                    </div>
                    <button 
                      onClick={() => exportToExcel('downtime')}
                      className="w-full py-4 bg-orange-600 text-white rounded-xl font-black shadow-xl shadow-orange-200 active:scale-95 transition-all flex items-center justify-center gap-3 relative z-10 text-xs tracking-[0.2em] uppercase"
                    >
                      <Download size={18} strokeWidth={3} />
                      Exporter Downtime
                    </button>
                 </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white w-full max-w-md rounded-3xl p-8 space-y-6 shadow-2xl border border-gray-100"
          >
            <div className="space-y-1">
              <h3 className="text-2xl font-black tracking-tight text-gray-900 uppercase italic">
                {editingId ? 'Modifier' : 'Nouveau'} {
                  modalType === 'user' ? 'Utilisateur' : 
                  modalType === 'machine' ? 'Machine' : 
                  modalType === 'line' ? 'Ligne' : 
                  modalType === 'programme' ? 'Programme' : 'Motif d\'Arrêt'}
              </h3>
              <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">Configuration Système</p>
            </div>

            <div className="space-y-4">
              {modalType === 'production_log' && (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Quantité (Palettes)</label>
                    <input 
                      type="number"
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={modalData.count || ''}
                      onChange={e => setModalData({...modalData, count: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Date & Heure</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={modalData.timestamp ? new Date(modalData.timestamp).toISOString().slice(0, 16) : ''}
                      onChange={e => setModalData({...modalData, timestamp: new Date(e.target.value).toISOString()})}
                    />
                  </div>
                </>
              )}

              {modalType === 'downtime_log' && (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Motif d'arrêt</label>
                    <select 
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-700"
                      value={modalData.typeId || ''}
                      onChange={e => setModalData({...modalData, typeId: e.target.value})}
                    >
                      <option value="">Sélectionner un motif</option>
                      {downtimeTypes.map(t => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Début</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={modalData.startTime ? new Date(modalData.startTime).toISOString().slice(0, 16) : ''}
                      onChange={e => {
                        const newStart = new Date(e.target.value).toISOString();
                        const duration = modalData.endTime ? (new Date(modalData.endTime).getTime() - new Date(newStart).getTime()) : modalData.duration;
                        setModalData({...modalData, startTime: newStart, duration});
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Fin</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={modalData.endTime ? new Date(modalData.endTime).toISOString().slice(0, 16) : ''}
                      onChange={e => {
                        const newEnd = new Date(e.target.value).toISOString();
                        const duration = new Date(newEnd).getTime() - new Date(modalData.startTime).getTime();
                        setModalData({...modalData, endTime: newEnd, duration});
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Description / Commentaire</label>
                    <textarea 
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={modalData.description || ''}
                      onChange={e => setModalData({...modalData, description: e.target.value})}
                    />
                  </div>
                </>
              )}

              {modalType === 'programme' && (
                <>
                  <input 
                    placeholder="Nom du programme (ex: PROD-202)"
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                    value={modalData.name || ''}
                    onChange={e => setModalData({...modalData, name: e.target.value})}
                  />
                  <select 
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-700"
                    value={modalData.machineId || ''}
                    onChange={e => setModalData({...modalData, machineId: e.target.value})}
                  >
                    <option value="">Choisir Machine</option>
                    {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <select 
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-700"
                    disabled={!modalData.machineId}
                    value={modalData.lineId || ''}
                    onChange={e => setModalData({...modalData, lineId: e.target.value})}
                  >
                    <option value="">Choisir Ligne</option>
                    {lines.filter(l => l.machineId === modalData.machineId).map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                  <input 
                    placeholder="Objectif (palettes)"
                    type="number"
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                    value={modalData.targetPallets || ''}
                    onChange={e => setModalData({...modalData, targetPallets: e.target.value})}
                  />
                </>
              )}

              {modalType === 'user' && (
                <>
                  <input 
                    placeholder="Nom complet"
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                    value={modalData.name || ''}
                    onChange={e => setModalData({...modalData, name: e.target.value})}
                  />
                  <input 
                    placeholder="PIN (4 chiffres)"
                    maxLength={4}
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                    value={modalData.pin || ''}
                    onChange={e => setModalData({...modalData, pin: e.target.value})}
                  />
                  <select 
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-700"
                    value={modalData.role || ''}
                    onChange={e => setModalData({...modalData, role: e.target.value})}
                  >
                    <option value="">Choisir un rôle</option>
                    <option value="OPERATOR">Opérateur</option>
                    <option value="PILOT">Pilote Machine</option>
                    <option value="ADMIN">Administrateur</option>
                  </select>
                </>
              )}

              {(modalType === 'machine' || modalType === 'line') && (
                <input 
                  placeholder={modalType === 'machine' ? "Nom de la machine" : "Nom de la ligne"}
                  className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                  value={modalData.name || ''}
                  onChange={e => setModalData({...modalData, name: e.target.value})}
                />
              )}

              {modalType === 'downtime' && (
                <>
                  <input 
                    placeholder="Nom du motif"
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                    value={modalData.name || ''}
                    onChange={e => setModalData({...modalData, name: e.target.value})}
                  />
                  <input 
                    placeholder="Emoji (ex: 🛠️)"
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                    value={modalData.icon || ''}
                    onChange={e => setModalData({...modalData, icon: e.target.value})}
                  />
                </>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="flex-1 py-4 font-black text-gray-400 hover:bg-gray-50 rounded-2xl transition-all uppercase text-[10px] tracking-widest"
              >
                Annuler
              </button>
              <button 
                onClick={handleModalSubmit}
                className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-100 active:scale-95 transition-all uppercase text-[10px] tracking-widest"
              >
                Enregistrer
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[110] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white w-full max-w-sm rounded-[32px] p-8 text-center space-y-6 shadow-2xl border border-red-100"
          >
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto text-red-500 mb-2">
              <Trash2 size={40} strokeWidth={2.5} />
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-black text-gray-900 tracking-tight italic uppercase">Supprimer ?</h3>
              <p className="text-gray-500 font-medium">Êtes-vous sûr de vouloir supprimer <span className="text-red-600 font-black italic">{confirmDelete.name}</span> ? Cette action est irréversible.</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-4 font-black text-gray-400 hover:bg-gray-50 rounded-2xl transition-all uppercase text-[10px] tracking-widest"
              >
                Annuler
              </button>
              <button 
                onClick={deleteItem}
                className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-black shadow-xl shadow-red-200 active:scale-95 transition-all uppercase text-[10px] tracking-widest"
              >
                Confirmer
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
