import PocketBase from 'pocketbase';

const url = `http://${window.location.hostname}:8090`;
export const pb = new PocketBase(url);
