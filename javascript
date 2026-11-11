/* ============================================================
   SISTEMA BIBLIOTECA — ARQUIVO ÚNICO
   Backend Express + PostgreSQL + Frontend React (CDN)
   ============================================================ */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  database: process.env.DB_NAME || 'biblioteca',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const app = express();
app.use(cors());
app.use(express.json());

/* ============================================================
   SCHEMA + INICIALIZAÇÃO
   ============================================================ */
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

/* ============================================================
   AUTH MIDDLEWARE
   ============================================================ */
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

/* ============================================================
   ROTAS: LOGIN
   ============================================================ */
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

/* ============================================================
   ROTAS: LIVROS
   ============================================================ */
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

/* ============================================================
   ROTAS: USUÁRIOS
   ============================================================ */
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

/* ============================================================
   ROTAS: EMPRÉSTIMOS
   ============================================================ */
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

/* ============================================================
   DASHBOARD
   ============================================================ */
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

/* ============================================================
   FRONTEND — HTML, CSS E JS EM STRINGS SEPARADAS
   (evita problema de template literal aninhado)
   ============================================================ */
const CSS = [
  '*{box-sizing:border-box;font-family:system-ui,sans-serif}',
  'body{margin:0;background:#f4f6f9;color:#2c3e50}',
  'header{background:#2c3e50;color:#fff;padding:12px 24px;display:flex;justify-content:space-between;align-items:center}',
  'header h1{font-size:18px;margin:0}',
  'header button{background:#e74c3c;color:#fff;border:0;padding:8px 14px;border-radius:6px;cursor:pointer}',
  '.container{max-width:1100px;margin:20px auto;padding:0 16px}',
  '.card{background:#fff;border-radius:8px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}',
  '.row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}',
  'input,select,button{padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:14px}',
  'button{background:#3498db;color:#fff;border:0;cursor:pointer}',
  'button:hover{background:#2980b9}',
  'button.danger{background:#e74c3c}',
  'button.danger:hover{background:#c0392b}',
  'button.success{background:#27ae60}',
  'button.success:hover{background:#219150}',
  'table{width:100%;border-collapse:collapse}',
  'th,td{padding:8px;text-align:left;border-bottom:1px solid #eee;font-size:14px}',
  'th{background:#ecf0f1}',
  '.tabs{display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap}',
  '.tabs button{background:#bdc3c7}',
  '.tabs button.active{background:#2c3e50}',
  '.erro{color:#c0392b;font-size:13px;margin-top:6px}',
  '.ok{color:#27ae60;font-size:13px;margin-top:6px}',
  '.badge{padding:2px 8px;border-radius:10px;font-size:12px;display:inline-block}',
  '.badge.atrasado{background:#fdecea;color:#c0392b}',
  '.badge.ativo{background:#eafaf1;color:#27ae60}',
  '.badge.devolvido{background:#ecf0f1;color:#7f8c8d}',
  '.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}',
  '.stat{background:#fff;padding:16px;border-radius:8px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.1)}',
  '.stat .num{font-size:28px;font-weight:bold;color:#2c3e50}',
  '.stat .label{font-size:13px;color:#7f8c8d}',
].join('\n');

const HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Biblioteca</title>
<style>${CSS}</style>
</head>
<body>
<div id="root"></div>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="/app.js"></script>
</body>
</html>`;

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(HTML);
});

/* ============================================================
   APP.JS (FRONTEND EM REACT PURO SEM JSX)
   ============================================================ */
const APP_JS = `
const { useState, useEffect, useCallback, createElement: h } = React;

async function apiRequest(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = 'Bearer ' + token;

  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.reload();
    return;
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.erro) || 'Erro na requisicao');
  return data;
}

const api = {
  get: (p) => apiRequest('GET', p),
  post: (p, b) => apiRequest('POST', p, b),
  put: (p, b) => apiRequest('PUT', p, b),
  del: (p) => apiRequest('DELETE', p),
};

/* ---------- LOGIN ---------- */
function Login(props) {
  const [email, setEmail] = useState('admin@biblio.com');
  const [senha, setSenha] = useState('admin123');
  const [erro, setErro] = useState('');

  async function submit(e) {
    e.preventDefault();
    setErro('');
    try {
      const data = await api.post('/auth/login', { email: email, senha: senha });
      localStorage.setItem('token', data.token);
      props.onLogin();
    } catch (err) {
      setErro(err.message);
    }
  }

  return h('div', { className: 'card', style: { maxWidth: 360, margin: '80px auto' } },
    h('h2', null, 'Login Biblioteca'),
    h('form', { onSubmit: submit },
      h('div', { className: 'row' },
        h('input', {
          placeholder: 'Email', value: email,
          onChange: function (e) { setEmail(e.target.value); },
          style: { flex: 1 }
        })
      ),
      h('div', { className: 'row' },
        h('input', {
          type: 'password', placeholder: 'Senha', value: senha,
          onChange: function (e) { setSenha(e.target.value); },
          style: { flex: 1 }
        })
      ),
      h('button', { type: 'submit', style: { width: '100%' } }, 'Entrar'),
      erro ? h('div', { className: 'erro' }, erro) : null,
      h('div', { style: { fontSize: 12, color: '#888', marginTop: 10 } },
        'Padrao: admin@biblio.com / admin123')
    )
  );
}

/* ---------- LIVROS ---------- */
function AbaLivros() {
  const [livros, setLivros] = useState([]);
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState({ titulo: '', autor: '', isbn: '', ano: '', categoria: '', quantidade_total: 1 });
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');

  const carregar = useCallback(async function () {
    try {
      const q = busca ? '?q=' + encodeURIComponent(busca) : '';
      setLivros(await api.get('/livros' + q));
    } catch (e) { setErro(e.message); }
  }, [busca]);

  useEffect(function () { carregar(); }, [carregar]);

  async function salvar(e) {
    e.preventDefault();
    setErro(''); setOk('');
    try {
      const payload = Object.assign({}, form, {
        ano: form.ano ? Number(form.ano) : null,
        quantidade_total: Number(form.quantidade_total) || 1,
      });
      await api.post('/livros', payload);
      setForm({ titulo: '', autor: '', isbn: '', ano: '', categoria: '', quantidade_total: 1 });
      setOk('Livro cadastrado!');
      carregar();
    } catch (err) { setErro(err.message); }
  }

  async function excluir(id) {
    if (!confirm('Excluir livro?')) return;
    try { await api.del('/livros/' + id); carregar(); }
    catch (err) { setErro(err.message); }
  }

  function set(campo) {
    return function (e) {
      const novo = Object.assign({}, form);
      novo[campo] = e.target.value;
      setForm(novo);
    };
  }

  return h('div', null,
    h('div', { className: 'card' },
      h('h3', null, 'Novo Livro'),
      h('form', { onSubmit: salvar },
        h('div', { className: 'row' },
          h('input', { placeholder: 'Titulo*', value: form.titulo, required: true, onChange: set('titulo') }),
          h('input', { placeholder: 'Autor*', value: form.autor, required: true, onChange: set('autor') }),
          h('input', { placeholder: 'ISBN', value: form.isbn, onChange: set('isbn') })
        ),
        h('div', { className: 'row' },
          h('input', { type: 'number', placeholder: 'Ano', value: form.ano, onChange: set('ano') }),
          h('input', { placeholder: 'Categoria', value: form.categoria, onChange: set('categoria') }),
          h('input', { type: 'number', min: 1, value: form.quantidade_total, onChange: set('quantidade_total'), title: 'Exemplares' }),
          h('button', { type: 'submit' }, 'Cadastrar')
        ),
        erro ? h('div', { className: 'erro' }, erro) : null,
        ok ? h('div', { className: 'ok' }, ok) : null
      )
    ),
    h('div', { className: 'card' },
      h('div', { className: 'row' },
        h('input', {
          placeholder: 'Buscar por titulo, autor ou ISBN...',
          value: busca, onChange: function (e) { setBusca(e.target.value); }, style: { flex: 1 }
        }),
        h('button', { onClick: carregar }, 'Buscar')
      ),
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', null, 'ID'), h('th', null, 'Titulo'), h('th', null, 'Autor'),
          h('th', null, 'ISBN'), h('th', null, 'Disp/Total'), h('th', null, '')
        )),
        h('tbody', null,
          livros.map(function (l) {
            return h('tr', { key: l.id },
              h('td', null, l.id),
              h('td', null, l.titulo),
              h('td', null, l.autor),
              h('td', null, l.isbn || '-'),
              h('td', null, l.disponiveis + '/' + l.total_exemplares),
              h('td', null, h('button', { className: 'danger', onClick: function () { excluir(l.id); } }, 'Excluir'))
            );
          })
        )
      )
    )
  );
}

/* ---------- USUARIOS ---------- */
function AbaUsuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [form, setForm] = useState({ nome: '', email: '', cpf: '', telefone: '' });
  const [erro, setErro] = useState('');

  const carregar = useCallback(async function () {
    try { setUsuarios(await api.get('/usuarios')); }
    catch (e) { setErro(e.message); }
  }, []);

  useEffect(function () { carregar(); }, [carregar]);

  async function salvar(e) {
    e.preventDefault();
    setErro('');
    try {
      await api.post('/usuarios', form);
      setForm({ nome: '', email: '', cpf: '', telefone: '' });
      carregar();
    } catch (err) { setErro(err.message); }
  }

  async function excluir(id) {
    if (!confirm('Excluir usuario?')) return;
    try { await api.del('/usuarios/' + id); carregar(); }
    catch (err) { setErro(err.message); }
  }

  function set(campo) {
    return function (e) {
      const novo = Object.assign({}, form);
      novo[campo] = e.target.value;
      setForm(novo);
    };
  }

  return h('div', null,
    h('div', { className: 'card' },
      h('h3', null, 'Novo Usuario'),
      h('form', { onSubmit: salvar },
        h('div', { className: 'row' },
          h('input', { placeholder: 'Nome*', value: form.nome, required: true, onChange: set('nome') }),
          h('input', { placeholder: 'Email*', value: form.email, required: true, onChange: set('email') })
        ),
        h('div', { className: 'row' },
          h('input', { placeholder: 'CPF*', value: form.cpf, required: true, onChange: set('cpf') }),
          h('input', { placeholder: 'Telefone', value: form.telefone, onChange: set('telefone') }),
          h('button', { type: 'submit' }, 'Cadastrar')
        ),
        erro ? h('div', { className: 'erro' }, erro) : null
      )
    ),
    h('div', { className: 'card' },
      h('table', null,
        h('thead', null, h('tr', null,
          h('th', null, 'ID'), h('th', null, 'Nome'), h('th', null, 'Email'),
          h('th', null, 'CPF'), h('th', null, 'Telefone'), h('th', null, '')
        )),
        h('tbody', null,
          usuarios.map(function (u) {
            return h('tr', { key: u.id },
              h('td', null, u.id),
              h('td', null, u.nome),
              h('td', null, u.email),
              h('td', null, u.cpf),
              h('td', null, u.telefone || '-'),
              h('td', null, h('button', { className: 'danger', onClick: function () { excluir(u.id); } }, 'Excluir'))
            );
          })
        )
      )
    )
  );
}

/* ---------- EMPRESTIMOS ---------- */
function AbaEmprestimos() {
  const [emprestimos, setEmprestimos] = useState([]);
  const [usuarios, setUsuarios] = useState([]);
  const [livros, setLivros] = useState([]);
  const [exemplares, setExemplares] = useState([]);
  const [usuarioId, setUsuarioId] = useState('');
  const [livroId, setLivroId] = useState('');
  const [exemplarId, setExemplarId] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');

  const carregarBase = useCallback(async function () {
    try {
      const r = await Promise.all([
        api.get('/emprestimos'), api.get('/usuarios'), api.get('/livros')
      ]);
      setEmprestimos(r[0]); setUsuarios(r[1]); setLivros(r[2]);
    } catch (e) { setErro(e.message); }
  }, []);

  useEffect(function () { carregarBase(); }, [carregarBase]);

  useEffect(function () {
    if (!livroId) { setExemplares([]); setExemplarId(''); return; }
    api.get('/livros/' + livroId + '/exemplares')
      .then(function (r) { setExemplares(r); })
      .catch(function () {});
    setExemplarId('');
  }, [livroId]);

  async function emprestar(e) {
    e.preventDefault();
    setErro(''); setOk('');
    try {
      await api.post('/emprestimos', {
        usuario_id: Number(usuarioId),
        exemplar_id: Number(exemplarId),
      });
      setOk('Emprestimo registrado!');
      setUsuarioId(''); setLivroId(''); setExemplarId('');
      carregarBase();
    } catch (err) { setErro(err.message); }
  }

  async function devolver(id) {
    if (!confirm('Registrar devolucao?')) return;
    try { await api.put('/emprestimos/' + id + '/devolucao', {}); carregarBase(); }
    catch (err) { setErro(err.message); }
  }

  function dataCurta(d) { return d ? String(d).slice(0, 10) : '-'; }

  function badge(emp) {
    if (emp.status === 'DEVOLVIDO') return h('span', { className: 'badge devolvido'
