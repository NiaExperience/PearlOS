'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import { getClientLogger } from '@interface/lib/client-logger';

// import { Brain, Gem, Sparkles } from 'lucide-react';

type Provider = 'openai' | 'anthropic' | 'gemini';

interface TaskbarModelSelectorProps {
  providers?: Record<Provider, string[]>;
  onModelSelect?: (provider: Provider, model: string) => void; // Optional - for backward compatibility
  selectedModelInfo?: { provider: Provider; model: string } | null; // Optional - will use session storage instead
}

const ProviderIcon = ({ p, className }: { p: Provider, className?: string }) => {
    // if (p === 'openai') return <Sparkles className={className || "h-5 w-5"} />;
    // if (p === 'anthropic') return <Brain className={className || "h-5 w-5"} />;
    // if (p === 'gemini') return <Gem className={className || "h-5 w-5"} />;
    return null;
};

const ProviderConfig = {
  openai: {
    name: 'OpenAI',
    color: 'from-green-500 to-emerald-600',
    hoverColor: 'from-green-400 to-emerald-500',
    lightColor: 'bg-green-500/10',
    borderColor: 'border-green-400/20',
    glowColor: 'rgba(34, 197, 94, 0.4)',
    description: 'Fast & Creative',
    bgAccent: 'bg-green-500/20'
  },
  anthropic: {
    name: 'Claude',
    color: 'from-orange-500 to-amber-600',
    hoverColor: 'from-orange-400 to-amber-500',
    lightColor: 'bg-orange-500/10',
    borderColor: 'border-orange-400/20',
    glowColor: 'rgba(251, 146, 60, 0.4)',
    description: 'Deep Reasoning',
    bgAccent: 'bg-orange-500/20'
  },
  gemini: {
    name: 'Gemini',
    color: 'from-blue-500 to-purple-600',
    hoverColor: 'from-blue-400 to-purple-500',
    lightColor: 'bg-blue-500/10',
    borderColor: 'border-blue-400/20',
    glowColor: 'rgba(59, 130, 246, 0.4)',
    description: 'Multi-Modal',
    bgAccent: 'bg-blue-500/20'
  }
};

export default function TaskbarModelSelector({ providers, onModelSelect, selectedModelInfo }: TaskbarModelSelectorProps) {
  const logger = getClientLogger('[taskbar_model_selector]');
  // Use fallback data if providers is empty or undefined
  const safeProviders = providers && Object.keys(providers).length > 0 ? providers : getDefaultProvidersData();
  
  // Session storage keys
  const SESSION_PROVIDER_KEY = 'taskbar_selected_provider';
  const SESSION_MODEL_KEY = 'taskbar_selected_model';
  
  // Initialize from session storage with anthropic/claude as default
  const getInitialProvider = (): Provider => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem(SESSION_PROVIDER_KEY) as Provider;
      if (stored && ['openai', 'anthropic', 'gemini'].includes(stored)) {
        return stored;
      }
    }
    return 'anthropic'; // Default to anthropic
  };
  
  const getInitialModel = (): string => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem(SESSION_MODEL_KEY);
      if (stored) {
        return stored;
      }
    }
    return 'claude-sonnet-4-20250514'; // Default to claude sonnet 4
  };
  
  const [selectedProvider, setSelectedProvider] = useState<Provider>(getInitialProvider());
  const [selectedModel, setSelectedModel] = useState<string>(getInitialModel());
  const [expandedProvider, setExpandedProvider] = useState<Provider | null>(null);
  const [hoveredProvider, setHoveredProvider] = useState<Provider | null>(null);
  const [justSelected, setJustSelected] = useState(false);

  // Sync with session storage on mount and expose current selection globally
  useEffect(() => {
    // Ensure the current selection is available globally
    if (typeof window !== 'undefined') {
      // Update session storage with current values
      sessionStorage.setItem(SESSION_PROVIDER_KEY, selectedProvider);
      sessionStorage.setItem(SESSION_MODEL_KEY, selectedModel);
      
      (window as any).getCurrentModelSelection = () => ({
        provider: selectedProvider,
        model: selectedModel
      });
      
      logger.info('TaskbarModelSelector initialized', {
        provider: selectedProvider,
        model: selectedModel,
      });
    }
  }, [selectedProvider, selectedModel]);

  // Function to detect dropdown direction based on taskbar position
  const getDropdownDirection = () => {
    if (typeof window === 'undefined') return 'down';
    
    // Check if the taskbar is in the lower half of the screen
    const taskbarElement = document.querySelector('[class*="taskbar"]') || 
                          document.querySelector('[class*="DesktopTaskbar"]') ||
                          document.querySelector('.desktop-taskbar');
    
    if (taskbarElement) {
      const rect = taskbarElement.getBoundingClientRect();
      const screenHeight = window.innerHeight;
      const taskbarCenter = rect.top + rect.height / 2;
      
      // If taskbar is in the bottom half, open dropdown upward
      return taskbarCenter > screenHeight / 2 ? 'up' : 'down';
    }
    
    // Default fallback - assume taskbar is at bottom
    return 'up';
  };

  // Update local state when props change
  useEffect(() => {
    if (selectedModelInfo) {
      setSelectedProvider(selectedModelInfo.provider);
      setSelectedModel(selectedModelInfo.model);
    }
  }, [selectedModelInfo]);

  const handleProviderClick = (provider: Provider) => {
    if (expandedProvider === provider) {
      setExpandedProvider(null);
    } else {
      setExpandedProvider(provider);
    }
  };

    const handleModelSelect = (provider: Provider, model: string) => {
    setSelectedProvider(provider);
    setSelectedModel(model);
    
    // Save to session storage
    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SESSION_PROVIDER_KEY, provider);
      sessionStorage.setItem(SESSION_MODEL_KEY, model);
    }
    
    logger.info('Taskbar model selected', { provider, model });
    
    // Optional: Still call the prop function if provided (for backward compatibility)
    if (typeof onModelSelect === 'function') {
      try {
        onModelSelect(provider, model);
      } catch (error) {
        logger.error('Error calling onModelSelect', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    
    // Dispatch custom event for other components to listen to
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('modelSelectionChanged', {
        detail: { provider, model }
      }));
    }
    
    // Trigger selection effects
    setJustSelected(true);
    setExpandedProvider(null); // Close after selection
    
    // Reset effects after animation
    setTimeout(() => {
      setJustSelected(false);
    }, 1000);
  };

  // return (
  //   <div className="flex items-center gap-1">
  //     {/* Provider Buttons */}
  //     {(['openai', 'anthropic', 'gemini'] as Provider[]).map((provider) => {
  //       const config = ProviderConfig[provider];
  //       const isSelected = selectedProvider === provider;
  //       const isExpanded = expandedProvider === provider;
  //       const isHovered = hoveredProvider === provider;

  //       return (
  //         <div key={provider} className="relative">
  //           {/* Provider Button */}
  //           <motion.button
  //             onClick={() => handleProviderClick(provider)}
  //             onMouseDown={(e) => e.stopPropagation()}
  //             onPointerDown={(e) => e.stopPropagation()}
  //             onMouseEnter={() => setHoveredProvider(provider)}
  //             onMouseLeave={() => setHoveredProvider(null)}
  //             className={`relative w-10 h-10 rounded-lg transition-all duration-300 backdrop-blur-md border overflow-hidden ${
  //               isSelected 
  //                 ? `bg-gradient-to-br ${config.color} border-white/20 shadow-lg` 
  //                 : `${config.lightColor} ${config.borderColor} hover:bg-gradient-to-br hover:${config.hoverColor}`
  //             }`}
  //             whileHover={{ 
  //               scale: 1.1,
  //               y: -2,
  //               boxShadow: `0 8px 25px ${config.glowColor}`,
  //             }}
  //             whileTap={{ scale: 0.95 }}
  //             animate={{
  //               boxShadow: [
  //                 isSelected ? `0 4px 15px ${config.glowColor}` : "0 2px 8px rgba(0, 0, 0, 0.1)",
  //                 justSelected && isSelected ? `0 0 25px ${config.glowColor}` : undefined
  //               ].filter(Boolean),
  //               scale: justSelected && isSelected ? [1, 1.15, 1] : 1,
  //             }}
  //             transition={{
  //               boxShadow: { duration: justSelected ? 0.6 : 0.3 },
  //               scale: { duration: 0.4, times: [0, 0.5, 1] }
  //             }}
  //           >
  //             {/* Background Glow Effect */}
  //             <AnimatePresence>
  //               {(isSelected || isHovered) && (
  //                 <motion.div
  //                   className={`absolute inset-0 bg-gradient-to-br ${config.color} opacity-20 rounded-lg`}
  //                   initial={{ opacity: 0, scale: 0.8 }}
  //                   animate={{ opacity: isSelected ? 0.3 : 0.15, scale: 1 }}
  //                   exit={{ opacity: 0, scale: 0.8 }}
  //                   transition={{ duration: 0.2 }}
  //                 />
  //               )}
  //             </AnimatePresence>

  //             {/* Icon */}
  //             <motion.div
  //               className="relative z-10 w-full h-full flex items-center justify-center"
  //               animate={{ 
  //                 scale: justSelected && isSelected ? [1, 1.3, 1] : 1,
  //                 rotate: justSelected && isSelected ? [0, 180, 360] : 0 
  //               }}
  //               transition={{ duration: 0.6 }}
  //             >
  //               <ProviderIcon 
  //                 p={provider} 
  //                 className={`h-5 w-5 ${isSelected ? 'text-white' : 'text-white/70'}`} 
  //               />
  //             </motion.div>

  //             {/* Selection Indicator */}
  //             {isSelected && (
  //               <motion.div
  //                 className="absolute bottom-1 left-1/2 transform -translate-x-1/2 w-1 h-1 bg-white rounded-full"
  //                 initial={{ scale: 0 }}
  //                 animate={{ scale: 1 }}
  //                 transition={{ delay: 0.1, type: "spring", stiffness: 400 }}
  //               />
  //             )}

  //             {/* Expansion Indicator */}
  //             {isExpanded && (
  //               <motion.div
  //                 className="absolute top-1 right-1 w-2 h-2 bg-white/60 rounded-full"
  //                 initial={{ scale: 0, opacity: 0 }}
  //                 animate={{ scale: 1, opacity: 1 }}
  //                 exit={{ scale: 0, opacity: 0 }}
  //                 transition={{ duration: 0.2 }}
  //               />
  //             )}
  //           </motion.button>

  //           {/* Model Dropdown - Simplified */}
  //           <AnimatePresence>
  //             {isExpanded && (
  //               <motion.div
  //                 initial={{ opacity: 0, y: getDropdownDirection() === 'up' ? 5 : -5, scale: 0.9 }}
  //                 animate={{ opacity: 1, y: 0, scale: 1 }}
  //                 exit={{ opacity: 0, y: getDropdownDirection() === 'up' ? 5 : -5, scale: 0.9 }}
  //                 transition={{ duration: 0.15, ease: "easeOut" }}
  //                 className={`absolute ${getDropdownDirection() === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'} left-0 min-w-[180px] bg-gray-900/95 backdrop-blur-xl border border-gray-700/50 rounded-lg shadow-xl z-50 overflow-hidden`}
  //               >
  //                 {/* Simple Models List */}
  //                 <div className="py-1">
  //                   {safeProviders[provider]?.map((model, index) => {
  //                     const isModelSelected = selectedProvider === provider && selectedModel === model;
                      
  //                     return (
  //                       <motion.button
  //                         key={model}
  //                         onClick={() => handleModelSelect(provider, model)}
  //                         className={`w-full px-3 py-2 text-left transition-all duration-200 ${
  //                           isModelSelected 
  //                             ? `bg-gradient-to-r ${config.color} text-white` 
  //                             : 'text-gray-300 hover:bg-gray-700/50 hover:text-white'
  //                         }`}
  //                         whileTap={{ scale: 0.98 }}
  //                         initial={{ opacity: 0 }}
  //                         animate={{ opacity: 1 }}
  //                         transition={{ delay: index * 0.02 }}
  //                       >
  //                         <span className="font-medium text-sm">{model}</span>
  //                       </motion.button>
  //                     );
  //                   })}
  //                 </div>
  //               </motion.div>
  //             )}
  //           </AnimatePresence>
  //         </div>
  //       );
  //     })}

  //     {/* Backdrop */}
  //     <AnimatePresence>
  //       {expandedProvider && (
  //         <motion.div
  //           initial={{ opacity: 0 }}
  //           animate={{ opacity: 1 }}
  //           exit={{ opacity: 0 }}
  //           className="fixed inset-0 z-40"
  //           onClick={() => setExpandedProvider(null)}
  //         />
  //       )}
  //     </AnimatePresence>
  //   </div>
  // );
  return null;
}

// Helper function to get default models when providers data is not available
function getDefaultModelForProvider(provider: Provider): string {
  const defaults = {
    openai: 'gpt-5',
    anthropic: 'claude-sonnet-4-20250514', 
    gemini: 'gemini-2.5-pro'
  };
  return defaults[provider];
}

function getDefaultProvidersData(): Record<Provider, string[]> {
  return {
    openai: ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'o3', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    anthropic: ['claude-sonnet-4-20250514', 'claude-opus-4-1-20250805', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
    gemini: ['gemini-2.5-pro']
  };
}

// Helper functions remain for potential future use
