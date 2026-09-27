import os
import sqlite3
import traceback
from datetime import timedelta
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash

#from GEE_LST import get_clean_composite
from GEE_LULC import process_lulc_analysis

app = Flask(__name__)
app.secret_key = "hyd_suhi_persistent_secret_key_2026"
app.permanent_session_lifetime = timedelta(days=30)

DB_PATH = os.path.join(os.path.dirname(__file__), 'users.db')

# -------------------------------------------------------------------
# DATABASE INITIALIZATION
# -------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    try:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        cursor = conn.execute("SELECT * FROM users WHERE email = ?", ("admin@hyderabad.gov.in",))
        if not cursor.fetchone():
            default_hash = generate_password_hash("password123")
            conn.execute(
                "INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)",
                ("admin@hyderabad.gov.in", "Lead GIS Analyst", default_hash)
            )
        conn.commit()
    finally:
        conn.close()

init_db()

HYD_REGIONS = {
    "Gachibowli": [[78.330, 17.420], [78.370, 17.420], [78.370, 17.460], [78.330, 17.460], [78.330, 17.420]],
    "HITEC City": [[78.360, 17.430], [78.400, 17.430], [78.400, 17.470], [78.360, 17.470], [78.360, 17.430]],
    "Kukatpally": [[78.380, 17.470], [78.430, 17.470], [78.430, 17.510], [78.380, 17.510], [78.380, 17.470]],
    "Secunderabad": [[78.480, 17.420], [78.530, 17.420], [78.530, 17.460], [78.480, 17.460], [78.480, 17.420]],
    "Charminar": [[78.450, 17.340], [78.490, 17.340], [78.490, 17.380], [78.450, 17.380], [78.450, 17.340]]
}

# -------------------------------------------------------------------
# PAGE ROUTES
# -------------------------------------------------------------------
@app.route('/')
def root():
    if 'user' in session:
        return redirect(url_for('dashboard_view'))
    return redirect(url_for('login_view'))

@app.route('/login')
def login_view():
    if 'user' in session:
        return redirect(url_for('dashboard_view'))
    return render_template('login/login.html')

@app.route('/dashboard')
def dashboard_view():
    if 'user' not in session:
        return redirect(url_for('login_view'))
    return render_template('dashboard/dashboard.html', user=session['user'])

# -------------------------------------------------------------------
# AUTHENTICATION API
# -------------------------------------------------------------------
@app.route('/api/auth/register', methods=['POST'])
def api_register():
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password')
    name = (data.get('name') or '').strip() or email.split('@')[0]

    if not email or not password:
        return jsonify({"success": False, "message": "Email and password are required."}), 400

    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)",
            (email, name, generate_password_hash(password))
        )
        conn.commit()
        session.permanent = True
        session['user'] = {"email": email, "name": name}
        return jsonify({"success": True, "user": session['user']})
    except sqlite3.IntegrityError:
        return jsonify({"success": False, "message": "Account already registered with this email. Please log in."}), 400
    finally:
        conn.close()

@app.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password')

    if not email or not password:
        return jsonify({"success": False, "message": "Email and password are required."}), 400

    conn = get_db()
    try:
        cursor = conn.execute("SELECT * FROM users WHERE email = ?", (email,))
        user_row = cursor.fetchone()

        if not user_row or not check_password_hash(user_row['password_hash'], password):
            return jsonify({"success": False, "message": "Invalid email or password."}), 401

        session.permanent = True
        session['user'] = {"email": user_row['email'], "name": user_row['name']}
        return jsonify({"success": True, "user": session['user']})
    finally:
        conn.close()

@app.route('/api/auth/logout', methods=['POST'])
def api_logout():
    session.pop('user', None)
    return jsonify({"success": True})

# -------------------------------------------------------------------

# ANALYSIS API (Aliased to match frontend fetch calls)

# -------------------------------------------------------------------

@app.route('/api/analyze', methods=['POST'])
#@app.route('/api/v1/analyze', methods=['POST'])
def run_analysis():
    payload = request.get_json() or {}
    
    # Extract and sanitize years safely with fallback defaults
    try:
        start_year = int(payload.get('start_year', 2000))
        end_year = int(payload.get('end_year', 2025))
    except (ValueError, TypeError):
        start_year, end_year = 2000, 2025

    # Correctly map to the frontend payload key 'interval'[cite: 14]
    analysis_interval = payload.get('interval', 'yearly')

    # Extract user component preferences
    components = payload.get('components', {})
    want_lulc = components.get('lulc', True)
    want_lst = components.get('lst', True)
    want_suhi = components.get('suhi', True)
    want_graphs = components.get('graphs', True)

    # Resolve Geometry
    raw_coords = payload.get('polygon_coords')
    roi = None
    if raw_coords and isinstance(raw_coords, list) and len(raw_coords) > 0:
        while isinstance(raw_coords, list) and len(raw_coords) > 0 and isinstance(raw_coords[0][0], list):
            raw_coords = raw_coords[0]
        formatted_roi = []
        for pt in raw_coords:
            try:
                lon, lat = float(pt[0]), float(pt[1])
                if -180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0:
                    formatted_roi.append([lon, lat])
            except (ValueError, TypeError, IndexError):
                continue
        if len(formatted_roi) >= 3:
            if formatted_roi[0] != formatted_roi[-1]:
                formatted_roi.append(formatted_roi[0])
            roi = formatted_roi

    if not roi:
        region_name = payload.get('region_name', 'Gachibowli')
        roi = HYD_REGIONS.get(region_name, HYD_REGIONS['Gachibowli'])

    try:
        # Pass parameters including the correct interval to your processing backend
        gee_data = process_lulc_analysis(
            start_year=start_year,
            end_year=end_year,
            polygon_coords=roi,
            interval=analysis_interval
        )

        tile_urls = gee_data.get("tile_urls", {})
        statistics = gee_data.get("statistics", {})
        trends = gee_data.get("trends", {})

        # Filter out results based on user checkboxes
        filtered_tile_urls = {
            "lulc_start": tile_urls.get("lulc_start") if want_lulc else None,
            "lulc_end": tile_urls.get("lulc_end") if want_lulc else None,
            "lst_start": tile_urls.get("lst_start") if want_lst else None,
            "lst_end": tile_urls.get("lst_end") if want_lst else None
        }

        if not want_suhi:
            statistics.pop("suhi_intensity", None)

        filtered_trends = trends if want_graphs else {}

        return jsonify({
            "success": True,
            "parameters": {
                "start_year": start_year, 
                "end_year": end_year, 
                "interval": analysis_interval,
                "roi": roi
            },
            "tile_urls": filtered_tile_urls,
            "statistics": statistics,
            "trends": filtered_trends
        })

    except Exception as err:
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(err),
            "message": "Satellite processing failed on Google Earth Engine."
        }), 500



if __name__ == '__main__':
    # Running on port 8000 to match dashboard.js fetch targets
    app.run(debug=True, host='127.0.0.1', port=8000)