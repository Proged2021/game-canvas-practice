import { readFile } from 'node:fs/promises';

// These are the workspace feature modules, not the shared UI library or API.
// Cross-feature source contracts read this explicit set; function-level tests
// use readWorkspaceFeature so their boundaries stay inside the owning module.
const files = [
  'types.ts', 'confluence-status.ts', 'use-workspace-state.ts', 'use-workspace-controller.ts',
  'scene-management.ts', 'workspace-sharing.ts', 'confluence-sync.ts', 'manual-images.ts',
  'confluence-image-import.ts', 'local-story-images.ts', 'local-story-drafts.ts',
  'workspace-screen.tsx', 'workspace-header.tsx', 'story-pane.tsx', 'scene-list.tsx', 'scene-editor.tsx',
  'scene-create-dialog.tsx', 'scene-delete-dialog.tsx', 'scene-conflict-dialog.tsx',
  'workspace-profile-dialog.tsx', 'workspace-invitations-dialog.tsx', 'confluence-settings-dialog.tsx',
  'confluence-image-import-panel.tsx', 'manual-image-panel.tsx',
  'confluence-connect-link.tsx', 'confluence-sync-confirm-dialog.tsx',
  'local-story-conflict-dialog.tsx', 'local-story-reset-dialog.tsx', 'view-model.ts',
];
const root = new URL('../../', import.meta.url);
const sources = new Map(files.map(file => [file, readFile(new URL(`components/workspace/${file}`, root), 'utf8')]));

export function readWorkspaceFeature(file) {
  const source = sources.get(file);
  if (!source) throw new Error(`Unknown workspace feature source: ${file}`);
  return source;
}

export async function readWorkspaceSource() {
  return (await Promise.all([
    readFile(new URL('components/workspace-client.tsx', root), 'utf8'),
    ...files.map(readWorkspaceFeature),
  ])).join('\n');
}
