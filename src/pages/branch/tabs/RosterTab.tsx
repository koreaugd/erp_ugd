// src/pages/branch/tabs/RosterTab.tsx  (BranchConfirmPage에서 분리 — 동작 변경 없음)
import React, { useState, useEffect, useMemo, useRef } from "react";
import { AlertTriangle, Check, Pencil, Trash2, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { gasClient } from "../../../api/gasClient";
import type { Employee, EmployeeEditableField, SalaryChangeChoice, StaffAddDraft, StaffAddReasonChoice } from "../types";
import { formatMobilePhone, formatResidentNumber, residentBirthKey, toPhoneTail8 } from "../helpers/formatters";
import { applyEmployeeEditableField, createStaffAddDraft, getAddReasonChoiceClass, getSalaryChoiceClass, getSameNameWarning, isSampleEmployee, parseSalaryChangeChoice, parseSalaryChangeStatus, parseStaffAddReasonChoice, readLocalStaffAddDrafts, readLocalStaffList, staffAddDraftStorageKey, staffListPendingStorageKey, staffListStorageKey } from "../helpers/staffHelpers";

export function RosterTab({ branchName }: { branchName: string }) {
  const initialEmployees = useMemo(() => readLocalStaffList(branchName), [branchName]);
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const employeesRef = useRef<Employee[]>(initialEmployees);
  const rosterSaveTimerRef = useRef<number | null>(null);
  const rosterSaveSeqRef = useRef(0);

  const [newName, setNewName] = useState("");
  const [division, setDivision] = useState<"정직원" | "파트타이머" >("정직원");
  const [selectedRank, setSelectedRank] = useState<string>("");
  const [customRankInput, setCustomRankInput] = useState<string>("");
  const [newResidentNumber, setNewResidentNumber] = useState("");
  const [newContractType, setNewContractType] = useState<"4대보험" | "3.3%">("4대보험");
  const [newEntryDate, setNewEntryDate] = useState("");
  const [newPhoneDigits, setNewPhoneDigits] = useState("");
  const [newAddReason, setNewAddReason] = useState<StaffAddReasonChoice>("");
  const [newFromBranch, setNewFromBranch] = useState("");
  const [newTransferDate, setNewTransferDate] = useState("");
  const [newSalaryChanged, setNewSalaryChanged] = useState<SalaryChangeChoice>("");
  const [newAddReasonMemo, setNewAddReasonMemo] = useState("");
  const [rosterAddDrafts, setRosterAddDrafts] = useState<StaffAddDraft[]>(() => readLocalStaffAddDrafts(branchName));
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [editingEmployeeDraft, setEditingEmployeeDraft] = useState<Employee | null>(null);
  const [editingSensitiveFields, setEditingSensitiveFields] = useState({ phone: false, salaryChanged: false });

  // Deletion Modal States
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  const [deleteReason, setDeleteReason] = useState<"퇴사" | "지점이동">("퇴사");
  const [effectiveDate, setEffectiveDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [targetBranch, setTargetBranch] = useState<string>("");
  const [branchList, setBranchList] = useState<any[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  // Edit Modal States
  const [showEditModal, setShowEditModal] = useState(false);
  const [employeeToEdit, setEmployeeToEdit] = useState<Employee | null>(null);
  const [editName, setEditName] = useState("");
  const [editDivision, setEditDivision] = useState<"정직원" | "파트타이머">("정직원");
  const [editRank, setEditRank] = useState("");
  const [editCustomRank, setEditCustomRank] = useState("");
  const [editResidentNumber, setEditResidentNumber] = useState("");
  const [editContractType, setEditContractType] = useState<"4대보험" | "3.3%">("4대보험");
  const [editEntryDate, setEditEntryDate] = useState("");

  useEffect(() => {
    localStorage.setItem(staffAddDraftStorageKey(branchName), JSON.stringify(rosterAddDrafts));
  }, [branchName, rosterAddDrafts]);

  useEffect(() => {
    return () => {
      if (rosterSaveTimerRef.current) window.clearTimeout(rosterSaveTimerRef.current);
      if (localStorage.getItem(staffListPendingStorageKey(branchName)) === "1") {
        const pendingEmployees = readLocalStaffList(branchName);
        const saveSeq = ++rosterSaveSeqRef.current;
        gasClient.saveBranchOwnRoster(branchName, pendingEmployees)
          .then(() => {
            if (rosterSaveSeqRef.current === saveSeq) localStorage.removeItem(staffListPendingStorageKey(branchName));
          })
          .catch((error) => {
            console.error("직원 명단 탭 이동 전 저장에 실패했습니다.", error);
          });
      }
    };
  }, [branchName]);

  // 지점 직원현황은 지점 전용 branch_own_rosters만 기준으로 사용합니다.
  // 관리자 직원명부(staff_rosters)는 재설계 전까지 지점 직원현황에 병합하지 않습니다.
  useEffect(() => {
    let cancelled = false;
    const syncRoster = async () => {
      try {
        const ownRoster = await gasClient.getBranchOwnRoster(branchName);
        if (cancelled) return;
        const ownFiltered = ownRoster.filter((employee: any) => !isSampleEmployee(employee));
        const localRoster = readLocalStaffList(branchName);
        const hasPendingLocalSave = localStorage.getItem(staffListPendingStorageKey(branchName)) === "1";
        const shouldPreserveLocal = hasPendingLocalSave;
        const merged: any[] = [...(shouldPreserveLocal ? localRoster : ownFiltered)];

        employeesRef.current = merged as Employee[];
        setEmployees(merged as Employee[]);
        localStorage.setItem(staffListStorageKey(branchName), JSON.stringify(merged));

        // 샘플 제거 또는 로컬 미반영 저장분이 있는 경우 branch_own_rosters 정리
        const needsUpdate = shouldPreserveLocal || ownRoster.some((e: any) => isSampleEmployee(e)) || ownRoster.length !== merged.length;
        if (needsUpdate) {
          await gasClient.saveBranchOwnRoster(branchName, merged);
          localStorage.removeItem(staffListPendingStorageKey(branchName));
        }
      } catch (error) {
        console.warn("직원 명단 원격 동기화에 실패했습니다.", error);
      }
    };
    syncRoster();
    return () => { cancelled = true; };
  }, [branchName]);

  const handleOpenEditModal = (emp: Employee) => {
    setEmployeeToEdit(emp);
    setEditName(emp.name);
    setEditDivision(emp.division);
    setEditRank(emp.rank || "");
    setEditCustomRank(emp.customRank || "");
    setEditResidentNumber(formatResidentNumber(emp.residentNumber || ""));
    setEditContractType(emp.contractType || "4대보험");
    setEditEntryDate(emp.entryDate || "");
    setShowEditModal(true);
  };

  const handleSaveEdit = () => {
    if (!employeeToEdit) return;
    if (!editName.trim()) {
      alert("이름을 꼭 기입해 주십시오.");
      return;
    }

    const updated = employees.map((emp) => {
      if (emp.id === employeeToEdit.id) {
        return {
          ...emp,
          name: editName.trim(),
          division: editDivision,
          residentNumber: formatResidentNumber(editResidentNumber),
          contractType: editContractType,
          entryDate: editEntryDate,
          ...(editDivision === "정직원" ? {
            rank: editRank,
            ...(editRank === "기타" ? { customRank: editCustomRank.trim() } : {})
          } : {
            rank: undefined,
            customRank: undefined
          })
        };
      }
      return emp;
    });

    saveEmployees(updated);
    setShowEditModal(false);
    setEmployeeToEdit(null);
  };

  // Fetch branches inside RosterTab to populate target branch selection
  useEffect(() => {
    const loadList = async () => {
      try {
        setLoadingBranches(true);
        const list = await gasClient.getBranchList();
        // filter: role is branch, and name is not current branchName
        const filtered = list.filter((b: any) => b.role === "branch" && b.branchName !== branchName);
        setBranchList(filtered);
        if (filtered.length > 0) {
          setTargetBranch(filtered[0].branchName);
        }
      } catch (e) {
        console.error("지점 로드 오류:", e);
      } finally {
        setLoadingBranches(false);
      }
    };
    loadList();
  }, [branchName]);

  const persistEmployees = (updated: Employee[], delayMs = 0) => {
    const normalized = updated.map((employee) => ({
      ...employee,
      residentNumber: formatResidentNumber(employee.residentNumber || ""),
      contractType: employee.contractType || (employee.division === "정직원" ? "4대보험" : "3.3%"),
      phone: employee.addReason === "신규입사" && toPhoneTail8(employee.phone || "").length === 8
        ? formatMobilePhone(employee.phone || "")
        : employee.phone || ""
    }));
    employeesRef.current = normalized;
    localStorage.setItem(staffListStorageKey(branchName), JSON.stringify(normalized));
    localStorage.setItem(staffListPendingStorageKey(branchName), "1");
    const saveSeq = ++rosterSaveSeqRef.current;
    if (rosterSaveTimerRef.current) window.clearTimeout(rosterSaveTimerRef.current);
    rosterSaveTimerRef.current = null;
    const saveNow = () => {
      gasClient.saveBranchOwnRoster(branchName, normalized)
        .then(() => {
          if (rosterSaveSeqRef.current === saveSeq) localStorage.removeItem(staffListPendingStorageKey(branchName));
        })
        .catch((error) => {
          console.error("직원 명단 저장에 실패했습니다.", error);
        });
    };
    if (delayMs > 0) {
      rosterSaveTimerRef.current = window.setTimeout(saveNow, delayMs);
    } else {
      saveNow();
    }
    return normalized;
  };

  const saveEmployees = (updated: Employee[]) => {
    setEmployees(persistEmployees(updated, 0));
  };

  const startEmployeeEdit = (employee: Employee) => {
    if (editingEmployeeDraft && editingEmployeeId !== employee.id) {
      const canDiscard = window.confirm("저장하지 않은 수정 내용이 있습니다. 취소하고 다른 직원을 수정할까요?");
      if (!canDiscard) return;
    }
    setEditingEmployeeId(employee.id);
    setEditingEmployeeDraft({ ...employee, phone: "", salaryChanged: undefined });
    setEditingSensitiveFields({ phone: false, salaryChanged: false });
  };

  const cancelEmployeeEdit = () => {
    setEditingEmployeeId(null);
    setEditingEmployeeDraft(null);
    setEditingSensitiveFields({ phone: false, salaryChanged: false });
  };

  const updateEmployeeEditDraft = (field: EmployeeEditableField, value: string) => {
    if (field === "phone") setEditingSensitiveFields((current) => ({ ...current, phone: true }));
    if (field === "salaryChanged") setEditingSensitiveFields((current) => ({ ...current, salaryChanged: true }));
    setEditingEmployeeDraft((current) => current ? applyEmployeeEditableField(current, field, value) : current);
  };

  const saveEmployeeEdit = () => {
    if (!editingEmployeeDraft) return;
    const originalEmployee = employees.find((employee) => employee.id === editingEmployeeDraft.id);
    const normalizedDraft: Employee = {
      ...editingEmployeeDraft,
      name: editingEmployeeDraft.name.trim(),
      residentNumber: formatResidentNumber(editingEmployeeDraft.residentNumber || "")
    };
    if (originalEmployee?.addReason === normalizedDraft.addReason && normalizedDraft.addReason === "신규입사" && !editingSensitiveFields.phone) {
      normalizedDraft.phone = originalEmployee.phone || "";
    }
    if (originalEmployee?.addReason === normalizedDraft.addReason && normalizedDraft.addReason === "지점이동" && !editingSensitiveFields.salaryChanged) {
      normalizedDraft.salaryChanged = originalEmployee.salaryChanged;
    }
    if (normalizedDraft.addReason === "신규입사") {
      const phoneTail = toPhoneTail8(normalizedDraft.phone || "");
      if (phoneTail.length !== 8) {
        alert("핸드폰번호 뒤 8자리를 입력해 주세요. 010은 제외합니다.");
        return;
      }
      normalizedDraft.phone = formatMobilePhone(phoneTail);
    }
    if (!normalizedDraft.name) {
      alert("이름을 꼭 기입해 주세요.");
      return;
    }
    saveEmployees(employees.map((employee) => employee.id === normalizedDraft.id ? normalizedDraft : employee));
    cancelEmployeeEdit();
  };

  const recordStaffMovement = async (employee: Employee, reason: "퇴사" | "지점이동", date: string, destination?: string) => {
    const key = `staff_movements:${branchName}`;
    const previous = (await gasClient.getSharedData<any[]>(key)) || [];
    await gasClient.saveSharedData(key, [{
      id: `movement-${Date.now()}`,
      type: reason,
      employeeName: employee.name,
      fromBranch: branchName,
      toBranch: reason === "지점이동" ? destination || "-" : "-",
      effectiveDate: date,
      createdAt: new Date().toISOString()
    }, ...previous]);
  };

  const handleAddEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const formattedResident = formatResidentNumber(newResidentNumber);
    if (formattedResident.replace(/\D/g, "").length !== 13) {
      alert("주민등록번호 13자리를 모두 입력해 주세요.");
      return;
    }
    if (!newAddReason) {
      alert("추가사유를 선택해 주세요.");
      return;
    }
    if (newAddReason === "신규입사" && !newEntryDate) {
      alert("신규입사일을 선택해 주세요.");
      return;
    }
    if (newAddReason === "신규입사" && toPhoneTail8(newPhoneDigits).length !== 8) {
      alert("핸드폰번호 8자리를 입력해 주세요. 010은 제외합니다.");
      return;
    }
    if (newAddReason === "지점이동" && (!newFromBranch.trim() || !newTransferDate)) {
      alert("이동 전 지점과 이동일을 입력해 주세요.");
      return;
    }
    if (newAddReason === "기타" && !newAddReasonMemo.trim()) {
      alert("기타 추가 사유를 입력해 주세요.");
      return;
    }
    const matchedDup = getSameNameWarning(newName, formattedResident, employees, division);
    if (matchedDup) {
      alert(matchedDup);
      return;
    }

    const nextEmp: Employee = {
      id: `emp-${Date.now()}`,
      name: newName.trim(),
      division,
      residentNumber: formattedResident,
      contractType: newContractType,
      entryDate: newAddReason === "지점이동" ? newTransferDate : newEntryDate,
      phone: newAddReason === "신규입사" ? formatMobilePhone(newPhoneDigits) : "",
      addReason: newAddReason,
      fromBranch: newAddReason === "지점이동" ? newFromBranch.trim() : "",
      transferDate: newAddReason === "지점이동" ? newTransferDate : "",
      salaryChanged: newAddReason === "지점이동" ? parseSalaryChangeStatus(newSalaryChanged) || undefined : undefined,
      hireDate: newAddReason === "신규입사" ? newEntryDate : "",
      addReasonMemo: newAddReason === "기타" ? newAddReasonMemo.trim() : "",
      ...(division === "정직원" ? {
        rank: selectedRank,
        ...(selectedRank === "기타" ? { customRank: customRankInput.trim() } : {})
      } : {})
    };

    const updated = [...employees, nextEmp];
    saveEmployees(updated);
    setNewName("");
    setSelectedRank("");
    setCustomRankInput("");
    setNewResidentNumber("");
    setNewContractType("4대보험");
    setNewEntryDate("");
    setNewPhoneDigits("");
    setNewAddReason("");
    setNewFromBranch("");
    setNewTransferDate("");
    setNewSalaryChanged("");
    setNewAddReasonMemo("");
  };

  const updateRosterAddDraft = (id: string, patch: Partial<StaffAddDraft>) => {
    setRosterAddDrafts((current) => current.map((draft) => {
      if (draft.id !== id) return draft;
      const next = { ...draft, ...patch };
      if (patch.division === "정직원") next.contractType = "4대보험";
      if (patch.division === "파트타이머") {
        next.contractType = "3.3%";
        next.rank = "";
      }
      if (patch.addReason === "") {
        next.entryDate = "";
        next.phoneDigits = "";
        next.fromBranch = "";
        next.transferDate = "";
        next.salaryChanged = "";
        next.addReasonMemo = "";
      }
      if (patch.addReason === "신규입사") {
        next.transferDate = "";
        next.salaryChanged = "";
        next.addReasonMemo = "";
      }
      if (patch.addReason === "지점이동") {
        next.entryDate = "";
        next.phoneDigits = "";
        next.fromBranch = "";
        next.addReasonMemo = "";
        next.salaryChanged = next.salaryChanged || "";
      }
      if (patch.addReason === "기존직원") {
        next.entryDate = "";
        next.phoneDigits = "";
        next.fromBranch = "";
        next.transferDate = "";
        next.salaryChanged = "";
        next.addReasonMemo = "";
      }
      if (patch.addReason === "기타") {
        next.entryDate = "";
        next.phoneDigits = "";
        next.fromBranch = "";
        next.transferDate = "";
        next.salaryChanged = "";
      }
      return next;
    }));
  };

  const registerRosterAddDrafts = () => {
    const filledDrafts = rosterAddDrafts.filter((draft) => draft.name.trim());
    if (filledDrafts.length === 0) {
      alert("추가할 근무자 이름을 입력해주세요.");
      return;
    }

    const nextEmployees: Employee[] = [];
    for (const draft of filledDrafts) {
      const name = draft.name.trim();
      const residentBirth = residentBirthKey(draft.residentNumber);
      if (residentBirth.length !== 6) {
        alert(`${name} 님의 주민등록번호 앞 6자리를 입력해 주세요.`);
        return;
      }
      if (!draft.addReason) {
        alert(`${name} 님의 추가사유를 선택해 주세요.`);
        return;
      }
      const matchedDup = getSameNameWarning(name, residentBirth, [...employees, ...nextEmployees], draft.division);
      if (matchedDup) {
        alert(matchedDup);
        return;
      }

      nextEmployees.push({
        id: `emp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        division: draft.division,
        residentNumber: residentBirth,
        contractType: draft.contractType,
        entryDate: draft.addReason === "지점이동" ? draft.transferDate : draft.entryDate,
        phone: draft.addReason === "신규입사" ? formatMobilePhone(draft.phoneDigits) : "",
        addReason: draft.addReason,
        fromBranch: "",
        transferDate: draft.addReason === "지점이동" ? draft.transferDate : "",
        salaryChanged: draft.addReason === "지점이동" ? parseSalaryChangeStatus(draft.salaryChanged) || undefined : undefined,
        hireDate: draft.addReason === "신규입사" ? draft.entryDate : "",
        addReasonMemo: draft.addReason === "기타" ? draft.addReasonMemo.trim() : ""
      });
    }

    saveEmployees([...employees, ...nextEmployees]);
    setRosterAddDrafts([createStaffAddDraft()]);
    localStorage.removeItem(staffAddDraftStorageKey(branchName));
  };

  // Staff category counters
  const sortedEmployees = useMemo(() => {
    return [...employees].sort((a, b) => {
      if (a.division === "정직원" && b.division !== "정직원") return -1;
      if (a.division !== "정직원" && b.division === "정직원") return 1;
      return a.name.localeCompare(b.name, "ko");
    });
  }, [employees]);

  const regularCount = employees.filter((e) => e.division === "정직원").length;
  const partTimeCount = employees.filter((e) => e.division === "파트타이머").length;

  return (
    <div className="space-y-6" id="roster-tab-view">
      {/* Deletion Modal */}
      <AnimatePresence>
        {showDeleteModal && employeeToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl p-6 max-w-sm w-full border border-gray-100 shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-2.5 pb-2 border-b border-gray-100 text-rose-600">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 className="text-base font-black text-gray-900">지점 근무 인원 삭제 처리</h3>
              </div>

              <p className="text-xs text-gray-500 leading-normal">
                <strong>{employeeToDelete.name}</strong> 님을 명부에서 제외시킵니다. 삭제 사유 및 처리 기준일을 아래 입력하여 주십시오.
              </p>

              <div className="space-y-3.5 text-xs">
                <div className="flex flex-col space-y-1">
                  <span className="font-bold text-gray-400">삭제 구분 (사유)</span>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "퇴사", val: "퇴사" },
                      { label: "지점이동", val: "지점이동" }
                    ].map((btn) => {
                      const checked = deleteReason === btn.val;
                      return (
                        <button
                          key={btn.val}
                          type="button"
                          onClick={() => setDeleteReason(btn.val as any)}
                          className={`py-2 rounded-xl border font-black text-xs transition-colors cursor-pointer ${
                            checked
                              ? "bg-rose-500 border-rose-500 text-white shadow-xs"
                              : "bg-white border-gray-200 text-gray-500 hover:text-gray-700"
                          }`}
                        >
                          {btn.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {deleteReason === "지점이동" && (
                  <div className="flex flex-col space-y-1">
                    <span className="font-bold text-gray-400">이동한 지점</span>
                    {loadingBranches ? (
                      <span className="text-xs text-gray-400 font-mono">불러오는 중...</span>
                    ) : (
                      <select
                        value={targetBranch}
                        onChange={(e) => setTargetBranch(e.target.value)}
                        className="px-3.5 py-2 border border-gray-200 rounded-xl bg-white font-semibold text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden"
                      >
                        {branchList.length === 0 ? (
                          <option value="">(이동 가능한 타 지점이 없음)</option>
                        ) : (
                          branchList.map((b) => (
                            <option key={b.branchName} value={b.branchName}>{b.branchName}</option>
                          ))
                        )}
                      </select>
                    )}
                  </div>
                )}

                <div className="flex flex-col space-y-1">
                  <span className="font-bold text-gray-400">{deleteReason === "퇴사" ? "퇴사 날짜" : "지점이동 날짜"}</span>
                  <input
                    type="date"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                    onClick={(e) => e.currentTarget.showPicker?.()}
                    onFocus={(e) => e.currentTarget.showPicker?.()}
                    className="px-3.5 py-2 border border-gray-200 rounded-xl font-mono text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden cursor-pointer w-full text-xs"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-3 border-t border-gray-100 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowDeleteModal(false);
                    setEmployeeToDelete(null);
                  }}
                  className="px-4 py-2 bg-gray-100 text-gray-500 font-extrabold cursor-pointer rounded-xl text-xs hover:bg-gray-200 transition-colors"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const updated = employees.filter((emp) => emp.id !== employeeToDelete.id);
                    saveEmployees(updated);
                    try {
                      await recordStaffMovement(employeeToDelete, deleteReason, effectiveDate, targetBranch);
                    } catch (error) {
                      console.error("Staff movement history save failed:", error);
                    }

                    const detailMsg = deleteReason === "지점이동"
                      ? `[${employeeToDelete.name}] 님이 ${effectiveDate} 일자로 [${targetBranch}] (으)로 지점이동 삭제 완료되었습니다.`
                      : `[${employeeToDelete.name}] 님이 ${effectiveDate} 일자로 퇴사 처리 삭제 완료되었습니다.`;

                    alert(detailMsg);

                    setShowDeleteModal(false);
                    setEmployeeToDelete(null);
                  }}
                  className="px-4 py-2 bg-rose-500 text-white hover:bg-rose-600 font-extrabold cursor-pointer rounded-xl text-xs transition-colors"
                >
                  삭제 확정
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showEditModal && employeeToEdit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-3xl p-6 max-w-sm w-full border border-gray-100 shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-2.5 pb-2 border-b border-gray-100 text-blue-700">
                <Pencil className="w-5 h-5 shrink-0" />
                <h3 className="text-base font-black text-gray-900">지점 근무 인원 정보 수정</h3>
              </div>

              <div className="space-y-3.5 text-xs">
                {/* 이름수정 */}
                <div className="flex flex-col space-y-1">
                  <span className="font-bold text-gray-400">성명 (이름)</span>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="근무자 실명 입력"
                    className="px-3.5 py-2 border border-gray-200 rounded-xl font-bold text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden text-xs w-full bg-white"
                  />
                </div>

                {/* 계약 구분 수정 */}
                <div className="flex flex-col space-y-1">
                  <span className="font-bold text-gray-400">구분</span>
                  <select
                    value={editDivision}
                    onChange={(e) => {
                      const div = e.target.value as "정직원" | "파트타이머";
                      setEditDivision(div);
                      if (div === "파트타이머") {
                        setEditRank("");
                        setEditCustomRank("");
                      }
                    }}
                    className="px-3.5 py-2 border border-gray-200 rounded-xl bg-white font-bold text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden text-xs w-full"
                  >
                    <option value="정직원">정직원</option>
                    <option value="파트타이머">파트타이머</option>
                  </select>
                </div>

                {/* 직급 수정 */}
                {editDivision === "정직원" && (
                  <div className="flex flex-col space-y-1">
                    <span className="font-bold text-gray-400">직급 선택</span>
                    <select
                      value={editRank}
                      onChange={(e) => {
                        setEditRank(e.target.value);
                        if (e.target.value !== "기타") {
                          setEditCustomRank("");
                        }
                      }}
                      className="px-3.5 py-2 border border-gray-200 rounded-xl bg-white font-bold text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden text-xs w-full"
                    >
                      <option value="">직급 선택</option>
                      {["사원", "대리", "과장", "차장", "실장", "부장", "이사", "대표", "부대표", "기타"].map((rk) => (
                        <option key={rk} value={rk}>{rk}</option>
                      ))}
                    </select>

                    {editRank === "기타" && (
                      <div className="flex flex-col space-y-1 pt-1">
                        <span className="text-[10px] text-gray-400 font-bold">기타 직급 입력</span>
                        <input
                          type="text"
                          value={editCustomRank}
                          onChange={(e) => setEditCustomRank(e.target.value)}
                          placeholder="예: 지점장 등"
                          className="px-3 py-1.5 border border-gray-200 rounded-lg font-bold text-xs bg-white focus:outline-hidden focus:border-[#2E6DB4]"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col space-y-1">
                    <label className="font-bold text-gray-400">주민등록번호</label>
                    <input
                      type="text"
                      value={editResidentNumber}
                      onChange={(e) => setEditResidentNumber(formatResidentNumber(e.target.value))}
                      placeholder="000000-0000000"
                      className="px-3.5 py-2 border border-gray-200 rounded-xl font-mono text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden text-xs w-full"
                    />
                  </div>
                  <div className="flex flex-col space-y-1">
                    <label className="font-bold text-gray-400">계약형태</label>
                    <select
                      value={editContractType}
                      onChange={(e) => setEditContractType(e.target.value as "4대보험" | "3.3%")}
                      className="px-3.5 py-2 border border-gray-200 rounded-xl bg-white font-bold text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden text-xs w-full"
                    >
                      <option value="4대보험">4대보험</option>
                      <option value="3.3%">3.3%</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-col space-y-1">
                  <label className="font-bold text-gray-400">입사일</label>
                  <input
                    type="date"
                    value={editEntryDate}
                    onChange={(e) => setEditEntryDate(e.target.value)}
                    onClick={(e) => e.currentTarget.showPicker?.()}
                    className="px-3.5 py-2 border border-gray-200 rounded-xl font-mono text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden text-xs w-full cursor-pointer"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-3 border-t border-gray-100 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setEmployeeToEdit(null);
                  }}
                  className="px-4 py-2 bg-gray-100 text-gray-500 font-extrabold cursor-pointer rounded-xl text-xs hover:bg-gray-200 transition-colors"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  className="px-4 py-2 bg-[#2E6DB4] text-white font-extrabold cursor-pointer rounded-xl text-xs transition-colors"
                >
                  저장 완료
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Addition Left Form */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-3">
        <h3 className="text-sm font-black text-gray-800 w-fit">신규 등록</h3>

        <div className="space-y-2 bg-zinc-50 p-3 rounded-xl border border-gray-100 text-xs">
          {rosterAddDrafts.map((draft, draftIndex) => (
            <div key={draft.id} className="flex flex-wrap items-center gap-2">
              <span className="font-extrabold text-zinc-800 w-8">추가</span>
              <input type="text" placeholder="이름" value={draft.name} onChange={(e) => updateRosterAddDraft(draft.id, { name: e.target.value })} className="w-24 px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:border-zinc-800 focus:outline-hidden font-bold" />
              <select value={draft.division} onChange={(e) => updateRosterAddDraft(draft.id, { division: e.target.value as "정직원" | "파트타이머" })} className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white font-extrabold cursor-pointer">
                <option value="정직원">정직원</option>
                <option value="파트타이머">파트타이머</option>
              </select>
              <input type="text" inputMode="numeric" maxLength={6} placeholder="주민 앞6" value={residentBirthKey(draft.residentNumber)} onChange={(e) => updateRosterAddDraft(draft.id, { residentNumber: e.target.value.replace(/\D/g, "").slice(0, 6) })} className="w-24 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:border-zinc-800 focus:outline-hidden font-mono" />
              <select value={draft.addReason} onChange={(e) => updateRosterAddDraft(draft.id, { addReason: parseStaffAddReasonChoice(e.target.value) })} className={`w-32 px-2 py-1.5 text-xs ${getAddReasonChoiceClass(draft.addReason)}`}>
                <option value="">선택</option>
                <option value="신규입사">신규입사</option>
                <option value="지점이동">지점이동</option>
                <option value="기존직원">기존직원</option>
                <option value="기타">기타</option>
              </select>
              {draft.addReason === "신규입사" && (
                <>
                  <label className="flex items-center gap-2 px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-extrabold text-gray-600 bg-white cursor-pointer">
                    <span>입사일</span>
                    <input type="date" value={draft.entryDate} onChange={(e) => updateRosterAddDraft(draft.id, { entryDate: e.target.value })} onClick={(e) => e.currentTarget.showPicker?.()} aria-label="신규입사일" className="w-28 bg-transparent focus:outline-hidden font-mono cursor-pointer" />
                  </label>
                  <label className="flex items-center border border-gray-200 rounded-lg bg-white overflow-hidden text-xs">
                    <span className="px-2 py-1.5 bg-gray-100 text-gray-500 font-extrabold border-r border-gray-200">010</span>
                    <input type="text" inputMode="numeric" placeholder="12345678" value={draft.phoneDigits} onChange={(e) => updateRosterAddDraft(draft.id, { phoneDigits: toPhoneTail8(e.target.value) })} className="w-24 px-2 py-1.5 bg-white focus:outline-hidden font-mono font-bold" aria-label="핸드폰번호 뒤 8자리" />
                  </label>
                </>
              )}
              {draft.addReason === "지점이동" && (
                <>
                  <label className="flex items-center gap-2 px-2 py-1.5 border border-gray-200 rounded-lg text-xs font-extrabold text-gray-600 bg-white cursor-pointer">
                    <span>이동일</span>
                    <input type="date" value={draft.transferDate} onChange={(e) => updateRosterAddDraft(draft.id, { transferDate: e.target.value })} onClick={(e) => e.currentTarget.showPicker?.()} aria-label="이동일" className="w-28 bg-transparent focus:outline-hidden font-mono cursor-pointer" />
                  </label>
                  <select value={draft.salaryChanged} onChange={(e) => updateRosterAddDraft(draft.id, { salaryChanged: parseSalaryChangeChoice(e.target.value) })} className={`w-32 px-2 py-1.5 text-xs ${getSalaryChoiceClass(draft.salaryChanged)}`}>
                    <option value="">선택</option>
                    <option value="없음">급여변동 없음</option>
                    <option value="있음">급여변동 있음</option>
                  </select>
                </>
              )}
              {draft.addReason === "기타" && <input type="text" placeholder="추가 사유" value={draft.addReasonMemo} onChange={(e) => updateRosterAddDraft(draft.id, { addReasonMemo: e.target.value })} className="w-40 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white focus:border-zinc-800 focus:outline-hidden" />}
              {rosterAddDrafts.length > 1 && <button type="button" onClick={() => setRosterAddDrafts((current) => current.filter((item) => item.id !== draft.id))} className="px-2 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-rose-600 font-black">삭제</button>}
              {draftIndex === rosterAddDrafts.length - 1 && <button type="button" onClick={() => setRosterAddDrafts((current) => [...current, createStaffAddDraft()])} className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-zinc-700 font-black hover:bg-gray-100">행 추가</button>}
            </div>
          ))}
          <div className="flex justify-end">
            <button type="button" onClick={registerRosterAddDrafts} className="px-4 py-1.5 bg-[#2E6DB4] text-white font-black rounded-lg cursor-pointer transition-colors">입력한 행 등록</button>
          </div>
        </div>
      </div>

      {/* Roster Right list */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-3">
          <div>
            <h3 className="text-sm font-black text-gray-800">지점 등록 근무 인원</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">명부에 등록된 리스트가 매 정산 기록에 자동 출현합니다.</p>
          </div>

          <div className="flex gap-2 text-[10px] font-black">
            <span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-lg">정직원: {regularCount}명</span>
            <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-lg">파트타이머: {partTimeCount}명</span>
          </div>
        </div>

        <div className="overflow-hidden">
          <table className="w-full table-fixed text-left text-xs border-collapse">
            <colgroup>
              <col className="w-[8%]" />
              <col className="w-[13%]" />
              <col className="w-[13%]" />
              <col className="w-[11%]" />
              <col className="w-[14%]" />
              <col className="w-[17%]" />
              <col className="w-[15%]" />
              <col className="w-[9%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 font-bold">
                <th className="py-2.5 px-2 leading-tight">근무자번호</th>
                <th className="py-2.5 px-2 leading-tight">성명</th>
                <th className="py-2.5 px-2 leading-tight">
                  <span className="block">주민등록번호</span>
                  <span className="block">앞6자리</span>
                </th>
                <th className="py-2.5 px-2 leading-tight">분류</th>
                <th className="py-2.5 px-2 leading-tight">추가 사유</th>
                <th className="py-2.5 px-2 leading-tight">
                  <span className="block">입사일자</span>
                  <span className="block">지점이동 날짜</span>
                </th>
                <th className="py-2.5 px-2 leading-tight">
                  <span className="block">핸드폰번호</span>
                  <span className="block">급여변동</span>
                </th>
                <th className="py-2.5 px-2 text-right leading-tight">활동</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-medium">
              {sortedEmployees.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400">
                    등록된 조원이 아무도 없습니다. 새로운 근무 인원을 명부에 먼저 기입해 보십시오.
                  </td>
                </tr>
              ) : (
                sortedEmployees.map((emp, idx) => {
                  const isEditing = editingEmployeeId === emp.id;
                  const row = isEditing && editingEmployeeDraft?.id === emp.id ? editingEmployeeDraft : emp;
                  const staffReason = row.addReason || "";
                  const hireDate = row.hireDate || (staffReason === "신규입사" ? row.entryDate : "");
                  const transferDate = row.transferDate || (staffReason === "지점이동" ? row.entryDate : "");
                  const phoneTail = toPhoneTail8(row.phone || "");
                  const savedPhoneTail = toPhoneTail8(emp.phone || "");
                  return (
                  <tr key={emp.id} className="hover:bg-gray-50/50 font-semibold text-[11px] sm:text-xs">
                    <td className="py-3 px-2 text-gray-400 font-mono whitespace-nowrap">#{idx + 1}</td>
                    <td className="py-3 px-2 text-gray-800 font-extrabold">
                      {isEditing ? (
                        <input
                          type="text"
                          value={row.name}
                          onChange={(e) => updateEmployeeEditDraft("name", e.target.value)}
                          className="w-full min-w-0 px-2 py-1 border border-gray-200 rounded-md text-xs font-bold focus:border-[#2E6DB4] focus:outline-hidden"
                        />
                      ) : <span className="block truncate" title={emp.name}>{emp.name}</span>}
                    </td>
                    <td className="py-3 px-2">
                      {isEditing ? (
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={residentBirthKey(row.residentNumber)}
                          onChange={(e) => updateEmployeeEditDraft("residentNumber", e.target.value.replace(/\D/g, "").slice(0, 6))}
                          placeholder="앞6자리"
                          className="w-full min-w-0 px-2 py-1 border border-gray-200 rounded-md font-mono text-xs text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden"
                        />
                      ) : <span className="font-mono text-xs text-gray-600">{residentBirthKey(emp.residentNumber) || "-"}</span>}
                    </td>
                    <td className="py-3 px-2">
                      {isEditing ? (
                        <select
                          value={row.division}
                          onChange={(e) => updateEmployeeEditDraft("division", e.target.value)}
                          className={`w-full max-w-full px-1.5 py-1 rounded-lg text-[10px] font-black border focus:outline-hidden cursor-pointer ${
                            row.division === "정직원"
                              ? "bg-amber-50 text-amber-700 border-amber-200 focus:border-amber-400"
                              : "bg-blue-50 text-blue-700 border-blue-200 focus:border-blue-400"
                          }`}
                        >
                          <option value="정직원">정직원</option>
                          <option value="파트타이머">파트타이머</option>
                        </select>
                      ) : <span className={`inline-flex max-w-full px-1.5 py-1 rounded-lg text-[10px] font-black ${emp.division === "정직원" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`} title={emp.division}><span className="truncate">{emp.division}</span></span>}
                    </td>
                    <td className="py-3 px-2">
                      {isEditing ? (
                        <select
                          value={staffReason}
                          onChange={(e) => updateEmployeeEditDraft("addReason", e.target.value)}
                          className={`w-full min-w-0 px-1.5 py-1 text-[11px] ${getAddReasonChoiceClass(staffReason)} ${!staffReason ? "branch-choice-required" : ""}`}
                        >
                          <option value="">선택</option>
                          <option value="신규입사">신규입사</option>
                          <option value="지점이동">지점이동</option>
                          <option value="기존직원">기존직원</option>
                          <option value="기타">기타</option>
                        </select>
                      ) : (
                        <span className={`inline-flex w-full min-w-0 justify-center rounded-lg px-1.5 py-1 text-[11px] font-black ${getAddReasonChoiceClass(staffReason)} ${!staffReason ? "branch-choice-required" : ""} branch-choice-badge`}>
                          {staffReason || "선택"}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-2">
                      {isEditing && staffReason === "신규입사" && (
                        <input
                          type="date"
                          value={hireDate || ""}
                          onChange={(e) => updateEmployeeEditDraft("hireDate", e.target.value)}
                          onClick={(e) => e.currentTarget.showPicker?.()}
                          className="w-full min-w-0 px-1.5 py-1 border border-gray-200 rounded-md font-mono text-[11px] text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden cursor-pointer"
                          aria-label={`${emp.name} 입사일자`}
                        />
                      )}
                      {isEditing && staffReason === "지점이동" && (
                        <input
                          type="date"
                          value={transferDate || ""}
                          onChange={(e) => updateEmployeeEditDraft("transferDate", e.target.value)}
                          onClick={(e) => e.currentTarget.showPicker?.()}
                          className="w-full min-w-0 px-1.5 py-1 border border-gray-200 rounded-md font-mono text-[11px] text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden cursor-pointer"
                          aria-label={`${emp.name} 지점이동 날짜`}
                        />
                      )}
                      {isEditing && staffReason === "기타" && (
                        <input
                          type="text"
                          value={row.addReasonMemo || ""}
                          onChange={(e) => updateEmployeeEditDraft("addReasonMemo", e.target.value)}
                          placeholder="사유"
                          className="w-full min-w-0 px-1.5 py-1 border border-gray-200 rounded-md text-[11px] font-bold text-gray-700 focus:border-[#2E6DB4] focus:outline-hidden"
                        />
                      )}
                      {!isEditing && staffReason === "신규입사" && <span className="font-mono text-[11px] text-gray-600">{hireDate || "-"}</span>}
                      {!isEditing && staffReason === "지점이동" && <span className="font-mono text-[11px] text-gray-600">{transferDate || "-"}</span>}
                      {!isEditing && staffReason === "기타" && <span className="block truncate text-[11px] text-gray-600" title={row.addReasonMemo || ""}>{row.addReasonMemo || "-"}</span>}
                      {!staffReason && <span className="inline-flex rounded-md border border-dashed border-gray-200 bg-white px-2 py-1 text-[11px] font-black text-gray-400">선택</span>}
                      {staffReason === "기존직원" && <span className="text-xs text-gray-400">-</span>}
                    </td>
                    <td className="py-3 px-2">
                      {isEditing && staffReason === "신규입사" && (
                        <label className="flex w-full min-w-0 items-center overflow-hidden rounded-md border border-gray-200 bg-white focus-within:border-[#2E6DB4]">
                          <span className="shrink-0 border-r border-gray-200 bg-gray-50 px-1.5 py-1 text-[10px] font-black text-gray-400">010</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={8}
                            value={phoneTail}
                            onChange={(e) => updateEmployeeEditDraft("phone", e.target.value.replace(/\D/g, "").slice(0, 8))}
                            placeholder="새 번호 입력"
                            className="min-w-0 flex-1 bg-transparent px-1.5 py-1 font-mono text-[11px] font-bold text-gray-700 focus:outline-hidden"
                            aria-label={`${emp.name} 핸드폰번호 뒤 8자리`}
                          />
                        </label>
                      )}
                      {isEditing && staffReason === "지점이동" && (
                        <select
                          value={row.salaryChanged || ""}
                          onChange={(e) => updateEmployeeEditDraft("salaryChanged", e.target.value)}
                          className={`w-full min-w-0 px-1.5 py-1 text-[11px] ${getSalaryChoiceClass(row.salaryChanged || "")}`}
                        >
                          <option value="">선택</option>
                          <option value="없음">급여변동 없음</option>
                          <option value="있음">급여변동 있음</option>
                        </select>
                      )}
                      {!isEditing && staffReason === "신규입사" && <span className={`branch-sensitive-hidden ${savedPhoneTail ? "" : "branch-sensitive-missing"}`}>{savedPhoneTail ? "본사 전송" : "미입력"}</span>}
                      {!isEditing && staffReason === "지점이동" && <span className={`branch-sensitive-hidden ${emp.salaryChanged ? "" : "branch-sensitive-missing"}`}>{emp.salaryChanged ? "본사 전송" : "미입력"}</span>}
                      {!staffReason && <span className="inline-flex rounded-md border border-dashed border-gray-200 bg-white px-2 py-1 text-[11px] font-black text-gray-400">선택</span>}
                      {(staffReason === "기존직원" || staffReason === "기타") && <span className="text-xs text-gray-400">-</span>}
                    </td>
                    <td className="py-3 px-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={saveEmployeeEdit}
                              className="p-1.5 rounded-lg bg-[#2E6DB4] text-white"
                              title="저장"
                              aria-label="저장"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={cancelEmployeeEdit}
                              className="p-1.5 rounded-lg bg-gray-100 text-gray-500 hover:text-gray-800"
                              title="취소"
                              aria-label="취소"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEmployeeEdit(emp)}
                            className="text-gray-400 hover:text-blue-700 p-1.5 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                            title="정보 수정"
                            aria-label="정보 수정"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEmployeeToDelete(emp);
                            setDeleteReason("퇴사");
                            setShowDeleteModal(true);
                          }}
                          className="text-gray-400 hover:text-rose-600 p-1.5 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
                          title="명부 삭제"
                          aria-label="명부 삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
