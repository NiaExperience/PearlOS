import { DELETE_impl, GET_BY_ID_impl, PUT_impl, PATCH_impl } from '@interface/features/Notes';

export const GET = GET_BY_ID_impl;
export const DELETE = DELETE_impl;
export const PUT = PUT_impl;
export const PATCH = PATCH_impl;