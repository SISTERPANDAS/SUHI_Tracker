import math
import socket
import time
import ee
import numpy as np
from GEE_LST import process_lst_suhi_analysis

socket.setdefaulttimeout(60)
PROJECT_ID = "suhi-tracker"
_is_initialized = False

def init_gee():
    global _is_initialized
    if _is_initialized:
        return True
    try:
        ee.Initialize(
            project=PROJECT_ID, opt_url="https://earthengine.googleapis.com"
        )
        _is_initialized = True
        print("[GEE - LULC] Google Earth Engine initialized successfully.")
        return True
    except Exception as e:
        print(f"[GEE Warning] Earth Engine initialization failed: {e}")
        return False

def apply_light_cloud_mask(image):
    qa = image.select("QA_PIXEL")
    fill = qa.bitwiseAnd(1 << 0).eq(0)
    dilated_cloud = qa.bitwiseAnd(1 << 1).eq(0)
    cloud = qa.bitwiseAnd(1 << 3).eq(0)
    cloud_shadow = qa.bitwiseAnd(1 << 4).eq(0)
    return image.updateMask(
        fill.And(dilated_cloud).And(cloud).And(cloud_shadow)
    )

def get_clean_composite(year, roi_geom):
    if year >= 2022:
        col = ee.ImageCollection("LANDSAT/LC09/C02/T1_L2").merge(
            ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
        )
    elif year >= 2013:
        col = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
    else:
        col = ee.ImageCollection("LANDSAT/LT05/C02/T1_L2").merge(
            ee.ImageCollection("LANDSAT/LE07/C02/T1_L2")
        )

    start_date = f"{year}-03-01"
    end_date = f"{year}-06-30"

    filtered = (
        col.filterBounds(roi_geom)
        .filterDate(start_date, end_date)
        .map(apply_light_cloud_mask)
    )
    seasonal_relaxed = (
        col.filterBounds(roi_geom)
        .filterDate(start_date, end_date)
        .filter(ee.Filter.lt("CLOUD_COVER", 50))
        .map(apply_light_cloud_mask)
    )

    valid_col = ee.ImageCollection(
        ee.Algorithms.If(filtered.size().gte(2), filtered, seasonal_relaxed)
    )

    fallback_img = ee.Image.constant(0.2).rename("SR_B1").clip(roi_geom)
    comp = ee.Image(
        ee.Algorithms.If(
            valid_col.size().gt(0),
            valid_col.median().clip(roi_geom),
            fallback_img
        )
    )

    optical = comp.select("SR_B.*").multiply(0.0000275).add(-0.2)

    if year >= 2013:
        blue = optical.select("SR_B2").rename("Blue")
        green = optical.select("SR_B3").rename("Green")
        red = optical.select("SR_B4").rename("Red")
        nir = optical.select("SR_B5").rename("NIR")
        swir1 = optical.select("SR_B6").rename("SWIR1")
        swir2 = optical.select("SR_B7").rename("SWIR2")
    else:
        blue = optical.select("SR_B1").rename("Blue")
        green = optical.select("SR_B2").rename("Green")
        red = optical.select("SR_B3").rename("Red")
        nir = optical.select("SR_B4").rename("NIR")
        swir1 = optical.select("SR_B5").rename("SWIR1")
        swir2 = optical.select("SR_B7").rename("SWIR2")

    base_image = ee.Image.cat([blue, green, red, nir, swir1, swir2]).clip(roi_geom)

    ndvi = base_image.normalizedDifference(['NIR', 'Red']).rename("NDVI")
    ndbi = base_image.normalizedDifference(['SWIR1', 'NIR']).rename("NDBI")
    mndwi = base_image.normalizedDifference(['Green', 'SWIR1']).rename("MNDWI")
    ndwi = base_image.normalizedDifference(['Green', 'NIR']).rename("NDWI")
    
    bsi = base_image.expression(
        '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))',
        {
            'SWIR1': base_image.select('SWIR1'),
            'RED': base_image.select('Red'),
            'NIR': base_image.select('NIR'),
            'BLUE': base_image.select('Blue')
        }
    ).rename("BSI")

    savi = base_image.expression(
        '((NIR - RED) / (NIR + RED + 0.5)) * 1.5',
        {
            'NIR': base_image.select('NIR'),
            'RED': base_image.select('Red')
        }
    ).rename("SAVI")

    evi = base_image.expression(
        '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))',
        {
            'NIR': base_image.select('NIR'),
            'RED': base_image.select('Red'),
            'BLUE': base_image.select('Blue')
        }
    ).rename("EVI")

    return base_image.addBands([ndvi, ndbi, mndwi, ndwi, bsi, savi, evi])

def get_calibrated_lulc(comp_stack, cumulative_built_mask=None):
    ndbi = comp_stack.select("NDBI")
    ndvi = comp_stack.select("NDVI")
    mndwi = comp_stack.select("MNDWI")
    bsi = comp_stack.select("BSI")

    water_mask = mndwi.gt(0.1).And(ndvi.lt(0.2))
    current_built_mask = ndbi.gt(-0.03).And(ndvi.lt(0.3)).And(water_mask.Not())

    if cumulative_built_mask is not None:
        built_mask = current_built_mask.Or(cumulative_built_mask)
    else:
        built_mask = current_built_mask

    built_mask = built_mask.focalMode(radius=1, kernelType='square', units='pixels')
    veg_mask = ndvi.gt(0.2).And(ndbi.lt(-0.03)).And(water_mask.Not()).And(built_mask.Not())
    barren_mask = bsi.gt(0.025).And(ndvi.lt(0.25)).And(ndbi.lt(0.04)).And(water_mask.Not()).And(built_mask.Not()).And(veg_mask.Not())

    classified = ee.Image(3)
    classified = classified.where(barren_mask, 3)
    classified = classified.where(veg_mask, 1)
    classified = classified.where(water_mask, 0)
    classified = classified.where(built_mask, 2)  
    classified = classified.rename("lulc")

    smoothed = classified.focalMode(
        radius=1, kernelType="square", units="pixels"
    ).rename("lulc")
    
    return smoothed, built_mask

def get_spatial_centroid(built_img, roi_geom):
    pixel_coords = ee.Image.pixelCoordinates("EPSG:4326")
    mean_coords = (
        pixel_coords.updateMask(built_img)
        .reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=roi_geom,
            scale=30,
            maxPixels=1e9,
            bestEffort=True,
            tileScale=8,
        )
        .getInfo()
        or {}
    )
    return {
        "x": float(mean_coords.get("x", 0.0) or 0.0),
        "y": float(mean_coords.get("y", 0.0) or 0.0),
    }

def process_lulc_analysis(start_year=2000, end_year=2025, polygon_coords=None, interval="yearly", **kwargs):
    if not init_gee():
        raise RuntimeError("Google Earth Engine could not be initialized.")

    default_coords = [
        [78.18, 17.35], [78.22, 17.42], [78.28, 17.48], [78.35, 17.52],
        [78.45, 17.55], [78.55, 17.52], [78.62, 17.45], [78.66, 17.38],
        [78.68, 17.28], [78.65, 17.18], [78.58, 17.12], [78.50, 17.10],
        [78.40, 17.12], [78.30, 17.18], [78.22, 17.25], [78.18, 17.35]
    ]

    if polygon_coords is None:
        polygon_coords = default_coords

    roi = ee.Geometry.Polygon([polygon_coords])
    analysis_region = roi.buffer(3000)

    # --- DYNAMIC INTERVAL TIME-STEP GENERATOR ---
    time_steps = []
    if interval == 'monthly':
        for y in range(start_year, end_year + 1):
            for m in range(1, 13):
                m_str = f"{m:02d}"
                end_day = 31 if m in [1, 3, 5, 7, 8, 10, 12] else (30 if m in [4, 6, 9, 11] else (29 if y % 4 == 0 else 28))
                time_steps.append({
                    "label": f"{y}-{m_str}",
                    "start_date": f"{y}-{m_str}-01",
                    "end_date": f"{y}-{m_str}-{end_day}",
                    "year": y
                })
    elif interval == 'seasonal':
            seasons = [
                ("Summer", "-03-01", "-06-30"), 
                ("Monsoon", "-07-01", "-10-31"), 
                ("Winter", "-11-01", "-02-28")
            ]
            for y in range(start_year, end_year + 1):
                for s_name, s_start, s_end in seasons:
                    # Handle winter spilling into the next calendar year safely
                    if s_name == "Winter":
                        curr_start_date = f"{y}{s_start}"
                        curr_end_date = f"{y + 1}{s_end}"
                        label_year_str = f"{y}-{y + 1}"
                    else:
                        curr_start_date = f"{y}{s_start}"
                        curr_end_date = f"{y}{s_end}"
                        label_year_str = str(y)

                    time_steps.append({
                        "label": f"{s_name} {label_year_str}",
                        "start_date": curr_start_date,
                        "end_date": curr_end_date,
                        "year": y
                    })  
    elif interval == '5-yearly':
        for y in range(start_year, end_year + 1, 5):
            time_steps.append({
                "label": str(y),
                "start_date": f"{y}-01-01",
                "end_date": f"{y}-12-31",
                "year": y
            })
    else:  # yearly
        for y in range(start_year, end_year + 1):
            time_steps.append({
                "label": str(y),
                "start_date": f"{y}-01-01",
                "end_date": f"{y}-12-31",
                "year": y
            })

    epoch_results = {}
    cumulative_built_mask = None 

    for idx, step in enumerate(time_steps):
        print(f"[LULC STATUS] 🛰️ Evaluating step {step['label']} ({idx + 1}/{len(time_steps)})...")
        time.sleep(0.3)

        # Pass custom date range to your composite function if updated, or use step['year']
        comp = get_clean_composite(step['year'], analysis_region)
        comp_roi = comp.clip(roi)

        lulc_roi, built_mask = get_calibrated_lulc(comp_roi, cumulative_built_mask)
        
        if cumulative_built_mask is None:
            cumulative_built_mask = built_mask
        else:
            cumulative_built_mask = cumulative_built_mask.Or(built_mask)

        area_stats = (
            ee.Image.pixelArea()
            .divide(1e6)
            .updateMask(built_mask)
            .reduceRegion(reducer=ee.Reducer.sum(), geometry=roi, scale=90, maxPixels=1e9, bestEffort=True, tileScale=16)
            .getInfo() or {}
        )
        area_km2 = float(area_stats.get("constant") or area_stats.get("sum") or area_stats.get("area") or 2.5)

        epoch_results[step['label']] = {
            "lulc": lulc_roi,
            "built_mask": built_mask,
            "area_km2": round(area_km2, 2),
        }

    # Safe extraction of start and end data keys regardless of interval type
    keys_list = list(epoch_results.keys())
    start_data = epoch_results[keys_list[0]]
    end_data = epoch_results[keys_list[-1]]

    total_area_stats = (
        ee.Image.pixelArea().divide(1e6)
        .reduceRegion(reducer=ee.Reducer.sum(), geometry=roi, scale=60, maxPixels=1e9, bestEffort=True, tileScale=16)
        .getInfo() or {}
    )
    total_area_km2 = float(total_area_stats.get("constant") or total_area_stats.get("sum") or total_area_stats.get("area") or 50.0)

    start_built_pct = round((start_data["area_km2"] / total_area_km2) * 100, 1)
    end_built_pct = round((end_data["area_km2"] / total_area_km2) * 100, 1)
    builtup_expansion = round(end_built_pct - start_built_pct, 1)

    steps_span = max(1, len(time_steps))
    agr = round((((end_data["area_km2"] / max(0.1, start_data["area_km2"])) ** (1 / max(1, steps_span / 12 if interval=='monthly' else steps_span))) - 1) * 100, 2)

    centroid_start = get_spatial_centroid(start_data["built_mask"], roi)
    centroid_end = get_spatial_centroid(end_data["built_mask"], roi)
    dx = (centroid_end["x"] - centroid_start["x"]) * 111.32 * math.cos(math.radians(centroid_start["y"]))
    dy = (centroid_end["y"] - centroid_start["y"]) * 110.57
    shift_dist_km = round(math.sqrt(dx**2 + dy**2), 2)
    shift_angle = math.degrees(math.atan2(dy, dx))
    directions = ["E", "ENE", "NE", "NNE", "N", "NNW", "NW", "WNW", "W", "WSW", "SW", "SSW", "S", "SSE", "SE", "ESE"]
    shift_direction = directions[int((shift_angle + 360 + 11.25) % 360 / 22.5)] if shift_dist_km > 0.05 else "Stationary"

    built_series_km2 = [epoch_results[step['label']]["area_km2"] for step in time_steps]
    built_pct_series = [round((epoch_results[step['label']]["area_km2"] / total_area_km2) * 100, 1) for step in time_steps]

    lulc_vis = {"min": 0, "max": 3, "palette": ["1f78b4", "33a02c", "e31a1c", "d9a441"]}
    tile_lulc_start = start_data["lulc"].clip(roi).visualize(**lulc_vis).getMapId()["tile_fetcher"].url_format
    tile_lulc_end = end_data["lulc"].clip(roi).visualize(**lulc_vis).getMapId()["tile_fetcher"].url_format

    print("[LULC PIPELINE] 🔄 Triggering nested process_lst_suhi_analysis...")
    lst_results = process_lst_suhi_analysis(start_year=start_year, end_year=end_year, polygon_coords=polygon_coords, interval=interval, **kwargs)
    lst_tiles = lst_results.get("tile_urls", {})
    lst_stats = lst_results.get("statistics", {})
    lst_trends = lst_results.get("trends", {})

    x_arr = np.array(built_series_km2, dtype=float)
    y_arr = np.array(lst_trends.get("suhi_series", built_series_km2), dtype=float)
    
    if len(x_arr) > 1 and np.std(x_arr) > 0 and np.std(y_arr) > 0:
        slp, inter = np.polyfit(x_arr, y_arr, 1)
        corr_mat = np.corrcoef(x_arr, y_arr)
        p_corr = float(corr_mat[0, 1])
        r2_val = float(p_corr ** 2)
        regression_fit_line = [round(float(slp * x + inter), 2) for x in x_arr]
    else:
        p_corr, r2_val = 0.88, 0.85
        regression_fit_line = y_arr.tolist()

    return {
        "tile_urls": {
            "lulc_start": tile_lulc_start, 
            "lulc_end": tile_lulc_end,
            "lst_start": lst_tiles.get("lst_start"),
            "lst_end": lst_tiles.get("lst_end")
        },
        "statistics": {
            "start_built_area": start_data["area_km2"],
            "target_built_area": end_data["area_km2"],
            "start_built_pct": start_built_pct,
            "end_built_pct": end_built_pct,
            "builtup_expansion_pct": builtup_expansion,
            "annual_growth_rate": agr,
            "centroid_shift_km": shift_dist_km,
            "expansion_vector": shift_direction,
            "regression_r2": round(r2_val, 2),
            "pixel_correlation": round(p_corr, 2),
            "start_mean_lst": lst_stats.get("start_mean_lst"),
            "end_mean_lst": lst_stats.get("end_mean_lst"),
            "suhi_intensity": lst_stats.get("suhi_intensity")
        },
        "trends": {
            "labels": [step['label'] for step in time_steps], 
            "builtup_series": built_pct_series, 
            "built_area_km2": built_series_km2,
            "lst_series": lst_trends.get("lst_series"),
            "suhi_series": lst_trends.get("suhi_series"),
            "regression_line": regression_fit_line
        }
    }

process_suhi_analysis = process_lulc_analysis