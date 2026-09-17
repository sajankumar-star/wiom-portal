from flask import Flask, request, jsonify, send_from_directory
import json, os, sqlite3, hashlib, urllib.request, urllib.parse, urllib.error
from functools import wraps

app = Flask(__name__, static_folder='static')

DB_PATH = os.environ.get('DB_PATH', 'portal_data.db')

# ─── DB INIT ───────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS store (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )''')
        conn.commit()

init_db()

# ─── API ───────────────────────────────────────────────────
@app.route('/api/get/<key>')
def api_get(key):
    with get_db() as conn:
        row = conn.execute('SELECT value FROM store WHERE key=?', (key,)).fetchone()
    if row:
        try:
            return jsonify({'ok': True, 'data': json.loads(row['value'])})
        except:
            return jsonify({'ok': True, 'data': row['value']})
    return jsonify({'ok': True, 'data': None})

@app.route('/api/set/<key>', methods=['POST'])
def api_set(key):
    value = request.get_json(force=True)
    with get_db() as conn:
        conn.execute('INSERT OR REPLACE INTO store (key,value) VALUES (?,?)',
                     (key, json.dumps(value)))
        conn.commit()
    return jsonify({'ok': True})

@app.route('/api/delete/<key>', methods=['DELETE'])
def api_delete(key):
    with get_db() as conn:
        conn.execute('DELETE FROM store WHERE key=?', (key,))
        conn.commit()
    return jsonify({'ok': True})

@app.route('/api/keys')
def api_keys():
    with get_db() as conn:
        rows = conn.execute('SELECT key FROM store').fetchall()
    return jsonify({'ok': True, 'keys': [r['key'] for r in rows]})

# ─── KEKA HRMS SYNC ────────────────────────────────────────
# Credentials come ONLY from environment variables (set these in Railway).
KEKA_CLIENT_ID     = os.environ.get('KEKA_CLIENT_ID', '')
KEKA_CLIENT_SECRET = os.environ.get('KEKA_CLIENT_SECRET', '')
KEKA_API_KEY       = os.environ.get('KEKA_API_KEY', '')
KEKA_BASE          = os.environ.get('KEKA_BASE', 'https://omniainformation.keka.com/api/v1')
KEKA_LAPTOP_TYPE   = os.environ.get('KEKA_LAPTOP_TYPE_ID', '9992eb42-d8ab-4d7e-9a1b-183e951eedab')

def _keka_token():
    body = urllib.parse.urlencode({
        'grant_type': 'kekaapi', 'scope': 'kekaapi',
        'client_id': KEKA_CLIENT_ID, 'client_secret': KEKA_CLIENT_SECRET, 'api_key': KEKA_API_KEY,
    }).encode()
    req = urllib.request.Request('https://login.keka.com/connect/token', data=body,
                                 headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode()).get('access_token')
    except urllib.error.HTTPError as e:
        detail = ''
        try:
            detail = e.read().decode()[:400]
        except Exception:
            pass
        raise Exception('Keka token %s @ %s :: %s' % (e.code, req.full_url, detail))

def _keka_get_all(path, token):
    out, page = [], 1
    while True:
        url = '%s/%s?pageNumber=%d&pageSize=100' % (KEKA_BASE, path, page)
        req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token,
                                                   'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.loads(r.read().decode())
        if not d.get('succeeded') or not d.get('data'):
            break
        out += d['data']
        if page >= (d.get('totalPages') or 1):
            break
        page += 1
    return out

def _txt(v):
    # Keka fields can be a plain string or an object like {id,title}/{id,name}
    if isinstance(v, dict):
        return v.get('title') or v.get('name') or ''
    return v or ''

def _store_get(key, default):
    with get_db() as conn:
        row = conn.execute('SELECT value FROM store WHERE key=?', (key,)).fetchone()
    if not row:
        return default
    try:
        return json.loads(row['value'])
    except:
        return default

def _store_set(key, value):
    with get_db() as conn:
        conn.execute('INSERT OR REPLACE INTO store (key,value) VALUES (?,?)', (key, json.dumps(value)))
        conn.commit()

@app.route('/api/keka-sync', methods=['POST'])
def api_keka_sync():
    """Pull employees + assets from Keka HRMS and merge into the portal store."""
    if not (KEKA_CLIENT_ID and KEKA_CLIENT_SECRET and KEKA_API_KEY):
        return jsonify({'ok': False, 'error': 'Keka credentials set nahi hain. Railway me '
                        'KEKA_CLIENT_ID, KEKA_CLIENT_SECRET, KEKA_API_KEY environment variables add karein.'}), 400
    try:
        # Fetch Keka data via the helpdesk proxy. The portal's own server IP is blocked
        # by Keka's firewall, but the helpdesk's IP is allowed — so we ask it to fetch.
        errors = []
        proxy_url = os.environ.get('HELPDESK_PROXY_URL',
                                   'https://wiom-helpdesk-production.up.railway.app/api/agent/keka-proxy')
        try:
            _body = json.dumps({'clientId': KEKA_CLIENT_ID, 'clientSecret': KEKA_CLIENT_SECRET,
                                'apiKey': KEKA_API_KEY}).encode()
            _preq = urllib.request.Request(proxy_url, data=_body,
                                           headers={'Content-Type': 'application/json',
                                                    'x-agent-key': os.environ.get('AGENT_SECRET', '')})
            with urllib.request.urlopen(_preq, timeout=180) as _r:
                _pd = json.loads(_r.read().decode())
        except Exception as e:
            return jsonify({'ok': False, 'error': 'helpdesk proxy call failed: ' + str(e)}), 502
        if not _pd.get('ok'):
            return jsonify({'ok': False, 'error': 'helpdesk proxy: ' + str(_pd.get('error') or _pd)}), 502
        emps_raw = _pd.get('employees') or []
        assets_raw = _pd.get('assets') or []

        # ── Employees → {name, wiomId, dept, designation, email, phone, manager...} ──
        def _group_title(emp_obj, gtype):
            # Keka tags each group with a numeric groupType:
            #   1 = Business Unit, 2 = Department, 3 = Location, 5 = Pay group.
            for g in (emp_obj.get('groups') or []):
                if isinstance(g, dict) and g.get('groupType') == gtype:
                    return g.get('title') or g.get('name') or ''
            return ''

        def _dept_of(emp_obj):
            return _txt(emp_obj.get('department')) or _group_title(emp_obj, 2)

        def _mgr_name(mgr_obj):
            if not isinstance(mgr_obj, dict):
                return ''
            fl = ('%s %s' % (mgr_obj.get('firstName') or '', mgr_obj.get('lastName') or '')).strip()
            return (mgr_obj.get('name') or mgr_obj.get('displayName') or mgr_obj.get('fullName') or fl or '')

        by_email, emp_map = {}, {}
        for e in emps_raw:
            num = str(e.get('employeeNumber') or '').strip()
            if not num or num == '01':
                continue
            email = (e.get('email') or '').lower()
            name  = e.get('displayName') or ('%s %s' % (e.get('firstName') or '', e.get('lastName') or '')).strip()
            mgr   = e.get('reportsTo') or e.get('reportingManager') or e.get('reportingTo') or e.get('l2Manager') or e.get('manager') or {}
            if not isinstance(mgr, dict):
                mgr = {}
            emp = {
                'id': 'KEKA-' + num, 'name': name, 'wiomId': num,
                'dept': _dept_of(e), 'designation': _txt(e.get('jobTitle')),
                'location': _group_title(e, 3),
                'email': email,
                'phone': e.get('mobilePhone') or e.get('workPhone') or e.get('phoneNumber') or '',
                'managerName': _mgr_name(mgr),
                'managerEmail': mgr.get('email') or '',
                'joinDate': e.get('joiningDate') or e.get('dateJoined') or '',
                'status': 'Active' if e.get('employmentStatus') == 0 else 'Inactive',
            }
            emp_map[num] = emp
            if email:
                by_email[email] = emp

        existing_emps = _store_get('wiom_keka_employees', [])
        merged_emps = {str(x.get('wiomId') or x.get('id') or i): x for i, x in enumerate(existing_emps)}
        merged_emps.update(emp_map)
        employees_out = list(merged_emps.values())

        # ── Assets → portal asset shape ──
        TYPE_MAP = {KEKA_LAPTOP_TYPE: ('LAPTOPS', 'Laptop')}
        keka_assets = []
        for a in assets_raw:
            at = a.get('assignedTo') if isinstance(a.get('assignedTo'), dict) else {}
            a_email = (at.get('email') or '').lower()
            a_name  = at.get('name') or at.get('displayName') or ''
            if not a_name and a_email in by_email:
                a_name = by_email[a_email]['name']
            emp = by_email.get(a_email, {})
            type_name = _txt(a.get('assetType'))
            cat, typ = TYPE_MAP.get(a.get('assetTypeId'), ('OTHER', type_name or 'Other'))
            serial = a.get('assetId') or a.get('serialNumber') or ''
            keka_assets.append({
                'id': 'KEKA-A-' + str(a.get('id') or serial or len(keka_assets)),
                'name': a.get('assetName') or a.get('name') or 'Asset',
                'assetId': serial, 'serial': serial, 'category': cat, 'type': typ,
                'location': _txt(a.get('location')) or emp.get('location', ''), 'condition': 'Good',
                'status': 'Assigned' if a_name else 'Available',
                'ack': 'Not Applicable', 'assignedTo': a_name,
                'wiomId': emp.get('wiomId', ''), 'dept': emp.get('dept', ''), 'empEmail': a_email,
                'managerName': emp.get('managerName', ''), 'managerEmail': emp.get('managerEmail', ''),
                'vendor': '', 'invoice': '',
                'purchased': a.get('purchaseDate') or a.get('purchasedOn') or '',
                'warranty': a.get('warrantyExpiryDate') or a.get('warrantyExpiry') or '',
            })

        existing_assets = _store_get('wiom_keka_assets', [])
        def _akey(x):
            return ('sn:' + x['assetId']) if x.get('assetId') else ('nm:' + (x.get('name') or ''))
        merged_assets = {_akey(x): x for x in existing_assets}
        for a in keka_assets:
            merged_assets[_akey(a)] = a
        assets_out = list(merged_assets.values())

        _store_set('wiom_keka_employees', employees_out)
        _store_set('wiom_keka_assets', assets_out)

        return jsonify({
            'ok': True,
            'employees': len(employees_out), 'employeesFromKeka': len(emp_map),
            'assets': len(assets_out), 'assetsFromKeka': len(keka_assets),
            'errors': errors,
            '_debug': {
                'empSampleKeys': list(emps_raw[0].keys()) if emps_raw else [],
                'assetSampleKeys': list(assets_raw[0].keys()) if assets_raw else [],
            },
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500

# ─── DEBUG: outbound (egress) IP — to whitelist in Keka ─────
@app.route('/api/myip')
def api_myip():
    out = {}
    for name, url in (('ipify', 'https://api.ipify.org'),
                      ('aws', 'https://checkip.amazonaws.com')):
        try:
            with urllib.request.urlopen(url, timeout=10) as r:
                out[name] = r.read().decode().strip()
        except Exception as e:
            out[name] = 'err: ' + str(e)
    return jsonify(out)

# ─── SERVE PORTAL ──────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('static', path)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, threaded=True)
