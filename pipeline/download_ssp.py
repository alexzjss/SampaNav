"""Baixa as planilhas de dados criminais da SSP-SP para data/raw/.

Uso: python -m pipeline.download_ssp --years 2025 2026
"""

import argparse
import sys

import httpx

from pipeline.config import DATA_RAW, SSP_AUX_URL_TEMPLATES, SSP_URL_TEMPLATE


def download_year(year: int, force: bool = False, kind: str = "SPDadosCriminais", skip_missing: bool = False) -> None:
    template = SSP_URL_TEMPLATE if kind == "SPDadosCriminais" else SSP_AUX_URL_TEMPLATES[kind]
    url = template.format(year=year)
    dest = DATA_RAW / f"{kind}_{year}.xlsx"
    DATA_RAW.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".xlsx.part")

    with httpx.Client(follow_redirects=True, timeout=httpx.Timeout(60, read=600)) as client:
        with client.stream("GET", url) as r:
            if r.status_code == 404 and skip_missing:
                print(f"{year}: {kind} ainda não publicado (HTTP 404), pulando")
                return
            if r.status_code != 200:
                raise SystemExit(f"{year}: HTTP {r.status_code} em {url}")
            total = int(r.headers.get("content-length", 0))
            if not force and dest.exists() and total and dest.stat().st_size == total:
                print(f"{year}: já presente ({total / 1e6:.0f} MB), pulando")
                return
            done = 0
            with open(tmp, "wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
                    done += len(chunk)
                    if total:
                        print(f"\r{year}: {done / 1e6:.0f}/{total / 1e6:.0f} MB", end="", file=sys.stderr)
            print(file=sys.stderr)
            if total and done != total:
                tmp.unlink(missing_ok=True)
                raise SystemExit(f"{year}: download incompleto ({done} de {total} bytes)")
    tmp.replace(dest)
    print(f"{year}: salvo em {dest} ({done / 1e6:.0f} MB)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--years", nargs="+", type=int, default=[2025, 2026])
    ap.add_argument("--force", action="store_true", help="rebaixa mesmo se já existir")
    ap.add_argument("--aux", action="store_true",
                    help="baixa também CelularesSubtraidos e VeiculosSubtraidos")
    ap.add_argument("--skip-missing", action="store_true",
                    help="pula anos ainda não publicados (404) em vez de falhar, p.ex. em janeiro")
    args = ap.parse_args()
    for y in args.years:
        download_year(y, args.force, skip_missing=args.skip_missing)
        if args.aux:
            for kind in SSP_AUX_URL_TEMPLATES:
                download_year(y, args.force, kind, skip_missing=args.skip_missing)


if __name__ == "__main__":
    main()
