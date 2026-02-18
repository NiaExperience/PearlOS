"use client";

import { useState, useCallback, useRef } from 'react';

export type PhotoMagicState = 'idle' | 'processing' | 'result' | 'error';

export interface PhotoMagicResult {
  imageUrl: string;
  originalImageUrl?: string;
  prompt: string;
}

const API_BASE = (process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || '') + '/api/photo-magic';

export function usePhotoMagic() {
  const [state, setState] = useState<PhotoMagicState>('idle');
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [result, setResult] = useState<PhotoMagicResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const processSSE = useCallback(async (response: Response, userPrompt: string, originalUrl?: string) => {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response stream');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));

          if (data.type === 'progress') {
            setProgress(data.progress ?? 0);
            setProgressText(data.message ?? '');
          } else if (data.type === 'complete' || data.type === 'result') {
            const imageUrl = data.imageUrl?.startsWith('http')
              ? data.imageUrl
              : `${API_BASE}/result/${data.filename || data.imageUrl}`;
            setResult({ imageUrl, originalImageUrl: originalUrl, prompt: userPrompt });
            setProgress(100);
            setState('result');
            return;
          } else if (data.type === 'error') {
            throw new Error(data.message || 'Generation failed');
          }
        } catch (e) {
          // skip malformed SSE lines
        }
      }
    }
  }, []);

  const pollStatus = useCallback(async (promptId: string, userPrompt: string, originalUrl?: string) => {
    const maxAttempts = 120;
    for (let i = 0; i < maxAttempts; i++) {
      if (abortRef.current?.signal.aborted) return;
      await new Promise(r => setTimeout(r, 2000));

      const res = await fetch(`${API_BASE}/status/${promptId}`, { signal: abortRef.current?.signal });
      const data = await res.json();

      if (data.status === 'processing') {
        setProgress(data.progress ?? Math.min(90, (i / maxAttempts) * 100));
        setProgressText(data.message ?? 'Generating...');
      } else if (data.status === 'complete') {
        const imageUrl = data.imageUrl?.startsWith('http')
          ? data.imageUrl
          : `${API_BASE}/result/${data.filename || data.imageUrl}`;
        setResult({ imageUrl, originalImageUrl: originalUrl, prompt: userPrompt });
        setProgress(100);
        setState('result');
        return;
      } else if (data.status === 'error') {
        throw new Error(data.message || 'Generation failed');
      }
    }
    throw new Error('Generation timed out');
  }, []);

  const handleResponse = useCallback(async (response: Response, userPrompt: string, originalUrl?: string) => {
    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(errBody || `Server error ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      await processSSE(response, userPrompt, originalUrl);
    } else {
      const data = await response.json();
      if (data.imageUrl || data.filename || data.image_url) {
        const raw = data.imageUrl || data.image_url;
        const imageUrl = raw?.startsWith('http')
          ? raw
          : `${API_BASE}/result/${data.filename || raw}`;
        setResult({ imageUrl, originalImageUrl: originalUrl, prompt: userPrompt });
        setProgress(100);
        setState('result');
      } else if (data.promptId) {
        await pollStatus(data.promptId, userPrompt, originalUrl);
      } else {
        throw new Error('Unexpected response format');
      }
    }
  }, [processSSE, pollStatus]);

  const beginProcessing = useCallback((userPrompt: string, imageFile?: File) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setState('processing');
    setProgress(0);
    setProgressText('Preparing your vision...');
    setError(null);
    setResult(null);
    setPrompt(userPrompt);

    let originalUrl: string | undefined;
    if (imageFile) {
      originalUrl = URL.createObjectURL(imageFile);
      setSourceImage(originalUrl);
    } else {
      setSourceImage(null);
    }
    return { signal: abortRef.current.signal, originalUrl };
  }, []);

  const generate = useCallback(async (userPrompt: string, imageFile?: File, additionalFiles?: File[]) => {
    const { signal, originalUrl } = beginProcessing(userPrompt, imageFile);

    try {
      let response: Response;

      if (imageFile && additionalFiles && additionalFiles.length > 0) {
        // Multi-image edit
        const formData = new FormData();
        formData.append('files', imageFile);
        for (const f of additionalFiles) {
          formData.append('files', f);
        }
        formData.append('prompt', userPrompt);
        response = await fetch(`${API_BASE}/edit-multi`, {
          method: 'POST',
          body: formData,
          signal,
        });
      } else if (imageFile) {
        const formData = new FormData();
        formData.append('file', imageFile);
        formData.append('prompt', userPrompt);
        response = await fetch(`${API_BASE}/edit`, {
          method: 'POST',
          body: formData,
          signal,
        });
      } else {
        response = await fetch(`${API_BASE}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: userPrompt }),
          signal,
        });
      }

      await handleResponse(response, userPrompt, originalUrl);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setState('error');
      setError(err.message || 'Something went wrong');
    }
  }, [beginProcessing, handleResponse]);

  const inpaint = useCallback(async (userPrompt: string, imageFile: File, maskBlob: Blob) => {
    const { signal, originalUrl } = beginProcessing(userPrompt, imageFile);

    try {
      const formData = new FormData();
      formData.append('file', imageFile);
      formData.append('mask', maskBlob, 'mask.png');
      formData.append('prompt', userPrompt);

      const response = await fetch(`${API_BASE}/inpaint`, {
        method: 'POST',
        body: formData,
        signal,
      });

      await handleResponse(response, userPrompt, originalUrl);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setState('error');
      setError(err.message || 'Something went wrong');
    }
  }, [beginProcessing, handleResponse]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState('idle');
    setProgress(0);
    setProgressText('');
    setResult(null);
    setError(null);
    setSourceImage(null);
    setPrompt('');
  }, []);

  const editAgain = useCallback(() => {
    setState('idle');
    setProgress(0);
    setProgressText('');
    // keep result and sourceImage for reference
  }, []);

  return {
    state,
    progress,
    progressText,
    result,
    error,
    sourceImage,
    prompt,
    generate,
    inpaint,
    reset,
    editAgain,
  };
}
