import React, { createContext, useContext, useState, useEffect } from 'react';
import { localApi } from '../lib/localApi';
import { 
  Machine, Line, Programme, User, DowntimeType, 
  ProductionLog, DowntimeLog, Shift 
} from '../types';

interface DataContextType {
  machines: Machine[];
  lines: Line[];
  users: User[];
  downtimeTypes: DowntimeType[];
  programmes: Programme[];
  shifts: Shift[];
  productionLogs: ProductionLog[];
  downtimeLogs: DowntimeLog[];
  loading: boolean;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [downtimeTypes, setDowntimeTypes] = useState<DowntimeType[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [productionLogs, setProductionLogs] = useState<ProductionLog[]>([]);
  const [downtimeLogs, setDowntimeLogs] = useState<DowntimeLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Single set of listeners for the whole app
    const unsubMachines = localApi.onSnapshot('machines', (data) => {
      setMachines(data);
      setLoading(false);
    });
    const unsubLines = localApi.onSnapshot('lines', setLines);
    const unsubUsers = localApi.onSnapshot('users', setUsers);
    const unsubTypes = localApi.onSnapshot('downtime_types', setDowntimeTypes);
    const unsubProgs = localApi.onSnapshot('programmes', setProgrammes);
    const unsubShifts = localApi.onSnapshot('shifts', setShifts);
    const unsubProd = localApi.onSnapshot('production_logs', setProductionLogs);
    const unsubDown = localApi.onSnapshot('downtime_logs', setDowntimeLogs);

    return () => {
      unsubMachines();
      unsubLines();
      unsubUsers();
      unsubTypes();
      unsubProgs();
      unsubShifts();
      unsubProd();
      unsubDown();
    };
  }, []);

  const value = React.useMemo(() => ({
    machines,
    lines,
    users,
    downtimeTypes,
    programmes,
    shifts,
    productionLogs,
    downtimeLogs,
    loading
  }), [machines, lines, users, downtimeTypes, programmes, shifts, productionLogs, downtimeLogs, loading]);

  return (
    <DataContext.Provider value={value}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
}
