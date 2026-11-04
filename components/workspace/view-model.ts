import type { useWorkspaceController } from './use-workspace-controller';
import type { WorkspaceData } from './types';

export type WorkspaceViewModel = ReturnType<typeof useWorkspaceController> & { data: WorkspaceData };
