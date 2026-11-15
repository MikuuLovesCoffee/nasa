"""Step 4 - fire-risk model (runs locally; the server only gets the outputs).

Sample = (1-degree cell, target month m). Prediction is issued at the end of m-1,
so every feature uses only information available then:
  * place history  - how often this cell burned in this calendar month in EARLIER years
  * weather        - NASA POWER for month m-1 (heat, rain, humidity, wind, root-zone
                     soil moisture) and anomalies vs the cell's own climatology
  * analog score   - in earlier years whose m-1 weather looked like this year's,
                     how often did month m burn here?  ("place + weather lined up
                     with fire before -> may happen again")
  * forest & land  - forest loss of earlier years (Hansen), tree-cover share and land-cover
                     mix (ESA WorldCover 2021) (pipeline/forest.py, pipeline/landcover.py)
  * vegetation     - MODIS monthly NDVI of month m-1 and its anomaly (pipeline/vegetation.py)
  * extra weather  - vapour-pressure deficit, 6-month rain and 3-month soil memory
  * fuel history   - years since the cell last burned, last year's total fire
Which groups the final model uses is decided by pipeline/experiments.py (ablation on
the 2023+ test years) and stored in data/agg/feature_choice.json.
Target: harmonized activity H >= THR (VIIRS-equivalent detections) in month m.
Split: train <= 2020, early-stop on 2021-2022, report on 2023+ (never seen).
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import average_precision_score, roc_auc_score

ROOT = Path(__file__).resolve().parent.parent
AGG = ROOT / "data" / "agg"
THR = 30
Y0 = 2000
PARAMS = ["T2M_MAX", "PRECTOTCORR", "RH2M", "WS2M", "GWETROOT"]
SHORT = {"T2M_MAX": "t", "PRECTOTCORR": "p", "RH2M": "rh", "WS2M": "ws", "GWETROOT": "gw"}
CLIM_YEARS = (2001, 2020)
SIGMA = 0.75  # analog kernel width (fire-weather index units)


def t_of(ym):
    return (ym // 100 - Y0) * 12 + (ym % 100 - 1)


def ym_of(t):
    return (Y0 + t // 12) * 100 + t % 12 + 1


def load():
    h = pd.read_parquet(AGG / "harmonized_05.parquet")
    h["cell1"] = (h.cell // 720 // 2) * 360 + (h.cell % 720) // 2
    h1 = h.groupby(["cell1", "ym"], as_index=False)["h"].sum()
    country = (h.groupby(["cell1", "country"])["h"].sum().reset_index()
                .sort_values("h").drop_duplicates("cell1", keep="last").set_index("cell1")["country"])
    w = pd.read_parquet(AGG / "weather_monthly.parquet")
    return h1, country, w


def load_ext():
    """Optional inputs; a missing file simply means that group is unavailable."""
    ext = {}
    for name, f in [("forest", "forest_1deg.parquet"), ("landcover", "landcover_1deg.parquet"),
                    ("veg", "vegetation_monthly.parquet"), ("wind", "wind_monthly.parquet")]:
        if (AGG / f).exists():
            ext[name] = pd.read_parquet(AGG / f)
    return ext


def ext_arrays(cells, T, ext):
    """Align optional inputs to the (cells, months) grid."""
    ci = pd.Series(np.arange(len(cells)), index=cells)
    N, out = len(cells), {}
    if "forest" in ext:
        f = ext["forest"].set_index("cell1").reindex(cells)
        ly = sorted(int(c[5:]) for c in f.columns if c.startswith("loss_"))
        out["loss_years"] = ly
        out["loss"] = np.stack([f[f"loss_{y}"].to_numpy(np.float32) for y in ly], axis=1)
    if "landcover" in ext:
        l = ext["landcover"].set_index("cell1").reindex(cells)
        for c in LC_COLS:
            out[c] = l[c].to_numpy(np.float32)
    if "veg" in ext:
        v = ext["veg"]
        v = v[v.cell1.isin(ci.index)]
        a = np.full((N, T), np.nan, np.float32)
        tt = t_of(v.ym.to_numpy())
        ok = tt < T
        a[ci[v.cell1.to_numpy()[ok]].to_numpy(), tt[ok]] = v.ndvi.to_numpy()[ok]
        out["ndvi"] = a
    if "wind" in ext:  # strong wind at 10 m (pipeline/wind.py)
        v = ext["wind"]
        v = v[v.cell1.isin(ci.index)]
        tt = t_of(v.ym.to_numpy())
        ok = tt < T
        for col, key in (("WS10M_MAX", "wsmax"), ("WS10M", "ws10")):
            a = np.full((N, T), np.nan, np.float32)
            a[ci[v.cell1.to_numpy()[ok]].to_numpy(), tt[ok]] = v[col].to_numpy()[ok]
            out[key] = a
    return out


def build_arrays(h1, w, forecast_months):
    data_end = int(h1.ym.max())
    # cells: burned (>= THR) at least once, and have weather
    burned = set(h1.loc[h1.h >= THR, "cell1"])
    cells = np.array(sorted(burned & set(w.cell1)))
    ci = {c: i for i, c in enumerate(cells)}
    T = t_of(max(forecast_months)) + 1
    H = np.full((len(cells), T), np.nan, np.float32)
    H[:, : t_of(data_end) + 1] = 0
    hh = h1[h1.cell1.isin(ci)]
    H[hh.cell1.map(ci).values, t_of(hh.ym.values)] = hh.h.values
    W = {}
    ww = w[w.cell1.isin(ci)]
    for p in PARAMS:
        a = np.full((len(cells), T), np.nan, np.float32)
        ok = ww[p].notna() & (t_of(ww.ym.values) < T)
        a[ww.cell1[ok].map(ci).values, t_of(ww.ym[ok].values)] = ww[p][ok].values
        W[p] = a
    return cells, H, W, data_end


def zscore_by_calmonth(a):
    """anomaly vs the cell's own calendar-month climatology (CLIM_YEARS)."""
    z = np.full_like(a, np.nan)
    t0, t1 = t_of(CLIM_YEARS[0] * 100 + 1), t_of(CLIM_YEARS[1] * 100 + 12)
    for cm in range(12):
        idx = np.arange(cm, a.shape[1], 12)
        cl = idx[(idx >= t0) & (idx <= t1)]
        mu = np.nanmean(a[:, cl], axis=1, keepdims=True)
        sd = np.nanstd(a[:, cl], axis=1, keepdims=True) + 1e-6
        z[:, idx] = (a[:, idx] - mu) / sd
    return z


def lag(a, k):
    out = np.full_like(a, np.nan)
    out[:, k:] = a[:, :-k]
    return out


def features(cells, H, W, data_end, E=None):
    E = E or {}
    N, T = H.shape
    Y = np.isfinite(H) & (H >= THR)
    Yf = np.where(np.isfinite(H), Y.astype(np.float32), np.nan)
    Z = {SHORT[p]: zscore_by_calmonth(W[p]) for p in PARAMS}
    # fire-weather index of month m-1: hot, dry air, little rain, dry soil, windy
    fwi_raw = Z["t"] - Z["rh"] - Z["p"] - Z["gw"] + 0.5 * Z["ws"]
    fwi = lag(fwi_raw, 1)
    p3 = lag(np.nanmean(np.stack([Z["p"], lag(Z["p"], 1), lag(Z["p"], 2)]), axis=0), 1)

    nY = T // 12 + 1
    pad = nY * 12 - T

    def by_year(a):  # (N,T) -> (N, nY, 12)
        return np.concatenate([a, np.full((N, pad), np.nan, a.dtype)], axis=1).reshape(N, nY, 12)

    Yy, Hy, Fy = by_year(Yf), by_year(H), by_year(fwi)
    obs = np.isfinite(Yy)
    fired = np.nan_to_num(Yy)
    # prior-year counts (strictly before year Y) per calendar month
    cnt = np.cumsum(fired, axis=1) - fired
    yrs = np.cumsum(obs, axis=1) - obs
    clim = (cnt + 0.3) / (yrs + 1)
    logH = np.log1p(np.nan_to_num(Hy))
    mean_logH = (np.cumsum(logH, axis=1) - logH) / np.maximum(yrs, 1)
    nb = (np.roll(cnt, 1, axis=2) + np.roll(cnt, -1, axis=2) + 0.6) / (2 * yrs + 2)  # neighbouring months
    last = np.concatenate([np.full((N, 1, 12), np.nan), Yy[:, :-1]], axis=1)

    # analog score over earlier years: kernel on fwi distance
    d = Fy[:, :, None, :] - Fy[:, None, :, :]          # (N, Y, Yprior, 12)
    wgt = np.exp(-(d ** 2) / (2 * SIGMA ** 2))
    prior = np.tril(np.ones((nY, nY), bool), -1)[None, :, :, None]
    valid = prior & np.isfinite(d) & obs[:, None, :, :]
    wgt = np.where(valid, wgt, 0)
    hits = (wgt * fired[:, None, :, :]).sum(2)
    analog = (hits + 0.5 * clim) / (wgt.sum(2) + 0.5)
    close_hits = (valid & (np.abs(np.nan_to_num(d, nan=9)) < SIGMA) & (fired[:, None, :, :] > 0)).sum(2)

    unyear = lambda a: a.reshape(N, nY * 12)[:, :T]
    rows, cols = np.meshgrid(np.arange(N), np.arange(T), indexing="ij")
    lat = 90 - (cells // 360 + 0.5)
    lon = -180 + (cells % 360) + 0.5
    cm = cols % 12
    F = {
        "clim_rate": unyear(clim), "past_fire_years": unyear(cnt), "nb_rate": unyear(nb),
        "hist_logH": unyear(mean_logH), "last_year": unyear(last),
        "analog_rate": unyear(analog), "analog_hits": unyear(close_hits.astype(np.float32)),
        "fwi": fwi, "p3_z": p3,
        **{f"{k}_z": lag(Z[k], 1) for k in Z},
        **{f"{SHORT[p]}": lag(W[p], 1) for p in PARAMS},
        "msin": np.sin(2 * np.pi * cm / 12), "mcos": np.cos(2 * np.pi * cm / 12),
        "lat": np.broadcast_to(lat[:, None], (N, T)), "lon": np.broadcast_to(lon[:, None], (N, T)),
    }
    # ---- new inputs (Day Four). Each uses only information available at the end of m-1.
    year_idx = cols // 12                                  # 0 = year 2000
    rr = np.arange(N)[:, None]
    # extra weather: vapour-pressure deficit (kPa) from max temperature and humidity of m-1
    es = 0.6108 * np.exp(17.27 * W["T2M_MAX"] / (W["T2M_MAX"] + 237.3))
    vpd_raw = es * (1 - np.clip(W["RH2M"], 0, 100) / 100)
    F["vpd"] = lag(vpd_raw, 1)
    F["vpd_z"] = lag(zscore_by_calmonth(vpd_raw), 1)
    F["p6_z"] = lag(np.nanmean(np.stack([Z["p"]] + [lag(Z["p"], k) for k in range(1, 6)]), axis=0), 1)
    F["gw3_z"] = lag(np.nanmean(np.stack([Z["gw"], lag(Z["gw"], 1), lag(Z["gw"], 2)]), axis=0), 1)
    # fuel history from our own record, previous calendar years only (available for the live forecast)
    Hy_tot = np.nansum(Hy, axis=2)                                         # total per year
    any_y = np.nan_to_num(Yy).max(axis=2) > 0                              # burned that year
    last_burn = np.full((N, nY), np.nan, np.float32)
    seen = np.full(N, np.nan, np.float32)
    for yi in range(nY):
        last_burn[:, yi] = seen                                            # last burn year strictly before yi
        seen = np.where(any_y[:, yi], yi, seen)
    yrs_since = np.arange(nY)[None, :] - last_burn                        # NaN = never burned before
    F["yrs_since_fire"] = yrs_since[rr, year_idx]
    prev_tot = np.concatenate([np.full((N, 1), np.nan), np.log1p(Hy_tot[:, :-1])], axis=1)
    F["prev_year_logH"] = prev_tot[rr, year_idx]
    # "nowcast": fire in month m-1 itself, in the cell and its 8 neighbours. Our history stops at the
    # end of the FIRMS archives (Dec 2025), so this is NOT available for the live forecast.
    Hl = lag(np.log1p(H), 1)
    F["h_prev"] = Hl
    pos = {int(c): i for i, c in enumerate(cells)}
    nbsum = np.zeros_like(Hl)
    nbcnt = np.zeros_like(Hl)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            idx = np.array([pos.get(int(c + dr * 360 + dc), -1) for c in cells])
            ok = idx >= 0
            nbsum[ok] += np.nan_to_num(Hl[idx[ok]])
            nbcnt[ok] += 1
    F["nb_prev"] = np.where(np.isfinite(Hl), nbsum / np.maximum(nbcnt, 1), np.nan)
    # forest (Hansen): canopy in 2000 (static) + loss of the latest year <= Y-1 that exists (to 2024)
    if "loss" in E:
        ly = np.array(E["loss_years"])
        L = np.nan_to_num(E["loss"])
        cum = np.cumsum(L, axis=1)
        yr = Y0 + year_idx
        j = np.searchsorted(ly, yr - 1, side="right") - 1
        ok = j >= 0
        jj = np.clip(j, 0, None)
        F["loss_prev"] = np.where(ok, L[rr, jj], 0).astype(np.float32)
        F["loss_cum"] = np.where(ok, cum[rr, jj], 0).astype(np.float32)
        j3 = jj - 3
        before = np.where(j3 >= 0, cum[rr, np.clip(j3, 0, None)], 0)
        F["loss_3y"] = np.where(ok, cum[rr, jj] - before, 0).astype(np.float32)
    if "lc_tree" in E:
        for c in LC_COLS:
            F[c] = np.broadcast_to(E[c][:, None], (N, T))
    if "ndvi" in E:
        nd = E["ndvi"]
        F["ndvi"] = lag(nd, 1)
        F["ndvi_z"] = lag(zscore_by_calmonth(nd), 1)
        F["ndvi_chg3"] = lag(nd - lag(nd, 3), 1)

    # strong wind (10 m) of month m-1, and how it combines with dryness and with forest fuel
    if "wsmax" in E:
        wz = zscore_by_calmonth(E["wsmax"])
        F["wmax"] = lag(E["wsmax"], 1)
        F["wmax_z"] = lag(wz, 1)
        F["w10_z"] = lag(zscore_by_calmonth(E["ws10"]), 1)
        F["dry_wind"] = lag(wz - Z["rh"] - Z["p"], 1)          # windy AND dry air AND little rain
        if "lc_tree" in E:
            tree = np.nan_to_num(E["lc_tree"])[:, None]          # 0..1 share of the cell under trees
            F["wmax_x_tree"] = (F["wmax_z"] * tree).astype(np.float32)
            F["fwi_x_tree"] = (fwi * tree).astype(np.float32)
        if "loss_prev" in F:
            F["loss_x_wind"] = (F["loss_cum"] * F["wmax_z"]).astype(np.float32)
        extra_wind = wz
    else:
        extra_wind = None

    names = list(F)
    X = np.stack([np.asarray(F[k], np.float32).reshape(-1) for k in names], axis=1)
    meta = {"cell": cells[rows.reshape(-1)], "t": cols.reshape(-1), "y": Yf.reshape(-1)}
    extra = {"fwi_y": Fy, "fired_y": fired, "H_y": Hy, "obs_y": obs, "cnt": cnt, "yrs": yrs, "Z": Z,
             "F": F, "wind_z": extra_wind}
    return X, names, meta, extra


LC_COLS = ["lc_tree", "lc_shrub", "lc_grass", "lc_crop", "lc_built", "lc_bare"]
# feature sets for the ablation (pipeline/experiments.py) and the final model
FSETS = {
    "history": ["clim_rate", "past_fire_years", "nb_rate", "hist_logH", "last_year"],
    "analog": ["analog_rate", "analog_hits"],
    "weather": ["fwi", "p3_z", "t_z", "p_z", "rh_z", "ws_z", "gw_z", "t", "p", "rh", "ws", "gw"],
    "season_loc": ["msin", "mcos", "lat", "lon"],
    "weather_plus": ["vpd", "vpd_z", "p6_z", "gw3_z"],
    "fuel_history": ["yrs_since_fire", "prev_year_logH"],
    "nowcast": ["h_prev", "nb_prev"],
    "forest": ["loss_prev", "loss_cum", "loss_3y"],
    "landcover": LC_COLS,
    "vegetation": ["ndvi", "ndvi_z", "ndvi_chg3"],
    "wind": ["wmax", "wmax_z", "w10_z", "dry_wind"],
    "wind_x_forest": ["wmax_x_tree", "fwi_x_tree", "loss_x_wind"],
}
BASE_SETS = ["history", "analog", "weather", "season_loc"]       # the Day One model (23 features)


def chosen_sets():
    f = AGG / "feature_choice.json"
    return json.loads(f.read_text())["sets"] if f.exists() else BASE_SETS


GROUPS = {
    "Fire history in this month": ["clim_rate", "past_fire_years", "nb_rate", "hist_logH"],
    "Fire there last year": ["last_year"],
    "Past years with similar weather": ["analog_rate", "analog_hits"],
    "Overall fire weather": ["fwi"],
    "Heat (max temperature)": ["t_z", "t"],
    "Rainfall (last 1-3 months)": ["p_z", "p3_z", "p"],
    "Soil moisture": ["gw_z", "gw"],
    "Humidity": ["rh_z", "rh"],
    "Wind": ["ws_z", "ws"],
    "Season & location": ["msin", "mcos", "lat", "lon"],
    "Drought & dry air": ["vpd", "vpd_z", "p6_z", "gw3_z"],
    "Years since last fire": ["yrs_since_fire", "prev_year_logH"],
    "Fire last month nearby": ["h_prev", "nb_prev"],
    "Forest loss (deforestation)": ["loss_prev", "loss_cum", "loss_3y"],
    "Land cover": LC_COLS,
    "Vegetation greenness": ["ndvi", "ndvi_z", "ndvi_chg3"],
    "Strong wind (10 m)": ["wmax", "wmax_z", "w10_z", "dry_wind"],
    "Wind × forest": ["wmax_x_tree", "fwi_x_tree", "loss_x_wind"],
}


PARAMS_XGB = dict(objective="binary:logistic", eval_metric="aucpr", tree_method="hist", max_depth=8,
                  learning_rate=0.05, subsample=0.8, colsample_bytree=0.8, min_child_weight=20, reg_lambda=2.0,
                  seed=42)


def _gpu_ok():
    """Use the NVIDIA GPU when XGBoost can (2-3x faster here); EMBER_DEVICE=cpu forces the CPU."""
    import os
    if os.environ.get("EMBER_DEVICE", "").lower() == "cpu":
        return False
    try:
        xgb.train({"tree_method": "hist", "device": "cuda"}, xgb.DMatrix(np.zeros((8, 2)), label=np.zeros(8)), 1)
        return True
    except Exception:
        return False


if _gpu_ok():
    PARAMS_XGB["device"] = "cuda"


def veg_text(z):
    if not np.isfinite(z):
        return None
    if z < -1.0: return f"much browner / drier than usual ({z:+.1f}σ)"
    if z < -0.5: return f"drier than usual ({z:+.1f}σ)"
    if z > 1.0: return f"much greener than usual ({z:+.1f}σ)"
    if z > 0.5: return f"greener than usual ({z:+.1f}σ)"
    return "close to normal"


def wx_text(z):
    bits = []
    if z["t"] > 0.5: bits.append(f"hotter than usual (+{z['t']:.1f}σ)")
    elif z["t"] < -0.5: bits.append(f"cooler than usual ({z['t']:.1f}σ)")
    if z["p"] < -0.5: bits.append("less rain than usual")
    elif z["p"] > 0.5: bits.append("wetter than usual")
    if z["gw"] < -0.5: bits.append("dry soil")
    elif z["gw"] > 0.5: bits.append("moist soil")
    if z["rh"] < -0.5: bits.append("dry air")
    if z["ws"] > 0.8: bits.append("windy")
    return ", ".join(bits) if bits else "close to normal"


def main():
    h1, country, w = load()
    wmax = int(w.ym.max())
    # forecast: current month (from last month's weather) and next month (from this month's weather so far)
    fc_months = [ym_of(t_of(wmax)), ym_of(t_of(wmax) + 1)]
    cells, H, W, data_end = build_arrays(h1, w, fc_months)
    print(f"cells {len(cells)}, data_end {data_end}, weather to {wmax}, forecast {fc_months}", flush=True)
    E = ext_arrays(cells, H.shape[1], load_ext())
    X, names_all, meta, extra = features(cells, H, W, data_end, E)
    sets = chosen_sets()
    names = [n for s_ in sets for n in FSETS[s_] if n in names_all]
    X = X[:, [names_all.index(n) for n in names]]
    print(f"feature sets {sets}: {len(names)} features", flush=True)
    y, t = meta["y"], meta["t"]
    year = Y0 + t // 12
    has = np.isfinite(y) & np.isfinite(X[:, names.index("fwi")]) & (year >= 2002)
    tr, va, te = has & (year <= 2020), has & (year >= 2021) & (year <= 2022), has & (year >= 2023)
    print(f"train {tr.sum():,} val {va.sum():,} test {te.sum():,} base rate {np.nanmean(y[has]):.3f}", flush=True)

    params = dict(PARAMS_XGB)
    try:
        xgb.train({**params, "device": "cuda"}, xgb.DMatrix(X[:1000], label=y[:1000].clip(0)), 1)
        params["device"] = "cuda"
    except Exception:
        pass
    dtr = xgb.DMatrix(X[tr], label=y[tr], feature_names=names)
    dva = xgb.DMatrix(X[va], label=y[va], feature_names=names)
    bst = xgb.train(params, dtr, 3000, evals=[(dva, "val")], early_stopping_rounds=100, verbose_eval=200)
    best = bst.best_iteration + 1
    pte = bst.predict(xgb.DMatrix(X[te], feature_names=names), iteration_range=(0, best))
    base = X[te, names.index("clim_rate")]
    metrics = {
        "auc": float(roc_auc_score(y[te], pte)), "ap": float(average_precision_score(y[te], pte)),
        "baseline_auc": float(roc_auc_score(y[te], base)), "baseline_ap": float(average_precision_score(y[te], base)),
        "test_years": f"2023–{data_end // 100}", "train_years": "2002–2022", "train_rows": int((tr | va).sum()),
        "base_rate": float(np.nanmean(y[te])), "trees": best,
    }
    # where fire is NOT the usual thing (burned in <30% of earlier years): can weather tell us?
    un = base < 0.3
    if y[te][un].sum() > 0:
        metrics.update({
            "unusual_share": float(un.mean()), "unusual_events": int(y[te][un].sum()),
            "unusual_auc": float(roc_auc_score(y[te][un], pte[un])),
            "unusual_baseline_auc": float(roc_auc_score(y[te][un], base[un])),
            "unusual_ap": float(average_precision_score(y[te][un], pte[un])),
            "unusual_baseline_ap": float(average_precision_score(y[te][un], base[un])),
        })
    print(metrics, flush=True)

    # final model on everything observed
    allm = has
    final = xgb.train(params, xgb.DMatrix(X[allm], label=y[allm], feature_names=names), best)
    final.save_model(str(AGG / "model.json"))
    imp = final.get_score(importance_type="gain")

    # ---- forecast rows
    out_cells, details = [], {}
    N = len(cells)
    fidx = [np.where(meta["t"] == t_of(m))[0] for m in fc_months]
    dm = [xgb.DMatrix(X[ix], feature_names=names) for ix in fidx]
    probs = [final.predict(d) for d in dm]
    contribs = [final.predict(d, pred_contribs=True) for d in dm]
    countries = sorted(set(country.values))
    cidx = {c: i for i, c in enumerate(countries)}
    Fy, fired, Hy, obs = extra["fwi_y"], extra["fired_y"], extra["H_y"], extra["obs_y"]
    for k, m in enumerate(fc_months):
        yi, cm = t_of(m) // 12, t_of(m) % 12
        for i in range(N):
            c = int(cells[i])
            if k == 0:
                out_cells.append([c, 0, 0, cidx.get(country.get(c), -1)])
            out_cells[i][1 + k] = int(round(float(probs[k][i]) * 1000))
            # explanation
            row = contribs[k][i]
            grp = [(g, float(sum(row[names.index(f)] for f in fs if f in names))) for g, fs in GROUPS.items()
                   if any(f in names for f in fs)]
            grp = sorted(grp, key=lambda x: -abs(x[1]))[:4]
            cur = Fy[i, yi, cm]
            prior = [(Y0 + y_, abs(Fy[i, y_, cm] - cur)) for y_ in range(yi) if obs[i, y_, cm] and np.isfinite(Fy[i, y_, cm])]
            prior = sorted(prior, key=lambda x: x[1])[:4] if np.isfinite(cur) else []
            analogs = [[yr, int(fired[i, yr - Y0, cm] > 0), int(Hy[i, yr - Y0, cm])] for yr, _ in sorted(prior)]
            z = {kk: float(np.nan_to_num(extra["Z"][kk][i, t_of(m) - 1])) for kk in extra["Z"]}
            d_ = {
                "hist": [int(extra["cnt"][i, yi, cm]), int(extra["yrs"][i, yi, cm])],
                "wx_text": wx_text(z), "fwi": round(float(np.nan_to_num(cur)), 2),
                "analogs": analogs, "drivers": [[g, round(v, 3)] for g, v in grp],
            }
            Fx, tm = extra["F"], t_of(m)
            if "ndvi_z" in Fx:
                vz = float(Fx["ndvi_z"][i, tm])
                if np.isfinite(vz):
                    d_["veg"] = {"ndvi": round(float(Fx["ndvi"][i, tm]), 3), "z": round(vz, 2), "text": veg_text(vz)}
            details.setdefault(c, []).append(d_)
    metrics["feature_sets"] = sets
    metrics["n_features"] = len(names)
    # static land info per cell for the click card (forest %, land-cover mix, forest loss)
    land = {}
    for i in range(N):
        c = int(cells[i])
        e = {}
        if "loss" in E and np.isfinite(E["loss"][i]).any():
            e["loss_recent"] = round(float(np.nansum(E["loss"][i, -3:])) * 100, 2)
            e["loss_years"] = f"{E['loss_years'][-3]}–{E['loss_years'][-1]}"
        if "lc_tree" in E and np.isfinite(E["lc_tree"][i]):
            e["lc"] = {k[3:]: round(float(E[k][i]) * 100, 1) for k in LC_COLS}
        if e:
            land[c] = e
    for c, e in land.items():
        for d_ in details.get(c, []):
            d_["land"] = e
    res = {"months": fc_months, "issued": pd.Timestamp.today().strftime("%Y-%m-%d"), "threshold": THR,
           "weather_through": wmax, "metrics": metrics, "countries": countries, "cells": out_cells,
           "importance": {k: round(v, 2) for k, v in sorted(imp.items(), key=lambda x: -x[1])}}
    (AGG / "forecast.json").write_text(json.dumps(res))
    (AGG / "forecast_details.json").write_text(json.dumps(details))
    print("forecast cells", len(out_cells), "high risk (>=50%):", [sum(r[1 + k] >= 500 for r in out_cells) for k in range(2)])


if __name__ == "__main__":
    main()
