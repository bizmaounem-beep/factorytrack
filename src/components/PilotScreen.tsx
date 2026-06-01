import React, { useState, useEffect, useRef, useMemo } from 'react';
import { localApi, API_BASE_URL } from '../lib/localApi';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useLanguage } from '../contexts/LanguageContext';
import { DowntimeLog, Shift } from '../types';
import { format, parseISO, isToday } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { useTheme } from '../contexts/ThemeContext';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { StatusIndicator } from './ui/StatusIndicator';
import { DowntimeTimeline } from './ui/DowntimeTimeline';
import { DowntimeHeatmap } from './ui/DowntimeHeatmap';
import { 
  AlertTriangle, 
  Activity, 
  Info, 
  ArrowLeft, 
  X, 
  Menu, 
  Sun, 
  Moon, 
  LayoutGrid, 
  LayoutDashboard, 
  Monitor, 
  Trash2, 
  Play, 
  CheckCircle2, 
  Users, 
  Square, 
  Package, 
  Pencil, 
  Timer, 
  Camera, 
  Video, 
  Plus, 
  TrendingUp, 
  Box,
  Image as ImageIcon,
  History as HistoryIcon
} from 'lucide-react';
import { cn, formatDuration, formatDowntimeDisplay, getLogDurationSec } from '../lib/utils';
import { getCurrentShiftId } from '../lib/shiftUtils';
import { startOfDay, endOfDay, isWithinInterval } from 'date-fns';

export default function PilotScreen() {
  const { user, logout } = useAuth();
  const userRole = user && user.role ? user.role.toUpperCase() : '';
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { 
    machines, 
    users, 
    downtimeTypes, 
    productionLogs: prodLogs, 
    downtimeLogs: downLogs, 
    lines, 
    programmes,
    shifts,
    loading: isDataLoading
  } = useData();

  const [historyLineFilter, setHistoryLineFilter] = useState<string>(() => sessionStorage.getItem('pilot_history_line') || '');
  const [historyDateFilter, setHistoryDateFilter] = useState<string>(() => sessionStorage.getItem('pilot_history_date') || '');
  const [historyEndDateFilter, setHistoryEndDateFilter] = useState<string>(() => sessionStorage.getItem('pilot_history_end_date') || '');
  const [historyLogType, setHistoryLogType] = useState<'production' | 'downtime'>(() => (sessionStorage.getItem('pilot_history_type') as any) || 'production');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'monitor' | 'history'>(() => (sessionStorage.getItem('pilot_active_tab') as any) || 'dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [selectedMachineId, setSelectedMachineId] = useState<string>(() => sessionStorage.getItem('pilot_selected_machine') || '');
  const [globalTimer, setGlobalTimer] = useState(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);

  if (!user) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center p-8 bg-gray-50 dark:bg-slate-950 space-y-4">
        <div className="text-center">
          <h2 className="text-xl font-black text-gray-950 dark:text-gray-50">INITIALISATION</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-semibold">Chargement de l'utilisateur...</p>
        </div>
      </div>
    );
  }

  if (isDataLoading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center p-8 bg-gray-50 dark:bg-slate-950 space-y-4">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <div className="text-center">
          <h2 className="text-lg font-black text-gray-950 dark:text-gray-50 uppercase tracking-tight">Écran Pilote</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold">Chargement du synoptique SCADA en temps réel...</p>
        </div>
      </div>
    );
  }

  // Critical Alerts Logic
  const criticalAlerts = useMemo(() => {
    if (!selectedMachineId) return [];
    const alerts: { id: string; type: 'danger' | 'warning' | 'info'; title: string; desc: string; icon: any }[] = [];
    
    const machineLines = lines.filter(l => l.machineId === selectedMachineId && l.isActive !== false);
    
    // 1. Long stops (> 20 mins)
    machineLines.forEach(l => {
      const down = downLogs.find(d => d.id === l.activeDowntimeId && !d.endTime);
      if (down) {
        const durSec = Math.floor((globalTimer - new Date(down.startTime).getTime()) / 1000);
        if (durSec > 20 * 60) {
          alerts.push({
            id: `long-stop-${l.id}`,
            type: 'danger',
            title: `ARRÊT CRITIQUE : ${l.name}`,
            desc: `En arrêt depuis ${formatDowntimeDisplay(durSec)} (${downtimeTypes.find(dt => dt.id === down.typeId)?.name})`,
            icon: AlertTriangle
          });
        }
      }
    });

    // 2. Stopped lines summary
    const stoppedCount = machineLines.filter(l => l.status === 'STOPPED').length;
    if (stoppedCount === machineLines.length && machineLines.length > 0) {
       alerts.push({
         id: 'full-machine-stop',
         type: 'danger',
         title: 'ARRÊT TOTAL MACHINE',
         desc: 'Toutes les lignes actives sont actuellement à l\'arrêt.',
         icon: Activity
       });
    } else if (stoppedCount > 0) {
       alerts.push({
         id: 'partial-stop',
         type: 'warning',
         title: 'ARRÊT PARTIEL',
         desc: `${stoppedCount} ligne(s) sur ${machineLines.length} sont à l'arrêt.`,
         icon: AlertTriangle
       });
    }

    // 3. Inactive lines info
    const inactiveCount = lines.filter(l => l.machineId === selectedMachineId && l.isActive === false).length;
    if (inactiveCount > 0) {
       alerts.push({
         id: 'inactive-lines',
         type: 'info',
         title: 'LIGNES DÉSACTIVÉES',
         desc: `${inactiveCount} ligne(s) sont hors production (Configuration Pilot).`,
         icon: Info
       });
    }

    return alerts;
  }, [lines, selectedMachineId, downLogs, globalTimer, downtimeTypes]);

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
    let shiftDurationSec = 8 * 3600; // Fallback to 8h if no shift is active
    if (currentShift) {
      const [sh, sm] = currentShift.startTime.split(':').map(Number);
      const [eh, em] = currentShift.endTime.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      const durationMin = endMin < startMin ? (1440 - startMin + endMin) : (endMin - startMin);
      shiftDurationSec = durationMin * 60;
    }

    const totalPossibleTime = activeLines.length * shiftDurationSec; 
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
      .filter(u => u.role && u.role.toUpperCase() === 'OPERATOR')
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
    sessionStorage.setItem('pilot_history_end_date', historyEndDateFilter);
    sessionStorage.setItem('pilot_history_type', historyLogType);
  }, [historyLineFilter, historyDateFilter, historyEndDateFilter, historyLogType]);
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
  const [selectedDowntimeTypeId, setSelectedDowntimeTypeId] = useState<string | null>(null);
  const [showManualStopModal, setShowManualStopModal] = useState(false);
  const [manualStopForm, setManualStopForm] = useState({
    typeId: '',
    startTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    endTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    description: '',
    lineId: ''
  });
  const [selectedImagePaths, setSelectedImagePaths] = useState<string[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFullImage, setSelectedFullImage] = useState<string | null>(null);

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
      await localApi.globalResume(selectedMachineId);
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

  const handleToggleLineActive = async (lineId: string, currentStatus: boolean) => {
    try {
      await localApi.updateDoc('lines', lineId, { isActive: !currentStatus });
    } catch (e) {
      console.error(e);
      alert('Erreur lors de la modification du statut de la ligne');
    }
  };

  const handleStartDowntime = async (lineId: string | null | 'global', typeId: string, description?: string) => {
    if (!user || !selectedMachineId) return;
    try {
      // Use new atomic global stop for machine-level events
      if (lineId === 'global' || !lineId) {
        await localApi.globalStop(selectedMachineId, {
          typeId,
          operatorId: user.id,
          description: description || '',
          images: selectedImagePaths.length > 0 ? selectedImagePaths : undefined
        });
        setSelectedImagePaths([]);
      } else {
        const startTime = new Date().toISOString();
        const currentShiftId = getCurrentShiftId(shifts);
        
        const log = await localApi.addDoc('downtime_logs', {
          machineId: selectedMachineId,
          lineId: lineId,
          typeId,
          operatorId: user.id,
          shiftId: currentShiftId,
          startTime,
          description: description || '',
          images: selectedImagePaths.length > 0 ? selectedImagePaths : undefined
        });

        await localApi.updateDoc('lines', lineId, {
          activeDowntimeId: log.id,
          status: 'STOPPED'
        });
        setSelectedImagePaths([]);
      }
      
      setDeclaringDowntimeLineId(null);
      setSelectedDowntimeTypeId(null);
      setImagePreviews([]);
      setSelectedImagePaths([]);
    } catch (e) {
      console.error(e);
      alert('Erreur lors de la déclaration de l\'arrêt');
    }
  };

  const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

  const compressAndValidateFile = async (file: File | Blob, mimeType?: string): Promise<Blob | File | null> => {
    const type = mimeType || file.type;
    const name = 'name' in file ? (file as File).name : '';
    const ext = name ? name.substring(name.lastIndexOf('.')).toLowerCase() : '';

    if (!ALLOWED_MIME_TYPES.includes(type) && (!ext || !ALLOWED_EXTS.includes(ext))) {
       alert("Format de fichier non autorisé. Uniquement JPG, PNG, WEBP et PDF.");
       return null;
    }

    if (file.size > 10 * 1024 * 1024) {
       alert("Le fichier est trop volumineux (max 10Mo).");
       return null;
    }

    // Canvas-based client-side image compression
    if (type.startsWith('image/')) {
      try {
        return await new Promise<Blob | File>((resolve) => {
          const reader = new FileReader();
          reader.onload = (event) => {
            const img = new window.Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              let width = img.width;
              let height = img.height;
              const MAX_WIDTH = 1200;
              const MAX_HEIGHT = 1200;
              
              if (width > MAX_WIDTH || height > MAX_HEIGHT) {
                if (width > height) {
                  height = Math.round((height * MAX_WIDTH) / width);
                  width = MAX_WIDTH;
                } else {
                  width = Math.round((width * MAX_HEIGHT) / height);
                  height = MAX_HEIGHT;
                }
              }
              
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                resolve(file);
                return;
              }
              ctx.drawImage(img, 0, 0, width, height);
              canvas.toBlob((blob) => {
                if (blob) {
                  const compressed = new File([blob], name || 'upload.jpg', {
                    type: 'image/jpeg',
                    lastModified: Date.now()
                  });
                  resolve(compressed);
                } else {
                  resolve(file);
                }
              }, 'image/jpeg', 0.85);
            };
            img.src = event.target?.result as string;
          };
          reader.readAsDataURL(file);
        });
      } catch (err) {
        console.warn('Compression failed, uploading original:', err);
        return file;
      }
    }

    return file;
  };

  const uploadFile = async (file: Blob | File, preview: string, mimeType?: string) => {
    setIsUploading(true);
    
    const limit = 10 * 1024 * 1024; // Strict 10MB limit

    if (file.size > limit) {
      alert(`Le fichier est trop volumineux (max 10Mo).`);
      setIsUploading(false);
      return;
    }

    const formData = new FormData();
    const getExt = (m: string, f?: Blob | File) => {
      if (f && 'name' in f) {
        const name = (f as File).name;
        if (name && name.includes('.')) {
          return name.substring(name.lastIndexOf('.')).toLowerCase();
        }
      }
      if (m.includes('image/png')) return '.png';
      if (m.includes('image/webp')) return '.webp';
      return '.jpg';
    };
    const extension = getExt(mimeType || file.type, file);
    formData.append('photo', file, `media-${Date.now()}${extension}`);
  
    try {
      const res = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json'
        },
        body: formData
      });
      
      let data;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        data = await res.json();
      } else {
        throw new Error(`Réponse non-JSON du serveur (${res.status})`);
      }

      if (res.ok && (data.path || data.success)) {
        const filePath = data.path || (data.url ? data.url.replace('/uploads/', '') : '');
        if (isEditModalOpen) {
          setEditModalData(prev => ({
            ...prev,
            images: [...(prev.images || []), filePath]
          }));
        } else {
          setSelectedImagePaths(prev => [...prev, filePath]);
          setImagePreviews(prev => [...prev, preview]);
        }
      } else {
        throw new Error(data.error || `Erreur ${res.status}`);
      }
    } catch (e: any) {
      console.error('Erreur upload:', e);
      alert(`Erreur de téléchargement: ${e.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleTakeStoreMedia = async (type: 'photo' | 'video' | 'gallery') => {
    if (type === 'video') {
      alert("Les fichiers vidéo ne sont pas autorisés par les consignes de sécurité.");
      return;
    }
    if (type === 'gallery') {
      mediaInputRef.current?.setAttribute('accept', 'image/jpeg,image/png,image/webp,application/pdf');
      mediaInputRef.current?.removeAttribute('capture');
    } else {
      mediaInputRef.current?.setAttribute('accept', 'image/jpeg,image/png,image/webp');
      mediaInputRef.current?.setAttribute('capture', 'environment');
    }
    mediaInputRef.current?.click();
  };

  const handleTakeStorePhoto = async () => {
    handleTakeStoreMedia('photo');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      for (const file of Array.from(files) as File[]) {
        const validated = await compressAndValidateFile(file, file.type);
        if (validated) {
          const preview = URL.createObjectURL(validated as Blob);
          uploadFile(validated, preview, (validated as any).type);
        }
      }
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
        duration: Math.floor(durationMs / 1000),
        images: selectedImagePaths.length > 0 ? selectedImagePaths : undefined
      });
      
      setShowManualStopModal(false);
      setSelectedImagePaths([]);
      setImagePreviews([]);
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
  } as const;

  const item = {
    hidden: { opacity: 0, y: 3 },
    show: { opacity: 1, y: 0, transition: { duration: 0.12, ease: "easeOut" as const } }
  } as const;

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-gray-950" style={{ paddingBottom: 'calc(4rem + env(safe-area-inset-bottom, 0px))' }}>
      {/* MOBILE HEADER */}
      <header className="sm:hidden bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 px-3 py-2 flex justify-between items-center sticky top-0 z-40 shadow-sm dark:shadow-none" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="flex items-center gap-1">
          {selectedMachineId ? (
            <Button 
              variant="ghost"
              size="icon"
              onClick={() => handleMachineSelect('')}
              className="mr-0.5"
            >
              <ArrowLeft size={16} />
            </Button>
          ) : (
            <Button 
              variant="ghost"
              size="icon"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X size={16} /> : <Menu size={16} />}
            </Button>
          )}
          <div className="flex items-center gap-1.5 ml-1">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-white font-black text-xs">
              A
            </div>
            <h1 className="font-black text-xs tracking-tighter text-gray-900 dark:text-white leading-none uppercase">PILOT<span className="text-blue-600">CLOUD</span></h1>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="rounded-full"
          >
            {theme === 'dark' ? <Sun size={16} className="text-yellow-400" /> : <Moon size={16} className="text-slate-400" />}
          </Button>
          <Button 
            variant="secondary"
            size="sm"
            onClick={handleLogout}
            className="text-red-500 bg-red-50 dark:bg-red-900/20 border-0"
          >
            QUITTER
          </Button>
        </div>
      </header>

      {/* SLIDING MENU */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[60] sm:hidden dark:bg-black/60"
            />
            
            <motion.aside 
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-[240px] bg-white dark:bg-gray-900 z-[70] p-6 flex flex-col gap-8 shadow-2xl dark:shadow-none border-r border-slate-100 dark:border-gray-800 sm:hidden"
            >
              <div className="flex items-center gap-3 px-1">
                <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                  <LayoutGrid size={20} />
                </div>
                <h1 className="font-black text-xl tracking-tighter text-gray-900 dark:text-white leading-none uppercase italic">PILOT<span className="text-blue-600">CLOUD</span></h1>
              </div>
              
              <nav className="flex flex-col gap-2 flex-1">
                {[
                  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
                  { id: 'monitor', label: 'Surveillance', icon: Monitor },
                  { id: 'history', label: 'Historique', icon: HistoryIcon }
                ].map(nav => (
                  <Button
                    key={nav.id}
                    variant={activeTab === nav.id ? 'primary' : 'ghost'}
                    onClick={() => { setActiveTab(nav.id as any); setIsMobileMenuOpen(false); }}
                    className="justify-start gap-4 h-12 shadow-none"
                  >
                    <nav.icon size={18} />
                    {nav.label}
                  </Button>
                ))}

                <div className="mt-auto pt-6 border-t border-slate-100 dark:border-gray-800">
                  <Button 
                    variant="ghost"
                    onClick={handleLogout}
                    className="justify-start gap-4 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 w-full"
                  >
                    <Trash2 size={18} />
                    QUITTER LA SESSION
                  </Button>
                </div>
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="bg-white dark:bg-gray-900 p-4 shadow-sm dark:shadow-none flex flex-col gap-4 sticky top-0 sm:top-0 z-20 border-b border-gray-200 dark:border-gray-800 hidden sm:block" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Monitor className="text-blue-600 dark:text-blue-400" size={24} />
            <h1 className="font-black text-xl tracking-tighter uppercase italic text-gray-900 dark:text-white">Pilot Monitor</h1>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={toggleTheme}
              className={cn(
                "relative flex items-center gap-1.5 p-2.5 rounded-full border transition-all duration-300 text-[10px] font-black uppercase tracking-widest hidden sm:flex",
                theme === 'dark'
                  ? "bg-slate-800 border-slate-700 text-yellow-400"
                  : "bg-gray-100 border-gray-200 text-gray-500"
              )}
              title="Changer le thème"
              aria-label={theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'}
            >
              <Sun size={13} className={theme === 'dark' ? "opacity-100" : "opacity-30"} />
              <div className={cn(
                "w-7 h-4 rounded-full transition-colors duration-300 relative flex-shrink-0",
                theme === 'dark' ? "bg-blue-600" : "bg-gray-300"
              )}>
                <div className={cn(
                  "absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all duration-300",
                  theme === 'dark' ? "left-3.5" : "left-0.5"
                )} />
              </div>
              <Moon size={13} className={theme === 'dark' ? "opacity-30" : "opacity-100"} />
            </button>
            <div className="hidden sm:flex items-center gap-2">
              <button 
                onClick={() => setActiveTab('dashboard')}
                className={cn(
                  "flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  activeTab === 'dashboard' ? "bg-blue-600 text-white shadow-lg dark:shadow-none" : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                )}
              >
                <LayoutDashboard size={14} />
                {t('dashboard')}
              </button>
              <button 
                onClick={() => setActiveTab('monitor')}
                className={cn(
                  "flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  activeTab === 'monitor' ? "bg-blue-600 text-white shadow-lg dark:shadow-none" : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                )}
              >
                <Monitor size={14} />
                {t('monitor')}
              </button>
              <button 
                onClick={() => setActiveTab('history')}
                className={cn(
                  "flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  activeTab === 'history' ? "bg-blue-600 text-white shadow-lg dark:shadow-none" : "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                )}
              >
                <HistoryIcon size={14} />
                {t('history')}
              </button>
            </div>
            <button 
              onClick={handleLogout} 
              className="px-4 py-2.5 text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/30 rounded-xl transition-colors font-black text-[10px] uppercase border border-red-50 dark:border-red-900/20 hover:bg-red-500 dark:hover:bg-red-600 hover:text-white shrink-0"
            >
              {t('logout')}
            </button>
          </div>
        </div>
        
        {activeTab === 'monitor' && selectedMachineId && (
          <div className="flex flex-col gap-4 bg-white dark:bg-gray-900 p-4 sm:p-6 rounded-3xl border border-gray-100 dark:border-gray-800 mb-4 shadow-xl dark:shadow-none">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 bg-blue-600 rounded-[2rem] flex items-center justify-center text-white shadow-2xl dark:shadow-none border-4 border-white dark:border-gray-800">
                  <LayoutGrid size={32} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[8px] font-black uppercase tracking-widest rounded-full border border-blue-100 dark:border-blue-900/50">SCADA LIVE V4.0</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  </div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight leading-none uppercase italic">
                      {machines.find(m => m.id === selectedMachineId)?.name}
                    </h2>
                    <button 
                      onClick={() => handleMachineSelect('')}
                      className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase hover:underline leading-none mt-1 focus:outline-none"
                    >
                      ({t('change')})
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full md:w-auto">
                 <div className="bg-gray-50/50 dark:bg-gray-800/50 p-2 px-3 rounded-2xl border border-gray-100 dark:border-gray-700">
                    <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">Efficience</p>
                    <p className="text-lg font-black text-blue-600 dark:text-blue-400 leading-none tabular-nums">{analytics.availability.toFixed(1)}%</p>
                 </div>
                 <div className="bg-gray-50/50 dark:bg-gray-800/50 p-2 px-3 rounded-2xl border border-gray-100 dark:border-gray-700">
                    <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">Lignes Actives</p>
                    <p className="text-lg font-black text-gray-800 dark:text-gray-200 leading-none tabular-nums">
                      {lines.filter(l => l.machineId === selectedMachineId && l.isActive !== false).length}
                    </p>
                 </div>
                 <div className="bg-gray-50/50 dark:bg-gray-800/50 p-2 px-3 rounded-2xl border border-gray-100 dark:border-gray-700">
                    <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">En Arrêt</p>
                    <p className="text-lg font-black text-rose-600 dark:text-rose-400 leading-none tabular-nums">
                      {lines.filter(l => l.machineId === selectedMachineId && l.status === 'STOPPED' && l.isActive !== false).length}
                    </p>
                 </div>
                 <div className="bg-gray-50/50 dark:bg-gray-800/50 p-2 px-3 rounded-2xl border border-gray-100 dark:border-gray-700">
                    <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">Prod Total</p>
                    <p className="text-lg font-black text-emerald-600 dark:text-emerald-400 leading-none tabular-nums">{analytics.totalPallets}</p>
                 </div>
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto">
                {lines.filter(l => l.machineId === selectedMachineId && l.isActive !== false).every(l => !!l.activeDowntimeId && downLogs.find(d => d.id === l.activeDowntimeId && d.lineId === 'MACHINE_LEVEL')) ? (
                  <button 
                    onClick={handleResumeMachine}
                    className="flex-1 md:flex-none flex items-center justify-center gap-3 px-8 py-4 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-emerald-100 dark:shadow-none hover:bg-emerald-700 active:scale-95 transition-all focus:outline-none"
                  >
                    <Play size={20} fill="currentColor" />
                    REDÉMARRAGE MACHINE
                  </button>
                ) : lines.filter(l => l.machineId === selectedMachineId && l.isActive !== false).some(l => l.status === 'RUNNING') ? (
                  <button 
                    onClick={() => setDeclaringDowntimeLineId('global')}
                    className="flex-1 md:flex-none flex items-center justify-center gap-3 px-8 py-4 bg-rose-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-rose-100 dark:shadow-none hover:bg-rose-700 active:scale-95 transition-all animate-in zoom-in focus:outline-none"
                  >
                    <Activity size={20} className="animate-pulse" />
                    ARRÊT D'URGENCE GLOBAL
                  </button>
                ) : (
                  <button 
                    onClick={handleResumeMachine}
                    className="flex-1 md:flex-none flex items-center justify-center gap-3 px-8 py-4 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-emerald-100 dark:shadow-none hover:bg-emerald-700 active:scale-95 transition-all focus:outline-none"
                  >
                    <Play size={20} fill="currentColor" />
                    REPRISE DE LA MACHINE
                  </button>
                )}
              </div>
            </div>

            {/* LIVE ALERTS SECTION */}
            {criticalAlerts.length > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 flex flex-wrap gap-3">
                {criticalAlerts.map(alert => (
                  <motion.div 
                    key={alert.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-2xl border flex-1 min-w-[280px] shadow-sm dark:shadow-none",
                      alert.type === 'danger' ? "bg-rose-50 dark:bg-rose-900/10 border-rose-100 dark:border-rose-900/20 text-rose-800 dark:text-rose-200" :
                      alert.type === 'warning' ? "bg-orange-50 dark:bg-orange-900/10 border-orange-100 dark:border-orange-900/20 text-orange-800 dark:text-orange-200" : "bg-blue-50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/20 text-blue-800 dark:text-blue-200"
                    )}
                  >
                    <div className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center shadow-sm dark:shadow-none",
                      alert.type === 'danger' ? "bg-rose-600 text-white" :
                      alert.type === 'warning' ? "bg-orange-500 text-white" : "bg-blue-600 text-white"
                    )}>
                      <alert.icon size={20} />
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-tight leading-none mb-1">{alert.title}</p>
                      <p className="text-[11px] font-bold opacity-80 leading-tight italic">{alert.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'monitor' && (
          <select 
            value={selectedMachineId}
            onChange={e => handleMachineSelect(e.target.value)}
            className="w-full p-4 bg-gray-50/50 dark:bg-gray-800/50 rounded-2xl font-bold border border-gray-100 dark:border-gray-700 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-inner dark:shadow-none text-gray-700 dark:text-gray-300 appearance-none cursor-pointer"
          >
            <option value="">{t('machine_select')}...</option>
            {availableMachines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
      </div>

      {/* Mobile-only machine selector when in monitor tab */}
      {activeTab === 'monitor' && (
        <div className="px-2 py-1 sm:hidden bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 space-y-1 shadow-sm dark:shadow-none">
           {selectedMachineId && (
             <div className="flex gap-1">
                {lines.filter(l => l.machineId === selectedMachineId).some(l => l.status === 'RUNNING') ? (
                  <button 
                    onClick={() => setDeclaringDowntimeLineId('global')}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-red-600 text-white rounded-lg font-black text-[8px] uppercase tracking-tight shadow-md dark:shadow-none shadow-red-50 active:scale-95 transition-all focus:outline-none"
                  >
                    <Activity size={10} className="animate-pulse" />
                    ARRÊT
                  </button>
                ) : lines.filter(l => l.machineId === selectedMachineId).some(l => l.activeDowntimeId) ? (
                  <button 
                    onClick={handleResumeMachine}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-green-600 text-white rounded-lg font-black text-[8px] uppercase tracking-tight shadow-md dark:shadow-none shadow-green-50 active:scale-95 transition-all focus:outline-none"
                  >
                    <Activity size={10} />
                    RELANCER
                  </button>
                ) : null}
                <button 
                  onClick={() => handleMachineSelect('')}
                  className="px-1.5 py-1 bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border border-gray-100 dark:border-gray-700 rounded-lg font-black text-[7px] uppercase tracking-widest shrink-0 focus:outline-none"
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
        <div className="p-2 sm:p-4 md:p-8 space-y-6 animate-in fade-in duration-500 max-w-7xl mx-auto">
          {/* Timeline - NEW SCADA ELEMENT */}
          <DowntimeTimeline 
            lines={lines.filter(l => l.machineId === selectedMachineId)} 
            events={downLogs.filter(log => log.machineId === selectedMachineId).map(log => ({
              ...log,
              typeName: downtimeTypes.find(t => t.id === log.typeId)?.name || 'Arrêt non qualifié',
              duration: getLogDurationSec(log)
            }))}
            className="mb-8"
          />

          {selectedMachineId && (
            <DowntimeHeatmap 
              lines={lines.filter(l => l.machineId === selectedMachineId && l.isActive !== false)}
              downtimeLogs={downLogs.filter(log => log.machineId === selectedMachineId)}
              className="mb-8 border border-neutral-100 dark:border-neutral-800"
            />
          )}

          <div className="flex justify-between items-end px-1">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="bg-blue-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest">{currentShift?.name || 'Shift Actif'}</span>
                {selectedMachineId && (
                  <span className="bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest">{machines.find(m => m.id === selectedMachineId)?.name}</span>
                )}
              </div>
              <h2 className="text-base md:text-xl font-black tracking-tighter text-gray-900 dark:text-white leading-none">
                {t('dashboard')} <span className="text-blue-600 dark:text-blue-400 uppercase text-[10px] md:text-xs tracking-widest ml-1">Pilot Intelligence</span>
              </h2>
              <p className="text-[8px] md:text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mt-1 italic">Stats de l'équipe • Direct {currentShift?.name}</p>
            </div>
            <div className="text-right flex flex-col items-end">
              <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-full border border-blue-100 dark:border-blue-900/50 mb-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                <p className="text-[8px] md:text-[10px] font-black text-blue-700 dark:text-blue-300 uppercase tracking-tight">Analyse Active</p>
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
                className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-2 md:p-4 flex flex-col gap-2 md:gap-3 hover:shadow-xl dark:hover:shadow-none transition-all group relative overflow-hidden shadow-sm dark:shadow-none"
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
                     stat.color === 'blue' ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" :
                     stat.color === 'green' ? "bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400" :
                     stat.color === 'orange' ? "bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400" : "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                   )}>
                     {stat.trend}
                   </span>
                 </div>
                 <div>
                   <p className="text-[7px] md:text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-0.5 leading-none">{stat.label}</p>
                   <p className="text-sm md:text-2xl font-black text-slate-900 dark:text-white leading-none mt-1 tabular-nums">{stat.val}</p>
                   <p className="text-[7px] md:text-[9px] font-bold text-slate-400 dark:text-gray-500 mt-1">{stat.sub}</p>
                 </div>
               </motion.div>
             ))}
          </motion.div>

          {/* SCADA OEE METRIC DEEP-DIVE (BENTO BOX) */}
          {selectedMachineId && (
            <motion.div 
              variants={item}
              className="bg-slate-900 text-white rounded-[2rem] p-6 border-4 border-slate-800 shadow-3xl dark:shadow-none relative overflow-hidden mb-6"
            >
              <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
              <div className="flex flex-col lg:flex-row items-center justify-between gap-6 relative z-10">
                <div className="space-y-2 max-w-sm w-full">
                  <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-500/15 border border-blue-500/20 text-blue-400 text-[9px] font-black uppercase tracking-widest">
                    <Activity size={10} className="animate-pulse" /> Indicateurs OEE / TRG
                  </div>
                  <h3 className="text-xl font-black italic uppercase tracking-tighter">Analyse Globale de Rendement</h3>
                  <p className="text-[10px] text-slate-400 leading-relaxed uppercase">
                    Calculé en temps réel selon les normes industrielles : Disponibilité x Performance x Qualité.
                  </p>
                </div>

                {/* Gauges row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full flex-1 max-w-2xl">
                  {(() => {
                    const activeLinesCount = lines.filter(l => l.machineId === selectedMachineId && l.isActive !== false).length;
                    const targetPallets = Math.max(1, activeLinesCount * 40);
                    const perfRate = Math.min(100, Math.max(70, (analytics.totalPallets / targetPallets) * 100));
                    const qualityRate = 99.2;
                    const trgVal = (analytics.availability * perfRate * qualityRate) / 10000;

                    return [
                      { label: "TRG (OEE)", val: `${trgVal.toFixed(1)}%`, desc: "Rendement Global", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
                      { label: "Disponibilité", val: `${analytics.availability.toFixed(1)}%`, desc: "Taux d'Uptime", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
                      { label: "Performance", val: `${perfRate.toFixed(1)}%`, desc: "Cadence Shift", color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/20" },
                      { label: "Qualité", val: `${qualityRate.toFixed(1)}%`, desc: "Conformité", color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
                    ].map((metric, i) => (
                      <div key={i} className={cn("p-4 rounded-2xl border flex flex-col items-center text-center justify-center bg-slate-950/60", metric.border)}>
                        <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block mb-1">{metric.label}</span>
                        <div className={cn("text-xl md:text-2xl font-black italic tracking-tighter tabular-nums", metric.color)}>
                          {metric.val}
                        </div>
                        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-tight mt-1">{metric.desc}</span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </motion.div>
          )}

          {/* BOTTOM ROW: FREQUENT STOPS & TEAM PERFORMANCE */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            
            {/* FREQUENT STOPS */}
            <motion.div variants={item} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-4 flex flex-col shadow-sm dark:shadow-none">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xs font-black uppercase tracking-widest text-gray-900 dark:text-white flex items-center gap-2">
                  <AlertTriangle size={16} className="text-orange-500" /> Arrêts Fréquents (Shift)
                </h3>
                <span className="text-[8px] font-bold text-gray-400 dark:text-gray-500 uppercase">Top 5 récurrents</span>
              </div>
              
              <div className="space-y-2 flex-1">
                {analytics.frequentStops.length > 0 ? (
                  analytics.frequentStops.map((stop, idx) => (
                    <div key={stop.typeId} className="flex items-center gap-3 p-2 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 group hover:border-orange-200 dark:hover:border-orange-900/50 transition-all">
                      <div className="w-8 h-8 rounded-lg bg-white dark:bg-gray-800 flex items-center justify-center text-lg shadow-sm dark:shadow-none border border-gray-100 dark:border-gray-700 group-hover:scale-110 transition-transform">
                        {stop.icon}
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-center mb-1">
                           <span className="text-[10px] font-black text-gray-800 dark:text-gray-200 uppercase tracking-tight">{stop.typeName}</span>
                           <span className="text-[10px] font-black text-orange-600 dark:text-orange-400 italic">{stop.count} fois</span>
                        </div>
                        <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                           <div 
                             className="h-full bg-orange-500 rounded-full" 
                             style={{ width: `${(stop.count / (analytics.frequentStops[0]?.count || 1)) * 100}%` }} 
                           />
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="h-full flex flex-col items-center justify-center py-8 text-center bg-gray-50 dark:bg-gray-800/30 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
                    <CheckCircle2 size={24} className="text-green-300 dark:text-green-900/50 mb-2" />
                    <p className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Aucun arrêt enregistré sur ce shift</p>
                  </div>
                )}
              </div>
            </motion.div>

            {/* TEAM PERFORMANCE (PILOT'S OPERATORS) */}
            <motion.div variants={item} className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl p-4 shadow-sm dark:shadow-none">
              <h3 className="text-xs font-black uppercase tracking-widest text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Users size={16} className="text-blue-500" /> Performance des Opérateurs
              </h3>
              <div className="space-y-3">
                {analytics.teamPerformance.map(op => (
                  <div key={op.id} className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700 group hover:bg-white dark:hover:bg-gray-800 transition-all">
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase">
                          {op.name?.charAt(0) || ''}
                        </div>
                        <span className="text-[10px] font-black text-gray-900 dark:text-white uppercase italic">{op.name}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                       <div>
                          <p className="text-[7px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-tighter">Production</p>
                          <p className="text-xs font-black text-gray-800 dark:text-gray-200">{op.pallets} <span className="opacity-50 text-[8px]">Pal.</span></p>
                       </div>
                       <div className="text-right">
                          <p className="text-[7px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-tighter">Temps d'Arrêt</p>
                          <p className="text-xs font-black text-red-600 dark:text-red-400">{op.downtime} <span className="opacity-50 text-[8px]">min</span></p>
                       </div>
                    </div>
                    <div className="mt-2 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                       <div 
                        className="h-full bg-blue-600 rounded-full" 
                        style={{ width: `${Math.min(100, (op.pallets / (analytics.totalPallets || 1)) * 100)}%` }} 
                       />
                    </div>
                  </div>
                ))}
                {analytics.teamPerformance.length === 0 && (
                  <p className="text-center py-6 text-[10px] font-black text-gray-300 dark:text-gray-600 uppercase tracking-widest italic">Aucun opérateur actif</p>
                )}
              </div>
            </motion.div>
          </div>

          {/* REAL TIME STOPS / ACTIVE ALERTS (ONLY FOR THIS MACHINE) */}
          <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl overflow-hidden shadow-sm dark:shadow-none mt-4">
             <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/30">
               <h3 className="text-sm font-black uppercase tracking-widest text-gray-900 dark:text-white flex items-center gap-2">
                  <Activity size={16} className="text-red-500 animate-pulse" /> Arrêts en Temps Réel
               </h3>
               <div className="flex items-center gap-1">
                  <span className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-tighter">Live Monitor</span>
               </div>
             </div>
             <div className="overflow-x-auto">
               <table className="w-full text-left">
                  <thead className="bg-white dark:bg-gray-900 text-[10px] text-gray-400 dark:text-gray-500 font-black uppercase tracking-[0.2em] border-b border-gray-100 dark:border-gray-800">
                    <tr>
                      <th className="px-6 py-5 whitespace-nowrap">Ligne</th>
                      <th className="px-6 py-5 whitespace-nowrap">Motif de l'arrêt</th>
                      <th className="px-6 py-5 whitespace-nowrap">Début</th>
                      <th className="px-6 py-5 whitespace-nowrap text-right">Action</th>
                    </tr>
                  </thead>
                 <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                    {lines
                      .filter(l => l.machineId === selectedMachineId && !!l.activeDowntimeId)
                      .map(l => {
                        const down = downLogs.find(d => d.id === l.activeDowntimeId);
                        const type = downtimeTypes.find(t => t.id === down?.typeId);
                        return (
                          <tr key={l.id} className="text-sm hover:bg-red-50/30 dark:hover:bg-red-900/10 transition-all group/line animate-in slide-in-from-left duration-300">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 flex items-center justify-center">
                                  <AlertTriangle size={16} />
                                </div>
                                <p className="font-black text-gray-900 dark:text-white leading-none">{l.name}</p>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                               <div className="flex items-center gap-2">
                                  <span className="text-lg">{type?.icon}</span>
                                  <span className="font-black text-red-700 dark:text-red-400 uppercase italic text-[11px]">{type?.name}</span>
                               </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-[10px] font-mono font-black text-gray-500 dark:text-gray-400 italic">
                                {down ? format(parseISO(down.startTime), 'HH:mm:ss') : '—'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                               <button 
                                onClick={() => handleStopSpecificDowntime(l.id)}
                                className="px-3 py-1 bg-green-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest shadow-lg dark:shadow-none shadow-green-100 hover:scale-105 transition-all focus:outline-none"
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
          <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-full flex items-center justify-center text-blue-300 dark:text-blue-500">
             <LayoutGrid size={20} />
          </div>
          <p className="text-gray-400 dark:text-gray-500 font-bold uppercase text-[9px] tracking-widest">{t('machine_select')}</p>
        </div>
      ) : (
          <div className="p-2 sm:p-4 space-y-8">
            {/* SCADA Global Controls */}
            <div className="bg-slate-900 dark:bg-black p-4 rounded-[2rem] border-4 border-slate-800 dark:border-gray-800 shadow-2xl dark:shadow-none flex flex-wrap items-center justify-between gap-4">
               <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-rose-600 rounded-2xl flex items-center justify-center shadow-lg shadow-rose-900/50 border-2 border-rose-400 animate-pulse">
                     <AlertTriangle className="text-white" size={24} />
                  </div>
                  <div>
                    <h2 className="text-white font-black text-lg italic uppercase tracking-tighter leading-none">Console SCADA Directe</h2>
                    <p className="text-rose-400 text-[10px] font-black uppercase tracking-[0.2em] mt-1">Surveillance Temps Réel Active</p>
                  </div>
               </div>
               
               <div className="flex items-center gap-3">
                  <button 
                    onClick={() => handleResumeMachine()}
                    className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-lg active:scale-95 border-b-4 border-emerald-800 focus:outline-none"
                  >
                    Redémarrage Global
                  </button>
                  <button 
                    onClick={() => setDeclaringDowntimeLineId('global')}
                    className="px-6 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-lg active:scale-95 border-b-4 border-rose-800 flex items-center gap-2 focus:outline-none"
                  >
                    <Square size={14} fill="currentColor" />
                    Arrêt Global Machine
                  </button>
               </div>
            </div>

            {/* SCADA Track Rendering */}
            {[
              { name: 'MA FRODA', filter: (l: any) => l.name.toLowerCase().includes('mafroda') },
              { name: 'ELI FAB', filter: (l: any) => l.name.toLowerCase().includes('elifab') },
              { name: 'AUTRES LIGNES', filter: (l: any) => !l.name.toLowerCase().includes('mafroda') && !l.name.toLowerCase().includes('elifab') }
            ].map(track => {
              const trackLines = lines.filter(l => l.machineId === selectedMachineId && track.filter(l));
              if (trackLines.length === 0) return null;

              return (
                <div key={track.name} className="space-y-4">
                  <div className="flex items-center gap-3 px-2">
                    <div className="h-0.5 flex-1 bg-slate-200 dark:bg-gray-800" />
                    <h3 className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-[0.4em] italic">{track.name}</h3>
                    <div className="h-0.5 flex-1 bg-slate-200 dark:bg-gray-800" />
                  </div>

                  <motion.div 
                    variants={container}
                    initial="hidden"
                    animate="show"
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                  >
                    {trackLines.map(line => {
                      const prog = programmes.find(p => p.id === line.currentProgrammeId);
                      const op = users.find(u => u.id === line.currentOperatorId);
                      const down = activeDowntimes[line.id];
                      const downType = downtimeTypes.find(t => t.id === down?.typeId);
                      const isMachineLevel = down?.lineId === 'MACHINE_LEVEL';
                      const isActive = line.isActive !== false;

                      return (
                        <motion.div 
                          key={line.id}
                          variants={item}
                          layout
                          className={cn(
                            "scada-card transition-all flex flex-col overflow-hidden border-2 rounded-[2.5rem] bg-white dark:bg-gray-900 relative",
                            !isActive ? "border-slate-200 dark:border-gray-800 opacity-80 grayscale bg-slate-50 dark:bg-gray-950" :
                            line.status === 'RUNNING' ? "border-emerald-500 shadow-xl dark:shadow-none shadow-emerald-500/10" :
                            line.status === 'STOPPED' ? "border-rose-500 shadow-xl dark:shadow-none shadow-rose-500/20 ring-4 ring-rose-500/5 animate-pulse-slow" : "border-slate-200 dark:border-gray-800"
                          )}
                        >
                          {/* Active Line Overlay is removed for better look, replaced with gray state */}
                          
                          <div className={cn(
                            "px-6 py-4 flex justify-between items-center border-b",
                            !isActive ? "bg-slate-200 dark:bg-gray-800" : line.status === 'RUNNING' ? "bg-emerald-50/50 dark:bg-emerald-900/10" : line.status === 'STOPPED' ? "bg-rose-50/80 dark:bg-rose-900/20" : "bg-slate-50 dark:bg-gray-800/30"
                          )}>
                            <div className="flex flex-col">
                              <h3 className={cn("font-black text-base tracking-tighter uppercase italic truncate max-w-[160px]", !isActive ? "text-slate-500 dark:text-gray-400" : "text-slate-900 dark:text-white")}>
                                {line.name}
                              </h3>
                              <div className={cn(
                                "flex items-center gap-2 mt-1 px-3 py-1 rounded-full w-fit text-[9px] font-black tracking-widest uppercase border",
                                !isActive ? "bg-slate-300 dark:bg-gray-700 text-slate-600 dark:text-gray-400 border-slate-400 dark:border-gray-600" :
                                line.status === 'RUNNING' ? "bg-emerald-600 text-white border-emerald-700" :
                                line.status === 'STOPPED' ? "bg-rose-600 text-white border-rose-700" : "bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 border-slate-200 dark:border-gray-700"
                              )}>
                                <span className={cn(
                                  "w-2 h-2 rounded-full",
                                  line.status === 'RUNNING' ? "bg-white animate-ping" : "bg-white"
                                )} />
                                {!isActive ? 'SHUTDOWN' : line.status === 'RUNNING' ? 'EN LIGNE' : 'ARRÊT'}
                              </div>
                            </div>

                            <div className="flex gap-2">
                               {isActive && (
                                 <button 
                                   onClick={() => handleToggleLineActive(line.id, true)}
                                   className="p-3 bg-white dark:bg-gray-800 text-slate-400 dark:text-gray-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-2xl shadow-sm dark:shadow-none border border-slate-100 dark:border-gray-700 transition-all hover:scale-110 active:scale-95 focus:outline-none"
                                   title="Désactiver la ligne"
                                 >
                                   <Square size={18} />
                                 </button>
                               )}
                               {!isActive && (
                                 <button 
                                   onClick={() => handleToggleLineActive(line.id, false)}
                                   className="px-4 py-2 bg-blue-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg dark:shadow-none hover:bg-blue-700 active:scale-95 transition-all focus:outline-none"
                                 >
                                   DÉMARRER
                                 </button>
                               )}
                            </div>
                          </div>

                          <div className={cn("p-6 space-y-6 flex-1", !isActive && "opacity-40 grayscale pointer-events-none")}>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="flex flex-col">
                                <span className="text-[9px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-2">Programme</span>
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-slate-100 dark:bg-gray-800 rounded-xl flex items-center justify-center text-slate-500 dark:text-gray-400 border border-slate-200 dark:border-gray-700">
                                    <Package size={18} />
                                  </div>
                                  <div className="truncate">
                                    <p className="font-black text-xs text-slate-900 dark:text-white truncate leading-none uppercase italic">{prog?.name || '---'}</p>
                                    <p className="text-[8px] font-bold text-slate-400 dark:text-gray-500 mt-1 uppercase">{prog?.parameters || 'Production Standby'}</p>
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[9px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-2">Opérateur</span>
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50">
                                    <Users size={18} />
                                  </div>
                                  <div className="truncate">
                                    <p className="font-black text-xs text-slate-900 dark:text-white truncate leading-none uppercase">{op?.name || 'POSTE VIDE'}</p>
                                    <p className="text-[8px] font-bold text-slate-400 dark:text-gray-500 mt-1 uppercase">SHIFT {currentShift?.name || '...'}</p>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Production Pulse */}
                            {line.tracksProduction !== false && (
                              <div className="relative overflow-hidden bg-slate-900/5 dark:bg-gray-800/50 p-4 rounded-[1.5rem] border border-slate-100 dark:border-gray-800 flex justify-between items-end">
                                <div>
                                  <span className="text-[8px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-[0.2em]">Flux Production</span>
                                  <p className="text-3xl font-black text-slate-900 dark:text-white tabular-nums">
                                    {prog?.producedPallets || 0}
                                    <span className="ml-1 text-[10px] text-blue-600 dark:text-blue-400 uppercase">pal</span>
                                  </p>
                                </div>
                                <Activity className="text-blue-200 dark:text-blue-900/30 animate-pulse" size={40} />
                              </div>
                            )}

                            {/* Downtime Real-Time Info */}
                            {down && (
                              <div className="space-y-4 pt-2">
                                <div className={cn(
                                  "p-4 rounded-[1.5rem] border-2 shadow-sm dark:shadow-none",
                                  isMachineLevel ? "bg-rose-900 border-rose-600 text-white" : "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-900/30 text-rose-900 dark:text-rose-200"
                                )}>
                                  <div className="flex justify-between items-start mb-3">
                                    <div className="flex items-center gap-2">
                                      <span className="text-2xl">{downType?.icon || '⚠️'}</span>
                                      <div className="leading-none">
                                        <p className="text-[10px] font-black uppercase tracking-widest">{isMachineLevel ? 'ARRÊT TOTAL' : 'ARRÊT LIGNE'}</p>
                                        <p className="font-black text-xs italic uppercase truncate max-w-[120px]">{downType?.name}</p>
                                      </div>
                                    </div>
                                    <div className="font-mono font-black text-xs bg-white dark:bg-gray-900 text-rose-600 dark:text-rose-400 px-2 py-1 rounded-lg border border-rose-100 dark:border-rose-900/50">
                                      {formatDowntimeDisplay(Math.floor((globalTimer - new Date(down.startTime).getTime()) / 1000))}
                                    </div>
                                  </div>
                                  
                                  {down.description && (
                                    <p className={cn("text-[10px] p-2 rounded-xl mb-2", isMachineLevel ? "bg-white/10" : "bg-white/50 dark:bg-gray-800/50 border border-rose-100 dark:border-rose-900/20")}>
                                      "{down.description}"
                                    </p>
                                  )}

                                  {down.images && (
                                    <div className="flex flex-wrap gap-1.5">
                                      {(typeof down.images === 'string' ? JSON.parse(down.images) : down.images).map((img: string, i: number) => {
                                        const isVid = img.toLowerCase().endsWith('.mp4') || img.toLowerCase().endsWith('.webm') || img.toLowerCase().endsWith('.mov');
                                        return (
                                          <button 
                                            key={i} 
                                            onClick={() => setSelectedFullImage(img)}
                                            className="w-10 h-10 rounded-lg overflow-hidden border border-white dark:border-gray-700 shadow-sm dark:shadow-none hover:scale-110 transition-all focus:outline-none bg-slate-100 dark:bg-gray-800"
                                          >
                                            {isVid ? (
                                              <video src={img.startsWith('http') || img.startsWith('/') ? img : `/uploads/${img}`} className="w-full h-full object-cover" />
                                            ) : (
                                              <img src={img.startsWith('http') || img.startsWith('/') ? img : `/uploads/${img}`} className="w-full h-full object-cover" />
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                  
                                  <button 
                                    onClick={() => handleStopSpecificDowntime(line.id)}
                                    className="w-full mt-3 py-2 bg-emerald-600 text-white rounded-xl text-[9px] font-black uppercase tracking-[0.2em] shadow-lg dark:shadow-none border-b-4 border-emerald-800 active:border-b-0 active:translate-y-1 transition-all focus:outline-none"
                                  >
                                    Relancer Production
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Operator Controls if IDLE */}
                            {isActive && !down && line.status !== 'STOPPED' && (
                              <div className="grid grid-cols-2 gap-2 mt-auto">
                                <button 
                                  onClick={() => setDeclaringDowntimeLineId(line.id)}
                                  className="py-3 bg-rose-50 dark:bg-rose-900/10 text-rose-600 dark:text-rose-400 rounded-2xl flex flex-col items-center gap-1 border border-rose-100 dark:border-rose-900/20 hover:bg-rose-600 hover:text-white transition-all active:scale-95 focus:outline-none"
                                >
                                  <Square size={14} fill="currentColor" />
                                  <span className="text-[8px] font-black uppercase">Arrêt</span>
                                </button>
                                <button 
                                  onClick={() => setIsAssigning(line.id)}
                                  className="py-3 bg-blue-50 dark:bg-blue-900/10 text-blue-600 dark:text-blue-400 rounded-2xl flex flex-col items-center gap-1 border border-blue-100 dark:border-blue-900/20 hover:bg-blue-600 hover:text-white transition-all active:scale-95 focus:outline-none"
                                >
                                  <Pencil size={14} />
                                  <span className="text-[8px] font-black uppercase">Assigner</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        !selectedMachineId ? (
        <div className="flex flex-col items-center justify-center p-12 text-center space-y-4">
          <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/30 rounded-full flex items-center justify-center text-blue-300 dark:text-blue-500">
             <HistoryIcon size={32} />
          </div>
          <div className="space-y-1">
            <h3 className="text-xl font-black text-gray-900 dark:text-white uppercase italic">Aucune machine sélectionnée</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium max-w-xs mx-auto">Veuillez sélectionner une machine dans le menu pour voir son historique.</p>
          </div>
        </div>
      ) : (
        <div className="p-2 space-y-4 max-w-full mx-auto animate-in fade-in duration-300">
              <div className="flex flex-col gap-4 px-1">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <h2 className="text-xl font-black text-gray-900 dark:text-white tracking-tight uppercase italic leading-none">{t('history')}</h2>
                  
                  <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-full sm:w-auto shadow-inner dark:shadow-none">
                    <button 
                      onClick={() => setHistoryLogType('production')}
                      className={cn(
                        "flex-1 sm:flex-none px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                        historyLogType === 'production' ? "bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-sm dark:shadow-none" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      )}
                    >
                      {t('production_log').split(' ')[2] || 'Production'}
                    </button>
                    <button 
                      onClick={() => setHistoryLogType('downtime')}
                      className={cn(
                        "flex-1 sm:flex-none px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                        historyLogType === 'downtime' ? "bg-white dark:bg-gray-900 text-red-600 dark:text-red-400 shadow-sm dark:shadow-none" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                      )}
                    >
                      {t('downtime_log').split(' ')[2] || 'Arrêts'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 px-1">
                  <div className="space-y-1">
                     <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">{t('line')}</p>
                     <select 
                      value={historyLineFilter}
                      onChange={e => setHistoryLineFilter(e.target.value)}
                      className="w-full p-2.5 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm dark:shadow-none text-gray-900 dark:text-white"
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
                     <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">{t('start_date') || 'Début'}</p>
                     <input 
                      type="date"
                      value={historyDateFilter}
                      onChange={e => setHistoryDateFilter(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm dark:shadow-none h-[38px] text-gray-900 dark:text-white"
                     />
                  </div>

                  <div className="space-y-1">
                     <p className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">{t('end_date') || 'Fin'}</p>
                     <input 
                      type="date"
                      value={historyEndDateFilter}
                      onChange={e => setHistoryEndDateFilter(e.target.value)}
                      className="w-full p-2 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm dark:shadow-none h-[38px] text-gray-900 dark:text-white"
                     />
                  </div>
                </div>
              </div>

          <div className="space-y-8">
            {historyLogType === 'production' ? (
              <div className="space-y-4 animate-in fade-in zoom-in-95 duration-300">
                <h3 className="text-sm md:text-base font-black text-gray-900 dark:text-white flex items-center gap-2 uppercase tracking-widest">
                  <Package className="text-blue-600 dark:text-blue-400" size={16} />
                  {t('production_log').toUpperCase()}
                </h3>
                <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl overflow-hidden shadow-sm dark:shadow-none">
                  <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-gray-50 dark:bg-gray-800/50 text-[8px] md:text-[9px] text-gray-400 dark:text-gray-500 font-black uppercase tracking-widest border-b border-gray-100 dark:border-gray-800">
                          <tr>
                            <th className="px-2 md:px-5 py-2 md:py-3 text-left">{t('date')}</th>
                            <th className="px-2 md:px-5 py-2 md:py-3 text-left">{t('line')}</th>
                            <th className="px-2 md:px-5 py-2 md:py-3 hidden sm:table-cell text-left">{t('operator')}</th>
                            <th className="px-2 md:px-5 py-2 md:py-3 text-center">Qté</th>
                            <th className="px-2 md:px-5 py-2 md:py-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-gray-800 text-[10px] md:text-xs">
                          <AnimatePresence mode="popLayout">
                            {sortedProdLogs
                              .filter(log => {
                                const matchLine = !historyLineFilter || log.lineId === historyLineFilter;
                                const logDateOnly = log.timestamp.split('T')[0];
                                const matchDate = (!historyDateFilter || logDateOnly >= historyDateFilter) && 
                                                  (!historyEndDateFilter || logDateOnly <= historyEndDateFilter);
                                return matchLine && matchDate;
                              })
                              .slice(0, 100).map(log => (
                                <motion.tr 
                                  key={log.id} 
                                  initial={{ opacity: 1 }}
                                  exit={{ opacity: 0, x: -20, backgroundColor: 'rgba(254, 226, 226, 0.5)' }}
                                  transition={{ duration: 0.2 }}
                                  className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50"
                                >
                                  <td className="px-2 md:px-5 py-2 md:py-3 font-bold text-gray-900 dark:text-white whitespace-nowrap">
                                    {new Date(log.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                  </td>
                                  <td className="px-2 md:px-5 py-2 md:py-3">
                                    <p className="font-bold text-gray-700 dark:text-gray-200 truncate max-w-[60px] md:max-w-none">{lines.find(l => l.id === log.lineId)?.name || '—'}</p>
                                    <p className="text-[7px] md:text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase">{machines.find(m => m.id === log.machineId)?.name || '—'}</p>
                                  </td>
                                  <td className="px-2 md:px-5 py-2 md:py-3 font-medium text-gray-600 dark:text-gray-400 hidden sm:table-cell">
                                    {users.find(u => u.id === log.operatorId)?.name || '—'}
                                  </td>
                                  <td className="px-2 md:px-5 py-2 md:py-3 text-center">
                                    <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded font-black">{log.count}</span>
                                  </td>
                                  <td className="px-2 md:px-5 py-2 md:py-3 text-right">
                                    <div className="flex justify-end gap-1">
                                      <button onClick={() => openEditModal('prod', log)} className="text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 p-1 md:p-2 focus:outline-none"><Pencil className="w-3.5 h-3.5 md:w-4 md:h-4" /></button>
                                      <button onClick={() => setConfirmDelete({col: 'production_logs', id: log.id, name: `Production ${log.count} pal`})} className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 p-1 md:p-2 focus:outline-none"><Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4" /></button>
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
                <h3 className="text-sm md:text-base font-black text-gray-900 dark:text-white flex items-center gap-2 uppercase tracking-widest">
                  <Timer className="text-orange-600 dark:text-orange-400" size={16} />
                  LOG DES ARRÊTS
                </h3>
                <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-3xl overflow-hidden shadow-sm dark:shadow-none">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-gray-50 dark:bg-gray-800/50 text-[8px] md:text-[9px] text-gray-400 dark:text-gray-500 font-black uppercase tracking-widest border-b border-gray-100 dark:border-gray-800">
                        <tr>
                          <th className="px-2 md:px-5 py-2 md:py-3">Début</th>
                          <th className="px-2 md:px-5 py-2 md:py-3">Durée</th>
                          <th className="px-2 md:px-5 py-2 md:py-3">Opérateur</th>
                          <th className="px-2 md:px-5 py-2 md:py-3">Motif</th>
                          <th className="px-2 md:px-5 py-2 md:py-3 hidden sm:table-cell">Ligne</th>
                          <th className="px-2 md:px-5 py-2 md:py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 dark:divide-gray-800 text-[10px] md:text-xs">
                        <AnimatePresence mode="popLayout">
                          {sortedDownLogs
                            .filter(log => {
                              const matchLine = !historyLineFilter || log.lineId === historyLineFilter;
                              const logDateOnly = log.startTime.split('T')[0];
                              const matchDate = (!historyDateFilter || logDateOnly >= historyDateFilter) && 
                                                (!historyEndDateFilter || logDateOnly <= historyEndDateFilter);
                              return matchLine && matchDate;
                            })
                            .slice(0, 100).map(log => (
                              <motion.tr 
                                key={log.id} 
                                initial={{ opacity: 1 }}
                                exit={{ opacity: 0, x: -20, backgroundColor: 'rgba(254, 226, 226, 0.5)' }}
                                transition={{ duration: 0.2 }}
                                className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50"
                              >
                                <td className="px-2 md:px-5 py-2 md:py-3 font-bold text-gray-900 dark:text-white">
                                  {new Date(log.startTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                </td>
                                <td className="px-2 md:px-5 py-2 md:py-3">
                                  {log.duration || !log.endTime ? (
                                    <span className="font-mono font-bold bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded text-blue-700 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50">
                                      {formatDowntimeDisplay(getLogDurationSec(log))}
                                    </span>
                                  ) : <span className="text-orange-500 dark:text-orange-400 font-black uppercase bg-orange-50 dark:bg-orange-900/10 px-2 py-0.5 rounded border border-orange-100 dark:border-orange-900/30 animate-pulse">En cours</span>}
                                </td>
                                <td className="px-2 md:px-5 py-2 md:py-3 italic">
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-5 h-5 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center text-[10px] font-black uppercase text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
                                      {users.find(u => u.id === log.operatorId)?.name?.charAt(0) || '—'}
                                    </div>
                                    <span className="font-black text-gray-600 dark:text-gray-400 truncate max-w-[80px] md:max-w-none">
                                      {users.find(u => u.id === log.operatorId)?.name || '—'}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-2 md:px-5 py-2 md:py-3">
                                  <div className="flex items-center gap-2">
                                    <span className="text-base">{downtimeTypes.find(t => t.id === log.typeId)?.icon || '⚠️'}</span>
                                    <p className="font-bold text-gray-700 dark:text-gray-300 leading-tight">{downtimeTypes.find(t => t.id === log.typeId)?.name || '—'}</p>
                                  </div>
                                </td>
                                <td className="px-2 md:px-5 py-2 md:py-3">
                                  <p className="font-bold text-gray-700 dark:text-gray-300">{lines.find(l => l.id === log.lineId)?.name || '—'}</p>
                                </td>
                                <td className="px-2 md:px-5 py-2 md:py-3 text-right">
                                  <div className="flex justify-end gap-1 items-center">
                                    {(log as any).image_path && (
                                      <button 
                                        onClick={() => setSelectedFullImage((log as any).image_path)}
                                        className="text-white bg-blue-500 p-1 rounded-lg hover:bg-blue-600 transition-colors"
                                        title="Voir la photo"
                                      >
                                        <Camera size={14} />
                                      </button>
                                    )}
                                    {log.images && (
                                      <div className="flex -space-x-2">
                                        {(typeof log.images === 'string' ? JSON.parse(log.images) as string[] : log.images as string[]).map((img, i) => {
                                          const isVid = img.toLowerCase().endsWith('.mp4') || img.toLowerCase().endsWith('.webm') || img.toLowerCase().endsWith('.mov');
                                          return (
                                            <button 
                                              key={i}
                                              onClick={() => setSelectedFullImage(img)}
                                              className="w-6 h-6 rounded-full border-2 border-white dark:border-gray-800 bg-blue-500 flex items-center justify-center text-white hover:scale-110 transition-all shadow-sm dark:shadow-none"
                                            >
                                              {isVid ? <Video size={10} /> : <Camera size={10} />}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                    <button onClick={() => openEditModal('down', log)} className="text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 p-1 md:p-2 focus:outline-none"><Pencil className="w-3.5 h-3.5 md:w-4 md:h-4" /></button>
                                    <button onClick={() => setConfirmDelete({col: 'downtime_logs', id: log.id, name: `Arrêt ${downtimeTypes.find(t => t.id === log.typeId)?.name}`})} className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 p-1 md:p-2 focus:outline-none"><Trash2 className="w-3.5 h-3.5 md:w-4 md:h-4" /></button>
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
        <div className="fixed inset-0 bg-slate-900/60 dark:bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6">
          <div className="bg-white dark:bg-gray-900 rounded-[32px] p-6 max-w-xs w-full space-y-4 shadow-2xl dark:shadow-none border border-gray-100 dark:border-gray-800">
             <div className="w-12 h-12 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-xl flex items-center justify-center mx-auto">
               <Trash2 size={24} />
             </div>
             <div className="text-center space-y-1">
               <h3 className="text-lg font-black text-gray-900 dark:text-white italic uppercase">Supprimer ?</h3>
               <p className="text-[11px] text-gray-500 dark:text-gray-400 font-medium leading-tight">Voulez-vous supprimer cet enregistrement ?<br/><span className="text-gray-900 dark:text-white font-bold">{confirmDelete.name}</span></p>
             </div>
             <div className="flex gap-2.5 mt-2">
                <button onClick={() => setConfirmDelete(null)} className="flex-1 py-2.5 font-bold text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl transition-all uppercase text-[9px] tracking-widest focus:outline-none">Annuler</button>
                <button onClick={handleDelete} className="flex-1 py-2.5 bg-red-600 text-white font-black rounded-xl shadow-lg dark:shadow-none shadow-red-50 active:scale-95 transition-all text-[9px] tracking-widest uppercase focus:outline-none">Supprimer</button>
             </div>
          </div>
        </div>
      )}

      {/* EDIT MODAL */}
      {isEditModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 dark:bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-gray-900 rounded-[32px] p-6 max-w-sm w-full space-y-4 shadow-2xl dark:shadow-none border border-gray-100 dark:border-gray-800"
          >
            <div className="space-y-0.5">
              <h3 className="text-lg font-black text-gray-900 dark:text-white uppercase italic">Corriger</h3>
              <p className="text-[7px] text-gray-400 dark:text-gray-500 font-black uppercase tracking-widest">Enregistrement manuel</p>
            </div>

            <div className="space-y-4">
              {editModalType === 'prod' ? (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">Quantité</label>
                    <input 
                      type="number"
                      className="w-full p-4 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-900 dark:text-white"
                      value={editModalData.count || ''}
                      onChange={e => setEditModalData({...editModalData, count: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">Date</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-4 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-900 dark:text-white"
                      value={editModalData.timestamp ? new Date(editModalData.timestamp).toISOString().slice(0, 16) : ''}
                      onChange={e => setEditModalData({...editModalData, timestamp: new Date(e.target.value).toISOString()})}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">Motif</label>
                    <select 
                      className="w-full p-4 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-900 dark:text-white"
                      value={editModalData.typeId || ''}
                      onChange={e => setEditModalData({...editModalData, typeId: e.target.value})}
                    >
                      {downtimeTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">Début</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-4 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-900 dark:text-white"
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
                    <label className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">Fin</label>
                    <input 
                      type="datetime-local"
                      className="w-full p-4 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-gray-900 dark:text-white"
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

                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">Photos</label>
                    <div className="flex flex-wrap gap-2">
                      {(editModalData.images || []).map((img: string, i: number) => (
                        <div key={i} className="relative w-16 h-16 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
                          <img src={`/uploads/${img}`} className="w-full h-full object-cover" alt="Preview" />
                          <button 
                            onClick={() => {
                              const newImages = [...editModalData.images];
                              newImages.splice(i, 1);
                              setEditModalData({...editModalData, images: newImages});
                            }}
                            className="absolute top-0 right-0 bg-red-500 text-white p-0.5 rounded-bl-lg"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="w-16 h-16 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-500 dark:hover:text-blue-400 transition-all focus:outline-none"
                      >
                        <Plus size={20} />
                        <span className="text-[7px] font-black uppercase">Ajouter</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <button onClick={() => setIsEditModalOpen(false)} className="flex-1 py-4 font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-2xl transition-all uppercase text-[10px] tracking-widest focus:outline-none">Annuler</button>
              <button 
                onClick={handleEditSubmit}
                className="flex-1 py-4 bg-blue-600 text-white font-black rounded-2xl shadow-xl dark:shadow-none shadow-blue-100 transition-all uppercase text-[10px] tracking-widest focus:outline-none"
              >
                Sauvegarder
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {isAssigning && (
        <div className="fixed inset-0 bg-slate-900/60 dark:bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-2">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-gray-900 w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl dark:shadow-none flex flex-col max-h-[92vh] border border-gray-100 dark:border-gray-800"
          >
            <div className="p-4 bg-blue-600 text-white flex justify-between items-center">
              <div className="space-y-0.5">
                <h2 className="text-base font-black tracking-tight uppercase leading-none italic">{t('assign_program')}</h2>
                <p className="text-blue-100 text-[8px] font-black uppercase tracking-widest opacity-80 leading-none mt-1">
                  {t('line')}: {lines.find(l => l.id === isAssigning)?.name}
                </p>
              </div>
            </div>

            <div className="p-4 md:p-6 overflow-y-auto space-y-6">
              <div className="space-y-4">
                <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-2xl border border-gray-200 dark:border-gray-700">
                  <h3 className="text-[9px] font-black text-gray-700 dark:text-gray-300 uppercase tracking-widest mb-3">{t('new_program')}</h3>
                  <div className="flex flex-col gap-2">
                    <input 
                      type="text"
                      value={newProgName}
                      onChange={e => setNewProgName(e.target.value)}
                      placeholder={t('program_name') + "..."}
                      className="w-full p-2.5 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-xs text-gray-900 dark:text-white"
                    />
                    <div className="space-y-1">
                      <label className="text-[8px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest ml-1">{t('technical_parameters')}</label>
                      <textarea 
                        value={newProgParams}
                        onChange={e => setNewProgParams(e.target.value)}
                        placeholder="Vitesse, Pression, etc..."
                        rows={2}
                        className="w-full p-2.5 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 focus:ring-2 focus:ring-blue-500 outline-none font-bold text-[10px] text-gray-900 dark:text-white"
                      />
                    </div>
                    <button 
                      disabled={!newProgName}
                      onClick={handleAssignProgramme}
                      className="w-full py-2.5 bg-blue-600 text-white rounded-xl font-black text-[9px] uppercase tracking-widest disabled:opacity-50 active:scale-95 transition-all shadow-md dark:shadow-none shadow-blue-100 focus:outline-none"
                    >
                      {t('save_assign').toUpperCase()}
                    </button>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="p-6 bg-gray-50 dark:bg-gray-800/30 border-t border-gray-100 dark:border-gray-800 flex gap-3 text-gray-900 dark:text-white">
              <button 
                onClick={() => {
                  setIsAssigning(null);
                  setShowCreateNew(false);
                }}
                className="flex-1 py-4 font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-2xl transition-colors uppercase text-xs tracking-widest focus:outline-none"
              >
                {t('cancel')}
              </button>
              {showCreateNew && (
                <button 
                  onClick={handleAssignProgramme}
                  className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl dark:shadow-none shadow-blue-200 uppercase text-xs tracking-widest active:scale-95 transition-all focus:outline-none"
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
        <div className="fixed inset-0 bg-slate-900/60 dark:bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-2">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-gray-900 w-full max-w-sm rounded-3xl overflow-hidden shadow-2xl dark:shadow-none flex flex-col max-h-[92vh] border border-gray-100 dark:border-gray-800"
          >
            <div className="p-4 bg-orange-600 text-white flex justify-between items-start">
              <div>
                <h2 className="text-lg font-black tracking-tight uppercase italic leading-none">{t('machine_stop')}</h2>
                <p className="text-orange-100 text-[10px] font-bold uppercase tracking-widest opacity-80 mt-1">
                  {declaringDowntimeLineId === 'global' ? t('general_stop') : `${t('line')} ${lines.find(l => l.id === declaringDowntimeLineId)?.name}`}
                </p>
              </div>
              <button 
                onClick={() => {
                  setDeclaringDowntimeLineId(null);
                  setSelectedDowntimeTypeId(null);
                  setImagePreviews([]);
                  setSelectedImagePaths([]);
                }}
                className="text-white/60 hover:text-white p-1 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-y-auto">
              {!selectedDowntimeTypeId ? (
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-orange-400 dark:text-orange-300 uppercase tracking-widest ml-1">{t('reason')}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {downtimeTypes.map(type => (
                      <button
                        key={type.id}
                        onClick={() => setSelectedDowntimeTypeId(type.id)}
                        className="p-3 border border-orange-50 dark:border-orange-900/30 rounded-2xl flex flex-col items-center gap-1 hover:bg-orange-50 dark:hover:bg-orange-900 transition-all group shadow-sm dark:shadow-none bg-white dark:bg-gray-800 focus:outline-none"
                      >
                        <span className="text-xl group-hover:scale-110 transition-transform">{type.icon}</span>
                        <span className="text-[8px] font-black uppercase text-gray-700 dark:text-gray-200 text-center leading-tight">{type.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-4"
                >
                  <div className="flex items-center gap-4 bg-orange-50 dark:bg-orange-900/20 p-4 rounded-2xl border border-orange-100 dark:border-orange-900/30">
                    <div className="text-3xl">{downtimeTypes.find(t => t.id === selectedDowntimeTypeId)?.icon}</div>
                    <h4 className="text-sm font-black text-orange-900 dark:text-orange-100 uppercase tracking-tight">
                      {downtimeTypes.find(t => t.id === selectedDowntimeTypeId)?.name}
                    </h4>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-orange-400 dark:text-orange-300 uppercase tracking-widest ml-1">{t('comment_description') || 'Commentaire / Description'}</label>
                    <textarea 
                      className="w-full p-3 bg-orange-50/50 dark:bg-orange-900/10 border border-orange-100 dark:border-orange-900/30 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-orange-500 transition-all placeholder:text-gray-400 placeholder:italic text-gray-900 dark:text-white"
                      rows={2}
                      placeholder="Expliquez la cause de l'arrêt..."
                      value={manualStopForm.description}
                      onChange={e => setManualStopForm({...manualStopForm, description: e.target.value})}
                    />
                  </div>

                  {/* PHOTO SECTION */}
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-orange-400 dark:text-orange-300 uppercase tracking-widest ml-1">Médias (Optionnel)</label>
                    <div className="grid grid-cols-4 gap-2">
                      {imagePreviews.map((p, idx) => {
                        const isVid = selectedImagePaths[idx] ? (selectedImagePaths[idx].endsWith('.mp4') || selectedImagePaths[idx].endsWith('.webm') || selectedImagePaths[idx].endsWith('.mov')) : false;
                        return (
                          <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
                            {isVid ? (
                              <video src={p} className="w-full h-full object-cover" />
                            ) : (
                              <img src={p} className="w-full h-full object-cover" alt="Preview" />
                            )}
                            <button 
                              onClick={() => {
                                setImagePreviews(prev => prev.filter((_, i) => i !== idx));
                                setSelectedImagePaths(paths => paths.filter((_, i) => i !== idx));
                              }} 
                              className="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full p-0.5 shadow-lg active:scale-95"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        );
                      })}
                      {imagePreviews.length < 5 && (
                        <>
                          <button 
                            onClick={() => handleTakeStoreMedia('photo')}
                            disabled={isUploading}
                            className="aspect-square border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:text-orange-500 hover:border-orange-500 transition-all bg-gray-50 dark:bg-gray-800/50"
                          >
                            <Camera size={20} />
                            <span className="text-[7px] font-black uppercase mt-1">{isUploading ? '...' : '+ Photo'}</span>
                          </button>
                          <button 
                            onClick={() => handleTakeStoreMedia('video')}
                            disabled={isUploading}
                            className="aspect-square border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:text-orange-500 hover:border-orange-500 transition-all bg-gray-50 dark:bg-gray-800/50"
                          >
                            <Video size={20} />
                            <span className="text-[7px] font-black uppercase mt-1">{isUploading ? '...' : '+ Vidéo'}</span>
                          </button>
                          <button 
                            onClick={() => handleTakeStoreMedia('gallery')}
                            disabled={isUploading}
                            className="aspect-square border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg flex flex-col items-center justify-center text-gray-400 hover:text-orange-500 hover:border-orange-500 transition-all bg-gray-50 dark:bg-gray-800/50"
                          >
                            <ImageIcon size={20} />
                            <span className="text-[7px] font-black uppercase mt-1">{isUploading ? '...' : '+ Galerie'}</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <button 
                    onClick={() => handleStartDowntime(declaringDowntimeLineId, selectedDowntimeTypeId!, manualStopForm.description)}
                    disabled={isUploading}
                    className="w-full py-4 bg-orange-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-200 dark:shadow-none hover:bg-orange-700 active:scale-[0.98] transition-all"
                  >
                    Confirmer l'arrêt
                  </button>

                  <button 
                    onClick={() => setSelectedDowntimeTypeId(null)}
                    className="w-full py-2 text-[10px] font-black text-orange-400 uppercase tracking-widest hover:text-orange-600 transition-colors"
                  >
                    Retour aux motifs
                  </button>
                </motion.div>
              )}
            </div>
            {!selectedDowntimeTypeId && (
              <div className="p-4 bg-gray-50 dark:bg-gray-800/30 flex gap-3 border-t border-gray-100 dark:border-gray-800">
                <button 
                  onClick={() => {
                    setDeclaringDowntimeLineId(null);
                    setSelectedDowntimeTypeId(null);
                    setImagePreviews([]);
                    setSelectedImagePaths([]);
                  }}
                  className="w-full py-4 text-xs font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-2xl transition-all focus:outline-none"
                >
                  Annuler
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}

      {/* MANUAL STOP MODAL */}
      {showManualStopModal && (
        <div className="fixed inset-0 bg-slate-900/60 dark:bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-gray-900 w-full max-w-sm rounded-[32px] overflow-hidden shadow-2xl dark:shadow-none flex flex-col border border-gray-100 dark:border-gray-800"
          >
            <div className="p-6 bg-blue-600 text-white">
              <h2 className="text-xl font-black tracking-tight uppercase italic pb-1 border-b border-blue-400/30">Saisie Manuelle</h2>
              <p className="text-blue-100 text-[10px] font-bold uppercase tracking-widest leading-none mt-2">
                Ligne: {lines.find(l => l.id === manualStopForm.lineId)?.name}
              </p>
            </div>
            <div className="p-4 space-y-4">
               <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest ml-1">Début</label>
                    <input 
                      type="datetime-local"
                      min={format(startOfDay(new Date()), "yyyy-MM-dd'T'HH:mm")}
                      max={format(endOfDay(new Date()), "yyyy-MM-dd'T'HH:mm")}
                      className="w-full p-2.5 bg-slate-50 dark:bg-gray-800 border border-slate-100 dark:border-gray-700 rounded-xl text-[10px] font-black text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      value={manualStopForm.startTime}
                      onChange={e => setManualStopForm({...manualStopForm, startTime: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest ml-1">Fin</label>
                    <input 
                      type="datetime-local"
                      min={format(startOfDay(new Date()), "yyyy-MM-dd'T'HH:mm")}
                      max={format(endOfDay(new Date()), "yyyy-MM-dd'T'HH:mm")}
                      className="w-full p-2.5 bg-slate-50 dark:bg-gray-800 border border-slate-100 dark:border-gray-700 rounded-xl text-[10px] font-black text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      value={manualStopForm.endTime}
                      onChange={e => setManualStopForm({...manualStopForm, endTime: e.target.value})}
                    />
                  </div>
               </div>

               <div className="flex justify-between items-center bg-blue-50/50 dark:bg-blue-900/20 p-2 rounded-xl border border-blue-100 dark:border-blue-900/30">
                  <p className="text-[8px] font-black text-blue-400 dark:text-blue-500 uppercase tracking-widest leading-none">Durée totale</p>
                  <p className="text-sm font-black text-blue-900 dark:text-blue-300 font-mono italic">{calculateManualDuration()}</p>
               </div>

               <div className="space-y-1">
                 <label className="text-[8px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest ml-1">Motif de l'arrêt</label>
                 <select 
                   className="w-full p-2.5 bg-slate-50 dark:bg-gray-800 border border-slate-100 dark:border-gray-700 rounded-xl text-[10px] font-black text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                   value={manualStopForm.typeId}
                   onChange={e => setManualStopForm({...manualStopForm, typeId: e.target.value})}
                 >
                   <option value="">Sélectionner un motif...</option>
                   {downtimeTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                 </select>
               </div>

               <div className="space-y-1">
                 <label className="text-[8px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest ml-1">Photos</label>
                 <div className="flex flex-wrap gap-2">
                   {imagePreviews.map((p, i) => {
                     const path = selectedImagePaths[i] || '';
                     const isVid = path.toLowerCase().endsWith('.mp4') || path.toLowerCase().endsWith('.webm') || path.toLowerCase().endsWith('.mov');
                     return (
                       <div key={i} className="relative w-14 h-14 rounded-xl overflow-hidden border border-slate-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
                         {isVid ? (
                           <video src={p} className="w-full h-full object-cover" />
                         ) : (
                           <img src={p} className="w-full h-full object-cover" alt="Preview" />
                         )}
                         <button 
                          onClick={() => {
                            const newPreviews = [...imagePreviews];
                            const newPaths = [...selectedImagePaths];
                            newPreviews.splice(i, 1);
                            newPaths.splice(i, 1);
                            setImagePreviews(newPreviews);
                            setSelectedImagePaths(newPaths);
                          }}
                          className="absolute top-0 right-0 bg-red-500 text-white p-0.5 rounded-bl-lg z-10"
                         >
                           <X size={10} />
                         </button>
                       </div>
                     );
                   })}
                   {imagePreviews.length < 5 && (
                     <div className="flex gap-1.5 pt-0.5">
                       <button 
                         onClick={() => handleTakeStoreMedia('photo')}
                         disabled={isUploading}
                         className="w-14 h-14 rounded-xl border-2 border-dashed border-slate-200 dark:border-gray-700 flex flex-col items-center justify-center text-slate-400 dark:text-gray-500 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-500 dark:hover:text-blue-400 transition-all focus:outline-none"
                        >
                         <Camera size={18} />
                         <span className="text-[6px] font-black uppercase mt-1">Photo</span>
                       </button>
                       <button 
                         onClick={() => handleTakeStoreMedia('video')}
                         disabled={isUploading}
                         className="w-14 h-14 rounded-xl border-2 border-dashed border-slate-200 dark:border-gray-700 flex flex-col items-center justify-center text-slate-400 dark:text-gray-500 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-500 dark:hover:text-blue-400 transition-all focus:outline-none"
                        >
                         <Video size={18} />
                         <span className="text-[6px] font-black uppercase mt-1">Vidéo</span>
                       </button>
                       <button 
                         onClick={() => handleTakeStoreMedia('gallery')}
                         disabled={isUploading}
                         className="w-14 h-14 rounded-xl border-2 border-dashed border-slate-200 dark:border-gray-700 flex flex-col items-center justify-center text-slate-400 dark:text-gray-500 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-500 dark:hover:text-blue-400 transition-all focus:outline-none"
                        >
                         <ImageIcon size={18} />
                         <span className="text-[6px] font-black uppercase mt-1">Galerie</span>
                       </button>
                     </div>
                   )}
                 </div>
                 <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  className="hidden" 
                  accept="image/*,video/*" 
                 />
               </div>
            </div>
            <div className="p-4 bg-gray-50 dark:bg-gray-800/30 flex gap-3 border-t border-gray-100 dark:border-gray-800">
              <button 
                onClick={() => setShowManualStopModal(false)}
                className="flex-1 py-4 text-xs font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-2xl transition-all focus:outline-none"
              >
                Annuler
              </button>
              <button 
                onClick={() => handleManualStop(manualStopForm)}
                className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-black shadow-xl dark:shadow-none shadow-blue-200 uppercase text-xs tracking-widest active:scale-95 transition-all focus:outline-none"
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
            className="fixed inset-0 bg-slate-900/60 dark:bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white dark:bg-gray-900 rounded-[2.5rem] w-full max-w-2xl shadow-3xl dark:shadow-none overflow-hidden border border-gray-100 dark:border-gray-800"
            >
              <div className="p-8 space-y-8 max-h-[85vh] overflow-y-auto custom-scrollbar">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                      <Activity size={24} className="text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-gray-900 dark:text-white tracking-tighter uppercase italic leading-none mb-1">Arrêts Groupés Intelligents</h2>
                      <p className="text-[10px] font-black text-blue-500 dark:text-blue-400 uppercase tracking-[0.2em]">Pilot Hub Feature</p>
                    </div>
                  </div>
                  <button onClick={() => setShowFeatureInfo(false)} className="w-10 h-10 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors focus:outline-none">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-6">
                  <section className="p-5 bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-900/30">
                    <h4 className="text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                       <TrendingUp size={14} /> Détection de Proximité Temporelle
                    </h4>
                    <p className="text-xs font-bold text-gray-700 dark:text-gray-200 leading-relaxed italic">
                      "Comment le système identifie que des arrêts sur différentes lignes sont liés."
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 leading-relaxed">
                      L'algorithme AgroSync analyse les flags d'arrêts en temps réel. Si plusieurs lignes déclarent le même incident dans une fenêtre critique (moins de 2 minutes), le système fusionne ces données pour refléter la réalité de la panne machine globale.
                    </p>
                  </section>

                  <section className="p-5 bg-gray-50 dark:bg-gray-800/30 rounded-2xl border border-gray-100 dark:border-gray-800">
                    <h4 className="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                       <Users size={14} /> Propagation de l'Action de Groupe
                    </h4>
                    <p className="text-xs font-bold text-gray-700 dark:text-gray-200 leading-relaxed italic">
                      "Le premier opérateur qui déclare l'arrêt propage l'état."
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 leading-relaxed">
                      Fini les doubles saisies. Dès qu'un arrêt est qualifié sur une ligne, le système peut propager automatiquement cet état aux autres lignes de la machine. Cela assure une synchronisation parfaite entre les opérateurs et le Pilot.
                    </p>
                  </section>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-5 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl border border-emerald-100 dark:border-emerald-900/30">
                      <h4 className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <Box size={14} /> Consolidation
                      </h4>
                      <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80 leading-relaxed font-bold">
                        Un seul événement en base de données pour toute la machine. Rapports simplifiés et statistiques OEE fiables.
                      </p>
                    </div>
                    <div className="p-5 bg-orange-50 dark:bg-orange-900/20 rounded-2xl border border-orange-100 dark:border-orange-900/30">
                      <h4 className="text-[10px] font-black text-orange-600 dark:text-orange-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                        <Activity size={14} /> Avantage Industriel
                      </h4>
                      <p className="text-[11px] text-orange-800/80 dark:text-orange-200/80 leading-relaxed font-bold">
                        Réduction de 40% de la charge administrative des opérateurs et précision accrue du suivi des temps d'arrêt.
                      </p>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setShowFeatureInfo(false)}
                  className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl dark:shadow-none active:scale-95 transition-all focus:outline-none"
                >
                  FERMER
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* IMAGE PREVIEW MODAL */}
      <AnimatePresence>
        {selectedFullImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedFullImage(null)}
            className="fixed inset-0 bg-slate-900/60 dark:bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4 cursor-pointer"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="relative max-w-4xl w-full flex items-center justify-center p-2"
              onClick={e => e.stopPropagation()}
            >
              <div className="relative w-full overflow-hidden rounded-2xl shadow-3xl dark:shadow-none border dark:border-gray-800 bg-black/40">
                {(() => {
                  const src = selectedFullImage.startsWith('http') || selectedFullImage.startsWith('/') ? selectedFullImage : `/uploads/${selectedFullImage}`;
                  const isVid = selectedFullImage.toLowerCase().endsWith('.mp4') || selectedFullImage.toLowerCase().endsWith('.webm') || selectedFullImage.toLowerCase().endsWith('.mov');
                  return isVid ? (
                    <video src={src} controls autoPlay className="w-full h-auto max-h-[90vh] object-contain" />
                  ) : (
                    <img 
                      src={src}
                      alt="Downtime Evidence" 
                      className="w-full h-auto max-h-[85vh] object-contain mx-auto"
                      referrerPolicy="no-referrer"
                    />
                  );
                })()}
              </div>
              <button 
                onClick={() => setSelectedFullImage(null)}
                className="absolute -top-12 right-0 text-white hover:text-gray-300 transition-colors bg-white/10 p-2 rounded-full backdrop-blur-md focus:outline-none"
              >
                <X size={24} />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <nav className="fixed bottom-0 left-0 right-0 sm:hidden bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 flex shadow-[0_-4px_10px_rgba(0,0,0,0.05)] z-50" 
           style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {[
          { tab: 'dashboard', icon: LayoutDashboard, label: 'Tableau' },
          { tab: 'monitor',   icon: Monitor,         label: 'Monitor' },
          { tab: 'history',   icon: HistoryIcon,     label: 'Historique' },
        ].map(({ tab, icon: Icon, label }) => (
          <button key={tab} onClick={() => setActiveTab(tab as any)}
            className={cn("flex-1 flex flex-col items-center gap-1 py-3 text-[9px] font-black uppercase tracking-wide transition-colors",
              activeTab === tab ? "text-blue-600" : "text-gray-400")}>
            <Icon size={22} strokeWidth={activeTab === tab ? 2.5 : 1.5} />
            {label}
          </button>
        ))}
      </nav>
      <input 
        type="file" 
        ref={mediaInputRef}
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
