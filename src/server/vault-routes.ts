import { Router, type Request } from 'express';
import type { VaultReader } from '@infrastructure/vault/reader.js';
import type { VaultWriter } from '@infrastructure/vault/writer.js';
import type { VaultProvisioner } from '@infrastructure/vault/provisioner.js';

export interface VaultRouterDeps {
  vaultReader: VaultReader;
  vaultWriter: VaultWriter;
  vaultProvisioner: VaultProvisioner;
}

/** Extract the wildcard portion from Express route params. */
function wildcard(req: Request): string {
  // Express 4 stores wildcard captures at numeric indices on params
  return (req.params as Record<string, string>)['0'] || '';
}

export function createVaultRouter(deps: VaultRouterDeps): Router {
  const router = Router();
  const { vaultReader, vaultWriter, vaultProvisioner } = deps;

  // --- Track vault files ---

  // List files in a track's vault folder
  router.get('/vault/tracks/:trackSlug', (req, res) => {
    const { trackSlug } = req.params;
    const dirPath = `Workshop/${trackSlug}`;
    const files = vaultReader.listFiles(dirPath);
    res.json({ trackSlug, files });
  });

  // Provision vault folder for a track
  router.post('/vault/tracks/:trackSlug/provision', (req, res) => {
    const { trackSlug } = req.params;
    const { trackName } = req.body;
    if (!trackName || typeof trackName !== 'string') {
      res.status(400).json({ error: 'trackName is required' });
      return;
    }
    try {
      vaultProvisioner.provisionTrack(trackSlug, trackName);
      res.json({ trackSlug, provisioned: true });
    } catch (err) {
      console.error('Failed to provision vault:', err);
      res.status(500).json({ error: 'Failed to provision vault folder' });
    }
  });

  // Append to a track vault file
  // Must be registered BEFORE the wildcard read route
  router.post('/vault/tracks/:trackSlug/append/*', (req, res) => {
    const { trackSlug } = req.params;
    const filePath = `Workshop/${trackSlug}/${wildcard(req)}`;
    const { content } = req.body;
    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: 'content is required' });
      return;
    }
    try {
      vaultWriter.appendSection(filePath, content);
      res.json({ filePath, appended: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to append';
      res.status(400).json({ error: msg });
    }
  });

  // Read a specific file from a track's vault folder
  router.get('/vault/tracks/:trackSlug/*', (req, res) => {
    const { trackSlug } = req.params;
    const filePath = `Workshop/${trackSlug}/${wildcard(req)}`;
    const content = vaultReader.readFile(filePath);
    if (content === null) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.json({ filePath, content });
  });

  // Write/overwrite a file in a track's vault folder
  router.put('/vault/tracks/:trackSlug/*', (req, res) => {
    const { trackSlug } = req.params;
    const filePath = `Workshop/${trackSlug}/${wildcard(req)}`;
    const { content } = req.body;
    if (content === undefined || typeof content !== 'string') {
      res.status(400).json({ error: 'content is required' });
      return;
    }
    try {
      vaultWriter.writeFile(filePath, content);
      res.json({ filePath, written: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to write';
      res.status(400).json({ error: msg });
    }
  });

  // --- General vault files ---

  // List files in Workshop/General/
  router.get('/vault/general', (_req, res) => {
    const files = vaultReader.listFiles('Workshop/General');
    res.json({ files });
  });

  // Read a file from General/
  router.get('/vault/general/*', (req, res) => {
    const filePath = `Workshop/General/${wildcard(req)}`;
    const content = vaultReader.readFile(filePath);
    if (content === null) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.json({ filePath, content });
  });

  return router;
}
