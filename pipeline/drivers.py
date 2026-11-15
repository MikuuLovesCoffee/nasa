"""How do wind and forest change fire? Statistics for the report (docs/DRIVERS.md + data/agg/drivers.json).

Two kinds of evidence, kept apart on purpose:
  A-C  ASSOCIATION, same month (explains, does not forecast): in each 1-degree cell, how much more
       often does significant fire (>= THR VIIRS-eq. detections) happen in months with unusually
       strong wind, by how much forest the cell has, and combined with dry air? Anomalies are
       z-scores against the cell's own calendar-month normal, so the fire season itself is removed.
       Lift = fire rate in the bin / fire rate of all months of that land type.
  D    FORECAST MODEL (month m-1 inputs only, honest time split): XGBoost with history + weather +
       strong wind + land cover + forest loss + wind x forest. SHAP shows how much each group pushes
       the predicted risk, and how the wind push differs between open land and forest.

Fire record: unified MODIS+VIIRS (pipeline/harmonize.py). Wind: NASA POWER WS10M / WS10M_MAX
(pipeline/wind.py). Forest: ESA WorldCover 2021 tree share, Hansen Global Forest Change loss.
Usage: PYTHONIOENCODING=utf-8 python pipeline/drivers.py
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

TREE_BINS = [("Open land (<10% trees)", 0, 0.10), ("Mixed (10–40% trees)", 0.10, 0.40), ("Forest (>40% trees)", 0.40, 1.01)]
WIND_BINS = [("much calmer", -9, -1), ("calmer", -1, 0), ("a bit windier", 0, 1), ("windy", 1, 2), ("very windy", 2, 9)]


def wilson(k, n, z=1.96):
    if n == 0:
        return (np.nan, np.nan)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    r = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - r) / d, (c + r) / d)


def rate_table(y, H, mask_groups, bins, x):
    """fire rate, lift and mean detections per (group, bin)."""
    out = []
    for gname, gm in mask_groups:
        base = float(y[gm].mean())
        hbase = float(H[gm].mean())
        for bname, lo, hi in bins:
            m = gm & (x >= lo) & (x < hi)
            n, k = int(m.sum()), int(y[m].sum())
            if n < 200:
                continue
            lo_ci, hi_ci = wilson(k, n)
            out.append({"group": gname, "bin": bname, "n": n, "rate": round(k / n, 4),
                        "ci": [round(lo_ci, 4), round(hi_ci, 4)], "lift": round((k / n) / base, 3),
                        "lift_ci": [round(lo_ci / base, 3), round(hi_ci / base, 3)],
                        "det_ratio": round(float(H[m].mean() / hbase), 3)})
    return out


def main():
    t0 = time.time()
    h1, country, w = T.load()
    if QUICK:  # smoke test on every 7th cell
        h1 = h1[h1.cell1 % 7 == 0]
    wmax = int(w.ym.max())
    fc = [T.ym_of(T.t_of(wmax)), T.ym_of(T.t_of(wmax) + 1)]
    cells, H, W, data_end = T.build_arrays(h1, w, fc)
    E = T.ext_arrays(cells, H.shape[1], T.load_ext())
    assert "wsmax" in E, "run pipeline/wind.py first"
    assert "lc_tree" in E, "run pipeline/landcover.py first"
    X, names, meta, extra = T.features(cells, H, W, data_end, E)
    y_all, t = meta["y"], meta["t"]
    year = T.Y0 + t // 12
    N, Tn = H.shape
    print(f"features {len(names)} built in {time.time() - t0:.0f}s", flush=True)

    # ---------------- A-C: same-month association
    ok = np.isfinite(y_all) & (year >= 2002) & (year <= 2025)
    Zs = extra["Z"]
    wz = extra["wind_z"].reshape(-1)
    rhz = Zs["rh"].reshape(-1)
    pz = Zs["p"].reshape(-1)
    tree = np.repeat(np.nan_to_num(E["lc_tree"]), Tn)
    ok &= np.isfinite(wz) & np.isfinite(rhz)
    y = y_all[ok]
    Hc = np.nan_to_num(H.reshape(-1)[ok])
    wz_, rh_, p_, tr_ = wz[ok], rhz[ok], pz[ok], tree[ok]
    groups = [(g, (tr_ >= lo) & (tr_ < hi)) for g, lo, hi in TREE_BINS]
    res = {"n_cell_months": int(ok.sum()), "n_cells": int(N), "threshold": T.THR, "years": "2002–2025"}
    res["land_types"] = [{"group": g, "cells": int(((np.nan_to_num(E["lc_tree"]) >= lo) & (np.nan_to_num(E["lc_tree"]) < hi)).sum()),
                          "fire_rate": round(float(y[m].mean()), 4)} for (g, lo, hi), (_, m) in zip(TREE_BINS, groups)]
    res["wind_by_land"] = rate_table(y, Hc, groups, WIND_BINS, wz_)
    # wind x dryness (same month), per land type
    dry = rh_ < -0.5
    windy = wz_ > 1
    combo = []
    for g, gm in groups:
        base = float(y[gm].mean())
        for lab, m in [("calm & humid", ~windy & ~dry), ("windy only", windy & ~dry), ("dry only", ~windy & dry), ("windy AND dry", windy & dry)]:
            mm = gm & m
            n, k = int(mm.sum()), int(y[mm].sum())
            combo.append({"group": g, "case": lab, "n": n, "rate": round(k / n, 4) if n else None,
                          "lift": round((k / n) / base, 3) if n else None})
    res["wind_x_dry"] = combo
    # correlation of same-month wind anomaly with log detections, per land type (Spearman-ish via ranks)
    corr = []
    for g, gm in groups:
        a, b = wz_[gm], np.log1p(Hc[gm])
        ra, rb = a.argsort().argsort(), b.argsort().argsort()
        corr.append({"group": g, "spearman": round(float(np.corrcoef(ra, rb)[0, 1]), 3)})
    res["wind_corr"] = corr
    print("A-C done", flush=True)

    # forest loss: chance of significant fire in year Y vs forest lost up to Y-1 (forest/mixed cells)
    if "loss_cum" in names:
        lc = X[:, names.index("loss_cum")]
        lp = X[:, names.index("loss_prev")]
        m0 = np.isfinite(y_all) & (year >= 2003) & (year <= 2025) & (tree >= 0.10)
        yy, lcc, lpp = y_all[m0], lc[m0], lp[m0]
        base = float(yy.mean())
        bins = [("no recent loss", -1, 0.0005), ("small (<1% of cell)", 0.0005, 0.01), ("medium (1–5%)", 0.01, 0.05), ("large (>5%)", 0.05, 9)]
        res["loss_last_year"] = []
        for lab, lo, hi in bins:
            m = (lpp >= lo) & (lpp < hi)
            n, k = int(m.sum()), int(yy[m].sum())
            if n >= 200:
                res["loss_last_year"].append({"bin": lab, "n": n, "rate": round(k / n, 4), "lift": round((k / n) / base, 3),
                                              "ci": [round(v, 4) for v in wilson(k, n)]})
        res["loss_cum"] = []
        for lab, lo, hi in [("<1% lost since 2001", -1, 0.01), ("1–5%", 0.01, 0.05), ("5–15%", 0.05, 0.15), (">15%", 0.15, 9)]:
            m = (lcc >= lo) & (lcc < hi)
            n, k = int(m.sum()), int(yy[m].sum())
            if n >= 200:
                res["loss_cum"].append({"bin": lab, "n": n, "rate": round(k / n, 4), "lift": round((k / n) / base, 3),
                                        "ci": [round(v, 4) for v in wilson(k, n)]})
    print("loss done", flush=True)

    # ---------------- D: forecast model with all drivers, SHAP by group and land type
    has = np.isfinite(y_all) & np.isfinite(X[:, names.index("fwi")]) & (year >= 2002)
    tr, va, te = has & (year <= 2020), has & (year >= 2021) & (year <= 2022), has & (year >= 2023)
    clim = X[:, names.index("clim_rate")]
    sets_base = list(T.BASE_SETS)
    sets_full = sets_base + [s for s in ["landcover", "forest", "wind", "wind_x_forest"] if all(f in names for f in T.FSETS[s])]
    params = dict(T.PARAMS_XGB, learning_rate=0.1)

    def fit(sets):
        cols = [names.index(f) for s in sets for f in T.FSETS[s] if f in names]
        fn = [names[c] for c in cols]
        dtr = xgb.DMatrix(X[tr][:, cols], label=y_all[tr], feature_names=fn)
        dva = xgb.DMatrix(X[va][:, cols], label=y_all[va], feature_names=fn)
        b = xgb.train(params, dtr, 2000, evals=[(dva, "val")], early_stopping_rounds=80, verbose_eval=False)
        p = b.predict(xgb.DMatrix(X[te][:, cols], feature_names=fn), iteration_range=(0, b.best_iteration + 1))
        un = clim[te] < 0.3
        sc = {"auc": roc_auc_score(y_all[te], p), "ap": average_precision_score(y_all[te], p),
              "unusual_auc": roc_auc_score(y_all[te][un], p[un]), "unusual_ap": average_precision_score(y_all[te][un], p[un])}
        return b, cols, fn, {k: round(float(v), 4) for k, v in sc.items()}

    b0, _, _, s0 = fit(sets_base)
    b1, cols, fn, s1 = fit(sets_full)
    res["model"] = {"base_sets": sets_base, "full_sets": sets_full, "base": s0, "full": s1, "test_years": "2023–2025"}
    print("models", s0, s1, flush=True)
    rng = np.random.default_rng(0)
    te_idx = np.flatnonzero(te)
    idx = rng.choice(te_idx, size=min(80000, len(te_idx)), replace=False)
    sh = b1.predict(xgb.DMatrix(X[idx][:, cols], feature_names=fn), pred_contribs=True,
                    iteration_range=(0, b1.best_iteration + 1))[:, :-1]
    grp_of = {f: s for s in sets_full for f in T.FSETS[s]}
    a = np.abs(sh).mean(0)
    share = {}
    for f, v in zip(fn, a):
        share[grp_of[f]] = share.get(grp_of[f], 0) + float(v)
    tot = sum(share.values())
    res["shap_share"] = {k: round(100 * v / tot, 1) for k, v in sorted(share.items(), key=lambda kv: -kv[1])}
    # wind push (sum of SHAP of wind + wind x forest features) by land type and by last month's wind anomaly
    wcols = [i for i, f in enumerate(fn) if grp_of[f] in ("wind", "wind_x_forest")]
    wpush = sh[:, wcols].sum(1)
    tr_s = tree[idx]
    wzl = X[idx, names.index("wmax_z")]
    dep = []
    for g, lo, hi in TREE_BINS:
        gm = (tr_s >= lo) & (tr_s < hi)
        for bname, blo, bhi in WIND_BINS:
            m = gm & (wzl >= blo) & (wzl < bhi)
            if m.sum() >= 100:
                dep.append({"group": g, "bin": bname, "n": int(m.sum()), "mean_push_logodds": round(float(wpush[m].mean()), 4),
                            "odds_x": round(float(np.exp(wpush[m].mean())), 3)})
    res["wind_push"] = dep
    (AGG / ("drivers_quick.json" if QUICK else "drivers.json")).write_text(json.dumps(res, indent=1, ensure_ascii=False, default=float), encoding="utf-8")
    print(json.dumps(res, ensure_ascii=False, default=float)[:3000])
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
