import React, { useMemo } from 'react';
import { Card } from './Card';
import { parseISO, getHours, isToday } from 'date-fns';
import { cn } from '../../lib/utils';
import { AlarmCheck, Calendar } from 'lucide-react';

interface DowntimeHeatmapProps {
  lines: any[];
  downtimeLogs: any[];
  className?: string;
}

export const DowntimeHeatmap: React.FC<DowntimeHeatmapProps> = ({
  lines,
  downtimeLogs,
  className
}) => {
  // We divide the 24-hour day into 12 2-hour slots for perfect responsiveness on mobile,
  // while showing precise tooltips.
  const hourSlots = useMemo(() => [
    { label: '00h', start: 0, end: 1 },
    { label: '02h', start: 2, end: 3 },
    { label: '04h', start: 4, end: 5 },
    { label: '06h', start: 6, end: 7 },
    { label: '08h', start: 8, end: 9 },
    { label: '10h', start: 10, end: 11 },
    { label: '12h', start: 12, end: 13 },
    { label: '14h', start: 14, end: 15 },
    { label: '16h', start: 16, end: 17 },
    { label: '18h', start: 18, end: 19 },
    { label: '20h', start: 20, end: 21 },
    { label: '22h', start: 22, end: 23 },
  ], []);

  // Filter only today's logs
  const todayLogs = useMemo(() => {
    return downtimeLogs.filter(log => {
      try {
        return log.startTime && isToday(parseISO(log.startTime));
      } catch {
        return false;
      }
    });
  }, [downtimeLogs]);

  // Map downtime duration per line per slot
  const heatMapData = useMemo(() => {
    const data: Record<string, number[]> = {};

    lines.forEach(line => {
      data[line.id] = new Array(12).fill(0);
    });

    todayLogs.forEach(log => {
      try {
        if (!data[log.lineId]) return;
        const hour = getHours(parseISO(log.startTime));
        const slotIdx = Math.floor(hour / 2);
        
        // Accumulate minutes of downtime in this slot
        const durationMin = Math.round((log.duration || 0) / 60) || 1; // fallback to 1min if trivial or ongoing
        if (slotIdx >= 0 && slotIdx < 12) {
          data[log.lineId][slotIdx] += durationMin;
        }
      } catch (e) {
        console.warn('Err heatmap calculations:', e);
      }
    });

    return data;
  }, [lines, todayLogs]);

  // Find max value to calibrate visual intensity
  const maxDowntime = useMemo(() => {
    let max = 1;
    (Object.values(heatMapData) as number[][]).forEach(row => {
      row.forEach(val => {
        if (val > max) max = val;
      });
    });
    return max;
  }, [heatMapData]);

  // Helper to color cell based on downtime value
  const getCellColor = (val: number) => {
    if (val === 0) return 'bg-slate-50 dark:bg-slate-900 border-slate-100 dark:border-gray-800';
    const ratio = val / maxDowntime;
    if (ratio < 0.2) return 'bg-rose-100 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-200/50';
    if (ratio < 0.5) return 'bg-rose-300 dark:bg-rose-900/40 text-rose-900 dark:text-rose-300 border-rose-300/50';
    if (ratio < 0.8) return 'bg-rose-500 text-white border-rose-600';
    return 'bg-rose-700 text-white border-rose-800 ring-1 ring-rose-400 animate-pulse';
  };

  return (
    <Card variant="scada" padding="none" className={cn("overflow-hidden select-none border-blue-500/10", className)}>
      <div className="p-4 border-b border-slate-100 dark:border-gray-800 bg-slate-50/50 dark:bg-gray-800/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlarmCheck size={16} className="text-rose-600 shrink-0" />
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-800 dark:text-white italic">
              Matrice Thermique des Arrêts
            </span>
            <p className="text-[7px] md:text-[8px] font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">
              Aujourd'hui par ligne et tranches de 2 heures
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          <Calendar size={12} className="text-gray-400" />
          <span className="text-[8px] font-black uppercase tracking-widest text-slate-400 dark:text-gray-500 bg-slate-100/80 dark:bg-gray-800 px-1.5 py-0.5 rounded">
            En Direct
          </span>
        </div>
      </div>

      <div className="p-3 sm:p-5 overflow-x-auto scrollbar-hide">
        <div className="min-w-[480px] space-y-3">
          {/* Header Row (Hours) */}
          <div className="grid grid-cols-12 gap-1 pl-20 pr-1">
            {hourSlots.map(slot => (
              <div key={slot.label} className="text-center">
                <span className="text-[7px] md:text-[8px] font-black uppercase tracking-widest text-slate-400 dark:text-gray-500">
                  {slot.label}
                </span>
                <p className="text-[6px] text-gray-400 dark:text-gray-600 leading-none">
                  {slot.start}-{slot.end + 1}h
                </p>
              </div>
            ))}
          </div>

          {/* Heat Rows (Lines) */}
          <div className="space-y-1.5">
            {lines.map(line => {
              const rowData = heatMapData[line.id] || new Array(12).fill(0);
              const totalLineArr = rowData.reduce((a, b) => a + b, 0);

              return (
                <div key={line.id} className="grid grid-cols-12 gap-1 items-center relative group">
                  {/* Line Row Header */}
                  <div className="absolute left-0 w-20 truncate pr-2 flex flex-col justify-center">
                    <span className="text-[9px] font-black uppercase text-slate-800 dark:text-white tracking-tighter truncate leading-none">
                      {line.name}
                    </span>
                    <span className="text-[6px] font-bold text-rose-500 uppercase leading-none mt-0.5">
                      {totalLineArr > 0 ? `${totalLineArr}m` : 'Aucun'}
                    </span>
                  </div>

                  {/* Empty spacer for absolute grid align */}
                  <div className="col-span-12 grid grid-cols-12 gap-1 pl-20">
                    {rowData.map((val, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          "h-7 sm:h-9 rounded-md border flex items-center justify-center text-[8px] font-black transition-all duration-300 relative cursor-pointer hover:scale-105 hover:z-10",
                          getCellColor(val)
                        )}
                        title={`${line.name} • Tranche ${hourSlots[idx].start}h-${hourSlots[idx].end + 1}h : ${val} min d'arrêt`}
                      >
                        {val > 0 && (
                          <span className="tabular-nums opacity-90">{val}'</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Color Legend */}
          <div className="flex justify-end items-center gap-2 pt-2 text-[7px] md:text-[8px] font-bold uppercase text-slate-400 dark:text-gray-500 pr-1 select-none">
            <span>Rien</span>
            <span className="w-2.5 h-2.5 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-gray-800" />
            <span className="w-2.5 h-2.5 rounded bg-rose-100 border border-rose-200" />
            <span className="w-2.5 h-2.5 rounded bg-rose-300 border border-rose-300" />
            <span className="w-2.5 h-2.5 rounded bg-rose-500" />
            <span className="w-2.5 h-2.5 rounded bg-rose-700 ring-1 ring-rose-400 animate-pulse" />
            <span>Critique</span>
          </div>
        </div>
      </div>
    </Card>
  );
};
