// src/pages/branch/helpers/sharedSaveSlot.ts
// 공유 데이터(shared_data)를 지연 저장하는 슬롯. 발주관리·주류재고가 같이 쓴다.
//
// 두 탭에 똑같은 저장 코드가 복붙돼 있었고, 이름만 debounce였지 실제 지연이 없었다.
// 그래서 한 칸을 연달아 고치면 요청이 동시에 여러 개 날아갔다. 여기서 아래를 한꺼번에 막는다.
//
//  1) 연타 — 지연을 둬서 마지막 값 한 번만 내보낸다.
//
//  2) 늦게 도착하는 옛 값 — 지연만으로는 부족하다. 간격을 두고 두 번 저장하면 요청 두 개가
//     동시에 날아갈 수 있고, 먼저 보낸 느린 요청이 나중에 도착하면 원격에 옛 값이 남는다.
//     그래서 슬롯당 **한 번에 하나씩만** 보낸다(직렬화). 보내는 중에 새 값이 생기면 대기시켰다가,
//     끝난 뒤 가장 마지막 값 하나만 이어서 보낸다.
//
//  3) 화면을 떠날 때 취소되는 저장 — 지점 전환·탭 이동으로 컴포넌트가 사라지면 타이머가 지워진다.
//     그대로 두면 그 값은 로컬에만 남아, 같은 브라우저로 그 지점을 다시 열기 전까지
//     다른 기기에서는 영영 보이지 않는다. 떠날 때 flush로 반드시 내보낸다.
//
//  4) 조용히 실패하는 저장 — 클라우드 쓰기가 실패해도 예전엔 콘솔에만 찍고 값을 버렸다.
//     그러면 지점 화면엔 값이 남아 있는데(로컬) 클라우드엔 안 올라가, 다른 노트북에서 영영 안 보인다.
//     이제 실패한 값을 **버리지 않고** 백오프로 재시도하고(온라인 복귀·flush 때 즉시 재시도),
//     저장 상태를 바깥에 알려(setSharedSaveStatusListener) 화면이 "동기화 실패"를 빨갛게 띄울 수 있게 한다.
//
// pending 표시(localStorage)는 "아직 원격에 못 올린 값이 로컬에 있다"는 뜻이다.
// 이게 잘못 지워지면 다음에 열 때 로컬 최신값이 원격의 옛값에 밀린다.
// 그래서 표시에 **저장마다 다른 토큰**을 적어두고, 내가 적은 토큰이 그대로 있을 때만 지운다.
// (떠난 화면의 늦은 응답이 새로 연 화면의 표시를 지워버리는 사고를 막는다 —
//  같은 지점에 다시 들어오면 pendingKey 문자열이 같기 때문에 실제로 일어난다.)
import { gasClient } from "../../../api/gasClient";

const SAVE_DELAY_MS = 600;
// 저장이 실패했을 때 재시도 간격. 실패할 때마다 두 배로 늘리되 상한을 둔다(오프라인일 때 무한 폭주 방지).
const RETRY_BASE_MS = 1500;
const RETRY_MAX_MS = 30000;
// 재시도 상한. 여기까지 실패하면 멈추되 pending 표시는 남겨,
// 다음에 화면을 다시 열 때 replay로 재전송된다(값을 잃지는 않는다). 상태는 error로 남아 화면에 표시된다.
const MAX_RETRIES = 12;

/** 저장 상태. 화면이 자동저장/저장 중/동기화 실패 배지를 그리는 데 쓴다. */
export type SaveStatus = "idle" | "saving" | "error";

/**
 * 이 페이지(브라우저 탭)만의 표식.
 *
 * 슬롯 번호는 페이지마다 1부터 다시 센다. 그래서 같은 화면을 두 탭에 열면 두 탭이
 * 똑같은 토큰("1:1")을 만들고, 한 탭의 늦은 응답이 다른 탭의 pending 표식을 지운다.
 * 페이지마다 다른 값을 앞에 붙여 그 충돌을 없앤다.
 */
const SESSION_ID = Math.random().toString(36).slice(2, 10);

let nextSlotId = 1;

type PendingSave = { key: string; value: unknown; pendingKey: string; token: string };

export type SharedSaveSlot = {
  id: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** 실패 후 재시도를 예약한 타이머. */
  retryTimer: ReturnType<typeof setTimeout> | null;
  /** 다음 재시도까지의 대기(ms). 실패할 때마다 두 배로 늘린다. */
  retryDelay: number;
  /** 연속 실패 횟수. MAX_RETRIES를 넘으면 재시도를 멈춘다(pending 표시는 남겨 다음 로드 때 replay). */
  retryCount: number;
  /** 이 슬롯이 몇 번 저장을 예약했는가. 토큰을 만들고, 재전송이 필요한지 판단하는 데 쓴다. */
  gen: number;
  /** 아직 안 나간 저장(가장 최신 값 하나). */
  waiting: PendingSave | null;
  /** 지금 원격에 보내는 중인가. 슬롯당 하나만 날린다. */
  sending: boolean;
  /** 현재 저장 상태. */
  status: SaveStatus;
  /** 상태가 바뀔 때 부르는 콜백(화면 배지 갱신용). */
  onStatus: ((status: SaveStatus) => void) | null;
};

export const createSharedSaveSlot = (): SharedSaveSlot => ({
  id: nextSlotId++,
  timer: null,
  retryTimer: null,
  retryDelay: RETRY_BASE_MS,
  retryCount: 0,
  gen: 0,
  waiting: null,
  sending: false,
  status: "idle",
  onStatus: null
});

/** 화면이 저장 상태를 구독한다. 슬롯을 새로 만들 때마다(지점 전환) 다시 붙여야 한다. */
export const setSharedSaveStatusListener = (slot: SharedSaveSlot, onStatus: ((status: SaveStatus) => void) | null) => {
  slot.onStatus = onStatus;
};

const setStatus = (slot: SharedSaveSlot, status: SaveStatus) => {
  if (slot.status === status) return;
  slot.status = status;
  slot.onStatus?.(status);
};

/** 실패한 저장을 백오프로 다시 예약한다. flush/online 때는 이 예약을 건너뛰고 즉시 보낸다. */
const scheduleRetry = (slot: SharedSaveSlot, label: string) => {
  if (slot.retryTimer) return;
  if (slot.retryCount >= MAX_RETRIES) return; // 여기서 멈춰도 pending 표시가 남아 다음 로드 때 replay로 재전송된다.
  const delay = Math.min(slot.retryDelay, RETRY_MAX_MS);
  slot.retryDelay = Math.min(delay * 2, RETRY_MAX_MS);
  slot.retryTimer = setTimeout(() => {
    slot.retryTimer = null;
    pump(slot, label);
  }, delay);
};

/** 대기 중인 값을 하나 꺼내 보낸다. 보내는 중이거나 재시도 대기 중이면 아무것도 하지 않는다(끝나면 스스로 다시 부른다). */
const pump = (slot: SharedSaveSlot, label: string) => {
  if (slot.sending) return;
  if (slot.retryTimer) return; // 재시도 예약이 걸려 있으면 그 타이머가 보낸다(즉시 재전송은 flush가 담당).
  const save = slot.waiting;
  if (!save) return;

  slot.waiting = null;
  slot.sending = true;
  setStatus(slot, "saving");
  void gasClient.saveSharedData(save.key, save.value)
    .then(() => {
      // 내가 적어둔 토큰이 그대로일 때만 지운다.
      // 그 사이 누군가(같은 슬롯의 새 저장이든, 새로 연 화면의 슬롯이든) 다시 표시했다면 건드리지 않는다.
      if (localStorage.getItem(save.pendingKey) === save.token) localStorage.removeItem(save.pendingKey);
      slot.retryCount = 0;
      slot.retryDelay = RETRY_BASE_MS;
    })
    .catch((error) => {
      console.error(`Failed to save shared data (${label})`, error);
      // 실패한 값을 버리지 않는다 — 더 새로운 값이 없으면 되돌려 넣고 재시도한다.
      // pending 표시도 그대로라, 최악의 경우 다음 로드 때 replay로도 재전송된다.
      if (!slot.waiting) slot.waiting = save;
      slot.retryCount += 1;
      setStatus(slot, "error");
      scheduleRetry(slot, label);
    })
    .finally(() => {
      slot.sending = false;
      // 실패했으면 재시도 타이머가 이어서 보낸다(여기서 즉시 다시 쏘면 오프라인일 때 폭주한다).
      if (slot.status === "error") return;
      if (slot.waiting) pump(slot, label);
      else setStatus(slot, "idle");
    });
};

const markPending = (slot: SharedSaveSlot, key: string, value: unknown, pendingKey: string): PendingSave => {
  const token = `${SESSION_ID}:${slot.id}:${++slot.gen}`;
  localStorage.setItem(pendingKey, token);
  return { key, value, pendingKey, token };
};

/** 저장을 예약한다. 연달아 부르면 마지막 값 하나만 나간다. */
export const scheduleSharedSave = (slot: SharedSaveSlot, key: string, value: unknown, pendingKey: string, label: string) => {
  if (slot.timer) clearTimeout(slot.timer);
  slot.waiting = markPending(slot, key, value, pendingKey);
  // 새 편집이 들어오면 이전 실패의 재시도 백오프를 리셋한다 — 최신 값은 곧바로 다시 시도할 가치가 있다.
  if (slot.retryTimer) {
    clearTimeout(slot.retryTimer);
    slot.retryTimer = null;
  }
  slot.retryCount = 0;
  slot.retryDelay = RETRY_BASE_MS;
  setStatus(slot, "saving");
  slot.timer = setTimeout(() => {
    slot.timer = null;
    pump(slot, label);
  }, SAVE_DELAY_MS);
};

/**
 * 화면을 떠날 때(또는 온라인 복귀 시) 부른다.
 * 예약만 되고 아직 안 나간 저장이나, 실패해 재시도 대기 중인 저장이 있으면 지금 바로 내보낸다.
 */
export const flushSharedSave = (slot: SharedSaveSlot, label: string) => {
  if (slot.timer) {
    clearTimeout(slot.timer);
    slot.timer = null;
  }
  // 재시도 대기를 건너뛰고 즉시 한 번 더 시도한다(새로고침·탭닫기·온라인 복귀 순간을 놓치지 않는다).
  if (slot.retryTimer) {
    clearTimeout(slot.retryTimer);
    slot.retryTimer = null;
  }
  pump(slot, label);
};

/**
 * 화면을 열 때 "지난번에 못 올린 값"을 다시 올린다.
 *
 * 더 새로운 저장이 이미 있으면 재전송하지 않는다 — 재전송하는 값은 화면을 열 때 읽은 옛 스냅샷이라,
 * 그걸 밀어 넣으면 최신 값이 사라진다.
 */
export const replayPendingSave = (slot: SharedSaveSlot, key: string, value: unknown, pendingKey: string, label: string) => {
  if (slot.gen > 0 || slot.waiting || slot.sending) return;
  slot.waiting = markPending(slot, key, value, pendingKey);
  pump(slot, label);
};
