import React from 'react';
import { createRoot } from 'react-dom/client';
import './ui/theme/themeStore';
import { App } from './ui/App';
import { SplashScreen } from './ui/home/SplashScreen';
import './ui/styles/style.css';
import './ui/styles/workspace.css';

const root = document.getElementById('root')!;
if (!window.workbench) root.textContent = '请通过 npm run dev 启动桌面应用 / Start the desktop app with npm run dev.';
else createRoot(root).render(<React.StrictMode><><SplashScreen /><App /></></React.StrictMode>);
