// The single Vercel Function behind /api/v1/*, /api/admin/* and /api/cron/*
// (see the rewrites in vercel.json).
import { handle } from '../lib/router.js';

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
