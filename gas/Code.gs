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
        result = getBranchHistory(requestData.branchName);
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
      ["대물섬 한남점", "[해시삭제]", "branch", "TRUE", "대물섬"], // [PIN]
      ["카라멘야 신촌점", "5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5", "branch", "TRUE", "카라멘야"], // [PIN]
      ["남산광어", "bc40db6e64174c538415fc1dca370bfd7559e2170f2095f7ecfb4b375b4aa035", "branch", "TRUE", "남산광어"], // [PIN]
      ["사카바단단", "37a77b8b2fcb4b1a45bb38ecbc6bfacdc7abf134bf3006aff0965d506ae2d3c1", "branch", "TRUE", "사카바단단"], // [PIN]
      ["카츠스위스", "dbf76bfb1d8baf83ccd3856b3e34b9cfdfd5a27ae0e78c80fb688970e30f1465", "branch", "TRUE", "카츠스위스"], // [PIN]
      ["금샤빠", "fc8e74720935541604df45e43a6d6fec6f3780f2bebf70fcb9e380b06b72a4f4", "branch", "TRUE", "금샤빠"], // [PIN]
      ["대학로고래", "011bc9052026859346d04e33e9bfa24b7fa71ff6a7a5ea9f5b6196238b6d376c", "branch", "TRUE", "대학로고래"], // [PIN]
      ["마음죽", "efdf04106361a4b4904de0f3b48f6ddbfdaf4363f82cb3f0e0ca59941a3962d3", "branch", "TRUE", "마음죽"], // [PIN]
      ["연하동", "42728f32ac8db620fa9329fc9f62ebd231c5188bc8a9d023af7b819fbc4fb315", "branch", "TRUE", "연하동"], // [PIN]
      ["헴프리스", "107dbf310d9af7d1c686e00cc2b4eb18c7bf9dfda2e0f2f3d6db8f90656a2bb5", "branch", "TRUE", "헴프리스"], // [PIN]
      ["8번대물집", "4523626c92ece30386ab9959600a06c5598696bb43a6538bfe4381387d8df94b", "branch", "TRUE", "대물섬"], // [PIN]
      ["강남대골뼈국", "e1451f151c881c002bd3ddfaff63c0cdbeee06883b27b9a5f700c2a514d2325a", "branch", "TRUE", "강남대골뼈국"], // [PIN]
      ["대물섬 강남점", "d06fcc3e81792fd6aeaba18f2bb732386a34ba50ef12933ed10557464a974df7", "branch", "TRUE", "대물섬"], // [PIN]
      ["관리자", "[해시삭제]", "admin", "TRUE", "본사"] // [삭제] (correct SHA-256)
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
    // [삭제] 해시: 406c138b3014c46fbe87b322a4660fe99b51efda7d52a8a89b708b73059882bf 또는 [해시삭제]
    if (role === "admin") {
      const isDbAdminHash = (hashInDb === "406c138b3014c46fbe87b322a4660fe99b51efda7d52a8a89b708b73059882bf" || hashInDb === "[해시삭제]");
      const isInputAdminHash = (cleanPinHash === "406c138b3014c46fbe87b322a4660fe99b51efda7d52a8a89b708b73059882bf" || cleanPinHash === "[해시삭제]");
      if (isDbAdminHash && isInputAdminHash) {
        return {
          branchName: branchName,
          role: role,
          brand: brand,
          branches: activeBranches
        };
      }
    }

    // C. 사용자가 구글 시트에 "1234", "[삭제]" 등 평문을 그대로 적어둔 하위 호환성 케이스 대응
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

  // 4-A. 직원_현황 시트 (모든 기기 공통 직원 명단)
  let rosterSheet = ss.getSheetByName(SHEETS.ROSTER);
  if (!rosterSheet) {
    rosterSheet = ss.insertSheet(SHEETS.ROSTER);
    rosterSheet.appendRow(["branch_name", "employee_id", "name", "division", "rank", "custom_rank", "updated_at"]);
  }

  let sharedDataSheet = ss.getSheetByName(SHEETS.SHARED_DATA);
  if (!sharedDataSheet) {
    sharedDataSheet = ss.insertSheet(SHEETS.SHARED_DATA);
    sharedDataSheet.appendRow(["data_key", "json_value", "updated_at"]);
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

    const recordId = m.recordId || m.record_id || generateUUID();
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
function getBranchHistory(branchName) {
  const ss = getSpreadsheet();
  const masterSheet = ss.getSheetByName(SHEETS.MASTER);
  const masterValues = masterSheet.getDataRange().getValues();
  const history = [];
  
  for (let i = 1; i < masterValues.length; i++) {
    const row = masterValues[i];
    if (row[1] === branchName) {
      history.push({
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
