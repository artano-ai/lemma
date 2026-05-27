"""
Sandbox harness for executing a candidate Python function against a
HumanEval-Sci test case. Invoked by the TypeScript scoreFunctional
runner via subprocess; reads a JSON payload from stdin, runs the
candidate, compares against the test-case's expected pattern, and
exits 0 (pass) or 1 (fail) with a one-line message on stdout.

Payload schema (JSON, via stdin):

    {
      "code": "<candidate source>",
      "function_name": "<symbol to invoke after exec>",
      "test_case": <TestCase from the prompt JSON>
    }

Test-case shapes supported (matching the existing prompt corpus):

  1. {expected: {<name>: <num>, atol: <eps>}}              — scalar within tol
  2. {expected: {<name>: <list>, atol: <eps>}}             — vector within tol (elementwise)
  3. {expected: {<name>_within_eps: [low, high]}}          — scalar in range
  4. {inputs_a, inputs_b, expected: {<...>_over_<...>: [low, high]}}
                                                            — ratio of two calls in range
  5. {expected: {raises: "<ExceptionName>"}}               — call must raise

Security note: candidate code is exec()'d in an isolated namespace,
inside a `python3 -I` interpreter (no PYTHONSTARTUP, no user site,
no env-var pollution). This is NOT a hard sandbox — it stops curious
mistakes but not a determined attacker. Production deployments must
wrap this in Docker / Firejail / Wasm with no network and a strict
resource budget. The TypeScript caller enforces a wall-clock timeout
via SIGKILL.
"""
import json
import sys
import traceback


def is_iterable_numeric(x):
    """True if x is a non-string iterable of numbers (list, tuple, ndarray, ...)."""
    if isinstance(x, (str, bytes)):
        return False
    try:
        iter(x)
        return True
    except TypeError:
        return False


def load_function(code, function_name, label):
    """exec() a candidate's source in an isolated namespace and pull
    out the named function. Returns (fn, error_msg). On error, fn is
    None and error_msg is set."""
    namespace = {}
    try:
        exec(code, namespace)
    except Exception as e:
        return None, f"{label}: raised at import-time: {type(e).__name__}: {e}"
    fn = namespace.get(function_name)
    if fn is None:
        defined = [k for k in namespace.keys() if not k.startswith("_")]
        return None, f"{label}: function '{function_name}' not defined (top-level: {defined})"
    return fn, None


def to_comparable(x):
    """Convert numpy arrays / scalars / lists into a list-of-floats
    or single float, for elementwise tolerance comparison."""
    try:
        # numpy ndarray, pandas Series, etc.
        return [float(v) for v in x]
    except TypeError:
        return float(x)


def values_agree(a, b, rtol, atol):
    """Tolerance-compare candidate vs reference. Handles scalars,
    lists, and numpy outputs. Returns (ok, reason)."""
    try:
        ac = to_comparable(a)
        bc = to_comparable(b)
    except Exception as e:
        return False, f"non-numeric output (candidate={a!r}, reference={b!r}): {e}"

    if isinstance(ac, list) != isinstance(bc, list):
        return False, f"shape mismatch (candidate={'list' if isinstance(ac, list) else 'scalar'}, reference={'list' if isinstance(bc, list) else 'scalar'})"

    if isinstance(ac, list):
        if len(ac) != len(bc):
            return False, f"length mismatch ({len(ac)} vs {len(bc)})"
        for i, (av, bv) in enumerate(zip(ac, bc)):
            tol = atol + rtol * abs(bv)
            if abs(av - bv) > tol:
                return False, f"element {i}: {av} vs {bv} (tol={tol:.3g})"
        return True, ""
    else:
        tol = atol + rtol * abs(bc)
        if abs(ac - bc) > tol:
            return False, f"{ac} vs {bc} (tol={tol:.3g})"
        return True, ""


def main_differential(payload):
    """Differential mode — run candidate AND reference on a battery
    of probe inputs, report per-probe agreement.

    Payload:
      { "mode": "differential",
        "code": "<candidate>",
        "reference_code": "<reference>",
        "function_name": "...",
        "probes": [{"inputs": {...}}, ...],
        "rtol": 1e-3, "atol": 1e-6 }

    Output: a single JSON object on stdout — no PASS/FAIL line."""
    candidate_code = payload["code"]
    reference_code = payload["reference_code"]
    function_name = payload["function_name"]
    probes = payload.get("probes", [])
    rtol = float(payload.get("rtol", 1e-3))
    atol = float(payload.get("atol", 1e-6))

    cand_fn, cand_err = load_function(candidate_code, function_name, "candidate")
    ref_fn, ref_err = load_function(reference_code, function_name, "reference")

    results = []
    fatal = None
    if cand_err:
        fatal = cand_err
    elif ref_err:
        fatal = ref_err

    if fatal is None:
        for probe in probes:
            inputs = probe.get("inputs", {})
            try:
                ref_out = ref_fn(**inputs)
            except Exception as e:
                # Reference itself failed — skip this probe (likely
                # outside the function's valid domain).
                results.append({
                    "inputs": inputs,
                    "passed": None,
                    "reason": f"reference raised {type(e).__name__}, probe skipped",
                })
                continue
            try:
                cand_out = cand_fn(**inputs)
            except Exception as e:
                results.append({
                    "inputs": inputs,
                    "passed": False,
                    "reason": f"candidate raised {type(e).__name__}: {e}",
                })
                continue
            ok, reason = values_agree(cand_out, ref_out, rtol, atol)
            results.append({
                "inputs": inputs,
                "passed": bool(ok),
                "reason": reason if not ok else "",
            })

    print(json.dumps({"type": "differential_report", "fatal": fatal, "results": results}))
    sys.exit(0 if fatal is None else 2)


def main():
    payload = json.load(sys.stdin)

    # Mode discriminator. Default to single-test-case for backwards
    # compatibility with the functional scorer.
    mode = payload.get("mode", "test_case")
    if mode == "differential":
        main_differential(payload)
        return

    code = payload["code"]
    function_name = payload["function_name"]
    test_case = payload["test_case"]
    expected = test_case["expected"]

    # Execute candidate code in an isolated namespace.
    namespace = {}
    try:
        exec(code, namespace)
    except Exception as e:
        print(f"FAIL: candidate code raised at import-time: {type(e).__name__}: {e}")
        sys.exit(1)

    fn = namespace.get(function_name)
    if fn is None:
        defined = [k for k in namespace.keys() if not k.startswith("_")]
        print(
            f"FAIL: function '{function_name}' not defined by candidate "
            f"(top-level names: {defined})"
        )
        sys.exit(1)

    # ── Branch 1: exception assertion ──────────────────────────────
    if "raises" in expected:
        inputs = test_case.get("inputs", {})
        expected_exc = expected["raises"]
        try:
            fn(**inputs)
        except Exception as e:
            actual_exc = type(e).__name__
            if actual_exc == expected_exc:
                print("PASS")
                sys.exit(0)
            # Allow subclass matches too (e.g. candidate raises a
            # specific ValueError subclass when ValueError expected).
            for base in type(e).__mro__:
                if base.__name__ == expected_exc:
                    print("PASS")
                    sys.exit(0)
            print(f"FAIL: expected {expected_exc}, got {actual_exc}: {e}")
            sys.exit(1)
        print(f"FAIL: expected to raise {expected_exc}, returned normally")
        sys.exit(1)

    # ── Branch 2: ratio test (two calls, ratio in range) ───────────
    if "inputs_a" in test_case and "inputs_b" in test_case:
        try:
            a = fn(**test_case["inputs_a"])
            b = fn(**test_case["inputs_b"])
        except Exception as e:
            print(f"FAIL: candidate raised during ratio test: {type(e).__name__}: {e}")
            sys.exit(1)
        ratio_key = next(
            (k for k in expected if "_over_" in k or "_b_over_" in k), None
        )
        if ratio_key is None:
            print(f"FAIL: ratio-test case missing 'X_over_Y' key in expected: {expected}")
            sys.exit(1)
        try:
            ratio = b / a if a != 0 else float("inf")
        except Exception as e:
            print(f"FAIL: ratio division failed: {e}")
            sys.exit(1)
        low, high = expected[ratio_key]
        if low <= ratio <= high:
            print("PASS")
            sys.exit(0)
        print(f"FAIL: ratio {ratio} not in [{low}, {high}] for key '{ratio_key}'")
        sys.exit(1)

    # ── Branch 3: single-call value tests ──────────────────────────
    inputs = test_case.get("inputs", {})
    try:
        result = fn(**inputs)
    except Exception as e:
        print(f"FAIL: candidate raised during call: {type(e).__name__}: {e}")
        sys.exit(1)

    # 3a. range check via `<name>_within_eps`
    eps_key = next((k for k in expected if k.endswith("_within_eps")), None)
    if eps_key is not None:
        low, high = expected[eps_key]
        try:
            if low <= float(result) <= high:
                print("PASS")
                sys.exit(0)
        except (TypeError, ValueError) as e:
            print(f"FAIL: cannot coerce result {result!r} to float: {e}")
            sys.exit(1)
        print(f"FAIL: {result} not in [{low}, {high}] for key '{eps_key}'")
        sys.exit(1)

    # 3b. tolerance comparison via `<name>` + `atol`
    atol = expected.get("atol", 1e-9)
    value_key = next(
        (k for k in expected if k != "atol" and k != "rtol"), None
    )
    if value_key is None:
        print(f"FAIL: no value key found in expected: {expected}")
        sys.exit(1)

    expected_val = expected[value_key]

    if isinstance(expected_val, list):
        if not is_iterable_numeric(result):
            print(f"FAIL: expected list, got non-iterable {result!r}")
            sys.exit(1)
        result_list = list(result)
        if len(result_list) != len(expected_val):
            print(
                f"FAIL: length mismatch — got {len(result_list)} expected "
                f"{len(expected_val)}"
            )
            sys.exit(1)
        for i, (r, e) in enumerate(zip(result_list, expected_val)):
            try:
                if abs(float(r) - float(e)) > atol:
                    print(
                        f"FAIL: element {i}: got {r}, expected {e} "
                        f"(atol={atol})"
                    )
                    sys.exit(1)
            except (TypeError, ValueError) as ex:
                print(f"FAIL: element {i} not numeric: {ex}")
                sys.exit(1)
        print("PASS")
        sys.exit(0)

    # Scalar tolerance comparison.
    try:
        if abs(float(result) - float(expected_val)) <= atol:
            print("PASS")
            sys.exit(0)
    except (TypeError, ValueError) as e:
        print(f"FAIL: cannot coerce to float — result={result!r} expected={expected_val!r}: {e}")
        sys.exit(1)
    print(f"FAIL: {result} ≠ {expected_val} (atol={atol})")
    sys.exit(1)


try:
    main()
except SystemExit:
    raise
except Exception:
    print("FAIL: harness internal error")
    traceback.print_exc(file=sys.stderr)
    sys.exit(2)
