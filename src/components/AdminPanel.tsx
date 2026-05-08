import { useState, useEffect } from 'react';
import { localApi } from '../lib/localApi';
import { useAuth } from '../contexts/AuthContext';
import { User as AppUser, Machine, Line, Programme, DowntimeType, ProductionLog, DowntimeLog } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, Factory, Package, Timer, History, 
  Download, Plus, Trash2, PieChart, LayoutDashboard,
  Box, Terminal, Activity, Pencil, Menu, X
} from 'lucide-react';
import { cn } from '../lib/utils';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

export default function AdminPanel() {
  const { logout } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
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
    const unsubUsers = localApi.onSnapshot('users', setUsers);
    const unsubMachines = localApi.onSnapshot('machines', setMachines);
    const unsubLines = localApi.onSnapshot('lines', setLines);
    const unsubProgs = localApi.onSnapshot('programmes', setProgrammes);
    const unsubTypes = localApi.onSnapshot('downtime_types', setDowntimeTypes);
    const unsubProd = localApi.onSnapshot('production_logs', setProdLogs);
    const unsubDown = localApi.onSnapshot('downtime_logs', setDownLogs);
    
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
      if (modalType === 'production_log' && finalData.count) {
        finalData.count = parseInt(finalData.count);
      }
      if (modalType === 'downtime_log') {
        if (finalData.duration) finalData.duration = parseInt(finalData.duration);
      }
      if (modalType === 'downtime' && !finalData.icon) {
        finalData.icon = '⚠️';
      }
      if (modalType === 'line') {
        const machineIdToUse = selectedMachineForLine || modalData.machineId;
        if (machineIdToUse) {
          finalData.machineId = machineIdToUse;
          // Robust conversion for tracksProduction
          // If it's explicitly boolean false or number 0, it's 0. Otherwise (true, 1, undefined) it's 1.
          finalData.tracksProduction = (modalData.tracksProduction === false || modalData.tracksProduction === 0) ? 0 : 1;
        }
        if (!editingId) finalData.status = 'IDLE';
      }

      if (editingId) {
        const { id, ...dataToSave } = finalData;
        
        // Handle Production Log updates (integrity)
        if (modalType === 'production_log') {
          const oldLog = prodLogs.find(l => l.id === editingId);
          if (oldLog && oldLog.count !== dataToSave.count) {
            const diff = dataToSave.count - oldLog.count;
            const prog = programmes.find(p => p.id === oldLog.programmeId);
            if (prog) {
              await localApi.updateDoc('programmes', oldLog.programmeId, {
                producedPallets: (prog.producedPallets || 0) + diff
              });
            }
          }
        }

        await localApi.updateDoc(collectionName, editingId, dataToSave);
        
        if (modalType === 'programme') {
          if (dataToSave.status === 'FINISHED') {
            const targetLine = lines.find(l => l.currentProgrammeId === editingId);
            if (targetLine) {
              await localApi.updateDoc('lines', targetLine.id, {
                currentProgrammeId: null,
                status: 'IDLE',
                currentOperatorId: null
              });
            }
          } else if (dataToSave.lineId) {
            await localApi.updateDoc('lines', dataToSave.lineId, {
              currentProgrammeId: editingId
            });
          }
        }
      } else {
        if (modalType === 'programme') {
          const newProg = {
            ...finalData,
            producedPallets: 0,
            status: 'ACTIVE' as const,
            createdAt: new Date().toISOString()
          };
          const progRef = await localApi.addDoc('programmes', newProg);
          if (finalData.lineId) {
            await localApi.updateDoc('lines', finalData.lineId, {
              currentProgrammeId: progRef.id,
              status: 'IDLE'
            });
          }
        } else {
          await localApi.addDoc(collectionName, finalData);
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
        const logData = prodLogs.find(l => l.id === id);
        if (logData) {
          const prog = programmes.find(p => p.id === logData.programmeId);
          if (prog) {
            await localApi.updateDoc('programmes', logData.programmeId, {
              producedPallets: (prog.producedPallets || 0) - logData.count
            });
          }
        }
      }

      if (col === 'downtime_logs') {
        const logData = downLogs.find(l => l.id === id);
        if (logData) {
          if (!logData.endTime) {
            await localApi.updateDoc('lines', logData.lineId, {
              activeDowntimeId: null,
              status: 'IDLE'
            });
          }
        }
      }

      if (col === 'programmes') {
        const line = lines.find(l => l.currentProgrammeId === id);
        if (line) {
          await localApi.updateDoc('lines', line.id, {
            currentProgrammeId: null,
            status: 'IDLE',
            currentOperatorId: null
          });
        }
      }

      await localApi.deleteDoc(col, id);
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
      dashboardSheet.getRow(currentRow).values = ['Programme', 'Réalisé'];
      dashboardSheet.getRow(currentRow).font = { bold: true };
      currentRow++;

      programmes.filter(p => prodLogs.some(l => l.programmeId === p.id)).forEach(p => {
        const prod = prodLogs.filter(l => l.programmeId === p.id).reduce((acc, l) => acc + l.count, 0);
        dashboardSheet.getRow(currentRow).values = [
          p.name, 
          prod
        ];
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
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col md:flex-row">
      {/* MOBILE HEADER */}
      <header className="md:hidden bg-white border-b border-gray-200 px-3 py-1 flex justify-between items-center sticky top-0 z-40 shadow-sm">
        <div className="flex items-center gap-1.5">
          <button 
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-1 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {isMobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="flex items-center gap-1">
            <div className="bg-blue-600 p-1 rounded-md text-white">
              <Terminal size={12} />
            </div>
            <h1 className="font-black text-sm tracking-tighter text-gray-900 leading-none">FACTORY<span className="text-blue-600">CLOUD</span></h1>
          </div>
        </div>
        <button 
          onClick={logout}
          className="p-1 px-1.5 text-red-500 bg-red-50 rounded-lg transition-colors font-black text-[8px] uppercase border border-red-50"
        >
          LOGOUT
        </button>
      </header>

      {/* SIDEBAR (Desktop) & SLIDING MENU (Mobile) */}
      <AnimatePresence>
        {(isMobileMenuOpen || window.innerWidth >= 768) && (
          <>
            {/* Backdrop for mobile */}
            {isMobileMenuOpen && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsMobileMenuOpen(false)}
                className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden"
              />
            )}
            
            <motion.aside 
              initial={window.innerWidth < 768 ? { x: -280 } : false}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className={cn(
                "bg-white w-64 md:w-56 min-h-screen border-r border-gray-200 p-4 shrink-0 flex flex-col gap-6 z-50 transition-all overflow-y-auto",
                "fixed inset-y-0 left-0 md:sticky md:top-0",
                !isMobileMenuOpen && "hidden md:flex"
              )}
            >
              <div className="flex items-center gap-2 px-1">
                <div className="bg-blue-600 p-1.5 rounded-lg text-white">
                  <Terminal size={16} />
                </div>
                <h1 className="font-black text-lg tracking-tighter text-gray-900 leading-none capitalize italic">FACTORY<br/><span className="text-blue-600">CLOUD</span></h1>
              </div>
              
              <nav className="flex flex-col gap-1 flex-1">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setIsMobileMenuOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                      activeTab === tab.id 
                        ? "bg-blue-600 text-white shadow-lg shadow-blue-50" 
                        : "text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                    )}
                  >
                    <tab.icon size={16} strokeWidth={2.5} />
                    {tab.label}
                  </button>
                ))}
                
                <div className="mt-auto pt-4 border-t border-gray-100">
                  <button 
                    onClick={logout}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-50 w-full transition-colors"
                  >
                    <Trash2 size={14} strokeWidth={2.5} />
                    Quitter
                  </button>
                </div>
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-2 md:p-6 overflow-y-auto">
        <div className="max-w-6xl mx-auto space-y-3 md:space-y-6">
          
          {activeTab === 'dashboard' && (
            <div className="space-y-3 md:space-y-6 animate-in fade-in duration-300">
              <div className="flex justify-between items-center px-1">
                <h2 className="text-base md:text-lg font-black tracking-tighter text-gray-900 leading-none">Dashboard <span className="text-blue-600 uppercase text-[10px] md:text-xs">Live</span></h2>
                  <div className="text-right flex flex-col items-end">
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
                      <p className="text-[7px] md:text-[8px] font-black text-green-600 uppercase tracking-tight">Connecté</p>
                    </div>
                  </div>
              </div>

              <motion.div 
                variants={container}
                initial="hidden"
                animate="show"
                className="grid grid-cols-2 lg:grid-cols-4 gap-1 md:gap-4"
              >
                 {[
                   { label: 'Palettes / Jour', val: prodLogs.reduce((acc, l) => acc + l.count, 0), icon: Box, color: 'blue' },
                   { label: 'Lignes Actives', val: lines.filter(l => l.status === 'RUNNING').length, icon: Activity, color: 'green' },
                   { label: 'Arrêts en cours', val: lines.filter(l => !!l.activeDowntimeId).length, icon: Timer, color: 'orange' },
                   { label: 'Effectif total', val: users.length, icon: Users, color: 'gray' },
                 ].map(stat => (
                   <motion.div 
                    variants={item}
                    key={stat.label} 
                    className="card p-1 md:p-3 flex items-center gap-1.5 md:gap-4 hover:shadow-md transition-shadow group cursor-default"
                   >
                     <div className={cn(
                       "w-7 h-7 md:w-10 md:h-10 rounded-lg md:rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm border border-black/5 shrink-0",
                       stat.color === 'blue' ? "bg-blue-600 text-white" :
                       stat.color === 'green' ? "bg-green-600 text-white" :
                       stat.color === 'orange' ? "bg-orange-600 text-white" : "bg-slate-600 text-white"
                     )}>
                       <stat.icon className="w-3 h-3 md:w-5 md:h-5" strokeWidth={2.5} />
                     </div>
                     <div>
                       <p className="text-[6px] md:text-[9px] font-black text-slate-400 uppercase tracking-tighter mb-0.5 leading-none">{stat.label}</p>
                       <p className="text-[11px] md:text-xl font-black text-slate-900 leading-none tabular-nums mt-0.5">{stat.val}</p>
                     </div>
                   </motion.div>
                 ))}
              </motion.div>

              <div className="card overflow-hidden">
                 <div className="px-3 py-2 md:px-6 md:py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                   <h3 className="text-[10px] md:text-sm font-black uppercase tracking-widest text-gray-900">Monitor de Production Live</h3>
                   <div className="flex gap-2">
                      <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" /><span className="text-[8px] md:text-[10px] font-bold text-gray-400 uppercase">Prod</span></div>
                      <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /><span className="text-[8px] md:text-[10px] font-bold text-gray-400 uppercase">Arrêt</span></div>
                   </div>
                 </div>
                 <div className="overflow-x-auto">
                   <table className="w-full text-left">
                     <thead className="bg-white text-[7px] md:text-[10px] text-gray-400 font-black uppercase tracking-wider md:tracking-[0.2em] border-b border-gray-100">
                       <tr>
                         <th className="px-1 md:px-6 py-2 md:py-5">Ligne</th>
                         <th className="px-1 md:px-6 py-2 md:py-5">Stat.</th>
                         <th className="px-1 md:px-6 py-2 md:py-5">Pal.</th>
                         <th className="px-1 md:px-6 py-2 md:py-5 text-right md:text-left">Op.</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-gray-50">
                        {lines.map(l => {
                          const prog = programmes.find(p => p.id === l.currentProgrammeId);
                          const op = users.find(u => u.id === l.currentOperatorId);
                          const mach = machines.find(m => m.id === l.machineId);
                          return (
                            <tr key={l.id} className="text-[9px] md:text-sm hover:bg-gray-50/50 transition-colors">
                              <td className="px-1 md:px-6 py-2 md:py-5">
                                <p className="font-black text-gray-900 leading-none mb-0.5 whitespace-nowrap">{l.name}</p>
                                <p className="text-[7.5px] font-bold text-blue-500 uppercase tracking-tight truncate max-w-[40px] md:max-w-none">{mach?.name}</p>
                              </td>
                              <td className="px-1 md:px-6 py-2 md:py-5">
                                 <span className={cn(
                                   "px-0.5 md:px-2 py-0.5 md:py-1 rounded text-[6.5px] md:text-[9px] font-black uppercase tracking-tight",
                                   l.status === 'RUNNING' ? "bg-status-running-bg text-status-running-text" :
                                   l.status === 'STOPPED' ? "bg-status-stopped-bg text-status-stopped-text" : "bg-status-idle-bg text-status-idle-text"
                                 )}>{l.status === 'RUNNING' ? 'OK' : l.status?.substring(0, 4)}</span>
                              </td>
                              <td className="px-1 md:px-6 py-2 md:py-5">
                                <p className="text-[10px] md:text-sm font-black text-blue-600 italic leading-none">{prog?.producedPallets || 0}</p>
                              </td>
                              <td className="px-1 md:px-6 py-2 md:py-5">
                                <div className="flex items-center justify-end md:justify-start gap-1">
                                  <div className="w-3.5 h-3.5 md:w-6 md:h-6 bg-gray-100 rounded flex items-center justify-center text-[7px] md:text-[10px] font-bold text-gray-500 shrink-0">
                                    {op?.name?.substring(0, 1).toUpperCase() || '—'}
                                  </div>
                                  <span className="text-gray-600 font-bold truncate max-w-[30px] md:max-w-none text-[8px] md:text-xs">{(op?.name || '—').split(' ')[0]}</span>
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
            <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
              <div className="flex justify-between items-center px-1">
                <h2 className="text-lg md:text-xl font-black tracking-tighter text-gray-900 leading-none">Utilisateurs</h2>
                <button 
                  onClick={() => openModal('user')}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-black shadow-lg shadow-blue-50 active:scale-95 transition-all text-[9px] md:text-[10px] tracking-widest uppercase flex items-center gap-1"
                >
                  <Plus size={12} strokeWidth={3} /> AJOUTER
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-4">
                {users.map(u => (
                  <div key={u.id} className="card p-2 md:p-4 group flex justify-between items-center hover:border-blue-200 transition-colors">
                    <div className="flex items-center gap-2 md:gap-3">
                      <div className={cn(
                        "w-8 h-8 md:w-10 md:h-10 rounded-lg flex items-center justify-center font-black text-xs md:text-sm",
                        u.role === 'ADMIN' ? "bg-red-50 text-red-600" :
                        u.role === 'PILOT' ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-600"
                      )}>
                        {u.name?.substring(0, 1) || '?'}
                      </div>
                      <div>
                        <p className="font-black text-[10px] md:text-sm text-gray-900 leading-tight">{u.name}</p>
                        <p className="text-[8px] md:text-[9px] font-black text-gray-400 uppercase tracking-tighter mt-0.5">PIN: <span className="bg-gray-100 px-1 rounded text-gray-600 font-mono">{u.pin}</span> • {u.role}</p>
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      <button onClick={() => openModal('user', u)} className="text-gray-300 hover:text-blue-600 transition-colors p-1.5">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => initiateDelete('users', u.id, u.name)} className="text-gray-300 hover:text-red-500 transition-colors p-1.5">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'machines' && (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              <div className="space-y-4">
                <div className="flex justify-between items-center px-1">
                  <h2 className="text-lg md:text-xl font-black tracking-tighter text-gray-900 leading-none">Parc Machine</h2>
                  <button 
                     onClick={() => openModal('machine')}
                     className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-black shadow-lg shadow-blue-50 active:scale-95 transition-all text-[9px] md:text-[10px] tracking-widest uppercase"
                  >
                     + MACHINE
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                   {machines.map(m => (
                    <div key={m.id} className="card p-3 md:p-4 flex flex-col gap-3 md:gap-4">
                      <div className="flex justify-between items-center">
                        <h3 className="font-black text-base md:text-lg italic tracking-tighter text-gray-900">{m.name}</h3>
                        <div className="flex gap-1.5 items-center">
                           <button 
                             onClick={() => openModal('line', { machineId: m.id })}
                             className="px-1.5 py-1 bg-blue-50 text-blue-600 rounded-md text-[8px] md:text-[9px] font-black uppercase tracking-tight hover:bg-blue-100 transition-all border border-blue-100 shrink-0"
                           >
                             + Ligne
                           </button>
                           <button onClick={() => openModal('machine', m)} className="text-gray-300 hover:text-blue-600 p-1 transition-colors"><Pencil size={14} /></button>
                           <button onClick={() => initiateDelete('machines', m.id, m.name)} className="text-gray-300 hover:text-red-500 p-1 transition-colors"><Trash2 size={14} /></button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-tighter leading-none">Pilote actuel</p>
                        <div className="flex items-center justify-between bg-blue-50/30 p-1.5 rounded-md border border-blue-100/50">
                          <span className="text-[10px] md:text-sm font-bold text-blue-900">{users.find(u => u.id === m.currentPilotId)?.name || 'Libre'}</span>
                          {m.currentPilotId && (
                            <button 
                              onClick={() => localApi.updateDoc('machines', m.id, { currentPilotId: null })}
                              className="text-[8px] font-black text-red-500 hover:underline uppercase"
                            >
                              Libérer
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-tighter">Lignes</p>
                        <div className="flex flex-wrap gap-1.5">
                          {lines.filter(l => l.machineId === m.id).map(l => (
                            <div key={l.id} className="bg-gray-50 border border-gray-100 px-1.5 py-1 rounded flex items-center gap-1.5 group/line transition-all hover:bg-white">
                              <span className="text-[9px] md:text-xs font-bold text-gray-700">{l.name}</span>
                              <div className="flex gap-0.5">
                                <button onClick={() => openModal('line', l)} className="text-gray-300 hover:text-blue-500 opacity-50 sm:opacity-0 group-hover/line:opacity-100 transition-opacity">
                                  <Pencil size={10} />
                                </button>
                                <button onClick={() => initiateDelete('lines', l.id, l.name)} className="text-gray-300 hover:text-red-500 opacity-50 sm:opacity-0 group-hover/line:opacity-100 transition-opacity">
                                  <Trash2 size={10} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'programmes' && (
            <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
              <div className="flex justify-between items-center px-1">
                <h2 className="text-lg md:text-xl font-black tracking-tighter text-gray-900 leading-none">Programmes</h2>
                <button 
                  onClick={() => openModal('programme')}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-black shadow-lg shadow-blue-50 active:scale-95 transition-all text-[9px] md:text-[10px] tracking-widest uppercase flex items-center gap-1"
                >
                  <Plus size={12} strokeWidth={3} /> NOUVEAU
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-4">
                {programmes.map(p => (
                  <div key={p.id} className={cn(
                    "card p-3 md:p-4 border-l-4 transition-all",
                    p.status === 'ACTIVE' ? "border-blue-500" : "border-gray-300 opacity-60"
                  )}>
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-tighter">{machines.find(m => m.id === p.machineId)?.name} • {lines.find(l => l.id === p.lineId)?.name}</p>
                        <h3 className="font-black text-sm md:text-base text-gray-900 leading-tight">{p.name}</h3>
                      </div>
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[7px] font-black uppercase tracking-tighter",
                        p.status === 'ACTIVE' ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
                      )}>{p.status}</span>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] md:text-xs font-bold">
                        <span className="text-gray-500">{p.producedPallets} palettes</span>
                      </div>
                    </div>
                    <div className="mt-3 pt-2 border-t border-gray-50 flex justify-between items-center">
                       <p className="text-[8px] font-bold text-gray-400">{new Date(p.createdAt).toLocaleDateString()}</p>
                       <div className="flex gap-1">
                          <button onClick={() => openModal('programme', p)} className="text-gray-300 hover:text-blue-500 p-1"><Pencil size={12} /></button>
                          <button onClick={() => initiateDelete('programmes', p.id, p.name)} className="text-gray-300 hover:text-red-500 p-1"><Trash2 size={12} /></button>
                       </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        {activeTab === 'types' && (
            <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
              <div className="flex justify-between items-center px-1">
                <h2 className="text-lg md:text-xl font-black tracking-tighter text-gray-900 leading-none">Motifs d'Arrêt</h2>
                <button 
                  onClick={() => openModal('downtime')}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-black shadow-lg shadow-blue-50 active:scale-95 transition-all text-[9px] md:text-[10px] tracking-widest uppercase"
                >
                  NOUVEAU
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 md:gap-4">
                {downtimeTypes.map(t => (
                  <div key={t.id} className="card p-2 md:p-4 text-center animate-in zoom-in-95 group relative hover:border-orange-200 transition-all">
                    <div className="text-2xl md:text-3xl mb-2 grayscale group-hover:grayscale-0 transition-all">{t.icon || '⚠️'}</div>
                    <p className="font-black text-[9px] md:text-[10px] uppercase tracking-widest text-gray-700 leading-tight">{t.name}</p>
                    <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                      <button onClick={() => openModal('downtime', t)} className="text-gray-300 hover:text-blue-500 p-1">
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => initiateDelete('downtime_types', t.id, t.name)} className="text-gray-300 hover:text-red-500 p-1">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
              <div className="flex justify-between items-center px-1">
                <h2 className="text-lg md:text-xl font-black tracking-tighter text-gray-900 leading-none">Historique</h2>
              </div>

              <div className="space-y-6 md:space-y-8">
                {/* Production Logs History */}
                <div className="space-y-2">
                  <h3 className="text-xs md:text-sm font-black text-gray-900 flex items-center gap-2 uppercase tracking-widest">
                    <Package className="text-blue-600" size={16} />
                    Production Log
                  </h3>
                  <div className="card overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                      <thead className="bg-gray-50 text-[7px] md:text-[9px] text-gray-400 font-black uppercase tracking-wider border-b border-gray-100">
                        <tr>
                          <th className="px-2 md:px-6 py-2 md:py-3">Heure</th>
                          <th className="px-2 md:px-6 py-2 md:py-3 hidden sm:table-cell">Ligne</th>
                          <th className="px-2 md:px-6 py-2 md:py-3">Prog.</th>
                          <th className="px-2 md:px-6 py-2 md:py-3 hidden md:table-cell">Opérateur</th>
                          <th className="px-2 md:px-6 py-2 md:py-3 text-center">Qté</th>
                          <th className="px-2 md:px-6 py-2 md:py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-[9px] md:text-xs">
                        <AnimatePresence mode="popLayout">
                          {prodLogs.map(log => (
                            <motion.tr 
                              key={log.id} 
                              initial={{ opacity: 1 }}
                              exit={{ opacity: 0, x: -20, backgroundColor: 'rgba(254, 226, 226, 0.5)' }}
                              transition={{ duration: 0.2 }}
                              className="hover:bg-gray-50/50"
                            >
                              <td className="px-2 md:px-6 py-2 md:py-3 font-medium text-gray-900">
                                {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="px-2 md:px-6 py-2 md:py-3 hidden sm:table-cell">
                                <p className="font-bold text-gray-800">{machines.find(m => m.id === log.machineId)?.name || '—'}</p>
                                <p className="text-[7px] md:text-[8px] font-bold text-gray-400 uppercase tracking-tighter">{lines.find(l => l.id === log.lineId)?.name || '—'}</p>
                              </td>
                              <td className="px-2 md:px-6 py-2 md:py-3 text-blue-600 font-bold truncate max-w-[60px] md:max-w-none">
                                {programmes.find(p => p.id === log.programmeId)?.name || '—'}
                              </td>
                              <td className="px-2 md:px-6 py-2 md:py-3 font-medium hidden md:table-cell">
                                {users.find(u => u.id === log.operatorId)?.name || '—'}
                              </td>
                              <td className="px-2 md:px-6 py-2 md:py-3 text-center">
                                <span className="bg-blue-50 text-blue-700 px-1 py-0.5 rounded font-black">{log.count}</span>
                              </td>
                              <td className="px-2 md:px-6 py-2 md:py-3 text-right">
                                <div className="flex justify-end gap-1">
                                  <button onClick={() => openModal('production_log', log)} className="text-gray-300 hover:text-blue-600 p-1"><Pencil className="w-3 h-3 md:w-3.5 md:h-3.5" /></button>
                                  <button onClick={() => initiateDelete('production_logs', log.id, `Production de ${log.count} palettes`)} className="text-gray-300 hover:text-red-500 p-1"><Trash2 className="w-3 h-3 md:w-3.5 md:h-3.5" /></button>
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
                <div className="space-y-2">
                  <h3 className="text-xs md:text-sm font-black text-gray-900 flex items-center gap-2 uppercase tracking-widest">
                    <Timer className="text-orange-600" size={16} />
                    Arrêts Log
                  </h3>
                  <div className="card overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                      <thead className="bg-gray-50 text-[7px] md:text-[9px] text-gray-400 font-black uppercase tracking-wider border-b border-gray-100">
                        <tr>
                          <th className="px-2 md:px-6 py-2 md:py-3">Heure</th>
                          <th className="px-2 md:px-6 py-2 md:py-3">Fin</th>
                          <th className="px-2 md:px-6 py-2 md:py-3">Motif</th>
                          <th className="px-2 md:px-6 py-2 md:py-3 hidden sm:table-cell">Ligne</th>
                          <th className="px-2 md:px-6 py-2 md:py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 text-[9px] md:text-xs">
                        <AnimatePresence mode="popLayout">
                          {downLogs.map(log => (
                            <motion.tr 
                              key={log.id} 
                              initial={{ opacity: 1 }}
                              exit={{ opacity: 0, x: -20, backgroundColor: 'rgba(254, 226, 226, 0.5)' }}
                              transition={{ duration: 0.2 }}
                              className="hover:bg-gray-50/50"
                            >
                              <td className="px-2 md:px-6 py-2 md:py-3 font-medium text-gray-900">
                                {new Date(log.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className="px-2 md:px-6 py-2 md:py-3 font-medium text-gray-600">
                                {log.endTime ? new Date(log.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : <span className="text-orange-500 animate-pulse font-black uppercase text-[7px] md:text-[9px]">Active</span>}
                              </td>
                              <td className="px-2 md:px-6 py-2 md:py-3">
                                <div className="flex items-center gap-1">
                                  <span className="text-sm">{downtimeTypes.find(t => t.id === log.typeId)?.icon || '⚠️'}</span>
                                  <p className="font-bold text-gray-800 truncate max-w-[60px] md:max-w-none">{downtimeTypes.find(t => t.id === log.typeId)?.name || '—'}</p>
                                </div>
                              </td>
                              <td className="px-2 md:px-6 py-2 md:py-3 hidden sm:table-cell">
                                <p className="font-bold text-gray-800">{machines.find(m => m.id === log.machineId)?.name || '—'}</p>
                                <p className="text-[7px] md:text-[8px] font-bold text-gray-400 uppercase tracking-tighter">{lines.find(l => l.id === log.lineId)?.name || '—'}</p>
                              </td>
                              <td className="px-2 md:px-6 py-2 md:py-3 text-right">
                                <div className="flex justify-end gap-1">
                                  <button onClick={() => openModal('downtime_log', log)} className="text-gray-300 hover:text-blue-600 p-1"><Pencil className="w-3 h-3 md:w-3.5 md:h-3.5" /></button>
                                  <button onClick={() => initiateDelete('downtime_logs', log.id, `Arrêt ${downtimeTypes.find(t => t.id === log.typeId)?.name}`)} className="text-gray-300 hover:text-red-500 p-1"><Trash2 className="w-3 h-3 md:w-3.5 md:h-3.5" /></button>
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
            <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
              <div className="px-1">
                <h2 className="text-lg md:text-xl font-black tracking-tighter text-gray-900 leading-none">Exports</h2>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                 <div className="card p-4 md:p-6 flex flex-col gap-4 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 text-blue-50/50 group-hover:text-blue-100/50 transition-colors rotate-12">
                       <Package size={80} />
                    </div>
                    <div className="w-10 h-10 bg-blue-600 text-white rounded-xl flex items-center justify-center shadow-lg shadow-blue-100 relative z-10">
                       <History size={20} strokeWidth={2.5} />
                    </div>
                    <div className="relative z-10">
                      <h3 className="text-base font-black text-gray-900 tracking-tight mb-1">Production Logs</h3>
                      <p className="text-gray-500 text-[10px] md:text-xs font-medium leading-tight">Historique détaillé des palettes déclarées.</p>
                    </div>
                    <button 
                      onClick={() => exportToExcel('production')}
                      className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-black shadow-lg shadow-blue-50 active:scale-95 transition-all flex items-center justify-center gap-2 relative z-10 text-[9px] tracking-widest uppercase"
                    >
                      <Download size={14} strokeWidth={3} />
                      Exporter
                    </button>
                 </div>

                 <div className="card p-4 md:p-6 flex flex-col gap-4 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 text-orange-50/50 group-hover:text-orange-100/50 transition-colors rotate-12">
                       <Timer size={80} />
                    </div>
                    <div className="w-10 h-10 bg-orange-600 text-white rounded-xl flex items-center justify-center shadow-lg shadow-orange-100 relative z-10">
                       <Activity size={20} strokeWidth={2.5} />
                    </div>
                    <div className="relative z-10">
                      <h3 className="text-base font-black text-gray-900 tracking-tight mb-1">Downtime Analysis</h3>
                      <p className="text-gray-500 text-[10px] md:text-xs font-medium leading-tight">Analyse des temps d'arrêt et pannes.</p>
                    </div>
                    <button 
                      onClick={() => exportToExcel('downtime')}
                      className="w-full py-2.5 bg-orange-600 text-white rounded-lg font-black shadow-lg shadow-orange-50 active:scale-95 transition-all flex items-center justify-center gap-2 relative z-10 text-[9px] tracking-widest uppercase"
                    >
                      <Download size={14} strokeWidth={3} />
                      Exporter
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
            className="bg-white w-full max-w-sm rounded-3xl p-5 space-y-4 shadow-2xl border border-gray-100"
          >
            <div className="space-y-0.5">
              <h3 className="text-base font-black tracking-tight text-gray-900 uppercase italic leading-none">
                {editingId ? 'Modifier' : 'Nouveau'} {
                  modalType === 'user' ? 'Utilisateur' : 
                  modalType === 'machine' ? 'Machine' : 
                  modalType === 'line' ? 'Ligne' : 
                  modalType === 'programme' ? 'Programme' : 'Motif d\'Arrêt'}
              </h3>
              <p className="text-[7px] text-gray-400 font-black uppercase tracking-widest">Configuration</p>
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
                  {editingId && (
                    <select 
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-700"
                      value={modalData.status || 'ACTIVE'}
                      onChange={e => setModalData({...modalData, status: e.target.value})}
                    >
                      <option value="ACTIVE">ACTIF</option>
                      <option value="FINISHED">CLÔTURÉ</option>
                    </select>
                  )}
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
                <>
                  <input 
                    placeholder={modalType === 'machine' ? "Nom de la machine" : "Nom de la ligne"}
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                    value={modalData.name || ''}
                    onChange={e => setModalData({...modalData, name: e.target.value})}
                  />
                  {modalType === 'line' && (
                    <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <input 
                        type="checkbox"
                        id="tracksProduction"
                        className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        checked={modalData.tracksProduction !== false}
                        onChange={e => setModalData({...modalData, tracksProduction: e.target.checked})}
                      />
                      <label htmlFor="tracksProduction" className="text-sm font-bold text-gray-700">Suivi de production (Palettes)</label>
                    </div>
                  )}
                </>
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
