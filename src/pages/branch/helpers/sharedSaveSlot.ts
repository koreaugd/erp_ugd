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
// pending 표시(localStorage)는 "아직 원격에 못 올린 값이 로컬에 있다"는 뜻이다.
// 이게 잘못 지워지면 다음에 열 때 로컬 최신값이 원격의 옛값에 밀린다.
// 그래서 표시에 **저장마다 다른 토큰**을 적어두고, 내가 적은 토큰이 그대로 있을 때만 지운다.
// (떠난 화면의 늦은 응답이 새로 연 화면의 표시를 지워버리는 사고를 막는다 —
//  같은 지점에 다시 들어오면 pendingKey 문자열이 같기 때문에 실제로 일어난다.)
import { gasClient } from "../../../api/gasClient";

const SAVE_DELAY_MS = 600;

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
  /** 이 슬롯이 몇 번 저장을 예약했는가. 토큰을 만들고, 재전송이 필요한지 판단하는 데 쓴다. */
  gen: number;
  /** 아직 안 나간 저장(가장 최신 값 하나). */
  waiting: PendingSave | null;
  /** 지금 원격에 보내는 중인가. 슬롯당 하나만 날린다. */
  sending: boolean;
};

export const createSharedSaveSlot = (): SharedSaveSlot => ({
  id: nextSlotId++,
  timer: null,
  gen: 0,
  waiting: null,
  sending: false
});

/** 대기 중인 값을 하나 꺼내 보낸다. 보내는 중이면 아무것도 하지 않는다(끝나면 스스로 다시 부른다). */
const pump = (slot: SharedSaveSlot, label: string) => {
  if (slot.sending) return;
  const save = slot.waiting;
  if (!save) return;

  slot.waiting = null;
  slot.sending = true;
  void gasClient.saveSharedData(save.key, save.value)
    .then(() => {
      // 내가 적어둔 토큰이 그대로일 때만 지운다.
      // 그 사이 누군가(같은 슬롯의 새 저장이든, 새로 연 화면의 슬롯이든) 다시 표시했다면 건드리지 않는다.
      if (localStorage.getItem(save.pendingKey) === save.token) localStorage.removeItem(save.pendingKey);
    })
    .catch((error) => {
      console.error(`Failed to save shared data (${label})`, error);
    })
    .finally(() => {
      slot.sending = false;
      pump(slot, label); // 보내는 동안 쌓인 최신 값이 있으면 이어서 보낸다.
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
  slot.timer = setTimeout(() => {
    slot.timer = null;
    pump(slot, label);
  }, SAVE_DELAY_MS);
};

/** 화면을 떠날 때 부른다. 예약만 되고 아직 안 나간 저장이 있으면 지금 바로 내보낸다. */
export const flushSharedSave = (slot: SharedSaveSlot, label: string) => {
  if (slot.timer) {
    clearTimeout(slot.timer);
    slot.timer = null;
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
