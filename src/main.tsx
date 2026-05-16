import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './contexts/AuthContext';
import { DataProvider } from './contexts/DataContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { ThemeProvider } from './contexts/ThemeContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <LanguageProvider>
        <DataProvider>
          <App />
        </DataProvider>
      </LanguageProvider>
    </AuthProvider>
  </StrictMode>,
);
