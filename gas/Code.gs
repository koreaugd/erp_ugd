/**
 * ERP_UGD Google Apps Script Web App Backend
 * -------------------------------------------
 * Google Sheets를 DB로 사용하여 UGD 주식회사의 일일마감 정산을 관리합니다.
 * 
 * [배포 방법]
 * 1. 구글 스프레드시트 생성
 * 2. 확장 프로그램 > Apps Script 클릭
 * 3. 본 코드(Code.gs)를 전체 복사하여 붙여넣기
 * 4. 우상단 '배포' > '새 배포' > 유형: 웹 앱
 * 5. 액세스 권한: "모든 사용자(Anyone)"로 설정 후 배포
 * 6. 배포된 웹 앱 URL을 프로젝트의 .env (VITE_GAS_URL)에 등록
 */

const PROPERTIES = PropertiesService.getScriptProperties();

function doPost(e) {
  try {
    const jsonString = e.postData.contents;
    const requestData = JSON.parse(jsonString);
    const action = requestData.action;
    
    // 스프레드시트 초기화 최초 1회만 실행 (이후 Property 캐시로 건너뜀)
    if (!PROPERTIES.getProperty("SHEETS_INITIALIZED")) {
      initSheets();
      PROPERTIES.setProperty("SHEETS_INITIALIZED", "true");
    }
    // 헤더/보조 시트 확인은 매 요청마다 수행할 필요가 없습니다.
    // 최초 한 번만 보정해 일반 조회와 탭 전환의 시트 호출 수를 줄입니다.
    if (!PROPERTIES.getProperty("SHEETS_SCHEMA_READY")) {
      ensureSheetsSchema();
      PROPERTIES.setProperty("SHEETS_SCHEMA_READY", "true");
    }

    let result;
    switch (action) {
      case "verifyPin":
        result = verifyPin(requestData.pinHash);
        break;
      case "checkDuplicate":
        result = checkDuplicate(requestData.branchName, requestData.settleDate);
        break;
      case "getDailyFormBootstrap":
        result = getDailyFormBootstrap(requestData.branchName, requestData.settleDate);
        break;
      case "submitDaily":
        result = submitDaily(requestData.master || requestData.masterData, requestData.expenses || [], requestData.staff || []);
        break;
      case "updateDaily":
        result = updateDaily(requestData.recordId, requestData.masterData || requestData.master, requestData.expenses, requestData.staff, requestData.modifiedBy);
        break;
      case "getDailyList":
        result = getDailyList(requestData.settleDate, requestData.adminPinHash);
        break;
      case "getDailyDetail":
        result = getDailyDetail(requestData.recordId);
        break;
      case "getBranchHistory":
        result = getBranchHistory(requestData.branchName, requestData.month);
        break;
      case "getAttendanceLog":
        result = getAttendanceLog(requestData.branchName, requestData.logType);
        break;
      case "getBranchList":
        result = getBranchList();
        break;
      case "getBranchListAll":
        result = getBranchListAll();
        break;
      case "getStaffRoster":
        result = getStaffRoster(requestData.branchName);
        break;
      case "saveStaffRoster":
        result = saveStaffRoster(requestData.branchName, requestData.employees || []);
        break;
      case "getSharedData":
        result = getSharedData(requestData.dataKey);
        break;
      case "saveSharedData":
        result = saveSharedData(requestData.dataKey, requestData.value);
        break;
      case "addBranch":
        result = addBranch(requestData.branchName, requestData.pinHash, requestData.brand, requestData.role);
        break;
      case "toggleBranchActive":
        result = toggleBranchActive(requestData.branchName, requestData.isActive);
        break;
      case "updateBranchPin":
        result = updateBranchPin(requestData.branchName, requestData.pinHash);
        break;
      case "deleteBranch":
        result = deleteBranch(requestData.branchName);
        break;
      // 카카오T 액션은 조회·쓰기 모두 관리자 PIN 검증을 강제한다 — GAS 웹앱 URL은 공개돼 있어
      // 액션명만 알면 아무나 호출할 수 있기 때문(직원 삭제·휴직 같은 쓰기가 특히 위험).
      case "getKakaoTaxiOrders":
        requireKakaoTaxiAdmin(requestData.adminPinHash);
        result = getKakaoTaxiOrders(requestData.month, requestData.forceRefresh === true);
        break;
      case "getKakaoTaxiGroups":
        requireKakaoTaxiAdmin(requestData.adminPinHash);
        result = getKakaoTaxiGroups(requestData.forceRefresh === true);
        break;
      case "getKakaoTaxiMembers":
        requireKakaoTaxiAdmin(requestData.adminPinHash);
        result = getKakaoTaxiMembers(requestData.forceRefresh);
        break;
      case "getKakaoTaxiBranchMembers":
        // 지점용 — 지점 PIN(또는 관리자 PIN)으로 자기 지점에 매핑되는 인원만 반환한다.
        result = getKakaoTaxiBranchMembers(requestData.pinHash, requestData.branchName, requestData.forceRefresh);
        break;
      case "submitBranchKakaoRegister":
        // 지점 자동 등록 — 지점 PIN 게이트(함수 내부 검증). 관리자 승인 없이 등록+인증 알림톡.
        result = submitBranchKakaoRegister(requestData.pinHash, requestData.branchName, requestData.name, requestData.phone, requestData.memo);
        break;
      case "registerKakaoTaxiMember":
        requireKakaoTaxiAdmin(requestData.adminPinHash);
        result = registerKakaoTaxiMember(
          requireKakaoAccountKey(requestData.accountKey),
          requestData.member
        );
        break;
      case "updateKakaoTaxiMember":
        requireKakaoTaxiAdmin(requestData.adminPinHash);
        result = updateKakaoTaxiMember(
          requireKakaoAccountKey(requestData.accountKey),
          requestData.memberId,
          requestData.member
        );
        break;
      case "blockKakaoTaxiMember":
        requireKakaoTaxiAdmin(requestData.adminPinHash);
        result = setKakaoTaxiMemberBlocked(
          requireKakaoAccountKey(requestData.accountKey),
          requestData.memberIds,
          true
        );
        break;
      case "unblockKakaoTaxiMember":
        requireKakaoTaxiAdmin(requestData.adminPinHash);
        result = setKakaoTaxiMemberBlocked(
          requireKakaoAccountKey(requestData.accountKey),
          requestData.memberIds,
          false
        );
        break;
      case "deleteKakaoTaxiMember":
        requireKakaoTaxiAdmin(requestData.adminPinHash);
        result = deleteKakaoTaxiMember(
          requireKakaoAccountKey(requestData.accountKey),
          requestData.memberId
        );
        break;
      case "sendKakaoTaxiMemberTms":
        requireKakaoTaxiAdmin(requestData.adminPinHash);
        result = sendKakaoTaxiMemberTms(
          requireKakaoAccountKey(requestData.accountKey),
          requestData.memberId
        );
        break;
      default:
        throw new Error("정의되지 않은 액션명입니다: " + action);
    }

    return ContentService.createTextOutput(JSON.stringify({ success: true, data: result }))
                         .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    const msg = (error && error.message) ? error.message : String(error);
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: msg }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}

// CORS 대응을 위한 doOptions 구현
function doOptions(e) {
  return ContentService.createTextOutput("")
                       .setMimeType(ContentService.MimeType.TEXT);
}

// ----------------------------------------------------
// DB 초기화 및 시트 매핑
// ----------------------------------------------------
function getSpreadsheet() {
  // 스크립트에 바인딩된 시트를 이용하거나 특정 ID가 지정된 경우 그것을 사용
  const sheetId = PROPERTIES.getProperty("SPREADSHEET_ID");
  if (sheetId) {
    return SpreadsheetApp.openById(sheetId);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

const SHEETS = {
  MASTER: "마스터_일일마감",
  EXPENSE: "지출_상세",
  STAFF: "인원_기록",
  ROSTER: "직원_현황",
  SHARED_DATA: "공통_설정",
  SETTING: "지점_설정",
  LOG: "수정_로그",
  STAFF_MOVEMENT: "직원_근무지_변동"
};

function initSheets() {
  const ss = getSpreadsheet();
  
  // 1. 지점_설정 시트
  let settingSheet = ss.getSheetByName(SHEETS.SETTING);
  if (!settingSheet) {
    settingSheet = ss.insertSheet(SHEETS.SETTING);
    settingSheet.appendRow(["branch_name", "pin_hash", "role", "is_active", "brand"]);
    
    // 초기 지점 가제 데이터 삽입 (SHA-256 해시값 산출)
    // 아래 해시 함수는 프론트와 일관성있게 계산된 고정값입니다.
    const initialBranches = [
      ["대물섬 한남점", "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4", "branch", "TRUE", "대물섬"], // 1234
      ["카라멘야 신촌점", "5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5", "branch", "TRUE", "카라멘야"], // 2345
      ["남산광어", "bc40db6e64174c538415fc1dca370bfd7559e2170f2095f7ecfb4b375b4aa035", "branch", "TRUE", "남산광어"], // 3456
      ["사카바단단", "37a77b8b2fcb4b1a45bb38ecbc6bfacdc7abf134bf3006aff0965d506ae2d3c1", "branch", "TRUE", "사카바단단"], // 4567
      ["카츠스위스", "dbf76bfb1d8baf83ccd3856b3e34b9cfdfd5a27ae0e78c80fb688970e30f1465", "branch", "TRUE", "카츠스위스"], // 5678
      ["금샤빠", "fc8e74720935541604df45e43a6d6fec6f3780f2bebf70fcb9e380b06b72a4f4", "branch", "TRUE", "금샤빠"], // 6789
      ["대학로고래", "011bc9052026859346d04e33e9bfa24b7fa71ff6a7a5ea9f5b6196238b6d376c", "branch", "TRUE", "대학로고래"], // 7890
      ["마음죽", "efdf04106361a4b4904de0f3b48f6ddbfdaf4363f82cb3f0e0ca59941a3962d3", "branch", "TRUE", "마음죽"], // 8901
      ["연하동", "42728f32ac8db620fa9329fc9f62ebd231c5188bc8a9d023af7b819fbc4fb315", "branch", "TRUE", "연하동"], // 9012
      ["헴프리스", "107dbf310d9af7d1c686e00cc2b4eb18c7bf9dfda2e0f2f3d6db8f90656a2bb5", "branch", "TRUE", "헴프리스"], // 0123
      ["8번대물집", "4523626c92ece30386ab9959600a06c5598696bb43a6538bfe4381387d8df94b", "branch", "TRUE", "대물섬"], // 1357
      ["강남대골뼈국", "e1451f151c881c002bd3ddfaff63c0cdbeee06883b27b9a5f700c2a514d2325a", "branch", "TRUE", "강남대골뼈국"], // 2468
      ["대물섬 강남점", "d06fcc3e81792fd6aeaba18f2bb732386a34ba50ef12933ed10557464a974df7", "branch", "TRUE", "대물섬"], // 3579
      ["관리자", "53d6316bd7b9044e6bb5deaa87fe8316c2fde3938b78f8448875b08e551ccc95", "admin", "TRUE", "본사"] // admin0000 (correct SHA-256)
    ];
    
    // 일부 지점 공백 자르기
    initialBranches.forEach(b => {
      b[0] = b[0].trim();
    });

    initialBranches.forEach(row => {
      settingSheet.appendRow(row);
    });
  }

  // 2. 마스터_일일마감 시트
  let masterSheet = ss.getSheetByName(SHEETS.MASTER);
  if (!masterSheet) {
    masterSheet = ss.insertSheet(SHEETS.MASTER);
    masterSheet.appendRow([
      "record_id", "branch_name", "settle_date", 
      "cash_sales", "card_sales", "transfer_sales", "delivery_sales", "total_sales", 
      "memo", "submitted_at", "submitted_by", "modified_at", "modified_by"
    ]);
  }

  // 3. 지출_상세 시트
  let expenseSheet = ss.getSheetByName(SHEETS.EXPENSE);
  if (!expenseSheet) {
    expenseSheet = ss.insertSheet(SHEETS.EXPENSE);
    expenseSheet.appendRow(["record_id", "expense_type", "item_name", "amount", "branch_name"]);
  }

  // 4. 인원_기록 시트
  let staffSheet = ss.getSheetByName(SHEETS.STAFF);
  if (!staffSheet) {
    staffSheet = ss.insertSheet(SHEETS.STAFF);
    staffSheet.appendRow(["record_id", "staff_name", "work_hours", "branch_name", "division"]);
  }

  // 5. 수정_로그 시트
  let logSheet = ss.getSheetByName(SHEETS.LOG);
  if (!logSheet) {
    logSheet = ss.insertSheet(SHEETS.LOG);
    logSheet.appendRow(["log_id", "record_id", "changed_field", "old_value", "new_value", "modified_by", "modified_at"]);
  }
}

// ----------------------------------------------------
// REST API 구현 액션들
// ----------------------------------------------------

/**
 * 1. PIN 검증 및 지점 정보 반환
 */
function verifyPin(pinHash) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.SETTING);
  const data = sheet.getDataRange().getValues();
  const activeBranches = getActiveBranchesFromSettingsData(data);
  
  const cleanPinHash = String(pinHash || "").trim().toLowerCase();
  
  // 첫 행(헤더) 제외
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const branchName = row[0];
    const hashInDb = String(row[1] || "").trim().toLowerCase();
    const role = row[2];
    const isActive = String(row[3]).toUpperCase() === "TRUE";
    const brand = row[4];
    
    if (!isActive) continue;

    // A. 오리지널 일치 확인 (완벽 매칭)
    if (hashInDb === cleanPinHash) {
      return {
        branchName: branchName,
        role: role,
        brand: brand,
        branches: activeBranches
      };
    }

    // B. 관리자(admin) 추가 호환성 체크
    // admin0000 해시: 406c138b3014c46fbe87b322a4660fe99b51efda7d52a8a89b708b73059882bf 또는 53d6316bd7b9044e6bb5deaa87fe8316c2fde3938b78f8448875b08e551ccc95
    if (role === "admin") {
      const isDbAdminHash = (hashInDb === "406c138b3014c46fbe87b322a4660fe99b51efda7d52a8a89b708b73059882bf" || hashInDb === "53d6316bd7b9044e6bb5deaa87fe8316c2fde3938b78f8448875b08e551ccc95");
      const isInputAdminHash = (cleanPinHash === "406c138b3014c46fbe87b322a4660fe99b51efda7d52a8a89b708b73059882bf" || cleanPinHash === "53d6316bd7b9044e6bb5deaa87fe8316c2fde3938b78f8448875b08e551ccc95");
      if (isDbAdminHash && isInputAdminHash) {
        return {
          branchName: branchName,
          role: role,
          brand: brand,
          branches: activeBranches
        };
      }
    }

    // C. 사용자가 구글 시트에 "1234", "admin0000" 등 평문을 그대로 적어둔 하위 호환성 케이스 대응
    if (hashInDb.length < 32) {
      const dbPlainHash = getSha256(hashInDb);
      if (dbPlainHash === cleanPinHash) {
        return {
          branchName: branchName,
          role: role,
          brand: brand,
          branches: activeBranches
        };
      }
    }
  }
  throw new Error("PIN 번호가 올바르지 않거나 비활성화된 계정입니다.");
}

// 한 행의 pin_hash 가 입력 해시와 맞는지 — verifyPin 의 매칭 규칙(완전일치·admin 레거시 해시·평문 폴백)과 동일.
function pinRowMatches_(hashInDb, cleanPinHash, role) {
  if (!cleanPinHash || !hashInDb) return false;
  if (hashInDb === cleanPinHash) return true;
  if (role === "admin") {
    var LEGACY = ["406c138b3014c46fbe87b322a4660fe99b51efda7d52a8a89b708b73059882bf", "53d6316bd7b9044e6bb5deaa87fe8316c2fde3938b78f8448875b08e551ccc95"];
    if (LEGACY.indexOf(hashInDb) >= 0 && LEGACY.indexOf(cleanPinHash) >= 0) return true;
  }
  // 시트에 평문 PIN 이 적혀 있던 하위 호환 케이스
  if (hashInDb.length < 32 && getSha256(hashInDb) === cleanPinHash) return true;
  return false;
}

/**
 * 지점 화면 게이트 — "이 PIN 이 이 지점의 PIN 인가"를 그 지점 행에서 직접 확인한다.
 * 통과하면 {branchName, role, brand}, 아니면 null.
 *
 * verifyPin(역방향: PIN → 지점)을 쓰면 안 되는 이유 — 2026-07-28 운영 사고:
 * 여러 지점이 같은 공통 PIN 을 쓰면 verifyPin 은 시트에서 먼저 나오는 한 행(대물섬 한남점)만
 * 돌려줘서, 그 지점을 뺀 전 지점이 "지점 인증에 실패했습니다"로 거부됐다. 지점을 먼저 특정하고
 * 그 행의 해시와 대조하면 공통 PIN 에서도 동작하며, 나중에 지점별 PIN 을 분리하면 코드 변경
 * 없이 그대로 진짜 지점 격리가 된다(공통 PIN 인 동안은 어차피 PIN 만으로 지점을 구분할 수 없다).
 *
 * 관리자 PIN 은 어느 지점이든 통과한다(관리자가 지점 화면을 볼 때). server.ts 와 동일 로직으로 유지할 것.
 */
function verifyBranchPinOrAdmin(pinHash, branchName) {
  var target = String(branchName || "").trim();
  var cleanPinHash = String(pinHash || "").trim().toLowerCase();
  if (!target || !cleanPinHash) return null;

  var sheet = getSpreadsheet().getSheetByName(SHEETS.SETTING);
  var data = sheet.getDataRange().getValues();
  var branchRow = null;
  var adminMatched = false;
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (String(row[3]).toUpperCase() !== "TRUE") continue;
    // 지점 행은 첫 매칭만 채택한다 — 중복 행이 있어도 server.ts 와 같은 행을 고르게(파리티).
    if (!branchRow && String(row[0] || "").trim() === target) branchRow = row;
    if (!adminMatched && row[2] === "admin"
      && pinRowMatches_(String(row[1] || "").trim().toLowerCase(), cleanPinHash, "admin")) {
      adminMatched = true;
    }
  }
  // 관리자 PIN 도 "실제로 있는 활성 지점"에만 통과시킨다 — 임의 문자열이 그대로 카카오 부서명으로
  // 등록되는 것을 막는다(Codex P1 2026-07-28).
  if (!branchRow) return null;
  if (adminMatched) return { branchName: target, role: "admin", brand: branchRow[4] };
  if (pinRowMatches_(String(branchRow[1] || "").trim().toLowerCase(), cleanPinHash, branchRow[2])) {
    return { branchName: target, role: branchRow[2], brand: branchRow[4] };
  }
  return null;
}

/**
 * 지점 설정 시트에서 활성화된 계정 목록을 순서대로 생성합니다.
 * PIN 인증 응답에 함께 전달하여 로그인 직후의 별도 목록 조회를 없앱니다.
 */
function getActiveBranchesFromSettingsData(data) {
  const list = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[3]).toUpperCase() === "TRUE") {
      list.push({
        branchName: row[0],
        role: row[2],
        brand: row[4]
      });
    }
  }
  return list;
}

// SHA-256 해시 함수 (구글 앱스 스크립트용)
function getSha256(value) {
  const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  let output = "";
  for (let i = 0; i < rawHash.length; i++) {
    let byteVal = rawHash[i];
    if (byteVal < 0) byteVal += 256;
    let byteString = byteVal.toString(16);
    if (byteString.length == 1) byteString = "0" + byteString;
    output += byteString;
  }
  return output;
}

/**
 * 2. 지점_설정 시트 목록 반환
 */
function getBranchList() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.SETTING);
  const data = sheet.getDataRange().getValues();
  const list = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[3]).toUpperCase() === "TRUE") {
      list.push({
        branchName: row[0],
        role: row[2],
        brand: row[4]
      });
    }
  }
  return list;
}

/**
 * 2-A. 지점_설정 시트 비활성 포함 전체 목록 반환
 */
function getBranchListAll() {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.SETTING);
  const data = sheet.getDataRange().getValues();
  const list = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    list.push({
      branchName: row[0],
      role: row[2],
      isActive: String(row[3]).toUpperCase() === "TRUE",
      brand: row[4]
    });
  }
  return list;
}

/**
 * 지점별 직원 명단 조회
 */
function getStaffRoster(branchName) {
  const targetBranch = String(branchName || "").trim();
  if (!targetBranch) throw new Error("지점명이 필요합니다.");

  const sheet = getOrCreateRosterSheet();
  const data = sheet.getDataRange().getValues();
  const employees = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[0]).trim() === targetBranch) {
      employees.push({
        id: row[1],
        name: row[2],
        division: row[3],
        rank: row[4] || "",
        customRank: row[5] || ""
      });
    }
  }
  return employees;
}

/**
 * 지점별 직원 명단 전체 저장
 */
function saveStaffRoster(branchName, employees) {
  const targetBranch = String(branchName || "").trim();
  if (!targetBranch) throw new Error("지점명이 필요합니다.");
  if (!Array.isArray(employees)) throw new Error("직원 목록 형식이 올바르지 않습니다.");

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    throw new Error("서버가 다른 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.");
  }

  try {
    const sheet = getOrCreateRosterSheet();
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]).trim() === targetBranch) sheet.deleteRow(i + 1);
    }

    const now = new Date();
    const rows = employees
      .filter(function(emp) { return emp && String(emp.name || "").trim(); })
      .map(function(emp) {
        return [
          targetBranch,
          String(emp.id || generateUUID()),
          String(emp.name).trim(),
          String(emp.division || ""),
          String(emp.rank || ""),
          String(emp.customRank || emp.custom_rank || ""),
          now
        ];
      });
    if (rows.length > 0) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 7).setValues(rows);
    return { success: true, employees: getStaffRoster(targetBranch) };
  } finally {
    lock.releaseLock();
  }

  let staffMovementSheet = ss.getSheetByName(SHEETS.STAFF_MOVEMENT);
  if (!staffMovementSheet) {
    staffMovementSheet = ss.insertSheet(SHEETS.STAFF_MOVEMENT);
    staffMovementSheet.appendRow(["movement_id", "employee_id", "employee_name", "from_branch", "to_branch", "change_type", "effective_date", "recorded_at"]);
  }
}

function ensureSheetsSchema() {
  const ss = getSpreadsheet();
  const expense = ss.getSheetByName(SHEETS.EXPENSE);
  const staff = ss.getSheetByName(SHEETS.STAFF);
  if (expense && expense.getRange(1, 5).getValue() !== "branch_name") expense.getRange(1, 5).setValue("branch_name");
  if (staff && staff.getRange(1, 4).getValue() !== "branch_name") staff.getRange(1, 4).setValue("branch_name");
  if (staff && staff.getRange(1, 5).getValue() !== "division") staff.getRange(1, 5).setValue("division");
  if (!ss.getSheetByName(SHEETS.STAFF_MOVEMENT)) {
    const sheet = ss.insertSheet(SHEETS.STAFF_MOVEMENT);
    sheet.appendRow(["movement_id", "employee_id", "employee_name", "from_branch", "to_branch", "change_type", "effective_date", "recorded_at"]);
  }
}

function getOrCreateRosterSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.ROSTER);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.ROSTER);
    sheet.appendRow(["branch_name", "employee_id", "name", "division", "rank", "custom_rank", "updated_at"]);
  }
  return sheet;
}

function getOrCreateSharedDataSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.SHARED_DATA);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.SHARED_DATA);
    sheet.appendRow(["data_key", "json_value", "updated_at"]);
  }
  return sheet;
}

function getOrCreateSharedDataBackupSheet() {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName("shared_data_backups");
  if (!sheet) {
    sheet = ss.insertSheet("shared_data_backups");
    sheet.appendRow(["data_key", "json_value", "source_updated_at", "backed_up_at"]);
  }
  return sheet;
}

function backupSharedDataBeforeOverwrite(key, previousJson, previousUpdatedAt) {
  if (previousJson === undefined || previousJson === null || previousJson === "") return;
  const sheet = getOrCreateSharedDataBackupSheet();
  const now = new Date();
  sheet.appendRow([key, previousJson, previousUpdatedAt || "", now]);

  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === key && data[i][3] instanceof Date && data[i][3].getTime() < cutoff.getTime()) {
      sheet.deleteRow(i + 1);
    }
  }
}

function getSharedData(dataKey) {
  const key = String(dataKey || "").trim();
  if (!key) throw new Error("데이터 키가 필요합니다.");
  const data = getOrCreateSharedDataSheet().getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) {
      try { return JSON.parse(data[i][1]); } catch (e) { throw new Error("저장된 공통 데이터 형식이 올바르지 않습니다."); }
    }
  }
  return null;
}

function saveSharedData(dataKey, value) {
  const key = String(dataKey || "").trim();
  if (!key) throw new Error("데이터 키가 필요합니다.");
  const json = JSON.stringify(value === undefined ? null : value);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { throw new Error("서버가 다른 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요."); }
  try {
    const sheet = getOrCreateSharedDataSheet();
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === key) {
        backupSharedDataBeforeOverwrite(key, data[i][1], data[i][2]);
        sheet.getRange(i + 1, 2, 1, 2).setValues([[json, new Date()]]);
        return { success: true };
      }
    }
    sheet.appendRow([key, json, new Date()]);
    return { success: true };
  } finally { lock.releaseLock(); }
}

/**
 * 2-B. 신규 지점 등록
 */
function addBranch(branchName, pinHash, brand, role) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.SETTING);
  const data = sheet.getDataRange().getValues();
  
  const cleanBranchName = String(branchName || "").trim();
  const cleanBrand = String(brand || "").trim();
  const cleanPinHash = String(pinHash || "").trim();
  
  if (!cleanBranchName || !cleanPinHash || !cleanBrand) {
    throw new Error("지점명, 브랜드, PIN 번호 모두 필수 사양입니다.");
  }
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === cleanBranchName.toUpperCase()) {
      throw new Error("이미 존재하는 지점명입니다.");
    }
  }
  
  sheet.appendRow([cleanBranchName, cleanPinHash, role || "branch", "TRUE", cleanBrand]);
  return { success: true };
}

/**
 * 2-C. 지점 활성/비활성 여부 토글
 */
function toggleBranchActive(branchName, isActive) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.SETTING);
  const data = sheet.getDataRange().getValues();
  
  const targetName = String(branchName || "").trim().toUpperCase();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === targetName) {
      sheet.getRange(i + 1, 4).setValue(isActive ? "TRUE" : "FALSE");
      return { success: true };
    }
  }
  throw new Error("지점을 찾을 수 없습니다: " + branchName);
}

/**
 * 2-D. 지점 PIN 비밀번호 해시 업데이트
 */
function updateBranchPin(branchName, pinHash) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.SETTING);
  const data = sheet.getDataRange().getValues();
  
  const targetName = String(branchName || "").trim().toUpperCase();
  const cleanPinHash = String(pinHash || "").trim();
  if (!cleanPinHash) {
    throw new Error("새로운 비밀번호(PIN) 해시는 공란일 수 없습니다.");
  }
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === targetName) {
      sheet.getRange(i + 1, 2).setValue(cleanPinHash);
      return { success: true };
    }
  }
  throw new Error("지점을 찾을 수 없습니다: " + branchName);
}

/**
 * 2-E. 지점 삭제 완전히 수행
 */
function deleteBranch(branchName) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.SETTING);
  const data = sheet.getDataRange().getValues();
  
  const targetName = String(branchName || "").trim().toUpperCase();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toUpperCase() === targetName) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  throw new Error("지점을 찾을 수 없습니다: " + branchName);
}

/**
 * 3. 당일 중복 제출 여부 확인
 */
function checkDuplicate(branchName, settleDate) {
  const ss = getSpreadsheet();
  const sheet = ss.getSheetByName(SHEETS.MASTER);
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[1] === branchName && formatDate(row[2]) === settleDate) {
      return {
        exists: true,
        recordId: row[0],
        record: {
          recordId: row[0],
          branchName: row[1],
          settleDate: formatDate(row[2]),
          cashSales: Number(row[3]),
          cardSales: Number(row[4]),
          transferSales: Number(row[5]),
          deliverySales: Number(row[6]),
          totalSales: Number(row[7]),
          memo: row[8],
          submittedAt: row[9]
        }
      };
    }
  }
  return { exists: false, record: null };
}

/**
 * 일일마감 작성 화면용 최소 데이터 조회.
 * 전체 이력을 브라우저로 전송하지 않고, 당일 중복 여부와 전일 금고현금만 한 번에 반환한다.
 */
function getDailyFormBootstrap(branchName, settleDate) {
  const sheet = getSpreadsheet().getSheetByName(SHEETS.MASTER);
  const data = sheet.getDataRange().getValues();
  let duplicate = null;
  let previousRow = null;
  let previousDate = "";

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[1] !== branchName) continue;
    const rowDate = formatDate(row[2]);

    if (rowDate === settleDate) {
      duplicate = {
        recordId: row[0],
        branchName: row[1],
        settleDate: rowDate,
        cashSales: Number(row[3]),
        cardSales: Number(row[4]),
        transferSales: Number(row[5]),
        deliverySales: Number(row[6]),
        totalSales: Number(row[7]),
        memo: row[8],
        submittedAt: row[9]
      };
    }

    if (rowDate < settleDate && rowDate > previousDate) {
      previousDate = rowDate;
      previousRow = row;
    }
  }

  let previousCash = "0";
  if (previousRow) {
    const metadata = String(previousRow[8] || "").split("\n---\nMETADATA:")[1];
    if (metadata) {
      try {
        const parsed = JSON.parse(metadata.trim());
        if (parsed.cashBalance !== undefined) previousCash = String(parsed.cashBalance);
      } catch (e) {}
    }
  }

  return {
    exists: !!duplicate,
    recordId: duplicate ? duplicate.recordId : null,
    record: duplicate,
    previousCash: previousCash
  };
}

/**
 * 일지 화면에 필요한 근태 데이터만 반환한다. 대용량 마감 메모 전체를 전송하지 않아
 * 지점별 기록량 차이로 인한 탭 전환 지연을 줄인다.
 */
function getAttendanceLog(branchName, logType) {
  const masterValues = getSpreadsheet().getSheetByName(SHEETS.MASTER).getDataRange().getValues();
  const records = [];
  const aggregate = {};
  const isPartTime = logType === "partTime";

  for (let i = 1; i < masterValues.length; i++) {
    const row = masterValues[i];
    if (row[1] !== branchName) continue;

    const metadata = String(row[8] || "").split("\n---\nMETADATA:")[1];
    if (!metadata) continue;

    try {
      const staffRows = JSON.parse(metadata.trim()).staffRows || [];
      staffRows.forEach(function(staff) {
        const workHours = Number(staff.workHours || 0);
        const isTarget = isPartTime
          ? staff.division === "파트타이머" && workHours > 0
          : staff.division === "정직원" && Number(staff.overtime || 0) !== 0;
        if (!isTarget) return;

        const settleDate = formatDate(row[2]);
        const item = {
          settleDate: settleDate,
          staffName: staff.name,
          clockIn: staff.clockIn || "00:00",
          clockOut: staff.clockOut || "00:00",
          workHours: workHours,
          writer: row[10] || "점장"
        };

        if (isPartTime) {
          records.push(item);
          if (!aggregate[staff.name]) aggregate[staff.name] = { totalHours: 0, dates: {} };
          aggregate[staff.name].totalHours += workHours;
          aggregate[staff.name].dates[settleDate] = true;
        } else {
          const overtime = Number(staff.overtime || 0);
          item.standardHours = Number(staff.standardHours || 0);
          item.overtime = overtime;
          item.overtimeReason = staff.overtimeReason || "-";
          records.push(item);
          aggregate[staff.name] = (aggregate[staff.name] || 0) + overtime;
        }
      });
    } catch (e) {}
  }

  records.sort(function(a, b) { return b.settleDate.localeCompare(a.settleDate); });
  let summaryList;
  if (isPartTime) {
    summaryList = Object.keys(aggregate).map(function(name) {
      const dates = Object.keys(aggregate[name].dates).sort();
      return {
        name: name,
        totalHours: aggregate[name].totalHours,
        daysCount: dates.length,
        workedDaysList: dates.map(function(date) { return Number(date.split("-")[2]) + "일"; }).join(", ")
      };
    }).sort(function(a, b) { return b.totalHours - a.totalHours; });
  } else {
    summaryList = Object.keys(aggregate).map(function(name) {
      return { name: name, totalOvertime: aggregate[name] };
    }).sort(function(a, b) { return b.totalOvertime - a.totalOvertime; });
  }

  return { records: records, summaryList: summaryList };
}

/**
 * 4. 마감 데이터 전체 저장 (마스터_일일마감, 지출_상세, 인원_기록)
 */
function submitDaily(master, expenses, staff) {
  if (!master) {
    throw new Error("마감 데이터(master)가 누락되었습니다. 새로고침 후 다시 시도해 주세요.");
  }
  if (!master.branchName && !master.branch_name) {
    throw new Error("지점명이 누락된 마감 데이터입니다. 로그아웃 후 다시 로그인해 주세요.");
  }

  // 동시 제출 충돌 방지
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    throw new Error("서버가 다른 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.");
  }

  try {
    const ss = getSpreadsheet();
    const masterSheet = ss.getSheetByName(SHEETS.MASTER);
    const expenseSheet = ss.getSheetByName(SHEETS.EXPENSE);
    const staffSheet = ss.getSheetByName(SHEETS.STAFF);

    const m = master || {};
    const bName = m.branchName || m.branch_name || "Unknown Branch";
    const sDate = m.settleDate || m.settle_date || formatDate(new Date());

    const dupCheck = checkDuplicate(bName, sDate);
    if (dupCheck.exists) {
      // 락을 이미 보유한 상태이므로 _updateDailyCore 직접 호출 (데드락 방지)
      return _updateDailyCore(dupCheck.recordId, m, expenses || [], staff || [], "system_overwrite");
    }

    // 무작위 ID(generateUUID)로 떨어뜨리지 않는다 — 이 값이 Firestore 문서 ID로도 쓰이는데,
    // 규칙(`encodeURIComponent(지점)--날짜`)을 벗어나면 대시보드의 '지점+날짜로 콕 집어 읽기'가
    // 그 문서를 못 찾아 마감한 날이 '미제출'로 보인다(Codex 지적 2026-07-28).
    // firebaseDirect.ts 의 firebaseRecordId 와 같은 형식이어야 한다.
    //
    // 지점명이나 날짜가 없으면 규칙 ID를 만들 수 없다. 이때는 무작위 ID로 저장하지 않고 **거부**한다 —
    // 그렇게 저장된 마감은 지점·날짜로 찾을 수 없어 화면에서 영영 '미제출'로 남고, 집계에서도 빠진다.
    // 조용히 받아 두는 것보다 제출 시점에 실패를 알리는 편이 낫다.
    const idBranch = m.branchName || m.branch_name || "";
    const idDate = m.settleDate || m.settle_date || "";
    if (!m.recordId && !m.record_id && (!idBranch || !idDate)) {
      throw new Error("지점명과 정산일이 있어야 마감을 저장할 수 있습니다.");
    }
    const recordId = m.recordId || m.record_id || (encodeURIComponent(idBranch) + "--" + idDate);
    const submittedAt = new Date();
    const totalSales = Number(m.cashSales || m.cash_sales || 0) +
                       Number(m.cardSales || m.card_sales || 0) +
                       Number(m.transferSales || m.transfer_sales || 0) +
                       Number(m.deliverySales || m.delivery_sales || 0);

    masterSheet.appendRow([
      recordId,
      bName,
      sDate,
      Number(m.cashSales || m.cash_sales || 0),
      Number(m.cardSales || m.card_sales || 0),
      Number(m.transferSales || m.transfer_sales || 0),
      Number(m.deliverySales || m.delivery_sales || 0),
      totalSales,
      m.memo || "",
      submittedAt,
      m.submittedBy || m.submitted_by || "branch",
      "",
      ""
    ]);

    (expenses || []).forEach(function(exp) {
      if (exp && exp.itemName && exp.amount) {
        expenseSheet.appendRow([recordId, exp.expenseType, exp.itemName, Number(exp.amount), bName]);
      }
    });

    (staff || []).forEach(function(st) {
      if (st && st.staffName && st.workHours) {
        staffSheet.appendRow([recordId, st.staffName, Number(st.workHours), bName, st.division || ""]);
      }
    });

    return { recordId: recordId };

  } finally {
    lock.releaseLock();
  }
}

/**
 * 5-내부. 락 없이 수정 처리 (submitDaily 내부의 중복 처리용)
 */
function _updateDailyCore(recordId, masterData, expenses, staff, modifiedBy) {
  const ss = getSpreadsheet();
  const masterSheet = ss.getSheetByName(SHEETS.MASTER);
  const expenseSheet = ss.getSheetByName(SHEETS.EXPENSE);
  const staffSheet = ss.getSheetByName(SHEETS.STAFF);
  const logSheet = ss.getSheetByName(SHEETS.LOG);

  const masterValues = masterSheet.getDataRange().getValues();

  let targetRowIndex = -1;
  for (let i = 1; i < masterValues.length; i++) {
    if (masterValues[i][0] === recordId) {
      targetRowIndex = i + 1;
      break;
    }
  }

  if (targetRowIndex === -1) {
    throw new Error("수정하려는 정산 레코드를 찾을 수 없습니다: " + recordId);
  }

  const oldRow = masterValues[targetRowIndex - 1];
  const oldCash = Number(oldRow[3]);
  const oldCard = Number(oldRow[4]);
  const oldTransfer = Number(oldRow[5]);
  const oldDelivery = Number(oldRow[6]);
  const oldMemo = oldRow[8];

  const mData = masterData || {};
  const newCash = Number(mData.cashSales !== undefined ? mData.cashSales : (mData.cash_sales !== undefined ? mData.cash_sales : oldCash));
  const newCard = Number(mData.cardSales !== undefined ? mData.cardSales : (mData.card_sales !== undefined ? mData.card_sales : oldCard));
  const newTransfer = Number(mData.transferSales !== undefined ? mData.transferSales : (mData.transfer_sales !== undefined ? mData.transfer_sales : oldTransfer));
  const newDelivery = Number(mData.deliverySales !== undefined ? mData.deliverySales : (mData.delivery_sales !== undefined ? mData.delivery_sales : oldDelivery));
  const newMemo = mData.memo !== undefined ? mData.memo : oldMemo;
  const newTotal = newCash + newCard + newTransfer + newDelivery;
  const modifiedAt = new Date();

  const fieldsToCheck = [
    { name: "cash_sales", oldVal: oldCash, newVal: newCash, colNum: 4 },
    { name: "card_sales", oldVal: oldCard, newVal: newCard, colNum: 5 },
    { name: "transfer_sales", oldVal: oldTransfer, newVal: newTransfer, colNum: 6 },
    { name: "delivery_sales", oldVal: oldDelivery, newVal: newDelivery, colNum: 7 },
    { name: "memo", oldVal: oldMemo, newVal: newMemo, colNum: 9 }
  ];

  fieldsToCheck.forEach(function(f) {
    if (f.oldVal !== f.newVal) {
      logSheet.appendRow([generateUUID(), recordId, f.name, String(f.oldVal), String(f.newVal), modifiedBy, modifiedAt]);
      masterSheet.getRange(targetRowIndex, f.colNum).setValue(f.newVal);
    }
  });

  masterSheet.getRange(targetRowIndex, 8).setValue(newTotal);
  masterSheet.getRange(targetRowIndex, 12).setValue(modifiedAt);
  masterSheet.getRange(targetRowIndex, 13).setValue(modifiedBy);

  if (expenses) {
    const expValues = expenseSheet.getDataRange().getValues();
    for (let i = expValues.length - 1; i >= 1; i--) {
      if (expValues[i][0] === recordId) expenseSheet.deleteRow(i + 1);
    }
    expenses.forEach(function(exp) {
      if (exp && exp.itemName && exp.amount) {
        expenseSheet.appendRow([recordId, exp.expenseType, exp.itemName, Number(exp.amount), oldRow[1]]);
      }
    });
  }

  if (staff) {
    const staffValues = staffSheet.getDataRange().getValues();
    for (let i = staffValues.length - 1; i >= 1; i--) {
      if (staffValues[i][0] === recordId) staffSheet.deleteRow(i + 1);
    }
    staff.forEach(function(st) {
      if (st && st.staffName && st.workHours) {
        staffSheet.appendRow([recordId, st.staffName, Number(st.workHours), oldRow[1], st.division || ""]);
      }
    });
  }

  return { success: true };
}

/**
 * 5. 기존 데이터 관리자 수정 (마스터 UPDATE, 지출/인원 재생성, 수정_로그 기록)
 */
function updateDaily(recordId, masterData, expenses, staff, modifiedBy) {
  // 동시 수정 충돌 방지
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    throw new Error("서버가 다른 요청을 처리 중입니다. 잠시 후 다시 시도해 주세요.");
  }

  try {
    return _updateDailyCore(recordId, masterData, expenses, staff, modifiedBy);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 6. 날짜별 전 지점 현황 조회
 */
function getDailyList(settleDate, adminPinHash) {
  // 관리자 검증 수행 (원하면 명시적 검증 가능)
  if (adminPinHash) {
    try {
      verifyPin(adminPinHash);
    } catch (e) {
      throw new Error("관리자 인증 실패: 로그인이 만료되었거나 올바르지 않습니다.");
    }
  }

  const ss = getSpreadsheet();
  
  // 전체 지점(지점_설정)
  const branches = getBranchList().filter(b => b.role === "branch");

  // 마스터 전체 조회
  const masterSheet = ss.getSheetByName(SHEETS.MASTER);
  const masterValues = masterSheet.getDataRange().getValues();
  
  const dailyMasters = {};
  for (let i = 1; i < masterValues.length; i++) {
    const row = masterValues[i];
    const sDate = formatDate(row[2]);
    if (sDate === settleDate) {
      dailyMasters[row[1]] = {
        recordId: row[0],
        branchName: row[1],
        settleDate: sDate,
        cashSales: Number(row[3]),
        cardSales: Number(row[4]),
        transferSales: Number(row[5]),
        deliverySales: Number(row[6]),
        totalSales: Number(row[7]),
        memo: row[8],
        submittedAt: row[9],
        submittedBy: row[10],
        modifiedAt: row[11],
        modifiedBy: row[12]
      };
    }
  }

  // 지점 설정 목록 기준으로 제출상태 포함한 리스트 생성
  const list = branches.map(b => {
    const m = dailyMasters[b.branchName];
    return {
      branchName: b.branchName,
      brand: b.brand,
      role: b.role,
      submitted: !!m,
      record: m || null
    };
  });

  return list;
}

/**
 * 7. 특정 레코드 상세 조회
 */
function getDailyDetail(recordId) {
  const ss = getSpreadsheet();
  
  // 1. 마스터 조회
  const masterSheet = ss.getSheetByName(SHEETS.MASTER);
  const masterValues = masterSheet.getDataRange().getValues();
  let master = null;
  for (let i = 1; i < masterValues.length; i++) {
    const row = masterValues[i];
    if (row[0] === recordId) {
      master = {
        recordId: row[0],
        branchName: row[1],
        settleDate: formatDate(row[2]),
        cashSales: Number(row[3]),
        cardSales: Number(row[4]),
        transferSales: Number(row[5]),
        deliverySales: Number(row[6]),
        totalSales: Number(row[7]),
        memo: row[8],
        submittedAt: row[9],
        submittedBy: row[10],
        modifiedAt: row[11],
        modifiedBy: row[12]
      };
      break;
    }
  }

  if (!master) {
    throw new Error("해당 마감 정산 데이터를 찾을 수 없습니다: " + recordId);
  }

  // 2. 지출 상세 조회
  const expenseSheet = ss.getSheetByName(SHEETS.EXPENSE);
  const expenseValues = expenseSheet.getDataRange().getValues();
  const expenses = [];
  for (let i = 1; i < expenseValues.length; i++) {
    const row = expenseValues[i];
    if (row[0] === recordId) {
      expenses.push({
        expenseType: row[1],
        itemName: row[2],
        amount: Number(row[3])
      });
    }
  }

  // 3. 인원 기록 조회
  const staffSheet = ss.getSheetByName(SHEETS.STAFF);
  const staffValues = staffSheet.getDataRange().getValues();
  const staff = [];
  for (let i = 1; i < staffValues.length; i++) {
    const row = staffValues[i];
    if (row[0] === recordId) {
      staff.push({
        staffName: row[1],
        workHours: Number(row[2])
      });
    }
  }

  return {
    master: master,
    expenses: expenses,
    staff: staff
  };
}

/**
 * 특정 지점의 모든 마감 기록 조회 (히스토리)
 */
function getBranchHistory(branchName, month) {
  const ss = getSpreadsheet();
  const masterSheet = ss.getSheetByName(SHEETS.MASTER);
  const masterValues = masterSheet.getDataRange().getValues();
  const history = [];
  
  for (let i = 1; i < masterValues.length; i++) {
    const row = masterValues[i];
    const settleDate = formatDate(row[2]);
    if (row[1] === branchName && (!month || settleDate.indexOf(String(month)) === 0)) {
      history.push({
        recordId: row[0],
        branchName: row[1],
        settleDate: settleDate,
        cashSales: Number(row[3]),
        cardSales: Number(row[4]),
        transferSales: Number(row[5]),
        deliverySales: Number(row[6]),
        totalSales: Number(row[7]),
        memo: row[8],
        submittedAt: row[9],
        submittedBy: row[10],
        modifiedAt: row[11],
        modifiedBy: row[12]
      });
    }
  }
  
  // Sort by date descending
  history.sort((a, b) => b.settleDate.localeCompare(a.settleDate));
  return history;
}

// ----------------------------------------------------
// 보조 유틸 함수들
// ----------------------------------------------------

/**
 * 날짜 포맷팅 (YYYY-MM-DD)
 */
function formatDate(dateVal) {
  if (!dateVal) return "";
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);
  
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * UUID v4 생성 대체기
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ----------------------------------------------------
// 카카오T 비즈니스(법인택시) API 프록시
// 시크릿은 저장소에 두지 않는다 — Apps Script 편집기 > 프로젝트 설정 > 스크립트 속성에
// KAKAO_T_CORP_ID(T 비즈 ID), KAKAO_T_SECRET(이메일로 받은 토큰) 두 개를 등록해야 동작한다.
// 로컬 개발은 server.ts 가 같은 액션명을 .env 값으로 처리한다(양쪽 로직을 같이 고칠 것).
// ----------------------------------------------------
const KAKAO_TAXI_BASE = "https://b2b-api.kakaomobility.com";

// 관리자 PIN 검증 게이트 — 카카오T 액션 전체(조회 포함)에 강제. 실패 유형과 무관하게
// 같은 문구로 답해 PIN 존재 여부를 밖에서 구분할 수 없게 한다.
function requireKakaoTaxiAdmin(adminPinHash) {
  const denied = new Error("법인택시 메뉴는 관리자만 사용할 수 있습니다. 다시 로그인해주세요.");
  if (!adminPinHash) throw denied;
  let setting;
  try {
    setting = verifyPin(adminPinHash);
  } catch (e) {
    throw denied;
  }
  if (!setting || setting.role !== "admin") throw denied;
}

// 쓰기 액션 전용 — 계정을 반드시 명시받는다. 기본값을 두면 엉뚱한 계정에 삭제·수정이 나간다.
function requireKakaoAccountKey(accountKey) {
  var key = String(accountKey || "").trim();
  if (!key) throw new Error("대상 카카오T 계정이 지정되지 않았습니다. 화면을 새로고침한 뒤 다시 시도해주세요.");
  kakaoTaxiCredentials(key); // 등록된 계정인지 확인 — 아니면 던진다
  return key;
}

// 카카오T 비즈니스 계정 레지스트리.
// 계정 #1 은 기존 속성 이름을 그대로 쓴다 — 속성 재등록 없이 기존 동작이 유지된다.
// [동기화] server.ts 의 KAKAO_TAXI_ACCOUNTS, src/pages/admin/helpers/kakaoTaxi.ts 의 계정 라벨.
var KAKAO_TAXI_ACCOUNTS = [
  { key: "acct1", label: "1계정", corpIdProp: "KAKAO_T_CORP_ID", secretProp: "KAKAO_T_SECRET" },
  { key: "acct2", label: "2계정", corpIdProp: "KAKAO_T_CORP_ID_2", secretProp: "KAKAO_T_SECRET_2" }
];

// 스크립트 속성이 등록된 계정만 돌려준다. 코드가 먼저 배포되고 속성 등록이 늦어도
// 기존 계정만으로 지금과 똑같이 동작한다(배포 순서 사고 방지).
function kakaoTaxiAccounts() {
  var out = [];
  for (var i = 0; i < KAKAO_TAXI_ACCOUNTS.length; i++) {
    var acc = KAKAO_TAXI_ACCOUNTS[i];
    var corpId = PROPERTIES.getProperty(acc.corpIdProp);
    var secret = PROPERTIES.getProperty(acc.secretProp);
    if (corpId && secret) out.push({ key: acc.key, label: acc.label, corpId: corpId, secret: secret });
  }
  if (!out.length) {
    throw new Error("카카오T 연동 정보가 등록되지 않았습니다. Apps Script 스크립트 속성에 KAKAO_T_CORP_ID / KAKAO_T_SECRET 를 등록해주세요.");
  }
  return out;
}

function kakaoTaxiCredentials(accountKey) {
  var accounts = kakaoTaxiAccounts();
  for (var i = 0; i < accounts.length; i++) {
    if (accounts[i].key === accountKey) return accounts[i];
  }
  throw new Error("등록되지 않은 카카오T 계정입니다: " + accountKey);
}

// 서명된 요청 객체를 만든다 — UrlFetchApp.fetch(단건)와 fetchAll(병렬 페이지 수집) 양쪽에서 쓴다.
// 요청마다 nonce·timestamp 가 달라야 하므로 재사용하지 말고 매번 새로 만들 것.
function kakaoTaxiBuildRequest(accountKey, method, path, query, body) {
  const cred = kakaoTaxiCredentials(accountKey);
  // [주의] 서명 URL에는 쿼리 파라미터를 넣지 않는다.
  // 넣으면 카카오가 90003("인증 토큰이 유효하지 않습니다")을 돌려준다 — 2026-07-24 실계정에서 확인.
  const signUrl = KAKAO_TAXI_BASE + path;
  const nonce = String(Math.floor(Math.random() * 100000));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const message = nonce + "\n" + signUrl + "\n" + method + "\n" + cred.corpId + "\n" + timestamp + "\n" + nonce;
  const token = Utilities.base64Encode(
    Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_1, message, cred.secret)
  );
  const request = {
    url: KAKAO_TAXI_BASE + path + (query ? "?" + query : ""),
    method: method.toLowerCase(),
    muteHttpExceptions: true,
    headers: {
      "Authorization": "Token " + token,
      "x-mob-b2b-corp-id": cred.corpId,
      "x-mob-b2b-nonce": nonce,
      "x-mob-b2b-timestamp": timestamp
    }
  };
  if (body) {
    request.contentType = "application/json";
    request.payload = JSON.stringify(body);
  }
  return request;
}

function kakaoTaxiParseResponse(res) {
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code < 200 || code >= 300) {
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.error) detail = parsed.error;
    } catch (ignore) {}
    throw new Error("카카오T API 오류(" + code + "): " + detail);
  }
  if (!text) return null; // send_tms 등 본문 없는 성공 응답
  try { return JSON.parse(text); } catch (ignore) { return null; }
}

function kakaoTaxiFetch(accountKey, method, path, query, body) {
  const req = kakaoTaxiBuildRequest(accountKey, method, path, query, body);
  const res = UrlFetchApp.fetch(req.url, req);
  return kakaoTaxiParseResponse(res);
}

// [성능] 카카오 목록 API(100건/페이지)를 순차 왕복하면 페이지당 3~5초가 누적된다.
// 1페이지로 총 건수를 알아낸 뒤 나머지 페이지를 fetchAll 로 한꺼번에 받는다.
// per=100 × 50페이지 = 5,000건 상한 — 월 200여 건 규모에서 사실상 무제한이자 폭주 방지선.
function kakaoTaxiFetchAllPages(accountKey, path, baseQuery, listKey) {
  const pageQuery = function (page) {
    return (baseQuery ? baseQuery + "&" : "") + "per=100&page=" + page;
  };
  const first = kakaoTaxiFetch(accountKey, "GET", path, pageQuery(1), null);
  const firstBatch = (first && first[listKey]) || [];
  const reportedCount = (first && typeof first.count === "number") ? first.count : firstBatch.length;
  const items = firstBatch.slice();
  const totalPages = Math.min(50, Math.ceil(reportedCount / 100));
  if (firstBatch.length >= 100 && totalPages > 1) {
    const requests = [];
    for (let page = 2; page <= totalPages; page++) {
      requests.push(kakaoTaxiBuildRequest(accountKey, "GET", path, pageQuery(page), null));
    }
    const responses = UrlFetchApp.fetchAll(requests);
    for (let r = 0; r < responses.length; r++) {
      // 한 페이지라도 실패하면 전체를 실패로 처리한다 — 일부 누락본을 정상 자료처럼 돌려주지 않는다.
      const parsed = kakaoTaxiParseResponse(responses[r]);
      const batch = (parsed && parsed[listKey]) || [];
      for (let j = 0; j < batch.length; j++) items.push(batch[j]);
    }
  }
  // count 는 카카오가 보고한 총 건수 — 수집 도중 새 건이 생기면 수집본과 어긋날 수 있고, 화면이 경고한다.
  return { count: reportedCount, items: items };
}

// 등록된 계정을 순회하며 collect(account) 를 부르고 결과를 합친다.
// 한 계정이 실패해도 나머지는 살린다 — 대신 실패 사실을 accountErrors 로 올려보내
// 화면이 "이 집계에 빠진 계정이 있다"고 빨간 배너로 알린다(조용한 금액 축소 방지).
// 전부 실패하면 기존처럼 오류를 던진다.
function kakaoTaxiCollect(collect) {
  var accounts = kakaoTaxiAccounts();
  var items = [];
  var errors = [];
  for (var i = 0; i < accounts.length; i++) {
    var acc = accounts[i];
    try {
      var got = collect(acc) || [];
      for (var j = 0; j < got.length; j++) {
        got[j].account_key = acc.key;   // 화면 계정 컬럼·필터·memberKey 의 근거
        items.push(got[j]);
      }
    } catch (e) {
      errors.push({ key: acc.key, label: acc.label, message: String((e && e.message) || e) });
    }
  }
  if (errors.length === accounts.length) {
    throw new Error("카카오T 조회에 실패했습니다: " + errors[0].message);
  }
  return { items: items, accountErrors: errors };
}

// 이 수집본을 "완전한 스냅샷"으로 캐시해도 되는가.
// 화면(normalizeKakaoTaxiOrders)은 id 중복을 걸러낸 뒤 건수를 비교하므로, 원본 길이만 보면
// '중복+누락이 상쇄된' 불량 스냅샷이 통과한다 — id 가 전부 존재하고 서로 달라야만 캐시한다.
function kakaoTaxiSnapshotComplete(items, count) {
  if (items.length !== count) return false;
  const seen = {};
  for (let i = 0; i < items.length; i++) {
    const id = String((items[i] && items[i].id) || "");
    if (!id || seen[id]) return false;
    seen[id] = true;
  }
  return true;
}

function kakaoTaxiMonthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ""))) {
    throw new Error("조회 월 형식이 올바르지 않습니다(YYYY-MM): " + month);
  }
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const lastDay = new Date(y, m, 0).getDate();
  return { start: month + "-01", end: month + "-" + (lastDay < 10 ? "0" + lastDay : String(lastDay)) };
}

// [성능] 이용내역 캐시 — 지나간 달은 마감된 불변 자료라 길게(ScriptCache 최대 6시간),
// 당월은 새 이용이 계속 생기므로 짧게 둔다. 화면 '새로고침'은 forceRefresh 로 캐시를 우회한다.
var KAKAO_ORDERS_CACHE_TTL_CURRENT = 180;  // 초
var KAKAO_ORDERS_CACHE_TTL_CLOSED = 21600; // 초 (ScriptCache 상한)

function kakaoTaxiOrdersCacheKey(accountKey, month) {
  // 세대 번호 포함 — 직원 쓰기 시 kakaoTaxiInvalidateOrdersCache 가 번호를 올려 전 월 캐시를 무효화한다.
  // 계정별로 따로 캐싱한다 — 한쪽이 실패해도 다른 쪽 캐시가 살아 있고, 100KB 상한도 분산된다.
  // v3: 캐시 값을 {count, items} 로 바꿔 카카오 "보고" 건수도 함께 저장한다(B2 건수 대사 복원) —
  // 옛 v2 는 배열만 저장했으므로 잘못 읽지 않도록 버전을 올렸다.
  return "kakao_taxi_orders_v3_" + kakaoTaxiOrdersCacheVersion() + "_" + accountKey + "_" + month;
}

// 월별 이용내역 전량 수집. 조회 기간은 카카오 제한(최대 1개월)에 맞춰 항상 한 달 단위다.
function getKakaoTaxiOrders(month, forceRefresh) {
  const range = kakaoTaxiMonthRange(month); // 형식 검증 겸용 — 캐시 키에 이상값이 섞이지 않게 먼저 부른다
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  const nowMonth = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM");
  var reportedCounts = {}; // 계정별 카카오 "보고" 건수 — 성공한 계정만 채워진다(B2).

  const collected = kakaoTaxiCollect(function (acc) {
    const cacheKey = kakaoTaxiOrdersCacheKey(acc.key, month);
    if (cache && !forceRefresh) {
      const cached = cache.get(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          reportedCounts[acc.key] = parsed.count;
          return parsed.items;
        } catch (e) { /* 손상 시 아래에서 재조회 */ }
      }
    }
    const res = kakaoTaxiFetchAllPages(
      acc.key,
      "/external/v2/orders",
      "start_date=" + range.start + "&end_date=" + range.end,
      "orders"
    );
    reportedCounts[acc.key] = res.count;
    // 건수가 어긋나거나 id 중복/누락이 있는 스냅샷은 캐시하지 않는다 — 캐시하면 '새로고침' 전까지 경고가 반복된다.
    if (cache && kakaoTaxiSnapshotComplete(res.items, res.count)) {
      const ttl = month < nowMonth ? KAKAO_ORDERS_CACHE_TTL_CLOSED : KAKAO_ORDERS_CACHE_TTL_CURRENT;
      // 캐시 값은 최대 100KB — 초과하면 put 이 던지므로 실패는 무시(그 달만 실시간 조회로 동작).
      try { cache.put(cacheKey, JSON.stringify({ count: res.count, items: res.items }), ttl); } catch (e) {}
    }
    return res.items;
  });

  // [B2] count = 성공한 계정들의 카카오 "보고" 건수 합. collected.items.length(수집본 길이)를 쓰면
  // 화면의 "수집본 vs 카카오 보고" 건수 대사 경고가 절대 안 뜬다 — 실패한 계정은 accountErrors 로
  // 이미 알리므로 이 합계에서는 자연히 제외된다(reportedCounts 에 안 채워짐).
  // 캐시 적중 시에는 kakaoTaxiSnapshotComplete 가 캐시 전에 이미 count === items.length 를 보장했으므로
  // 이 합계도 결국 items.length 와 같다 — 대사는 라이브 조회 도중 드리프트가 난 경우에만 실제로 작동한다.
  var reportedTotal = 0;
  for (var accKey in reportedCounts) {
    if (Object.prototype.hasOwnProperty.call(reportedCounts, accKey)) reportedTotal += reportedCounts[accKey];
  }

  return {
    month: month,
    count: reportedTotal,
    orders: collected.items,
    accountErrors: collected.accountErrors
  };
}

// [성능] 그룹 캐시 — 그룹 생성/변경은 카카오 관리 웹에서만 일어나는 드문 외부 변경이라 짧은 TTL 로 충분.
// 직원 관리 '새로고침'은 forceRefresh 로 우회해 즉시 최신을 받는다.
var KAKAO_GROUPS_CACHE_KEY = "kakao_taxi_groups_v1";
var KAKAO_GROUPS_CACHE_TTL = 300; // 초

function kakaoTaxiGroupsCacheKey(accountKey) {
  return KAKAO_GROUPS_CACHE_KEY + "_" + accountKey;
}

// 쓰기 경로 전용 — 특정 계정의 그룹만 실시간으로 받는다(캐시 미사용).
// 방금 만든/바꾼 그룹을 못 찾아 오등록되는 것을 막기 위해 조회용 캐시를 쓰지 않는다.
function kakaoTaxiAccountGroups(accountKey) {
  const groups = kakaoTaxiFetch(accountKey, "GET", "/external/v1/groups", null, null) || [];
  for (var i = 0; i < groups.length; i++) groups[i].account_key = accountKey;
  return groups;
}

function getKakaoTaxiGroups(forceRefresh) {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  const collected = kakaoTaxiCollect(function (acc) {
    const key = kakaoTaxiGroupsCacheKey(acc.key);
    if (cache && !forceRefresh) {
      const cached = cache.get(key);
      if (cached) {
        try { return JSON.parse(cached); } catch (e) { /* 손상 시 재조회 */ }
      }
    }
    const groups = kakaoTaxiFetch(acc.key, "GET", "/external/v1/groups", null, null) || [];
    if (cache) {
      try { cache.put(key, JSON.stringify(groups), KAKAO_GROUPS_CACHE_TTL); } catch (e) {}
    }
    return groups;
  });
  return { groups: collected.items, accountErrors: collected.accountErrors };
}

// 인증완료 직원 전량 수집. 카카오는 인증완료(connected) 직원만 목록 조회를 제공한다 —
// 등록만 하고 아직 인증 안 한 직원은 여기 안 나오므로 화면에서 그 사실을 안내한다.
//
// [성능] 지점/관리자 화면이 이 목록을 반복 조회하는데, 카카오 왕복이 매번 3~5초 걸린다.
// ScriptCache 에 짧게 캐싱하고, 우리가 카카오에 쓰는 시점(등록·수정·삭제·휴직)마다 비운다.
// [주의] 직원 '인증 완료'는 직원 폰에서 우리 시스템 밖에서 일어나 무효화할 수 없다 →
// 방금 인증한 직원이 캐시 만료 전까지 목록에 안 뜰 수 있으므로 (1) TTL 을 짧게 두고
// (2) 화면 '새로고침'은 forceRefresh 로 캐시를 우회해 즉시 실시간 조회 후 캐시를 갱신한다.
var KAKAO_MEMBERS_CACHE_KEY = "kakao_taxi_members_v1";
var KAKAO_MEMBERS_CACHE_TTL = 90; // 초. 외부 인증 반영 지연을 줄이려 5분→90초. 새로고침은 forceRefresh 로 우회.

// 특정 계정의 직원 캐시를 지운다. accountKey 를 안 주면 전 계정을 지운다(안전 쪽).
function kakaoTaxiInvalidateMembersCache(accountKey) {
  try {
    var cache = CacheService.getScriptCache();
    if (accountKey) {
      cache.remove(kakaoTaxiMembersCacheKey(accountKey));
    } else {
      for (var i = 0; i < KAKAO_TAXI_ACCOUNTS.length; i++) {
        cache.remove(kakaoTaxiMembersCacheKey(KAKAO_TAXI_ACCOUNTS[i].key));
      }
    }
  } catch (e) {}
  // 직원 정보(특히 부서=지점)를 고치면 이용내역의 지점/직원 집계도 달라진다 — 카카오가 이용내역에
  // 조회 시점의 직원 정보(member_department 등)를 실어 주기 때문. 이용내역 캐시도 함께 무효화해
  // "부서를 고쳤는데 집계가 그대로"인 상황을 막는다. 모든 직원 쓰기 경로가 이 함수를 지난다.
  kakaoTaxiInvalidateOrdersCache();
}

// ScriptCache 는 키 열거·일괄 삭제가 안 돼 월별 이용내역 키를 직접 지울 수 없다 —
// 캐시 키에 들어가는 세대 번호를 올려 기존 항목 전부를 자연 만료(TTL)로 흘려보낸다.
var KAKAO_ORDERS_CACHE_VER_PROP = "KAKAO_TAXI_ORDERS_CACHE_VER";

function kakaoTaxiOrdersCacheVersion() {
  try { return PROPERTIES.getProperty(KAKAO_ORDERS_CACHE_VER_PROP) || "0"; } catch (e) { return "0"; }
}

function kakaoTaxiInvalidateOrdersCache() {
  // [실패 허용] 카카오 쓰기는 이미 성공한 뒤라 여기서 던지면 성공한 변경이 실패로 보인다 — 삼킨다.
  // 속성 저장이 실패하면 묵은 집계가 TTL 까지 남을 수 있지만, 화면 '새로고침'(forceRefresh)이
  // 그 월 캐시를 신선한 데이터로 덮어써 자가 복구된다.
  // [동시 쓰기] 두 쓰기가 같은 번호를 읽고 같이 +1 해도 무해 — 각 쓰기가 카카오 반영 '이후'에
  // 번호를 올리므로, 마지막 쓰기 이후 최소 1회 증가가 보장되어 묵은 항목은 어느 경우든 죽는다.
  try {
    const cur = Number(kakaoTaxiOrdersCacheVersion()) || 0;
    PROPERTIES.setProperty(KAKAO_ORDERS_CACHE_VER_PROP, String(cur + 1));
  } catch (e) {}
}

function kakaoTaxiMembersCacheKey(accountKey) {
  return KAKAO_MEMBERS_CACHE_KEY + "_" + accountKey;
}

function getKakaoTaxiMembers(forceRefresh) {
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  const collected = kakaoTaxiCollect(function (acc) {
    const key = kakaoTaxiMembersCacheKey(acc.key);
    if (cache && !forceRefresh) {
      var cached = cache.get(key);
      if (cached) {
        try { return JSON.parse(cached); } catch (e) { /* 손상 시 재조회 */ }
      }
    }
    const res = kakaoTaxiFetchAllPages(acc.key, "/external/v2/members/connected", "", "members");
    // 캐시 값은 최대 100KB — 인원이 많아 초과하면 put 이 던지므로, 캐싱 실패는 무시하고 그대로 반환.
    if (cache) {
      try { cache.put(key, JSON.stringify(res.items), KAKAO_MEMBERS_CACHE_TTL); } catch (e) {}
    }
    return res.items;
  });
  return { count: collected.items.length, members: collected.items, accountErrors: collected.accountErrors };
}

// 검증은 정규화(숫자만 남긴 전화·공백 제거한 그룹id) 이후 값으로 한다 — raw 값만 보면
// "---" 같은 전화나 [""] 그룹이 통과해 카카오까지 갔다가 애매한 오류로 돌아온다.
// server.ts 로컬 프록시와 검증 기준을 같게 유지할 것.
function kakaoTaxiNormalizeContact(member) {
  const m = member || {};
  return {
    phone: String(m.mobile_phone || "").replace(/[^0-9]/g, ""),
    groupIds: (Array.isArray(m.group_ids) ? m.group_ids : [])
      .map(function (id) { return String(id || "").trim(); })
      .filter(function (id) { return !!id; })
  };
}

// 카카오 부서 표기 → ERP 지점명 별칭표.
// [동기화] src/pages/admin/helpers/kakaoTaxi.ts 의 KAKAO_BRANCH_ALIASES, server.ts 와 세 곳을 같게 유지할 것.
var KAKAO_TAXI_BRANCH_ALIASES = {
  "금샤빠 을지로": "금샤빠",
  "대물섬 한남동": "대물섬 한남점",
  "대골뼈국": "강남대골뼈국",
  "대물섬종로점": "대물섬 종로점"
};

// 지점 → 카카오T 계정. 미기재 지점은 계정 #1(기본값).
// [동기화] server.ts, src/pages/admin/helpers/kakaoTaxi.ts 와 세 곳을 같게 유지할 것.
var KAKAO_ACCOUNT_BY_BRANCH = {
  "사카바단단": "acct2",
  "8번대물집": "acct2"
};

function kakaoTaxiAccountForBranch(branchName) {
  return KAKAO_ACCOUNT_BY_BRANCH[String(branchName || "").trim()] || "acct1";
}

// 지점 화면용 — 요청한 PIN 의 지점(관리자는 임의 지점)에 매핑되는 인증완료 인원만 반환.
// 타 지점 직원의 이름·전화번호가 지점에 노출되지 않도록 필터는 반드시 여기(백엔드)에서 한다.
function getKakaoTaxiBranchMembers(pinHash, branchName, forceRefresh) {
  const denied = new Error("지점 인증에 실패했습니다. 다시 로그인해주세요.");
  if (!pinHash || !branchName) throw denied;
  // 요청한 지점 행에서 직접 대조한다 — verifyPin(역방향)은 공통 PIN 에서 첫 행만 통과시킨다.
  let setting;
  try {
    setting = verifyBranchPinOrAdmin(pinHash, branchName);
  } catch (e) {
    throw denied;
  }
  if (!setting) throw denied;
  const all = getKakaoTaxiMembers(forceRefresh).members || [];
  return all.filter(function (m) {
    const dept = String((m && m.department) || "").trim();
    if (!dept) return false;
    return dept === branchName || KAKAO_TAXI_BRANCH_ALIASES[dept] === branchName;
  });
}

function registerKakaoTaxiMember(accountKey, member) {
  const m = member || {};
  const norm = kakaoTaxiNormalizeContact(m);
  if (!m.identifier || !norm.phone || !norm.groupIds.length) {
    throw new Error("직원 등록에는 사번(identifier)·휴대전화번호·그룹이 모두 필요합니다.");
  }
  const body = {
    identifier: String(m.identifier),
    mobile_phone: norm.phone,
    group_ids: norm.groupIds
  };
  if (m.name) body.name = String(m.name);
  if (m.department) body.department = String(m.department);
  const res = kakaoTaxiFetch(accountKey, "POST", "/external/v1/members", null, body);
  kakaoTaxiInvalidateMembersCache(accountKey);
  return res;
}

// 지점명 → { 계정, 활성(enabled) 그룹 id }. 지점 자동등록은 지점이 그룹을 직접 고르지 않으므로
// 백엔드가 정한다. 못 찾으면 groupId 가 null → 호출부가 거부(오등록 방지).
// [주의] 계정 #1 에도 사카바단단·8번대물집 이름의 껍데기 그룹이 있으므로 반드시 매핑표가 정한
// 계정 안에서만 찾는다. 계정 전체를 뒤지면 엉뚱한 계정에 등록된다.
function kakaoTaxiGroupIdForBranch(branchName) {
  const target = String(branchName || "").trim();
  const accountKey = kakaoTaxiAccountForBranch(target);
  if (!target) return { accountKey: accountKey, groupId: null };
  // [쓰기 경로] 조회용 캐시(최대 5분 묵음)를 쓰면 방금 만든/바꾼 그룹을 못 찾아 오등록될 수 있으니
  // 항상 실시간 조회한다.
  const groups = kakaoTaxiAccountGroups(accountKey) || [];
  var fallback = null;
  for (var i = 0; i < groups.length; i++) {
    var g = groups[i];
    if (String(g.status) !== "enabled") continue;
    var gn = String(g.name || "").trim();
    if (gn === target || KAKAO_TAXI_BRANCH_ALIASES[gn] === target) return { accountKey: accountKey, groupId: g.id };
    fallback = fallback === null ? g.id : fallback;
  }
  // 계정 #2 처럼 지점명 그룹이 없고 활성 그룹이 '기본그룹' 하나뿐이면 그 그룹에 넣는다.
  // 지점 판정은 부서(department=지점명) 우선이라 집계는 정상 동작한다.
  var enabledCount = 0;
  for (var k = 0; k < groups.length; k++) if (String(groups[k].status) === "enabled") enabledCount++;
  if (enabledCount === 1 && fallback) return { accountKey: accountKey, groupId: fallback };
  return { accountKey: accountKey, groupId: null };
}

// 지점 화면 '이용신청' 자동 처리 — 관리자 승인 없이 지점 PIN 으로 바로 카카오 등록 + 인증 알림톡 발송.
// 안전장치: ①지점 PIN 게이트(자기 지점만) ②이름/전화 형식 검증 ③지점↔그룹 자동매핑(못 찾으면 거부)
// ④같은 전화번호 중복 등록 차단. server.ts 와 동일 로직으로 유지할 것.
function submitBranchKakaoRegister(pinHash, branchName, name, phone, memo) {
  const denied = new Error("지점 인증에 실패했습니다. 다시 로그인해주세요.");
  if (!pinHash || !branchName) throw denied;
  var setting;
  try { setting = verifyBranchPinOrAdmin(pinHash, branchName); } catch (e) { throw denied; }
  if (!setting) throw denied;

  var cleanName = String(name || "").trim();
  var cleanPhone = String(phone || "").replace(/[^0-9]/g, "");
  if (!cleanName) throw new Error("이름을 입력해주세요.");
  if (!/^01[0-9]{8,9}$/.test(cleanPhone)) throw new Error("휴대전화번호를 확인해주세요. (예: 01012345678)");

  var resolved = kakaoTaxiGroupIdForBranch(branchName);
  var groupId = resolved.groupId;
  var accountKey = resolved.accountKey;
  if (!groupId) throw new Error("이 지점에 해당하는 카카오T 그룹을 찾지 못했습니다. 관리자에게 문의해주세요.");

  // 중복 방지 — 같은 전화번호가 이미 인증완료 인원에 있으면 '어느 소속(지점)'인지 알려주고 거부.
  // 다른 지점에서 전입한 직원이 이전 지점으로 이미 등록돼 있을 때 지점이 상황을 알 수 있게 한다.
  var membersResult = getKakaoTaxiMembers();
  // [B1][이중과금 방지] 계정 조회가 일부 실패하면 그 계정에 이미 등록된 번호를 놓치고 중복 통과시켜
  // 다른 계정에 또 등록(이중 청구)할 수 있다 — 확인 불가 상태로는 등록을 진행하지 않는다(fail-closed).
  if (membersResult.accountErrors && membersResult.accountErrors.length) {
    throw new Error("카카오T 일부 계정 조회에 실패해 중복 확인을 할 수 없습니다. 잠시 후 다시 시도해주세요.");
  }
  var existing = membersResult.members || [];
  var allGroups = (getKakaoTaxiGroups() || {}).groups || [];
  for (var j = 0; j < existing.length; j++) {
    if (String(existing[j].mobile_phone || "").replace(/[^0-9]/g, "") === cleanPhone) {
      var ex = existing[j];
      var where = String(ex.department || "").trim();
      if (!where && ex.group_ids && ex.group_ids.length) {
        for (var g = 0; g < allGroups.length; g++) {
          if (allGroups[g].id === ex.group_ids[0] && allGroups[g].account_key === ex.account_key) {
            where = String(allGroups[g].name || ""); break;
          }
        }
      }
      if (!where) where = "다른 지점";
      // [B3] 어느 계정에 등록돼 있는지도 함께 안내 — 계정이 둘이라 지점명만으로는 헷갈릴 수 있다.
      var acctLabel = "";
      for (var la = 0; la < KAKAO_TAXI_ACCOUNTS.length; la++) {
        if (KAKAO_TAXI_ACCOUNTS[la].key === ex.account_key) { acctLabel = KAKAO_TAXI_ACCOUNTS[la].label; break; }
      }
      throw new Error((ex.name || cleanName) + " 님(" + cleanPhone + ")은 이미 '" + where + "'" + (acctLabel ? "(" + acctLabel + ")" : "") + "에 등록돼 있습니다. 같은 번호는 중복 등록할 수 없습니다. 전입한 직원이라면 관리자에게 소속(그룹) 변경을 요청해주세요.");
    }
  }

  // [P1] 반복 등록 방지 — 같은 지점이 짧은 시간(20초) 내 연속 등록을 막아 알림톡 남발을 차단.
  var regCache = null;
  var cdKey = "kakao_reg_cd_" + branchName;
  try { regCache = CacheService.getScriptCache(); } catch (e0) { regCache = null; }
  if (regCache && regCache.get(cdKey)) {
    throw new Error("방금 등록 요청이 처리되었습니다. 잠시(약 20초) 후 다음 직원을 등록해주세요.");
  }

  // register 는 카카오가 이미 존재하는 번호(인증 대기 등 connected 목록에 안 보이는 경우)를 400 으로 막는다 — 친절히 안내.
  var member;
  try {
    member = registerKakaoTaxiMember(accountKey, {
      identifier: cleanName,      // 사번 문화가 없어 이름을 사번으로 쓰는 기존 관례
      mobile_phone: cleanPhone,
      group_ids: [groupId],
      name: cleanName,
      department: branchName       // 부서=지점명 — 이용내역이 이 지점으로 집계되게 한다
    });
  } catch (e) {
    var em = String((e && e.message) || e);
    if (em.indexOf("이미 존재") >= 0 || em.indexOf("(400)") >= 0) {
      throw new Error("이 전화번호(" + cleanPhone + ")는 이미 카카오T에 등록돼 있습니다(인증 대기 중이거나 다른 소속일 수 있음). 관리자에게 확인을 요청해주세요.");
    }
    throw e;
  }
  // 등록 성공 → 쿨다운 설정(다음 20초간 이 지점 재등록 차단).
  if (regCache) { try { regCache.put(cdKey, "1", 20); } catch (e3) {} }
  // 알림톡 발송은 일시 실패가 잦아 짧게 3회까지 재시도한다(복구). 그래도 실패하면 직원이
  // 카카오T 앱 > 비즈니스에서 회사 초대를 직접 확인해 인증할 수 있으므로 등록 자체는 유효하다.
  var tmsSent = false;
  if (member && member.id) {
    for (var t = 0; t < 3 && !tmsSent; t++) {
      try { sendKakaoTaxiMemberTms(accountKey, member.id); tmsSent = true; }
      catch (e2) { if (t < 2) { try { Utilities.sleep(700); } catch (e8) {} } }
    }
  }
  // [P1] 등록 이력 기록(감사) — 실패해도 등록 자체는 유지한다.
  try {
    var logSs = getSpreadsheet();
    var logSheet = logSs.getSheetByName("카카오_등록로그");
    if (!logSheet) { logSheet = logSs.insertSheet("카카오_등록로그"); logSheet.appendRow(["시각", "지점", "이름", "전화", "memberId", "알림톡"]); }
    logSheet.appendRow([new Date(), branchName, cleanName, cleanPhone, (member && member.id) || "", tmsSent ? "발송" : "실패"]);
  } catch (e4) {}
  return { member: member, tmsSent: tmsSent };
}

function updateKakaoTaxiMember(accountKey, memberId, member) {
  if (!memberId) throw new Error("수정할 직원이 지정되지 않았습니다.");
  const m = member || {};
  const norm = kakaoTaxiNormalizeContact(m);
  if (!norm.phone || !norm.groupIds.length) {
    throw new Error("직원 수정에는 휴대전화번호와 그룹이 모두 필요합니다.");
  }
  // [함정] 카카오 수정 API 는 name/department 를 보내지 않으면(null) 공백으로 지워버린다.
  // 그래서 화면이 기존 값을 채워 보내는 것을 전제로, 여기서도 4개 필드를 항상 모두 보낸다.
  // 전화번호가 실제로 바뀐 경우 카카오가 새 번호로 인증 알림톡을 자동 발송한다(문서 명시).
  const body = {
    mobile_phone: norm.phone,
    group_ids: norm.groupIds,
    name: m.name ? String(m.name) : "",
    department: m.department ? String(m.department) : ""
  };
  const res = kakaoTaxiFetch(accountKey, "PUT", "/external/v1/members/" + encodeURIComponent(memberId), null, body);
  kakaoTaxiInvalidateMembersCache(accountKey);
  return res;
}

function setKakaoTaxiMemberBlocked(accountKey, memberIds, blocked) {
  const ids = (Array.isArray(memberIds) ? memberIds : []).filter(function (id) { return !!id; }).map(String);
  if (!ids.length) throw new Error("휴직 처리할 직원이 지정되지 않았습니다.");
  const path = blocked ? "/external/v1/members/block" : "/external/v1/members/unblock";
  const results = kakaoTaxiFetch(accountKey, "POST", path, null, { members: ids.join(",") }) || [];
  // 카카오는 건별 성공/실패를 배열로 돌려준다. 하나라도 실패면 화면이 성공으로 오해하지 않게 에러로 알린다.
  const failed = results.filter(function (r) { return r && r.status_code !== 0; });
  // 부분 성공(일부만 실패)이어도 성공한 변경이 캐시 뒤에 숨지 않도록, throw 보다 먼저 무효화한다.
  kakaoTaxiInvalidateMembersCache(accountKey);
  if (failed.length) {
    throw new Error("일부 직원 처리 실패: " + failed.map(function (r) { return r.id + "(" + (r.status_msg || "실패") + ")"; }).join(", "));
  }
  return results;
}

function deleteKakaoTaxiMember(accountKey, memberId) {
  if (!memberId) throw new Error("삭제할 직원이 지정되지 않았습니다.");
  kakaoTaxiFetch(accountKey, "DELETE", "/external/v1/members/" + encodeURIComponent(memberId), null, null);
  kakaoTaxiInvalidateMembersCache(accountKey);
  return { success: true };
}

function sendKakaoTaxiMemberTms(accountKey, memberId) {
  if (!memberId) throw new Error("알림톡을 보낼 직원이 지정되지 않았습니다.");
  kakaoTaxiFetch(accountKey, "POST", "/external/v1/members/" + encodeURIComponent(memberId) + "/send_tms", null, null);
  return { success: true };
}
