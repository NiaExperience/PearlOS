'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

export const LazyDailyCallClientManager = dynamic(
  () => import('@interface/features/DailyCall/components/ClientManager'),
  { ssr: false }
);

export const LazyBrowserWindow: ComponentType<any> = dynamic(
  () => import('@interface/components/browser-window'),
  { ssr: false }
);

export const LazyChatMode = dynamic(
  () => import('@interface/features/ChatMode/components/ChatMode'),
  { ssr: false }
);

export const LazyFileDropZone = dynamic(
  () => import('@interface/components/FileDropZone'),
  { ssr: false }
);
