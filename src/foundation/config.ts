import path from 'path';

export const VAULT_ROOT = process.env.WORKSHOP_VAULT_ROOT || path.join(process.env.HOME || '/tmp', '.workshop', 'vault');
