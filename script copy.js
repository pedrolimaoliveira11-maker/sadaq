const form = document.getElementById('form-cadastro');
const corpoTabela = document.getElementById('corpo-tabela');
const inputId = document.getElementById('cliente-id');
const btnSalvar = document.getElementById('btn-salvar');
const btnCancelar = document.getElementById('btn-cancelar');
const tituloForm = document.getElementById('titulo-form');

document.addEventListener('DOMContentLoaded', exibirClientes);

form.addEventListener('submit', function(e) {
    e.preventDefault();
    
    const cliente = {
        nome: document.getElementById('nome').value,
        email: document.getElementById('email').value,
        telefone: document.getElementById('telefone').value
    };

    let clientes = JSON.parse(localStorage.getItem('clientes')) || [];

    if (inputId.value) {
        // MODO EDIÇÃO
        const index = clientes.findIndex(c => c.id == inputId.value);
        clientes[index] = { ...cliente, id: Number(inputId.value) };
    } else {
        // MODO NOVO CADASTRO
        clientes.push({ ...cliente, id: Date.now() });
    }

    localStorage.setItem('clientes', JSON.stringify(clientes));
    resetarEstado();
    exibirClientes();
});

function exibirClientes() {
    const clientes = JSON.parse(localStorage.getItem('clientes')) || [];
    renderizarTabela(clientes);
}

function renderizarTabela(lista) {
    corpoTabela.innerHTML = '';
    lista.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${c.nome}</td>
            <td>${c.email}</td>
            <td>${c.telefone}</td>
            <td class="acoes-flex">
                <button class="btn-editar" onclick="prepararEdicao(${c.id})">Editar</button>
                <button class="btn-excluir" onclick="removerCliente(${c.id})">Excluir</button>
            </td>
        `;
        corpoTabela.appendChild(tr);
    });
}

function prepararEdicao(id) {
    const clientes = JSON.parse(localStorage.getItem('clientes')) || [];
    const cliente = clientes.find(c => c.id === id);

    document.getElementById('nome').value = cliente.nome;
    document.getElementById('email').value = cliente.email;
    document.getElementById('telefone').value = cliente.telefone;
    inputId.value = cliente.id;

    tituloForm.innerText = "Editando Cliente";
    btnSalvar.innerText = "Atualizar Cadastro";
    btnSalvar.style.backgroundColor = "#e67e22";
    btnCancelar.style.display = "block";
}

function resetarEstado() {
    form.reset();
    inputId.value = "";
    tituloForm.innerText = "Novo Cliente";
    btnSalvar.innerText = "Salvar Cliente";
    btnSalvar.style.backgroundColor = "#1a73e8";
    btnCancelar.style.display = "none";
}

function removerCliente(id) {
    if(confirm("Deseja realmente excluir?")) {
        let clientes = JSON.parse(localStorage.getItem('clientes')) || [];
        clientes = clientes.filter(c => c.id !== id);
        localStorage.setItem('clientes', JSON.stringify(clientes));
        exibirClientes();
    }
}

function filtrarClientes() {
    const termo = document.getElementById('busca').value.toLowerCase();
    const clientes = JSON.parse(localStorage.getItem('clientes')) || [];
    const filtrados = clientes.filter(c => c.nome.toLowerCase().includes(termo));
    renderizarTabela(filtrados);
}

// EXPORTAR CSV
document.getElementById('btn-exportar').addEventListener('click', () => {
    const clientes = JSON.parse(localStorage.getItem('clientes')) || [];
    let csv = "\ufeffNome;E-mail;Telefone\n";
    clientes.forEach(c => csv += `${c.nome};${c.email};${c.telefone}\n`);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "clientes.csv";
    link.click();
});
