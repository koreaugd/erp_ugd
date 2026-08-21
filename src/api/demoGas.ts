// src/api/demoGas.ts
// 시연용 인스턴스 전용 — 법인택시(카카오T 비즈니스) 백엔드 대역.
//
// [왜 필요한가]
// 앱에서 GAS(구글시트)를 통해 외부 API를 부르는 화면은 **법인택시 하나뿐**이다. 시연용 인스턴스에는
// 그 백엔드가 없어 한동안 탭을 통째로 숨겨 뒀는데, 그러면 시연에서 기능 하나가 없는 셈이 된다.
// 그래서 GAS 를 부르는 대신 **미리 심어 둔 가상 데이터**(scripts/demo/generate_fake_data.mjs)를
// 같은 응답 모양으로 돌려준다. 네트워크로 나가는 요청은 하나도 없다.
//
// [P0 — 운영 번들에 절대 실리면 안 된다]
// gasClient.callApi 는 `if (IS_DEMO) { ...동적 import... }` 안에서만 이 파일을 부른다. IS_DEMO 는
// 빌드 시점 리터럴이라 운영 빌드에서는 이 모듈이 통째로 사라진다(scripts/demo/check_prod_bundle.mjs 가 검사).
//
// [쓰기도 진짜로 저장한다]
// 방문자가 등록·수정·차단을 눌렀을 때 화면만 바뀌고 새로고침하면 되돌아가면 시연이 어색해진다.
// 그래서 목록을 Firestore(shared_data)에 두고 트랜잭션으로 고친다. `seed_demo.mjs --reset` 이
// 기준선으로 되돌리므로 방문자가 어질러도 다음 시연에 영향이 없다.
import type {
  KakaoTaxiGroup, KakaoTaxiMember, KakaoTaxiOrder, KakaoTaxiPhoneCheck,
} from "./gasClient";

const MEMBERS_KEY = "demo_kakao_taxi_members";
const GROUPS_KEY = "demo_kakao_taxi_groups";
const ordersKey = (month: string) => `demo_kakao_taxi_orders:${month}`;

/** 데모 계정 표기 — 화면의 '계정' 컬럼과 경고 배너가 이 라벨을 쓴다. */
const ACCOUNT_KEY = "acct1";

async function direct() {
  return await import("./firebaseDirect");
}

async function readList<T>(key: string): Promise<T[]> {
  const { firebaseGetSharedDataFromServer } = await direct();
  const value = await firebaseGetSharedDataFromServer(key);
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * 인원 목록을 트랜잭션으로 고친다. mutate 는 **순수 함수**여야 한다 —
 * 트랜잭션은 재시도될 수 있어 바깥 변수를 건드리면 결과가 어긋난다(firebaseMutateSharedData 규약).
 */
async function mutateMembers(
  mutate: (list: KakaoTaxiMember[]) => KakaoTaxiMember[]
): Promise<KakaoTaxiMember[]> {
  const { firebaseMutateSharedData } = await direct();
  const result = await firebaseMutateSharedData(MEMBERS_KEY, (current) =>
    mutate(Array.isArray(current) ? (current as KakaoTaxiMember[]) : [])
  );
  return Array.isArray(result.value) ? (result.value as KakaoTaxiMember[]) : [];
}

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** 표시용 번호 가리기 — 타 지점 인원의 실번호는 내려주지 않는다(운영 GAS 와 같은 규약). */
function maskPhone(phone: string): string {
  const d = digits(phone);
  if (d.length < 8) return phone;
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

function newMemberId(list: KakaoTaxiMember[]): string {
  // 시각·난수를 쓰지 않는다 — 같은 목록에서 항상 같은 규칙으로 다음 번호를 만든다.
  const used = new Set(list.map((m) => m.id));
  for (let i = 1; i < 10000; i += 1) {
    const id = `TXN${String(i).padStart(4, "0")}`;
    if (!used.has(id)) return id;
  }
  throw new Error("데모 인원 번호가 고갈되었습니다.");
}

function memberOf(list: KakaoTaxiMember[], memberId: string): KakaoTaxiMember | undefined {
  return list.find((m) => String(m.id) === String(memberId));
}

/** 시연용 응답기. 지원하지 않는 action 은 그대로 던진다(운영 GAS 를 대신 부르는 일은 없다). */
export async function demoCallApi(action: string, params: Record<string, any>): Promise<any> {
  switch (action) {
    case "getKakaoTaxiGroups": {
      const groups = await readList<KakaoTaxiGroup>(GROUPS_KEY);
      return { groups, accountErrors: [] };
    }

    case "getKakaoTaxiMembers": {
      const members = await readList<KakaoTaxiMember>(MEMBERS_KEY);
      return { count: members.length, members, accountErrors: [] };
    }

    case "getKakaoTaxiBranchMembers": {
      const members = await readList<KakaoTaxiMember>(MEMBERS_KEY);
      const branch = String(params.branchName || "").trim();
      return members.filter((m) => String(m.department || "").trim() === branch);
    }

    case "getKakaoTaxiOrders": {
      const month = String(params.month || "");
      const orders = await readList<KakaoTaxiOrder>(ordersKey(month));
      return { month, count: orders.length, orders, accountErrors: [] };
    }

    case "checkKakaoTaxiPhone": {
      const members = await readList<KakaoTaxiMember>(MEMBERS_KEY);
      const wanted = digits(params.phone);
      const hit = members.find((m) => digits(m.mobile_phone) === wanted);
      if (!hit) return { found: false } satisfies KakaoTaxiPhoneCheck;
      const branch = String(params.branchName || "").trim();
      const department = String(hit.department || "").trim();
      return {
        found: true,
        memberId: hit.id,
        name: hit.name,
        phone: maskPhone(hit.mobile_phone),
        department,
        departmentRaw: String(hit.department || ""),
        accountKey: hit.account_key || ACCOUNT_KEY,
        accountLabel: "시연용 계정",
        sameBranch: department === branch,
        sameAccount: true, // 데모는 계정이 하나뿐이라 항상 같은 계정이다
      } satisfies KakaoTaxiPhoneCheck;
    }

    case "transferKakaoTaxiMember": {
      const memberId = String(params.memberId);
      const toBranch = String(params.branchName || "").trim();
      const expected = String(params.expectedFromBranch ?? "");
      let fromBranch = "";
      let missing = false;
      let mismatch = false;
      const next = await mutateMembers((list) => {
        const target = memberOf(list, memberId);
        if (!target) { missing = true; return list; }
        fromBranch = String(target.department || "");
        // 소속 대조(CAS) — 내가 본 소속과 실제가 다르면 옮기지 않는다(운영과 같은 방어).
        if (fromBranch !== expected) { mismatch = true; return list; }
        return list.map((m) => (String(m.id) === memberId ? { ...m, department: toBranch } : m));
      });
      if (missing) throw new Error("대상 인원을 찾지 못했습니다.");
      if (mismatch) throw new Error(`소속이 그 사이 바뀌었습니다(현재: ${fromBranch || "미지정"}). 새로고침 후 다시 시도해 주세요.`);
      return { success: true, fromBranch, toBranch, memberId, member: memberOf(next, memberId) };
    }

    case "submitBranchKakaoRegister": {
      const branch = String(params.branchName || "").trim();
      const name = String(params.name || "").trim();
      const phone = String(params.phone || "");
      // mutate 는 트랜잭션 재시도로 여러 번 불릴 수 있어 안에서 만든 값을 바깥 변수에 적어 두면 어긋난다.
      // 커밋된 목록(next)에서 **다시 찾아** 확정한다.
      const next = await mutateMembers((list) => [...list, {
        id: newMemberId(list),
        name, department: branch,
        identifier: newMemberId(list).replace("TXN", "9"),
        mobile_phone: phone,
        status: "created",
        confirmed_at: null,
        group_ids: [],
        account_key: ACCOUNT_KEY,
      }]);
      const created = [...next].reverse()
        .find((m) => digits(m.mobile_phone) === digits(phone) && m.name === name);
      if (!created) throw new Error("등록에 실패했습니다.");
      return { member: created, tmsSent: true };
    }

    case "registerKakaoTaxiMember": {
      const input = params.member || {};
      const phone = String(input.mobile_phone || "");
      const next = await mutateMembers((list) => {
        const id = newMemberId(list);
        return [...list, {
          id,
          name: String(input.name || ""),
          department: String(input.department || ""),
          identifier: String(input.identifier || id.replace("TXN", "9")),
          mobile_phone: phone,
          status: "created",
          confirmed_at: null,
          group_ids: Array.isArray(input.group_ids) ? input.group_ids : [],
          account_key: String(params.accountKey || ACCOUNT_KEY),
        }];
      });
      const created = next.find((m) => digits(m.mobile_phone) === digits(phone));
      if (!created) throw new Error("등록에 실패했습니다.");
      return created;
    }

    case "updateKakaoTaxiMember": {
      const memberId = String(params.memberId);
      const patch = params.member || {};
      let missing = false;
      const next = await mutateMembers((list) => {
        if (!memberOf(list, memberId)) { missing = true; return list; }
        return list.map((m) => (String(m.id) === memberId ? {
          ...m,
          ...(patch.name !== undefined ? { name: String(patch.name) } : {}),
          ...(patch.department !== undefined ? { department: String(patch.department) } : {}),
          ...(patch.identifier !== undefined ? { identifier: String(patch.identifier) } : {}),
          ...(patch.mobile_phone !== undefined ? { mobile_phone: String(patch.mobile_phone) } : {}),
          ...(Array.isArray(patch.group_ids) ? { group_ids: patch.group_ids } : {}),
        } : m));
      });
      if (missing) throw new Error("대상 인원을 찾지 못했습니다.");
      return memberOf(next, memberId)!;
    }

    case "blockKakaoTaxiMember":
    case "unblockKakaoTaxiMember": {
      const ids = (Array.isArray(params.memberIds) ? params.memberIds : []).map(String);
      const status = action === "blockKakaoTaxiMember" ? "blocked" : "connected";
      await mutateMembers((list) =>
        list.map((m) => (ids.includes(String(m.id)) ? { ...m, status } : m))
      );
      return ids.map((id) => ({ id, status_code: 200, status_msg: "OK" }));
    }

    case "deleteKakaoTaxiMember": {
      const memberId = String(params.memberId);
      await mutateMembers((list) => list.filter((m) => String(m.id) !== memberId));
      return { success: true };
    }

    case "sendKakaoTaxiMemberTms":
      // 실제 알림톡은 보내지 않는다 — 보낸 척만 하고 성공을 돌려준다(외부로 나가는 요청 없음).
      return { success: true };

    default:
      throw new Error(`시연용 인스턴스에서는 지원하지 않는 기능입니다. (${action})`);
  }
}
