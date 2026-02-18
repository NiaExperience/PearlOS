'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@interface/components/ui/card';
import { Button } from '@interface/components/ui/button';
import { Brain, Gem, Sparkles, Loader2 } from 'lucide-react';

import { getClientLogger } from '@interface/lib/client-logger';

type Provider = 'openai' | 'anthropic' | 'gemini';

interface ModelSelectorModalProps {
	providers: Record<Provider, string[]>;
	onCancel: () => void;
	onConfirm: (provider: Provider, model: string) => void;
	isGenerating?: boolean;
}

const GOHUFONT_FONT_FACE = `
@font-face {
  font-family: 'Gohufont';
  src: url('/fonts/Gohu/GohuFontuni14NerdFontMono-Regular.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
`;

const ensureGohufont = () => {
	if (typeof document === 'undefined') return;
	if (document.getElementById('gohufont-font-face')) return;
	const style = document.createElement('style');
	style.id = 'gohufont-font-face';
	style.textContent = GOHUFONT_FONT_FACE;
	document.head.appendChild(style);
};

export default function ModelSelectorModal({ providers, onCancel, onConfirm, isGenerating = false }: ModelSelectorModalProps) {
	const [provider, setProvider] = useState<Provider>('openai');
	const [model, setModel] = useState<string>('');
	const log = useMemo(() => getClientLogger('[html-generation.model-selector]'), []);

	useEffect(() => {
		ensureGohufont();
	}, []);

	const models = useMemo(() => providers[provider] || [], [providers, provider]);

	useEffect(() => {
		if (models.length > 0) setModel(models[0]);
	}, [models]);

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onCancel();
			if (e.key === 'Enter' && model) onConfirm(provider, model);
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [onCancel, onConfirm, provider, model]);

	const ProviderIcon = ({ p }: { p: Provider }) => (
		<span className="mr-2 inline-flex items-center justify-center rounded-md bg-muted p-1">
			{p === 'openai' && <Sparkles className="h-4 w-4" />}
			{p === 'anthropic' && <Brain className="h-4 w-4" />}
			{p === 'gemini' && <Gem className="h-4 w-4" />}
		</span>
	);

	return (
		<div className="relative w-full h-full" style={{ fontFamily: 'Gohufont, monospace' }}>
			{/* Enhanced backdrop with better opacity */}
			<div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900" />
			<div className="absolute inset-0 bg-white/80 dark:bg-black/40 backdrop-blur-md" />

			<div
				className="relative w-full h-full flex items-center justify-center p-6"
				role="dialog"
				aria-modal="true"
				aria-label="Select AI Provider and Model"
			>
				<Card className="w-full max-w-3xl shadow-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900">
					<CardHeader className="pb-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-slate-800 dark:to-slate-700">
						<CardTitle className="text-xl text-gray-900 dark:text-white">Select AI Provider and Model</CardTitle>
						<p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
							Choose your generation engine. Your selection determines how the app is created.
						</p>
					</CardHeader>
					<CardContent className="space-y-6 bg-white dark:bg-slate-900">
						<div className="grid grid-cols-12 gap-6">
							{/* Provider column */}
							<div className="col-span-12 md:col-span-4">
								<div className="space-y-3">
									<h3 className="text-sm font-medium text-gray-900 dark:text-white">Provider</h3>
									<div className="flex md:flex-col gap-2">
										{(['openai', 'anthropic', 'gemini'] as Provider[]).map((p) => (
											<Button
												key={p}
												variant={provider === p ? 'default' : 'outline'}
												onClick={() => {
																log.info('Provider selected', { provider: p });
													setProvider(p);
												}}
												disabled={isGenerating}
												className={`justify-start transition-all duration-200 ${
													provider === p
														? 'bg-blue-600 text-white border-blue-600 shadow-lg'
														: 'bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:bg-blue-50 dark:hover:bg-slate-700'
												}`}
												aria-pressed={provider === p}
											>
												<ProviderIcon p={p} />
												{p === 'openai' && 'OpenAI'}
												{p === 'anthropic' && 'Anthropic'}
												{p === 'gemini' && 'Gemini'}
											</Button>
										))}
									</div>
								</div>
							</div>

							{/* Models column */}
							<div className="col-span-12 md:col-span-8">
								<div className="space-y-3">
									<h3 className="text-sm font-medium text-gray-900 dark:text-white">Models</h3>
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-auto pr-1">
										{models.map((m) => (
											<button
												key={m}
												className={`w-full rounded-lg border text-left px-4 py-3 transition-all duration-200 ${
													model === m
														? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-md'
														: 'border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700'
												} ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
												onClick={() => {
													if (!isGenerating) {
																				log.info('Model selected', { provider, model: m });
														setModel(m);
													}
												}}
												disabled={isGenerating}
												aria-pressed={model === m}
											>
												<div className={`font-medium ${model === m ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>
													{m}
												</div>
												<p className="text-xs text-gray-500 dark:text-gray-400">Optimized for professional HTML generation</p>
											</button>
										))}
									</div>
								</div>
							</div>
						</div>

						{/* Footer actions */}
						<div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
							<p className="text-xs text-gray-500 dark:text-gray-400">You can change the provider or model next time before generation.</p>
							<div className="flex gap-3">
								<Button 
									variant="outline" 
									onClick={() => {
										log.info('Modal cancelled by user');
										onCancel();
									}}
									disabled={isGenerating}
									className="border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
								>
									Cancel
								</Button>
								<Button 
									onClick={() => {
																		log.info('User confirmed selection', { provider, model });
										onConfirm(provider, model);
									}} 
									disabled={!model || isGenerating}
									className="bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:text-gray-500"
								>
									{isGenerating ? (
										<>
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											Generating...
										</>
									) : model ? (
										`Use ${provider} • ${model}`
									) : (
										'Select a model'
									)}
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
