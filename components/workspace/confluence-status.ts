import type { ConfluenceStatus } from './types';

export const CONFLUENCE_STATUS_LABELS: Record<ConfluenceStatus["state"], string> = {
  unconfigured: "未設定",
  available: "接続可能",
  connected: "接続済み",
  reauth_required: "再認証が必要",
};
