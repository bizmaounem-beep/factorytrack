// Local API helper to replace Firebase
import { io } from 'socket.io-client';

const API_BASE = '/api/db';
const socket = io();

export const localApi = {
  async getCollection(collection: string) {
    const res = await fetch(`${API_BASE}/${collection}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API Error [${res.status}]: ${text || res.statusText}`);
    }
    return res.json();
  },

  async addDoc(collection: string, data: any) {
    const res = await fetch(`${API_BASE}/${collection}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API Error [${res.status}]: ${text || res.statusText}`);
    }
    return res.json();
  },

  async updateDoc(collection: string, id: string, data: any) {
    const res = await fetch(`${API_BASE}/${collection}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API Error [${res.status}]: ${text || res.statusText}`);
    }
    return res.json();
  },

  async deleteDoc(collection: string, id: string) {
    const res = await fetch(`${API_BASE}/${collection}/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API Error [${res.status}]: ${text || res.statusText}`);
    }
    return res.json();
  },

  // Real-time updates with Socket.io
  onSnapshot(collection: string, callback: (docs: any[]) => void) {
    const fetchAndCallback = async () => {
      try {
        const docs = await this.getCollection(collection);
        callback(docs);
      } catch (e) {
        console.error(`Fetch error for ${collection}:`, e);
      }
    };

    // Initial fetch
    fetchAndCallback();

    // Listen for changes
    const handler = (data: { collection: string }) => {
      if (data.collection === collection) {
        fetchAndCallback();
      }
    };

    socket.on('db_change', handler);
    
    // Return unsubscribe function
    return () => {
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
  if (!res.ok) throw new Error('Login failed');
  return res.json();
};
