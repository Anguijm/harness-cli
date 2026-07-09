#!/usr/bin/env python3
"""Unit tests for the verification-scaling scoring helpers in council.py.

Pure functions only — no Gemini SDK, no network. Loads council.py by path so
it runs anywhere python3 is available (wired into `npm test`). The SDK import
lives inside council.main(), so importing the module here is side-effect-free.
"""
import importlib.util
import math
from pathlib import Path

_COUNCIL = Path(__file__).resolve().parents[1] / ".harness" / "scripts" / "council.py"
_spec = importlib.util.spec_from_file_location("council_under_test", _COUNCIL)
council = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(council)

failures = []


def check(cond, msg):
    if not cond:
        failures.append(msg)


def approx(a, b, tol=1e-9):
    return a is not None and b is not None and abs(a - b) <= tol


# --- expected_score (T1, Eq. 3.1) ------------------------------------------
check(council.expected_score([(8.0, 0.5), (9.0, 0.5)]) == 8.5, "midpoint expectation")
check(approx(council.expected_score([(10.0, 0.9), (1.0, 0.1)]), 9.1), "weighted expectation")
check(council.expected_score([]) is None, "empty distribution -> None")
check(council.expected_score([(5.0, 0.0)]) is None, "zero-mass distribution -> None")
# unnormalized masses are renormalized by Σp
check(approx(council.expected_score([(8.0, 2.0), (10.0, 2.0)]), 9.0), "renormalizes unnormalized mass")

# --- aggregate_scores (T2 distribution) ------------------------------------
agg = council.aggregate_scores([8.0, 9.0, 10.0])
check(agg is not None and agg["mean"] == 9.0, "agg mean")
check(agg["min"] == 8.0 and agg["max"] == 10.0 and agg["n"] == 3, "agg min/max/n")
check(approx(agg["variance"], 2.0 / 3.0), "agg population variance")
check(council.aggregate_scores([]) is None, "agg empty -> None")
check(council.aggregate_scores([None, None]) is None, "agg all-None -> None")
one = council.aggregate_scores([7.0])
check(one is not None and one["variance"] == 0.0 and one["n"] == 1, "agg single value")
mixed = council.aggregate_scores([6.0, None, 8.0])
check(mixed is not None and mixed["mean"] == 7.0 and mixed["n"] == 2, "agg skips None")

# --- worst_case_calls (budget guard) ---------------------------------------
check(council.worst_case_calls(7, 1, 1) == 7 * 2 + 2, "budget: 7 personas, K=1, retries=1")
check(council.worst_case_calls(7, 2, 1) == 7 * 4 + 2, "budget: K=2 multiplies reviewer calls")
check(council.worst_case_calls(1, 1, 0) == 1 + 1, "budget: minimal case")
check(council.worst_case_calls(5, 0, 1) == council.worst_case_calls(5, 1, 1), "budget: K floored at 1")

# --- extract_score unchanged (prose path / fallback) -----------------------
check(council.extract_score("Score: 8/10\nfoo") == 8, "prose score 8/10")
check(council.extract_score("SCORE: 10") == 10, "prose score case-insensitive")
check(council.extract_score("no score here") is None, "prose no score -> None")

# --- score_distribution_from_response is defensive -------------------------
class _Bad:
    pass


check(council.score_distribution_from_response(_Bad(), 10) is None, "bad response shape -> None (fallback)")


class _Cand:
    def __init__(self, token, log_probability=None):
        self.token = token
        self.log_probability = log_probability


class _Pos:
    def __init__(self, candidates):
        self.candidates = candidates


class _LP:
    def __init__(self, chosen, tops):
        self.chosen_candidates = chosen
        self.top_candidates = tops


class _Resp:
    def __init__(self, chosen, tops):
        self.candidates = [type("C", (), {"logprobs_result": _LP(chosen, tops)})()]


# Chosen stream: "Score", ":", " 8"  → score token at index 2. Top candidates
# there: 8 (p≈0.73) and 9 (p≈0.27) → expectation ≈ 8.27.
chosen = [_Cand("Score"), _Cand(":"), _Cand(" 8")]
tops = [
    _Pos([_Cand("Score", math.log(0.9))]),
    _Pos([_Cand(":", math.log(0.9))]),
    _Pos([_Cand("8", math.log(0.73)), _Cand("9", math.log(0.27)), _Cand("z", math.log(0.5))]),
]
dist = council.score_distribution_from_response(_Resp(chosen, tops), 10)
check(dist is not None and len(dist) == 2, "reads two numeric candidates, drops non-digit")
exp = council.expected_score(dist)
check(approx(exp, (8 * 0.73 + 9 * 0.27) / (0.73 + 0.27), 1e-6), "continuous score from logprobs")

# out-of-range digits are dropped (scale_max=10 excludes 99)
tops_oor = [
    _Pos([_Cand("Score", math.log(0.9))]),
    _Pos([_Cand(":", math.log(0.9))]),
    _Pos([_Cand("8", math.log(0.6)), _Cand("99", math.log(0.4))]),
]
dist_oor = council.score_distribution_from_response(_Resp(chosen, tops_oor), 10)
check(dist_oor == [(8.0, math.exp(math.log(0.6)))], "out-of-range score token dropped")

if failures:
    print("FAILED council scoring tests:")
    for f in failures:
        print(f"  - {f}")
    raise SystemExit(1)
print("all council scoring tests passed")
