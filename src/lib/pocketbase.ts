import PocketBase from 'pocketbase';

const url = 'http://127.0.0.1:8090'; // Use 127.0.0.1 for local PocketBase accessibility
export const pb = new PocketBase(url);
