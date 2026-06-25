/**
 * Lab mode UI + `/api/bot/lab-mode` are off in production unless overridden.
 * See layout, ModelSettingsPanel, LabModeBanner.
 */
export const isLabModeUiAvailable =
  process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_LAB_MODE_UI === 'true';
