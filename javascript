/* ============================================================================
   SISTEMA DE GESTÃO DE BIBLIOTECA
   Arquivo único: backend Express + PostgreSQL + Frontend React (CDN)
   ============================================================================ */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

/* ========================== CONEXÃO ========================== */
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  database: process.env.DB_NAME || 'biblioteca',
});

/* ========================== APP ========================== */
const app = express();
app.use(cors());
app.use(express.json());

/* ========================== SQL EMBUTIDO ========================== */
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
CREATE INDEX IF NOT EXISTS idx_emprestimo_status ON emprestimo(status);
CREATE INDEX IF NOT EXISTS idx_emprestimo_usuario ON emprestimo(usuario_id);
CREATE INDEX IF NOT EXISTS idx_exemplar_livro ON exemplar(livro_id);
`;

/* ========================== BOOTSTRAP DO BANCO ========================== */
async function initDatabase() {
  try {
    await pool.query(SCHEMA);
    // Cria admin padrão se não existir
    const admin = await pool.query(
      "SELECT id FROM bibliotecario WHERE email = 'admin@biblio.com'"
    );
    if (admin.rowCount === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await pool.query(
        `INSERT INTO bibliotecario (nome, email, senha_hash)
         VALUES ('Administrador', 'admin@biblio.com', $1)`,
        [hash]
      );
      console.log('👤 Admin criado: admin@biblio.com / admin123');
    }
    console.log('✅ Banco inicializado');
  } catch (e) {
    console.error('❌ Erro ao inicializar banco:', e.message);
    process.exit(1);
  }
}

/* ========================== AUTH MIDDLEWARE ========================== */
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const [, token] = header.split(' ');
  if (!token) return res.status(401).json({ erro: 'Token ausente' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado' });
  }
}

/* ========================== ROTAS: AUTH ========================== */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro: 'Email e senha obrigatórios' });
    const { rows } = await pool.query('SELECT * FROM bibliotecario WHERE email = $1', [email]);
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

/* ========================== ROTAS: LIVROS ========================== */
app.get('/api/livros', auth, async (req, res) => {
  try {
    const { q } = req.query;
    let sql = `
      SELECT l.*,
        (SELECT COUNT(*) FROM exemplar e WHERE e.livro_id = l.id AND e.status = 'DISPONIVEL') AS disponiveis,
        (SELECT COUNT(*) FROM exemplar e WHERE e.livro_id = l.id) AS total_exemplares
      FROM livro l`;
    const params = [];
    if (q) {
      sql += ' WHERE l.titulo ILIKE $1 OR l.autor ILIKE $1 OR l.isbn = $2';
      params.push(`%${q}%`, q);
    }
    sql += ' ORDER BY l.id DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

app.post('/api/livros', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { titulo, autor, isbn, ano, categoria, quantidade_total } = req.body;
    if (!titulo || !autor) return res.status(400).json({ erro: 'Título e autor obrigatórios' });
    const qtd = Math.max(1, Number(quantidade_total) || 1);
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO livro (titulo, autor, isbn, ano, categoria, quantidade_total)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [titulo, autor, isbn || null, ano || null, categoria || null, qtd]
    );
    const livro = rows[0];
    for (let i = 1; i <= qtd; i++) {
      await client.query(
        'INSERT INTO exemplar (livro_id, codigo_tombo) VALUES ($1, $2)',
        [livro.id, `L${livro.id}-${String(i).padStart(3, '0')}`]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(livro);
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.code === '23505') return res.status(400).json({ erro: 'ISBN já cadastrado' });
    console.error(e);
    res.status(500).json({ erro: 'Erro interno' });
  } finally {
    client.release();
  }
});

app.delete('/api/livros/:id', auth, async (req, res) => {
  try {
    const ativos = await pool.query(
      `SELECT 1 FROM emprestimo e
       JOIN exemplar ex ON ex.id = e.exemplar_id
       WHERE ex.livro_id = $1 AND e.status = 'ATIVO' LIMIT 1`,
      [req.params.id]
    );
    if (ativos.rowCount > 0)
      return res.status(400).json({ erro: 'Há empréstimos ativos para este livro' });
    await pool.query('DELETE FROM livro WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

app.get('/api/livros/:id/exemplares', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM exemplar WHERE livro_id = $1 ORDER BY id',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

/* ========================== ROTAS: USUÁRIOS ========================== */
app.get('/api/usuarios', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM usuario ORDER BY id DESC');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

app.post('/api/usuarios', auth, async (req, res) => {
  try {
    const { nome, email, cpf, telefone } = req.body;
    if (!nome || !email || !cpf)
      return res.status(400).json({ erro: 'Nome, email e CPF obrigatórios' });
    const { rows } = await pool.query(
      `INSERT INTO usuario (nome, email, cpf, telefone)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [nome, email, cpf, telefone || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ erro: 'Email ou CPF já cadastrado' });
    console.error(e);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

app.delete('/api/usuarios/:id', auth, async (req, res) => {
  try {
    const ativos = await pool.query(
      "SELECT 1 FROM emprestimo WHERE usuario_id = $1 AND status = 'ATIVO' LIMIT 1",
      [req.params.id]
    );
    if (ativos.rowCount > 0)
      return res.status(400).json({ erro: 'Usuário possui empréstimos ativos' });
    await pool.query('DELETE FROM usuario WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

/* ========================== ROTAS: EMPRÉSTIMOS ========================== */
app.get('/api/emprestimos', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT e.*, u.nome AS usuario_nome, ex.codigo_tombo, l.titulo AS livro_titulo,
             (e.status = 'ATIVO' AND e.data_prevista < CURRENT_DATE) AS atrasado
      FROM emprestimo e
      JOIN usuario u   ON u.id = e.usuario_id
      JOIN exemplar ex ON ex.id = e.exemplar_id
      JOIN livro l     ON l.id = ex.livro_id
      ORDER BY e.id DESC`);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

app.post('/api/emprestimos', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { usuario_id, exemplar_id } = req.body;
    if (!usuario_id || !exemplar_id)
      return res.status(400).json({ erro: 'Usuário e exemplar obrigatórios' });
    await client.query('BEGIN');

    const u = await client.query('SELECT ativo FROM usuario WHERE id = $1', [usuario_id]);
    if (u.rowCount === 0 || !u.rows[0].ativo) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Usuário inválido ou inativo' });
    }

    const atraso = await client.query(
      `SELECT 1 FROM emprestimo
       WHERE usuario_id = $1 AND status = 'ATIVO' AND data_prevista < CURRENT_DATE LIMIT 1`,
      [usuario_id]
    );
    if (atraso.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Usuário possui empréstimo atrasado' });
    }

    const ex = await client.query(
      'SELECT status FROM exemplar WHERE id = $1 FOR UPDATE',
      [exemplar_id]
    );
    if (ex.rowCount === 0 || ex.rows[0].status !== 'DISPONIVEL') {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Exemplar indisponível' });
    }

    const { rows } = await client.query(
      `INSERT INTO emprestimo (exemplar_id, usuario_id, data_prevista)
       VALUES ($1, $2, CURRENT_DATE + INTERVAL '14 days') RETURNING *`,
      [exemplar_id, usuario_id]
    );
    await client.query("UPDATE exemplar SET status = 'EMPRESTADO' WHERE id = $1", [exemplar_id]);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ erro: 'Erro interno' });
  } finally {
    client.release();
  }
});

app.put('/api/emprestimos/:id/devolucao', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE emprestimo
       SET data_devolucao = CURRENT_DATE, status = 'DEVOLVIDO'
       WHERE id = $1 AND status = 'ATIVO' RETURNING *`,
      [req.params.id]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erro: 'Empréstimo ativo não encontrado' });
    }
    await client.query("UPDATE exemplar SET status = 'DISPONIVEL' WHERE id = $1", [rows[0].exemplar_id]);
    await client.query('COMMIT');
    res.json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ erro: 'Erro interno' });
  } finally {
    client.release();
  }
});

/* ========================== DASHBOARD ========================== */
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM livro) AS livros,
        (SELECT COUNT(*) FROM usuario) AS usuarios,
        (SELECT COUNT(*) FROM emprestimo WHERE status='ATIVO') AS emprestimos_ativos,
        (SELECT COUNT(*) FROM emprestimo
          WHERE status='ATIVO' AND data_prevista < CURRENT_DATE) AS atrasados`);
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

/* ========================== FRONTEND EMBUTIDO ========================== */
const HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>📚 Biblioteca</title>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<style>
  *{box-sizing:border-box;font-family:system-ui,sans-serif}
  body{margin:0;background:#f4f6f9}
  header{background:#2c3e50;color:#fff;padding:12px 24px;display:flex;justify-content:space-between;align-items:center}
  header h1{font-size:18px;margin:0}
  header button{background:#e74c3c;color:#fff;border:0;padding:8px 14px;border-radius:6px;cursor:pointer}
  .container{max-width:1100px;margin:20px auto;padding:0 16px}
  .card{background:#fff;border-radius:8px;padding:16px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
  input,select,button{padding:8px 10px;border:1px solid #ccc;border-radius:6px;font-size:14px}
  button{background:#3498db;color:#fff;border:0;cursor:pointer}
  button:hover{background:#2980b9}
  button.danger{background:#e74c3c}
  button.danger:hover{background:#c0392b}
  button.success{background:#27ae60}
  button.success:hover{background:#219150}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px;text-align:left;border-bottom:1px solid #eee;font-size:14px}
  th{background:#ecf0f1}
  .tabs{display:flex;gap:4px;margin-bottom:16px;flex-wrap:wrap}
  .tabs button{background:#bdc3c7}
  .tabs button.active{background:#2c3e50}
  .erro{color:#c0392b;font-size:13px;margin-top:6px}
  .ok{color:#27ae60;font-size:13px;margin-top:6px}
  .badge{padding:2px 8px;border-radius:10px;font-size:12px}
  .badge.atrasado{background:#fdecea;color:#c0392b}
  .badge.ativo{background:#eafaf1;color:#27ae60}
  .badge.devolvido{background:#ecf0f1;color:#7f8c8d}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
  .stat{background:#fff;padding:16px;border-radius:8px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.1)}
  .stat .num{font-size:28px;font-weight:bold;color:#2c3e50}
  .stat .label{font-size:13px;color:#7f8c8d}
</style>
</head>
<body>
<div id="root"></div>
<script type="text/babel">
const { useState, useEffect, useCallback } = React;

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const t = localStorage.getItem('token');
  if (t) headers.Authorization = 'Bearer ' + t;
  const r = await fetch('/api' + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (r.status === 401) { localStorage.removeItem('token'); location.reload(); }
  if (!r.ok) throw new Error((data && data.erro) || 'Erro na requisição');
  return data;
}
const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
};

function Login({ onLogin }) {
  const [email, setEmail] = useState('admin@biblio.com');
  const [senha, setSenha] = useState('admin123');
  const [erro, setErro] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setErro('');
    try {
      const { token } = await api.post('/auth/login', { email, senha });
      localStorage.setItem('token', token);
      onLogin();
    } catch (err) { setErro(err.message); }
  };
  return (
    <div style={{ maxWidth: 360, margin: '80px auto' }} className="card">
      <h2>📚 Login Biblioteca</h2>
      <form onSubmit={submit}>
        <div className="row">
          <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="row">
          <input type="password" placeholder="Senha" value={senha} onChange={e => setSenha(e.target.value)} style={{ flex: 1 }} />
        </div>
        <button type="submit" style={{ width: '100%' }}>Entrar</button>
        {erro && <div className="erro">{erro}</div>}
        <div style={{ fontSize: 12, color: '#888', marginTop: 10 }}>
          Padrão: admin@biblio.com / admin123
        </div>
      </form>
    </div>
  );
}

function AbaLivros() {
  const [livros, setLivros] = useState([]);
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState({ titulo: '', autor: '', isbn: '', ano: '', categoria: '', quantidade_total: 1 });
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');

  const carregar = useCallback(async () => {
    try {
      const q = busca ? '?q=' + encodeURIComponent(busca) : '';
      setLivros(await api.get('/livros' + q));
    } catch (e) { setErro(e.message); }
  }, [busca]);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async (e) => {
    e.preventDefault(); setErro(''); setOk('');
    try {
      await api.post('/livros', { ...form, ano: form.ano ? Number(form.ano) : null });
      setForm({ titulo: '', autor: '', isbn: '', ano: '', categoria: '', quantidade_total: 1 });
      setOk('Livro cadastrado!'); carregar();
    } catch (e) { setErro(e.message); }
  };

  const excluir = async (id) => {
    if (!confirm('Excluir livro?')) return;
    try { await api.del('/livros/' + id); carregar(); }
    catch (e) { setErro(e.message); }
  };

  return (
    <div>
      <div className="card">
        <h3>Novo Livro</h3>
        <form onSubmit={salvar}>
          <div className="row">
            <input placeholder="Título*" value={form.titulo} required onChange={e => setForm({ ...form, titulo: e.target.value })} />
            <input placeholder="Autor*" value={form.autor} required onChange={e => setForm({ ...form, autor: e.target.value })} />
            <input placeholder="ISBN" value={form.isbn} onChange={e => setForm({ ...form, isbn: e.target.value })} />
          </div>
          <div className="row">
            <input placeholder="Ano" type="number" value={form.ano} onChange={e => setForm({ ...form, ano: e.target.value })} />
            <input placeholder="Categoria" value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} />
            <input type="number" min="1" value={form.quantidade_total} onChange={e => setForm({ ...form, quantidade_total: e.target.value })} />
            <button type="submit">Cadastrar</button>
          </div>
          {erro && <div className="erro">{erro}</div>}
          {ok && <div className="ok">{ok}</div>}
        </form>
      </div>
      <div className="card">
        <div className="row">
          <input placeholder="Buscar por título, autor ou ISBN..." value={busca} onChange={e => setBusca(e.target.value)} style={{ flex: 1 }} />
          <button onClick={carregar}>Buscar</button>
        </div>
        <table>
          <thead><tr><th>ID</th><th>Título</th><th>Autor</th><th>ISBN</th><th>Disp./Total</th><th></th></tr></thead>
          <tbody>
            {livros.map(l => (
              <tr key={l.id}>
                <td>{l.id}</td><td>{l.titulo}</td><td>{l.autor}</td><td>{l.isbn || '—'}</td>
                <td>{l.disponiveis}/{l.total_exemplares}</td>
                <td><button className="danger" onClick={() => excluir(l.id)}>Excluir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AbaUsuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [form, setForm] = useState({ nome: '', email: '', cpf: '', telefone: '' });
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    try { setUsuarios(await api.get('/usuarios')); } catch (e) { setErro(e.message); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async (e) => {
    e.preventDefault(); setErro('');
    try {
      await api.post('/usuarios', form);
      setForm({ nome: '', email: '', cpf: '', telefone: '' }); carregar();
    } catch (e) { setErro(e.message); }
  };
  const excluir = async (id) => {
    if (!confirm('Excluir usuário?')) return;
    try { await api.del('/usuarios/' + id); carregar(); }
    catch (e) { setErro(e.message); }
  };

  return (
    <div>
      <div className="card">
        <h3>Novo Usuário</h3>
        <form onSubmit={salvar}>
          <div className="row">
            <input placeholder="Nome*" value={form.nome} required onChange={e => setForm({ ...form, nome: e.target.value })} />
            <input placeholder="Email*" value={form.email} required onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="row">
            <input placeholder="CPF*" value={form.cpf} required onChange={e => setForm({ ...form, cpf: e.target.value })} />
            <input placeholder="Telefone" value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} />
            <button type="submit">Cadastrar</button>
          </div>
          {erro && <div className="erro">{erro}</div>}
        </form>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>ID</th><th>Nome</th><th>Email</th><th>CPF</th><th>Telefone</th><th></th></tr></thead>
          <tbody>
            {usuarios.map(u => (
              <tr key={u.id}>
                <td>{u.id}</td><td>{u.nome}</td><td>{u.email}</td><td>{u.cpf}</td><td>{u.telefone || '—'}</td>
                <td><button className="danger" onClick={() => excluir(u.id)}>Excluir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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

  const carregarBase = useCallback(async () => {
    try {
      const [emp, us, lv] = await Promise.all([
        api.get('/emprestimos'), api.get('/usuarios'), api.get('/livros'),
      ]);
      setEmprestimos(emp); setUsuarios(us); setLivros(lv);
    } catch (e) { setErro(e.message); }
  }, []);
  useEffect(() => { carregarBase(); }, [carregarBase]);

  useEffect(() => {
    if (!livroId) { setExemplares([]); setExemplarId(''); return; }
    api.get('/livros/' + livroId + '/exemplares').then(setExemplares).catch(() => {});
    setExemplarId('');
  }, [livroId]);

  const emprestar = async (e) => {
    e.preventDefault(); setErro(''); setOk('');
    try {
      await api.post('/emprestimos', {
        usuario_id: Number(usuarioId),
        exemplar_id: Number(exemplarId),
      });
      setOk('Empréstimo registrado!');
      setUsuarioId(''); setLivroId(''); setExemplarId('');
      carregarBase();
    } catch (e) { setErro(e.message); }
  };

  const devolver = async (id) => {
    if (!confirm('Registrar devolução?')) return;
    try { await api.put('/emprestimos/' + id + '/devolucao', {}); carregarBase(); }
    catch (e) { setErro(e.message); }
  };

  return (
    <div>
      <div className="card">
        <h3>Novo Empréstimo</h3>
        <form onSubmit={emprestar}>
          <div className="row">
            <select value={usuarioId} onChange={e => setUsuarioId(e.target.value)} required>
              <option value="">— Usuário —</option>
              {usuarios.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
            <select value={livroId} onChange={e => setLivroId(e.target.value)} required>
              <option value="">— Livro —</option>
              {livros.map(l => <option key={l.id} value={l.id}>{l.titulo}</option>)}
            </select>
            <select value={exemplarId} onChange={e => setExemplarId(e.target.value)} required>
              <option value="">— Exemplar —</option>
              {exemplares.map(ex => (
                <option key={ex.id} value={ex.id} disabled={ex.status !== 'DISPONIVEL'}>
                  {ex.codigo_tombo} ({ex.status})
                </option>
              ))}
            </select>
            <button type="submit" className="success">Emprestar</button>
          </div>
          {erro && <div className="erro">{erro}</div>}
          {ok && <div className="ok">{ok}</div>}
        </form>
      </div>
      <div className="card">
        <h3>Histórico</h3>
        <table>
          <thead><tr><th>ID</th><th>Livro</th><th>Usuário</th><th>Empréstimo</th><th>Previsto</th><th>Devolução</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {emprestimos.map(e => (
              <tr key={e.id}>
                <td>{e.id}</td><td>{e.livro_titulo}</td><td>{e.usuario_nome}</td>
                <td>{String(e.data_emprestimo).slice(0,10)}</td>
                <td>{String(e.data_prevista).slice(0,10)}</td>
                <td>{e.data_devolucao ? String(e.data_devolucao).slice(0,10) : '—'}</td>
                <td>
                  <span className={'badge ' + (e.status === 'DEVOLVIDO' ? 'devolvido
