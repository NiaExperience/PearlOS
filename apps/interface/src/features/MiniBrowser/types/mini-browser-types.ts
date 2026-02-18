export interface MiniBrowserConfig {
  initialUrl: string;
  useEnhanced: boolean;
  allowScripts: boolean;
  allowSameOrigin: boolean;
}

export interface EnhancedBrowserConfig extends MiniBrowserConfig {
  enableContentScraping: boolean;
  enableVoiceNavigation: boolean;
  proxyMode: 'enhanced' | 'basic';
}

export interface ContentScrapingResult {
  title: string;
  content: string;
  metadata: {
    description?: string;
    keywords?: string[];
    author?: string;
    publishedDate?: string;
  };
  links: Array<{
    text: string;
    url: string;
  }>;
  images: Array<{
    alt: string;
    src: string;
  }>;
}

export interface VoiceNavigationCommand {
  type: 'click' | 'scroll' | 'navigate' | 'input' | 'submit';
  selector?: string;
  text?: string;
  url?: string;
  coordinates?: { x: number; y: number };
}

export interface BrowserNavigationEvent {
  type: 'url-change' | 'content-loaded' | 'error' | 'timeout';
  url: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface ProxyRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: string;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  contentType: string;
}

export interface QuickSite {
  name: string;
  patterns: string[];
  url: string;
  category: 'news' | 'social' | 'tech' | 'business' | 'entertainment';
}

export interface BrowserState {
  currentUrl: string;
  history: string[];
  isLoading: boolean;
  error: string | null;
  lastActivity: number;
}

export interface MiniBrowserProps {
  initialUrl: string;
  onUrlChange?: (url: string) => void;
  onContentLoaded?: (content: ContentScrapingResult) => void;
  onError?: (error: string) => void;
}

export interface EnhancedMiniBrowserProps extends MiniBrowserProps {
  onContentScraped?: (content: ContentScrapingResult) => void;
  onVoiceAction?: (command: VoiceNavigationCommand) => void;
  isCallActive: boolean;
  enableProxy?: boolean;
  enableScraping?: boolean;
}
