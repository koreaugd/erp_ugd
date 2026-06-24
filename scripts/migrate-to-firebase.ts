import firebaseConfig from "../firebase-applet-config.json";
import { execFileSync } from "node:child_process";

const gasUrl = process.env.VITE_GAS_URL;
const branchPin = process.env.UGD_BRANCH_PIN;
const adminPin = process.env.UGD_ADMIN_PIN;
const projectId = firebaseConfig.projectId;
const databaseId = firebaseConfig.firestoreDatabaseId;
const apiKey = firebaseConfig.apiKey;

if (!gasUrl || !branchPin || !adminPin) {
  throw new Error("VITE_GAS_URL, UGD_BRANCH_PIN, UGD_ADMIN_PIN 환경 변수가 필요합니다.");
}

const firebasePassword = (pin: string) => `ugd-${pin}`;
const firestoreBase = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
  return body;
}

async function gas(action: string, params: Record<string, unknown> = {}) {
  // Apps Script의 redirect 응답은 Node fetch 환경에서 HTML로 바뀌는 경우가 있어,
  // Windows의 정상 동작 경로(Invoke-RestMethod)로 한 번 이관 데이터를 읽습니다.
  const encodedBody = Buffer.from(JSON.stringify({ action, ...params }), "utf8").toString("base64");
  const command = `$body=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedBody}')); Invoke-RestMethod -Method Post -Uri '${gasUrl}' -ContentType 'application/json' -Body $body | ConvertTo-Json -Compress -Depth 20`;
  const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding: "utf8" });
  const result = JSON.parse(output);
  if (!result.success) throw new Error(result.error || `GAS ${action} failed`);
  return result.data;
}

async function safeGas(action: string, params: Record<string, unknown> = {}, fallback: any = []) {
  try {
    return await gas(action, params);
  } catch (error) {
    console.warn(`Skipping ${action} for migration:`, error instanceof Error ? error.message : error);
    return fallback;
  }
}

async function ensureUser(email: string, pin: string) {
  const signUpUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`;
  try {
    return await requestJson(signUpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: firebasePassword(pin), returnSecureToken: true })
    });
  } catch (error: any) {
    if (!String(error.message).includes("EMAIL_EXISTS")) throw error;
    return await requestJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: firebasePassword(pin), returnSecureToken: true })
    });
  }
}

function toFirestoreValue(value: any): any {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === "object") {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toFirestoreValue(item)])) } };
  }
  return { stringValue: String(value) };
}

async function putDoc(collectionName: string, documentId: string, data: Record<string, any>, idToken: string) {
  return await requestJson(`${firestoreBase}/${collectionName}/${encodeURIComponent(documentId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toFirestoreValue(value)])) })
  });
}

async function main() {
  const admin = await ensureUser("admin@ugd-erp.example", adminPin!);
  const branches = (await gas("getBranchList")).filter((branch: any) => branch?.role === "branch" && branch.branchName);
  console.log(`Creating ${branches.length} branch accounts`);

  for (let index = 0; index < branches.length; index++) {
    await ensureUser(`branch-${String(index + 1).padStart(2, "0")}@ugd-erp.example`, branchPin!);
  }

  let settlementCount = 0;
  for (let index = 0; index < branches.length; index++) {
    const branch = branches[index];
    const branchId = String(index + 1).padStart(2, "0");
    const loginEmail = `branch-${branchId}@ugd-erp.example`;
    const branchDoc = { branchId, branchName: branch.branchName, brand: branch.brand || branch.branchName, role: "branch", loginEmail, isActive: true, updatedAt: new Date().toISOString() };
    await putDoc("public_branches", branchId, branchDoc, admin.idToken);
    await putDoc("settings", branchId, branchDoc, admin.idToken);

    // 기존 이력은 앱 전환 후 별도 일괄 이관한다. 이 단계에서는 로그인·지점 설정만 먼저 준비한다.
    await putDoc("staff_rosters", branchId, { ...branchDoc, employees: [] }, admin.idToken);
  }

  await putDoc("shared_data", "migration_status", { completed: true, branchCount: branches.length, settlementCount, migratedAt: new Date().toISOString() }, admin.idToken);
  console.log(JSON.stringify({ branchCount: branches.length, settlementCount }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
