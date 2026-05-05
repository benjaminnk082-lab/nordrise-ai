import type { BrowserWindowConstructorOptions } from 'electron';

/**
 * Frameless main window. The OS titlebar is removed so the renderer can
 * render its own (`apps/control-dev/renderer/components/Titlebar.tsx`).
 *
 * `backgroundMaterial: 'mica'` opts into Win11 Mica vibrancy. On Win10 the
 * flag is silently ignored and the solid `backgroundColor` shows through.
 * Drag region is owned by the renderer via `-webkit-app-region: drag` on
 * the titlebar root and `no-drag` on every interactive child within it.
 */
export function mainWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // Solid fallback for Win10 / display drivers that drop Mica. Warm
    // charcoal matching --bg in the v2 design tokens.
    backgroundColor: '#1c1c19',
    title: 'Nordrise Control',
    autoHideMenuBar: true,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundMaterial: 'mica',
    roundedCorners: true,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  };
}

export function miniPopupWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 600,
    height: 140,
    show: false,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#1c1c19',
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  };
}
