/**
 * Browser Automation Feature Definition
 * 
 * This feature provides automated browser control and interaction capabilities,
 * including navigation, page scraping, link clicking, and screenshot capture.
 * 
 * Pattern: Following Notes feature architecture with proper TypeScript definitions,
 * action creators, and service layer abstraction.
 */

import { z } from 'zod';

// Browser session management schemas
export const BrowserSessionSchema = z.object({
  sessionId: z.string(),
  browser: z.any(), // Puppeteer Browser instance
  page: z.any(),    // Puppeteer Page instance
  isActive: z.boolean(),
  createdAt: z.date().optional(),
  lastActivity: z.date().optional()
});

export const BrowserActionSchema = z.object({
  type: z.enum(['click', 'type', 'scroll', 'hover', 'wait']),
  selector: z.string().optional(),
  text: z.string().optional(),
  coordinates: z.object({
    x: z.number(),
    y: z.number()
  }).optional(),
  waitTime: z.number().optional()
});

// Browser automation result schemas
export const NavigationResultSchema = z.object({
  success: z.boolean(),
  screenshot: z.string().optional(),
  error: z.string().optional(),
  pageInfo: z.object({
    title: z.string(),
    url: z.string()
  }).optional()
});

export const ActionResultSchema = z.object({
  success: z.boolean(),
  screenshot: z.string().optional(),
  error: z.string().optional()
});

export const PageInfoSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
  elements: z.array(z.object({
    tag: z.string(),
    text: z.string(),
    selector: z.string()
  })),
  links: z.array(z.object({
    text: z.string(),
    url: z.string(),
    selector: z.string(),
    title: z.string().optional()
  })),
  images: z.array(z.object({
    alt: z.string(),
    src: z.string(),
    selector: z.string()
  })),
  videos: z.array(z.object({
    src: z.string(),
    title: z.string().optional(),
    selector: z.string()
  }))
});

export const LinkClickResultSchema = z.object({
  success: z.boolean(),
  clickedUrl: z.string().optional(),
  clickedText: z.string().optional(),
  error: z.string().optional(),
  screenshot: z.string().optional()
});

// Browser automation request schemas for API integration
export const CreateSessionRequestSchema = z.object({
  sessionId: z.string(),
  initialUrl: z.string().optional(),
  headless: z.boolean().optional().default(true)
});

export const NavigateRequestSchema = z.object({
  sessionId: z.string(),
  url: z.string()
});

export const PerformActionRequestSchema = z.object({
  sessionId: z.string(),
  actionData: BrowserActionSchema
});

export const FindLinkRequestSchema = z.object({
  sessionId: z.string(),
  description: z.string()
});

export const URLParseRequestSchema = z.object({
  input: z.string()
});

// System check schema
export const SystemCheckResultSchema = z.object({
  success: z.boolean(),
  system: z.object({
    platform: z.string(),
    arch: z.string(),
    nodeVersion: z.string(),
    executablePath: z.string(),
    browserExists: z.boolean(),
    launchTest: z.string(),
    env: z.record(z.string().optional())
  }).optional(),
  error: z.string().optional(),
  details: z.string().optional()
});

// Export types derived from schemas
export type BrowserSession = z.infer<typeof BrowserSessionSchema>;
export type BrowserAction = z.infer<typeof BrowserActionSchema>;
export type NavigationResult = z.infer<typeof NavigationResultSchema>;
export type ActionResult = z.infer<typeof ActionResultSchema>;
export type PageInfo = z.infer<typeof PageInfoSchema>;
export type LinkClickResult = z.infer<typeof LinkClickResultSchema>;
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;
export type NavigateRequest = z.infer<typeof NavigateRequestSchema>;
export type PerformActionRequest = z.infer<typeof PerformActionRequestSchema>;
export type FindLinkRequest = z.infer<typeof FindLinkRequestSchema>;
export type URLParseRequest = z.infer<typeof URLParseRequestSchema>;
export type SystemCheckResult = z.infer<typeof SystemCheckResultSchema>;

// Browser automation feature constants
export const BROWSER_AUTOMATION_CONSTANTS = {
  DEFAULT_TIMEOUT: 30000,
  SCREENSHOT_ENCODING: 'base64' as const,
  DEFAULT_VIEWPORT: { width: 1920, height: 1080 },
  MAX_CONTENT_LENGTH: 5000,
  MAX_ELEMENTS: 50,
  MAX_LINKS: 100,
  MAX_IMAGES: 50,
  MAX_VIDEOS: 20,
  SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes
  WEBSOCKET_PORT: 8080
} as const;

// Browser automation error types
export const BROWSER_AUTOMATION_ERRORS = {
  SESSION_NOT_FOUND: 'Session not found',
  SESSION_INACTIVE: 'Session is not active', 
  NAVIGATION_FAILED: 'Navigation failed',
  ACTION_FAILED: 'Action execution failed',
  LINK_NOT_FOUND: 'Link not found',
  BROWSER_LAUNCH_FAILED: 'Browser launch failed',
  PAGE_LOAD_TIMEOUT: 'Page load timeout',
  INVALID_SELECTOR: 'Invalid CSS selector',
  INVALID_URL: 'Invalid URL format',
  DEPENDENCIES_MISSING: 'Browser dependencies missing'
} as const;

// Browser automation capabilities
export const BROWSER_AUTOMATION_CAPABILITIES = {
  NAVIGATION: {
    directUrl: true,
    naturalLanguage: true,
    backNavigation: true,
    forwardNavigation: true,
    reload: true
  },
  INTERACTION: {
    click: true,
    type: true,
    scroll: true,
    hover: true,
    wait: true,
    drag: false // Not implemented yet
  },
  SCRAPING: {
    pageContent: true,
    pageTitle: true,
    pageUrl: true,
    allLinks: true,
    allImages: true,
    allVideos: true,
    allElements: true
  },
  AUTOMATION: {
    linkClicking: true,
    formFilling: false, // Not implemented yet
    fileDownload: false, // Not implemented yet
    authentication: false // Not implemented yet
  }
} as const;

// Export feature metadata
export const BROWSER_AUTOMATION_FEATURE = {
  name: 'BrowserAutomation',
  version: '1.0.0',
  description: 'Automated browser control and web scraping capabilities',
  capabilities: BROWSER_AUTOMATION_CAPABILITIES,
  constants: BROWSER_AUTOMATION_CONSTANTS,
  errors: BROWSER_AUTOMATION_ERRORS
} as const;
