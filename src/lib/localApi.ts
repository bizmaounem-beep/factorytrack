// Local API helper to replace Firebase
import { io } from 'socket.io-client';
import { safeStorage } from './safeStorage';

const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

const getApiBaseUrl = () => {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  
  // Dynamic UDP discovery fallback for native Capacitor/Mobile environments
  if (typeof localStorage !== 'undefined') {
    const discoveredIp = localStorage.getItem('discovered_nuc_ip');
    if (discoveredIp) {
      console.log(`[AgroSync] Using sniffed UDP Auto-Discovered Server IP: ${discoveredIp}`);
      return `http://${discoveredIp}:3000`;
    }
  }

  if (window.location.hostname.endsWith('.run.app') || window.location.protocol === 'https:') {
    return window.location.origin;
  }
  return `http://${window.location.hostname}:3000`;
};

export const API_BASE_URL = getApiBaseUrl();
const API_BASE = `${API_BASE_URL}/api/db`;

const getHeaders = (extraHeaders = {}) => {
  const token = safeStorage.getItem('factory_token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...extraHeaders
  };
};

const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
  const res = await fetch(url, options);
  if (res.status === 401 && typeof window !== 'undefined') {
    safeStorage.removeItem('factory_token');
    safeStorage.removeItem('factory_user');
    window.location.reload();
  }
  return res;
};

const socket = io(API_BASE_URL, {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 10000,
  transports: ['websocket', 'polling'],  // try WebSocket first, fall back to polling
});

socket.on('connect_error', (err) => {
  console.warn('[Socket] Connection error, will retry:', err.message);
});

export const localApi = {
  async getCollection(collection: string) {
    try {
      const res = await fetchWithAuth(`${API_BASE}/${collection}`, {
        headers: getHeaders()
      });
      const contentType = res.headers.get('content-type');
      if (!res.ok) {
        throw new Error('Erreur de connexion');
      }
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Erreur de serveur');
      }
      return res.json();
    } catch (e) {
      console.error('API Error:', e);
      throw new Error('Erreur de connexion au serveur');
    }
  },

  async addDoc(collection: string, data: any) {
    try {
      const res = await fetchWithAuth(`${API_BASE}/${collection}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        let errMsg = 'Échec de l\'enregistrement';
        try {
          const body = await res.json();
          if (body && body.error) errMsg = body.error;
        } catch (_) {}
        throw new Error(errMsg);
      }
      return res.json();
    } catch (e) {
      console.error('API Error:', e);
      if (e instanceof Error && e.message !== 'Failed to fetch' && e.message !== 'TypeError: Failed to fetch') {
        throw e;
      }
      throw new Error('Erreur de connexion');
    }
  },

  async updateDoc(collection: string, id: string, data: any) {
    try {
      const res = await fetchWithAuth(`${API_BASE}/${collection}/${id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        let errMsg = 'Échec de la mise à jour';
        try {
          const body = await res.json();
          if (body && body.error) errMsg = body.error;
        } catch (_) {}
        throw new Error(errMsg);
      }
      return res.json();
    } catch (e) {
      console.error('API Error:', e);
      if (e instanceof Error && e.message !== 'Failed to fetch' && e.message !== 'TypeError: Failed to fetch') {
        throw e;
      }
      throw new Error('Erreur de connexion');
    }
  },

  async deleteDoc(collection: string, id: string) {
    try {
      const res = await fetchWithAuth(`${API_BASE}/${collection}/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      if (!res.ok) {
        let errMsg = 'Échec de la suppression';
        try {
          const body = await res.json();
          if (body && body.error) errMsg = body.error;
        } catch (_) {}
        throw new Error(errMsg);
      }
      return res.json();
    } catch (e) {
      console.error('API Error:', e);
      if (e instanceof Error && e.message !== 'Failed to fetch' && e.message !== 'TypeError: Failed to fetch') {
        throw e;
      }
      throw new Error('Erreur de connexion');
    }
  },

  async globalStop(machineId: string, data: any) {
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/machine/${machineId}/global-stop`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Échec de l\'arrêt global');
      return res.json();
    } catch (e) {
      console.error('API Error:', e);
      throw new Error('Erreur de connexion');
    }
  },

  async globalResume(machineId: string) {
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/machine/${machineId}/global-resume`, {
        method: 'POST',
        headers: getHeaders()
      });
      if (!res.ok) throw new Error('Échec du redémarrage global');
      return res.json();
    } catch (e) {
      console.error('API Error:', e);
      throw new Error('Erreur de connexion');
    }
  },

  async updateLineStatus(lineId: string, status: 'NOT_STARTED' | 'PRODUCTION_ACTIVE' | 'IDLE') {
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/lines/${lineId}/status`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ status })
      });
      if (!res.ok) {
        let errMsg = 'Impossible de mettre à jour le statut';
        try {
          const body = await res.json();
          if (body && body.error) errMsg = body.error;
        } catch (_) {}
        throw new Error(errMsg);
      }
      return res.json();
    } catch (e) {
      console.error('API Error:', e);
      throw e;
    }
  },

  // Real-time updates with Socket.io
  onSnapshot(collection: string, callback: (docs: any[]) => void) {
    let timeout: any = null;
    let isFetching = false;
    let pendingUpdate = false;
    
    const fetchAndCallback = async () => {
      if (isFetching) {
        pendingUpdate = true;
        return;
      }
      
      isFetching = true;
      try {
        const docs = await localApi.getCollection(collection);
        callback(docs);
      } catch (e) {
        console.error(`Fetch error for ${collection}:`, e);
        // Automatically schedule a retry in 3 seconds to auto-recover
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(fetchAndCallback, 3000);
      } finally {
        isFetching = false;
        if (pendingUpdate) {
          pendingUpdate = false;
          debouncedFetch();
        }
      }
    };

    function debouncedFetch() {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(fetchAndCallback, 50);
    }

    // Initial fetch
    fetchAndCallback();

    // Listen for changes
    const handler = (data: { collection: string }) => {
      if (data.collection === collection) {
        debouncedFetch();
      }
    };

    socket.on('db_change', handler);
    
    // Polling fallback to keep clients in sync even if sockets are blockaded
    const intervalId = setInterval(fetchAndCallback, 3000);
    
    // Return unsubscribe function
    return () => {
      if (timeout) clearTimeout(timeout);
      clearInterval(intervalId);
      socket.off('db_change', handler);
    };
  }
};

export const loginLocal = async (username: string, password: string) => {
  try {
    const res = await fetch(`${API_BASE_URL}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: username, pin: password })
    });
    if (res.status === 401) {
      throw new Error('Identifiants incorrects');
    }
    if (!res.ok) {
      throw new Error('Erreur de connexion');
    }
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error('Erreur de serveur');
    }
    const data = await res.json();
    if (data.token) {
      safeStorage.setItem('factory_token', data.token);
    }
    return data;
  } catch (e) {
    if ((e as Error).message === 'Identifiants incorrects') throw e;
    console.error('Login error:', e);
    throw new Error('Erreur de connexion');
  }
};
