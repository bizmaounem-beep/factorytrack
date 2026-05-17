// Local API helper to replace Firebase
import { io } from 'socket.io-client';

const API_BASE = '/api/db';
const socket = io();

export const localApi = {
  async getCollection(collection: string) {
    try {
      const res = await fetch(`${API_BASE}/${collection}`);
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
      const res = await fetch(`${API_BASE}/${collection}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        throw new Error('Échec de l\'enregistrement');
      }
      return res.json();
    } catch (e) {
      console.error('API Error:', e);
      throw new Error('Erreur de connexion');
    }
  },

  async updateDoc(collection: string, id: string, data: any) {
    try {
      const res = await fetch(`${API_BASE}/${collection}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        throw new Error('Échec de la mise à jour');
      }
      return res.json();
    } catch (e) {
      console.error('API Error:', e);
      throw new Error('Erreur de connexion');
    }
  },

  async deleteDoc(collection: string, id: string) {
    try {
      const res = await fetch(`${API_BASE}/${collection}/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        throw new Error('Échec de la suppression');
      }
      return res.json();
    } catch (e) {
      console.error('API Error:', e);
      throw new Error('Erreur de connexion');
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
    
    // Return unsubscribe function
    return () => {
      if (timeout) clearTimeout(timeout);
      socket.off('db_change', handler);
    };
  }
};

export const loginLocal = async (username: string, password: string) => {
  try {
    const res = await fetch('/api/login', {
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
    return res.json();
  } catch (e) {
    if ((e as Error).message === 'Identifiants incorrects') throw e;
    console.error('Login error:', e);
    throw new Error('Erreur de connexion');
  }
};
