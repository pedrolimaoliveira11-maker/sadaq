require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================
   MIDDLEWARE DE AUTENTICAÇÃO
   ============================================================ */
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const [, token] = header.split(' ');
  if (!token) return res.status(401).json({ erro: 'Token ausente' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido' });
  }
}

/* ============================================================
   AUTH
   ============================================================ */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ erro: 'Informe email e senha' });

    const { rows } = await pool.query(
      'SELECT * FROM bibliotecario WHERE email = $1', [email]
    );
    const bib = rows[0];
    if (!bib) return res.status(401).json({ erro: 'Credenciais inválidas' });

    const ok = await bcrypt.compare(senha, bib.senha_hash);
    if (!ok) return res.status(401).json({ erro: 'Credenciais inválidas' });

    const token = jwt.sign(
      { id: bib.id, nome: bib.nome },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, nome: bib.nome });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

app.post('/api/auth/registrar', async (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    if (!nome || !email || !senha) return res.status(400).json({ erro: 'Dados incompletos' });
    const hash = await bcrypt.hash(senha, 10);
    const { rows } = await pool.query(
      `INSERT INTO bibliotecario (nome, email, senha_hash)
       VALUES ($1,$2,$3) RETURNING id, nome, email`,
      [nome, email, hash]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ erro: 'Email já cadastrado' });
    console.error(e);
    res.status(500).json({ erro: 'Erro interno' });
  }
});

/* ============================================================
   LIVROS (com exemplares automáticos)
   ============================================================ */
app.get('/api/livros', auth, async (req, res) => {
  try {
    const { q } = req.query;
    let sql = `
      SELECT l.*,
        (SELECT COUNT(*) FROM exemplar e
          WHERE e.livro_id = l.id AND e.status = 'DISPONIVEL') AS disponiveis,
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
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro interno' }); }
});

app.post('/api/livros', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { titulo, autor, isbn, ano, categoria, quantidade_total } = req.body;
    if (!titulo || !autor) return res.status(400).json({ erro: 'Título e autor são obrigatórios' });
    const qtd = Math.max(1, Number(quantidade_total) || 1);

    await client.query('BEGIN');
    const { rows: lRows } = await client.query(
      `INSERT INTO livro (titulo, autor, isbn, ano, categoria, quantidade_total)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [titulo, autor, isbn || null, ano || null, categoria || null, qtd]
    );
    const livro = lRows[0];

    // Cria exemplares automaticamente
    for (let i = 1; i <= qtd; i++) {
      await client.query(
        `INSERT INTO exemplar (livro_id, codigo_tombo) VALUES ($1, $2)`,
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
    if (ativos.rowCount > 0) {
      return res.status(400).json({ erro: 'Há empréstimos ativos para este livro' });
    }
    await pool.query('DELETE FROM livro WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro interno' }); }
});

/* ============================================================
   EXEMPLARES DISPONÍVEIS DE UM LIVRO
   ============================================================ */
app.get('/api/livros/:id/exemplares', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM exemplar WHERE livro_id = $1 ORDER BY id`, [req.params.id]
    );
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro interno' }); }
});

/* ============================================================
   USUÁRIOS
   ============================================================ */
app.get('/api/usuarios', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM usuario ORDER BY id DESC');
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro interno' }); }
});

app.post('/api/usuarios', auth, async (req, res) => {
  try {
    const { nome, email, cpf, telefone } = req.body;
    if (!nome || !email || !cpf)
      return res.status(400).json({ erro: 'Nome, email e CPF são obrigatórios' });
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
      `SELECT 1 FROM emprestimo WHERE usuario_id = $1 AND status = 'ATIVO' LIMIT 1`,
      [req.params.id]
    );
    if (ativos.rowCount > 0)
      return res.status(400).json({ erro: 'Usuário possui empréstimos ativos' });
    await pool.query('DELETE FROM usuario WHERE id = $1', [req.params.id]);
    res.status(204).send();
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro interno' }); }
});

/* ============================================================
   EMPRÉSTIMOS
   ============================================================ */
app.get('/api/emprestimos', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT e.*, u.nome AS usuario_nome, ex.codigo_tombo,
             l.titulo AS livro_titulo,
             (e.status = 'ATIVO' AND e.data_prevista < CURRENT_DATE) AS atrasado
      FROM emprestimo e
      JOIN usuario u  ON u.id = e.usuario_id
      JOIN exemplar ex ON ex.id = e.exemplar_id
      JOIN livro l    ON l.id = ex.livro_id
      ORDER BY e.id DESC`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro interno' }); }
});

app.post('/api/emprestimos', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { usuario_id, exemplar_id } = req.body;
    if (!usuario_id || !exemplar_id)
      return res.status(400).json({ erro: 'Informe usuário e exemplar' });

    await client.query('BEGIN');

    // Usuário ativo?
    const u = await client.query('SELECT ativo FROM usuario WHERE id = $1', [usuario_id]);
    if (u.rowCount === 0 || !u.rows[0].ativo) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Usuário inválido ou inativo' });
    }

    // Atraso?
    const atraso = await client.query(
      `SELECT 1 FROM emprestimo
       WHERE usuario_id = $1 AND status = 'ATIVO' AND data_prevista < CURRENT_DATE LIMIT 1`,
      [usuario_id]
    );
    if (atraso.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ erro: 'Usuário possui empréstimo atrasado' });
    }

    // Exemplar disponível? (FOR UPDATE evita corrida)
    const ex = await client.query(
      'SELECT status FROM exemplar WHERE id = $1 FOR UPDATE', [exemplar_id]
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
    await client.query(
      `UPDATE exemplar SET status = 'EMPRESTADO' WHERE id = $1`, [exemplar_id]
    );

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
    await client.query(
      `UPDATE exemplar SET status = 'DISPONIVEL' WHERE id = $1`,
      [rows[0].exemplar_id]
    );
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

/* ============================================================
   ROTAS DE ESTATÍSTICA (opcional, para dashboard)
   ============================================================ */
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const total = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM livro) AS livros,
        (SELECT COUNT(*) FROM usuario) AS usuarios,
        (SELECT COUNT(*) FROM emprestimo WHERE status='ATIVO') AS emprestimos_ativos,
        (SELECT COUNT(*) FROM emprestimo
          WHERE status='ATIVO' AND data_prevista < CURRENT_DATE) AS atrasados`);
    res.json(total.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ erro: 'Erro interno' }); }
});

/* ============================================================
   SEED (cria bibliotecário padrão + dados de exemplo)
   ============================================================ */
async function seed() {
  try {
    const hash = await bcrypt.hash('admin123', 10);
    await pool.query(
      `INSERT INTO bibliotecario (nome, email, senha_hash)
       VALUES ('Admin','admin@biblio.com',$1)
       ON CONFLICT (email) DO NOTHING`, [hash]
    );

    const livrosExemplo = [
      ['Dom Casmurro', 'Machado de Assis', '9788535910663', 1899, 'Romance', 2],
      ['1984', 'George Orwell', '9780451524935', 1949, 'Ficção', 3],
      ['O Hobbit', 'J.R.R. Tolkien', '9788595084742', 1937, 'Fantasia', 2],
    ];
    for (const l of livrosExemplo) {
      const { rows } = await pool.query(
        `INSERT INTO livro (titulo, autor, isbn, ano, categoria, quantidade_total)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (isbn) DO NOTHING RETURNING id`, l
      );
      if (rows[0]) {
        for (let i = 1; i <= l[5]; i++) {
          await pool.query(
            `INSERT INTO exemplar (livro_id, codigo_tombo) VALUES ($1, $2)`,
            [rows[0].id, `L${rows[0].id}-${String(i).padStart(3, '0')}`]
          );
        }
      }
    }

    await pool.query(`
      INSERT INTO usuario (nome, email, cpf, telefone) VALUES
      ('João Silva','joao@email.com','111.111.111-11','(11)99999-1111'),
      ('Maria Souza','maria@email.com','222.222.222-22','(11)99999-2222')
      ON CONFLICT (email) DO NOTHING`);

    console.log('✅ Seed concluído. Login: admin@biblio.com / admin123');
    process.exit(0);
  } catch (e) {
    console.error('❌ Erro no seed:', e);
    process.exit(1);
  }
}

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
if (process.argv.includes('seed')) {
  seed();
} else {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
}
