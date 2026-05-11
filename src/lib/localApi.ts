// Local API helper to replace Firebase
import { io } from 'socket.io-client';

const API_BASE = '/api/db';
const socket = io();

export const localApi = {
  async getCollection(collection: string) {
    const res = await fetch(`${API_BASE}/${collection}`);
    const contentType = res.headers.get('content-type');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API Error [${res.status}]: ${text || res.statusText}`);
    }
    if (!contentType || !contentType.includes('application/json')) {
      const text = await res.text();
      throw new Error(`Expected JSON but got ${contentType || 'unknown'}: ${text.substring(0, 100)}...`);
    }
    return res.json();
  },

  async addDoc(collection: string, data: any) {
    const res = await fetch(`${API_BASE}/${collection}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const contentType = res.headers.get('content-type');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API Error [${res.status}]: ${text || res.statusText}`);
    }
    if (!contentType || !contentType.includes('application/json')) {
      const text = await res.text();
      throw new Error(`Expected JSON but got ${contentType || 'unknown'}: ${text.substring(0, 100)}...`);
    }
    return res.json();
  },

  async updateDoc(collection: string, id: string, data: any) {
    const res = await fetch(`${API_BASE}/${collection}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const contentType = res.headers.get('content-type');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API Error [${res.status}]: ${text || res.statusText}`);
    }
    if (!contentType || !contentType.includes('application/json')) {
      const text = await res.text();
      throw new Error(`Expected JSON but got ${contentType || 'unknown'}: ${text.substring(0, 100)}...`);
    }
    return res.json();
  },

  async deleteDoc(collection: string, id: string) {
    const res = await fetch(`${API_BASE}/${collection}/${id}`, {
      method: 'DELETE'
    });
    const contentType = res.headers.get('content-type');
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API Error [${res.status}]: ${text || res.statusText}`);
    }
    if (!contentType || !contentType.includes('application/json')) {
      const text = await res.text();
      throw new Error(`Expected JSON but got ${contentType || 'unknown'}: ${text.substring(0, 100)}...`);
    }
    return res.json();
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

export const loginLocal = async (pin: string) => {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });
  const contentType = res.headers.get('content-type');
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Login failed [${res.status}]: ${text || res.statusText}`);
  }
  if (!contentType || !contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Expected JSON but got ${contentType || 'unknown'}: ${text.substring(0, 100)}...`);
  }
  return res.json();
};
