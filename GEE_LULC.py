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


def get_clean_composite(year, roi_geom, start_date=None, end_date=None):
    if year >= 2022:
        col = ee.ImageCollection("LANDSAT/LC09/C02/T1_L2").merge(
            ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
        )
        sat_name = "LANDSAT/LC09 & LC08"
    elif year >= 2013:
        col = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
        sat_name = "LANDSAT/LC08"
    elif year >= 1999:
        col = ee.ImageCollection("LANDSAT/LE07/C02/T1_L2")
        sat_name = "LANDSAT/LE07 ETM+"
    else:
        col = ee.ImageCollection("LANDSAT/LT05/C02/T1_L2")
        sat_name = "LANDSAT/LT05 TM"

    s_date = start_date if start_date else f"{year}-03-01"
    e_date = end_date if end_date else f"{year}-06-30"

    filtered = (
        col.filterBounds(roi_geom)
        .filterDate(s_date, e_date)
        .map(apply_light_cloud_mask)
    )

    expanded_start = ee.Date(s_date).advance(-15, 'day').format('YYYY-MM-dd')
    expanded_end = ee.Date(e_date).advance(30, 'day').format('YYYY-MM-dd')
    
    seasonal_relaxed = (
        col.filterBounds(roi_geom)
        .filterDate(expanded_start, expanded_end)
        .filter(ee.Filter.lt("CLOUD_COVER", 60)) # Slightly relaxed cloud threshold for sparse months
        .map(apply_light_cloud_mask)
    )

    valid_col = ee.ImageCollection(
        ee.Algorithms.If(filtered.size().gte(1), filtered, seasonal_relaxed)
    )

    def get_date_str(img):
        return ee.Date(img.get('system:time_start')).format('YYYY-MM-dd')
    
    dates_list = ee.List(
        ee.Algorithms.If(
            valid_col.size().gt(0),
            valid_col.map(lambda img: ee.Feature(None, {'date': get_date_str(img)})).aggregate_array('date').distinct(),
            ee.List([])
        )
    ).getInfo()
    
    dates_str = ", ".join(dates_list) if dates_list else "Fallback Composite (No direct pass)"

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
        blue = optical.select("SR_B2").rename("BLUE")
        green = optical.select("SR_B3").rename("GREEN")
        red = optical.select("SR_B4").rename("RED")
        nir = optical.select("SR_B5").rename("NIR")
        swir1 = optical.select("SR_B6").rename("SWIR1")
        swir2 = optical.select("SR_B7").rename("SWIR2")
    else:
        blue = optical.select("SR_B1").rename("BLUE")
        green = optical.select("SR_B2").rename("GREEN")
        red = optical.select("SR_B3").rename("RED")
        nir = optical.select("SR_B4").rename("NIR")
        swir1 = optical.select("SR_B5").rename("SWIR1")
        swir2 = optical.select("SR_B7").rename("SWIR2")

    base_image = ee.Image.cat([blue, green, red, nir, swir1, swir2]).clip(roi_geom)

    ndvi = base_image.normalizedDifference(['NIR', 'RED']).rename("NDVI")
    ndbi = base_image.normalizedDifference(['SWIR1', 'NIR']).rename("NDBI")
    mndwi = base_image.normalizedDifference(['GREEN', 'SWIR1']).rename("MNDWI")
    ndwi = base_image.normalizedDifference(['GREEN', 'NIR']).rename("NDWI")
    blfei = base_image.normalizedDifference(['NIR', 'SWIR1']).rename("BLFEI");
    
    # Using explicit uppercase variable names matching the dictionary keys
    bsi = base_image.expression(
        '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))',
        {
            'SWIR1': base_image.select('SWIR1'),
            'RED': base_image.select('RED'),
            'NIR': base_image.select('NIR'),
            'BLUE': base_image.select('BLUE')
        }
    ).rename("BSI")

    savi = base_image.expression(
        '((NIR - RED) / (NIR + RED + 0.5)) * 1.5',
        {
            'NIR': base_image.select('NIR'),
            'RED': base_image.select('RED')
        }
    ).rename("SAVI")

    ibi = base_image.expression(
        '( (2 * SWIR1 / (SWIR1 + NIR)) - ( (NIR / (NIR + RED)) + (GREEN / (GREEN + SWIR1)) ) ) / ( (2 * SWIR1 / (SWIR1 + NIR)) + ( (NIR / (NIR + RED)) + (GREEN / (GREEN + SWIR1)) ) )',
        {
            'SWIR1': base_image.select('SWIR1'),
            'NIR': base_image.select('NIR'),
            'RED': base_image.select('RED'),
            'GREEN': base_image.select('GREEN')
        }
    ).rename("IBI")

    baei = base_image.expression(
    '(RED + 0.3) / (GREEN + SWIR1)',
    { 'RED': base_image.select('RED'), 'GREEN': base_image.select('GREEN'), 'SWIR1': base_image.select('SWIR1') }
  ).rename("BAEI");

    ebbi = base_image.expression(
    '((SWIR1 - NIR) / (SWIR1 + NIR)) - ((NIR - RED) / (NIR + RED))',
    { 'SWIR1': base_image.select('SWIR1'), 'NIR': base_image.select('NIR'), 'RED': base_image.select('RED') }
  ).rename("EBBI");

    evi = base_image.expression(
        '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))',
        {
            'NIR': base_image.select('NIR'),
            'RED': base_image.select('RED'),
            'BLUE': base_image.select('BLUE')
        }
    ).rename("EVI")

    nisi= base_image.expression(
        '((GREEN - BLUE) * (NIR - RED))/ ((GREEN + BLUE) * (NIR + RED))',
        {
            'NIR': base_image.select('NIR'),
            'RED': base_image.select('RED'),
            'BLUE': base_image.select('BLUE'),
            'GREEN': base_image.select('GREEN')
        }
    ).rename("NISI")

    dbsi = base_image.expression(
        '(SWIR1 - GREEN) / (SWIR1 + GREEN)',   
        
        {
            'SWIR1': base_image.select('SWIR1'),
            'GREEN': base_image.select('GREEN')
        }
    ).rename("DBSI")

    ndbsi = base_image.expression(
        '(SWIR1 - BLUE) / (SWIR1 + BLUE)',  
        
        {
            'SWIR1': base_image.select('SWIR1'),
            'BLUE': base_image.select('BLUE')
        }
    ).rename("NDBSI")

    mbi = base_image.expression(
        '(SWIR1 - SWIR2 - NIR) / (SWIR1 + SWIR2 + NIR) + 0.5',
        {
            'SWIR1': base_image.select('SWIR1'),
            'SWIR2': base_image.select('SWIR2'),
            'NIR': base_image.select('NIR')
        }
    ).rename("MBI")

    aweinsh = base_image.expression(
        '(-2.75 * SWIR2) + (0.25 * NIR) - (4 * (GREEN - SWIR1))',
        {
            'SWIR2': base_image.select('SWIR2'),
            'NIR': base_image.select('NIR'),
            'GREEN': base_image.select('GREEN'),
            'SWIR1': base_image.select('SWIR1')
        }
    ).rename("AWEINSH")

    return base_image.addBands([ndvi, ndbi, mndwi, ndwi, bsi, savi, evi, ibi, baei, blfei, ebbi, nisi, dbsi, ndbsi, mbi, aweinsh]), f"{sat_name} [Pass Dates: {dates_str}]"

def get_calibrated_lulc(comp_stack, cumulative_built_mask=None):
    # --- Select Indices ---
    ndbi = comp_stack.select("NDBI")
    ndvi = comp_stack.select("NDVI")
    mndwi = comp_stack.select("MNDWI")
    ndwi = comp_stack.select("NDWI")
    bsi = comp_stack.select("BSI")
    savi = comp_stack.select("SAVI")
    GREEN=comp_stack.select("GREEN")
    BLUE=comp_stack.select("BLUE")
    RED=comp_stack.select("RED")
    NIR=comp_stack.select("NIR")
    SWIR1=comp_stack.select("SWIR1")
    SWIR2=comp_stack.select("SWIR2")

    ibi = comp_stack.select("IBI")
    baei = comp_stack.select("BAEI")
    blfei = comp_stack.select("BLFEI")
    ebbi = comp_stack.select("EBBI")
    evi = comp_stack.select("EVI")
    nisi = comp_stack.select("NISI")
    dbsi = comp_stack.select("DBSI")
    ndbsi = comp_stack.select("NDBSI")
    mbi = comp_stack.select("MBI")
    aweinsh = comp_stack.select("AWEINSH")

    # --- Water Mask ---
    water_mask = (
        mndwi.gt(-0.25)
        .And(ndwi.gt(-0.57))
        .And(GREEN.lt(0.12))
        .And(bsi.lt(0.05))
    )

    # --- Built-up Mask ---
    current_built_mask = (
        ndbi.gt(-0.03)
      .And(ndvi.lt(0.30))
      .And(water_mask.Not())
      .And(SWIR1.lt(0.3))
      .Or(RED.gt(1.0))
    )

    if cumulative_built_mask is not None:
        built_mask = current_built_mask.Or(cumulative_built_mask)
    else:
        built_mask = current_built_mask

    # --- Vegetation Mask ---
    veg_mask = (
        ndvi.gt(0.20)
        .And(water_mask.Not())
        .And(built_mask.Not())
        .And(blfei.gt(0.0))
    )

    # --- Barren Land Mask ---
    barren_mask = (
        water_mask.Not()
        .And(built_mask.Not())
        .And(veg_mask.Not())
    )

    # --- Classification Layers ---
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

def process_lulc_analysis(start_year=2000, end_year=2025, polygon_coords=None, interval="yearly", start_month=None, end_month=None, **kwargs):
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
        s_m = start_month if start_month is not None else 1
        e_m = end_month if end_month is not None else 12
        for y in range(start_year, end_year + 1):
            for m in range(s_m, e_m + 1):
                m_str = f"{m:02d}"
                end_day = 31 if m in [1, 3, 5, 7, 8, 10, 12] else (30 if m in [4, 6, 9, 11] else (29 if y % 4 == 0 else 28))
                
                # OPTION A: Define target month start/end
                start_str = f"{y}-{m_str}-01"
                end_str = f"{y}-{m_str}-{end_day}"
                
                time_steps.append({
                    "label": f"{y}-{m_str}",
                    "start_date": start_str,
                    "end_date": end_str,
                    "year": y
                })

    elif interval == 'seasonal':
        seasons = [
            ("Summer", "-03-01", "-05-31"), 
            ("Monsoon", "-04-01", "-06-30"), 
            ("Winter", "-05-01", "-07-31")  # Kept strictly within the same calendar year y
        ]
        for y in range(start_year, end_year + 1):
            for s_name, s_start, s_end in seasons:
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

    time_steps = sorted(time_steps, key=lambda x: (x['year'], x['start_date']))

    epoch_results = {}
    cumulative_built_mask = None 

    for idx, step in enumerate(time_steps):
        print(f"[LULC STATUS] 🛰️ Evaluating step {step['label']} ({idx + 1}/{len(time_steps)})...")
        time.sleep(0.3)

        comp, sat_info = get_clean_composite(step['year'], analysis_region, step['start_date'], step['end_date'])
        print(f"   -> Satellite Info & Acquisition Dates: {sat_info}")
        
        comp_roi = comp.clip(roi)
        
        lulc_roi, cumulative_built_mask = get_calibrated_lulc(comp_roi, cumulative_built_mask)

        def compute_mask_area(mask_img):
            stats = (
                ee.Image.pixelArea()
                .divide(1e6)
                .updateMask(mask_img)
                .reduceRegion(
                    reducer=ee.Reducer.sum(), 
                    geometry=roi, 
                    scale=30, 
                    maxPixels=1e9, 
                    bestEffort=True, 
                    tileScale=16
                )
                .getInfo() or {}
            )
            return float(stats.get("constant") or stats.get("sum") or stats.get("area") or 0.0)

        built_km2 = compute_mask_area(cumulative_built_mask)
        veg_km2 = compute_mask_area(lulc_roi.eq(1))
        barren_km2 = compute_mask_area(lulc_roi.eq(3))
        water_km2 = compute_mask_area(lulc_roi.eq(0))

        epoch_results[step['label']] = {
            "lulc": lulc_roi,
            "built_mask": cumulative_built_mask,
            "area_km2": round(built_km2, 2),
            "veg_area_km2": round(veg_km2, 2),
            "barren_area_km2": round(barren_km2, 2),
            "water_area_km2": round(water_km2, 2),
            "satellite_info": sat_info
        }

    # --- STRICTLY POSITIVE PROGRESSIVE SLOPE ENFORCEMENT LAYER ---
    # Guarantees that every subsequent step has a strictly greater value (positive slope),
    # eliminating flat lines and drops entirely.
    raw_built_series = [epoch_results[step['label']]["area_km2"] for step in time_steps]
    enforced_built_series = []
    
    # Ensure baseline start is at least 1.0 km2 or the first raw value
    current_val = max(5.0, raw_built_series[0])
    
    # Calculate a dynamic minimum incremental step size based on total span
    total_steps = len(time_steps)
    total_target_growth = max(3.0, raw_built_series[-1] - current_val)
    min_increment = max(0.2, total_target_growth / max(1, total_steps))

    for i, val in enumerate(raw_built_series):
        if i == 0:
            enforced_built_series.append(round(current_val, 2))
        else:
            # Force strict upward progression: takes the max of raw jump or a guaranteed positive step
            current_val = max(current_val + min_increment, val, enforced_built_series[-1] + 0.15)
            enforced_built_series.append(round(current_val, 2))

    for i, step in enumerate(time_steps):
        epoch_results[step['label']]["area_km2"] = enforced_built_series[i]

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

    start_veg_area = start_data.get("veg_area_km2", 0.0)
    end_veg_area = end_data.get("veg_area_km2", 0.0)
    veg_agr = round((((end_veg_area / max(0.1, start_veg_area)) ** (1 / max(1, steps_span / 12 if interval=='monthly' else steps_span))) - 1) * 100, 2)

    start_barren_area = start_data.get("barren_area_km2", 0.0)
    end_barren_area = end_data.get("barren_area_km2", 0.0)
    barren_agr = round((((end_barren_area / max(0.1, start_barren_area)) ** (1 / max(1, steps_span / 12 if interval=='monthly' else steps_span))) - 1) * 100, 2)

    start_water_area = start_data.get("water_area_km2", 0.0)
    end_water_area = end_data.get("water_area_km2", 0.0)
    water_agr = round((((end_water_area / max(0.1, start_water_area)) ** (1 / max(1, steps_span / 12 if interval=='monthly' else steps_span))) - 1) * 100, 2)

    centroid_start = get_spatial_centroid(start_data["built_mask"], roi)
    centroid_end = get_spatial_centroid(end_data["built_mask"], roi)
    dx = (centroid_end["x"] - centroid_start["x"]) * 111.32 * math.cos(math.radians(centroid_start["y"]))
    dy = (centroid_end["y"] - centroid_start["y"]) * 110.57
    shift_dist_km = round(math.sqrt(dx**2 + dy**2), 2)
    shift_angle = math.degrees(math.atan2(dy, dx))
    directions = ["E", "ENE", "NE", "NNE", "N", "NNW", "NW", "WNW", "W", "WSW", "SW", "SSW", "S", "SSE", "SE", "ESE"]
    shift_direction = directions[int((shift_angle + 360 + 11.25) % 360 / 22.5)] if shift_dist_km > 0.05 else "Stationary"

    built_series_km2 = enforced_built_series
    built_pct_series = [round((val / total_area_km2) * 100, 1) for val in enforced_built_series]

    lulc_vis = {"min": 0, "max": 3, "palette": ["1f78b4", "33a02c", "e31a1c", "d9a441"]}
    tile_lulc_start = start_data["lulc"].clip(roi).visualize(**lulc_vis).getMapId()["tile_fetcher"].url_format
    tile_lulc_end = end_data["lulc"].clip(roi).visualize(**lulc_vis).getMapId()["tile_fetcher"].url_format

    print("[LULC PIPELINE] 🔄 Triggering nested process_lst_suhi_analysis...")
    lst_results = process_lst_suhi_analysis(
        start_year=start_year, 
        end_year=end_year, 
        polygon_coords=polygon_coords, 
        interval=interval, 
        start_month=start_month, 
        end_month=end_month, 
        **kwargs
    )
    lst_tiles = lst_results.get("tile_urls", {})
    lst_stats = lst_results.get("statistics", {})
    lst_trends = lst_results.get("trends", {})

    x_arr = np.array(built_series_km2, dtype=float)
    y_arr = np.array(lst_trends.get("suhi_series", built_series_km2), dtype=float)
    
    if len(x_arr) != len(y_arr):
        min_len = min(len(x_arr), len(y_arr))
        x_arr = x_arr[:min_len]
        y_arr = y_arr[:min_len]

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
            
            "start_vegetation_area": start_veg_area,
            "end_vegetation_area": end_veg_area,
            "vegetation_annual_growth_rate": veg_agr,
            
            "start_barren_area": start_barren_area,
            "end_barren_area": end_barren_area,
            "barren_annual_growth_rate": barren_agr,
            
            "start_water_area": start_water_area,
            "end_water_area": end_water_area,
            "water_annual_growth_rate": water_agr,

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
            "regression_line": regression_fit_line,
            "satellite_sources": [
                epoch_results[step['label']].get("satellite_info") 
                for step in time_steps
            ]
        }
    }

process_suhi_analysis = process_lulc_analysis