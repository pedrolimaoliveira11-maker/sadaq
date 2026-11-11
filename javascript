require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  database: process.env.DB_NAME || 'biblioteca',
  // Cloud (Render/Neon/Supabase) exige SSL:
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- Criação automática das tabelas ---------- */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS livro (
  id SERIAL PRIMARY KEY,
  titulo VARCHAR(200) NOT NULL,
  autor VARCHAR(150) NOT NULL,
  isbn VARCHAR(20) UNIQUE,
  ano INT,
  categoria VARCHAR(80),
  quantidade_total INT NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS exemplar (
  id SERIAL PRIMARY KEY,
  livro_id INT NOT NULL REFERENCES livro(id) ON DELETE CASCADE,
  codigo_tombo VARCHAR(30) UNIQUE NOT NULL,
  status VARCHAR(15) NOT NULL DEFAULT 'DISPONIVEL'
    CHECK (status IN ('DISPONIVEL','EMPRESTADO'))
);
CREATE TABLE IF NOT EXISTS usuario (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  cpf VARCHAR(14) UNIQUE NOT NULL,
  telefone VARCHAR(20),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS emprestimo (
  id SERIAL PRIMARY KEY,
  exemplar_id INT NOT NULL REFERENCES exemplar(id),
  usuario_id INT NOT NULL REFERENCES usuario(id),
  data_emprestimo DATE NOT NULL DEFAULT CURRENT_DATE,
  data_prevista DATE NOT NULL,
  data_devolucao DATE,
  status VARCHAR(15) NOT NULL DEFAULT 'ATIVO'
    CHECK (status IN ('ATIVO','DEVOLVIDO','ATRASADO'))
);
CREATE TABLE IF NOT EXISTS bibliotecario (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  senha_hash VARCHAR(255) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emp_status ON emprestimo(status);
CREATE INDEX IF NOT EXISTS idx_emp_usuario ON emprestimo(usuario_id);
CREATE INDEX IF NOT EXISTS idx_ex_livro ON exemplar(livro_id);
`;

async function initDatabase() {
  try {
    await pool.query(SCHEMA);
    const adm = await pool.query("SELECT id FROM bibliotecario WHERE email='admin@biblio.com'");
    if (adm.rowCount === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await pool.query(
        'INSERT INTO bibliotecario (nome, email, senha_hash) VALUES ($1,$2,$3)',
        ['Administrador', 'admin@biblio.com', hash]
      );
      console.log('👤 Admin criado: admin@biblio.com / admin123');
    }
    console.log('✅ Banco pronto');
  } catch (e) {
    console.error('❌ Erro no banco:', e.message);
    process.exit(1);
  }
}

/* ---------- Auth middleware ---------- */
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ erro: 'Token ausente' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido' });
  }
}

/* ---------- AUTH ---------- */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body || {};
    if (!email || !senha) return res.status(400).json({ erro: 'Email e senha obrigatórios' });
    const { rows } = await pool.query('SELECT * FROM bibliotecario WHERE email=$1', [email]);
    const bib = rows[0];
    if (!bib) return res.status(401).json({ erro: 'Credenciais inválidas' });
    const ok = await bcrypt.compare(senha, bib.senha_hash);
    if (!ok) return res.status(401).json({ erro: 'Credenciais inválidas' });
    const token = jwt.sign({ id: bib.id, nome: bib.nome }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, nome: bib.nome });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

/* ---------- LIVROS ---------- */
app.get('/api/livros', auth, async (req, res) => {
  try {
    const { q } = req.query;
    let sql = `
      SELECT l.*,
        (SELECT COUNT(*) FROM exemplar e WHERE e.livro_id=l.id AND e.status='DISPONIVEL') AS disponiveis,
        (SELECT COUNT(*) FROM exemplar e WHERE e.livro_id=l.id) AS total_exemplares
      FROM livro l`;
    const p = [];
    if (q) { sql += ' WHERE l.titulo ILIKE $1 OR l.autor ILIKE $1 OR l.isbn=$2'; p.push('%'+q+'%', q); }
    sql += ' ORDER BY l.id DESC';
    const { rows } = await pool.query(sql, p);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro interno' }); }
});

app.post('/api/livros', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { titulo, autor, isbn, ano, categoria, quantidade_total } = req.body || {};
    if (!titulo || !autor) return res.status(400).json({ erro: 'Título e autor obrigatórios' });
    const qtd = Math.max(1, Number(quantidade_total) || 1);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO livro (titulo,autor,isbn,ano,categoria,quantidade_total)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [titulo, autor, isbn || null, ano || null, categoria || null, qtd]
    );
    const livro = rows[0];
    for (let i = 1; i <= qtd; i++) {
      await client.query(
        'INSERT INTO exemplar (livro_id,codigo_tombo) VALUES ($1,$2)',
        [livro.id, 'L' + livro.id + '-' + String(i).padStart(3, '0')]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(livro);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(400).json({ erro: 'ISBN já cadastrado' });
    console.error(e); res.status(500).json({ erro: 'Erro interno' });
  } finally { client.release(); }
});

app.delete('/api/livros/:id', auth, async (req, res) => {
  try {
    const at = await pool.query(
      `SELECT 1 FROM emprestimo e JOIN exemplar ex ON ex.id=e.exemplar_id
       WHERE ex.livro_id=$1 AND e.status='ATIVO' LIMIT 1`, [req.params.id]
    );
    if (at.rowCount > 0) return res.status(400).json({ erro: 'Existem empréstimos ativos deste livro' });
    await pool.query('DELETE FROM livro WHERE id=$1', [req.params.id]);
    res.status(204).send();
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro interno' }); }
});

app.get('/api/livros/:id/exemplares', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM exemplar WHERE livro_id=$1 ORDER BY id', [req.params.id]
    );
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro interno' }); }
});

/* ---------- USUÁRIOS ---------- */
app.get('/api/usuarios', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM usuario ORDER BY id DESC');
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro interno' }); }
});

app.post('/api/usuarios', auth, async (req, res) => {
  try {
    const { nome, email, cpf, telefone } = req.body || {};
    if (!nome || !email || !cpf) return res.status(400).json({ erro: 'Nome, email e CPF obrigatórios' });
    const { rows } = await pool.query(
      'INSERT INTO usuario (nome,email,cpf,telefone) VALUES ($1,$2,$3,$4) RETURNING *',
      [nome, email, cpf, telefone || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ erro: 'Email ou CPF já cadastrado' });
    console.error(e); res.status(500).json({ erro: 'Erro interno' });
  }
});

app.delete('/api/usuarios/:id', auth, async (req, res) => {
  try {
    const at = await pool.query(
      "SELECT 1 FROM emprestimo WHERE usuario_id=$1 AND status='ATIVO' LIMIT 1",
      [req.params.id]
    );
    if (at.rowCount > 0) return res.status(400).json({ erro: 'Usuário possui empréstimos ativos' });
    await pool.query('DELETE FROM usuario WHERE id=$1', [req.params.id]);
    res.status(204).send();
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro interno' }); }
});

/* ---------- EMPRÉSTIMOS ---------- */
app.get('/api/emprestimos', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT e.*, u.nome AS usuario_nome, ex.codigo_tombo, l.titulo AS livro_titulo,
             (e.status='ATIVO' AND e.data_prevista < CURRENT_DATE) AS atrasado
      FROM emprestimo e
      JOIN usuario u ON u.id=e.usuario_id
      JOIN exemplar ex ON ex.id=e.exemplar_id
      JOIN livro l ON l.id=ex.livro_id
      ORDER BY e.id DESC`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro interno' }); }
});

app.post('/api/emprestimos', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { usuario_id, exemplar_id } = req.body || {};
    if (!usuario_id || !exemplar_id) return res.status(400).json({ erro: 'Usuário e exemplar obrigatórios' });
    await client.query('BEGIN');

    const u = await client.query('SELECT ativo FROM usuario WHERE id=$1', [usuario_id]);
    if (u.rowCount === 0 || !u.rows[0].ativo) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Usuário inválido ou inativo' });
    }

    const at = await client.query(
      `SELECT 1 FROM emprestimo
       WHERE usuario_id=$1 AND status='ATIVO' AND data_prevista < CURRENT_DATE LIMIT 1`,
      [usuario_id]
    );
    if (at.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Usuário possui empréstimo atrasado' });
    }

    const ex = await client.query('SELECT status FROM exemplar WHERE id=$1 FOR UPDATE', [exemplar_id]);
    if (ex.rowCount === 0 || ex.rows[0].status !== 'DISPONIVEL') {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Exemplar indisponível' });
    }

    const { rows } = await client.query(
      `INSERT INTO emprestimo (exemplar_id,usuario_id,data_prevista)
       VALUES ($1,$2,CURRENT_DATE + INTERVAL '14 days') RETURNING *`,
      [exemplar_id, usuario_id]
    );
    await client.query("UPDATE exemplar SET status='EMPRESTADO' WHERE id=$1", [exemplar_id]);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e); res.status(500).json({ erro: 'Erro interno' });
  } finally { client.release(); }
});

app.put('/api/emprestimos/:id/devolucao', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE emprestimo SET data_devolucao=CURRENT_DATE, status='DEVOLVIDO'
       WHERE id=$1 AND status='ATIVO' RETURNING *`,
      [req.params.id]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Empréstimo ativo não encontrado' });
    }
    await client.query("UPDATE exemplar SET status='DISPONIVEL' WHERE id=$1", [rows[0].exemplar_id]);
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e); res.status(500).json({ erro: 'Erro interno' });
  } finally { client.release(); }
});

/* ---------- DASHBOARD ---------- */
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM livro) AS livros,
        (SELECT COUNT(*) FROM usuario) AS usuarios,
        (SELECT COUNT(*) FROM emprestimo WHERE status='ATIVO') AS emprestimos_ativos,
        (SELECT COUNT(*) FROM emprestimo WHERE status='ATIVO' AND data_prevista<CURRENT_DATE) AS atrasados`);
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro interno' }); }
});

/* ---------- Fallback SPA ---------- */
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ---------- Iniciar ---------- */
const PORT = process.env.PORT || 3000;
initDatabase().then(() => {
  app.listen(PORT, () => console.log('🚀 http://localhost:' + PORT));
});
