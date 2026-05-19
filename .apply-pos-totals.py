"""
일일정산내역 JPG 라벨링 결과로 JSON 갱신:
- totals의 supply/vat 정확값으로 덮어쓰기
- posCash/posCard 정확값 반영
- cardRows 갱신 (카드사별)
- extras.discount, extras.service 추가 (참고)

posRows·purchaseRows는 보존.
"""
import json
from pathlib import Path

JSON_DIR = Path(r"G:\내 드라이브\아스트라\라벨링_정리본")

# 일일정산내역 라벨링 결과 (Claude vision으로 추출)
UPDATES = {
    "2026-05-09": {
        "supply": 511091, "vat": 51109, "posTotal": 562200,
        "posCard": 562200, "posCash": 0,
        "discount": 0, "service": 0,
        "cardRows": [
            {"issuer": "국민카드", "amount": 232300},
            {"issuer": "신한카드", "amount": 108800},
            {"issuer": "하나카드", "amount": 171500},
            {"issuer": "현대카드", "amount": 49800},
        ],
    },
    "2026-05-10": {
        "supply": 235455, "vat": 23545, "posTotal": 259000,
        "posCard": 259000, "posCash": 0,
        "discount": 0, "service": 0,
        "cardRows": [
            {"issuer": "하나카드", "amount": 107800},
            {"issuer": "현대카드", "amount": 50800},
            {"issuer": "NH카드",  "amount": 100400},
        ],
    },
    "2026-05-12": {
        "supply": 245729, "vat": 24571, "posTotal": 270300,
        "posCard": 270300, "posCash": 0,
        "discount": 0, "service": 29900,
        "cardRows": [
            {"issuer": "국민카드", "amount": 270300},
        ],
    },
    "2026-05-13": {
        "supply": 101456, "vat": 10144, "posTotal": 111600,
        "posCard": 111600, "posCash": 0,
        "discount": 0, "service": 21900,
        "cardRows": [
            {"issuer": "국민카드", "amount": 111600},
        ],
    },
    "2026-05-15": {
        "supply": 3791185, "vat": 379115, "posTotal": 4170300,
        "posCard": 4170300, "posCash": 0,
        "discount": 311100, "service": 16000,
        "cardRows": [
            {"issuer": "국민카드", "amount": 809600},
            {"issuer": "삼성카드", "amount": 54800},
            {"issuer": "삼성카드", "amount": 1810700},
            {"issuer": "신한카드", "amount": 169500},
            {"issuer": "우리카드", "amount": 661400},
            {"issuer": "현대카드", "amount": 664300},
        ],
    },
    "2026-05-16": {
        "supply": 317090, "vat": 31710, "posTotal": 348800,
        "posCard": 348800, "posCash": 0,
        "discount": 0, "service": 64800,
        "cardRows": [
            {"issuer": "삼성카드", "amount": 48800},
            {"issuer": "신한카드", "amount": 300000},
        ],
    },
    "2026-05-17": {
        "supply": 474365, "vat": 47435, "posTotal": 521800,
        "posCard": 391400, "posCash": 130400,
        "discount": 0, "service": 4000,
        "cardRows": [
            {"issuer": "국민카드", "amount": 159400},
            {"issuer": "롯데카드", "amount": 40800},
            {"issuer": "신한카드", "amount": 74700},
            {"issuer": "하나카드", "amount": 54800},
            {"issuer": "비씨카드", "amount": 61700},
        ],
    },
    "2026-05-18": {
        "supply": 85091, "vat": 8509, "posTotal": 93600,
        "posCard": 93600, "posCash": 0,
        "discount": 0, "service": 0,
        "cardRows": [
            {"issuer": "국민카드", "amount": 93600},
        ],
    },
}

# 5/16 단지푸드 3/3 페이지가 추가됨 → 5/16 매입 데이터 추가
PURCHASE_5_16 = {
    "date": "2026-05-16",
    "vendor": "(주)단지푸드",
    "category": "식자재",
    "docType": "거래내역서",
    "supply": 559904,
    "vat": 39246,
    "total": 599150,
    "method": "계좌이체",
    "bizNo": "547-81-02961",
    "memo": "주방매입 — 3페이지 영수증",
}

for date_str, upd in UPDATES.items():
    json_path = JSON_DIR / f"{date_str}.json"
    if not json_path.exists():
        print(f"  {date_str}: JSON 없음 (skip)")
        continue
    data = json.loads(json_path.read_text(encoding="utf-8"))
    # totals 정확값으로 덮어쓰기
    tt = data.setdefault("totals", {})
    tt["posTotal"] = upd["posTotal"]
    tt["posCard"] = upd["posCard"]
    tt["posCash"] = upd["posCash"]
    tt["posEtc"] = 0
    tt["cardTotal"] = upd["posCard"]
    tt["supply"] = upd["supply"]
    tt["vat"] = upd["vat"]
    # cardRows 갱신
    data["cardRows"] = [
        {"time": "", "issuer": r["issuer"], "approvalNo": "", "amount": r["amount"]}
        for r in upd["cardRows"]
    ]
    # extras에 할인·서비스 메모 (참고용)
    extras = data.setdefault("extras", {})
    extras["vatRate"] = 10
    if upd["discount"]: extras["discount"] = upd["discount"]
    if upd["service"]:  extras["service"] = upd["service"]
    # salesMemo 업데이트
    data["salesMemo"] = (
        f"매출: 일일정산내역 JPG 라벨링 (정확값). 순매출 {upd['posTotal']:,} = "
        f"카드 {upd['posCard']:,} + 현금 {upd['posCash']:,}. "
        f"공급가 {upd['supply']:,} + 부가세 {upd['vat']:,}. "
        f"할인 {upd['discount']:,} + 서비스 {upd['service']:,}."
    )
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  {date_str}: totals/cardRows 갱신 (카드 {len(upd['cardRows'])}사)")

# 5/16 매입(단지푸드 3/3 페이지)을 5/16 JSON의 purchaseRows에 추가/덮어쓰기
json_path = JSON_DIR / "2026-05-16.json"
data = json.loads(json_path.read_text(encoding="utf-8"))
# 단지푸드 기존 항목 제거 후 추가 (중복 방지)
prs = [p for p in data.get("purchaseRows", []) if p.get("vendor") != "(주)단지푸드"]
prs.append(PURCHASE_5_16)
data["purchaseRows"] = prs
json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"  2026-05-16: 단지푸드 매입 추가 (공급가 559,904 / 부가세 39,246)")

print("\n완료")
