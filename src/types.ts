export type UserRole = 'OPERATOR' | 'PILOT' | 'ADMIN';
export type LineStatus = 'IDLE' | 'RUNNING' | 'STOPPED';

export interface User {
  id: string;
  name: string;
  pin: string;
  role: UserRole;
}

export interface Machine {
  id: string;
  name: string;
  currentPilotId?: string;
  productionStart?: string;
  productionEnd?: string;
}

export interface Line {
  id: string;
  machineId: string;
  name: string;
  status: LineStatus;
  currentProgrammeId?: string;
  currentOperatorId?: string;
  activeDowntimeId?: string;
  tracksProduction: boolean | number;
  isActive?: boolean | number;
}

export interface Programme {
  id: string;
  name: string;
  machineId: string;
  lineId: string;
  producedPallets: number;
  status: 'ACTIVE' | 'FINISHED';
  createdAt: string;
  parameters?: string;
}

export interface Shift {
  id: string;
  name: string;
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
}

export interface DowntimeType {
  id: string;
  name: string;
  icon?: string;
  applyToAll?: number | boolean;
}

export interface ProductionLog {
  id: string;
  programmeId: string;
  operatorId: string;
  machineId: string;
  lineId: string;
  shiftId?: string;
  count: number;
  timestamp: string;
}

export interface DowntimeLog {
  id: string;
  machineId: string;
  lineId: string;
  typeId: string;
  operatorId: string;
  shiftId?: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  description?: string;
  images?: string[];
  season_id?: number;
}

export interface Season {
  id: number;
  name: string;
  status: 'ACTIVE' | 'ARCHIVED';
  started_at: string;
  ended_at?: string;
}
