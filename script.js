const form = document.getElementById('form-cadastro');
const corpoTabela = document.getElementById('corpo-tabela');

// Carrega os dados assim que abrir a página
document.addEventListener('DOMContentLoaded', exibirClientes);

form.addEventListener('submit', function(e) {
    e.preventDefault();

    const novoCliente = {
        id: Date.now(),
        nome: document.getElementById('nome').value,
        email: document.getElementById('email').value,
        telefone: document.getElementById('telefone').value
    };

    salvarNoStorage(novoCliente);
    form.reset();
    exibirClientes();
});

function salvarNoStorage(cliente) {
    const clientes = JSON.parse(localStorage.getItem('clientes')) || [];
    clientes.push(cliente);
    localStorage.setItem('clientes', JSON.stringify(clientes));
}

function exibirClientes() {
    const clientes = JSON.parse(localStorage.getItem('clientes')) || [];
    corpoTabela.innerHTML = '';

    clientes.forEach(cliente => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${cliente.nome}</td>
            <td>${cliente.email}</td>
            <td>${cliente.telefone}</td>
            <td>
                <button class="btn-excluir" onclick="removerCliente(${cliente.id})">Excluir</button>
            </td>
        `;
        corpoTabela.appendChild(tr);
    });
}

function removerCliente(id) {
    let clientes = JSON.parse(localStorage.getItem('clientes')) || [];
    clientes = clientes.filter(c => c.id !== id);
    localStorage.setItem('clientes', JSON.stringify(clientes));
    exibirClientes();
}
