import React, { useState, useEffect, useRef, useMemo } from 'react';
import { localApi, API_BASE_URL } from '../lib/localApi';
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
  ChevronRight, ChevronLeft, Info, Camera, Video, Image, Trash, Sun, Moon, Lock
} from 'lucide-react';
import { Badge } from './ui/Badge';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { StopPicker } from './StopPicker';
import { formatDuration, formatDowntimeDisplay, cn, getLogDurationSec } from '../lib/utils';
import { getCurrentShiftId } from '../lib/shiftUtils';
import { motion, AnimatePresence } from 'motion/react';
import { Camera as CapCamera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { StatusIndicator } from './ui/StatusIndicator';

export default function OperatorScreen() {
  const { user, logout } = useAuth();
  const userRole = user && user.role ? user.role.toUpperCase() : '';
  const { t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { 
    machines, 
    lines, 
    users, 
    downtimeTypes, 
    programmes: availableProgrammes, 
    downtimeLogs,
    shifts,
    loading: isDataLoading
  } = useData();
  
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(() => sessionStorage.getItem('op_selected_machine') || null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(() => sessionStorage.getItem('op_selected_line') || null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Show a manual session reset button if connection is slow/stuck
  const [showReset, setShowReset] = useState(false);
  useEffect(() => {
    if (isDataLoading) {
      const timer = setTimeout(() => setShowReset(true), 3000);
      return () => clearTimeout(timer);
    } else {
      setShowReset(false);
    }
  }, [isDataLoading]);

  // Early returns moved below all hook declarations to comply with React's Rules of Hooks

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
  const [progressionTimer, setProgressionTimer] = useState(0);
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
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const appVersion = 'v1.1-responsive-scada';

  const activeLine = lines.find(l => l.id === selectedLineId) || null;
  const selectedMachine = machines.find(m => m.id === selectedMachineId) || null;
  const isMachineProdRunning = selectedMachine 
    ? (selectedMachine.isProdRunning === true || Number(selectedMachine.isProdRunning) === 1 || String(selectedMachine.isProdRunning) === '1' || String(selectedMachine.isProdRunning) === 'true') 
    : false;
  const activeProgramme = activeLine ? availableProgrammes.find(p => p.id === activeLine.currentProgrammeId) || null : null;
  const activeDowntime = activeLine?.activeDowntimeId ? downtimeLogs.find(d => d.id === activeLine.activeDowntimeId) || null : null;

  const currentShiftId = getCurrentShiftId(shifts);

  // Derive categorizing log
  const [dismissedLogId, setDismissedLogId] = useState<string | null>(null);

  const categorizingLog = !activeDowntime && activeLine 
    ? downtimeLogs.find(d => d.lineId === activeLine.id && d.operatorId === user?.id && d.typeId === 'PENDING' && d.endTime && d.id !== dismissedLogId) || null 
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

  const safeParseImages = (imagesVal: any): string[] => {
    if (!imagesVal) return [];
    if (Array.isArray(imagesVal)) return imagesVal;
    if (typeof imagesVal === 'string') {
      const trimmed = imagesVal.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return trimmed.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    }
    return [];
  };

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

  // Timer logic for active line production duration
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (activeLine?.status === 'RUNNING' && activeLine?.progressionStartTime) {
      interval = setInterval(() => {
        const start = new Date(activeLine.progressionStartTime).getTime();
        setProgressionTimer(Math.floor((Date.now() - start) / 1000));
      }, 1000);
    } else {
      setProgressionTimer(0);
    }
    return () => clearInterval(interval);
  }, [activeLine?.status, activeLine?.progressionStartTime]);

  // Pre-seed categorizing log values (description and images)
  useEffect(() => {
    if (categorizingLog) {
      setDowntimeDescription(categorizingLog.description || '');
      const parsed = safeParseImages(categorizingLog.images);
      setSelectedImagePaths(parsed);
      setImagePreviews(parsed.map((img: string) => img.startsWith('http') || img.startsWith('/') ? img : `/uploads/${img}`));
    } else {
      setDowntimeDescription('');
      setSelectedImagePaths([]);
      setImagePreviews([]);
    }
  }, [categorizingLogId]);

  if (!user) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center p-8 bg-gray-50 dark:bg-slate-950 space-y-4" id="operator-init-no-user">
        <div className="text-center">
          <h2 className="text-xl font-black text-gray-950 dark:text-gray-50">INITIALISATION</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 font-semibold">Chargement de l'utilisateur...</p>
        </div>
      </div>
    );
  }

  if (isDataLoading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center p-8 bg-gray-50 dark:bg-slate-950 space-y-6" id="operator-sync-loading">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <div className="text-center">
            <h2 className="text-lg font-black text-gray-950 dark:text-gray-50 uppercase tracking-tight">Écran Opérateur</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-semibold">Synchronisation des lignes en cours...</p>
          </div>
        </div>

        {showReset && (
          <div className="p-4 bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl shadow-xl max-w-sm text-center space-y-3 animate-fade-in" id="operator-sync-reset">
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
              Connexion ralentie. Si vous restez bloqué, vous pouvez réinitialiser votre session.
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-3 py-1.5 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-850 dark:text-gray-200 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                id="operator-loading-retry-btn"
              >
                Réessayer
              </button>
              <button
                onClick={() => {
                  logout();
                  window.location.reload();
                }}
                className="px-3 py-1.5 bg-red-655 hover:bg-red-500 text-white text-xs font-bold rounded-lg transition-colors shadow-md shadow-red-500/10 cursor-pointer"
                id="operator-loading-logout-btn"
              >
                Réinitialiser la session
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

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
        currentOperatorId: user?.id,
        progressionStartTime: new Date().toISOString()
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

      // Calculate automatic duration of production
      const startTimeStr = activeLine?.progressionStartTime;
      let finalDurationSec = 0;
      if (startTimeStr) {
        const start = new Date(startTimeStr).getTime();
        const end = new Date().getTime();
        finalDurationSec = Math.max(0, Math.floor((end - start) / 1000));
      }

      await localApi.updateDoc('lines', selectedLineId, {
        status: 'IDLE',
        progressionEndTime: new Date().toISOString(),
        lastProgressionDurationSec: finalDurationSec
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

  const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'video/mp4', 'video/quicktime', 'video/webm', 'video/ogg', 'video/3gpp', 'video/x-matroska', 'video/avi', 'video/msvideo', 'video/x-msvideo'
  ];
  const ALLOWED_EXTS = [
    '.jpg', '.jpeg', '.png', '.webp', '.pdf',
    '.mp4', '.mov', '.webm', '.ogg', '.3gp', '.mkv', '.avi'
  ];

  const compressAndValidateFile = async (file: File | Blob, mimeType?: string): Promise<Blob | File | null> => {
    const type = mimeType || file.type;
    const name = 'name' in file ? (file as File).name : '';
    const ext = name ? name.substring(name.lastIndexOf('.')).toLowerCase() : '';

    if (!ALLOWED_MIME_TYPES.includes(type) && (!ext || !ALLOWED_EXTS.includes(ext))) {
       alert("Format de fichier non autorisé. Uniquement JPG, PNG, WEBP, PDF et Vidéos (MP4, MOV, WEBM, AVI).");
       return null;
    }

    if (file.size > 100 * 1024 * 1024) {
       alert("Le fichier est trop volumineux (max 100Mo).");
       return null;
    }

    // Try client-side compression for images to optimize load times and bandwidth
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

  const handleTakeStoreMedia = async (type: 'photo' | 'video' | 'gallery') => {
    if (Capacitor.isNativePlatform()) {
      if (type === 'photo') {
        try {
          const image = await CapCamera.getPhoto({
            quality: 80,
            allowEditing: false,
            resultType: CameraResultType.Uri,
            source: CameraSource.Prompt,
            saveToGallery: true,
            width: 1200
          });
          if (image.webPath) {
            const response = await fetch(image.webPath);
            const blob = await response.blob();
            const validated = await compressAndValidateFile(blob, 'image/jpeg');
            if (validated) {
              uploadFile(validated, image.webPath, showManualStopModal, 'image/jpeg');
            }
          }
        } catch (e) {
          console.error('Erreur caméra:', e);
        }
      } else if (type === 'video') {
        mediaInputRef.current?.setAttribute('accept', 'video/mp4,video/quicktime,video/webm,video/ogg,video/3gpp,video/x-matroska,video/avi');
        mediaInputRef.current?.setAttribute('capture', 'environment');
        mediaInputRef.current?.click();
      } else {
        // Gallery
        mediaInputRef.current?.setAttribute('accept', 'image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/quicktime,video/webm,video/ogg,video/3gpp,video/x-matroska,video/avi');
        mediaInputRef.current?.removeAttribute('capture');
        mediaInputRef.current?.click();
      }
    } else {
      if (type === 'gallery') {
        mediaInputRef.current?.setAttribute('accept', 'image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/quicktime,video/webm,video/ogg,video/3gpp,video/x-matroska,video/avi');
        mediaInputRef.current?.removeAttribute('capture');
      } else if (type === 'video') {
        mediaInputRef.current?.setAttribute('accept', 'video/mp4,video/quicktime,video/webm,video/ogg,video/3gpp,video/x-matroska,video/avi');
        mediaInputRef.current?.setAttribute('capture', 'environment');
      } else {
        mediaInputRef.current?.setAttribute('accept', 'image/jpeg,image/png,image/webp');
        mediaInputRef.current?.setAttribute('capture', 'environment');
      }
      mediaInputRef.current?.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      for (const file of Array.from(files) as File[]) {
        const validated = await compressAndValidateFile(file, file.type);
        if (validated) {
          const preview = URL.createObjectURL(validated as Blob);
          uploadFile(validated, preview, showManualStopModal, (validated as any).type);
        }
      }
    }
  };

  const uploadFile = async (file: Blob | File, preview: string, isManual: boolean = false, mimeType?: string) => {
    setIsUploading(true);
    
    const limit = 100 * 1024 * 1024; // Strict 100MB limit for video support

    if (file.size > limit) {
      alert(`Le fichier est trop volumineux (max 100Mo).`);
      setIsUploading(false);
      return;
    }

    const formData = new FormData();
    const getExt = (m: string, f?: Blob | File) => {
      if (f instanceof File && f.name.includes('.')) {
        return f.name.substring(f.name.lastIndexOf('.')).toLowerCase();
      }
      const mimeMap: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'application/pdf': '.pdf',
        'video/mp4': '.mp4',
        'video/quicktime': '.mov',
        'video/webm': '.webm',
        'video/ogg': '.ogg',
        'video/3gpp': '.3gp',
        'video/x-matroska': '.mkv',
        'video/avi': '.avi',
        'video/msvideo': '.avi',
        'video/x-msvideo': '.avi'
      };
      return mimeMap[m] || '.jpg';
    };
    const extension = getExt(mimeType || file.type, file);
    const fileName = `media-${Date.now()}${extension}`;
    
    const fileToUpload = file instanceof File ? file : new File([file], fileName, { type: mimeType || file.type });
    formData.append('photo', fileToUpload);
  
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
    const isApplyToAll = selectedType?.applyToAll === 1 || selectedType?.applyToAll === true;

    // If change format or other and not yet filled, just step through
    if ((isChangeProg && !selectedProgrammeForChange) || (isOther && !downtimeDescription.trim())) {
      setSelectedStopType(typeId);
      return;
    }

    try {
      if (isApplyToAll) {
        // --- PROPAGATION LOGIC FOR GLOBAL FACTORY-WIDE STOP ---
        const logId = (await localApi.addDoc('downtime_logs', {
          machineId: activeLine.machineId,
          lineId: 'MACHINE_LEVEL', // Signifies global shutdown
          typeId,
          description: isChangeProg 
            ? `Chang. vers: ${availableProgrammes.find(p => p.id === selectedProgrammeForChange)?.name}` 
            : (downtimeDescription.trim() || undefined),
          images: selectedImagePaths.length > 0 ? selectedImagePaths : undefined,
          operatorId: user.id,
          shiftId: currentShiftId,
          startTime: new Date().toISOString()
        })).id;

        // Stop all active lines of all active machines in the entire factory!
        const allActiveLines = lines.filter(l => l.isActive !== false && l.isActive !== 0);
        for (const line of allActiveLines) {
          await localApi.updateDoc('lines', line.id, {
            status: 'STOPPED',
            activeDowntimeId: logId
          });
        }
      } else {
        // --- PROPAGATION LOGIC FOR SINGLE MACHINE STOP ---
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

        for (const line of machineLines) {
          await localApi.updateDoc('lines', line.id, {
            status: 'STOPPED',
            activeDowntimeId: logId
          });
        }
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

    const activeDowntimeType = downtimeTypes.find(t => t.id === activeDowntime.typeId);
    const wasApplyToAll = activeDowntimeType?.applyToAll === 1 || activeDowntimeType?.applyToAll === true;

    try {
      // Update log
      await localApi.updateDoc('downtime_logs', activeDowntime.id, {
        endTime,
        duration
      });

      if (wasApplyToAll) {
        // Resume all lines in the entire factory that point to this downtime log
        const stoppedLines = lines.filter(l => l.activeDowntimeId === activeDowntime.id);
        for (const line of stoppedLines) {
          await localApi.updateDoc('lines', line.id, {
            activeDowntimeId: null,
            status: 'RUNNING'
          });
        }
      } else {
        // Update line (standard single machine stop - resume all lines for this machine with this downtime ID)
        const machineLines = lines.filter(l => l.machineId === activeLine?.machineId && l.activeDowntimeId === activeDowntime.id);
        for (const line of machineLines) {
          await localApi.updateDoc('lines', line.id, {
            activeDowntimeId: null,
            status: 'RUNNING'
          });
        }
      }
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

  const handleAddManualStopClick = () => {
    setEditingLogId(null);
    setManualStopForm({
      typeId: '',
      startTime: format(new Date(Date.now() - 15 * 60000), "yyyy-MM-dd'T'HH:mm"),
      endTime: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      description: '',
      images: []
    });
    setManualImagePreviews([]);
    setShowManualStopModal(true);
  };

  const handleEditStopRequest = (log: any) => {
    setEditingLogId(log.id);
    const parsedImages = safeParseImages(log.images);
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
            }} className="w-12 h-12 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-gray-800 rounded-full transition-colors text-slate-500 dark:text-gray-400">
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

        <main className="flex-1 p-4 overflow-y-auto bg-slate-50 dark:bg-gray-950">
          <div className="max-w-7xl mx-auto space-y-6">
             <div className="flex flex-col items-center text-center space-y-2 mb-4">
                <h2 className="text-[10px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-[0.3em]">{t('line_select')}</h2>
                <div className="w-12 h-1 bg-blue-600 rounded-full" />
             </div>

             <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 px-2">
              {lines.filter(l => l.machineId === selectedMachineId).map(l => {
                const isBusy = l.status !== 'IDLE' && l.currentOperatorId !== user?.id;
                const operatorName = users.find(u => u.id === l.currentOperatorId)?.name;

                return (
                   <Card
                    key={l.id}
                    variant="scada"
                    padding="none"
                    className={cn(
                      "group cursor-pointer hover:border-blue-500 transition-all active:scale-[0.98]",
                      isBusy && "opacity-60 grayscale cursor-not-allowed border-slate-200"
                    )}
                    onClick={() => !isBusy && handleSelectLine(l)}
                  >
                    <div className="p-6 flex items-center justify-between">
                       <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-12 h-12 rounded-2xl flex items-center justify-center transition-colors",
                            isBusy ? "bg-slate-100 text-slate-400" : "bg-blue-50 group-hover:bg-blue-600 group-hover:text-white dark:bg-blue-900/20 text-blue-600"
                          )}>
                             <Monitor size={24} />
                          </div>
                          <div>
                             <h4 className="text-xl font-black text-slate-900 dark:text-white italic tracking-tighter uppercase leading-none">{l.name}</h4>
                             <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest mt-1">LIGNE PRODUCTION</p>
                          </div>
                       </div>
                       <StatusIndicator status={l.status === 'RUNNING' ? 'running' : l.status === 'STOPPED' ? 'fault' : 'idle'} />
                    </div>
                    {isBusy && (
                      <div className="px-6 py-2 bg-rose-50 dark:bg-rose-900/20 border-t border-rose-100 dark:border-rose-900/30">
                         <p className="text-[8px] font-black text-rose-600 uppercase tracking-widest text-center">
                           Occupé par {operatorName || 'un autre opérateur'}
                         </p>
                      </div>
                    )}
                  </Card>
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

      <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-slate-50 dark:bg-gray-950 pb-20">
        {!selectedLineId ? (
          <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex flex-col items-center text-center space-y-2">
               <span className="px-3 py-1 bg-blue-600 text-white rounded-full text-[8px] font-black uppercase tracking-[0.3em] shadow-lg shadow-blue-500/20">SÉLECTION LIGNE</span>
               <h2 className="text-4xl font-black text-slate-900 dark:text-white italic tracking-tighter uppercase">Machine: {machines.find(m => m.id === selectedMachineId)?.name}</h2>
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{lines.filter(l => l.machineId === selectedMachineId).length} Lignes Connectées</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {lines.filter(l => l.machineId === selectedMachineId && l.isActive !== false && l.isActive !== 0).map((line) => {
                const isBusy = line.status !== 'IDLE' && line.currentOperatorId !== user?.id;
                const operatorName = users.find(u => u.id === line.currentOperatorId)?.name;

                return (
                  <Card
                    key={line.id}
                    variant="scada"
                    padding="none"
                    className={cn(
                      "group cursor-pointer hover:border-blue-500 transition-all active:scale-[0.98] border-2 h-full flex flex-col",
                      isBusy && "opacity-60 grayscale border-slate-200"
                    )}
                    onClick={() => !isBusy && handleSelectLine(line)}
                  >
                    <div className="p-8 flex-1 flex flex-col items-center justify-center text-center space-y-4">
                       <div className={cn(
                         "w-20 h-20 rounded-[2.5rem] flex items-center justify-center text-3xl shadow-xl transition-all group-hover:scale-110",
                         isBusy ? "bg-slate-100 text-slate-400" : "bg-blue-600 text-white shadow-blue-500/20"
                       )}>
                         <Monitor size={36} />
                       </div>
                       
                       <div>
                          <h3 className="text-3xl font-black text-slate-900 dark:text-white italic tracking-tighter uppercase leading-none mb-2">{line.name}</h3>
                          <div className="flex items-center justify-center gap-2">
                            <StatusIndicator status={line.status === 'RUNNING' ? 'running' : line.status === 'STOPPED' ? 'fault' : 'idle'} />
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{line.status}</span>
                          </div>
                       </div>
                    </div>
                    
                    <div className={cn(
                      "px-8 py-4 border-t flex justify-between items-center transition-colors",
                      isBusy ? "bg-rose-50 border-rose-100" : "bg-slate-50/50 group-hover:bg-blue-50 border-slate-100 group-hover:border-blue-200"
                    )}>
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                         {isBusy ? `OCCUPÉ PAR ${operatorName?.split(' ')[0] || '...'}` : 'CLIQUEZ POUR ENTRER'}
                       </span>
                       <ChevronRight size={18} className={cn("transition-transform group-hover:translate-x-2", isBusy ? "text-rose-400" : "text-blue-600")} />
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="max-w-7xl mx-auto animate-in fade-in duration-500">
            <div className="flex items-center justify-between mb-4">
              <button 
                onClick={handleGoBackFromLine}
                className="flex items-center gap-3 text-slate-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors group"
              >
                <div className="w-12 h-12 rounded-full border border-slate-200 dark:border-gray-800 flex items-center justify-center bg-white dark:bg-gray-900 shadow-sm group-hover:border-blue-500 transition-colors">
                  <ArrowLeft size={18} className="group-hover:-translate-x-0.5 transition-transform" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-[0.15em] italic">{t('back_to_selection')}</span>
              </button>
              
              <div className="flex items-center gap-2">
                <span className="text-[8px] font-black text-slate-600 dark:text-gray-400 uppercase tracking-widest">{activeLine?.name}</span>
              </div>
            </div>



        <div className="relative">
          {activeLine?.status === 'NOT_STARTED' && (
            <div className="absolute inset-0 bg-slate-900/60 dark:bg-black/60 backdrop-blur-md z-40 rounded-[2.5rem] flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-300 pointer-events-auto border-4 border-dashed border-amber-500/20 min-h-[400px]">
              <div className="w-16 h-16 bg-amber-500 rounded-3xl flex items-center justify-center shadow-lg shadow-amber-500/30 border border-amber-350 mb-5 animate-pulse">
                <Lock className="text-white" size={32} />
              </div>
              <h3 className="text-white font-black text-xl italic uppercase tracking-tighter mb-2">PANNEAU VERROUILLÉ</h3>
              <p className="text-amber-400 font-bold text-[11px] uppercase tracking-[0.15em] max-w-md leading-normal">
                Attente du lancement de la production par le Pilote...
              </p>
            </div>
          )}

          <div className={cn(
            "grid grid-cols-1 lg:grid-cols-12 gap-6 items-start",
            activeLine?.status === 'NOT_STARTED' && "pointer-events-none filter blur-sm opacity-40 select-none"
          )}>
          {/* LEFT COLUMN: MAIN STATUS */}
          <div className="lg:col-span-7 space-y-6">
            <Card variant="scada" padding="lg" className={cn(
              "relative overflow-hidden transition-all duration-700",
              activeLine?.status === 'RUNNING' 
                ? "border-emerald-500/20 bg-emerald-50/10" 
                : "border-rose-500/20 bg-rose-50/10"
            )}>
              <div className="flex flex-col items-center text-center relative z-10 py-4">
                <div className={cn(
                  "w-16 h-16 rounded-2xl flex items-center justify-center mb-6 shadow-xl transition-all duration-500",
                  activeLine?.status === 'RUNNING' ? "bg-emerald-500 shadow-emerald-500/20" : "bg-rose-500 shadow-rose-500/20"
                )}>
                  {activeLine?.status === 'RUNNING' ? <Activity size={32} className="text-white" /> : <AlertCircle size={32} className="text-white" />}
                </div>

                <h2 className="text-3xl font-black text-slate-900 dark:text-white italic tracking-tighter mb-2 uppercase">
                  {activeLine?.name}
                </h2>
                
                <div className="flex items-center gap-2 mb-8">
                  <StatusIndicator 
                    status={activeLine?.status === 'RUNNING' ? 'running' : 'fault'} 
                    label={activeLine?.status === 'RUNNING' ? 'OPÉRATIONNEL' : 'ARRÊTÉ'} 
                  />
                </div>

                {activeDowntime ? (
                  <div className="w-full max-w-sm space-y-4">
                    <div className="bg-white dark:bg-gray-800 rounded-3xl p-6 border border-slate-100 dark:border-gray-800 shadow-sm relative group overflow-hidden">
                       <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 blur-3xl opacity-50" />
                       <div className="flex items-center justify-center gap-2 text-rose-500 mb-2">
                         <Timer size={18} className="animate-pulse" />
                         <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Chronomètre d'Arrêt</span>
                       </div>
                       <p className="text-5xl font-black tracking-tighter tabular-nums text-slate-900 dark:text-white">
                         {formatDowntimeDisplay(timer)}
                       </p>
                       
                       <Button 
                         variant="success" 
                         size="lg"
                         className="w-full mt-6 h-16 shadow-lg shadow-emerald-500/20"
                         onClick={handleStopDowntime}
                       >
                         <Play size={20} fill="currentColor" className="mr-2" /> REPRENDRE LE CYCLE
                       </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center w-full animate-in fade-in duration-300">
                    {activeLine?.status === 'RUNNING' && (
                      <div className="w-full max-w-sm bg-emerald-500/10 border border-emerald-500/20 rounded-3xl p-5 mb-6 text-center">
                         <div className="flex items-center justify-center gap-1.5 text-emerald-600 dark:text-emerald-400 mb-1">
                           <Timer size={14} className="animate-spin-slow" />
                           <span className="text-[9px] font-black uppercase tracking-widest leading-none">Temps De Production Continu</span>
                         </div>
                         <p className="text-4xl font-black tracking-tighter tabular-nums text-emerald-600 dark:text-emerald-450 leading-none my-1">
                           {formatDowntimeDisplay(progressionTimer)}
                         </p>
                         <p className="text-[8px] font-bold text-slate-400 dark:text-gray-500 uppercase mt-1 leading-none">Calculé Automatiquement</p>
                      </div>
                    )}
                    <Button 
                      variant="danger" 
                      size="lg"
                      className="w-full max-w-sm h-16 shadow-lg shadow-rose-500/20"
                      onClick={handleStartDowntime}
                      disabled={activeLine?.isActive === false || activeLine?.isActive === 0}
                    >
                      <Square size={20} fill="currentColor" className="mr-2" /> DÉCLARER UN ARRÊT
                    </Button>
                  </div>
                )}
              </div>
            </Card>

            {activeLine?.status === 'IDLE' && (
              <div className="space-y-4">
                 {activeLine?.lastProgressionDurationSec ? (
                   <div className="bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/35 rounded-3xl p-5 text-center">
                     <p className="text-[8px] font-black text-blue-500 dark:text-blue-400 uppercase tracking-widest mb-1 leading-none">Dernière Durée De Production De La Ligne</p>
                     <p className="text-xl font-black text-slate-800 dark:text-white leading-none my-1">
                       {formatDowntimeDisplay(activeLine.lastProgressionDurationSec)}
                     </p>
                     <p className="text-[7.5px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest mt-1">Calculée lors de la dernière progression</p>
                   </div>
                 ) : null}

                 {!isMachineProdRunning ? (
                   <div className="text-center p-6 bg-rose-50/50 dark:bg-rose-950/20 rounded-[2rem] border border-rose-100 dark:border-rose-900/35 space-y-3">
                      <div className="text-rose-500 flex justify-center">
                         <AlertCircle size={28} className="animate-pulse" />
                      </div>
                      <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest">⚠️ Production de la machine à l'arrêt</p>
                      <p className="text-[9px] font-black text-slate-500 dark:text-gray-400 leading-normal max-w-sm mx-auto uppercase">
                         La ligne ne peut pas être démarrée tant que le pilote n'a pas activé la production depuis son écran de surveillance.
                      </p>
                   </div>
                 ) : (
                   <div className="text-center p-8 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-[2rem] border border-emerald-100 dark:border-emerald-900/30">
                      <Button 
                        variant="success" 
                        size="lg" 
                        className="w-full h-16 shadow-xl text-[10px] tracking-wider uppercase font-black animate-in fade-in zoom-in duration-300"
                        onClick={handleStartProduction}
                        disabled={!activeProgramme}
                      >
                        <Play size={18} fill="currentColor" className="mr-2 animate-pulse" /> DECLARER LIGNE EN PROGRESSION
                      </Button>
                      {!activeProgramme && (
                        <p className="text-[8px] font-black text-slate-400 dark:text-gray-500 uppercase tracking-wider mt-2.5">Veuillez charger un programme (mission active) pour commencer.</p>
                      )}
                   </div>
                 )}
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: MISSION & LOGS */}
          <div className="lg:col-span-5 space-y-6">
            <Modal isOpen={showStopConfirmation} onClose={() => setShowStopConfirmation(false)} title="CLÔTURER LA PROGRESSION" size="sm">
              <div className="p-2 space-y-6 text-center">
                 <div className="w-16 h-16 bg-rose-50 dark:bg-rose-900/20 rounded-full flex items-center justify-center mx-auto text-rose-500 border border-rose-100 dark:border-rose-900/30">
                   <AlertCircle size={32} />
                 </div>
                 <p className="text-xs font-bold text-slate-500 dark:text-gray-400">Voulez-vous vraiment clôre ou finir la progression sur cette ligne ?</p>
                 <div className="flex flex-col gap-2">
                   <Button variant="danger" size="lg" className="w-full" onClick={() => { handleStopProduction(); setShowStopConfirmation(false); }}>OUI, PROGRESSION TERMINÉE</Button>
                   <Button variant="ghost" size="sm" onClick={() => setShowStopConfirmation(false)}>ANNULER</Button>
                 </div>
              </div>
            </Modal>

            <Card variant="scada" padding="none" className="overflow-hidden">
               <div className="p-4 border-b border-slate-100 dark:border-gray-800 bg-slate-50/50 dark:bg-gray-800/50 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Package size={16} className="text-blue-600" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-800 dark:text-white italic">Mission Active</span>
                  </div>
                  {activeProgramme && <Badge variant="success" size="xs">EN COURS</Badge>}
               </div>

               {!activeProgramme ? (
                 <div className="p-12 text-center">
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">Charger un programme</p>
                   <div className="grid grid-cols-1 gap-2">
                      {availableProgrammes.filter(p => (p.lineId === selectedLineId || !p.lineId) && p.status === 'ACTIVE').map(p => (
                        <Button key={p.id} variant="outline" className="h-12 text-[10px] items-center justify-between font-black uppercase" onClick={() => handleSelectProgramme(p.id)}>
                          {p.name} <Play size={14} className="text-blue-600" fill="currentColor" />
                        </Button>
                      ))}
                   </div>
                 </div>
               ) : (
                 <div className="divide-y divide-slate-100 dark:divide-gray-800">
                    <div className="p-6">
                       <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 italic underline decoration-blue-500 underline-offset-4">Article Actuel</p>
                       <h4 className="text-2xl font-black text-slate-900 dark:text-white italic tracking-tighter uppercase mb-4">{activeProgramme.name}</h4>
                       
                       {activeLine?.tracksProduction !== false && activeLine?.tracksProduction !== 0 && (
                         <div className="grid grid-cols-2 gap-4">
                            <div className="bg-slate-50 dark:bg-gray-800 p-4 rounded-2xl border border-slate-100">
                               <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Palettes</p>
                               <p className="text-3xl font-black text-blue-600 tabular-nums">{activeProgramme.producedPallets || 0}</p>
                            </div>
                            <div className="bg-slate-50 dark:bg-gray-800 p-4 rounded-2xl border border-slate-100 opacity-40">
                               <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Objectif</p>
                               <p className="text-3xl font-black text-slate-900 dark:text-white tabular-nums">-</p>
                            </div>
                         </div>
                       )}
                    </div>

                    {activeLine?.tracksProduction !== false && activeLine?.tracksProduction !== 0 && (
                      activeLine?.status !== 'RUNNING' ? (
                        <div className="p-6 space-y-4">
                         <div className="flex items-center gap-2">
                            <Button variant="outline" size="lg" className="h-16 w-16 rounded-2xl border-2" onClick={() => setPalletInput(Math.max(1, parseInt(palletInput) - 1).toString())}>
                              <Minus size={24} />
                            </Button>
                            <div className="flex-1 h-16 bg-white dark:bg-gray-900 rounded-2xl border-2 border-slate-100 flex items-center justify-center font-mono">
                               <input type="number" className="w-full bg-transparent border-none text-2xl font-black text-center outline-none text-slate-900 dark:text-white" value={palletInput} onChange={e => setPalletInput(e.target.value)} />
                            </div>
                            <Button variant="outline" size="lg" className="h-16 w-16 rounded-2xl border-2" onClick={() => setPalletInput((parseInt(palletInput) + 1).toString())}>
                              <Plus size={24} />
                            </Button>
                         </div>
                         <Button variant="primary" size="lg" className="w-full h-16 shadow-xl shadow-blue-500/20" onClick={async () => {
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
                            await localApi.updateDoc('programmes', activeProgramme.id, { producedPallets: { _inc: count } });
                            setPalletInput('1');
                         }}>VALIDER SAISIE</Button>
                      </div>
                       ) : (
                         <div className="p-6 bg-slate-50 dark:bg-slate-900/40 text-center flex flex-col items-center justify-center min-h-[160px] border-b border-slate-100 dark:border-gray-800">
                           <div className="w-12 h-12 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center mb-3">
                             <Activity size={20} className="animate-pulse" />
                           </div>
                           <p className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider mb-1">Production en cours</p>
                           <p className="text-[10px] text-slate-400 dark:text-gray-500 max-w-[200px] leading-normal font-bold">L'ajout manuel de palettes est désactivé pendant que l'enregistrement automatique est en cours.</p>
                         </div>
                       )
                    )}

                    <div className="p-3 flex gap-2">
                       <Button variant="secondary" className="flex-1 h-12 text-[10px] tracking-widest uppercase italic font-bold" onClick={() => { if(window.confirm("Clôturer ?")) handleAddPallets(0); }}>FIN MISSION</Button>
                       <Button variant="danger" className="flex-1 h-12 text-[10px] tracking-widest uppercase italic font-bold shadow-lg shadow-rose-500/20" onClick={() => setShowStopConfirmation(true)}>PROGRESSION FINIE</Button>
                    </div>
                 </div>
               )}
            </Card>

            <Card variant="scada" padding="none" className="overflow-hidden">
               <div className="p-4 border-b border-slate-100 dark:border-gray-800 bg-slate-50/50 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <History size={16} className="text-blue-600" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-800 dark:text-white">Derniers Arrêts</span>
                  </div>
                  <Button variant="outline" className="h-11 px-4 text-[10px] uppercase font-bold" onClick={handleAddManualStopClick}>+ MANUEL</Button>
               </div>
               <div className="divide-y divide-slate-100 dark:divide-gray-800 max-h-[300px] overflow-y-auto">
                 {downtimeLogs
                   .filter(d => d.operatorId === user?.id && d.lineId === selectedLineId && isToday(parseISO(d.startTime)))
                   .sort((a,b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
                   .map(log => {
                     const type = downtimeTypes.find(t => t.id === log.typeId);
                     return (
                       <div key={log.id} className="p-4 flex items-center justify-between group">
                          <div className="flex items-center gap-3">
                             <div className="text-2xl">{type?.icon || '⚠️'}</div>
                             <div>
                                <p className="text-[9px] font-black uppercase text-slate-900 dark:text-white leading-none mb-1">{type?.name || 'Inconnu'}</p>
                                <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest leading-none">{format(parseISO(log.startTime), 'HH:mm')} • {formatDowntimeDisplay(getLogDurationSec(log))}</p>
                             </div>
                          </div>
                          <div className="flex gap-2 items-center">
                             <button 
                               onClick={() => handleEditStopRequest(log)}
                               className="h-12 w-12 rounded-xl flex items-center justify-center bg-slate-100 hover:bg-slate-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-slate-600 dark:text-gray-300 transition-all border border-slate-200 dark:border-gray-700"
                               title="Modifier l'arrêt"
                             >
                               <Edit size={18} />
                             </button>
                             <button 
                               onClick={() => handleDeleteStop(log.id)}
                               className="h-12 w-12 rounded-xl flex items-center justify-center bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 transition-all border border-rose-100 dark:border-rose-900/30"
                               title="Supprimer l'arrêt"
                             >
                               <Trash2 size={18} />
                             </button>
                          </div>
                       </div>
                     );
                   })}
                 {downtimeLogs.filter(d => d.operatorId === user?.id && d.lineId === selectedLineId && isToday(parseISO(d.startTime))).length === 0 && (
                   <div className="p-12 text-center italic opacity-30 text-[10px] font-bold uppercase tracking-widest">Aucun arrêt aujourd'hui</div>
                 )}
               </div>
            </Card>
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
                      {manualImagePreviews.map((prev, idx) => {
                        const isVid = manualStopForm.images[idx] ? (manualStopForm.images[idx].endsWith('.mp4') || manualStopForm.images[idx].endsWith('.webm') || manualStopForm.images[idx].endsWith('.mov')) : false;
                        return (
                          <div key={idx} className="relative aspect-square rounded-lg md:rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 group/img">
                            {isVid ? (
                              <video src={prev} className="w-full h-full object-cover" />
                            ) : (
                              <img src={prev} className="w-full h-full object-cover" />
                            )}
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
                        );
                      })}
                      {manualImagePreviews.length < 5 && (
                        <>
                          <button
                            onClick={() => handleTakeStoreMedia('photo')}
                            disabled={isUploading}
                            className="aspect-square border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg md:rounded-xl flex flex-col items-center justify-center text-slate-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-500 transition-all font-black"
                          >
                            <Camera size={14} className="md:w-4 md:h-4" />
                            <span className="text-[7px] font-black uppercase mt-1">{isUploading ? '...' : 'Photo'}</span>
                          </button>
                          <button
                            onClick={() => handleTakeStoreMedia('video')}
                            disabled={isUploading}
                            className="aspect-square border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg md:rounded-xl flex flex-col items-center justify-center text-slate-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-500 transition-all font-black"
                          >
                            <Video size={14} className="md:w-4 md:h-4" />
                            <span className="text-[7px] font-black uppercase mt-1">{isUploading ? '...' : 'Vidéo'}</span>
                          </button>
                          <button
                            onClick={() => handleTakeStoreMedia('gallery')}
                            disabled={isUploading}
                            className="aspect-square border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg md:rounded-xl flex flex-col items-center justify-center text-slate-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-500 transition-all font-black"
                          >
                            <Image size={14} className="md:w-4 md:h-4" />
                            <span className="text-[7px] font-black uppercase mt-1">{isUploading ? '...' : 'Galerie'}</span>
                          </button>
                        </>
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
                      <Activity className="w-2.5 h-2.5 md:w-3 md:h-3" />
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
                      className="w-full h-auto max-h-[85vh] object-contain mx-auto rounded-2xl"
                      referrerPolicy="no-referrer"
                    />
                  );
                })()}
              </div>
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
                         {imagePreviews.map((p, idx) => {
                           const isVid = selectedImagePaths[idx] ? (selectedImagePaths[idx].endsWith('.mp4') || selectedImagePaths[idx].endsWith('.webm') || selectedImagePaths[idx].endsWith('.mov')) : false;
                           return (
                             <div key={idx} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800">
                               {isVid ? (
                                 <video src={p} className="w-full h-full object-cover" />
                               ) : (
                                 <img src={p} className="w-full h-full object-cover" />
                               )}
                               <button onClick={() => {
                                 setImagePreviews(prev => prev.filter((_, i) => i !== idx));
                                 setSelectedImagePaths(paths => paths.filter((_, i) => i !== idx));
                               }} className="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full p-0.5 shadow-lg active:scale-95">
                                  <X size={8} />
                               </button>
                             </div>
                           );
                         })}
                         {imagePreviews.length < 5 && (
                           <>
                             <button 
                               onClick={() => handleTakeStoreMedia('photo')} 
                               className="aspect-square border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg flex flex-col items-center justify-center text-slate-400 hover:text-blue-600 hover:border-blue-500 transition-all bg-white dark:bg-gray-900"
                             >
                                <Camera size={16} />
                                <span className="text-[7px] font-black mt-1">PHOTO</span>
                             </button>
                             <button 
                               onClick={() => handleTakeStoreMedia('video')} 
                               className="aspect-square border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg flex flex-col items-center justify-center text-slate-400 hover:text-blue-600 hover:border-blue-500 transition-all bg-white dark:bg-gray-900"
                             >
                                <Video size={16} />
                                <span className="text-[7px] font-black mt-1">VIDÉO</span>
                             </button>
                             <button 
                               onClick={() => handleTakeStoreMedia('gallery')} 
                               className="aspect-square border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg flex flex-col items-center justify-center text-slate-400 hover:text-blue-600 hover:border-blue-500 transition-all bg-white dark:bg-gray-900"
                             >
                                <Image size={16} />
                                <span className="text-[7px] font-black mt-1">GALERIE</span>
                             </button>
                           </>
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
      <input 
        type="file" 
        ref={mediaInputRef}
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
