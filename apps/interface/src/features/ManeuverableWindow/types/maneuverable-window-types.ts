export type WindowLayout = 
    | 'normal'      // Single window, centered
    | 'maximized'   // Single window, fullscreen
    | 'left'        // Single window, left half
    | 'right'       // Single window, right half
    | 'grid-2'      // 2 windows side-by-side
    | 'grid-3'      // 3 windows (1 left + 2 right stacked)
    | 'grid-4';     // 4 windows (2x2 grid)

export type GridPosition = 
    | 'full'           // 1 window - takes entire space
    | 'left'           // 2 windows - left half (desktop)
    | 'right'          // 2 windows - right half (desktop)
    | 'top'            // 2 windows - top half (mobile)
    | 'bottom'         // 2 windows - bottom half (mobile)
    | 'left-full'      // 3 windows - left half (full height) (desktop)
    | 'top-right'      // 3 windows - top right quarter (desktop)
    | 'bottom-right'   // 3 windows - bottom right quarter (desktop)
    | 'top-third'      // 3 windows - top third (mobile)
    | 'middle-third'   // 3 windows - middle third (mobile)
    | 'bottom-third'   // 3 windows - bottom third (mobile)
    | 'top-left'       // 4 windows - top left quarter
    | 'top-right-quad' // 4 windows - top right quarter
    | 'bottom-left'    // 4 windows - bottom left quarter
    | 'bottom-right-quad'; // 4 windows - bottom right quarter

export type ViewType = 
    | 'contentList'
    | 'contentDetail'
    | 'youtube'
    | 'googleDrive'
    | 'gmail'
    | 'notes'
    | 'terminal'
    | 'miniBrowser'
    | 'enhancedBrowser'
    | 'htmlContent'
    | 'canvas'
    | 'dailyCall'
    | 'photoMagic'
    | 'files'
    | 'sprites'
    | null;

export interface WindowInstance {
    id: string;                    // Unique identifier
    viewType: ViewType;           // Type of view being displayed
    gridPosition: GridPosition;   // Current grid position
    zIndex: number;               // For potential future overlapping
    
    // View-specific state (only populate relevant fields based on viewType)
    viewState?: {
        // YouTube
        youtubeQuery?: string;
        
        // Browser
        browserUrl?: string;
        enhancedBrowserUrl?: string;
        enhancedKey?: number;
        
        // HTML Content
        htmlContentData?: {
            id: string;
            title: string;
            htmlContent: string;
            contentType: 'game' | 'app' | 'tool' | 'interactive';
            cssContent?: string;
            jsContent?: string;
        };
        isHtmlContentFullscreen?: boolean;
        
        // Content List/Detail
        contentType?: string;
        contentId?: string;
        contentQuery?: any;
        
        // Add other view-specific states as needed
    };
}

export interface MultiWindowState {
    windows: WindowInstance[];
    activeWindowId: string | null;
    isMinimized: boolean;
    wasMinimized: boolean;
}

export interface ManeuverableWindowState {
    isVisible: boolean;
    wasMinimized: boolean;
    windowLayout: WindowLayout;
}

export type WindowControlAction =
    | 'minimize'
    | 'maximize'
    | 'restore'
    | 'snap-left'
    | 'snap-right'
    | 'center'
    | 'close'
    | 'none';


