"use client";

import { Loader2 } from 'lucide-react';
import { WorkspaceScreen } from './workspace/workspace-screen';
import { useWorkspaceController } from './workspace/use-workspace-controller';
import type { WorkspaceClientProps } from './workspace/types';
export type { WorkspaceData } from './workspace/types';

export function WorkspaceClient(props: WorkspaceClientProps) {
  const workspace = useWorkspaceController(props);
  if (!workspace.data) return <main className="loading-screen"><Loader2 className="spin" />ワークスペースを読み込んでいます</main>;
  return <WorkspaceScreen workspace={{ ...workspace, data: workspace.data }} />;
}
