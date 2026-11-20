import { authorizeWorkspace } from "@/lib/auth";
import { accessToken, getConnection } from "@/lib/confluence";
import { db } from "@/lib/db";
import { ConfluenceImageImportError, importConfluenceSceneImages } from "@/lib/confluence-image-import";
import { validateSameOriginJson } from "@/lib/request-security";

const json = (body: unknown, status=200) => Response.json(body,{status,headers:{"cache-control":"private, no-store"}});
export async function GET(_request: Request,{params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;
  const auth=await authorizeWorkspace(slug,["owner","editor"]);
  if (!auth.ok) return auth.response;
  const connections=await db().prepare(`SELECT w.slug,w.name,w.id=?1 AS current FROM workspaces w
    JOIN confluence_connections c ON c.workspace_id=w.id AND c.access_token_ciphertext IS NOT NULL AND c.cloud_id IS NOT NULL
    WHERE w.id=?1 OR (?3='owner' AND EXISTS (SELECT 1 FROM account_memberships m WHERE m.workspace_id=w.id AND m.account_key=?2 AND m.role='owner'))
    ORDER BY current DESC,w.name,w.id`).bind(auth.membership.workspace_id,auth.user.accountKey,auth.membership.role).all();
  const scenes=await db().prepare(`SELECT s.id,s.title,src.page_url AS pageUrl FROM scenes s
    JOIN scene_confluence_sources src ON src.scene_id=s.id AND src.workspace_id=s.workspace_id
    WHERE s.workspace_id=?1 AND s.deleted_at IS NULL ORDER BY s.position,s.created_at,s.id`).bind(auth.membership.workspace_id).all();
  return json({connections:connections.results.map(row=>({...row,current:Boolean(row.current)})),scenes:scenes.results});
}
export async function POST(request:Request,{params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;
  const auth=await authorizeWorkspace(slug,["owner","editor"]);
  if(!auth.ok) return auth.response;
  if(!validateSameOriginJson(request,"import-confluence-images")) return json({error:"同じサイトから操作してください。"},403);
  let body:{sceneId:string;connectionSlug:string};
  try{
    const raw=await request.text();
    if(new TextEncoder().encode(raw).byteLength>2048) throw new Error();
    body=JSON.parse(raw);
    if(!body||typeof body.sceneId!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(body.sceneId)
      ||typeof body.connectionSlug!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(body.connectionSlug)) throw new Error();
  }catch{return json({error:"対象場面とConfluence接続を選んでください。"},400);}
  let connectionWorkspaceId=auth.membership.workspace_id;
  if(body.connectionSlug!==slug){
    if(auth.membership.role!=="owner") return json({error:"別のワークスペースの接続は所有者のみ利用できます。"},403);
    const owner=await authorizeWorkspace(body.connectionSlug,["owner"]);
    if(!owner.ok) return json({error:"このConfluence接続を利用する権限がありません。"},403);
    if(owner.user.accountKey!==auth.user.accountKey) return json({error:"接続アカウントを確認してください。"},403);
    connectionWorkspaceId=owner.membership.workspace_id;
  }
  const connection=await getConnection(connectionWorkspaceId);
  if(!connection?.access_token_ciphertext||!connection.cloud_id||!connection.cloud_url)
    return json({error:"利用できるConfluence接続がありません。",nextAction:"Atlassianへ接続してから再試行してください。"},409);
  try{
    const result=await importConfluenceSceneImages({database:db(),workspaceId:auth.membership.workspace_id,sceneId:body.sceneId,
      accountKey:auth.user.accountKey,connection:{workspaceId:connectionWorkspaceId,cloudId:connection.cloud_id,cloudUrl:connection.cloud_url,token:await accessToken(connection)}});
    return json(result);
  }catch(error){
    if(error instanceof ConfluenceImageImportError) return json({error:error.message,code:error.code},error.status);
    const reauth=error instanceof Error&&error.message==="Confluenceの再認証が必要です";
    return json({error:reauth?"Confluenceの再接続が必要です。":"画像の取得中に通信または保存の問題が発生しました。取得済みの画像は保持されています。",
      nextAction:reauth?"Atlassianへ再接続してから再試行してください。":"画面を更新して再試行してください。"},reauth?409:502);
  }
}
