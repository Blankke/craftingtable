import React from 'react';
import { createRoot } from 'react-dom/client';
import './ui/themeStore';
import { App } from './ui/App';
import { SplashScreen } from './ui/SplashScreen';
import './ui/style.css';

const root = document.getElementById('root')!;
if (!window.workbench) root.textContent = '请通过 npm run dev 启动桌面应用 / Start the desktop app with npm run dev.';
else createRoot(root).render(<React.StrictMode><><SplashScreen /><App /></></React.StrictMode>);
