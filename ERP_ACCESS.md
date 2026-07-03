# ERP Access Notes

## Branch
- Store: 대물섬 한남점
- Branch PIN: 2895

## Admin
- Admin PIN: 1123

## Current Check
- Issue: 수기 초과근무 기록은 좌측 초과근무 내역에 표시되지만 우측 초과근무 인원 집계에서 누락될 수 있음.
- Fix direction: 수기 데이터의 `overtime`, `overtimeHours`, `hours`, `totalOvertime` 필드를 모두 집계 대상으로 처리.
