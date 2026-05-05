import type { NordriseBridge } from '../../preload';

declare global {
  interface Window {
    nordrise: NordriseBridge;
  }
}
export {};
