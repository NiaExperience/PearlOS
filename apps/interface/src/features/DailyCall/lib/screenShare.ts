/**
 * Screen sharing utilities and permission helpers
 */

/**
 * Check if screen sharing is supported in the current browser
 */
export function isScreenShareSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
}

/**
 * Check if we're in a secure context required for screen sharing
 */
export function isSecureContext() {
  return window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

/**
 * Get user-friendly error message for screen sharing failures
 */
export function getScreenShareErrorMessage(error: any) {
  if (!error) return 'Unknown screen sharing error';
  
  const errorMessage = error.message || error.toString();
  
  if (errorMessage.includes('Permission denied') || errorMessage.includes('NotAllowedError')) {
    return 'Screen sharing permission was denied. Please allow screen sharing when prompted and try again.';
  }
  
  if (errorMessage.includes('NotFoundError')) {
    return 'No screen available to share. Make sure you have a display connected.';
  }
  
  if (errorMessage.includes('NotSupportedError')) {
    return 'Screen sharing is not supported in this browser. Please use Chrome, Firefox, or Safari.';
  }
  
  if (errorMessage.includes('NotReadableError')) {
    return 'Screen sharing is blocked by your system or another application.';
  }
  
  if (errorMessage.includes('AbortError')) {
    return 'Screen sharing was cancelled.';
  }
  
  if (errorMessage.includes('HTTPS') || !isSecureContext()) {
    return 'Screen sharing requires a secure connection (HTTPS) or localhost.';
  }
  
  return `Screen sharing failed: ${errorMessage}`;
}

/**
 * Recommended screen sharing options with audio support
 */
export const SCREEN_SHARE_OPTIONS = {
  mediaConstraints: {
    video: {
      displaySurface: 'monitor', // 'monitor', 'window', 'application'
      logicalSurface: true,
      cursor: 'always' // 'always', 'motion', 'never'
    },
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  }
};

/**
 * Alternative screen sharing options for different use cases
 */
export const SCREEN_SHARE_PRESETS = {
  // Best quality for presentations
  presentation: {
    mediaConstraints: {
      video: {
        displaySurface: 'monitor',
        logicalSurface: true,
        cursor: 'always',
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    }
  },
  
  // Optimized for application sharing
  application: {
    mediaConstraints: {
      video: {
        displaySurface: 'application',
        logicalSurface: true,
        cursor: 'motion',
        frameRate: { ideal: 15 }
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    }
  },
  
  // Optimized for window sharing
  window: {
    mediaConstraints: {
      video: {
        displaySurface: 'window',
        logicalSurface: true,
        cursor: 'motion',
        frameRate: { ideal: 15 }
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    }
  }
};
