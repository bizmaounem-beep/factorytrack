import { useState, useEffect, useMemo } from 'react';
import { localApi } from '../lib/localApi';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useLanguage } from '../contexts/LanguageContext';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, Factory, Package, Timer, History, 
  Download, Plus, Trash2, LayoutDashboard,
  Box, Terminal, Activity, Pencil, Menu, X, Clock,
  TrendingUp, AlertTriangle, CheckCircle2
} from 'lucide-react';
import { cn, formatDuration, formatMinutes, formatDowntimeDisplay, getLogDurationSec } from '../lib/utils';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { format, startOfDay, endOfDay, isWithinInterval, parseISO } from 'date-fns';

export default function AdminPanel() {
  const { logout } = useAuth();
  const { t } = useLanguage();
  const { 
    users, 
    machines, 
    lines, 
    programmes, 
    shifts,
    downtimeTypes, 
    productionLogs: prodLogs, 
    downtimeLogs: downLogs 
  } = useData();

  const sortedProdLogs = useMemo(() => [...prodLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()), [prodLogs]);
  const sortedDownLogs = useMemo(() => [...downLogs].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()), [downLogs]);

  // Analytics Calculations
  const analytics = useMemo(() => {
    const today = new Date();
    const start = startOfDay(today);
    const end = endOfDay(today);

    const todayProd = prodLogs.filter(l => isWithinInterval(parseISO(logDate(l.timestamp)), { start, end }));
    const todayDown = downLogs.filter(l => isWithinInterval(parseISO(logDate(l.startTime)), { start, end }));

    function logDate(iso: string) {
      return iso.includes('T') ? iso : new Date(iso).toISOString();
    }

    const totalPallets = todayProd.reduce((acc, l) => acc + l.count, 0);
    const totalDowntimeSec = todayDown.reduce((acc, l) => acc + getLogDurationSec(l), 0);
    
    // OEE Approximation (Availability focuses on running vs stopped)
    // We'll calculate it for the last 8 hours as a baseline if we don't have a better window
    const totalPossibleTime = lines.length * 8 * 60 * 60; // total seconds for all lines in 8h
    const uptimeSec = Math.max(0, totalPossibleTime - totalDowntimeSec);
    const availability = totalPossibleTime > 0 ? (uptimeSec / totalPossibleTime) * 100 : 0;

    // Shift Performance
    const shiftPerf = shifts.map(s => {
      const pallets = prodLogs
        .filter(l => l.shiftId === s.id && isWithinInterval(parseISO(logDate(l.timestamp)), { start, end }))
        .reduce((acc, l) => acc + l.count, 0);
      const downtime = downLogs
        .filter(l => l.shiftId === s.id && isWithinInterval(parseISO(logDate(l.startTime)), { start, end }))
        .reduce((acc, l) => acc + getLogDurationSec(l), 0);
      
      return {
        name: s.name,
        pallets,
        downtime: Math.round(downtime / 60)
      };
    });

    return {
      totalPallets,
      totalDowntimeSec,
      availability,
      shiftPerf
    };
  }, [prodLogs, downLogs, lines, shifts, downtimeTypes]);

  const COLORS = ['#3B82F6', '#EF4444', '#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6'];

  const [historyMachineFilter, setHistoryMachineFilter] = useState<string>(() => sessionStorage.getItem('admin_history_machine') || '');
  const [historyLineFilter, setHistoryLineFilter] = useState<string>(() => sessionStorage.getItem('admin_history_line') || '');
  const [historyShiftFilter, setHistoryShiftFilter] = useState<string>(() => sessionStorage.getItem('admin_history_shift') || '');
  const [historyOperatorFilter, setHistoryOperatorFilter] = useState<string>(() => sessionStorage.getItem('admin_history_operator') || '');
  const [historyDateFilter, setHistoryDateFilter] = useState<string>(() => sessionStorage.getItem('admin_history_date') || '');
  const [historyLogType, setHistoryLogType] = useState<'production' | 'downtime'>(() => (sessionStorage.getItem('admin_history_type') as any) || 'production');
  const [activeTab, setActiveTab] = useState(() => sessionStorage.getItem('admin_active_tab') || 'dashboard');

  useEffect(() => {
    sessionStorage.setItem('admin_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    sessionStorage.setItem('admin_history_machine', historyMachineFilter);
    sessionStorage.setItem('admin_history_line', historyLineFilter);
    sessionStorage.setItem('admin_history_shift', historyShiftFilter);
    sessionStorage.setItem('admin_history_operator', historyOperatorFilter);
    sessionStorage.setItem('admin_history_date', historyDateFilter);
    sessionStorage.setItem('admin_history_type', historyLogType);
  }, [historyMachineFilter, historyLineFilter, historyShiftFilter, historyOperatorFilter, historyDateFilter, historyLogType]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalType, setModalType] = useState<'user' | 'machine' | 'line' | 'downtime' | 'programme' | 'production_log' | 'downtime_log' | 'shift'>('user');
  const [modalData, setModalData] = useState<any>({});
  const [selectedMachineForLine, setSelectedMachineForLine] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{col: string, id: string, name: string} | null>(null);

  const openModal = (type: typeof modalType, data: any = {}) => {
    setModalType(type);
    // When editing a user, we don't want to show the hashed PIN
    const cleanData = type === 'user' && data.id ? { ...data, pin: '' } : { ...data };
    setModalData(cleanData);
    setEditingId(data.id || null);
    if (type === 'line' && data.machineId) {
      setSelectedMachineForLine(data.machineId);
    }
    setIsModalOpen(true);
  };

  const handleModalSubmit = async () => {
    try {
      // Basic validation
      if (modalType === 'shift') {
        if (!modalData.name || !modalData.startTime || !modalData.endTime) {
          alert(t('fill_all_fields'));
          return;
        }
      }
      if (modalType === 'user') {
        if (!modalData.name || !modalData.pin || !modalData.role) {
          alert(t('fill_all_fields'));
          return;
        }
      }
      if (modalType === 'machine') {
        if (!modalData.name) {
          alert(t('fill_all_fields'));
          return;
        }
      }
      if (modalType === 'line') {
        if (!modalData.name || (!selectedMachineForLine && !modalData.machineId)) {
          alert(t('fill_all_fields'));
          return;
        }
      }

      const collectionName = 
        modalType === 'user' ? 'users' : 
        modalType === 'machine' ? 'machines' : 
        modalType === 'line' ? 'lines' : 
        modalType === 'programme' ? 'programmes' : 
        modalType === 'shift' ? 'shifts' :
        modalType === 'production_log' ? 'production_logs' :
        modalType === 'downtime_log' ? 'downtime_logs' : 'downtime_types';

      let finalData = { ...modalData };
      
      // If editing a user and PIN is empty, remove it from the update payload so it's not changed
      if (modalType === 'user' && editingId && !finalData.pin) {
        delete finalData.pin;
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
      if (modalType === 'line') {
        const machineIdToUse = selectedMachineForLine || modalData.machineId;
        if (machineIdToUse) {
          finalData.machineId = machineIdToUse;
          // Robust conversion for tracksProduction
          // If it's explicitly boolean false or number 0, it's 0. Otherwise (true, 1, undefined) it's 1.
          finalData.tracksProduction = (modalData.tracksProduction === false || modalData.tracksProduction === 0) ? 0 : 1;
        }
        if (!editingId) {
          finalData.status = 'IDLE';
          finalData.isActive = true;
        }
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
              currentProgrammeId: editingId,
              currentOperatorId: null,
              status: 'IDLE'
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
              status: 'IDLE',
              currentOperatorId: null
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`${t('error_saving')}\n\n${errorMessage}`);
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
      alert(t('error_deleting'));
    }
  };

  const initiateDelete = (col: string, id: string | undefined, name: string) => {
    if (!id) return;
    setConfirmDelete({ col, id, name });
  };

  const exportToExcel = async (type: 'production' | 'downtime') => {
    const workbook = new ExcelJS.Workbook();
    const dataSheet = workbook.addWorksheet('Data');
    const dashboardSheet = workbook.addWorksheet('Dashboard');
    
    let fileName = "";
    let title = "";

    if (type === 'production') {
      title = t('production_report_title');
      fileName = `Production_${new Date().toISOString().split('T')[0]}.xlsx`;

      // Define columns for Data sheet
      dataSheet.columns = [
        { header: 'Date', key: 'date', width: 15 },
        { header: 'Machine', key: 'machine', width: 20 },
        { header: 'Ligne', key: 'line', width: 15 },
        { header: 'Shift', key: 'shift', width: 15 },
        { header: 'Programme', key: 'programme', width: 25 },
        { header: 'Palettes', key: 'pallets', width: 12 },
      ];

      // Add Data
      prodLogs.forEach(log => {
        dataSheet.addRow({
          date: new Date(log.timestamp).toLocaleDateString(),
          machine: machines.find(m => m.id === log.machineId)?.name || '—',
          line: lines.find(l => l.id === log.lineId)?.name || '—',
          shift: shifts.find(s => s.id === log.shiftId)?.name || '—',
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
      title = t('downtime_report_title');
      fileName = `Downtime_${new Date().toISOString().split('T')[0]}.xlsx`;

      // Define columns for Data sheet
      dataSheet.columns = [
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Machine', key: 'machine', width: 20 },
        { header: 'Ligne', key: 'line', width: 15 },
        { header: 'Opérateur', key: 'operator', width: 20 },
        { header: 'Shift', key: 'shift', width: 15 },
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
        const durationSec = getLogDurationSec(log);
        const durationMin = Number((durationSec / 60).toFixed(2));
        
        dataSheet.addRow({
          date: start.toLocaleDateString(),
          machine: machines.find(m => m.id === log.machineId)?.name || '—',
          line: lines.find(l => l.id === log.lineId)?.name || '—',
          operator: users.find(u => u.id === log.operatorId)?.name || '—',
          shift: shifts.find(s => s.id === log.shiftId)?.name || '—',
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
        const totalSec = downLogs.filter(l => l.typeId === t.id).reduce((acc, l) => acc + getLogDurationSec(l), 0);
        if (totalSec > 0) {
          dashboardSheet.getRow(currentRow).values = [t.name, Number((totalSec / 60).toFixed(2))];
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
        const totalSec = logs.reduce((acc, l) => acc + getLogDurationSec(l), 0);
        if (totalSec > 0 || logs.length > 0) {
          dashboardSheet.getRow(currentRow).values = [m.name, Number((totalSec / 60).toFixed(2)), logs.length];
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
    { id: 'dashboard', label: t('dashboard'), icon: LayoutDashboard },
    { id: 'users', label: t('users'), icon: Users },
    { id: 'machines', label: t('machines'), icon: Factory },
    { id: 'programmes', label: t('programmes'), icon: Package },
    { id: 'shifts', label: t('shifts'), icon: Clock },
    { id: 'types', label: t('downtime_types'), icon: Timer },
    { id: 'history', label: t('history'), icon: History },
    { id: 'reports', label: t('exports'), icon: Download },
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
            <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white font-black text-[10px]">
              A
            </div>
            <h1 className="font-black text-sm tracking-tighter text-gray-900 leading-none">FACTORY<span className="text-blue-600">CLOUD</span></h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={logout}
            className="p-1 px-1.5 text-red-500 bg-red-50 rounded-lg transition-colors font-black text-[8px] uppercase border border-red-50"
          >
            {t('logout')}
          </button>
        </div>
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
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-black text-sm shadow-lg shadow-blue-200">
                  A
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
                
                <div className="mt-auto pt-4 border-t border-gray-100 space-y-4">
                  <div className="px-2">
                    <p className="text-[7px] font-black text-gray-400 uppercase tracking-widest mb-1.5 ml-1">{t('settings')}</p>
                  </div>
                  <button 
                    onClick={logout}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-50 w-full transition-colors"
                  >
                    <Trash2 size={14} strokeWidth={2.5} />
                    {t('logout')}
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
            <div className="space-y-4 md:space-y-6 animate-in fade-in duration-300">
              <div className="flex justify-between items-center px-1">
                <div>
                  <h2 className="text-base md:text-xl font-black tracking-tighter text-gray-900 leading-none">
                    {t('dashboard')} <span className="text-blue-600 uppercase text-[10px] md:text-xs tracking-widest ml-1">Analytical</span>
                  </h2>
                  <p className="text-[8px] md:text-[10px] font-bold text-gray-400 uppercase mt-1 italic">Dernières 24 heures • Mise à jour en temps réel</p>
                </div>
                <div className="text-right flex flex-col items-end">
                  <div className="flex items-center gap-1.5 bg-green-50 px-2 py-1 rounded-full border border-green-100">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    <p className="text-[8px] md:text-[10px] font-black text-green-700 uppercase tracking-tight">{t('connected')}</p>
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
                   { label: 'Efficacité (OEE)', val: `${analytics.availability.toFixed(1)}%`, sub: 'Disponibilité Lignes', icon: TrendingUp, color: 'blue', trend: '+2.1%' },
                   { label: 'Total Palettes', val: analytics.totalPallets, sub: 'Aujourd\'hui', icon: Box, color: 'green', trend: '+12' },
                   { label: 'Temps d\'Arrêt', val: formatDowntimeDisplay(analytics.totalDowntimeSec), sub: 'Minutes Perdues', icon: Timer, color: 'orange', trend: '-5%' },
                   { label: 'Arrets Actifs', val: lines.filter(l => !!l.activeDowntimeId).length, sub: 'Incidents en cours', icon: AlertTriangle, color: 'red', trend: 'Critical' },
                 ].map(stat => (
                   <motion.div 
                    variants={item}
                    key={stat.label} 
                    className="card p-2 md:p-4 flex flex-col gap-2 md:gap-3 hover:shadow-xl transition-all group relative overflow-hidden"
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

              {/* BOTTOM ROW: SHIFT PERF & LIVE MONITOR */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* SHIFT PERFORMANCE */}
                <motion.div variants={item} className="card p-4 lg:col-span-1">
                  <h3 className="text-xs font-black uppercase tracking-widest text-gray-900 mb-4 flex items-center gap-2">
                    <TrendingUp size={16} className="text-green-500" /> Performance Équipes
                  </h3>
                  <div className="space-y-3">
                    {analytics.shiftPerf.map(s => (
                      <div key={s.name} className="p-3 bg-gray-50 rounded-xl border border-gray-100 group hover:bg-white transition-all">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[10px] font-black text-gray-900 uppercase italic">{s.name}</span>
                          <span className="text-[9px] font-black text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded italic">#{analytics.shiftPerf.indexOf(s) + 1}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                           <div>
                              <p className="text-[7px] font-black text-gray-400 uppercase">Production</p>
                              <p className="text-xs font-black text-gray-800">{s.pallets} <span className="opacity-50">Pal.</span></p>
                           </div>
                           <div className="text-right">
                              <p className="text-[7px] font-black text-gray-400 uppercase">Arrets</p>
                              <p className="text-xs font-black text-red-600">{s.downtime} <span className="opacity-50">min</span></p>
                           </div>
                        </div>
                        <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                           <div 
                            className="h-full bg-blue-600 rounded-full" 
                            style={{ width: `${Math.min(100, (s.pallets / (analytics.totalPallets || 1)) * 100)}%` }} 
                           />
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>

                {/* LIVE MONITOR (REFRACHED VERSION) */}
                <div className="card overflow-hidden lg:col-span-2">
                   <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                     <h3 className="text-sm font-black uppercase tracking-widest text-gray-900 flex items-center gap-2">
                        <Activity size={16} className="text-green-500 animate-pulse" /> {t('live_monitor')}
                     </h3>
                     <div className="flex gap-2">
                        <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" /><span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Running</span></div>
                        <div className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500" /><span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">Stopped</span></div>
                     </div>
                   </div>
                   <div className="overflow-x-auto">
                     <table className="w-full text-left">
                        <thead className="bg-white text-[10px] text-gray-400 font-black uppercase tracking-[0.2em] border-b border-gray-100">
                          <tr>
                            <th className="px-6 py-5">{t('line_short')}</th>
                            <th className="px-6 py-5">{t('stat_short')}</th>
                            <th className="px-6 py-5">{t('pal_short')}</th>
                            <th className="px-6 py-5">{t('op_short')}</th>
                          </tr>
                        </thead>
                       <tbody className="divide-y divide-gray-50">
                          {lines.filter(l => l.isActive !== false && l.status !== 'IDLE').map(l => {
                            const prog = programmes.find(p => p.id === l.currentProgrammeId);
                            const op = users.find(u => u.id === l.currentOperatorId);
                            const mach = machines.find(m => m.id === l.machineId);
                            return (
                              <tr key={l.id} className={cn(
                                "text-sm hover:bg-gray-50/50 transition-all group/line",
                                l.isActive === false && "opacity-40 grayscale-[0.5]"
                              )}>
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-3">
                                    <div className={cn(
                                      "w-8 h-8 rounded-lg flex items-center justify-center transition-all group-hover/line:scale-110",
                                      l.status === 'RUNNING' ? "bg-green-50 text-green-600" :
                                      l.status === 'STOPPED' ? "bg-red-50 text-red-600" : "bg-gray-50 text-gray-500"
                                    )}>
                                      <Box size={16} />
                                    </div>
                                    <div>
                                      <p className="font-black text-gray-900 leading-none mb-1 whitespace-nowrap">{l.name}</p>
                                      <p className="text-[9px] font-bold text-blue-500 uppercase tracking-tight italic">{mach?.name}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                   <span className={cn(
                                     "px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-tight border",
                                     l.status === 'RUNNING' ? "bg-green-50 text-green-700 border-green-200" :
                                     l.status === 'STOPPED' ? "bg-red-50 text-red-700 border-red-200" : "bg-gray-50 text-gray-600 border-gray-200"
                                   )}>{l.status === 'RUNNING' ? 'Running' : l.status}</span>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex flex-col">
                                    <p className="text-sm font-black text-blue-600 italic leading-none">{prog?.producedPallets || 0}</p>
                                    <div className="w-16 h-1 bg-gray-100 rounded-full mt-2 overflow-hidden">
                                       <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, (prog?.producedPallets || 0) / 10)}%` }} />
                                    </div>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-2">
                                    <div className="w-7 h-7 bg-white rounded-full border border-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-500 shadow-sm group-hover/line:border-blue-200 transition-colors">
                                      {op?.name?.substring(0, 1).toUpperCase() || '—'}
                                    </div>
                                    <span className="text-gray-600 font-black text-[10px] uppercase truncate max-w-[80px]">{(op?.name || '—').split(' ')[0]}</span>
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
            </div>
          )}

          {activeTab === 'users' && (
            <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
              <div className="flex justify-between items-center px-1">
                <h2 className="text-lg md:text-xl font-black tracking-tighter text-gray-900 leading-none">{t('users')}</h2>
                <button 
                  onClick={() => openModal('user')}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-black shadow-lg shadow-blue-50 active:scale-95 transition-all text-[9px] md:text-[10px] tracking-widest uppercase flex items-center gap-1"
                >
                  <Plus size={12} strokeWidth={3} /> {t('add')}
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
                        <p className="text-[8px] md:text-[9px] font-black text-gray-400 uppercase tracking-tighter mt-0.5">PIN: <span className="bg-gray-100 px-1 rounded text-gray-400 font-mono italic">••••</span> • {u.role}</p>
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
                  <h2 className="text-lg md:text-xl font-black tracking-tighter text-gray-900 leading-none">{t('parc_machine')}</h2>
                  <button 
                     onClick={() => openModal('machine')}
                     className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-black shadow-lg shadow-blue-50 active:scale-95 transition-all text-[9px] md:text-[10px] tracking-widest uppercase"
                  >
                     + {t('machine').toUpperCase()}
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
                             + {t('line_short')}
                           </button>
                           <button onClick={() => openModal('machine', m)} className="text-gray-300 hover:text-blue-600 p-1 transition-colors"><Pencil size={14} /></button>
                           <button onClick={() => initiateDelete('machines', m.id, m.name)} className="text-gray-300 hover:text-red-500 p-1 transition-colors"><Trash2 size={14} /></button>
                        </div>
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-tighter leading-none">{t('pilot')} {t('idle')}</p>
                        <div className="flex items-center justify-between bg-blue-50/30 p-1.5 rounded-md border border-blue-100/50">
                          <span className="text-[10px] md:text-sm font-bold text-blue-900">{users.find(u => u.id === m.currentPilotId)?.name || t('free')}</span>
                          {m.currentPilotId && (
                            <button 
                              onClick={() => localApi.updateDoc('machines', m.id, { currentPilotId: null })}
                              className="text-[8px] font-black text-red-500 hover:underline uppercase"
                            >
                              {t('release')}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <p className="text-[8px] font-black text-gray-400 uppercase tracking-tighter">Lignes</p>
                        <div className="flex flex-wrap gap-1.5">
                          {lines.filter(l => l.machineId === m.id).map(l => (
                            <div 
                              key={l.id} 
                              className={cn(
                                "border px-1.5 py-1 rounded flex items-center gap-1.5 group/line transition-all",
                                l.isActive === false ? "bg-red-50 border-red-100 opacity-60" : "bg-gray-50 border-gray-100 hover:bg-white"
                              )}
                            >
                              <span className={cn(
                                "text-[9px] md:text-xs font-bold",
                                l.isActive === false ? "text-red-700 italic flex items-center gap-1" : "text-gray-700"
                              )}>
                                {l.isActive === false && <Timer size={10} className="text-red-400" />}
                                {l.name}
                                {l.isActive === false && <span className="text-[7px] uppercase tracking-tighter opacity-50 ml-1">({t('out_of_service')})</span>}
                              </span>
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
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
              <div className="flex justify-between items-center px-1">
                <h2 className="text-lg md:text-xl font-black tracking-tighter text-gray-900 leading-none">{t('programmes')}</h2>
                <button 
                  onClick={() => openModal('programme')}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-black shadow-lg shadow-blue-50 active:scale-95 transition-all text-[9px] md:text-[10px] tracking-widest uppercase flex items-center gap-1"
                >
                  <Plus size={12} strokeWidth={3} /> {t('new').toUpperCase()}
                </button>
              </div>

              {/* ACTIVE PROGRAMMES */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 px-1">
                  <Activity size={16} className="text-blue-600" />
                  <h3 className="text-xs font-black uppercase tracking-widest text-blue-600">{t('active_programmes')}</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-4">
                  {programmes.filter(p => p.status === 'ACTIVE').map(p => (
                    <div key={p.id} className="card p-3 md:p-4 border-l-4 border-blue-500 transition-all">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="text-[8px] font-black text-gray-400 uppercase tracking-tighter">{machines.find(m => m.id === p.machineId)?.name} • {lines.find(l => l.id === p.lineId)?.name}</p>
                          <h3 className="font-black text-sm md:text-base text-gray-900 leading-tight">{p.name}</h3>
                        </div>
                        <span className="px-1.5 py-0.5 rounded text-[7px] font-black uppercase tracking-tighter bg-blue-100 text-blue-700">ACTIVE</span>
                      </div>
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] md:text-xs font-bold">
                          <span className="text-gray-500">{p.producedPallets} {t('pallets').toLowerCase()}</span>
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
                  {programmes.filter(p => p.status === 'ACTIVE').length === 0 && (
                    <div className="col-span-full py-12 flex flex-col items-center justify-center text-gray-300 bg-white/50 rounded-[32px] border-2 border-dashed border-gray-100">
                      <Package size={40} strokeWidth={1} className="mb-2 opacity-50" />
                      <p className="text-[10px] font-black uppercase tracking-widest">{t('no_prog_available')}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* FINISHED PROGRAMMES */}
              <div className="space-y-4">
                <div className="flex items-center gap-2 px-1">
                  <History size={16} className="text-gray-400" />
                  <h3 className="text-xs font-black uppercase tracking-widest text-gray-400">{t('finished_programmes')}</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 md:gap-3">
                  {programmes.filter(p => p.status === 'FINISHED').map(p => (
                    <div key={p.id} className="card p-2 md:p-3 bg-gray-50/50 border-gray-200 transition-all opacity-80 hover:opacity-100 group">
                      <div className="flex justify-between items-start mb-1.5">
                        <div className="truncate flex-1">
                          <p className="text-[7px] font-black text-gray-400 uppercase tracking-tighter truncate">{lines.find(l => l.id === p.lineId)?.name || '—'}</p>
                          <h3 className="font-black text-[10px] md:text-xs text-gray-700 leading-tight truncate">{p.name}</h3>
                        </div>
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                          <button onClick={() => openModal('programme', p)} className="text-gray-300 hover:text-blue-500 p-0.5"><Pencil size={10} /></button>
                          <button onClick={() => initiateDelete('programmes', p.id, p.name)} className="text-gray-300 hover:text-red-500 p-0.5"><Trash2 size={10} /></button>
                        </div>
                      </div>
                      <div className="flex justify-between items-center mt-2 pt-1 border-t border-gray-100">
                        <span className="text-[9px] font-black text-gray-500">{p.producedPallets} <span className="text-[7px] uppercase tracking-tighter opacity-60">Pal</span></span>
                        <p className="text-[7px] font-bold text-gray-400 italic">{new Date(p.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))}
                  {programmes.filter(p => p.status === 'FINISHED').length === 0 && (
                     <div className="col-span-full py-6 text-center text-gray-300 font-bold text-[9px] uppercase tracking-widest">
                       — Aucun programme terminé —
                     </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'shifts' && (
            <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
              <div className="flex justify-between items-center px-1">
                <h2 className="text-lg md:text-xl font-black tracking-tighter text-gray-900 leading-none">{t('shifts')}</h2>
                <button 
                  onClick={() => openModal('shift')}
                  className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-black shadow-lg shadow-blue-50 active:scale-95 transition-all text-[9px] md:text-[10px] tracking-widest uppercase flex items-center gap-1"
                >
                  <Plus size={12} strokeWidth={3} /> {t('add')}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-4">
                {shifts.map(s => (
                  <div key={s.id} className="card p-4 group flex justify-between items-center hover:border-blue-200 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600">
                        <Clock size={20} />
                      </div>
                      <div>
                        <p className="font-black text-sm text-gray-900 leading-tight">{s.name}</p>
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-tighter mt-0.5">{s.startTime} — {s.endTime}</p>
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      <button onClick={() => openModal('shift', s)} className="text-gray-300 hover:text-blue-600 transition-colors p-1.5">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => initiateDelete('shifts', s.id, s.name)} className="text-gray-300 hover:text-red-500 transition-colors p-1.5">
                        <Trash2 size={14} />
                      </button>
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
                      {t.name.toUpperCase() !== 'AUTRE' && (
                        <>
                          <button onClick={() => openModal('downtime', t)} className="text-gray-300 hover:text-blue-500 p-1">
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => initiateDelete('downtime_types', t.id, t.name)} className="text-gray-300 hover:text-red-500 p-1">
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
              <div className="flex flex-col gap-4 px-1">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg md:text-xl font-black tracking-tighter text-gray-900 leading-none">{t('history')}</h2>
                    <button 
                      onClick={() => exportToExcel(historyLogType === 'production' ? 'production' : 'downtime')}
                      className="p-1.5 px-3 bg-white border border-gray-200 rounded-lg text-[9px] font-black uppercase tracking-widest text-blue-600 hover:bg-blue-50 transition-all flex items-center gap-1.5 shadow-sm"
                    >
                      <Download size={12} /> {t('export')}
                    </button>
                  </div>
                  
                  <div className="flex bg-gray-100 p-1 rounded-xl w-full sm:w-auto">
                    <button 
                      onClick={() => setHistoryLogType('production')}
                      className={cn(
                        "flex-1 sm:flex-none px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                        historyLogType === 'production' ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                      )}
                    >
                      {t('production_label_short')}
                    </button>
                    <button 
                      onClick={() => setHistoryLogType('downtime')}
                      className={cn(
                        "flex-1 sm:flex-none px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                        historyLogType === 'downtime' ? "bg-white text-red-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
                      )}
                    >
                      {t('stop_label_short')}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                   <div className="space-y-1">
                     <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('machine')}</p>
                     <select 
                      value={historyMachineFilter}
                      onChange={e => {
                        setHistoryMachineFilter(e.target.value);
                        setHistoryLineFilter('');
                      }}
                      className="w-full p-2.5 bg-white border border-gray-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                     >
                       <option value="">{t('all_machines')}</option>
                       {machines.map(m => (
                         <option key={m.id} value={m.id}>{m.name}</option>
                       ))}
                     </select>
                   </div>

                   <div className="space-y-1">
                     <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('line')}</p>
                     <select 
                      value={historyLineFilter}
                      onChange={e => setHistoryLineFilter(e.target.value)}
                      className="w-full p-2.5 bg-white border border-gray-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                     >
                       <option value="">{t('all_lines')}</option>
                       {lines
                        .filter(l => !historyMachineFilter || l.machineId === historyMachineFilter)
                        .map(l => (
                         <option key={l.id} value={l.id}>{l.name}</option>
                       ))}
                     </select>
                   </div>

                   <div className="space-y-1">
                     <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('shift')}</p>
                     <select 
                      value={historyShiftFilter}
                      onChange={e => setHistoryShiftFilter(e.target.value)}
                      className="w-full p-2.5 bg-white border border-gray-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                     >
                       <option value="">{t('all_shifts')}</option>
                       {shifts.map(s => (
                         <option key={s.id} value={s.id}>{s.name}</option>
                       ))}
                     </select>
                   </div>

                   <div className="space-y-1">
                     <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest ml-1">Opérateur</p>
                     <select 
                      value={historyOperatorFilter}
                      onChange={e => setHistoryOperatorFilter(e.target.value)}
                      className="w-full p-2.5 bg-white border border-gray-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                     >
                       <option value="">{t('all_operators') || 'Tous'}</option>
                       {users.map(u => (
                         <option key={u.id} value={u.id}>{u.name}</option>
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

              <div className="space-y-6 md:space-y-8">
                {historyLogType === 'production' ? (
                  <div className="space-y-2 animate-in fade-in zoom-in-95 duration-300">
                    <h3 className="text-xs md:text-sm font-black text-gray-900 flex items-center gap-2 uppercase tracking-widest">
                      <Package className="text-blue-600" size={16} />
                      {t('production_log').toUpperCase()}
                    </h3>
                    <div className="card overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-gray-50 text-[7px] md:text-[9px] text-gray-400 font-black uppercase tracking-wider border-b border-gray-100">
                            <tr>
                              <th className="px-2 md:px-6 py-2 md:py-3 text-left">{t('date')}</th>
                              <th className="px-2 md:px-6 py-2 md:py-3 hidden sm:table-cell text-left">{t('line_short')}</th>
                              <th className="px-2 md:px-6 py-2 md:py-3 text-left">{t('program_name')}</th>
                              <th className="px-2 md:px-6 py-2 md:py-3 hidden sm:table-cell text-left">{t('shift')}</th>
                              <th className="px-2 md:px-6 py-2 md:py-3 hidden md:table-cell text-left">{t('operator')}</th>
                              <th className="px-2 md:px-6 py-2 md:py-3 text-center">{t('quantity_short')}</th>
                              <th className="px-2 md:px-6 py-2 md:py-3 text-right">{t('actions')}</th>
                            </tr>
                          </thead>
                        <tbody className="divide-y divide-gray-50 text-[9px] md:text-xs">
                          <AnimatePresence mode="popLayout">
                            {sortedProdLogs
                              .filter(log => {
                                const matchMachine = !historyMachineFilter || log.machineId === historyMachineFilter;
                                const matchLine = !historyLineFilter || log.lineId === historyLineFilter;
                                const matchShift = !historyShiftFilter || log.shiftId === historyShiftFilter;
                                const matchOperator = !historyOperatorFilter || log.operatorId === historyOperatorFilter;
                                const matchDate = !historyDateFilter || log.timestamp.startsWith(historyDateFilter);
                                return matchMachine && matchLine && matchShift && matchOperator && matchDate;
                              })
                              .slice(0, 100).map(log => (
                                <motion.tr 
                                  key={log.id} 
                                  initial={{ opacity: 1 }}
                                  exit={{ opacity: 0, x: -20, backgroundColor: 'rgba(254, 226, 226, 0.5)' }}
                                  transition={{ duration: 0.2 }}
                                  className="hover:bg-gray-50/50"
                                >
                                  <td className="px-2 md:px-6 py-2 md:py-3 font-medium text-gray-900 whitespace-nowrap">
                                    {new Date(log.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                  </td>
                                  <td className="px-2 md:px-6 py-2 md:py-3 hidden sm:table-cell">
                                    <p className="font-bold text-gray-800">{machines.find(m => m.id === log.machineId)?.name || '—'}</p>
                                    <p className="text-[7px] md:text-[8px] font-bold text-gray-400 uppercase tracking-tighter">{lines.find(l => l.id === log.lineId)?.name || '—'}</p>
                                  </td>
                                  <td className="px-2 md:px-6 py-2 md:py-3 text-blue-600 font-bold truncate max-w-[60px] md:max-w-none">
                                    {programmes.find(p => p.id === log.programmeId)?.name || '—'}
                                  </td>
                                  <td className="px-2 md:px-6 py-2 md:py-3 hidden sm:table-cell">
                                    <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[7px] md:text-[9px] font-black uppercase italic">
                                      {shifts.find(s => s.id === log.shiftId)?.name || '—'}
                                    </span>
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
                                      <button onClick={() => initiateDelete('production_logs', log.id, `${t('production_of')} ${log.count} ${t('pallets')}`)} className="text-gray-300 hover:text-red-500 p-1"><Trash2 className="w-3 h-3 md:w-3.5 md:h-3.5" /></button>
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
                  <div className="space-y-2 animate-in fade-in zoom-in-95 duration-300">
                    <h3 className="text-xs md:text-sm font-black text-gray-900 flex items-center gap-2 uppercase tracking-widest">
                      <Timer className="text-orange-600" size={16} />
                      {t('downtime_log').toUpperCase()}
                    </h3>
                    <div className="card overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-gray-50 text-[7px] md:text-[9px] text-gray-400 font-black uppercase tracking-wider border-b border-gray-100">
                            <tr>
                              <th className="px-2 md:px-6 py-2 md:py-3 text-left">{t('start_time')}</th>
                              <th className="px-2 md:px-6 py-2 md:py-3 text-left">{t('end_time')}</th>
                              <th className="px-2 md:px-6 py-2 md:py-3 text-left">Durée</th>
                              <th className="px-2 md:px-6 py-2 md:py-3 text-left">{t('reason')}</th>
                              <th className="px-2 md:px-6 py-2 md:py-3 text-left">Opérateur</th>
                              <th className="px-2 md:px-6 py-2 md:py-3 hidden sm:table-cell text-left">{t('line_short')}</th>
                              <th className="px-2 md:px-6 py-2 md:py-3 hidden sm:table-cell text-left">{t('shift')}</th>
                              <th className="px-2 md:px-6 py-2 md:py-3 text-right">{t('actions')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50 text-[9px] md:text-xs">
                          <AnimatePresence mode="popLayout">
                            {sortedDownLogs
                              .filter(log => {
                                const matchMachine = !historyMachineFilter || log.machineId === historyMachineFilter;
                                const matchLine = !historyLineFilter || log.lineId === historyLineFilter;
                                const matchShift = !historyShiftFilter || log.shiftId === historyShiftFilter;
                                const matchOperator = !historyOperatorFilter || log.operatorId === historyOperatorFilter;
                                const matchDate = !historyDateFilter || log.startTime.startsWith(historyDateFilter);
                                return matchMachine && matchLine && matchShift && matchOperator && matchDate;
                              })
                              .slice(0, 100).map(log => (
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
                                    {log.duration || !log.endTime ? (
                                      <span className="font-mono text-[9px] md:text-[10px] text-blue-700 font-black bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                                        {formatDowntimeDisplay(getLogDurationSec(log))}
                                      </span>
                                    ) : <span className="text-orange-500 font-bold text-[8px] uppercase">En cours</span>}
                                  </td>
                                  <td className="px-2 md:px-6 py-2 md:py-3">
                                    <div className="flex items-center gap-1">
                                      <span className="text-sm">{downtimeTypes.find(t => t.id === log.typeId)?.icon || '⚠️'}</span>
                                      <p className="font-bold text-gray-800 truncate max-w-[60px] md:max-w-none">{downtimeTypes.find(t => t.id === log.typeId)?.name || '—'}</p>
                                    </div>
                                  </td>
                                  <td className="px-2 md:px-6 py-2 md:py-3 italic">
                                    <div className="flex items-center gap-1.5">
                                      <div className="w-5 h-5 bg-gray-100 rounded-full flex items-center justify-center text-[8px] font-black uppercase text-gray-500 border border-gray-200">
                                        {users.find(u => u.id === log.operatorId)?.name.charAt(0) || '—'}
                                      </div>
                                      <span className="font-black text-gray-600 truncate max-w-[80px] md:max-w-none">
                                        {users.find(u => u.id === log.operatorId)?.name || '—'}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-2 md:px-6 py-2 md:py-3 hidden sm:table-cell">
                                    <p className="font-bold text-gray-800">{machines.find(m => m.id === log.machineId)?.name || '—'}</p>
                                    <p className="text-[7px] md:text-[8px] font-bold text-gray-400 uppercase tracking-tighter">{lines.find(l => l.id === log.lineId)?.name || '—'}</p>
                                  </td>
                                  <td className="px-2 md:px-6 py-2 md:py-3 hidden sm:table-cell">
                                    <span className="px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded text-[7px] md:text-[9px] font-black uppercase italic">
                                      {shifts.find(s => s.id === log.shiftId)?.name || '—'}
                                    </span>
                                  </td>
                                  <td className="px-2 md:px-6 py-2 md:py-3 text-right">
                                    <div className="flex justify-end gap-1">
                                      <button onClick={() => openModal('downtime_log', log)} className="text-gray-300 hover:text-blue-600 p-1"><Pencil className="w-3 h-3 md:w-3.5 md:h-3.5" /></button>
                                      <button onClick={() => initiateDelete('downtime_logs', log.id, `${t('stop_recorded')} ${downtimeTypes.find(t => t.id === log.typeId)?.name}`)} className="text-gray-300 hover:text-red-500 p-1"><Trash2 className="w-3 h-3 md:w-3.5 md:h-3.5" /></button>
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
          )}
          {activeTab === 'reports' && (
            <div className="space-y-4 animate-in slide-in-from-right-4 duration-300">
              <div className="px-1">
                <h2 className="text-lg md:text-xl font-black tracking-tighter text-gray-900 leading-none">{t('exports')}</h2>
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
                      <h3 className="text-base font-black text-gray-900 tracking-tight mb-1">{t('production_log')}</h3>
                      <p className="text-gray-500 text-[10px] md:text-xs font-medium leading-tight">{t('production_logs_desc')}</p>
                    </div>
                    <button 
                      onClick={() => exportToExcel('production')}
                      className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-black shadow-lg shadow-blue-50 active:scale-95 transition-all flex items-center justify-center gap-2 relative z-10 text-[9px] tracking-widest uppercase"
                    >
                      <Download size={14} strokeWidth={3} />
                      {t('export')}
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
                      <h3 className="text-base font-black text-gray-900 tracking-tight mb-1">{t('downtime_log')}</h3>
                      <p className="text-gray-500 text-[10px] md:text-xs font-medium leading-tight">{t('downtime_analysis_desc')}</p>
                    </div>
                    <button 
                      onClick={() => exportToExcel('downtime')}
                      className="w-full py-2.5 bg-orange-600 text-white rounded-lg font-black shadow-lg shadow-orange-50 active:scale-95 transition-all flex items-center justify-center gap-2 relative z-10 text-[9px] tracking-widest uppercase"
                    >
                      <Download size={14} strokeWidth={3} />
                      {t('export')}
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
                {editingId ? t('edit') : t('new')} {
                  modalType === 'user' ? t('user') : 
                  modalType === 'machine' ? t('machine') : 
                  modalType === 'line' ? t('line') : 
                  modalType === 'programme' ? t('program') : 
                  modalType === 'shift' ? t('shift') : t('downtime_reason')}
              </h3>
              <p className="text-[7px] text-gray-400 font-black uppercase tracking-widest">{t('configuration')}</p>
            </div>

            <div className="space-y-4">
              {modalType === 'shift' && (
                <>
                  <input 
                    placeholder={t('shift_name')}
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                    value={modalData.name || ''}
                    onChange={e => setModalData({...modalData, name: e.target.value})}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('start_time')}</label>
                      <input 
                        type="time"
                        className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                        value={modalData.startTime || ''}
                        onChange={e => setModalData({...modalData, startTime: e.target.value})}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('end_time')}</label>
                      <input 
                        type="time"
                        className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                        value={modalData.endTime || ''}
                        onChange={e => setModalData({...modalData, endTime: e.target.value})}
                      />
                    </div>
                  </div>
                </>
              )}

              {modalType === 'production_log' && (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('quantity')} ({t('pallets')})</label>
                    <input 
                      type="number"
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={modalData.count || ''}
                      onChange={e => setModalData({...modalData, count: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('date')}</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={modalData.timestamp ? format(new Date(modalData.timestamp), "yyyy-MM-dd'T'HH:mm") : ''}
                      onChange={e => {
                        try {
                          const val = e.target.value;
                          if (!val) return;
                          setModalData({...modalData, timestamp: new Date(val).toISOString()});
                        } catch (err) {
                           console.error('Invalid date', err);
                        }
                      }}
                    />
                  </div>
                </>
              )}

              {modalType === 'downtime_log' && (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('downtime_reason')}</label>
                    <select 
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-700"
                      value={modalData.typeId || ''}
                      onChange={e => setModalData({...modalData, typeId: e.target.value})}
                    >
                      <option value="">{t('select_reason')}</option>
                      {downtimeTypes.map(t => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('start_time')}</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={modalData.startTime ? format(new Date(modalData.startTime), "yyyy-MM-dd'T'HH:mm") : ''}
                      onChange={e => {
                        try {
                          const localVal = e.target.value;
                          if (!localVal) return;
                          const newStart = new Date(localVal).toISOString();
                          const durationMs = modalData.endTime ? (new Date(modalData.endTime).getTime() - new Date(newStart).getTime()) : (modalData.duration * 1000 || 0);
                          setModalData({...modalData, startTime: newStart, duration: Math.floor(durationMs / 1000)});
                        } catch (err) {
                          console.error('Invalid date', err);
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('end_time')}</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={modalData.endTime ? format(new Date(modalData.endTime), "yyyy-MM-dd'T'HH:mm") : ''}
                      onChange={e => {
                        try {
                          const localVal = e.target.value;
                          if (!localVal) return;
                          const newEnd = new Date(localVal).toISOString();
                          const durationMs = new Date(newEnd).getTime() - new Date(modalData.startTime).getTime();
                          setModalData({...modalData, endTime: newEnd, duration: Math.floor(durationMs / 1000)});
                        } catch (err) {
                          console.error('Invalid date', err);
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Opérateur</label>
                    <select 
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={modalData.operatorId || ''}
                      onChange={e => setModalData({...modalData, operatorId: e.target.value})}
                    >
                      <option value="">Sélectionner un opérateur</option>
                      {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('description_comment')}</label>
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
                    placeholder={t('program_name')}
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                    value={modalData.name || ''}
                    onChange={e => setModalData({...modalData, name: e.target.value})}
                  />
                  <select 
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-700"
                    value={modalData.machineId || ''}
                    onChange={e => setModalData({...modalData, machineId: e.target.value})}
                  >
                    <option value="">{t('choose_machine')}</option>
                    {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <select 
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-700"
                    disabled={!modalData.machineId}
                    value={modalData.lineId || ''}
                    onChange={e => setModalData({...modalData, lineId: e.target.value})}
                  >
                    <option value="">{t('choose_line')}</option>
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
                      <option value="ACTIVE">{t('active_label').toUpperCase()}</option>
                      <option value="FINISHED">CLÔTURÉ</option>
                    </select>
                  )}
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('technical_parameters')}</label>
                    <textarea 
                      placeholder="Pression, Vitesse, Température..."
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-sm"
                      rows={3}
                      value={modalData.parameters || ''}
                      onChange={e => setModalData({...modalData, parameters: e.target.value})}
                    />
                  </div>
                </>
              )}

              {modalType === 'user' && (
                <>
                  <input 
                    placeholder={t('full_name')}
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                    value={modalData.name || ''}
                    onChange={e => setModalData({...modalData, name: e.target.value})}
                  />
                    <input 
                      placeholder={editingId ? t('new_pin_placeholder') || 'Nouveau PIN (optionnel)' : t('pin')}
                      type="password"
                      inputMode="numeric"
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
                    <option value="">{t('choose_role')}</option>
                    <option value="OPERATOR">{t('operator')}</option>
                    <option value="PILOT">{t('pilot')}</option>
                    <option value="ADMIN">{t('admin')}</option>
                  </select>
                </>
              )}

              {(modalType === 'machine' || modalType === 'line') && (
                <>
                  <input 
                    placeholder={modalType === 'machine' ? t('machine_name') : t('line_name')}
                    className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                    value={modalData.name || ''}
                    onChange={e => setModalData({...modalData, name: e.target.value})}
                  />
                  {modalType === 'line' && (
                    <div className="space-y-2">
                       <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                        <input 
                          type="checkbox"
                          id="isActive"
                          className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500"
                          checked={modalData.isActive !== false}
                          onChange={e => setModalData({...modalData, isActive: e.target.checked})}
                        />
                        <label htmlFor="isActive" className="text-sm font-bold text-gray-700">{t('active_service')}</label>
                      </div>
                      <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                        <input 
                          type="checkbox"
                          id="tracksProduction"
                          className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          checked={modalData.tracksProduction !== false}
                          onChange={e => setModalData({...modalData, tracksProduction: e.target.checked})}
                        />
                        <label htmlFor="tracksProduction" className="text-sm font-bold text-gray-700">{t('track_production')}</label>
                      </div>
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
                {t('cancel')}
              </button>
              <button 
                onClick={handleModalSubmit}
                className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-100 active:scale-95 transition-all uppercase text-[10px] tracking-widest"
              >
                {t('save')}
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
              <h3 className="text-2xl font-black text-gray-900 tracking-tight italic uppercase">{t('delete_question')}</h3>
              <p className="text-gray-500 font-medium">{t('delete_confirm_msg')} <span className="text-red-600 font-black italic">{confirmDelete.name}</span> ? {t('delete_irreversible')}</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => setConfirmDelete(null)}
                className="flex-1 py-4 font-black text-gray-400 hover:bg-gray-50 rounded-2xl transition-all uppercase text-[10px] tracking-widest"
              >
                {t('cancel')}
              </button>
              <button 
                onClick={deleteItem}
                className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-black shadow-xl shadow-red-200 active:scale-95 transition-all uppercase text-[10px] tracking-widest"
              >
                {t('confirm')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
