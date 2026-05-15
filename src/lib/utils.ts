import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number) {
  const s = Math.floor(seconds % 60);
  const minutes = Math.floor((seconds / 60) % 60);
  const hours = Math.floor(seconds / 3600);

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function formatMinutes(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return minutes.toString().padStart(2, '0');
}

export function formatDowntimeDisplay(seconds: number) {
  if (!seconds || seconds <= 0) return '0s';
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes.toString().padStart(2, '0')} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}min`;
}

export function getLogDurationSec(log: { startTime: string; endTime?: string; duration?: number }) {
  const start = new Date(log.startTime).getTime();
  if (isNaN(start)) return 0;
  
  if (log.endTime) {
    const end = new Date(log.endTime).getTime();
    if (!isNaN(end)) {
      return Math.max(0, Math.floor((end - start) / 1000));
    }
  }
  
  return Math.max(0, Math.floor((Date.now() - start) / 1000));
}
