#!/usr/bin/env python3
"""Exora Dock Long/Short Miner economy simulator.

The simulator models a simple protocol fee split, EXORA emissions, and
buyback/burn pressure. It is intentionally conservative: it does not forecast
token price, demand growth, or investment returns.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, getcontext
from typing import Any, Dict


getcontext().prec = 28

BPS = Decimal("10000")
TOTAL_SUPPLY_EXORA = Decimal("1000000000")

PROTOCOL_SPLIT_BPS = {
    "long_miner_rewards_usdc": Decimal("2500"),
    "auditor_pool_usdc": Decimal("1500"),
    "treasury_usdc": Decimal("2500"),
    "insurance_slashing_pool_usdc": Decimal("1500"),
    "exora_buyback_burn_usdc": Decimal("2000"),
}

EMISSION_SPLIT_BPS = {
    "short_miner_emissions_exora": Decimal("6000"),
    "long_miner_emissions_exora": Decimal("3000"),
    "auditor_emissions_exora": Decimal("1000"),
}

SCENARIOS: Dict[str, Dict[str, Decimal]] = {
    "default": {
        "days": Decimal("30"),
        "daily_leases": Decimal("25000"),
        "avg_lease_usdc": Decimal("0.12"),
        "protocol_fee_bps": Decimal("600"),
        "long_miners": Decimal("64"),
        "short_miners": Decimal("5000"),
        "active_short_miner_ratio": Decimal("0.35"),
        "auditor_agents": Decimal("128"),
        "daily_exora_emission": Decimal("240000"),
        "exora_price_usdc": Decimal("0.05"),
        "circulating_supply_exora": Decimal("250000000"),
    },
    "growth": {
        "days": Decimal("30"),
        "daily_leases": Decimal("250000"),
        "avg_lease_usdc": Decimal("0.18"),
        "protocol_fee_bps": Decimal("550"),
        "long_miners": Decimal("512"),
        "short_miners": Decimal("75000"),
        "active_short_miner_ratio": Decimal("0.40"),
        "auditor_agents": Decimal("1024"),
        "daily_exora_emission": Decimal("350000"),
        "exora_price_usdc": Decimal("0.08"),
        "circulating_supply_exora": Decimal("400000000"),
    },
    "stress": {
        "days": Decimal("30"),
        "daily_leases": Decimal("30000"),
        "avg_lease_usdc": Decimal("0.08"),
        "protocol_fee_bps": Decimal("600"),
        "long_miners": Decimal("256"),
        "short_miners": Decimal("50000"),
        "active_short_miner_ratio": Decimal("0.20"),
        "auditor_agents": Decimal("512"),
        "daily_exora_emission": Decimal("300000"),
        "exora_price_usdc": Decimal("0.015"),
        "circulating_supply_exora": Decimal("300000000"),
    },
}


@dataclass(frozen=True)
class SimulationConfig:
    scenario: str
    days: Decimal
    daily_leases: Decimal
    avg_lease_usdc: Decimal
    protocol_fee_bps: Decimal
    long_miners: Decimal
    short_miners: Decimal
    active_short_miner_ratio: Decimal
    auditor_agents: Decimal
    daily_exora_emission: Decimal
    exora_price_usdc: Decimal
    circulating_supply_exora: Decimal


def decimal_arg(value: str) -> Decimal:
    try:
        parsed = Decimal(value)
    except InvalidOperation as exc:
        raise argparse.ArgumentTypeError(f"invalid decimal value: {value}") from exc
    if parsed < 0:
        raise argparse.ArgumentTypeError(f"value must be non-negative: {value}")
    return parsed


def money(value: Decimal) -> str:
    return f"${value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):,}"


def amount(value: Decimal, places: str = "0.01") -> str:
    return f"{value.quantize(Decimal(places), rounding=ROUND_HALF_UP):,}"


def pct(value: Decimal) -> str:
    return f"{(value * Decimal('100')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)}%"


def split_amount(total: Decimal, split_bps: Decimal) -> Decimal:
    return total * split_bps / BPS


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Simulate the Exora Dock Long/Short Miner economy."
    )
    parser.add_argument(
        "--scenario",
        choices=sorted(SCENARIOS.keys()),
        default="default",
        help="Scenario preset to use before applying overrides.",
    )
    parser.add_argument("--days", type=decimal_arg, help="Simulation period in days.")
    parser.add_argument("--daily-leases", type=decimal_arg, help="Leases per day.")
    parser.add_argument(
        "--avg-lease-usdc", type=decimal_arg, help="Average lease price in USDC."
    )
    parser.add_argument(
        "--protocol-fee-bps",
        type=decimal_arg,
        help="Protocol fee in basis points. Example: 600 means 6%%.",
    )
    parser.add_argument(
        "--exora-price-usdc",
        type=decimal_arg,
        help="Assumed EXORA market price in USDC for buyback and emission accounting.",
    )
    parser.add_argument("--json", action="store_true", help="Print JSON output.")

    parser.add_argument("--long-miners", type=decimal_arg, help=argparse.SUPPRESS)
    parser.add_argument("--short-miners", type=decimal_arg, help=argparse.SUPPRESS)
    parser.add_argument(
        "--active-short-miner-ratio", type=decimal_arg, help=argparse.SUPPRESS
    )
    parser.add_argument("--auditor-agents", type=decimal_arg, help=argparse.SUPPRESS)
    parser.add_argument(
        "--daily-exora-emission", type=decimal_arg, help=argparse.SUPPRESS
    )
    parser.add_argument(
        "--circulating-supply-exora", type=decimal_arg, help=argparse.SUPPRESS
    )
    return parser


def config_from_args(args: argparse.Namespace) -> SimulationConfig:
    preset = SCENARIOS[args.scenario]

    def value(name: str) -> Decimal:
        override = getattr(args, name)
        return override if override is not None else preset[name]

    config = SimulationConfig(
        scenario=args.scenario,
        days=value("days"),
        daily_leases=value("daily_leases"),
        avg_lease_usdc=value("avg_lease_usdc"),
        protocol_fee_bps=value("protocol_fee_bps"),
        long_miners=value("long_miners"),
        short_miners=value("short_miners"),
        active_short_miner_ratio=value("active_short_miner_ratio"),
        auditor_agents=value("auditor_agents"),
        daily_exora_emission=value("daily_exora_emission"),
        exora_price_usdc=value("exora_price_usdc"),
        circulating_supply_exora=value("circulating_supply_exora"),
    )
    validate_config(config)
    return config


def validate_config(config: SimulationConfig) -> None:
    if config.days <= 0:
        raise ValueError("days must be greater than zero")
    if config.exora_price_usdc <= 0:
        raise ValueError("exora price must be greater than zero")
    if config.protocol_fee_bps > BPS:
        raise ValueError("protocol fee bps cannot exceed 10000")
    if config.active_short_miner_ratio <= 0 or config.active_short_miner_ratio > 1:
        raise ValueError("active short miner ratio must be in (0, 1]")
    if config.long_miners <= 0:
        raise ValueError("long miners must be greater than zero")
    if config.short_miners <= 0:
        raise ValueError("short miners must be greater than zero")
    if config.auditor_agents <= 0:
        raise ValueError("auditor agents must be greater than zero")


def simulate(config: SimulationConfig) -> Dict[str, Any]:
    total_leases = config.daily_leases * config.days
    gmv = total_leases * config.avg_lease_usdc
    protocol_fee = gmv * config.protocol_fee_bps / BPS
    provider_income = gmv - protocol_fee

    protocol_allocations = {
        name: split_amount(protocol_fee, split_bps)
        for name, split_bps in PROTOCOL_SPLIT_BPS.items()
    }

    total_exora_emission = config.daily_exora_emission * config.days
    emission_allocations = {
        name: split_amount(total_exora_emission, split_bps)
        for name, split_bps in EMISSION_SPLIT_BPS.items()
    }

    buyback_budget = protocol_allocations["exora_buyback_burn_usdc"]
    burned_exora = buyback_budget / config.exora_price_usdc
    net_exora_emission = total_exora_emission - burned_exora
    net_emission_pct_total_supply = net_exora_emission / TOTAL_SUPPLY_EXORA

    active_short_miners = config.short_miners * config.active_short_miner_ratio
    short_miner_emission_value = (
        emission_allocations["short_miner_emissions_exora"] * config.exora_price_usdc
    )
    long_miner_emission_value = (
        emission_allocations["long_miner_emissions_exora"] * config.exora_price_usdc
    )
    auditor_emission_value = (
        emission_allocations["auditor_emissions_exora"] * config.exora_price_usdc
    )

    short_miner_period_revenue = (
        provider_income + short_miner_emission_value
    ) / active_short_miners
    long_miner_period_revenue = (
        protocol_allocations["long_miner_rewards_usdc"] + long_miner_emission_value
    ) / config.long_miners
    auditor_period_revenue = (
        protocol_allocations["auditor_pool_usdc"] + auditor_emission_value
    ) / config.auditor_agents

    result = {
        "scenario": config.scenario,
        "inputs": {
            "days": config.days,
            "daily_leases": config.daily_leases,
            "avg_lease_usdc": config.avg_lease_usdc,
            "protocol_fee_bps": config.protocol_fee_bps,
            "long_miners": config.long_miners,
            "short_miners": config.short_miners,
            "active_short_miner_ratio": config.active_short_miner_ratio,
            "auditor_agents": config.auditor_agents,
            "daily_exora_emission": config.daily_exora_emission,
            "exora_price_usdc": config.exora_price_usdc,
            "circulating_supply_exora": config.circulating_supply_exora,
        },
        "market": {
            "total_leases": total_leases,
            "gmv_usdc": gmv,
            "provider_income_usdc": provider_income,
            "protocol_fee_usdc": protocol_fee,
        },
        "protocol_allocations": protocol_allocations,
        "exora": {
            "total_supply_exora": TOTAL_SUPPLY_EXORA,
            "total_emission_exora": total_exora_emission,
            "emission_allocations": emission_allocations,
            "buyback_burn_budget_usdc": buyback_budget,
            "estimated_burned_exora": burned_exora,
            "net_exora_emission": net_exora_emission,
            "net_emission_pct_total_supply": net_emission_pct_total_supply,
        },
        "miner_estimates": {
            "active_short_miners": active_short_miners,
            "short_miner_period_revenue_usdc": short_miner_period_revenue,
            "short_miner_annualized_run_rate_usdc": short_miner_period_revenue
            / config.days
            * Decimal("365"),
            "long_miner_period_revenue_usdc": long_miner_period_revenue,
            "long_miner_annualized_run_rate_usdc": long_miner_period_revenue
            / config.days
            * Decimal("365"),
            "auditor_period_revenue_usdc": auditor_period_revenue,
            "auditor_annualized_run_rate_usdc": auditor_period_revenue
            / config.days
            * Decimal("365"),
        },
    }
    run_checks(config, result)
    result["checks"] = {
        "fee_conservation": True,
        "protocol_split_conservation": True,
        "emission_split_conservation": True,
        "burn_within_circulating_supply": True,
        "non_negative_outputs": True,
    }
    return result


def run_checks(config: SimulationConfig, result: Dict[str, Any]) -> None:
    market = result["market"]
    allocations = result["protocol_allocations"]
    exora = result["exora"]

    fee_gap = (
        market["provider_income_usdc"]
        + market["protocol_fee_usdc"]
        - market["gmv_usdc"]
    )
    if abs(fee_gap) > Decimal("0.00000001"):
        raise AssertionError("provider income plus protocol fee must equal GMV")

    split_gap = sum(allocations.values()) - market["protocol_fee_usdc"]
    if abs(split_gap) > Decimal("0.00000001"):
        raise AssertionError("protocol allocations must equal protocol fee")

    emission_gap = (
        sum(exora["emission_allocations"].values()) - exora["total_emission_exora"]
    )
    if abs(emission_gap) > Decimal("0.00000001"):
        raise AssertionError("emission allocations must equal total emissions")

    if exora["estimated_burned_exora"] > config.circulating_supply_exora:
        raise AssertionError("estimated burned EXORA cannot exceed circulating supply")

    for section in result.values():
        if isinstance(section, dict):
            for value in section.values():
                if isinstance(value, Decimal) and value < 0:
                    raise AssertionError("simulation output cannot be negative")
                if isinstance(value, dict):
                    for nested_value in value.values():
                        if isinstance(nested_value, Decimal) and nested_value < 0:
                            raise AssertionError(
                                "simulation output cannot be negative"
                            )


def json_ready(value: Any) -> Any:
    if isinstance(value, Decimal):
        if value == value.to_integral_value():
            return int(value)
        return float(value)
    if isinstance(value, dict):
        return {key: json_ready(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_ready(item) for item in value]
    return value


def print_human(result: Dict[str, Any]) -> None:
    inputs = result["inputs"]
    market = result["market"]
    allocations = result["protocol_allocations"]
    exora = result["exora"]
    emissions = exora["emission_allocations"]
    miner = result["miner_estimates"]

    print("Exora Dock Economy Simulation")
    print(f"Scenario: {result['scenario']}")
    print(f"Period: {amount(inputs['days'], '0')} days")
    print()

    print("Market")
    print(f"  Total leases: {amount(market['total_leases'], '0')}")
    print(f"  Gross lease volume: {money(market['gmv_usdc'])}")
    print(f"  Provider income: {money(market['provider_income_usdc'])}")
    print(
        "  Protocol fee "
        f"({amount(inputs['protocol_fee_bps'], '0')} bps): "
        f"{money(market['protocol_fee_usdc'])}"
    )
    print()

    print("Protocol Fee Allocation")
    print(f"  Long Miner rewards: {money(allocations['long_miner_rewards_usdc'])}")
    print(f"  Auditor pool: {money(allocations['auditor_pool_usdc'])}")
    print(f"  DAO Treasury: {money(allocations['treasury_usdc'])}")
    print(
        "  Insurance and slashing pool: "
        f"{money(allocations['insurance_slashing_pool_usdc'])}"
    )
    print(
        "  EXORA buyback and burn budget: "
        f"{money(allocations['exora_buyback_burn_usdc'])}"
    )
    print()

    print("EXORA")
    print(f"  Assumed EXORA price: {money(inputs['exora_price_usdc'])}")
    print(f"  Total miner emissions: {amount(exora['total_emission_exora'], '0')} EXORA")
    print(
        "  Short Miner emissions: "
        f"{amount(emissions['short_miner_emissions_exora'], '0')} EXORA"
    )
    print(
        "  Long Miner emissions: "
        f"{amount(emissions['long_miner_emissions_exora'], '0')} EXORA"
    )
    print(
        "  Auditor emissions: "
        f"{amount(emissions['auditor_emissions_exora'], '0')} EXORA"
    )
    print(f"  Estimated burned EXORA: {amount(exora['estimated_burned_exora'], '0')}")
    print(f"  Net EXORA emission: {amount(exora['net_exora_emission'], '0')}")
    print(
        "  Net emission as total supply: "
        f"{pct(exora['net_emission_pct_total_supply'])}"
    )
    print()

    print("Miner Estimates")
    print(
        "  Active Short Miners: "
        f"{amount(miner['active_short_miners'], '0')} of "
        f"{amount(inputs['short_miners'], '0')}"
    )
    print(f"  Long Miners: {amount(inputs['long_miners'], '0')}")
    print(f"  Auditor Agents: {amount(inputs['auditor_agents'], '0')}")
    print(
        "  Short Miner period revenue: "
        f"{money(miner['short_miner_period_revenue_usdc'])}"
    )
    print(
        "  Short Miner annualized run rate: "
        f"{money(miner['short_miner_annualized_run_rate_usdc'])}"
    )
    print(
        "  Long Miner period revenue: "
        f"{money(miner['long_miner_period_revenue_usdc'])}"
    )
    print(
        "  Long Miner annualized run rate: "
        f"{money(miner['long_miner_annualized_run_rate_usdc'])}"
    )
    print(f"  Auditor period revenue: {money(miner['auditor_period_revenue_usdc'])}")
    print(
        "  Auditor annualized run rate: "
        f"{money(miner['auditor_annualized_run_rate_usdc'])}"
    )
    print()

    print("Checks")
    for name, passed in result["checks"].items():
        print(f"  {name}: {'pass' if passed else 'fail'}")


def main() -> None:
    args = build_parser().parse_args()
    config = config_from_args(args)
    result = simulate(config)
    if args.json:
        print(json.dumps(json_ready(result), indent=2, sort_keys=True))
    else:
        print_human(result)


if __name__ == "__main__":
    main()

