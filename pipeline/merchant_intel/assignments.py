"""Partition discovery workers across categories and source strategies."""

from __future__ import annotations

from dataclasses import dataclass

from merchant_intel.config import AppConfig


@dataclass(frozen=True)
class DiscoveryAssignment:
    agent_id: str
    group: str
    title: str
    focus: str
    search_seeds: tuple[str, ...]
    source_bias: str
    city_bias: str = ""


_CITIES = (
    "Cairo",
    "Giza",
    "Alexandria",
    "Mansoura",
    "Tanta",
    "Assiut",
    "Port Said",
    "online/nationwide",
)


def default_assignments(cfg: AppConfig, count: int | None = None) -> list[DiscoveryAssignment]:
    country = cfg.research.country
    n = count or cfg.concurrency.discovery_agents
    specs: list[tuple[str, str, str, tuple[str, ...], str, str]] = [
        ("A", "electronics", "Cairo electronics retailers", ("الكترونيات القاهرة", "electronics store Cairo Egypt"), "maps+web", "Cairo"),
        ("A", "electronics", "Giza electronics retailers", ("الكترونيات الجيزة", "electronics Giza"), "facebook+maps", "Giza"),
        ("A", "electronics", "Alexandria electronics retailers", ("الكترونيات اسكندرية", "electronics Alexandria Egypt"), "maps+web", "Alexandria"),
        ("A", "electronics", "Delta electronics retailers", ("الكترونيات المنصورة", "electronics Mansoura Tanta"), "web+forums", "Mansoura"),
        ("A", "electronics", "Upper Egypt electronics", ("الكترونيات اسيوط", "electronics Assiut"), "maps+web", "Assiut"),
        ("B", "gaming", "Cairo console/gaming stores", ("بلايستيشن القاهرة", "PS5 store Cairo"), "facebook+reddit", "Cairo"),
        ("B", "gaming", "Alexandria gaming stores", ("بلايستيشن اسكندرية", "gaming store Alexandria"), "facebook+maps", "Alexandria"),
        ("B", "gaming", "used console sellers", ("بلايستيشن مستعمل مصر", "used PS5 Egypt"), "marketplace+facebook", ""),
        ("B", "gaming", "gaming accessories", ("إكسسوارات قيمنج مصر", "gaming accessories Egypt"), "web+marketplace", ""),
        ("B", "gaming", "positive gaming recommendations", ("أفضل محل بلايستيشن مصر", "recommended PS5 store Egypt"), "reddit+forums", ""),
        ("C", "pc_hardware", "Cairo PC component shops", ("قطع كمبيوتر القاهرة", "GPU shop Cairo"), "facebook+web", "Cairo"),
        ("C", "pc_hardware", "Giza PC builders", ("تجميعة كمبيوتر الجيزة", "PC builder Giza"), "facebook+maps", "Giza"),
        ("C", "pc_hardware", "GPU/CPU specialists", ("كارت شاشة مصر", "RTX store Egypt"), "web+marketplace", ""),
        ("C", "pc_hardware", "used hardware merchants", ("لابتوب مستعمل مصر", "used GPU Egypt"), "marketplace+facebook", ""),
        ("C", "pc_hardware", "PC repair businesses", ("صيانه كمبيوتر مصر", "laptop repair Cairo"), "maps+web", "Cairo"),
        ("D", "mobile_laptop", "Cairo mobile sellers", ("موبايلات القاهرة", "iPhone store Cairo"), "facebook+maps", "Cairo"),
        ("D", "mobile_laptop", "Alexandria laptop sellers", ("لابتوب اسكندرية", "laptop store Alexandria"), "maps+web", "Alexandria"),
        ("D", "mobile_laptop", "authorized vs grey-market phones", ("وكيل ايفون مصر", "grey market iPhone Egypt"), "news+forums", ""),
        ("D", "mobile_laptop", "Port Said / Canal cities", ("موبايلات بورسعيد", "electronics Port Said"), "maps+web", "Port Said"),
        ("E", "complaints", "Facebook complaint communities", ("نصب الكترونيات فيسبوك", "electronics complaint Egypt Facebook"), "facebook", ""),
        ("E", "complaints", "Reddit / forums complaints", ("scam electronics egypt reddit", "r/Egypt electronics store"), "reddit+forums", ""),
        ("E", "complaints", "delivery / COD disputes", ("الدفع عند الاستلام نصب", "COD non delivery Egypt electronics"), "facebook+forums", ""),
        ("E", "complaints", "warranty / refund disputes", ("ضمان لابتوب مصر", "refund electronics Egypt"), "web+facebook", ""),
        ("F", "positive", "repeat-customer recommendations", ("محل الكترونيات مضمون", "trusted PC store Egypt"), "reddit+facebook", ""),
        ("F", "positive", "resolved-complaint stories", ("المحل حل المشكلة", "electronics refund Egypt success"), "facebook+forums", ""),
        ("F", "positive", "physical-store verification", ("عنوان محل بلايستيشن", "electronics store Google Maps Egypt"), "maps", ""),
        ("G", "official", "company registry / official pages", ("سجل تجاري الكترونيات", "Egyptian commercial register electronics"), "registry+web", ""),
        ("G", "official", "news / regulatory mentions", ("جهاز حماية المستهلك الكترونيات", "consumer protection Egypt electronics"), "news+gov", ""),
        ("H", "identity", "cross-platform identity matching", ("نفس رقم الواتساب فيسبوك", "same phone Facebook Instagram store Egypt"), "social+web", ""),
        ("H", "identity", "page-history / alias matching", ("صفحة محل اتغير اسمها", "Facebook page renamed electronics Egypt"), "facebook+web", ""),
    ]
    n = max(1, min(n, len(specs)))
    if n < len(specs):
        buckets: dict[str, list[tuple[str, str, str, tuple[str, ...], str, str]]] = {}
        for spec in specs:
            buckets.setdefault(spec[0], []).append(spec)
        groups = list(buckets)
        if n < len(groups):
            selected_specs = [buckets[group][0] for group in groups[:n]]
        else:
            quotas = {group: 1 for group in groups}
            remaining = n - len(groups)
            cursor = 0
            while remaining > 0:
                group = groups[cursor % len(groups)]
                if quotas[group] < len(buckets[group]):
                    quotas[group] += 1
                    remaining -= 1
                cursor += 1
            selected_specs = [
                spec
                for group in groups
                for spec in buckets[group][: quotas[group]]
            ]
    else:
        selected_specs = specs
    out: list[DiscoveryAssignment] = []
    for i, spec in enumerate(selected_specs, start=1):
        group, category, title, seeds, bias, city = spec
        country_seeds = tuple(f"{s} {country}" if country.lower() not in s.lower() else s for s in seeds)
        out.append(
            DiscoveryAssignment(
                agent_id=f"discovery-{i:02d}",
                group=group,
                title=title,
                focus=category,
                search_seeds=country_seeds,
                source_bias=bias,
                city_bias=city,
            )
        )
    return out


def gap_assignments(
    cfg: AppConfig,
    searches: list[str],
    count: int,
) -> list[DiscoveryAssignment]:
    if not searches:
        return default_assignments(cfg, count)
    out: list[DiscoveryAssignment] = []
    cities = list(_CITIES)
    for i in range(count):
        seed = searches[i % len(searches)]
        city = cities[i % len(cities)]
        out.append(
            DiscoveryAssignment(
                agent_id=f"discovery-gap-{i+1:02d}",
                group="GAP",
                title=f"Gap search: {seed}",
                focus="gap_fill",
                search_seeds=(seed, f"{seed} {city}", f"{seed} {cfg.research.country}"),
                source_bias="independent sources not already in the dataset",
                city_bias=city,
            )
        )
    return out
