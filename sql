DROP TABLE IF EXISTS emprestimo CASCADE;
DROP TABLE IF EXISTS exemplar CASCADE;
DROP TABLE IF EXISTS livro CASCADE;
DROP TABLE IF EXISTS usuario CASCADE;
DROP TABLE IF EXISTS bibliotecario CASCADE;

CREATE TABLE livro (
  id SERIAL PRIMARY KEY,
  titulo VARCHAR(200) NOT NULL,
  autor VARCHAR(150) NOT NULL,
  isbn VARCHAR(20) UNIQUE,
  ano INT,
  categoria VARCHAR(80),
  quantidade_total INT NOT NULL DEFAULT 1
);

CREATE TABLE exemplar (
  id SERIAL PRIMARY KEY,
  livro_id INT NOT NULL REFERENCES livro(id) ON DELETE CASCADE,
  codigo_tombo VARCHAR(30) UNIQUE NOT NULL,
  status VARCHAR(15) NOT NULL DEFAULT 'DISPONIVEL'
    CHECK (status IN ('DISPONIVEL','EMPRESTADO'))
);

CREATE TABLE usuario (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  cpf VARCHAR(14) UNIQUE NOT NULL,
  telefone VARCHAR(20),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE emprestimo (
  id SERIAL PRIMARY KEY,
  exemplar_id INT NOT NULL REFERENCES exemplar(id),
  usuario_id INT NOT NULL REFERENCES usuario(id),
  data_emprestimo DATE NOT NULL DEFAULT CURRENT_DATE,
  data_prevista DATE NOT NULL,
  data_devolucao DATE,
  status VARCHAR(15) NOT NULL DEFAULT 'ATIVO'
    CHECK (status IN ('ATIVO','DEVOLVIDO','ATRASADO'))
);

CREATE TABLE bibliotecario (
  id SERIAL PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  senha_hash VARCHAR(255) NOT NULL
);

CREATE INDEX idx_emprestimo_status ON emprestimo(status);
CREATE INDEX idx_emprestimo_usuario ON emprestimo(usuario_id);
CREATE INDEX idx_exemplar_livro ON exemplar(livro_id);
