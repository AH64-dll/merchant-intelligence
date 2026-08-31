"""Reviewed, transactional consolidation of branch-shaped merchant records."""

from __future__ import annotations

import json
import sqlite3
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Mapping, Sequence

from merchant_intel.database import Database
from merchant_intel.normalize import (
    canonicalize_name,
    claim_fingerprint,
    evidence_fingerprint,
    normalize_claim_text,
)


@dataclass(frozen=True)
class MergeGroup:
    target_id: str
    retired_ids: tuple[str, ...]
    canonical_name: str | None = None
    category_override: str | None = None


MERGE_MANIFEST: tuple[MergeGroup, ...] = (
    MergeGroup(
        "0abffb14-4754-4d4a-8ec7-78a5732a9264",
        (
            "306c4864-694f-46ce-bb9a-0e18f9d31c3a",
            "31c54405-381c-4364-a49c-a8a9244f7471",
            "d08748d3-b6be-4185-a32e-e439d19d3c72",
        ),
    ),
    MergeGroup(
        "842ad9fe-ecfc-46f4-b065-e945fb3aaa3d",
        ("cdbc1046-a283-4207-8519-6829b2d8a451",),
    ),
    MergeGroup(
        "3af4b233-ad29-4155-b436-3573576e1daf",
        ("0f9b3f71-e2b2-41fb-b834-61ad2375282c",),
    ),
    MergeGroup(
        "e6c3d479-b106-4cdb-a700-15e752033255",
        (
            "c5cbf814-b4d4-4e99-9532-367282905da1",
            "bb9cac92-eb9d-4c53-b3c1-97c8352fa2d7",
            "76fa120c-d0c5-489c-a3c2-a5c33d8678a6",
            "fc74448d-b496-4658-83e4-c938fa9413bf",
        ),
    ),
    MergeGroup(
        "05abc4eb-760c-4842-a467-716d52b1bd04",
        ("7d17483f-507c-4171-8b78-9247687ec489",),
    ),
    MergeGroup(
        "038a190f-731e-4adf-8b80-723276ce3a3d",
        (
            "31492070-416e-4307-bbbb-4915b262950e",
            "93d4fd27-adac-4157-a9a2-c0a0423ecd8e",
        ),
        canonical_name="CompuData Center",
    ),
    MergeGroup(
        "1687538d-eddd-4613-9761-59643d8a9e33",
        ("e266ad28-7e04-4177-9b4e-1975e46fea07",),
    ),
    MergeGroup(
        "d3c830bb-4339-41ed-a636-1c7710ff9825",
        ("804e0ef3-669d-4adb-9573-0f2229b954f2",),
    ),
    MergeGroup(
        "0d6413ef-542d-4c85-a9cd-b480bd0810b3",
        ("06d03aac-055a-4733-a3eb-6874a544f3ea",),
    ),
    MergeGroup(
        "e536f972-8d6c-4513-a099-4a5457fceecf",
        ("1cd85715-2084-4471-8e20-6e435c946271",),
    ),
    MergeGroup(
        "890f8666-c04c-441a-b4ab-78a29ae04f90",
        ("3b2f3927-90df-4826-b256-d69dc32ff8d5",),
    ),
    MergeGroup(
        "eaa59b9e-835a-413d-86a7-b8d64372e09f",
        ("550b1027-c781-4ca3-ab76-8a76fc19d816",),
    ),
    MergeGroup(
        "dab9cc64-1e22-4dcd-9461-1b7fc5cc6634",
        ("53f064aa-0133-4986-9fc2-4a765762a1d4",),
        canonical_name="Delta Computer Supplies — Alexandria",
        category_override="Computer Hardware & Gaming Systems Retailer",
    ),
)

MOHANDESSIN_DELTA_ID = "ab13792f-8499-4f6e-b139-17ff7c4ad0a3"
MOHANDESSIN_DELTA_NAME = "Delta Computer — Mohandessin"

EXPECTED_CURRENT_NAMES: dict[str, str] = {
    "0abffb14-4754-4d4a-8ec7-78a5732a9264": "B.TECH",
    "306c4864-694f-46ce-bb9a-0e18f9d31c3a": "B.TECH",
    "31c54405-381c-4364-a49c-a8a9244f7471": "B.TECH",
    "d08748d3-b6be-4185-a32e-e439d19d3c72": "B.TECH",
    "842ad9fe-ecfc-46f4-b065-e945fb3aaa3d": "Fathalla Gomla Market",
    "cdbc1046-a283-4207-8519-6829b2d8a451": "Fathalla Gomla Market",
    "3af4b233-ad29-4155-b436-3573576e1daf": "Games 2 Egypt",
    "0f9b3f71-e2b2-41fb-b834-61ad2375282c": "Games 2 Egypt",
    "e6c3d479-b106-4cdb-a700-15e752033255": "Raya Shop",
    "c5cbf814-b4d4-4e99-9532-367282905da1": "Raya Shop",
    "bb9cac92-eb9d-4c53-b3c1-97c8352fa2d7": "Raya Shop (Raya Trade & Distribution)",
    "76fa120c-d0c5-489c-a3c2-a5c33d8678a6": "Raya Shop (راية شوب)",
    "fc74448d-b496-4658-83e4-c938fa9413bf": "Raya Shop",
    "05abc4eb-760c-4842-a467-716d52b1bd04": "Shaheen Center",
    "7d17483f-507c-4171-8b78-9247687ec489": "Shaheen Center",
    "038a190f-731e-4adf-8b80-723276ce3a3d": "CompuData Egypt",
    "31492070-416e-4307-bbbb-4915b262950e": "CompuData",
    "93d4fd27-adac-4157-a9a2-c0a0423ecd8e": "CompuData Center",
    "1687538d-eddd-4613-9761-59643d8a9e33": "Compu Fast (كومبيو فاست)",
    "e266ad28-7e04-4177-9b4e-1975e46fea07": "Compu Fast",
    "d3c830bb-4339-41ed-a636-1c7710ff9825": "Compu Science",
    "804e0ef3-669d-4adb-9573-0f2229b954f2": "Compu Science (شركة كمبيو ساينس للكمبيوتر)",
    "0d6413ef-542d-4c85-a9cd-b480bd0810b3": "Fixawy",
    "06d03aac-055a-4733-a3eb-6874a544f3ea": "Fixawy (فيكساوي)",
    "e536f972-8d6c-4513-a099-4a5457fceecf": "Games Spot Egypt (جيمز سبوت)",
    "1cd85715-2084-4471-8e20-6e435c946271": "Games Spot",
    "890f8666-c04c-441a-b4ab-78a29ae04f90": "Kheir Zaman",
    "3b2f3927-90df-4826-b256-d69dc32ff8d5": "Kheir Zaman (Tanta Branch)",
    "eaa59b9e-835a-413d-86a7-b8d64372e09f": "Spinneys Egypt",
    "550b1027-c781-4ca3-ab76-8a76fc19d816": "Spinneys Egypt (Tanta Branch)",
    "dab9cc64-1e22-4dcd-9461-1b7fc5cc6634": "Delta Computer",
    "53f064aa-0133-4986-9fc2-4a765762a1d4": "Delta Computer Alexandria",
    MOHANDESSIN_DELTA_ID: "Delta Computer",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _plain(value: str) -> str:
    return " ".join((value or "").casefold().split())


def _all_ids(manifest: Sequence[MergeGroup]) -> list[str]:
    return [item for group in manifest for item in (group.target_id, *group.retired_ids)]


def _counts(conn: sqlite3.Connection) -> dict[str, int]:
    names = [
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
    ]
    return {name: int(conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]) for name in names}


def _merchant_snapshot(conn: sqlite3.Connection, merchant_ids: Iterable[str]) -> list[dict[str, object]]:
    snapshots: list[dict[str, object]] = []
    dependent_tables = (
        "claims",
        "evidence",
        "merchant_aliases",
        "merchant_analyses",
        "merchant_identifiers",
        "verification_tasks",
    )
    for merchant_id in merchant_ids:
        row = conn.execute("SELECT * FROM merchants WHERE id=?", (merchant_id,)).fetchone()
        if row is None:
            snapshots.append({"id": merchant_id, "missing": True})
            continue
        item: dict[str, object] = dict(row)
        item["dependent_counts"] = {
            table: int(
                conn.execute(
                    f'SELECT COUNT(*) FROM "{table}" WHERE merchant_id=?', (merchant_id,)
                ).fetchone()[0]
            )
            for table in dependent_tables
        }
        item["distinct_sources"] = int(
            conn.execute(
                "SELECT COUNT(DISTINCT source_id) FROM evidence WHERE merchant_id=?",
                (merchant_id,),
            ).fetchone()[0]
        )
        item["links"] = [
            dict(link)
            for link in conn.execute(
                "SELECT * FROM merchant_links WHERE left_merchant_id=? OR right_merchant_id=? "
                "ORDER BY relation,left_merchant_id,right_merchant_id",
                (merchant_id, merchant_id),
            )
        ]
        snapshots.append(item)
    return snapshots


def _preflight(
    conn: sqlite3.Connection,
    manifest: Sequence[MergeGroup],
    expected_names: Mapping[str, str],
    delta_rename: tuple[str, str] | None,
) -> None:
    ids = _all_ids(manifest)
    if len(ids) != len(set(ids)):
        raise ValueError("a merchant ID appears in more than one merge group")
    expected_ids = set(ids)
    if delta_rename is not None:
        if delta_rename[0] in expected_ids:
            raise ValueError("the separate Delta rename cannot also be a merge member")
        expected_ids.add(delta_rename[0])
    rows = {
        row["id"]: row
        for row in conn.execute(
            f"SELECT id,canonical_name FROM merchants WHERE id IN ({','.join('?' for _ in expected_ids)})",
            tuple(sorted(expected_ids)),
        )
    }
    missing = sorted(expected_ids - rows.keys())
    if missing:
        raise ValueError(f"manifest merchant IDs are missing: {', '.join(missing)}")
    mismatched = [
        f"{merchant_id}: expected {expected_names[merchant_id]!r}, found {rows[merchant_id]['canonical_name']!r}"
        for merchant_id in sorted(expected_ids)
        if merchant_id in expected_names
        and rows[merchant_id]["canonical_name"] != expected_names[merchant_id]
    ]
    if mismatched:
        raise ValueError("manifest canonical names changed: " + "; ".join(mismatched))


def _insert_alias(conn: sqlite3.Connection, merchant_id: str, alias: str) -> None:
    normalized = canonicalize_name(alias)
    if normalized:
        conn.execute(
            "INSERT OR IGNORE INTO merchant_aliases(merchant_id,alias,normalized_alias) VALUES (?,?,?)",
            (merchant_id, alias.strip(), normalized),
        )


def _merge_aliases_and_identifiers(
    conn: sqlite3.Connection, target_id: str, retired: sqlite3.Row
) -> None:
    source_id = retired["id"]
    for alias in conn.execute(
        "SELECT alias FROM merchant_aliases WHERE merchant_id=? ORDER BY id", (source_id,)
    ):
        _insert_alias(conn, target_id, alias["alias"])
    _insert_alias(conn, target_id, retired["canonical_name"])
    location = ", ".join(
        value for value in (retired["city"], retired["governorate"]) if value
    )
    if location:
        _insert_alias(conn, target_id, f"{retired['canonical_name']} — {location}")
    address_count = int(
        conn.execute(
            "SELECT COUNT(*) FROM merchant_identifiers WHERE merchant_id=? AND kind='address'",
            (source_id,),
        ).fetchone()[0]
    )
    for identifier in conn.execute(
        "SELECT kind,value,normalized_value,confidence FROM merchant_identifiers "
        "WHERE merchant_id=? ORDER BY id",
        (source_id,),
    ):
        conn.execute(
            """INSERT INTO merchant_identifiers
                   (merchant_id,kind,value,normalized_value,confidence)
               VALUES (?,?,?,?,?)
               ON CONFLICT(merchant_id,kind,normalized_value) DO UPDATE SET
                 value=CASE WHEN excluded.confidence > merchant_identifiers.confidence
                            THEN excluded.value ELSE merchant_identifiers.value END,
                 confidence=MAX(merchant_identifiers.confidence,excluded.confidence)""",
            (
                target_id,
                identifier["kind"],
                identifier["value"],
                identifier["normalized_value"],
                identifier["confidence"],
            ),
        )
    if address_count == 0 and location:
        conn.execute(
            """INSERT OR IGNORE INTO merchant_identifiers
                   (merchant_id,kind,value,normalized_value,confidence)
               VALUES (?,'address',?,?,0.2)""",
            (target_id, location, _plain(location)),
        )
    conn.execute("DELETE FROM merchant_aliases WHERE merchant_id=?", (source_id,))
    conn.execute("DELETE FROM merchant_identifiers WHERE merchant_id=?", (source_id,))


def _rewrite_links(conn: sqlite3.Connection, replacements: Mapping[str, str]) -> None:
    rows = [dict(row) for row in conn.execute("SELECT * FROM merchant_links")]
    conn.execute("DELETE FROM merchant_links")
    winners: dict[tuple[str, str, str], dict[str, object]] = {}
    for row in rows:
        left = replacements.get(str(row["left_merchant_id"]), str(row["left_merchant_id"]))
        right = replacements.get(str(row["right_merchant_id"]), str(row["right_merchant_id"]))
        if left == right:
            continue
        left, right = sorted((left, right))
        row["left_merchant_id"] = left
        row["right_merchant_id"] = right
        key = (left, right, str(row["relation"]))
        current = winners.get(key)
        candidate_key = (
            float(row["confidence"]),
            len(str(row["rationale"])),
            str(row["created_at"]),
            str(row["id"]),
        )
        current_key = (
            float(current["confidence"]),
            len(str(current["rationale"])),
            str(current["created_at"]),
            str(current["id"]),
        ) if current else None
        if current_key is None or candidate_key > current_key:
            winners[key] = row
    conn.executemany(
        """INSERT INTO merchant_links
               (id,left_merchant_id,right_merchant_id,relation,confidence,rationale,created_at)
           VALUES (?,?,?,?,?,?,?)""",
        [
            (
                row["id"],
                row["left_merchant_id"],
                row["right_merchant_id"],
                row["relation"],
                row["confidence"],
                row["rationale"],
                row["created_at"],
            )
            for row in winners.values()
        ],
    )


class _DisjointSet:
    def __init__(self, ids: Iterable[str]) -> None:
        self.parent = {item: item for item in ids}

    def find(self, item: str) -> str:
        while self.parent[item] != item:
            self.parent[item] = self.parent[self.parent[item]]
            item = self.parent[item]
        return item

    def union(self, left: str, right: str) -> None:
        a, b = self.find(left), self.find(right)
        if a != b:
            self.parent[max(a, b)] = min(a, b)


def _rebuild_derived_claims(
    conn: sqlite3.Connection, now: str, affected_merchant_ids: Iterable[str]
) -> None:
    """Rebuild the derived claim layer for the affected sellers only.

    The reviewed manifest scopes every derived-data change; evidence of
    unrelated sellers must keep its pre-merge fingerprints, duplicate roots,
    independence, and claim counters untouched.
    """
    affected = tuple(sorted(set(affected_merchant_ids)))
    placeholders = ",".join("?" for _ in affected)
    rows = [
        dict(row)
        for row in conn.execute(
            f"""SELECT e.*,s.canonical_url,m.canonical_name
               FROM evidence e
               JOIN sources s ON s.id=e.source_id
               JOIN merchants m ON m.id=e.merchant_id
               WHERE e.merchant_id IN ({placeholders})
               ORDER BY e.merchant_id,e.id""",
            affected,
        )
    ]
    old_claim_by_evidence = {str(row["id"]): row["claim_id"] for row in rows}
    for row in rows:
        exact = evidence_fingerprint(
            str(row["canonical_name"]),
            str(row["claim_type"]),
            str(row["summary"]),
            str(row["canonical_url"]),
        )
        content = claim_fingerprint(
            str(row["canonical_name"]),
            str(row["claim_type"]),
            str(row["summary"]),
            str(row["quoted_excerpt"]),
        )
        row["fingerprint"] = exact
        row["content_fingerprint"] = content
        conn.execute(
            "UPDATE evidence SET fingerprint=?,content_fingerprint=? WHERE id=?",
            (exact, content, row["id"]),
        )

    by_merchant: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        by_merchant[str(row["merchant_id"])].append(row)
    for merchant_rows in by_merchant.values():
        dsu = _DisjointSet(str(row["id"]) for row in merchant_rows)
        exact_seen: dict[str, str] = {}
        content_seen: dict[str, str] = {}
        for row in merchant_rows:
            evidence_id = str(row["id"])
            for value, seen in (
                (str(row["fingerprint"]), exact_seen),
                (str(row["content_fingerprint"]), content_seen),
            ):
                if value in seen:
                    dsu.union(evidence_id, seen[value])
                else:
                    seen[value] = evidence_id
        components: dict[str, list[dict[str, object]]] = defaultdict(list)
        for row in merchant_rows:
            components[dsu.find(str(row["id"]))].append(row)
        for members in components.values():
            root = min(
                members,
                key=lambda row: (
                    0 if int(row["independent"]) == 1 and row["duplicate_of"] is None else 1,
                    str(row["captured_at"]),
                    str(row["id"]),
                ),
            )
            for row in members:
                is_root = row["id"] == root["id"]
                row["independent"] = int(is_root)
                row["duplicate_of"] = None if is_root else root["id"]
                conn.execute(
                    "UPDATE evidence SET independent=?,duplicate_of=? WHERE id=?",
                    (int(is_root), None if is_root else root["id"], row["id"]),
                )

    claim_rows = {str(row["id"]): dict(row) for row in conn.execute("SELECT * FROM claims")}
    conn.execute(
        f"DELETE FROM claim_evidence WHERE claim_id IN "
        f"(SELECT id FROM claims WHERE merchant_id IN ({placeholders}))",
        affected,
    )
    conn.execute(
        f"UPDATE claims SET fingerprint='__seller_merge__' || id "
        f"WHERE merchant_id IN ({placeholders})",
        affected,
    )
    groups: dict[tuple[str, str], list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        groups[(str(row["merchant_id"]), str(row["content_fingerprint"]))].append(row)

    used_claim_ids: set[str] = set()
    chosen_ids: set[str] = set()
    old_to_new: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    assignments: list[tuple[str, str]] = []
    for (merchant_id, fingerprint), members in sorted(groups.items()):
        candidates = sorted(
            {
                str(old_claim_by_evidence[str(row["id"])])
                for row in members
                if old_claim_by_evidence[str(row["id"])] is not None
                and str(old_claim_by_evidence[str(row["id"])]) in claim_rows
                and str(claim_rows[str(old_claim_by_evidence[str(row["id"])])]["merchant_id"])
                == merchant_id
            },
            key=lambda claim_id: (
                str(claim_rows[claim_id]["created_at"]),
                claim_id,
            ),
        )
        claim_id = next((item for item in candidates if item not in used_claim_ids), None)
        if claim_id is None:
            claim_id = str(
                uuid.uuid5(
                    uuid.NAMESPACE_URL,
                    f"merchant-intelligence:claim:{merchant_id}:{fingerprint}",
                )
            )
            suffix = 0
            while claim_id in used_claim_ids or (
                claim_id in claim_rows
                and str(claim_rows[claim_id]["merchant_id"]) != merchant_id
            ):
                suffix += 1
                claim_id = str(
                    uuid.uuid5(
                        uuid.NAMESPACE_URL,
                        f"merchant-intelligence:claim:{merchant_id}:{fingerprint}:{suffix}",
                    )
                )
        used_claim_ids.add(claim_id)
        chosen_ids.add(claim_id)
        representative = min(
            members,
            key=lambda row: (
                0 if int(row["independent"]) else 1,
                0 if int(row["verified"]) else 1,
                -float(row["confidence"]),
                str(row["id"]),
            ),
        )
        created_at = (
            str(claim_rows[claim_id]["created_at"])
            if claim_id in claim_rows
            else now
        )
        values = (
            merchant_id,
            representative["claim_type"],
            representative["sentiment"],
            representative["summary"],
            normalize_claim_text(str(representative["summary"])),
            fingerprint,
            len({int(row["source_id"]) for row in members if int(row["independent"])}),
            len(members),
            created_at,
            now,
            claim_id,
        )
        if claim_id in claim_rows:
            conn.execute(
                """UPDATE claims SET merchant_id=?,claim_type=?,sentiment=?,summary=?,
                       normalized_text=?,fingerprint=?,independent_source_count=?,mention_count=?,
                       created_at=?,updated_at=? WHERE id=?""",
                values,
            )
        else:
            conn.execute(
                """INSERT INTO claims
                       (merchant_id,claim_type,sentiment,summary,normalized_text,fingerprint,
                        independent_source_count,mention_count,created_at,updated_at,id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                values,
            )
        for row in members:
            evidence_id = str(row["id"])
            old_claim = old_claim_by_evidence[evidence_id]
            if old_claim is not None:
                old_to_new[merchant_id][str(old_claim)].add(claim_id)
            assignments.append((claim_id, evidence_id))

    conn.executemany("UPDATE evidence SET claim_id=? WHERE id=?", assignments)
    conn.executemany(
        "INSERT INTO claim_evidence(claim_id,evidence_id) VALUES (?,?)", assignments
    )

    for task in conn.execute(
        "SELECT id,merchant_id,claim_ids_json FROM verification_tasks"
    ).fetchall():
        try:
            old_ids = json.loads(task["claim_ids_json"])
        except (TypeError, json.JSONDecodeError) as exc:
            raise ValueError(f"task {task['id']} has invalid claim_ids_json") from exc
        if not isinstance(old_ids, list):
            raise ValueError(f"task {task['id']} claim_ids_json is not a list")
        mapped: list[str] = []
        for old_id in old_ids:
            replacements = old_to_new[str(task["merchant_id"])].get(str(old_id))
            if replacements:
                mapped.extend(sorted(replacements))
            elif str(old_id) in chosen_ids:
                owner = conn.execute(
                    "SELECT merchant_id FROM claims WHERE id=?", (str(old_id),)
                ).fetchone()
                if owner is not None and owner["merchant_id"] == task["merchant_id"]:
                    mapped.append(str(old_id))
        normalized = list(dict.fromkeys(mapped))
        conn.execute(
            "UPDATE verification_tasks SET claim_ids_json=? WHERE id=?",
            (json.dumps(normalized, ensure_ascii=False), task["id"]),
        )

    # Remove only the affected sellers' stale rebuilt claims; claims of
    # unrelated sellers keep their rows, fingerprints, and counters intact.
    if chosen_ids:
        keep_placeholders = ",".join("?" for _ in chosen_ids)
        conn.execute(
            f"DELETE FROM claims WHERE merchant_id IN ({placeholders}) "
            f"AND id NOT IN ({keep_placeholders})",
            (*affected, *sorted(chosen_ids)),
        )
    else:
        conn.execute(
            f"DELETE FROM claims WHERE merchant_id IN ({placeholders})", affected
        )


def _assert_postconditions(
    conn: sqlite3.Connection,
    retired_ids: Sequence[str],
    before_counts: Mapping[str, int],
) -> None:
    expected_merchants = int(before_counts["merchants"]) - len(retired_ids)
    actual_merchants = int(conn.execute("SELECT COUNT(*) FROM merchants").fetchone()[0])
    if actual_merchants != expected_merchants:
        raise AssertionError(f"merchant count {actual_merchants} != {expected_merchants}")
    if int(conn.execute("SELECT COUNT(*) FROM sources").fetchone()[0]) != int(before_counts["sources"]):
        raise AssertionError("source observations were not conserved")
    if int(conn.execute("SELECT COUNT(*) FROM evidence").fetchone()[0]) != int(before_counts["evidence"]):
        raise AssertionError("evidence observations were not conserved")
    checks = {
        "retired merchants remain": (
            f"SELECT COUNT(*) FROM merchants WHERE id IN ({','.join('?' for _ in retired_ids)})",
            tuple(retired_ids),
        ),
        "evidence lacks a claim": (
            "SELECT COUNT(*) FROM evidence WHERE claim_id IS NULL",
            (),
        ),
        "evidence lacks an exact claim_evidence join": (
            """SELECT COUNT(*) FROM evidence e
               WHERE (SELECT COUNT(*) FROM claim_evidence ce WHERE ce.evidence_id=e.id) <> 1""",
            (),
        ),
        "evidence and claim owners differ": (
            "SELECT COUNT(*) FROM evidence e JOIN claims c ON c.id=e.claim_id WHERE e.merchant_id<>c.merchant_id",
            (),
        ),
        "claim_evidence owners differ": (
            """SELECT COUNT(*) FROM claim_evidence ce
               JOIN claims c ON c.id=ce.claim_id JOIN evidence e ON e.id=ce.evidence_id
               WHERE c.merchant_id<>e.merchant_id""",
            (),
        ),
        "duplicate roots cross sellers": (
            """SELECT COUNT(*) FROM evidence e JOIN evidence root ON root.id=e.duplicate_of
               WHERE e.merchant_id<>root.merchant_id""",
            (),
        ),
        "duplicate chains remain": (
            """SELECT COUNT(*) FROM evidence e JOIN evidence root ON root.id=e.duplicate_of
               WHERE root.duplicate_of IS NOT NULL""",
            (),
        ),
        "self merchant links remain": (
            "SELECT COUNT(*) FROM merchant_links WHERE left_merchant_id=right_merchant_id",
            (),
        ),
        "normalized merchant names repeat": (
            """SELECT COUNT(*) FROM (
                 SELECT normalized_name FROM merchants GROUP BY normalized_name HAVING COUNT(*)>1
               )""",
            (),
        ),
        "sources have no evidence": (
            "SELECT COUNT(*) FROM sources s WHERE NOT EXISTS (SELECT 1 FROM evidence e WHERE e.source_id=s.id)",
            (),
        ),
    }
    for label, (sql, params) in checks.items():
        count = int(conn.execute(sql, params).fetchone()[0])
        if count:
            raise AssertionError(f"{label}: {count}")
    foreign_keys = conn.execute("PRAGMA foreign_key_check").fetchall()
    if foreign_keys:
        raise AssertionError(f"foreign_key_check failed: {len(foreign_keys)} rows")


def merge_sellers(
    db: Database,
    *,
    apply: bool = False,
    manifest: Sequence[MergeGroup] = MERGE_MANIFEST,
    expected_names: Mapping[str, str] = EXPECTED_CURRENT_NAMES,
    delta_rename: tuple[str, str] | None = (MOHANDESSIN_DELTA_ID, MOHANDESSIN_DELTA_NAME),
    report_path: str | Path | None = None,
) -> dict[str, object]:
    """Validate or apply the reviewed merge manifest.

    Dry-run is the default. Apply is one transaction and deliberately fails when
    a retired ID is absent, which makes a second invocation fail closed.
    """
    conn = db._conn
    _preflight(conn, manifest, expected_names, delta_rename)
    changed_ids = _all_ids(manifest) + ([delta_rename[0]] if delta_rename else [])
    before_counts = _counts(conn)
    report: dict[str, object] = {
        "mode": "apply" if apply else "dry-run",
        "created_at": _now(),
        "database": str(db.path),
        "manifest": [
            {
                "target_id": group.target_id,
                "retired_ids": list(group.retired_ids),
                "canonical_name": group.canonical_name,
                "category_override": group.category_override,
            }
            for group in manifest
        ],
        "before_counts": before_counts,
        "before": _merchant_snapshot(conn, changed_ids),
    }
    if apply:
        retired_ids = [item for group in manifest for item in group.retired_ids]
        replacements = {
            retired_id: group.target_id
            for group in manifest
            for retired_id in group.retired_ids
        }
        now = _now()
        with db.transaction() as tx:
            _preflight(tx, manifest, expected_names, delta_rename)
            for group in manifest:
                target = tx.execute(
                    "SELECT * FROM merchants WHERE id=?", (group.target_id,)
                ).fetchone()
                assert target is not None
                members = [target]
                for retired_id in group.retired_ids:
                    retired = tx.execute(
                        "SELECT * FROM merchants WHERE id=?", (retired_id,)
                    ).fetchone()
                    assert retired is not None
                    members.append(retired)
                    _merge_aliases_and_identifiers(tx, group.target_id, retired)
                    for table in (
                        "evidence",
                        "claims",
                        "verification_tasks",
                        "merchant_analyses",
                    ):
                        tx.execute(
                            f'UPDATE "{table}" SET merchant_id=? WHERE merchant_id=?',
                            (group.target_id, retired_id),
                        )
                canonical_name = group.canonical_name or str(target["canonical_name"])
                category = group.category_override or str(target["category"])
                tx.execute(
                    """UPDATE merchants SET canonical_name=?,normalized_name=?,category=?,
                           identity_confidence=?,first_seen_round=?,created_at=?,updated_at=?
                       WHERE id=?""",
                    (
                        canonical_name,
                        canonicalize_name(canonical_name),
                        category,
                        max(float(member["identity_confidence"]) for member in members),
                        min(int(member["first_seen_round"]) for member in members),
                        min(str(member["created_at"]) for member in members),
                        now,
                        group.target_id,
                    ),
                )
                _insert_alias(tx, group.target_id, canonical_name)
            _rewrite_links(tx, replacements)
            tx.executemany(
                "DELETE FROM merchants WHERE id=?", [(merchant_id,) for merchant_id in retired_ids]
            )
            if delta_rename is not None:
                merchant_id, canonical_name = delta_rename
                old_name = tx.execute(
                    "SELECT canonical_name FROM merchants WHERE id=?", (merchant_id,)
                ).fetchone()["canonical_name"]
                _insert_alias(tx, merchant_id, str(old_name))
                _insert_alias(tx, merchant_id, canonical_name)
                tx.execute(
                    "UPDATE merchants SET canonical_name=?,normalized_name=?,updated_at=? WHERE id=?",
                    (canonical_name, canonicalize_name(canonical_name), now, merchant_id),
                )
            affected_ids = {
                group.target_id for group in manifest
            } | set(retired_ids)
            if delta_rename is not None:
                affected_ids.add(delta_rename[0])
            _rebuild_derived_claims(tx, now, affected_ids)
            _assert_postconditions(tx, retired_ids, before_counts)
        report["after_counts"] = _counts(conn)
        report["after"] = _merchant_snapshot(
            conn, [group.target_id for group in manifest] + ([delta_rename[0]] if delta_rename else [])
        )
    if report_path is None:
        report_dir = db.path.parent / "merge-reports"
        report_dir.mkdir(exist_ok=True)
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        report_path = report_dir / f"seller-merge-{report['mode']}-{timestamp}.json"
    path = Path(report_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    report["report_path"] = str(path)
    return report
