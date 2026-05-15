import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.factorycloud.app',
  appName: 'AgroSync',
  webDir: 'dist',
  server: {
    // Cette adresse permet à l'app mobile de contacter votre NUC
    url: 'http://192.168.31.109:3000',
    cleartext: true
  }
};

export default config;
