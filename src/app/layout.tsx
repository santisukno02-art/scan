import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'BOXCHECK | ตรวจรับสินค้า', description: 'ระบบตรวจสอบและตรวจรับกล่องสินค้าจากใบโอน' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="th"><body>{children}</body></html>; }
