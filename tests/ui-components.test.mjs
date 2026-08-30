import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

async function readCssTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return readCssTree(entryPath);
      }
      return entry.name.endsWith(".css") ? readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

test("emits the catalog's animation and scrolling utilities", async () => {
  const css = await readCssTree(path.join(root, "dist"));

  assert.match(css, /--tw-enter-opacity/);
  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(css, /scrollbar-gutter:\s*stable/);
  assert.match(css, /scroll-fade-reveal-b/);
  assert.match(css, /mask-image:/);
  assert.match(css, /tw-shimmer/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("forwards progress semantics to the primitive", async () => {
  const { Progress } = await vite.ssrLoadModule("/components/ui/progress.tsx");
  const html = renderToStaticMarkup(React.createElement(Progress, { value: 37 }));

  assert.match(html, /aria-valuenow="37"/);
  assert.match(html, /aria-valuetext="37%"/);
  assert.match(html, /data-state="loading"/);
});

test("emits chart themes for the starter's media dark mode", async () => {
  const { ChartStyle } = await vite.ssrLoadModule("/components/ui/chart.tsx");
  const html = renderToStaticMarkup(
    React.createElement(ChartStyle, {
      id: "contract",
      config: {
        latency: { theme: { light: "#ffffff", dark: "#000000" } },
      },
    }),
  );

  assert.match(html, /\[data-chart=contract\]/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(html, /\.dark/);
});

test("renders sidebar skeletons deterministically", async () => {
  const { SidebarMenuSkeleton } = await vite.ssrLoadModule(
    "/components/ui/sidebar.tsx",
  );
  const first = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));
  const second = renderToStaticMarkup(React.createElement(SidebarMenuSkeleton));

  assert.equal(first, second);
  assert.match(first, /--skeleton-width:70%/);
});

test("server-renders each saved workspace as a native accessible link", async () => {
  const { DashboardClient } = await vite.ssrLoadModule(
    "/components/dashboard-client.tsx",
  );
  const html = renderToStaticMarkup(
    React.createElement(DashboardClient, {
      user: { displayName: "検証ユーザー", email: "owner@example.test" },
      signOutPath: "/signout-with-chatgpt?return_to=%2F",
      initialWorkspaces: [
        {
          slug: "workspace-06908b60-3df",
          name: "テスト1",
          role: "owner",
          scene_count: 1,
        },
      ],
    }),
  );

  assert.match(html, /<a[^>]*class="workspace-card"/);
  assert.match(html, /href="\/w\/workspace-06908b60-3df"/);
  assert.match(html, /aria-label="テスト1を開く"/);
  assert.match(html, />テスト1</);
  assert.match(html, />1 場面</);
});

test("server-renders direct workspace links with saved scene content", async () => {
  const { WorkspaceClient } = await vite.ssrLoadModule(
    "/components/workspace-client.tsx",
  );
  const html = renderToStaticMarkup(
    React.createElement(WorkspaceClient, {
      slug: "workspace-06908b60-3df",
      initialData: {
        workspace: {
          slug: "workspace-06908b60-3df",
          name: "テスト1",
          role: "owner",
        },
        currentUser: {
          email: "owner@example.test",
          displayName: "検証ユーザー",
        },
        scenes: [
          {
            id: "scene-1",
            title: "テスト1場面",
            confluence_page_url: null,
            markdown: "# 保存済みMarkdown",
            position: 0,
            revision: 1,
            updated_by: "owner@example.test",
          },
        ],
        members: [{ email: "owner@example.test", role: "owner" }],
        invitations: [],
        confluence: null,
      },
    }),
  );

  assert.match(html, /テスト1場面/);
  assert.match(html, /# 保存済みMarkdown/);
  assert.match(html, /href="\/"/);
  assert.match(html, /Confluenceを追加/);
  assert.doesNotMatch(html, /接続設定/);
  assert.doesNotMatch(html, /ワークスペースを読み込んでいます/);
});

test("preserves dashboard, workspace, back, reopen, and direct-reload navigation", async () => {
  const [{ DashboardClient }, { WorkspaceClient }] = await Promise.all([
    vite.ssrLoadModule("/components/dashboard-client.tsx"),
    vite.ssrLoadModule("/components/workspace-client.tsx"),
  ]);
  const workspace = {
    workspace: {
      slug: "workspace-06908b60-3df",
      name: "テスト1",
      role: "owner",
    },
    currentUser: {
      email: "owner@example.test",
      displayName: "検証ユーザー",
    },
    scenes: [
      {
        id: "scene-1",
        title: "テスト1場面",
        confluence_page_url: null,
        markdown: "# 保存済みMarkdown",
        position: 0,
        revision: 1,
        updated_by: "owner@example.test",
      },
    ],
    members: [{ email: "owner@example.test", role: "owner" }],
    invitations: [],
    confluence: null,
  };
  const dashboardProps = {
    user: workspace.currentUser,
    signOutPath: "/signout-with-chatgpt?return_to=%2F",
    initialWorkspaces: [
      {
        slug: workspace.workspace.slug,
        name: workspace.workspace.name,
        role: "owner",
        scene_count: 1,
      },
    ],
  };

  const firstDashboard = renderToStaticMarkup(
    React.createElement(DashboardClient, dashboardProps),
  );
  const openedWorkspace = renderToStaticMarkup(
    React.createElement(WorkspaceClient, {
      slug: workspace.workspace.slug,
      initialData: workspace,
    }),
  );
  const reopenedDashboard = renderToStaticMarkup(
    React.createElement(DashboardClient, dashboardProps),
  );
  const reloadedWorkspace = renderToStaticMarkup(
    React.createElement(WorkspaceClient, {
      slug: workspace.workspace.slug,
      initialData: workspace,
    }),
  );

  for (const dashboard of [firstDashboard, reopenedDashboard]) {
    assert.match(dashboard, /href="\/w\/workspace-06908b60-3df"/);
  }
  assert.match(openedWorkspace, /href="\/"/);
  assert.match(openedWorkspace, /テスト1場面/);
  assert.match(reloadedWorkspace, /テスト1場面/);
  assert.match(reloadedWorkspace, /# 保存済みMarkdown/);
});
