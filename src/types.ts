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
}

export interface Line {
  id: string;
  machineId: string;
  name: string;
  status: LineStatus;
  currentProgrammeId?: string;
  currentOperatorId?: string;
  activeDowntimeId?: string;
}

export interface Programme {
  id: string;
  name: string;
  machineId: string;
  lineId: string;
  targetPallets: number;
  producedPallets: number;
  status: 'ACTIVE' | 'FINISHED';
  createdAt: string;
}

export interface DowntimeType {
  id: string;
  name: string;
  icon?: string;
}

export interface ProductionLog {
  id: string;
  programmeId: string;
  operatorId: string;
  machineId: string;
  lineId: string;
  count: number;
  timestamp: string;
}

export interface DowntimeLog {
  id: string;
  machineId: string;
  lineId: string;
  typeId: string;
  operatorId: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  description?: string;
}
