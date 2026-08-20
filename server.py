from flask import Flask, request, jsonify, send_from_directory
import json, os, sqlite3, hashlib
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

# ─── SERVE PORTAL ──────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('static', path)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)
