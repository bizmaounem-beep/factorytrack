// Local API helper to replace Firebase
const API_BASE = '/api/db';

export const localApi = {
  async getCollection(collection: string) {
    const res = await fetch(`${API_BASE}/${collection}`);
    return res.json();
  },

  async addDoc(collection: string, data: any) {
    const res = await fetch(`${API_BASE}/${collection}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  },

  async updateDoc(collection: string, id: string, data: any) {
    const res = await fetch(`${API_BASE}/${collection}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return res.json();
  },

  async deleteDoc(collection: string, id: string) {
    const res = await fetch(`${API_BASE}/${collection}/${id}`, {
      method: 'DELETE'
    });
    return res.json();
  },

  // Mimic onSnapshot with polling
  onSnapshot(collection: string, callback: (docs: any[]) => void, interval = 2000) {
    const fetchAndCallback = async () => {
      try {
        const docs = await this.getCollection(collection);
        callback(docs);
      } catch (e) {
        console.error(`Polling error for ${collection}:`, e);
      }
    };

    fetchAndCallback();
    const id = setInterval(fetchAndCallback, interval);
    return () => clearInterval(id);
  }
};

export const loginLocal = async (name: string, pin: string) => {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, pin })
  });
  if (!res.ok) throw new Error('Login failed');
  return res.json();
};
