import React, { useState, useEffect, useMemo, useRef, ChangeEvent } from 'react';
import { localApi } from '../lib/localApi';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useLanguage } from '../contexts/LanguageContext';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from '../contexts/ThemeContext';
import { 
  Users, Factory, Package, Timer, History, 
  Download, Plus, Trash2, LayoutDashboard,
  Box, Terminal, Activity, Pencil, Menu, X, Clock,
  TrendingUp, AlertTriangle, CheckCircle2,
  Camera, Eye, Sun, Moon
} from 'lucide-react';
import { cn, formatDuration, formatMinutes, formatDowntimeDisplay, getLogDurationSec } from '../lib/utils';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { format, startOfDay, endOfDay, isWithinInterval, parseISO } from 'date-fns';

export default function AdminPanel() {
  const { logout, user } = useAuth();
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
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
    
    // OEE Calculation (Availability) using real shift duration
    const currentShift = shifts.find(s => {
      const [sh, sm] = s.startTime.split(':').map(Number);
      const [eh, em] = s.endTime.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      const nowMin = today.getHours() * 60 + today.getMinutes();
      if (endMin < startMin) return nowMin >= startMin || nowMin < endMin;
      return nowMin >= startMin && nowMin < endMin;
    });

    let shiftDurationSec = 8 * 3600; // Fallback to 8h if no shift is active (e.g. gaps between shifts)
    if (currentShift) {
      const [sh, sm] = currentShift.startTime.split(':').map(Number);
      const [eh, em] = currentShift.endTime.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      const durationMin = endMin < startMin ? (1440 - startMin + endMin) : (endMin - startMin);
      shiftDurationSec = durationMin * 60;
    }

    const totalPossibleTime = lines.length * shiftDurationSec;
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
  const [historyEndDateFilter, setHistoryEndDateFilter] = useState<string>(() => sessionStorage.getItem('admin_history_end_date') || '');
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
    sessionStorage.setItem('admin_history_end_date', historyEndDateFilter);
    sessionStorage.setItem('admin_history_type', historyLogType);
  }, [historyMachineFilter, historyLineFilter, historyShiftFilter, historyOperatorFilter, historyDateFilter, historyEndDateFilter, historyLogType]);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalType, setModalType] = useState<'user' | 'machine' | 'line' | 'downtime' | 'programme' | 'production_log' | 'downtime_log' | 'shift'>('user');
  const [modalData, setModalData] = useState<any>({});
  const [confirmPin, setConfirmPin] = useState('');
  const [selectedMachineForLine, setSelectedMachineForLine] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{col: string, id: string, name: string} | null>(null);
  const [selectedFullImage, setSelectedFullImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    const formData = new FormData();
    formData.append('photo', file, 'admin-upload.jpg');

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: formData
      });
      
      const data = await res.json();
      if (res.ok && data.path) {
        const currentImages = modalData.images || [];
        setModalData({ ...modalData, images: [...currentImages, data.path] });
      } else {
        throw new Error(data.error || `Erreur ${res.status}`);
      }
    } catch (e: any) {
      console.error('Upload error:', e);
      alert(`Erreur de téléchargement: ${e.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      Array.from(files).forEach((file: File) => uploadFile(file));
    }
  };

  const openModal = (type: typeof modalType, data: any = {}) => {
    setModalType(type);
    setConfirmPin('');
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
        if (!modalData.name || (!editingId && !modalData.pin) || !modalData.role) {
          alert(t('fill_all_fields'));
          return;
        }
        if (modalData.pin && modalData.pin !== confirmPin) {
          alert(t('passwords_not_match') || 'Les mots de passe ne correspondent pas');
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
      if (modalType === 'downtime_log') {
        if (!modalData.machineId || !modalData.lineId || !modalData.typeId || !modalData.startTime || !modalData.endTime || !modalData.operatorId) {
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
        if (finalData.startTime && finalData.endTime) {
          const start = new Date(finalData.startTime).getTime();
          const end = new Date(finalData.endTime).getTime();
          finalData.duration = Math.max(0, Math.floor((end - start) / 1000));
        }
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

    let photoSheet: ExcelJS.Worksheet | null = null;
    if (type === 'downtime') {
      photoSheet = workbook.addWorksheet('Photos');
    }

    const dashboardSheet = workbook.addWorksheet('Dashboard');
    
    let fileName = "";
    const prefix = type === 'production' ? 'Rapport_Production' : 'Rapport_Arrets';
    
    if (historyDateFilter && historyEndDateFilter) {
      fileName = `${prefix}_du_${historyDateFilter}_au_${historyEndDateFilter}.xlsx`;
    } else if (historyDateFilter) {
      fileName = `${prefix}_du_${historyDateFilter}.xlsx`;
    } else {
      fileName = type === 'production' ? 'Rapport_General_Production.xlsx' : 'Rapport_General_Arrets.xlsx';
    }
    
    const now = new Date();

    // Styling constants
    const headerStyle = {
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } } as ExcelJS.Fill,
      font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 } as Partial<ExcelJS.Font>,
      alignment: { horizontal: 'center', vertical: 'middle' } as Partial<ExcelJS.Alignment>,
      border: {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      } as Partial<ExcelJS.Borders>
    };

    const cellStyle = {
      alignment: { horizontal: 'center', vertical: 'middle' } as Partial<ExcelJS.Alignment>,
      border: {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      } as Partial<ExcelJS.Borders>
    };

    const formatDateExcel = (iso: string | undefined) => {
      if (!iso) return '—';
      try {
        return format(new Date(iso), 'dd/MM/yyyy HH:mm');
      } catch (e) {
        return '—';
      }
    };

    const filteredProdLogs = prodLogs.filter(log => {
      const matchMachine = !historyMachineFilter || log.machineId === historyMachineFilter;
      const matchLine = !historyLineFilter || log.lineId === historyLineFilter;
      const matchShift = !historyShiftFilter || log.shiftId === historyShiftFilter;
      const matchOperator = !historyOperatorFilter || log.operatorId === historyOperatorFilter;
      const logDateOnly = log.timestamp.split('T')[0];
      const matchDate = (!historyDateFilter || logDateOnly >= historyDateFilter) && 
                        (!historyEndDateFilter || logDateOnly <= historyEndDateFilter);
      return matchMachine && matchLine && matchShift && matchOperator && matchDate;
    });

    const filteredDownLogs = downLogs.filter(log => {
      const matchMachine = !historyMachineFilter || log.machineId === historyMachineFilter;
      const matchLine = !historyLineFilter || log.lineId === historyLineFilter;
      const matchShift = !historyShiftFilter || log.shiftId === historyShiftFilter;
      const matchOperator = !historyOperatorFilter || log.operatorId === historyOperatorFilter;
      const logDateOnly = log.startTime.split('T')[0];
      const matchDate = (!historyDateFilter || logDateOnly >= historyDateFilter) && 
                        (!historyEndDateFilter || logDateOnly <= historyEndDateFilter);
      return matchMachine && matchLine && matchShift && matchOperator && matchDate;
    });

    if (type === 'production') {
      dataSheet.columns = [
        { header: 'Date & Heure', key: 'timestamp', width: 20 },
        { header: 'Machine', key: 'machine', width: 25 },
        { header: 'Ligne', key: 'line', width: 20 },
        { header: 'Opérateur', key: 'operator', width: 25 },
        { header: 'Shift', key: 'shift', width: 15 },
        { header: 'Programme', key: 'programme', width: 30 },
        { header: 'Palettes', key: 'pallets', width: 15 },
      ];

      filteredProdLogs.forEach(log => {
        dataSheet.addRow({
          timestamp: formatDateExcel(log.timestamp),
          machine: machines.find(m => m.id === log.machineId)?.name || '—',
          line: lines.find(l => l.id === log.lineId)?.name || '—',
          operator: users.find(u => u.id === log.operatorId)?.name || '—',
          shift: shifts.find(s => s.id === log.shiftId)?.name || '—',
          programme: programmes.find(p => p.id === log.programmeId)?.name || '—',
          pallets: log.count
        });
      });

      // Dashboard Production
      dashboardSheet.getCell('A1').value = "RAPPORT DE PRODUCTION - DASHBOARD";
      dashboardSheet.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF1F4E78' } };
      dashboardSheet.mergeCells('A1:D1');
      
      dashboardSheet.getCell('A3').value = "Résumé par Machine";
      dashboardSheet.getCell('A3').font = { bold: true, size: 12 };
      
      const machineHeaders = ['Machine', 'Total Palettes', 'Nb Saisies'];
      const machineRow = dashboardSheet.getRow(4);
      machineHeaders.forEach((h, i) => {
        const cell = machineRow.getCell(i + 1);
        cell.value = h;
        Object.assign(cell, headerStyle);
      });

      let currentRow = 5;
      machines.forEach(m => {
        const logs = prodLogs.filter(l => l.machineId === m.id);
        const totalPallets = logs.reduce((acc, l) => acc + l.count, 0);
        if (totalPallets > 0) {
          const row = dashboardSheet.getRow(currentRow);
          row.values = [m.name, totalPallets, logs.length];
          row.eachCell(cell => Object.assign(cell, cellStyle));
          currentRow++;
        }
      });

    } else {
      // Photo sheet already created as 2nd tab
      const photoSheetToUse = photoSheet!;

      dataSheet.columns = [
        { header: 'Arrêt #', key: 'id', width: 12 },
        { header: 'Heure_Debut', key: 'start', width: 20 },
        { header: 'Heure_Fin', key: 'end', width: 20 },
        { header: 'Durée (min)', key: 'duration', width: 15 },
        { header: 'Machine', key: 'machine', width: 25 },
        { header: 'Ligne', key: 'line', width: 20 },
        { header: 'Type_Arret', key: 'type', width: 25 },
        { header: 'Opérateur', key: 'operator', width: 25 },
        { header: 'Shift', key: 'shift', width: 15 },
        { header: 'Description', key: 'desc', width: 40 },
      ];

      photoSheetToUse.columns = [
        { header: 'Arrêt #', key: 'id', width: 15 },
        { header: 'Machine', key: 'machine', width: 25 },
        { header: 'Galerie Photo', key: 'photo', width: 60 },
      ];
      photoSheetToUse.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));

      let photoRowIdx = 2;

      for (const log of filteredDownLogs) {
        const durationSec = getLogDurationSec(log);
        const durationMin = log.endTime ? Number((durationSec / 60).toFixed(1)) : 'En cours';
        
        const row = dataSheet.addRow({
          id: log.id.substring(0, 8),
          start: formatDateExcel(log.startTime),
          end: log.endTime ? formatDateExcel(log.endTime) : 'En cours',
          duration: durationMin,
          machine: machines.find(m => m.id === log.machineId)?.name || '—',
          line: lines.find(l => l.id === log.lineId)?.name || '—',
          type: downtimeTypes.find(t => t.id === log.typeId)?.name || '—',
          operator: users.find(u => u.id === log.operatorId)?.name || '—',
          shift: shifts.find(s => s.id === log.shiftId)?.name || '—',
          desc: log.description || '—'
        });

        // Photos logic
        const images: string[] = [];
        if (log.image_path) images.push(log.image_path);
        if (log.images) {
           try {
             const parsed = typeof log.images === 'string' ? JSON.parse(log.images) : log.images;
             if (Array.isArray(parsed)) images.push(...parsed);
           } catch (e) { console.error('Error parsing images log', e); }
        }

        if (images.length > 0) {
           for (const imgPath of images) {
              const machineName = machines.find(m => m.id === log.machineId)?.name || '—';
              const pRow = photoSheetToUse.addRow({
                 id: log.id.substring(0, 8),
                 machine: machineName,
                 photo: ''
              });
              pRow.height = 180;
              pRow.eachCell(cell => Object.assign(cell, cellStyle));
              
              try {
                const imgUrl = imgPath.startsWith('http') || imgPath.startsWith('/') ? imgPath : `/uploads/${imgPath}`;
                const response = await fetch(imgUrl);
                if (!response.ok) throw new Error('Image not found');
                const buffer = await response.arrayBuffer();
                const extension = imgPath.split('.').pop()?.toLowerCase() || 'jpg';
                
                const imageId = workbook.addImage({
                  buffer: buffer,
                  extension: (extension === 'png' || extension === 'gif') ? extension : 'jpeg',
                });
                
                photoSheetToUse.addImage(imageId, {
                  tl: { col: 2.1, row: photoRowIdx - 0.9 },
                  ext: { width: 420, height: 230 }
                });
              } catch (err) {
                console.error('Error adding image to Excel:', err);
                pRow.getCell('photo').value = '[Image non disponible]';
              }
              photoRowIdx++;
           }
        }

        // Conditional Formatting: Duration > 30 minutes
        if (typeof durationMin === 'number' && durationMin > 30) {
          const durationCell = row.getCell('duration');
          durationCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFC7CE' } // Red Light
          };
          durationCell.font = { color: { argb: 'FF9C0006' }, bold: true };
        }
      }

      // Dashboard Downtime
      dashboardSheet.getCell('A1').value = "ANALYSE PERFORMANCE - DASHBOARD ARRÊTS";
      dashboardSheet.getCell('A1').font = { size: 16, bold: true, color: { argb: 'FF1F4E78' } };
      dashboardSheet.mergeCells('A1:D1');
      dashboardSheet.getCell('A2').value = `Généré le : ${format(now, 'dd/MM/yyyy HH:mm')}`;

      // Total per Line
      let currentRow = 4;
      dashboardSheet.getCell(`A${currentRow}`).value = "Total Durée d'Arrêt par Ligne (min)";
      dashboardSheet.getCell(`A${currentRow}`).font = { bold: true, size: 11 };
      currentRow++;

      const lineHeaderRow = dashboardSheet.getRow(currentRow);
      ['Ligne', 'Durée Totale (min)'].forEach((h, i) => {
        const cell = lineHeaderRow.getCell(i + 1);
        cell.value = h;
        Object.assign(cell, headerStyle);
      });
      currentRow++;

      lines.forEach(line => {
        const row = dashboardSheet.getRow(currentRow);
        row.values = [
          line.name, 
          { formula: `SUMIF(Data!F:F, "${line.name}", Data!D:D)` }
        ];
        row.eachCell(cell => {
          Object.assign(cell, cellStyle);
          if (cell.type === ExcelJS.ValueType.Formula) {
            cell.numFmt = '0.0';
          }
        });
        currentRow++;
      });

      // Top 5 Causes
      currentRow += 2;
      dashboardSheet.getCell(`A${currentRow}`).value = "Top 5 des Causes d'Arrêt";
      dashboardSheet.getCell(`A${currentRow}`).font = { bold: true, size: 11 };
      currentRow++;

      const causeHeaderRow = dashboardSheet.getRow(currentRow);
      ['Motif d\'Arrêt', 'Nombre d\'Occurrences', 'Durée Cumulée (min)'].forEach((h, i) => {
        const cell = causeHeaderRow.getCell(i + 1);
        cell.value = h;
        Object.assign(cell, headerStyle);
      });
      currentRow++;

      const causeStats = downtimeTypes.map(t => {
        const filteredLogs = filteredDownLogs.filter(l => l.typeId === t.id);
        const totalMin = filteredLogs.reduce((acc, l) => acc + getLogDurationSec(l), 0) / 60;
        return {
          name: t.name,
          count: filteredLogs.length,
          totalMin
        };
      }).sort((a, b) => b.count - a.count).slice(0, 5);

      causeStats.forEach(stat => {
        const row = dashboardSheet.getRow(currentRow);
        row.values = [stat.name, stat.count, Number(stat.totalMin.toFixed(1))];
        row.eachCell(cell => Object.assign(cell, cellStyle));
        currentRow++;
      });
    }

    // Common Data Formatting
    dataSheet.getRow(1).eachCell(cell => {
      Object.assign(cell, headerStyle);
    });

    dataSheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        row.eachCell(cell => {
          Object.assign(cell, cellStyle);
        });
      }
    });

    // Auto-fit Column Widths (Better Logic)
    [dataSheet, dashboardSheet].forEach(sheet => {
      sheet.columns.forEach(column => {
        let maxLen = 0;
        column.eachCell?.({ includeEmpty: true }, (cell) => {
          const val = cell.value ? cell.value.toString() : '';
          maxLen = Math.max(maxLen, val.length);
        });
        column.width = Math.max(12, maxLen + 5);
      });
    });

    dataSheet.views = [{ state: 'frozen', ySplit: 1 }];

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
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col md:flex-row transition-colors duration-300 font-sans">
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
            <h1 className="font-black text-sm tracking-tighter text-gray-900 leading-none uppercase italic">FACTORY<span className="text-blue-600">CLOUD</span></h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={toggleTheme}
            className="p-1 px-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
            title="Changer le thème"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
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
                        : "text-gray-400 hover:bg-gray-50"
                    )}
                  >
                    <tab.icon size={16} strokeWidth={2.5} />
                    {tab.label}
                  </button>
                ))}
                
                <div className="mt-auto pt-4 border-t border-gray-100 space-y-2">
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

              <div className="flex justify-end px-1">
                <button 
                  onClick={() => openModal('downtime_log', {
                    startTime: new Date().toISOString(),
                    operatorId: user?.id,
                  })}
                  className="bg-white border border-gray-200 text-gray-900 px-4 py-2.5 rounded-xl font-black shadow-sm active:scale-95 transition-all text-[10px] tracking-widest uppercase flex items-center gap-2 hover:bg-gray-50 group"
                >
                  <div className="w-5 h-5 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-sm group-hover:scale-110 transition-transform">
                    <Plus size={12} strokeWidth={3} />
                  </div>
                  {t('add_downtime_log')}
                </button>
              </div>

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
                    <button 
                      onClick={() => openModal('downtime_log', {
                        startTime: new Date().toISOString(),
                        operatorId: user?.id || '',
                      })}
                      className="p-1.5 px-4 bg-green-600 hover:bg-green-700 rounded-lg text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-green-200 active:scale-95 transition-all flex items-center gap-2 border-2 border-green-500/20"
                    >
                      <Plus size={14} strokeWidth={3} /> {t('add_downtime_log') || 'Saisir un arrêt manuel'}
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
                     <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('start_date') || 'Début'}</p>
                     <input 
                      type="date"
                      value={historyDateFilter}
                      onChange={e => setHistoryDateFilter(e.target.value)}
                      className="w-full p-2 bg-white border border-gray-100 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm h-[38px]"
                     />
                   </div>

                   <div className="space-y-1">
                     <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('end_date') || 'Fin'}</p>
                     <input 
                      type="date"
                      value={historyEndDateFilter}
                      onChange={e => setHistoryEndDateFilter(e.target.value)}
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
                                const logDateOnly = log.timestamp.split('T')[0];
                                const matchDate = (!historyDateFilter || logDateOnly >= historyDateFilter) && 
                                                  (!historyEndDateFilter || logDateOnly <= historyEndDateFilter);
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
                                const logDateOnly = log.startTime.split('T')[0];
                                const matchDate = (!historyDateFilter || logDateOnly >= historyDateFilter) && 
                                                  (!historyEndDateFilter || logDateOnly <= historyEndDateFilter);
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
                                    <div className="flex justify-end gap-1 items-center">
                                      {log.image_path && (
                                        <button 
                                          onClick={() => setSelectedFullImage(log.image_path)}
                                          className="text-white bg-blue-500 p-1 rounded-lg hover:bg-blue-600 transition-colors"
                                          title="Voir la photo"
                                        >
                                          <Camera size={14} />
                                        </button>
                                      )}
                                      {log.images && (
                                        <div className="flex -space-x-2">
                                          {(typeof log.images === 'string' ? JSON.parse(log.images) as string[] : log.images as string[]).map((img, i) => (
                                            <button 
                                              key={i}
                                              onClick={() => setSelectedFullImage(img)}
                                              className="w-6 h-6 rounded-full border-2 border-white bg-blue-500 flex items-center justify-center text-white hover:scale-110 transition-all shadow-sm"
                                            >
                                              <Camera size={10} />
                                            </button>
                                          ))}
                                        </div>
                                      )}
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
                <div className="px-1 flex items-center gap-4">
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

      {/* IMAGE PREVIEW MODAL */}
      <AnimatePresence>
        {selectedFullImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedFullImage(null)}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4 cursor-pointer"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="relative max-w-4xl w-full"
              onClick={e => e.stopPropagation()}
            >
              <img 
                src={selectedFullImage.startsWith('http') || selectedFullImage.startsWith('/') ? selectedFullImage : `/uploads/${selectedFullImage}`}
                alt="Downtime Evidence" 
                className="w-full h-auto max-h-[90vh] object-contain rounded-2xl shadow-2xl"
                referrerPolicy="no-referrer"
              />
              <button 
                onClick={() => setSelectedFullImage(null)}
                className="absolute -top-12 right-0 text-white hover:text-gray-300 transition-colors bg-white/10 p-2 rounded-full backdrop-blur-md"
              >
                <X size={24} />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white w-full max-w-sm md:max-w-xl rounded-[32px] p-6 md:p-8 space-y-6 shadow-2xl border border-gray-100 max-h-[95vh] overflow-y-auto"
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('machine')}</label>
                    <select 
                      className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-700 text-xs"
                      value={modalData.machineId || ''}
                      onChange={e => {
                        const mId = e.target.value;
                        setModalData({ ...modalData, machineId: mId, lineId: '' });
                      }}
                    >
                      <option value="">{t('choose_machine')}</option>
                      {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('line')}</label>
                    <select 
                      className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-700 text-xs"
                      disabled={!modalData.machineId}
                      value={modalData.lineId || ''}
                      onChange={e => setModalData({...modalData, lineId: e.target.value})}
                    >
                      <option value="">{t('choose_line')}</option>
                      {lines.filter(l => l.machineId === modalData.machineId).map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('operator')}</label>
                    <select 
                      className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-700 text-xs"
                      value={modalData.operatorId || ''}
                      onChange={e => setModalData({...modalData, operatorId: e.target.value})}
                    >
                      <option value="">{t('select_operator') || 'Choisir un opérateur'}</option>
                      {users.map(u => (
                        <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('downtime_reason')}</label>
                    <select 
                      className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-700 text-xs"
                      value={modalData.typeId || ''}
                      onChange={e => setModalData({...modalData, typeId: e.target.value})}
                    >
                      <option value="">{t('select_reason')}</option>
                      {downtimeTypes.map(t => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('start_time')}</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-xs"
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
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('end_time')}</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-xs"
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
                  <div className="space-y-1.5 md:col-span-2">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">{t('description_comment')}</label>
                    <textarea 
                      className="w-full p-3 bg-gray-50 rounded-xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-xs min-h-[80px]"
                      placeholder={t('comments')}
                      value={modalData.description || ''}
                      onChange={e => setModalData({...modalData, description: e.target.value})}
                    />
                  </div>

                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Photos Galerie</label>
                    <div className="grid grid-cols-4 gap-2">
                       {/* Legacy single photo handling */}
                       {modalData.image_path && (
                         <div className="relative aspect-square rounded-xl overflow-hidden border border-gray-100 group">
                           <img 
                             src={`/uploads/${modalData.image_path}`} 
                             className="w-full h-full object-cover cursor-pointer"
                             onClick={() => setSelectedFullImage(modalData.image_path)}
                           />
                           <button 
                             onClick={() => setModalData({...modalData, image_path: null})}
                             className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100"
                           >
                             <Trash2 size={10} />
                           </button>
                         </div>
                       )}
                       
                       {/* Multi-photos handling */}
                       {(Array.isArray(modalData.images) ? modalData.images : (modalData.images ? JSON.parse(modalData.images) : [])).map((img: string, idx: number) => (
                         <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border border-gray-100 group">
                           <img 
                             src={img.startsWith('http') || img.startsWith('/') ? img : `/uploads/${img}`} 
                             className="w-full h-full object-cover cursor-pointer"
                             onClick={() => setSelectedFullImage(img)}
                           />
                           <button 
                             onClick={() => {
                               const imgs = Array.isArray(modalData.images) ? [...modalData.images] : JSON.parse(modalData.images || '[]');
                               imgs.splice(idx, 1);
                               setModalData({...modalData, images: imgs});
                             }}
                             className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100"
                           >
                             <Trash2 size={10} />
                           </button>
                         </div>
                       ))}
                       
                       <button
                         onClick={() => {
                            const input = document.createElement('input');
                            input.type = 'file';
                            input.accept = 'image/*';
                            input.onchange = async (e: any) => {
                              const file = e.target.files[0];
                              if (!file) return;
                              const formData = new FormData();
                              formData.append('photo', file);
                              const res = await fetch('/api/upload', {
                                method: 'POST',
                                body: formData
                              });
                              if (res.ok) {
                                const data = await res.json();
                                const filePath = data.path;
                                const imgs = Array.isArray(modalData.images) ? [...modalData.images] : (modalData.images ? JSON.parse(modalData.images) : []);
                                imgs.push(filePath);
                                setModalData({...modalData, images: imgs});
                              }
                            };
                            input.click();
                         }}
                         className="aspect-square border-2 border-dashed border-gray-200 rounded-xl flex flex-col items-center justify-center text-gray-400 hover:text-blue-500 hover:border-blue-500 transition-all"
                       >
                         <Camera size={20} />
                       </button>
                    </div>
                  </div>
                </div>
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input 
                      placeholder={editingId ? t('new_password_placeholder') || 'Nouveau mot de passe (optionnel)' : t('password') || 'Mot de passe'}
                      type="password"
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={modalData.pin || ''}
                      onChange={e => setModalData({...modalData, pin: e.target.value})}
                    />
                    <input 
                      placeholder={t('confirm_password') || 'Confirmer le mot de passe'}
                      type="password"
                      className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold"
                      value={confirmPin}
                      onChange={e => setConfirmPin(e.target.value)}
                    />
                  </div>
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

      {/* LIGHTBOX */}
      <AnimatePresence>
        {selectedFullImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 md:p-12"
            onClick={() => setSelectedFullImage(null)}
          >
            <button 
              className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors"
              onClick={() => setSelectedFullImage(null)}
            >
              <X size={40} />
            </button>
            <motion.img
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              src={`/uploads/${selectedFullImage}`}
              alt="Pleine résolution"
              className="max-w-full max-h-full object-contain shadow-2xl rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* CONFIRM DELETE MODAL */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-md z-[110] flex items-center justify-center p-4">
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
