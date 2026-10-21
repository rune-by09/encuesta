const express = require('express');
const { Pool } = require('pg');
const path = require('path');

/* ---------- 1. CONEXIÓN (los datos secretos vienen de variables, no se escriben aquí) ---------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const CLAVE_ADMIN = process.env.CLAVE_ADMIN;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

pool.query('SELECT 1')
  .then(() => console.log('Conectado a PostgreSQL'))
  .catch(err => console.log('Error de conexión:', err.message));

/* ---------- 2. ¿Ya contestó esta matrícula? ---------- */
app.get('/api/existe/:matricula', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT COUNT(*)::int AS total FROM usuarios WHERE matricula = $1',
      [req.params.matricula]);
    res.json({ existe: r.rows[0].total > 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- 3. Guardar usuario y sus 20 respuestas ---------- */
app.post('/api/guardar', async (req, res) => {
  const { nombre, matricula, respuestas } = req.body;

  if (typeof nombre !== 'string' || nombre.trim() === '' || nombre.trim().length > 60 ||
      !/^[0-9]{6,10}$/.test(matricula) ||
      !Array.isArray(respuestas) || respuestas.length !== 20 ||
      !respuestas.every(n => Number.isInteger(n) && n >= 0 && n <= 3)) {
    return res.status(400).json({ error: 'Datos inválidos' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const u = await client.query(
      'INSERT INTO usuarios (nombre, matricula) VALUES ($1, $2) RETURNING id_usuario',
      [nombre.trim(), matricula]);
    const idUsuario = u.rows[0].id_usuario;

    for (let i = 0; i < 20; i++) {
      const r = await client.query(
        `INSERT INTO respuestas (id_usuario, id_pregunta, id_opcion)
         SELECT $1, $2, id_opcion FROM opciones
         WHERE id_pregunta = $2 AND numero = $3`,
        [idUsuario, i + 1, respuestas[i]]);
      if (r.rowCount !== 1) throw new Error('Respuesta no válida en la pregunta ' + (i + 1));
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(409).json({ error: 'Matrícula repetida' });
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

/* ---------- 4. Gráficas (solo con la contraseña del administrador) ---------- */
app.get('/api/resultados', async (req, res) => {
  if (!CLAVE_ADMIN || req.headers['x-clave'] !== CLAVE_ADMIN) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }
  try {
    const votos = await pool.query(
      'SELECT id_pregunta, opcion_numero, votos FROM vw_resultados ORDER BY id_pregunta, opcion_numero');
    const total = await pool.query('SELECT COUNT(*)::int AS total FROM usuarios');
    res.json({ total: total.rows[0].total, votos: votos.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ---------- 5. Encender el servidor ---------- */
const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => console.log('Servidor en puerto ' + PUERTO));