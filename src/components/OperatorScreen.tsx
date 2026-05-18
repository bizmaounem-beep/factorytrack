import React, { useState, useEffect, useRef, useMemo } from 'react';
import { localApi } from '../lib/localApi';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { useLanguage } from '../contexts/LanguageContext';
import { Line, Shift } from '../types';
import { format, parseISO, isToday, startOfDay, endOfDay } from 'date-fns';
import { useTheme } from '../contexts/ThemeContext';
import { 
  Play, Square, Settings, Timer, Package, AlertCircle, 
  CheckCircle, Factory, Monitor, Activity, Plus, Minus, 
  ArrowLeft, X, Clock, Check, Edit, Trash2, History,
  ChevronRight, ChevronLeft, Info, Camera, Trash, Sun, Moon
} from 'lucide-react';
import { formatDuration, formatDowntimeDisplay, cn } from '../lib/utils';
import { getCurrentShiftId } from '../lib/shiftUtils';
import { motion, AnimatePresence } from 'motion/react';
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

export default function OperatorScreen() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
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
  const [showFeatureInfo, setShowFeatureInfo] = useState(false);
  const [selectedProgrammeForChange, setSelectedProgrammeForChange] = useState<string | null>(null);
  const [palletInput, setPalletInput] = useState('1');
  const [downtimeDescription, setDowntimeDescription] = useState('');
  const [selectedImagePaths, setSelectedImagePaths] = useState<string[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    startTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    endTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    description: '',
    images: [] as string[]
  });
  const [manualImagePreviews, setManualImagePreviews] = useState<string[]>([]);
  const [selectedFullImage, setSelectedFullImage] = useState<string | null>(null);

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
          producedPallets: { _inc: count }
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
        producedPallets: { _inc: 1 }
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
        producedPallets: { _inc: count },
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

  const handleTakeStorePhoto = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const image = await CapCamera.getPhoto({
          quality: 80,
          allowEditing: false,
          resultType: CameraResultType.Uri,
          source: CameraSource.Prompt,
          saveToGallery: true,
          width: 1200 // Resizing for efficiency
        });
  
        if (image.webPath) {
          const preview = image.webPath;
          const response = await fetch(preview);
          const blob = await response.blob();
          uploadFile(blob, preview);
        }
      } catch (e) {
        console.error('Erreur caméra:', e);
      }
    } else {
      fileInputRef.current?.click();
    }
  };
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      Array.from(files).forEach((file: File) => {
        const preview = URL.createObjectURL(file);
        uploadFile(file, preview);
      });
    }
  };
  
  const uploadFile = async (file: Blob | File, preview: string, isManual: boolean = false) => {
    setIsUploading(true);
    
    // Client-side size check (20MB)
    if (file.size > 20 * 1024 * 1024) {
      alert('Le fichier est trop volumineux (max 20Mo).');
      setIsUploading(false);
      return;
    }

    const formData = new FormData();
    formData.append('photo', file, 'photo.jpg');
  
    try {
      console.log('[DEBUG] Starting upload to /api/upload');
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Accept': 'application/json'
        },
        body: formData
      });
      
      console.log('[DEBUG] Upload response status:', res.status);
      let data;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        data = await res.json();
        console.log('[DEBUG] Upload response JSON:', data);
      } else {
        const text = await res.text();
        console.error('[DEBUG] Server non-JSON response text:', text.substring(0, 500));
        throw new Error(`Réponse non-JSON du serveur (${res.status}). Vérifiez les logs console.`);
      }

      if (res.ok && (data.path || data.success)) {
        const filePath = data.path || (data.url ? data.url.replace('/uploads/', '') : '');
        if (isManual) {
          setManualStopForm(prev => ({ ...prev, images: [...prev.images, filePath] }));
          setManualImagePreviews(prev => [...prev, preview]);
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
      const machineLines = lines.filter(l => l.machineId === activeLine.machineId);
      const windowMs = 2 * 60 * 1000; // 2 minutes
      const now = new Date().getTime();

      const existingRecentDowntime = downtimeLogs.find(log => 
        log.machineId === activeLine.machineId && 
        log.typeId === typeId && 
        !log.endTime && 
        (now - new Date(log.startTime).getTime()) < windowMs
      );

      const logId = existingRecentDowntime ? existingRecentDowntime.id : (await localApi.addDoc('downtime_logs', {
        machineId: activeLine.machineId,
        lineId: activeLine.id,
        typeId,
        description: isChangeProg 
          ? `Chang. vers: ${availableProgrammes.find(p => p.id === selectedProgrammeForChange)?.name}` 
          : (downtimeDescription.trim() || undefined),
        images: selectedImagePaths.length > 0 ? selectedImagePaths : undefined,
        operatorId: user.id,
        shiftId: currentShiftId,
        startTime: new Date().toISOString()
      })).id;

      // --- PROPAGATION LOGIC ---
      // Requirement: propagating the stop to all lines of the machine
      for (const line of machineLines) {
        await localApi.updateDoc('lines', line.id, {
          status: 'STOPPED',
          activeDowntimeId: logId
        });
      }
      
      setIsInitialSelection(false);
      setSelectedStopType(null);
      setSelectedProgrammeForChange(null);
      setDowntimeDescription('');
      setSelectedImagePaths([]);
      setImagePreviews([]);
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
          : (downtimeDescription.trim() || categorizingLog?.description || undefined),
        images: selectedImagePaths.length > 0 ? selectedImagePaths : undefined
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
      setSelectedImagePaths([]);
      setImagePreviews([]);
    } catch (error) {
      console.error('Error categorizing downtime:', error);
    }
  };

  const handleManualStop = async (data: { typeId: string, startTime: string, endTime: string, description: string, images: string[] }) => {
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
        images: data.images,
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
      setManualImagePreviews([]);
      setManualStopForm({
        typeId: '',
        startTime: format(new Date(Date.now() - 15 * 60000), "yyyy-MM-dd'T'HH:mm"),
        endTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        description: '',
        images: []
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
    const parsedImages = log.images ? (typeof log.images === 'string' ? JSON.parse(log.images) : log.images) : [];
    setManualStopForm({
      typeId: log.typeId,
      startTime: format(parseISO(log.startTime), "yyyy-MM-dd'T'HH:mm"),
      endTime: log.endTime ? format(parseISO(log.endTime), "yyyy-MM-dd'T'HH:mm") : format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      description: log.description || '',
      images: parsedImages
    });
    setManualImagePreviews(parsedImages.map((img: string) => img.startsWith('http') || img.startsWith('/') ? img : `/uploads/${img}`));
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
      <div className="min-h-screen bg-slate-100 dark:bg-gray-950 flex flex-col transition-colors duration-300">
        <header className="h-16 bg-white dark:bg-gray-900 text-slate-900 dark:text-white flex items-center justify-between px-6 border-b border-slate-200 dark:border-gray-800 shrink-0 shadow-sm dark:shadow-none">
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-white font-black text-[10px]">
              A
            </div>
            <span className="text-[14px] font-black uppercase tracking-widest italic tracking-tighter">FACTORY<span className="text-blue-600">CLOUD</span></span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all duration-300 text-[10px] font-black uppercase tracking-widest",
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
            <button onClick={handleLogout} className="bg-slate-100 dark:bg-gray-800 hover:bg-red-600 hover:text-white px-4 py-1.5 rounded font-black text-[12px] uppercase tracking-widest transition-colors text-slate-600 dark:text-gray-400 border border-slate-200 dark:border-gray-700">{t('logout')}</button>
          </div>
        </header>

        <main className="flex-1 p-4 overflow-y-auto">
          <div className="max-w-full mx-auto space-y-4">
            <h2 className="text-[14px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-[0.2em] border-b border-slate-200 dark:border-gray-800 pb-2">{t('machine_select')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {machines.map(m => (
                <button
                  key={m.id}
                  onClick={() => setSelectedMachineId(m.id)}
                  className="p-3 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded flex flex-col items-center gap-1.5 hover:border-blue-500 transition-all text-center group shadow-sm dark:shadow-none"
                >
                  <Factory size={20} className="text-slate-300 dark:text-gray-600 group-hover:text-blue-500 transition-colors" />
                  <span className="text-[11px] font-black text-slate-800 dark:text-gray-200 uppercase truncate w-full">{m.name}</span>
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
      <div className="min-h-screen bg-slate-100 dark:bg-gray-950 flex flex-col transition-colors duration-300">
        <header className="h-16 bg-white dark:bg-gray-900 text-slate-900 dark:text-white flex items-center justify-between px-6 border-b border-slate-200 dark:border-gray-800 shrink-0 shadow-sm dark:shadow-none">
          <div className="flex items-center gap-4">
            <button onClick={() => {
              if (selectedLineId) handleGoBackFromLine();
              else setSelectedMachineId(null);
            }} className="p-2 hover:bg-slate-100 dark:hover:bg-gray-800 rounded-full transition-colors text-slate-500 dark:text-gray-400">
              <ArrowLeft size={24} />
            </button>
            <span className="text-[15px] font-black uppercase tracking-widest italic tracking-tighter">{machines.find(m => m.id === selectedMachineId)?.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all duration-300 text-[10px] font-black uppercase tracking-widest",
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
            <button onClick={handleLogout} className="bg-slate-100 dark:bg-gray-800 hover:bg-red-600 hover:text-white px-4 py-1.5 rounded font-black text-[12px] uppercase tracking-widest transition-colors text-slate-600 dark:text-gray-400 border border-slate-200 dark:border-gray-700">{t('logout')}</button>
          </div>
        </header>

        <main className="flex-1 p-4 overflow-y-auto">
          <div className="max-w-full mx-auto space-y-4">
             <h2 className="text-[14px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-[0.2em] border-b border-slate-200 dark:border-gray-800 pb-2">{t('line_select')}</h2>
             <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {lines.filter(l => l.machineId === selectedMachineId).map(l => {
                const isBusy = l.status !== 'IDLE' && l.currentOperatorId !== user?.id;
                const operatorName = users.find(u => u.id === l.currentOperatorId)?.name;

                return (
                   <button
                    key={l.id}
                    disabled={isBusy}
                    onClick={() => handleSelectLine(l)}
                    className={cn(
                      "p-4 bg-white dark:bg-gray-900 rounded-xl border-2 transition-all shadow-sm dark:shadow-none flex flex-col items-center justify-center gap-1.5 relative group",
                      isBusy ? "opacity-40 cursor-not-allowed bg-slate-50 dark:bg-gray-800 border-slate-100 dark:border-gray-800" : "hover:border-blue-500 border-slate-100 dark:border-gray-800"
                    )}
                  >
                    <div className="absolute top-2 right-2">
                       <span className={cn(
                         "w-2 h-2 rounded-full",
                         l.status === 'RUNNING' ? "bg-green-500 animate-pulse" : 
                         l.status === 'STOPPED' ? "bg-red-500" : "bg-slate-300 dark:bg-gray-700"
                       )} />
                    </div>
                    <Monitor size={24} className={cn("text-slate-300 dark:text-gray-700", !isBusy && "group-hover:text-blue-500 transition-colors")} />
                    <div className="text-center">
                      <p className="text-[11px] font-black text-slate-800 dark:text-gray-200 uppercase truncate max-w-[100px]">{l.name}</p>
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
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-gray-950 text-slate-900 dark:text-white font-sans selection:bg-blue-500/30 flex flex-col overflow-hidden transition-colors duration-300" style={{ paddingBottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}>
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-b border-gray-200 dark:border-gray-800 px-4 py-3 shrink-0" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Factory size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tighter italic leading-none text-gray-900 dark:text-white">
                PILOT<span className="text-blue-500">CLOUD</span>
              </h1>
              <p className="text-[10px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-[0.2em] mt-1">Operator Hub</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={toggleTheme}
            className={cn(
              "relative flex items-center gap-1.5 p-2.5 rounded-full border transition-all duration-300 text-[10px] font-black uppercase tracking-widest",
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
            <div className="hidden sm:flex flex-col items-end leading-none mr-2">
              <span className="text-[10px] font-black text-slate-500 dark:text-gray-300 uppercase tracking-widest leading-none">{user?.name}</span>
              <span className="text-[8px] font-bold text-blue-500/80 uppercase tracking-widest leading-none mt-1">{activeLine?.name}</span>
            </div>
            <button 
              onClick={() => setShowFeatureInfo(true)}
              className="p-2.5 text-slate-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
              title="Aide sur les fonctionnalités"
            >
              <Info size={18} />
            </button>
            <button 
              onClick={handleLogout}
              className="px-4 py-2.5 text-red-500 bg-red-50 dark:bg-red-900/20 rounded-xl transition-colors font-black text-[10px] uppercase border border-red-50 dark:border-red-900/30 hover:bg-red-500 hover:text-white"
            >
              {t('logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 space-y-4 pb-20">
        {!selectedLineId ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 py-4 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="col-span-full text-[9px] font-black text-slate-500 dark:text-gray-400 uppercase tracking-[0.2em] text-center mb-1">{t('select_line')}</h2>
            {lines.filter(l => l.isActive !== false).map((line) => (
              <button
                key={line.id}
                onClick={() => handleSelectLine(line)}
                className="group relative overflow-hidden p-5 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl text-left hover:border-blue-500/50 transition-all hover:bg-gray-50 dark:hover:bg-gray-800 shadow-sm active:scale-[0.98] dark:shadow-none"
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-blue-600/5 blur-[40px] group-hover:bg-blue-600/10 transition-colors" />
                <div className="flex justify-between items-center relative z-10">
                  <div>
                    <h3 className="text-xl font-black text-slate-800 dark:text-gray-100 italic tracking-tighter mb-0.5 leading-none uppercase">{line.name}</h3>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        line.status === 'RUNNING' ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)] animate-pulse" : "bg-rose-500"
                      )} />
                      <span className="text-[8px] font-black uppercase tracking-widest text-slate-500 dark:text-gray-400 group-hover:text-slate-300 transition-colors">{line.status}</span>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-slate-700 dark:text-gray-400 group-hover:text-blue-500 group-hover:translate-x-1.5 transition-all" />
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="max-w-7xl mx-auto animate-in fade-in duration-500">
            <div className="flex items-center justify-between mb-4">
              <button 
                onClick={handleGoBackFromLine}
                className="flex items-center gap-1.5 text-slate-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors group px-1"
              >
                <ArrowLeft size={14} className="group-hover:-translate-x-1 transition-transform" />
                <span className="text-[8px] font-black uppercase tracking-[0.15em] italic">{t('back_to_selection')}</span>
              </button>
              
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-black text-slate-600 dark:text-gray-400 uppercase tracking-widest">{activeLine?.name}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* LEFT COLUMN: MAIN STATUS & QUALIFICATION */}
              <div className="lg:col-span-7 space-y-6">
                {/* MAIN STATUS CARD */}
                <div className={cn(
                  "relative overflow-hidden p-6 sm:p-8 rounded-[2rem] border transition-all duration-700 shadow-sm dark:shadow-none",
                  activeLine?.status === 'RUNNING' 
                    ? "bg-emerald-50 border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900/30" 
                    : "bg-rose-50 border-rose-100 dark:bg-rose-950/20 dark:border-rose-900/30"
                )}>
                  <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white to-transparent dark:from-white/5 dark:to-transparent pointer-events-none" />
                  
                  {activeLine?.isActive === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center relative z-10 w-full">
                      <div className="w-20 h-20 bg-slate-100 dark:bg-gray-800 rounded-[2rem] flex items-center justify-center mb-6 shadow-xl dark:shadow-none border-4 border-slate-200 dark:border-gray-700 animate-pulse">
                        <Square size={32} className="text-slate-400 dark:text-gray-500" fill="currentColor" />
                      </div>
                      <h2 className="text-3xl font-black text-slate-900 dark:text-white italic tracking-tighter mb-3 leading-none uppercase">
                        {activeLine?.name}
                      </h2>
                      <div className="px-6 py-2 bg-slate-900 dark:bg-black text-white rounded-full text-[9px] font-black uppercase tracking-[0.3em] mb-6 border-b-4 border-slate-700 dark:border-gray-800 shadow-lg leading-none">
                        MODE SHUTDOWN / ARRÊT FORCÉ
                      </div>
                      <p className="text-slate-500 dark:text-gray-400 font-bold max-w-sm text-sm leading-relaxed mb-8">
                        Cette ligne est actuellement désactivée par le Pilote. 
                        Toutes les opérations de saisie de production et d'arrêt sont suspendues jusqu'à réactivation.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center text-center relative z-10">
                    <div className={cn(
                      "w-14 h-14 rounded-2xl flex items-center justify-center mb-4 shadow-xl transform transition-transform duration-500 hover:scale-105 active:scale-95",
                      activeLine?.status === 'RUNNING' ? "bg-emerald-500 shadow-emerald-500/20" : "bg-rose-500 shadow-rose-500/20"
                    )}>
                      {activeLine?.status === 'RUNNING' ? <Activity size={28} className="text-white" /> : <AlertCircle size={28} className="text-white" />}
                    </div>

                    <h2 className="text-3xl font-black text-slate-900 dark:text-white italic tracking-tighter mb-1.5 leading-none uppercase">
                      {activeLine?.name}
                    </h2>
                    
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white dark:bg-gray-800 rounded-full border border-gray-100 dark:border-gray-700 backdrop-blur-md mb-6">
                      <span className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        activeLine?.status === 'RUNNING' ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
                      )} />
                      <span className={cn(
                        "text-[8px] font-black uppercase tracking-[0.15em]",
                        activeLine?.status === 'RUNNING' ? "text-emerald-400 dark:text-emerald-500" : "text-rose-400 dark:text-rose-500"
                      )}>
                        {activeLine?.status === 'RUNNING' ? 'Machine Operationnelle' : 'Ligne à l\'Arrêt'}
                      </span>
                    </div>

                    {activeDowntime && !categorizingLogId ? (
                      <div className="space-y-4 w-full max-w-md mx-auto">
                        <div className="bg-white dark:bg-gray-800 rounded-2xl p-5 border border-gray-100 dark:border-gray-700 backdrop-blur-3xl shadow-sm dark:shadow-none group">
                          <div className="flex items-center justify-center gap-2 text-rose-500 dark:text-rose-400 mb-2">
                            <Timer size={18} className="animate-pulse" />
                            <span className="text-[9px] font-black uppercase tracking-[0.15em] opacity-60">Durée d'Arrêt</span>
                          </div>
                          <p className="text-4xl font-black tracking-tighter tabular-nums text-slate-900 dark:text-white group-hover:scale-105 transition-transform duration-500">
                            {formatDowntimeDisplay(timer)}
                          </p>
                          {lines.filter(l => l.machineId === activeLine?.machineId && l.activeDowntimeId === activeDowntime.id).length > 1 && (
                            <div className="flex items-center justify-center gap-1 mt-1 text-blue-600 dark:text-blue-400 animate-pulse">
                              <Activity size={10} />
                              <span className="text-[8px] font-black uppercase tracking-widest">Arrêt Groupé Intelligent</span>
                            </div>
                          )}
                          {activeDowntime.typeId && activeDowntime.typeId !== 'PENDING' && (
                            <div className="mt-3">
                              <span className="px-5 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-700 rounded-full text-[9px] font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest inline-flex items-center gap-2">
                                 {downtimeTypes.find(t => t.id === activeDowntime.typeId)?.name}
                              </span>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={handleStopDowntime}
                          className="w-full py-4 bg-emerald-600 text-white rounded-xl font-black text-xs uppercase tracking-[0.15em] shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2.5 hover:bg-emerald-500 shadow-emerald-500/10 dark:shadow-none"
                        >
                          <Play size={18} fill="currentColor" /> Relancer la Ligne
                        </button>

                        <div className="bg-gray-50 dark:bg-gray-800 rounded-2xl p-4 border border-gray-100 dark:border-gray-700 space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-700">
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest">Statut Opérationnel</span>
                            <span className="px-2 py-0.5 bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-full text-[8px] font-black uppercase tracking-widest border border-rose-200 dark:border-rose-900/50">
                              Ligne Stoppée
                            </span>
                          </div>
                          
                          {activeDowntime.typeId && activeDowntime.typeId !== 'PENDING' && (
                            <div className="flex items-start gap-3 border-t border-gray-100 dark:border-gray-700 pt-3">
                              <div className="w-8 h-8 rounded-lg bg-white dark:bg-gray-900 flex items-center justify-center text-lg flex-shrink-0 shadow-sm dark:shadow-none border border-gray-100 dark:border-gray-700">
                                {downtimeTypes.find(t => t.id === activeDowntime.typeId)?.icon || '⚠️'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[9px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest leading-none mb-1">Motif Détecté</p>
                                <p className="text-xs font-black text-slate-900 dark:text-white uppercase truncate">
                                  {downtimeTypes.find(t => t.id === activeDowntime.typeId)?.name}
                                </p>
                                {activeDowntime.description && (
                                  <p className="mt-1 text-[10px] font-medium text-slate-500 dark:text-gray-400 italic line-clamp-2">
                                    "{activeDowntime.description}"
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                          
                          {!activeDowntime.typeId || activeDowntime.typeId === 'PENDING' ? (
                            <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-xl border border-blue-100 dark:border-blue-900/30">
                               <Info size={14} className="text-blue-500 dark:text-blue-400 flex-shrink-0" />
                               <p className="text-[9px] font-bold text-blue-700 dark:text-blue-300 leading-tight">
                                 L'arrêt sera qualifié automatiquement à la reprise du cycle.
                               </p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : (isInitialSelection || categorizingLogId) ? (
                      null
                    ) : (
                      <div className="w-full flex flex-col gap-2.5 max-w-md mx-auto">
                        <button
                          onClick={handleStartDowntime}
                          disabled={isInitialSelection}
                          className="w-full py-4 bg-rose-600 text-white rounded-xl font-black text-xs uppercase tracking-[0.15em] shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2.5 hover:bg-rose-500 disabled:opacity-50"
                        >
                          <Square size={18} fill="currentColor" /> Démarrer l'arrêt
                        </button>
                      </div>
                    )}
                  </div>
                )}
                </div>
              </div>

              {/* RIGHT COLUMN: PRODUCTION & HISTORY */}
              <div className="lg:col-span-5 space-y-6">
                {/* PRODUCTION CONTROLS */}
                <div className={cn(
                  "bg-white dark:bg-gray-900 rounded-[2rem] p-6 border border-gray-100 dark:border-gray-800 shadow-sm dark:shadow-none relative overflow-hidden group transition-all duration-500",
                  flashFeedback ? "ring-2 ring-emerald-500" : ""
                )}>
                  <div className="absolute top-0 right-0 w-32 h-32 bg-purple-600/5 blur-[80px]" />
                  
                  <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-purple-600/10 dark:bg-purple-900/20 rounded-xl flex items-center justify-center border border-purple-500/20">
                        <Package size={16} className="text-purple-500" />
                      </div>
                      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-gray-500">Missions & Saisie</h3>
                    </div>
                    {activeLine?.status === 'RUNNING' && (
                      <motion.div 
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="flex items-center gap-2 px-3 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-full border border-emerald-100 dark:border-emerald-900/30"
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[8px] font-black uppercase tracking-widest leading-none">Actif</span>
                      </motion.div>
                    )}
                  </div>

                  {!activeProgramme ? (
                    <div className="text-center py-6 bg-gray-50 dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
                      <p className="text-[10px] font-bold text-slate-500 dark:text-gray-400 uppercase tracking-[0.2em]">{t('no_programme')}</p>
                      <div className="grid grid-cols-1 gap-2 mt-4 px-3">
                        {availableProgrammes.filter(p => (p.lineId === selectedLineId || !p.lineId) && p.status === 'ACTIVE').map(p => (
                          <button
                            key={p.id}
                            onClick={() => handleSelectProgramme(p.id)}
                            className="w-full p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 text-left flex justify-between items-center group/btn hover:bg-blue-600 dark:hover:bg-blue-700 transition-all font-black active:scale-95"
                          >
                            <span className="text-[10px] uppercase italic tracking-tight group-hover/btn:text-white dark:text-gray-200">{p.name}</span>
                            <Play size={14} className="text-slate-400 dark:text-gray-500 group-hover/btn:text-white" fill="currentColor" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="flex justify-between items-end bg-gray-50 dark:bg-gray-800 p-6 rounded-[2rem] border border-gray-100 dark:border-gray-700 shadow-sm dark:shadow-none">
                        <div className="space-y-1">
                          <p className="text-[8px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-[0.2em]">Programme Actuel</p>
                          <h4 className="text-xl font-black text-slate-900 dark:text-white italic tracking-tighter truncate max-w-[180px] uppercase">{activeProgramme.name}</h4>
                        </div>
                        <div className="text-right">
                          <p className="text-[8px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-[0.2em] mb-1">Palettes</p>
                          <div className="flex items-baseline justify-end gap-1.5">
                            <p className="text-3xl font-black text-slate-900 dark:text-white font-mono tracking-tighter tabular-nums">{activeProgramme.producedPallets || 0}</p>
                            <span className="text-[9px] font-black text-slate-500 dark:text-gray-400 uppercase">Unit</span>
                          </div>
                        </div>
                      </div>

                      {(activeLine?.status === 'RUNNING' || activeLine?.status === 'STOPPED') && (
                        <div className="space-y-6">
                          <div className="flex flex-col gap-4">
                            <div className="relative">
                              <div className="flex justify-between items-center px-4 mb-3">
                                <p className="text-[9px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-[0.2em]">Saisie Rapide</p>
                                <button 
                                  onClick={async () => {
                                    const count = parseInt(palletInput);
                                    if(isNaN(count) || count <= 0 || !activeProgramme || !user) return;
                                    await localApi.addDoc('production_logs', {
                                      programmeId: activeProgramme.id,
                                      operatorId: user.id,
                                      machineId: activeLine?.machineId,
                                      lineId: activeLine?.id,
                                      shiftId: currentShiftId,
                                      count,
                                      timestamp: new Date().toISOString()
                                    });
                                    await localApi.updateDoc('programmes', activeProgramme.id, {
                                      producedPallets: { _inc: count }
                                    });
                                    setPalletInput('1');
                                    setFlashFeedback(true);
                                    setTimeout(() => setFlashFeedback(false), 500);
                                  }}
                                  className="flex items-center gap-1.5 px-2 py-0.5 text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg transition-colors font-black text-[9px] uppercase border border-blue-100 dark:border-blue-900/30 hover:bg-blue-600 hover:text-white"
                                >
                                  <Plus size={12} />
                                  Ajouter
                                </button>
                              </div>
                              <div className="flex items-center bg-gray-50 dark:bg-gray-800 p-2 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm dark:shadow-none">
                                <input 
                                  type="number"
                                  className="flex-1 bg-transparent border-none text-3xl font-black text-slate-900 dark:text-white text-center font-mono outline-none"
                                  value={palletInput}
                                  onChange={e => setPalletInput(e.target.value)}
                                  placeholder="0"
                                />
                              </div>
                            </div>


                            <div className="pt-6 border-t border-gray-100 dark:border-gray-700 space-y-3">
                              <button 
                                onClick={() => {
                                  if(window.confirm("Voulez-vous clôturer ce programme ?")) {
                                    handleAddPallets(0);
                                  }
                                }}
                                className="w-full py-4 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-slate-600 dark:text-gray-300 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] border border-gray-100 dark:border-gray-700 transition-all flex items-center justify-center gap-2 italic"
                              >
                                 Terminer Mission Programme
                              </button>
                              
                              <button 
                                onClick={() => setShowStopConfirmation(true)}
                                className="w-full py-4 bg-white dark:bg-gray-900 text-slate-400 dark:text-gray-500 rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] hover:bg-rose-50 dark:hover:bg-rose-900/20 hover:text-rose-600 dark:hover:text-rose-400 border border-gray-100 dark:border-gray-700 transition-all flex items-center justify-center gap-2"
                              >
                                Arrêter la Production
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {activeLine?.status === 'IDLE' && (
                    <div className="space-y-4 pt-4 border-t border-gray-100 dark:border-gray-700 text-center">
                      <button 
                        onClick={handleStartProduction}
                        className="w-full py-6 bg-emerald-600 text-white rounded-[2rem] font-black text-sm uppercase tracking-widest shadow-xl dark:shadow-none active:scale-95 transition-all"
                      >
                        <Play size={20} fill="currentColor" className="inline-block mr-2" /> Démarrer Production
                      </button>
                    </div>
                  )}
                </div>

                {/* ACTIVITY LOGS */}
                <div className="bg-white dark:bg-gray-900 rounded-[2rem] p-6 border border-gray-100 dark:border-gray-800 shadow-sm dark:shadow-none relative overflow-hidden">
                  <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-2">
                      <History size={16} className="text-blue-600 dark:text-blue-400" />
                      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-gray-500">Activité Récente</h3>
                    </div>
                    <button 
                      onClick={() => setShowManualStopModal(true)}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-full border border-blue-100 dark:border-blue-900/30 hover:bg-blue-600 hover:text-white transition-all active:scale-95"
                    >
                      <Plus size={12} />
                      <span className="text-[8px] font-black uppercase tracking-widest">Manuel</span>
                    </button>
                  </div>

                  <div className="space-y-3 max-h-[500px] overflow-y-auto scrollbar-hide pr-1">
                    {downtimeLogs
                      .filter(d => d.operatorId === user?.id && d.lineId === selectedLineId && isToday(parseISO(d.startTime)))
                      .sort((a,b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
                      .map(log => {
                        const type = downtimeTypes.find(t => t.id === log.typeId);
                        return (
                          <div key={log.id} className="group relative bg-gray-50 dark:bg-gray-800 rounded-2xl p-4 border border-gray-100 dark:border-gray-700 hover:border-blue-100 dark:hover:border-blue-900 transition-all flex items-center justify-between shadow-sm dark:shadow-none">
                            <div className="flex items-center gap-4">
                              <div className="w-11 h-11 rounded-xl bg-white dark:bg-gray-900 border border-gray-50 dark:border-gray-800 flex items-center justify-center text-2xl shadow-inner transition-transform group-hover:scale-105">
                                {type?.icon || '⚠️'}
                              </div>
                              <div>
                                 <p className="text-[11px] font-black text-slate-900 dark:text-white uppercase tracking-tight italic leading-none mb-1.5">
                                   {type?.name || 'Inconnu'}
                                 </p>
                                 <div className="flex items-center gap-2">
                                   <Clock size={10} className="text-slate-400 dark:text-gray-500" />
                                   <p className="text-[9px] font-mono font-bold text-slate-500 dark:text-gray-400 uppercase tracking-widest">
                                     {format(parseISO(log.startTime), 'HH:mm')} - {log.endTime ? format(parseISO(log.endTime), 'HH:mm') : '--:--'}
                                     <span className="ml-2 text-blue-600 dark:text-blue-400">
                                       {log.duration ? formatDowntimeDisplay(log.duration) : 'En cours'}
                                     </span>
                                   </p>
                                 </div>
                                 {log.images && (
                                   <div className="flex gap-1 mt-2">
                                     {(typeof log.images === 'string' ? JSON.parse(log.images) as string[] : log.images as string[]).map((img, i) => (
                                       <div 
                                         key={i} 
                                         className="w-8 h-8 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shadow-sm cursor-pointer hover:scale-110 transition-all"
                                         onClick={() => setSelectedFullImage(img)}
                                       >
                                         <img 
                                           src={img.startsWith('http') || img.startsWith('/') ? img : `/uploads/${img}`} 
                                           className="w-full h-full object-cover" 
                                           referrerPolicy="no-referrer"
                                         />
                                       </div>
                                     ))}
                                   </div>
                                 )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={() => handleEditStopRequest(log)}
                                className="p-2 text-slate-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-all"
                              >
                                <Edit size={14} />
                              </button>
                              <button 
                                onClick={() => handleDeleteStop(log.id)}
                                className="p-2 text-slate-400 dark:text-gray-500 hover:text-rose-600 dark:hover:text-rose-400 transition-all"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    {downtimeLogs.filter(d => d.operatorId === user?.id && d.lineId === selectedLineId && isToday(parseISO(d.startTime))).length === 0 && (
                      <div className="py-12 text-center bg-gray-50/50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-100 dark:border-gray-800">
                         <Activity size={24} className="mx-auto text-slate-300 dark:text-gray-600 mb-2 opacity-20" />
                         <p className="text-[10px] font-black uppercase text-slate-400 dark:text-gray-500 tracking-[0.2em] italic">Historique vide</p>
                      </div>
                    )}
                  </div>
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
            initial={{ y: 60 }}
            animate={{ y: 0 }}
            className="fixed bottom-0 inset-x-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-t border-gray-100 dark:border-gray-800 px-4 py-2.5 z-40"
          >
            <div className="max-w-7xl mx-auto flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-2 h-2 rounded-full animate-pulse",
                  activeLine?.status === 'RUNNING' ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" : "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.5)]"
                )} />
                <div className="leading-none">
                  <p className="text-[6px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-0.5">Status Ligne</p>
                  <p className="text-[9px] font-black text-slate-900 dark:text-white uppercase italic tracking-tighter">
                    {activeLine?.status === 'RUNNING' ? 'Production Active' : 'Arrêt Détecté'}
                  </p>
                </div>
              </div>
              
              <div className="flex gap-2">
                 <div className="text-right leading-none">
                    <p className="text-[6px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-0.5">Performance</p>
                    <p className="text-[9px] font-black text-slate-900 dark:text-white italic">94% <span className="text-[6px] text-emerald-600 dark:text-emerald-400 font-bold ml-0.5">OEE</span></p>
                 </div>
              </div>
            </div>
          </motion.footer>
        )}
      </AnimatePresence>

      {/* MANUAL STOP MODAL */}
      <AnimatePresence>
        {showManualStopModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4"
          >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white dark:bg-gray-900 rounded-[2rem] w-full max-w-sm md:max-w-md shadow-3xl overflow-hidden border border-gray-100 dark:border-gray-800"
              >
                <div className="bg-blue-600 px-6 md:px-8 py-4 md:py-6 border-b border-blue-500 flex justify-between items-center text-white">
                   <h3 className="text-[12px] md:text-sm font-black uppercase tracking-widest italic">{editingLogId ? 'Modifier l\'arrêt' : t('add_manual_stop')}</h3>
                   <button onClick={() => {
                     setShowManualStopModal(false);
                     setEditingLogId(null);
                   }} className="text-white/70 hover:text-white transition-colors">
                     <X size={18} />
                   </button>
                </div>

                <div className="p-4 md:p-8 space-y-4 md:space-y-6">
                  <div className="grid grid-cols-1 gap-3 md:gap-4">
                    <div className="space-y-1 md:space-y-2">
                      <label className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest">{t('start_time')}</label>
                      <input 
                        type="datetime-local"
                        min={format(startOfDay(new Date()), "yyyy-MM-dd'T'HH:mm")}
                        max={format(endOfDay(new Date()), "yyyy-MM-dd'T'HH:mm")}
                        className="w-full p-3 md:p-4 bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl md:rounded-2xl text-[11px] md:text-xs font-black text-slate-900 dark:text-white outline-none focus:border-blue-500"
                        value={manualStopForm.startTime}
                        onChange={e => setManualStopForm({...manualStopForm, startTime: e.target.value})}
                      />
                    </div>
                    <div className="space-y-1 md:space-y-1">
                      <label className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest">{t('end_time')}</label>
                      <input 
                        type="datetime-local"
                        min={format(startOfDay(new Date()), "yyyy-MM-dd'T'HH:mm")}
                        max={format(endOfDay(new Date()), "yyyy-MM-dd'T'HH:mm")}
                        className="w-full p-3 md:p-4 bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl md:rounded-2xl text-[11px] md:text-xs font-black text-slate-900 dark:text-white outline-none focus:border-blue-500"
                        value={manualStopForm.endTime}
                        onChange={e => setManualStopForm({...manualStopForm, endTime: e.target.value})}
                      />
                    </div>
                  </div>

                  <div className="bg-blue-50 dark:bg-blue-900/20 p-3 md:p-4 rounded-xl md:rounded-2xl border border-blue-100 dark:border-blue-900/30 flex items-center justify-between font-bold">
                    <p className="text-[10px] font-black text-blue-500 dark:text-blue-400 uppercase tracking-widest">{t('total_duration')}</p>
                    <p className="text-lg md:text-xl font-black text-blue-900 dark:text-blue-300 font-mono">{calculateManualDuration()}</p>
                  </div>

                  <div className="space-y-1 md:space-y-2">
                    <label className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest">{t('reason')}</label>
                    <select 
                      className="w-full p-3 md:p-4 bg-slate-50 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-xl md:rounded-2xl text-[11px] md:text-xs font-black text-slate-900 dark:text-white outline-none focus:border-blue-500 appearance-none"
                      value={manualStopForm.typeId}
                      onChange={e => setManualStopForm({...manualStopForm, typeId: e.target.value})}
                    >
                      <option value="">{t('select_reason')}...</option>
                      {downtimeTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>

                  <div className="space-y-1 md:space-y-2">
                    <label className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest">Photos</label>
                    <div className="grid grid-cols-4 gap-2">
                      {manualImagePreviews.map((prev, idx) => (
                        <div key={idx} className="relative aspect-square rounded-lg md:rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 group/img">
                          <img src={prev} className="w-full h-full object-cover" />
                          <button
                            onClick={() => {
                              setManualImagePreviews(prevs => prevs.filter((_, i) => i !== idx));
                              setManualStopForm(form => ({ ...form, images: form.images.filter((_, i) => i !== idx) }));
                            }}
                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                      {manualImagePreviews.length < 5 && (
                        <button
                          onClick={() => {
                            if (Capacitor.isNativePlatform()) {
                               CapCamera.getPhoto({
                                 quality: 80,
                                 allowEditing: false,
                                 resultType: CameraResultType.Uri,
                                 source: CameraSource.Prompt,
                                 saveToGallery: true,
                                 width: 1200
                               }).then(image => {
                                 if (image.webPath) {
                                   const preview = image.webPath;
                                   fetch(preview).then(res => res.blob()).then(blob => uploadFile(blob, preview, true));
                                 }
                               });
                            } else {
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.accept = 'image/*';
                              input.onchange = (e: any) => {
                                const files = e.target.files;
                                if (files && files[0]) {
                                  uploadFile(files[0], URL.createObjectURL(files[0]), true);
                                }
                              };
                              input.click();
                            }
                          }}
                          disabled={isUploading}
                          className="aspect-square border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg md:rounded-xl flex flex-col items-center justify-center text-slate-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-500 transition-all font-black text-[10px]"
                        >
                          <Camera size={14} className="md:w-4 md:h-4" />
                          <span className="text-[7px] font-black uppercase mt-1">{isUploading ? '...' : '+'}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2 md:pt-4">
                    <button 
                      onClick={() => {
                        if (!manualStopForm.typeId || !manualStopForm.startTime || !manualStopForm.endTime) {
                          return alert(t('missing_fields'));
                        }
                        handleManualStop(manualStopForm);
                      }}
                      className="flex-1 bg-blue-600 text-white font-black uppercase py-3 md:py-4 rounded-xl md:rounded-2xl text-[10px] md:text-xs shadow-xl dark:shadow-none active:scale-95 transition-all tracking-widest hover:bg-blue-500 shadow-blue-100"
                    >
                      {editingLogId ? 'Enregistrer' : t('validate')}
                    </button>
                  </div>
                </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FEATURE INFO MODAL */}
      <AnimatePresence>
        {showFeatureInfo && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-md z-[200] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-[1.5rem] md:rounded-[2.5rem] w-full max-w-2xl shadow-3xl dark:shadow-none overflow-hidden"
            >
              <div className="p-4 md:p-8 space-y-4 md:space-y-8 max-h-[80vh] overflow-y-auto custom-scrollbar">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3 md:gap-4">
                    <div className="w-10 h-10 md:w-12 md:h-12 bg-blue-600 rounded-xl md:rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                      <Activity size={20} className="text-white md:w-6 md:h-6" />
                    </div>
                    <div>
                      <h3 className="text-lg md:text-xl font-black text-gray-900 dark:text-white italic tracking-tighter uppercase leading-none mb-1">Arrêts Groupés Intelligents</h3>
                      <p className="text-[8px] md:text-[10px] font-black text-blue-500 dark:text-blue-400 uppercase tracking-[0.2em]">Fonctionnalité AgroSync v2.4</p>
                    </div>
                  </div>
                  <button onClick={() => setShowFeatureInfo(false)} className="w-8 h-8 md:w-10 md:h-10 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
                    <X size={16} />
                  </button>
                </div>

                <div className="grid gap-4 md:gap-6">
                  <section className="space-y-2 md:space-y-3">
                    <h4 className="text-[9px] md:text-[10px] font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <div className="w-1 md:w-1.5 h-1 md:h-1.5 rounded-full bg-blue-500" />
                      Détection de Proximité Temporelle
                    </h4>
                    <p className="text-[11px] md:text-xs font-bold text-slate-600 dark:text-gray-300 leading-relaxed pl-3 md:pl-3.5 border-l border-gray-100 dark:border-gray-800">
                      Le système analyse en continu les temps de début d'incident. Si deux arrêts ou plus du même type surviennent sur différentes lignes d'une même machine dans une fenêtre de 2 minutes, ils sont automatiquement identifiés comme un incident lié.
                    </p>
                  </section>

                  <section className="space-y-2 md:space-y-3">
                    <h4 className="text-[9px] md:text-[10px] font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <div className="w-1 md:w-1.5 h-1 md:h-1.5 rounded-full bg-blue-500" />
                      L'Action de Groupe : Propagation
                    </h4>
                    <p className="text-[11px] md:text-xs font-bold text-slate-600 dark:text-gray-300 leading-relaxed pl-3 md:pl-3.5 border-l border-gray-100 dark:border-gray-800">
                      Lorsqu'un opérateur déclare un arrêt, l'application vérifie si une autre ligne a déjà déclaré le même motif récemment. Si c'est le cas, elle se connecte à cet arrêt existant. Sinon, elle propage l'état d'arrêt à toutes les autres lignes concernées pour synchroniser la machine.
                    </p>
                  </section>

                  <section className="space-y-2 md:space-y-3 p-3 md:p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl md:rounded-2xl border border-blue-100 dark:border-blue-900/30">
                    <h4 className="text-[9px] md:text-[10px] font-black text-blue-500 dark:text-blue-400 uppercase tracking-widest flex items-center gap-2">
                      <Activity size={10} md:size={12} />
                      Avantage Industriel
                    </h4>
                    <p className="text-[11px] md:text-xs font-bold text-blue-800/80 dark:text-blue-200/80 leading-relaxed">
                      Cette automatisation réduit la charge mentale des opérateurs qui n'ont plus à saisir manuellement chaque arrêt sur chaque ligne. Elle garantit une précision absolue dans le suivi des temps d'arrêt réels et facilite l'analyse des causes racines.
                    </p>
                  </section>
                </div>

                <button 
                  onClick={() => setShowFeatureInfo(false)}
                  className="w-full py-3 md:py-4 bg-blue-600 text-white rounded-lg md:rounded-xl font-black text-[10px] md:text-xs uppercase tracking-widest active:scale-95 transition-all shadow-lg dark:shadow-none hover:bg-blue-500"
                >
                  Compris
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* STOP PROD CONTRAST OVERLAY */}
      <AnimatePresence>
        {showStopConfirmation && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="bg-white dark:bg-gray-900 rounded-[3rem] w-full max-w-sm shadow-3xl dark:shadow-none overflow-hidden border border-gray-100 dark:border-gray-800"
            >
              <div className="p-10 text-center space-y-8">
                <div className="w-24 h-24 bg-rose-50 dark:bg-rose-900/20 rounded-full flex items-center justify-center mx-auto text-rose-500 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30 shadow-inner">
                  <AlertCircle size={48} />
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-3xl font-black text-gray-900 dark:text-white uppercase tracking-tighter italic leading-none">Arrêter Production ?</h3>
                  <p className="text-slate-400 dark:text-gray-500 font-bold text-sm leading-relaxed">
                    Cette action va clôturer la session de production actuelle.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  <button 
                    onClick={() => {
                      handleStopProduction();
                      setShowStopConfirmation(false);
                    }}
                    className="w-full bg-rose-600 hover:bg-rose-500 text-white py-5 rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl dark:shadow-none active:scale-95 transition-all shadow-rose-100"
                  >
                    Confirmer l'arrêt
                  </button>
                  <button 
                    onClick={() => setShowStopConfirmation(false)}
                    className="w-full py-4 text-slate-400 dark:text-gray-500 font-black uppercase text-xs tracking-widest hover:text-slate-900 dark:hover:text-white transition-colors"
                  >
                    Annuler
                  </button>
                </div>
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
            className="fixed inset-0 bg-slate-900/40 dark:bg-black/80 backdrop-blur-sm z-[300] flex items-center justify-center p-4 cursor-pointer"
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
                className="w-full h-auto max-h-[90vh] object-contain rounded-2xl shadow-2xl dark:shadow-none"
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
      <AnimatePresence>
        {(isInitialSelection || categorizingLogId) && (
          <div className="fixed inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-md z-[100] flex items-end sm:items-center justify-center p-4">
            <motion.div 
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="bg-white dark:bg-gray-900 rounded-[2rem] sm:rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden border border-gray-100 dark:border-gray-800"
            >
              <div className="p-5 space-y-6">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                      <Activity size={20} className="text-white" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-slate-900 dark:text-white uppercase italic tracking-tighter leading-none mb-1">
                        {isInitialSelection ? 'Type d\'arrêt' : 'Qualification'}
                      </h3>
                      <p className="text-[8px] font-black text-blue-500 uppercase tracking-widest">{isInitialSelection ? 'Initialisation incident' : 'Saisie cause racine'}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      setIsInitialSelection(false);
                      setCategorizingLogId(null);
                      setSelectedStopType(null);
                    }}
                    className="w-8 h-8 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>

                {!selectedStopType ? (
                  <div className="grid grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto pr-1">
                    {downtimeTypes.map((type) => (
                      <button
                        key={type.id}
                        onClick={() => setSelectedStopType(type.id)}
                        className="flex flex-col items-center justify-center gap-2 p-4 min-h-[100px] bg-[#F8FAFC] dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-2xl hover:bg-blue-600 hover:text-white hover:border-blue-500 transition-all active:scale-95 group"
                      >
                        <span className="text-3xl group-hover:scale-110 transition-transform">{type.icon || '⚠️'}</span>
                        <span className="text-[9px] font-black uppercase tracking-wider text-center leading-tight">
                          {type.name}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="space-y-5"
                  >
                    <div className="flex items-center gap-4 bg-blue-50 dark:bg-blue-900/20 p-4 rounded-2xl border border-blue-100 dark:border-blue-900/30">
                      <div className="text-3xl">{downtimeTypes.find(t => t.id === selectedStopType)?.icon}</div>
                      <h4 className="text-sm font-black text-blue-900 dark:text-blue-100 uppercase tracking-tight">
                        {downtimeTypes.find(t => t.id === selectedStopType)?.name}
                      </h4>
                    </div>

                    <div className="space-y-4">
                      <textarea 
                        className="w-full p-4 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-slate-400"
                        placeholder="Description optionnelle..."
                        value={downtimeDescription}
                        onChange={e => setDowntimeDescription(e.target.value)}
                        rows={3}
                      />
                      
                      <div className="grid grid-cols-5 gap-2">
                         {imagePreviews.map((p, idx) => (
                           <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                             <img src={p} className="w-full h-full object-cover" />
                             <button onClick={() => {
                               setImagePreviews(prev => prev.filter((_, i) => i !== idx));
                               setSelectedImagePaths(paths => paths.filter((_, i) => i !== idx));
                             }} className="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full p-0.5">
                                <X size={8} />
                             </button>
                           </div>
                         ))}
                         {imagePreviews.length < 5 && (
                           <button onClick={handleTakeStorePhoto} className="aspect-square border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg flex items-center justify-center text-slate-400">
                              <Camera size={16} />
                           </button>
                         )}
                      </div>

                      <button 
                        onClick={() => isInitialSelection ? handleConfirmStartDowntime(selectedStopType!) : handleCategorizeStop(selectedStopType!)}
                        className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-200 dark:shadow-none hover:bg-blue-700 active:scale-[0.98] transition-all"
                      >
                        {isInitialSelection ? 'Confirmer l\'arrêt' : 'Enregistrer qualification'}
                      </button>

                      <button 
                        onClick={() => setSelectedStopType(null)}
                        className="w-full py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-blue-600 transition-colors"
                      >
                        Retour aux motifs
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
