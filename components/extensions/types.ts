export type Extension = {
  id: string;
  name: string;
  description: string;
  kind: "integrated" | "custom";
  visibility: "workspace";
  group: string;
  features?: string[];
  workspaceName?: string;
  reason?: string;
  installed: boolean;
  available: boolean;
  enabled: boolean;
  configured: boolean;
  online: boolean | null;
  url?: string;
};

export type Catalog = {
  workspace?: { name: string; slug: string; role: string };
  canManage: boolean;
  extensions: Extension[];
  catalog?: Extension[];
  lllmProvisioningRequired?: boolean;
};

export type Tab = "installed" | "catalog" | "custom";
export type Action = {
  extension: Extension;
  kind: "add" | "resume" | "pause" | "remove";
};
export type Draft = { name: string; description: string; url: string; group: string };
export type WorkspaceExtensionsProps = {
  slug: string;
  initiallyOpen?: boolean;
  presentation?: "dialog" | "page";
};
