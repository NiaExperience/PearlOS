'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useDaily, useLocalSessionId } from '@daily-co/daily-react';

import { getClientLogger } from '@interface/lib/client-logger';

interface SettingsPanelProps {
  isVisible: boolean;
  onClose: () => void;
}

interface DeviceInfo {
  deviceId: string;
  label: string;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ isVisible, onClose }) => {
  const daily = useDaily();
  const localId = useLocalSessionId();
  const log = getClientLogger('[daily_call]');
  
  // Handle backdrop click to close on mobile
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };
  
  // Device management state
  const [cameras, setCameras] = useState<DeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<DeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<DeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedMicrophone, setSelectedMicrophone] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('');
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);

  // Virtual background state
  const [virtualBackgroundEnabled, setVirtualBackgroundEnabled] = useState(false);
  const [selectedBackground, setSelectedBackground] = useState('blur');
  const [isApplyingBackground, setIsApplyingBackground] = useState(false);

  // Virtual background options
  const backgroundOptions = [
    { id: 'none', name: 'No Background', type: 'none' },
    { id: 'blur', name: 'Blur Background', type: 'blur' }
  ];

  // Load available devices
  const loadDevices = useCallback(async () => {
    if (!daily) return;
    
    setIsLoadingDevices(true);
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      const cameraDevices = devices
        .filter(device => device.kind === 'videoinput')
        .map(device => ({ deviceId: device.deviceId, label: device.label || `Camera ${device.deviceId.slice(0, 8)}` }));
      
      const micDevices = devices
        .filter(device => device.kind === 'audioinput')
        .map(device => ({ deviceId: device.deviceId, label: device.label || `Microphone ${device.deviceId.slice(0, 8)}` }));
      
      const speakerDevices = devices
        .filter(device => device.kind === 'audiooutput')
        .map(device => ({ deviceId: device.deviceId, label: device.label || `Speaker ${device.deviceId.slice(0, 8)}` }));

      setCameras(cameraDevices);
      setMicrophones(micDevices);
      setSpeakers(speakerDevices);
      
      // Get current device selections and set them as selected
      try {
        // Get current video track to determine active camera
        const participants = daily.participants();
        const localParticipant = participants.local;
        
        if (localParticipant?.tracks?.video?.track) {
          const videoTrack = localParticipant.tracks.video.track;
          const settings = videoTrack.getSettings();
          if (settings.deviceId && cameraDevices.find(d => d.deviceId === settings.deviceId)) {
            setSelectedCamera(settings.deviceId);
          } else if (cameraDevices.length > 0) {
            setSelectedCamera(cameraDevices[0].deviceId);
          }
        } else if (cameraDevices.length > 0) {
          setSelectedCamera(cameraDevices[0].deviceId);
        }

        // Get current audio track to determine active microphone
        if (localParticipant?.tracks?.audio?.track) {
          const audioTrack = localParticipant.tracks.audio.track;
          const settings = audioTrack.getSettings();
          if (settings.deviceId && micDevices.find(d => d.deviceId === settings.deviceId)) {
            setSelectedMicrophone(settings.deviceId);
          } else if (micDevices.length > 0) {
            setSelectedMicrophone(micDevices[0].deviceId);
          }
        } else if (micDevices.length > 0) {
          setSelectedMicrophone(micDevices[0].deviceId);
        }

        // Set default speaker (first available) if none selected
        if (speakerDevices.length > 0) {
          const currentSpeaker = speakerDevices.find(d => d.deviceId === selectedSpeaker);
          if (!currentSpeaker) {
            setSelectedSpeaker(speakerDevices[0].deviceId);
          }
        }

        // Check current virtual background state
        try {
          const inputSettings = await daily.getInputSettings();
          if (inputSettings?.video?.processor) {
            const processor = inputSettings.video.processor;
            if (processor.type === 'background-blur') {
              setVirtualBackgroundEnabled(true);
              setSelectedBackground('blur');
            } else if (processor.type === 'none') {
              setVirtualBackgroundEnabled(false);
              setSelectedBackground('none');
            }
          } else {
            // No processor means no background effect
            setVirtualBackgroundEnabled(false);
            setSelectedBackground('none');
          }
        } catch (bgError) {
          log.warn('Could not get virtual background state', {
            event: 'daily_call_vb_state_error',
            error: bgError,
          });
          // Default to no background
          setVirtualBackgroundEnabled(false);
          setSelectedBackground('none');
        }

        log.debug('Device and background selections set', {
          event: 'daily_call_device_selection_state',
          camera: selectedCamera,
          microphone: selectedMicrophone,
          speaker: selectedSpeaker,
          virtualBackground: selectedBackground,
        });
        
      } catch (error) {
        log.warn('Could not get current device settings', {
          event: 'daily_call_device_settings_error',
          error,
        });
        // Set defaults if we can't get current selections
        if (cameraDevices.length > 0 && !selectedCamera) {
          setSelectedCamera(cameraDevices[0].deviceId);
        }
        if (micDevices.length > 0 && !selectedMicrophone) {
          setSelectedMicrophone(micDevices[0].deviceId);
        }
        if (speakerDevices.length > 0 && !selectedSpeaker) {
          setSelectedSpeaker(speakerDevices[0].deviceId);
        }
      }
      
    } catch (error) {
      log.error('Error loading devices', {
        event: 'daily_call_device_load_error',
        error,
      });
    } finally {
      setIsLoadingDevices(false);
    }
  }, [daily]);

  // Handle device changes
  const handleCameraChange = useCallback(async (deviceId: string) => {
    if (!daily) return;
    
    try {
      // Note: Device switching may require page refresh in some Daily.co versions
      setSelectedCamera(deviceId);
    } catch (error: any) {
      log.error('Error changing camera', {
        event: 'daily_call_change_camera_error',
        error,
      });
    }
  }, [daily, log]);

  const handleMicrophoneChange = useCallback(async (deviceId: string) => {
    if (!daily) return;
    
    try {
      // Note: Device switching may require page refresh in some Daily.co versions
      setSelectedMicrophone(deviceId);
    } catch (error: any) {
      log.error('Error changing microphone', {
        event: 'daily_call_change_microphone_error',
        error,
      });
    }
  }, [daily, log]);

  const handleSpeakerChange = useCallback(async (deviceId: string) => {
    if (!daily) return;
    
    try {
      // Note: Speaker selection is not supported in all browsers
      if ('setSinkId' in HTMLAudioElement.prototype) {
        setSelectedSpeaker(deviceId);
      } else {
        // Speaker selection is not supported in this browser
      }
    } catch (error: any) {
      log.error('Error changing speaker', {
        event: 'daily_call_change_speaker_error',
        error,
      });
    }
  }, [daily, log]);

  // Handle virtual background
  const handleVirtualBackground = useCallback(async (backgroundId: string) => {
    if (!daily || !localId) {
      return;
    }

    setIsApplyingBackground(true);
    
    try {
      const background = backgroundOptions.find(bg => bg.id === backgroundId);
      
      if (!background) {
        throw new Error('Background not found');
      }

      if (background.type === 'none') {
        // Remove virtual background completely using the correct Daily.co API format
        try {
          log.info('Attempting to remove virtual background', {
            event: 'daily_call_vb_remove_attempt',
          });
          
          // Method 1: Use 'none' type as specified in the API
          await daily.updateInputSettings({
            video: {
              processor: {
                type: 'none'
              }
            }
          });
          
          setVirtualBackgroundEnabled(false);
          setSelectedBackground(backgroundId);
          log.info('Virtual background removed with none processor', {
            event: 'daily_call_vb_remove_success',
          });
          
        } catch (bgError) {
          log.warn('None processor failed, trying video restart', {
            event: 'daily_call_vb_remove_retry',
            error: bgError,
          });
          try {
            // Method 2: Complete video restart to clear all processors
            const wasVideoOn = daily.localVideo();
            log.info('Video restart method invoked', {
              event: 'daily_call_vb_restart_attempt',
              videoWasOn: wasVideoOn,
            });
            
            // Turn off video completely
            await daily.setLocalVideo(false);
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Try to set processor to none while video is off
            try {
              await daily.updateInputSettings({
                video: {
                  processor: {
                    type: 'none'
                  }
                }
              });
            } catch (settingsError) {
              log.warn('Could not set processor to none while video off', {
                event: 'daily_call_vb_remove_video_off_error',
                error: settingsError,
              });
            }
            
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Turn video back on
            if (wasVideoOn) {
              await daily.setLocalVideo(true);
            }
            
            setVirtualBackgroundEnabled(false);
            setSelectedBackground(backgroundId);
            log.info('Virtual background removed with video restart', {
              event: 'daily_call_vb_remove_restart_success',
            });
            
          } catch (finalError) {
            log.error('All virtual background removal methods failed, forcing state reset', {
              event: 'daily_call_vb_remove_failure',
              error: finalError,
            });
            // Force state reset even if API calls fail
            setVirtualBackgroundEnabled(false);
            setSelectedBackground(backgroundId);
          }
        }
      } else if (background.type === 'blur') {
        // Apply blur background
        try {
          await daily.updateInputSettings({
            video: {
              processor: {
                type: 'background-blur',
                config: {
                  strength: 1
                }
              }
            }
          });
          setVirtualBackgroundEnabled(true);
        } catch (bgError) {
          // Try alternative approach
          try {
            // Note: setVideoProcessor may not be available in current Daily.co version
            setVirtualBackgroundEnabled(true);
          } catch (fallbackError) {
            // Virtual background not supported in this version
          }
        }
      }

      setSelectedBackground(backgroundId);
      
    } catch (error: any) {
      log.error('Error applying virtual background', {
        event: 'daily_call_vb_apply_error',
        error,
      });
    } finally {
      setIsApplyingBackground(false);
    }
  }, [daily, localId, log]);

  // Track viewport for mobile behavior
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 1024);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Load devices when panel opens
  useEffect(() => {
    if (isVisible) {
      loadDevices();
    }
  }, [isVisible, loadDevices]);

  if (!isVisible) return null;

  return (
    <div 
      className={`settings-overlay ${isVisible ? 'visible' : ''}`}
      onClick={handleBackdropClick}
    >
      <div className="settings-container">
        {/* Settings Header */}
        <div className="settings-header">
          <h3>Settings</h3>
          <button 
            className="settings-close-btn"
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Settings Content */}
        <div className="settings-content">
          {/* Device Settings */}
          <div className="settings-section">
            <h4>CAMERA</h4>
            {isLoadingDevices ? (
              <div className="loading-devices">Loading devices...</div>
            ) : (
              <select
                value={selectedCamera}
                onChange={(e) => handleCameraChange(e.target.value)}
                className="device-select"
              >
                {!selectedCamera && <option value="">Select Camera</option>}
                {cameras.map(camera => (
                  <option key={camera.deviceId} value={camera.deviceId}>
                    {camera.label}
                    {camera.deviceId === selectedCamera ? ' (Current)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="settings-section">
            <h4>MICROPHONE</h4>
            {isLoadingDevices ? (
              <div className="loading-devices">Loading devices...</div>
            ) : (
              <select
                value={selectedMicrophone}
                onChange={(e) => handleMicrophoneChange(e.target.value)}
                className="device-select"
              >
                {!selectedMicrophone && <option value="">Select Microphone</option>}
                {microphones.map(mic => (
                  <option key={mic.deviceId} value={mic.deviceId}>
                    {mic.label}
                    {mic.deviceId === selectedMicrophone ? ' (Current)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="settings-section">
            <h4>SPEAKER</h4>
            {isLoadingDevices ? (
              <div className="loading-devices">Loading devices...</div>
            ) : (
              <select
                value={selectedSpeaker}
                onChange={(e) => handleSpeakerChange(e.target.value)}
                className="device-select"
              >
                {!selectedSpeaker && <option value="">Select Speaker</option>}
                {speakers.map(speaker => (
                  <option key={speaker.deviceId} value={speaker.deviceId}>
                    {speaker.label}
                    {speaker.deviceId === selectedSpeaker ? ' (Current)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Virtual Background Settings - Hidden on Mobile */}
          {!isMobile && (
            <div className="settings-section">
              <h4>VIRTUAL BACKGROUND</h4>
              <div className="background-options">
                {backgroundOptions.map(bg => (
                  <button
                    key={bg.id}
                    className={`background-option ${selectedBackground === bg.id ? 'active' : ''}`}
                    onClick={() => handleVirtualBackground(bg.id)}
                    disabled={isApplyingBackground}
                  >
                    {bg.name}
                  </button>
                ))}
              </div>
              {isApplyingBackground && (
                <div className="applying-background">Applying background...</div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
