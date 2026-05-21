import React, { useMemo } from 'react';
import { Card } from './Card';
import { StatusIndicator } from './StatusIndicator';
import { cn, formatDowntimeDisplay } from '../../lib/utils';

interface TimelineEvent {
  id: string;
  typeId: string;
  typeName: string;
  startTime: string;
  endTime?: string;
  duration: number;
  lineId: string;
}

interface DowntimeTimelineProps {
  events: TimelineEvent[];
  lines: { id: string, name: string }[];
  className?: string;
}

export const DowntimeTimeline: React.FC<DowntimeTimelineProps> = ({ events, lines, className }) => {
  // Simple representation: Last 12 hours
  const hours = Array.from({ length: 12 }, (_, i) => i);
  
  return (
    <Card variant="scada" padding="sm" className={cn("overflow-hidden", className)}>
      <div className="flex items-center justify-between mb-4 px-2">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Chronologie des arrêts (12h)</h3>
        <div className="flex gap-4">
          <StatusIndicator status="fault" animate={false} label="Arrêt" />
          <StatusIndicator status="running" animate={false} label="Production" />
        </div>
      </div>
      
      <div className="space-y-3 overflow-x-auto pb-2">
        {lines.map(line => (
          <div key={line.id} className="min-w-[600px]">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[9px] font-black uppercase tracking-tighter text-slate-300 w-16 truncate">{line.name}</span>
              <div className="flex-1 h-3 bg-emerald-500/20 dark:bg-emerald-500/10 rounded-sm relative overflow-hidden">
                {/* Visualizing events for this line */}
                {events.filter(e => e.lineId === line.id).map(event => {
                  // Simplified percentage logic for demo - in real app would use date-fns difference from 'X' hours ago
                  const start = new Date(event.startTime).getTime();
                  const now = Date.now();
                  const twelveHoursAgo = now - 12 * 3600 * 1000;
                  
                  if (start < twelveHoursAgo && (!event.endTime || new Date(event.endTime).getTime() < twelveHoursAgo)) return null;
                  
                  const startRel = Math.max(0, (start - twelveHoursAgo) / (12 * 3600 * 1000));
                  const endRel = event.endTime ? (new Date(event.endTime).getTime() - twelveHoursAgo) / (12 * 3600 * 1000) : 1;
                  
                  return (
                    <div 
                      key={event.id}
                      className="absolute top-0 h-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]"
                      style={{ 
                        left: `${startRel * 100}%`, 
                        width: `${Math.max(0.5, (endRel - startRel) * 100)}%` 
                      }}
                      title={`${event.typeName}: ${formatDowntimeDisplay(event.duration)}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
      
      <div className="flex justify-between px-2 mt-2 text-[8px] font-mono text-slate-500">
        <span>-12h</span>
        <span>-9h</span>
        <span>-6h</span>
        <span>-3h</span>
        <span>Maintenant</span>
      </div>
    </Card>
  );
};
