"""Ablation study: which input groups actually help the fire-risk model?

Same target, threshold, split and XGBoost settings as train.py, fixed seed. Every run:
  train 2002-2020, early-stop on 2021-2022 (validation), score 2023-2025 (test, never used
  for any decision). Groups are SELECTED on the validation years only, then the final
  combination is confirmed on the test years, so the test numbers stay honest.

Runs:
  base                 the Day One model (history + analog + weather + season/location)
  base - weather       how much does weather really add?
  base - weather - analog
  base + <group>       for each new group: weather_plus, fuel_history, forest, landcover,
                       vegetation, nowcast (nowcast is reported but never selected: it needs
                       last month's fire, which our history does not have after Dec 2025)
  base + all new (except nowcast)
  final                base + groups that improved validation (written to feature_choice.json)

Outputs: data/agg/experiments.json, docs/EXPERIMENTS.md (tables), docs/img/*.png (charts)
Usage: PYTHONIOENCODING=utf-8 python pipeline/experiments.py [--quick]
"""
import json
import sys
import time
from pathlib import Path

import numpy as np
import xgboost as xgb
from sklearn.metrics import average_precision_score, roc_auc_score

sys.path.insert(0, str(Path(__file__).resolve().parent))
import train as T  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
AGG = ROOT / "data" / "agg"
DOCS = ROOT / "docs"
QUICK = "--quick" in sys.argv
NEW = ["weather_plus", "fuel_history", "forest", "landcover", "vegetation", "wind", "wind_x_forest"]
MIN_GAIN = 0.002   # validation unusual-AP gain needed to keep a group


def scores(y, p, base):
    un = base < 0.3
    out = {"auc": roc_auc_score(y, p), "ap": average_precision_score(y, p)}
    if y[un].sum() > 0:
        out.update({"unusual_auc": roc_auc_score(y[un], p[un]), "unusual_ap": average_precision_score(y[un], p[un])})
    return {k: round(float(v), 4) for k, v in out.items()}


def main():
    t0 = time.time()
    h1, country, w = T.load()
    wmax = int(w.ym.max())
    fc_months = [T.ym_of(T.t_of(wmax)), T.ym_of(T.t_of(wmax) + 1)]
    cells, H, W, data_end = T.build_arrays(h1, w, fc_months)
    E = T.ext_arrays(cells, H.shape[1], T.load_ext())
    X, names, meta, extra = T.features(cells, H, W, data_end, E)
    y, t = meta["y"], meta["t"]
    year = T.Y0 + t // 12
    has = np.isfinite(y) & np.isfinite(X[:, names.index("fwi")]) & (year >= 2002)
    tr, va, te = has & (year <= 2020), has & (year >= 2021) & (year <= 2022), has & (year >= 2023)
    avail = {g: [f for f in fs if f in names] for g, fs in T.FSETS.items()}
    missing = [g for g in NEW if not avail[g]]
    print(f"features built in {time.time() - t0:.0f}s: {len(names)} | train {tr.sum():,} val {va.sum():,} test {te.sum():,}"
          f" | unavailable groups: {missing}", flush=True)

    clim = X[:, names.index("clim_rate")]
    # land-type of each sample, for per-type results (dominant ESA WorldCover class, else Hansen canopy)
    ltype = np.full(len(y), "unknown", object)
    if avail["landcover"]:
        lc = np.stack([X[:, names.index(c)] for c in T.LC_COLS], axis=1)
        dom = np.nanargmax(np.nan_to_num(lc, nan=-1), axis=1)
        lab = np.array(["forest", "shrubland", "grassland", "cropland", "built-up", "bare"], object)
        ltype = np.where(np.isfinite(lc).all(1), lab[dom], "unknown")

    params = dict(T.PARAMS_XGB)
    if QUICK:
        params["learning_rate"] = 0.15

    def run(label, sets):
        cols = [names.index(f) for s in sets for f in avail[s]]
        fn = [names[c] for c in cols]
        t1 = time.time()
        dtr = xgb.DMatrix(X[tr][:, cols], label=y[tr], feature_names=fn)
        dva = xgb.DMatrix(X[va][:, cols], label=y[va], feature_names=fn)
        bst = xgb.train(params, dtr, 3000, evals=[(dva, "val")], early_stopping_rounds=100, verbose_eval=False)
        best = bst.best_iteration + 1
        dte = xgb.DMatrix(X[te][:, cols], feature_names=fn)
        pva = bst.predict(dva, iteration_range=(0, best))
        pte = bst.predict(dte, iteration_range=(0, best))
        r = {"label": label, "sets": sets, "n_features": len(cols), "trees": best,
             "val": scores(y[va], pva, clim[va]), "test": scores(y[te], pte, clim[te])}
        # gain share and SHAP share by group (test sample)
        gain = bst.get_score(importance_type="total_gain")
        tot = sum(gain.values()) or 1
        r["gain_share"] = {s: round(100 * sum(gain.get(f, 0) for f in avail[s]) / tot, 1) for s in sets}
        rng = np.random.default_rng(0)
        idx = rng.choice(te.sum(), size=min(60000, int(te.sum())), replace=False)
        sh = bst.predict(xgb.DMatrix(X[te][idx][:, cols], feature_names=fn), pred_contribs=True,
                         iteration_range=(0, best))[:, :-1]
        a = np.abs(sh).mean(0)
        r["shap_share"] = {s: round(100 * float(sum(a[fn.index(f)] for f in avail[s])) / float(a.sum()), 1) for s in sets}
        # per land type (test)
        r["by_land"] = {}
        for lt in sorted(set(ltype[te])):
            m = ltype[te] == lt
            if m.sum() > 2000 and 0 < y[te][m].sum() < m.sum():
                r["by_land"][lt] = {"n": int(m.sum()), **scores(y[te][m], pte[m], clim[te][m])}
        print(f"{label:34s} feats {len(cols):3d} trees {best:4d} | val uAP {r['val'].get('unusual_ap')} "
              f"| test AUC {r['test']['auc']} AP {r['test']['ap']} uAUC {r['test'].get('unusual_auc')} "
              f"uAP {r['test'].get('unusual_ap')} | {time.time() - t1:.0f}s", flush=True)
        return r

    base = list(T.BASE_SETS)
    runs = [run("base (Day One model)", base),
            run("base − weather", [s for s in base if s != "weather"]),
            run("base − weather − analog", [s for s in base if s not in ("weather", "analog")])]
    for g in NEW + ["nowcast"]:
        if avail[g]:
            runs.append(run(f"base + {g}", base + [g]))
    allnew = [g for g in NEW if avail[g]]
    if allnew:
        runs.append(run("base + all new", base + allnew))
    b = runs[0]["val"]["unusual_ap"]
    keep = [g for g in allnew
            if next(r for r in runs if r["label"] == f"base + {g}")["val"]["unusual_ap"] - b >= MIN_GAIN]
    final_sets = base + keep
    final = run("final (selected on validation)", final_sets) if keep else dict(runs[0], label="final (= base)")
    if keep:
        runs.append(final)
    clim_te = {"test": scores(y[te], clim[te], clim[te])}
    res = {"created": time.strftime("%Y-%m-%d %H:%M"), "quick": QUICK, "selection_rule":
           f"keep a group if validation (2021-2022) unusual-fire AP improves by >= {MIN_GAIN} over base",
           "baseline_same_as_usual": clim_te, "unavailable_groups": missing, "groups": avail,
           "runs": runs, "selected_new_groups": keep, "final_sets": final_sets}
    (AGG / "experiments.json").write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
    if not QUICK:
        (AGG / "feature_choice.json").write_text(json.dumps({"sets": final_sets, "from": "experiments.py",
                                                             "created": res["created"]}, indent=1))
    write_report(res)
    print(f"done in {(time.time() - t0) / 60:.0f} min; selected: {keep}", flush=True)


def write_report(res):
    DOCS.mkdir(exist_ok=True)
    (DOCS / "img").mkdir(exist_ok=True)
    L = ["# Experiments: what helps the fire-risk model?", "",
         f"Generated by `pipeline/experiments.py` on {res['created']}{' (QUICK mode, not final)' if res['quick'] else ''}. "
         "Raw numbers: `data/agg/experiments.json`.", "",
         "**Protocol.** Same target (≥30 VIIRS-equivalent detections in a 1° cell-month), same XGBoost settings, seed 42. "
         "Train 2002–2020, early-stop on 2021–2022 (*validation*), score 2023–2025 (*test*, never used for any decision). "
         f"Selection rule: {res['selection_rule']}. "
         "*Unusual* = cell-months that burned in fewer than 30% of earlier years.", "",
         "| Run | Features | Test ROC-AUC | Test AP | Test unusual ROC-AUC | **Test unusual AP** | Validation unusual AP |",
         "|---|---|---|---|---|---|---|"]
    for r in res["runs"]:
        L.append(f"| {r['label']} | {r['n_features']} | {r['test']['auc']:.4f} | {r['test']['ap']:.4f} | "
                 f"{r['test'].get('unusual_auc', float('nan')):.4f} | **{r['test'].get('unusual_ap', float('nan')):.4f}** | "
                 f"{r['val'].get('unusual_ap', float('nan')):.4f} |")
    c = res["baseline_same_as_usual"]["test"]
    L.append(f"| *“same as usual” (no model)* | 1 | {c['auc']:.4f} | {c['ap']:.4f} | {c.get('unusual_auc', 0):.4f} | "
             f"{c.get('unusual_ap', 0):.4f} | – |")
    L += ["", f"**Selected new groups:** {', '.join(res['selected_new_groups']) or 'none'}. "
          f"**Final feature sets:** {', '.join(res['final_sets'])}.", ""]
    if res["unavailable_groups"]:
        L += [f"Not available when this ran: {', '.join(res['unavailable_groups'])}.", ""]
    fin = res["runs"][-1]
    L += ["## Where the final model gets its signal", "", "| Group | Gain share | SHAP share (test) |", "|---|---|---|"]
    for s in fin["sets"]:
        L.append(f"| {s} | {fin['gain_share'][s]}% | {fin['shap_share'][s]}% |")
    L += ["", "## Results by land type (test, final model)", "", "| Land type | Cell-months | ROC-AUC | AP | Unusual AP |", "|---|---|---|---|---|"]
    for lt, v in fin["by_land"].items():
        L.append(f"| {lt} | {v['n']:,} | {v['auc']:.4f} | {v['ap']:.4f} | {v.get('unusual_ap', float('nan')):.4f} |")
    L += ["", "## Notes", "",
          "- **nowcast** (fire in the previous month, in the cell and its neighbours) is reported for interest but never "
          "selected: our fire history ends with the FIRMS archives in December 2025, so it isn't known when forecasting 2026.",
          "- **landcover** uses the 2021 ESA WorldCover map for all years. Where fire turned forest into grass or crops before "
          "2021, the map carries a trace of the past fires, so its training years see slightly \"future\" land cover. "
          "Hansen tree cover (year 2000) does not have this issue.",
          "- Hansen forest loss ends in 2024; for 2025–2026 the most recent available year is used.",
          "- Extra weather is limited to what the cached NASA POWER monthly data allows (VPD, 6-month rain, 3-month soil). "
          "Maximum wind and dry-day counts would need a full re-download (hours, rate-limited) and were not added.", ""]
    (DOCS / "EXPERIMENTS.md").write_text("\n".join(L), encoding="utf-8")
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        runs = res["runs"]
        lab = [r["label"] for r in runs]
        v = [r["test"].get("unusual_ap", 0) for r in runs]
        fig, ax = plt.subplots(figsize=(9, 0.45 * len(runs) + 1.2), facecolor="#0b0d12")
        ax.set_facecolor("#0b0d12")
        col = ["#f08a24" if r["label"].startswith("final") else ("#8b8a83" if "−" in r["label"] else "#d95926") for r in runs]
        ax.barh(lab[::-1], v[::-1], color=col[::-1])
        ax.axvline(c.get("unusual_ap", 0), color="#c3c2b7", ls="--", lw=1)
        ax.text(c.get("unusual_ap", 0), len(runs) - 0.4, " same as usual", color="#c3c2b7", fontsize=8)
        for i, x in enumerate(v[::-1]):
            ax.text(x, i, f" {x:.3f}", va="center", color="#f0efec", fontsize=8)
        ax.set_xlabel("Test 2023–2025 · average precision on unusual fires", color="#c3c2b7")
        ax.tick_params(colors="#c3c2b7", labelsize=8)
        for sp in ax.spines.values():
            sp.set_color("#333")
        plt.tight_layout()
        plt.savefig(DOCS / "img" / "ablation_unusual_ap.png", dpi=160)
        plt.close()
    except Exception as e:  # noqa: BLE001
        print("chart failed:", e)


if __name__ == "__main__":
    main()
