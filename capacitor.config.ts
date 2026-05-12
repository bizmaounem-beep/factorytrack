import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.factorycloud.app',
  appName: 'Factorycloud',
  webDir: 'dist',
  server: {
    // Cette adresse permet à l'app mobile de contacter votre NUC
    url: 'http://192.168.31.104:3000',
    cleartext: true
  }
};

export default config;
