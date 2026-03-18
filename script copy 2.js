// Seleção de elementos
const form = document.getElementById('form-cadastro');
const corpoTabela = document.getElementById('corpo-tabela');
const btnTema = document.createElement('button'); // Criando o botão de tema dinamicamente

// Inicialização
let clientes = JSON.parse(localStorage.getItem('clientes')) || [];
let editandoId = null;

// Configuração do botão de tema (Adicionando ao HTML)
document.body.prepend(btnTema);
btnTema.id = "btn-tema";
btnTema.innerText = "Alternar Tema";
btnTema.onclick = () => document.body.classList.toggle('dark-mode');

// --- Funções Principais ---

function renderizarTabela(dados = clientes) {
    corpoTabela.innerHTML = '';
    dados.forEach((cliente, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${cliente.nome}</td>
            <td>${cliente.email}</td>
            <td>${cliente.telefone}</td>
            <td>
                <button onclick="prepararEdicao(${index})" class="btn-edit">Editar</button>
                <button onclick="removerCliente(${index})" class="btn-delete">Excluir</button>
            </td>
        `;
        corpoTabela.appendChild(tr);
    });
}

form.onsubmit = (e) => {
    e.preventDefault();
    const novoCliente = {
        nome: document.getElementById('nome').value,
        email: document.getElementById('email').value,
        telefone: document.getElementById('telefone').value
    };

    if (editandoId !== null) {
        clientes[editandoId] = novoCliente;
        editandoId = null;
    } else {
        clientes.push(novoCliente);
    }

    salvarEAtualizar();
    form.reset();
    resetarEstado();
};

function removerCliente(index) {
    if (confirm('Tem certeza que deseja excluir este cliente?')) {
        clientes.splice(index, 1);
        salvarEAtualizar();
    }
}

function prepararEdicao(index) {
    const cliente = clientes[index];
    document.getElementById('nome').value = cliente.nome;
    document.getElementById('email').value = cliente.email;
    document.getElementById('telefone').value = cliente.telefone;
    
    editandoId = index;
    document.getElementById('titulo-form').innerText = "Editando Cliente";
    document.getElementById('btn-salvar').innerText = "Atualizar";
    document.getElementById('btn-cancelar').style.display = "inline-block";
}

function resetarEstado() {
    editandoId = null;
    document.getElementById('titulo-form').innerText = "Novo Cliente";
    document.getElementById('btn-salvar').innerText = "Salvar Cliente";
    document.getElementById('btn-cancelar').style.display = "none";
    form.reset();
}

function filtrarClientes() {
    const termo = document.getElementById('busca').value.toLowerCase();
    const filtrados = clientes.filter(c => 
        c.nome.toLowerCase().includes(termo) || 
        c.email.toLowerCase().includes(termo)
    );
    renderizarTabela(filtrados);
}

function salvarEAtualizar() {
    localStorage.setItem('clientes', JSON.stringify(clientes));
    renderizarTabela();
}

// Carregar dados ao iniciar
renderizarTabela();